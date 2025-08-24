import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as fg from 'fast-glob';
import * as os from 'os';

const execAsync = promisify(exec);

async function cleanupTempDirectory(tempDir: string, ardupilotDir: string): Promise<void> {
	console.log(`Cleaning up temporary directory except ArduPilot: ${tempDir}`);

	if (!fs.existsSync(tempDir)) {
		return;
	}

	try {
		// Get all items in temp directory
		const items = fs.readdirSync(tempDir);

		for (const item of items) {
			const itemPath = path.join(tempDir, item);
			const ardupilotDirName = path.basename(ardupilotDir);

			// Skip the ArduPilot directory
			if (item === ardupilotDirName) {
				continue;
			}

			// Remove everything else
			console.log(`Removing: ${itemPath}`);
			if (fs.statSync(itemPath).isDirectory()) {
				fs.rmSync(itemPath, { recursive: true, force: true });
			} else {
				fs.unlinkSync(itemPath);
			}
		}
	} catch (error) {
		console.warn(`Failed to clean up temp directory: ${error}`);
	}
}

async function installExtension(vscodeExecutablePath: string, extensionId: string): Promise<void> {
	console.log(`Installing extension: ${extensionId}`);
	const maxRetries = 2;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
			const { stdout } = await execAsync(`VSCODE_IPC_HOOK_CLI= DONT_PROMPT_WSL_INSTALL=1 "${cli}" ${args.join(' ')} --install-extension ${extensionId} --force`);

			console.log(`Extension ${extensionId} installed successfully on attempt ${attempt}:`, stdout);
			return; // Success, exit the retry loop
		} catch (error) {
			console.warn(`Failed to install extension ${extensionId} on attempt ${attempt}:`, error);

			if (attempt === maxRetries) {
				console.warn(`Failed to install extension ${extensionId} after ${maxRetries} attempts. Continuing with tests...`);
				// Don't throw error to avoid breaking tests if extension installation fails
			} else {
				console.log(`Retrying extension installation for ${extensionId}...`);
				// Wait 2 seconds before retry
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
	}
}

async function setupArdupilotWorkspace(): Promise<string> {
	const ardupilotPath = path.resolve(__dirname, '../../ardupilot');

	console.log('Setting up ArduPilot workspace...');

	// Check if ArduPilot directory exists
	if (fs.existsSync(ardupilotPath)) {
		console.log('ArduPilot directory found, pulling latest changes...');
		try {
			// Change to ArduPilot directory and pull latest master
			const { stdout: pullOutput } = await execAsync('git pull origin master', { cwd: ardupilotPath });
			console.log('Git pull output:', pullOutput);
		} catch (error) {
			console.warn('Failed to pull latest changes, proceeding with existing repository:', error);
		}
	} else {
		console.log('ArduPilot directory not found, cloning repository...');
		try {
			// Clone only the master branch of ArduPilot repository
			const { stdout: cloneOutput } = await execAsync(`git clone --depth 1 --single-branch --branch master https://github.com/ArduPilot/ardupilot.git "${ardupilotPath}"`);
			console.log('Git clone output:', cloneOutput);
		} catch (error) {
			console.error('Failed to clone ArduPilot repository:', error);
			throw error;
		}
	}

	return ardupilotPath;
}

async function main() {
	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		const testSuiteArg = args.find(arg => arg.startsWith('--test-suite='));
		const testSuite = testSuiteArg ? testSuiteArg.split('=')[1] : undefined;

		if (testSuite) {
			console.log(`Running specific test suite: ${testSuite}`);
		} else {
			console.log('Running all test suites');
		}

		// Set up ArduPilot workspace
		const workspacePath = await setupArdupilotWorkspace();

		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		console.log(`Running tests with ArduPilot workspace: ${workspacePath}`);

		// Download VS Code if needed and get the executable path
		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Install required extensions
		await installExtension(vscodeExecutablePath, 'marus25.cortex-debug');
		await installExtension(vscodeExecutablePath, 'ms-vscode.cpptools');
		await installExtension(vscodeExecutablePath, 'ms-python.python');

		const globPattern = '**/**.test.js';
		const testFiles = await fg(globPattern, { cwd: path.dirname(extensionTestsPath) });

		if (testFiles.length === 0) {
			console.error('No test files found matching the pattern:', globPattern);
			process.exit(1);
		}

		for (const testFile of testFiles) {
			console.log(`Found test file: ${testFile}`);
			const currentTestSuiteName = path.basename(testFile, '.test.js');

			if (testSuite && currentTestSuiteName !== testSuite) {
				console.log(`Skipping test file ${testFile} as it does not match the specified test suite: ${testSuite}`);
				continue;
			}
			console.log(`Running test file: ${testFile}`);

			// Create fresh temporary directory for each test suite
			const tempDir = path.join(os.tmpdir(), `ardupilot-tests-${currentTestSuiteName}-${Date.now()}`);

			// Clean up any existing temp directory
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
			fs.mkdirSync(tempDir, { recursive: true });

			console.log(`Using temporary user directory: ${tempDir}`);

			// Clean up temp directory except ArduPilot before running tests
			await cleanupTempDirectory(tempDir, workspacePath);

			// Set the TEST_SUITE environment variable to filter tests
			process.env.TEST_SUITE = currentTestSuiteName;

			try {
				// Run the test file
				await runTests({
					extensionDevelopmentPath,
					extensionTestsPath: extensionTestsPath,
					vscodeExecutablePath,
					// Additional launch arguments
					launchArgs: [
						'--disable-gpu',
						'--disable-dev-shm-usage',
						'--no-sandbox',
						'--disable-web-security',
						'--disable-features=VizDisplayCompositor',
						'--disable-background-timer-throttling',
						'--disable-backgrounding-occluded-windows',
						'--disable-renderer-backgrounding',
						'--enable-unsafe-swiftshader',
						'--disable-workspace-trust',
						'--user-data-dir', tempDir, // Use isolated temporary directory for user data
						workspacePath // Open the ArduPilot workspace
					],
				});
				console.log(`Test file ${testFile} completed.`);
			} finally {
				// Clean up temporary directory after test completes
				console.log(`Cleaning up temporary directory: ${tempDir}`);
				if (fs.existsSync(tempDir)) {
					fs.rmSync(tempDir, { recursive: true, force: true });
				}
			}
		}
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

void main();

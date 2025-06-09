import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as fg from 'fast-glob';

const execAsync = promisify(exec);

async function installExtension(vscodeExecutablePath: string, extensionId: string): Promise<void> {
	console.log(`Installing extension: ${extensionId}`);
	try {
		const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
		const { stdout } = await execAsync(`VSCODE_IPC_HOOK_CLI= DONT_PROMPT_WSL_INSTALL=1 "${cli}" ${args.join(' ')} --install-extension ${extensionId} --force`);

		console.log(`Extension ${extensionId} installed successfully:`, stdout);
	} catch (error) {
		console.warn(`Failed to install extension ${extensionId}:`, error);
		// Don't throw error to avoid breaking tests if extension installation fails
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
			const { stdout: cloneOutput } = await execAsync(`git clone --single-branch --branch master https://github.com/ArduPilot/ardupilot.git "${ardupilotPath}"`);
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

		// Set environment variable to pass test suite filter to the test runner
		if (testSuite) {
			process.env.TEST_SUITE_FILTER = testSuite;
		}

		// Download VS Code if needed and get the executable path
		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Install required extensions
		await installExtension(vscodeExecutablePath, 'marus25.cortex-debug');
		await installExtension(vscodeExecutablePath, 'ms-vscode.cpptools');
		await installExtension(vscodeExecutablePath, 'ms-python.python');

		const globPattern = '**/**.test.js';
		const testFiles = await fg(globPattern, { cwd: path.dirname(extensionTestsPath) });
		// get name of test suite from the file name <testSuite>.test.js
		const testSuiteName = testFiles.length > 0 ? path.basename(testFiles[0], '.test.js') : undefined;
		if (!testSuiteName) {
			console.error('No test files found matching the pattern:', globPattern);
			process.exit(1);
		}
		console.log(`Test suite name: ${testSuiteName}`);
		for (const testFile of testFiles) {
			console.log(`Found test file: ${testFile}`);
			if (testSuite && !testFile.includes(testSuiteName)) {
				console.log(`Skipping test file ${testFile} as it does not match the specified test suite: ${testSuite}`);
				continue;
			}
			console.log(`Running test file: ${testFile}`);
			// Set the TEST_SUITE environment variable to filter tests
			process.env.TEST_SUITE = testSuiteName;
			// Run the test file
			await runTests({
				extensionDevelopmentPath,
				extensionTestsPath: extensionTestsPath,
				vscodeExecutablePath,
				// Additional launch arguments
				launchArgs: [
					'--disable-workspace-trust', // Disable workspace trust prompt
					workspacePath // Open the ArduPilot workspace
				],
			});
			console.log(`Test file ${testFile} completed.`);
		}
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();

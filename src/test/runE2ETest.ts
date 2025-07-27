import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

const execAsync = promisify(exec);

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

async function main() {
	try {
		console.log('Running E2E test suite...');

		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to E2E test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './e2e/index');

		// Download VS Code if needed and get the executable path
		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Install required extensions
		await installExtension(vscodeExecutablePath, 'marus25.cortex-debug');
		await installExtension(vscodeExecutablePath, 'ms-vscode.cpptools');
		await installExtension(vscodeExecutablePath, 'ms-python.python');

		// Run the E2E test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath: extensionTestsPath,
			vscodeExecutablePath,
			// Additional launch arguments
			launchArgs: [
				'--disable-workspace-trust' // Disable workspace trust prompt
			],
		});
		console.log('E2E test completed successfully.');
	} catch (err) {
		console.error('Failed to run E2E tests:', err);
		process.exit(1);
	}
}

main();

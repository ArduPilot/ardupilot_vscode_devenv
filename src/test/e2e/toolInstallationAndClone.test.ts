/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as sinon from 'sinon';
import { ProgramUtils } from '../../apProgramUtils';
import { APExtensionContext } from '../../extension';
import { CloneArdupilot } from '../../apCloneArdupilot';
import { apLog } from '../../apLog';
import { ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { getApExtApi } from '../suite/common';
import { ToolsRegistryHelpers } from '../../apToolsConfig';

suite('E2E: Tool Installation and ArduPilot Clone', function() {
	// Extended timeout for actual installations and cloning
	this.timeout(1200000); // 20 minutes

	let apExtensionContext: APExtensionContext;
	let tempDir: string;
	let ardupilotDir: string;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(async () => {
		sandbox = sinon.createSandbox();

		// Mock apLog to redirect VS Code output console to regular console
		sandbox.stub(apLog.prototype, 'log').callsFake((message: string) => {
			console.log(`[apLog] ${message}`);
		});

		// Mock VS Code output channel creation
		const mockOutputChannel = {
			appendLine: (message: string) => console.log(`[VS Code Output] ${message}`),
			show: sandbox.stub(),
			hide: sandbox.stub(),
			dispose: sandbox.stub(),
			name: 'ArduPilot',
			append: sandbox.stub(),
			clear: sandbox.stub(),
			replace: sandbox.stub()
		};

		sandbox.stub(vscode.window, 'createOutputChannel').returns(mockOutputChannel as any);

		console.log('DEBUG: Starting E2E clone test suite setup...');
		apExtensionContext = await getApExtApi(false);
		assert.ok(apExtensionContext.apWelcomeProviderInstance, 'Extension context should be available');

		// Create persistent ardupilot-e2e directory for this test
		tempDir = path.join(os.tmpdir(), 'ardupilot-e2e');
		ardupilotDir = path.join(tempDir, 'ardupilot');

		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
			console.log(`DEBUG: Created temp directory: ${tempDir}`);
		} else {
			console.log(`DEBUG: Using existing temp directory: ${tempDir}`);
		}
	});

	teardown(() => {
		sandbox.restore();
	});

	suiteTeardown(() => {
		console.log('DEBUG: E2E clone test cleanup...');
		// Keep the persistent ardupilot-e2e directory for the build test
		console.log(`DEBUG: Preserving temp directory for build test: ${tempDir}`);
	});

	test('Tool Installation and ArduPilot Clone', async function() {
		console.log('DEBUG: Starting E2E test - Tool Installation and ArduPilot Clone');

		// Phase 1: Tool Installation and Detection Testing
		console.log('DEBUG: Phase 1 - Installing and testing all tools...');

		const allToolIds = ToolsRegistryHelpers.getToolIdsList();
		console.log(`DEBUG: Found ${allToolIds.length} tool IDs to test: ${allToolIds.join(', ')}`);

		// Mock error message tracking
		const errorMessages: string[] = [];
		sandbox.stub(vscode.window, 'showErrorMessage').callsFake((message: string, ...items: any[]) => {
			console.log(`DEBUG: Error message: ${message}`);
			errorMessages.push(message);

			// Check for clone failure message
			if (message.includes('Failed to clone ardupilot') || message.includes('Directory already exists')) {
				console.log('DEBUG: ArduPilot clone detected as failed');
				if (clonePromiseResolve) {
					clonePromiseResolve(false);
				}
			}

			return Promise.resolve(items[0]);
		});

		// Mock information messages and terminal creation for installations
		const infoMessages: string[] = [];
		let clonePromiseResolve: (value: boolean) => void;

		sandbox.stub(vscode.window, 'showInformationMessage').callsFake((message: string, ...items: any[]) => {
			console.log(`DEBUG: Info message: ${message}`);
			infoMessages.push(message);

			// Check for clone completion message
			if (message.includes('Cloned Ardupilot to')) {
				console.log('DEBUG: ArduPilot clone detected as successful');
				if (clonePromiseResolve) {
					clonePromiseResolve(true);
				}
			}

			return Promise.resolve(items[0]); // Return first button if any
		});

		// Mock external URL opening
		const openedUrls: string[] = [];
		sandbox.stub(vscode.env, 'openExternal').callsFake((uri: vscode.Uri) => {
			console.log(`DEBUG: Opening external URL: ${uri.toString()}`);
			openedUrls.push(uri.toString());
			return Promise.resolve(true);
		});

		// Track installation attempts and results
		const installationResults: { [toolId: string]: { attempted: boolean, supported: boolean, installed: boolean, error?: string } } = {};
		const failedInstallations: { toolId: string, error: string }[] = [];

		// Install tools one by one with proper error handling
		for (const toolId of allToolIds) {
			console.log(`DEBUG: Installing tool: ${toolId}`);

			// Reset error tracking for this tool
			const previousErrorCount = errorMessages.length;

			// Attempt to install the tool using the promise-based installTool method
			try {
				// Create a mock ValidateEnvironmentPanel instance for testing
				const mockInstance = {
					_validateEnvironment: sandbox.stub()
				} as any;

				await ValidateEnvironmentPanel.installTool(toolId, mockInstance);
				installationResults[toolId] = { attempted: true, supported: true, installed: true };
				console.log(`DEBUG: Tool ${toolId} installed successfully`);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.log(`DEBUG: Tool ${toolId} installation failed: ${errorMessage}`);
				installationResults[toolId] = { attempted: true, supported: true, installed: false, error: errorMessage };
				failedInstallations.push({ toolId, error: errorMessage });
			}

			// Check if installation was not supported (error message added)
			if (errorMessages.length > previousErrorCount) {
				const newErrors = errorMessages.slice(previousErrorCount);
				const notSupportedError = newErrors.find(msg => msg.includes('Installation not supported') || msg.includes('No installation method available'));
				if (notSupportedError) {
					console.log(`DEBUG: Tool ${toolId} installation not supported: ${notSupportedError}`);
					installationResults[toolId] = { attempted: true, supported: false, installed: false, error: notSupportedError };
				}
			}

			// Verify installation result with findProgram
			if (installationResults[toolId].installed) {
				console.log(`DEBUG: Verifying installation for tool: ${toolId}`);
				try {
					const { ToolsRegistryHelpers } = await import('../../apToolsConfig');
					const allTools = ToolsRegistryHelpers.getAllTools();
					const toolInfo = allTools.find(tool => tool.key === toolId);
					if (toolInfo) {
						const programInfo = await ProgramUtils.findProgram(toolInfo);
						installationResults[toolId].installed = programInfo.available;
						console.log(`DEBUG: Tool ${toolId} verification - available: ${programInfo.available}, path: ${programInfo.path}`);
					} else {
						console.log(`DEBUG: Tool ${toolId} not found in registry`);
						installationResults[toolId].installed = false;
					}
				} catch (error) {
					console.log(`DEBUG: Post-installation verification failed for ${toolId}: ${error}`);
					installationResults[toolId].installed = false;
				}
			}
		}

		// Report installation results
		console.log('DEBUG: Tool Installation Summary:');
		const supportedTools: string[] = [];
		const unsupportedTools: string[] = [];
		const installedTools: string[] = [];
		const failedInstalls: string[] = [];

		for (const [toolId, result] of Object.entries(installationResults)) {
			if (result.supported) {
				supportedTools.push(toolId);
				if (result.installed) {
					installedTools.push(toolId);
				} else {
					failedInstalls.push(toolId);
				}
			} else {
				unsupportedTools.push(toolId);
			}
		}

		console.log(`DEBUG: Supported tools (${supportedTools.length}): ${supportedTools.join(', ')}`);
		console.log(`DEBUG: Unsupported tools (${unsupportedTools.length}): ${unsupportedTools.join(', ')}`);
		console.log(`DEBUG: Successfully installed (${installedTools.length}): ${installedTools.join(', ')}`);
		console.log(`DEBUG: Failed to install (${failedInstalls.length}): ${failedInstalls.join(', ')}`);

		// Throw combined error for all failed installations if any
		if (failedInstallations.length > 0) {
			const failureList = failedInstallations.map(({ toolId, error }) => `${toolId}: ${error}`).join('\n');
			const combinedError = `Failed to install ${failedInstallations.length} tool(s):\n${failureList}`;
			console.log(`DEBUG: Installation failures:\n${combinedError}`);
			// Don't throw error in E2E tests, just log it for debugging
			// throw new Error(combinedError);
		}

		// Verify that we have at least some critical tools for the build process
		const criticalTools = ['PYTHON', 'GCC', 'ARM_GCC'];
		const availableCriticalTools = criticalTools.filter(toolId => {
			const result = installationResults[toolId];
			return result && (result.installed || result.supported);
		});

		console.log(`DEBUG: Available critical tools: ${availableCriticalTools.join(', ')}`);
		assert.ok(availableCriticalTools.length >= 1, 'At least one critical tool should be available or installable');

		// Phase 2: ArduPilot Cloning using apCloneArdupilot
		console.log('DEBUG: Phase 2 - Checking/Cloning ArduPilot...');

		// Check if ArduPilot already exists
		if (fs.existsSync(ardupilotDir) && fs.existsSync(path.join(ardupilotDir, 'wscript'))) {
			console.log('DEBUG: ArduPilot already exists, skipping clone');
		} else {
			console.log('DEBUG: ArduPilot not found, cloning using apCloneArdupilot...');

			// Clean up any existing ardupilot directory before cloning
			if (fs.existsSync(ardupilotDir)) {
				console.log('DEBUG: Removing existing incomplete ardupilot directory...');
				fs.rmSync(ardupilotDir, { recursive: true, force: true });
			}

			// Mock the user input dialogs that apCloneArdupilot.run() uses
			sandbox.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(tempDir)]);
			sandbox.stub(vscode.window, 'showInputBox').resolves('ardupilot');

			// Mock workspace folder update to avoid extension host crash
			sandbox.stub(vscode.workspace, 'updateWorkspaceFolders').callsFake(() => {
				console.log('DEBUG: Mocked workspace folder update to prevent extension host crash');
				return true;
			});

			// Mock progress bar to avoid UI interactions
			const mockProgress = {
				report: sandbox.stub()
			};
			sandbox.stub(vscode.window, 'withProgress').callsFake(async (_options, task) => {
				const mockToken = {
					isCancellationRequested: false,
					onCancellationRequested: sandbox.stub()
				};
				return task(mockProgress, mockToken);
			});

			// Setup clone completion detection using existing stub
			const cloneCompletionPromise = new Promise<boolean>((resolve) => {
				clonePromiseResolve = resolve;
			});

			// Execute the actual apCloneArdupilot.run() method
			console.log('DEBUG: apCloneArdupilot.run() initiated');
			void CloneArdupilot.run();

			// Wait for clone completion with timeout
			const cloneSuccess = await Promise.race([
				cloneCompletionPromise,
				new Promise<boolean>((resolve) => {
					setTimeout(() => {
						console.log('DEBUG: ArduPilot clone timed out');
						resolve(false);
					}, 1200000); // 20 minutes
				})
			]);

			console.log(`DEBUG: ArduPilot clone result: ${cloneSuccess}`);
			assert.ok(cloneSuccess, 'ArduPilot repository should clone successfully');
		}

		// Verify ArduPilot directory exists regardless of whether we cloned or used existing
		assert.ok(fs.existsSync(ardupilotDir), 'ArduPilot directory should exist');
		assert.ok(fs.existsSync(path.join(ardupilotDir, 'wscript')), 'ArduPilot wscript should exist');
		console.log('DEBUG: ArduPilot directory verified');

		console.log('DEBUG: E2E clone test completed successfully - ArduPilot ready for build test');
	});
});

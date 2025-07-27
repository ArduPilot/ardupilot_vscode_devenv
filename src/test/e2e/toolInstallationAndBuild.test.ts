/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as sinon from 'sinon';
import { spawn } from 'child_process';
import { ProgramUtils } from '../../apProgramUtils';
import { APExtensionContext } from '../../extension';
import { APTaskProvider } from '../../taskProvider';
import { CloneArdupilot } from '../../apCloneArdupilot';
import { apLog } from '../../apLog';
import { ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { getApExtApi } from '../suite/common';

suite('E2E: Tool Installation and ArduPilot Build', function() {
	// Extended timeout for actual installations and builds
	this.timeout(600000); // 10 minutes

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

		console.log('DEBUG: Starting E2E test suite setup...');
		apExtensionContext = await getApExtApi(false);
		assert(apExtensionContext.apWelcomeProviderInstance, 'Extension context should be available');

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
		console.log('DEBUG: E2E test cleanup...');
		// Keep the persistent ardupilot-e2e directory for future test runs
		console.log(`DEBUG: Preserving temp directory for future runs: ${tempDir}`);
	});

	test('Complete E2E: Install Tools, Clone ArduPilot, Build SITL and CubeOrange+', async function() {
		console.log('DEBUG: Starting E2E test - Install Tools, Clone ArduPilot, Build SITL and CubeOrange+');

		// Phase 1: Tool Installation and Detection Testing
		console.log('DEBUG: Phase 1 - Installing and testing all tools...');

		// Get all available tool IDs
		const allToolIds = Object.values(ProgramUtils.ToolId);
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

		// No need to create ValidateEnvironmentPanel instance - we'll use the static installTool method

		// Track installation attempts and results
		const installationResults: { [toolId: string]: { attempted: boolean, supported: boolean, installed: boolean } } = {};

		// Test installation for each tool
		for (const toolId of allToolIds) {
			console.log(`DEBUG: Testing installation for tool: ${toolId}`);

			// Reset error tracking for this tool
			const previousErrorCount = errorMessages.length;

			// Attempt to install the tool using the static installTool method
			try {
				ValidateEnvironmentPanel.installTool(toolId);
				installationResults[toolId] = { attempted: true, supported: true, installed: false };
				console.log(`DEBUG: Installation attempted for ${toolId}`);
			} catch (error) {
				console.log(`DEBUG: Installation failed for ${toolId}: ${error}`);
				installationResults[toolId] = { attempted: true, supported: false, installed: false };
			}

			// Check if installation was not supported (error message added)
			if (errorMessages.length > previousErrorCount) {
				const newErrors = errorMessages.slice(previousErrorCount);
				const notSupportedError = newErrors.find(msg => msg.includes('Installation not supported'));
				if (notSupportedError) {
					console.log(`DEBUG: Tool ${toolId} installation not supported: ${notSupportedError}`);
					installationResults[toolId].supported = false;
				}
			}

			// For supported installations, verify with findTool
			if (installationResults[toolId].supported) {
				console.log(`DEBUG: Verifying installation for supported tool: ${toolId}`);
				try {
					const toolInfo = await ProgramUtils.findTool(toolId);
					installationResults[toolId].installed = toolInfo.available;
					console.log(`DEBUG: Tool ${toolId} post-installation check - available: ${toolInfo.available}, path: ${toolInfo.path}`);
				} catch (error) {
					console.log(`DEBUG: Post-installation check failed for ${toolId}: ${error}`);
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

		// Verify that we have at least some critical tools for the build process
		const criticalTools = [ProgramUtils.ToolId.PYTHON, ProgramUtils.ToolId.GCC, ProgramUtils.ToolId.ARM_GCC];
		const availableCriticalTools = criticalTools.filter(toolId => {
			const result = installationResults[toolId];
			return result && (result.installed || result.supported);
		});

		console.log(`DEBUG: Available critical tools: ${availableCriticalTools.join(', ')}`);
		assert(availableCriticalTools.length >= 1, 'At least one critical tool should be available or installable');

		// Phase 2: ArduPilot Cloning using apCloneArdupilot
		console.log('DEBUG: Phase 2 - Checking/Cloning ArduPilot...');

		// Check if ArduPilot already exists
		if (fs.existsSync(ardupilotDir) && fs.existsSync(path.join(ardupilotDir, 'wscript'))) {
			console.log('DEBUG: ArduPilot already exists, skipping clone');

			// Add existing ArduPilot directory to workspace
			console.log('DEBUG: Adding existing ArduPilot directory to workspace...');
			const ardupilotUri = vscode.Uri.file(ardupilotDir);
			vscode.workspace.updateWorkspaceFolders(
				vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0,
				null,
				{ uri: ardupilotUri }
			);
			// await for 10s
			await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
			console.log(`DEBUG: Added ${ardupilotDir} to workspace`);
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
			// Don't mock updateWorkspaceFolders - let it work normally to properly add workspace folder

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
			CloneArdupilot.run();

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

			assert(cloneSuccess, 'ArduPilot repository should clone successfully');
		}

		// Verify ArduPilot directory exists regardless of whether we cloned or used existing
		assert(fs.existsSync(ardupilotDir), 'ArduPilot directory should exist');
		assert(fs.existsSync(path.join(ardupilotDir, 'wscript')), 'ArduPilot wscript should exist');
		console.log('DEBUG: ArduPilot directory verified');

		// Phase 2.5: Python Virtual Environment Setup
		console.log('DEBUG: Phase 2.5 - Setting up Python virtual environment...');

		const venvPath = path.join(ardupilotDir, '.venv');
		if (!fs.existsSync(venvPath)) {
			console.log('DEBUG: Creating Python virtual environment using Python tool...');

			try {
				// Create virtual environment using Python tool directly
				await new Promise<void>((resolve) => {
					console.log(`DEBUG: Running: python3 -m venv ${venvPath}`);
					const venvProcess = spawn('python3', ['-m', 'venv', venvPath], {
						cwd: ardupilotDir,
						stdio: 'pipe'
					});

					venvProcess.stdout?.on('data', (data: any) => {
						console.log(`DEBUG: [VENV STDOUT] ${data.toString()}`);
					});

					venvProcess.stderr?.on('data', (data: any) => {
						console.log(`DEBUG: [VENV STDERR] ${data.toString()}`);
					});

					venvProcess.on('close', (code: number | null) => {
						if (code === 0) {
							console.log('DEBUG: Python virtual environment created successfully');
							resolve();
						} else {
							console.log(`DEBUG: Virtual environment creation failed with code ${code}, but continuing...`);
							resolve(); // Don't fail the test for venv issues
						}
					});

					venvProcess.on('error', (err: Error) => {
						console.log(`DEBUG: Virtual environment creation error: ${err.message}, but continuing...`);
						resolve(); // Don't fail the test for venv issues
					});

					// Timeout after 30 seconds
					setTimeout(() => {
						venvProcess.kill();
						console.log('DEBUG: Virtual environment creation timed out, but continuing...');
						resolve();
					}, 30000);
				});
			} catch (error) {
				console.log(`DEBUG: Python virtual environment setup failed: ${error}, but continuing...`);
			}
		} else {
			console.log('DEBUG: Virtual environment already exists, skipping creation');
		}
		try {
			// Verify virtual environment was created
			if (fs.existsSync(venvPath)) {
				console.log(`DEBUG: Virtual environment verified at ${venvPath}`);

				// Try to set the Python interpreter for the workspace using VS Code Python extension API
				try {
					const pythonExtension = vscode.extensions.getExtension('ms-python.python');
					if (pythonExtension) {
						await pythonExtension.activate();
						console.log('DEBUG: Python extension activated successfully');

						// Set the Python interpreter to the virtual environment
						const pythonPath = path.join(venvPath, 'bin', 'python');
						const workspaceUri = vscode.Uri.file(ardupilotDir);

						try {
							console.log('DEBUG: Setting up VS Code Python extension interpreter selection mock');

							// Mock the Python extension's setInterpreter command directly
							// This bypasses the UI completely and sets the interpreter directly
							const originalExecuteCommand = vscode.commands.executeCommand;
							const mockExecuteCommand = sandbox.stub(vscode.commands, 'executeCommand').callsFake(async (command: string, ...args: any[]) => {
								if (command === 'python.setInterpreter') {
									console.log('DEBUG: Intercepted python.setInterpreter command');

									// Directly set the Python path in workspace configuration using the correct setting
									const config = vscode.workspace.getConfiguration('python', workspaceUri);
									await config.update('defaultInterpreterPath', pythonPath, vscode.ConfigurationTarget.WorkspaceFolder);
									console.log(`DEBUG: Directly set Python interpreter to: ${pythonPath}`);

									return Promise.resolve();
								}
								// For all other commands, call the original
								return originalExecuteCommand.apply(vscode.commands, [command, ...args]);
							});

							// Execute the setInterpreter command (now mocked)
							console.log('DEBUG: Executing mocked python.setInterpreter command');
							await vscode.commands.executeCommand('python.setInterpreter');

							// Verify the interpreter was set
							const config = vscode.workspace.getConfiguration('python', workspaceUri);
							const currentPythonPath = config.get('defaultInterpreterPath');
							console.log(`DEBUG: Current python path after command: ${currentPythonPath}`);

							// Restore the mock
							mockExecuteCommand.restore();

							console.log('DEBUG: Python interpreter selection completed successfully');

						} catch (setError) {
							console.log(`DEBUG: Failed to set interpreter via command: ${setError}`);

							// Fallback: Try to update the workspace configuration directly
							const config = vscode.workspace.getConfiguration('python', workspaceUri);
							await config.update('defaultInterpreterPath', pythonPath, vscode.ConfigurationTarget.WorkspaceFolder);
							console.log(`DEBUG: Set interpreter via workspace config fallback: ${pythonPath}`);
						}
					}
					console.log('DEBUG: Virtual environment created and configured');
				} catch (error) {
					console.log(`DEBUG: Failed to configure Python interpreter: ${error}, but continuing...`);
				}
			} else {
				console.log('DEBUG: Virtual environment creation verification failed, but continuing...');
			}
		} catch (error) {
			console.log(`DEBUG: Python virtual environment setup failed: ${error}, but continuing...`);
		}

		// Install Python packages in the virtual environment
		try {
			await ValidateEnvironmentPanel.installPythonPackages();
			console.log('DEBUG: Python packages installation initiated');
		} catch (error) {
			console.log(`DEBUG: Python packages installation failed: ${error}, but continuing...`);
		}

		// Phase 3: Build Testing using vscode.tasks.executeTask
		console.log('DEBUG: Phase 3 - Testing ArduPilot builds using vscode.tasks.executeTask...');

		// Helper function to wait for directory deletion with timeout
		const waitForDirectoryDeletion = async (dirPath: string, timeoutMs: number = 30000): Promise<boolean> => {
			const startTime = Date.now();
			while (fs.existsSync(dirPath) && (Date.now() - startTime) < timeoutMs) {
				console.log(`DEBUG: Waiting for directory deletion: ${dirPath}`);
				await new Promise(resolve => setTimeout(resolve, 1000)); // Check every millisecond
			}
			return !fs.existsSync(dirPath);
		};

		// Helper function to wait for file creation with timeout
		const waitForFileCreation = async (filePath: string, timeoutMs: number = 120000): Promise<boolean> => {
			const startTime = Date.now();
			while (!fs.existsSync(filePath) && (Date.now() - startTime) < timeoutMs) {
				await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
			}
			return fs.existsSync(filePath);
		};

		// Helper function to execute a task using vscode.tasks.executeTask
		const executeTask = async (task: vscode.Task, taskName: string): Promise<boolean> => {
			return new Promise<boolean>((resolve) => {
				console.log(`DEBUG: Executing task: ${taskName}`);
				console.log(`DEBUG: Task configName: ${task.definition.configName}`);

				// Set the pseudo-terminal for output capture
				task.presentationOptions = {
					echo: true,
					reveal: vscode.TaskRevealKind.Always,
					focus: false,
					panel: vscode.TaskPanelKind.Dedicated,
					showReuseMessage: false,
					clear: false
				};

				let isResolved = false;
				const expectedConfigName = task.definition.configName;

				const cleanupAndResolve = (result: boolean, reason: string) => {
					if (isResolved) {
						return;
					}
					isResolved = true;
					console.log(`DEBUG: Task ${taskName} (${expectedConfigName}) completing: ${reason}`);
					resolve(result);
				};

				// Execute the task using vscode.tasks.executeTask (returns Thenable<TaskExecution>)
				Promise.resolve(vscode.tasks.executeTask(task)).then((execution) => {
					console.log(`DEBUG: Task ${taskName} started, actual name: ${execution.task.name}, configName: ${execution.task.definition.configName}`);

					// Listen for task process completion - this is the most reliable for ArduPilot tasks
					const processEndDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
						// Match by configName from task definition (as per taskProvider.ts implementation)
						const taskMatches = event.execution.task.definition.configName === expectedConfigName;

						if (taskMatches) {
							console.log(`DEBUG: Task ${taskName} (${expectedConfigName}) process ended with exit code: ${event.exitCode}`);
							processEndDisposable.dispose();
							cleanupAndResolve(event.exitCode === 0, `process ended with code ${event.exitCode}`);
						}
					});

					// Timeout for task execution (8 minutes for build tasks)
					setTimeout(() => {
						processEndDisposable.dispose();
						cleanupAndResolve(false, 'timeout after 8 minutes');
					}, 480000);

				}).catch((error: unknown) => {
					console.error(`DEBUG: Failed to execute task ${taskName}: ${error}`);
					cleanupAndResolve(false, `execution error: ${error}`);
				});
			});
		};

		// Test SITL build task with cleanup
		console.log('DEBUG: Testing SITL build task...');

		// Clean up previous SITL build configuration and wait for directory deletion
		console.log('DEBUG: Deleting previous SITL task configuration...');
		APTaskProvider.delete('sitl-copter');
		const sitlBuildRoot = path.join(ardupilotDir, 'build', 'sitl');
		const sitlDeleted = await waitForDirectoryDeletion(sitlBuildRoot, 3000);
		console.log(`DEBUG: SITL build directory deleted: ${sitlDeleted} (${sitlBuildRoot})`);
		const sitlTask = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
		if (!sitlTask) {
			throw new Error('Failed to create SITL task');
		}

		const sitlBuildSuccess = await executeTask(sitlTask, 'SITL Build');
		assert(sitlBuildSuccess, 'SITL build task should succeed');
		console.log('DEBUG: SITL build task completed successfully');

		// Verify SITL build artifacts are created with timeout
		const sitlBuildDir = path.join(ardupilotDir, 'build', 'sitl', 'bin');
		const sitlBinary = path.join(sitlBuildDir, 'arducopter');
		console.log(`DEBUG: Waiting for SITL binary creation at ${sitlBinary}...`);
		const sitlCreated = await waitForFileCreation(sitlBinary, 120000); // 2 minute timeout
		console.log(`DEBUG: SITL binary created: ${sitlCreated} (${sitlBinary})`);
		assert(sitlCreated, `SITL binary should be created at ${sitlBinary} within timeout`);

		// Test CubeOrange+ build task with cleanup
		console.log('DEBUG: Testing CubeOrange+ build task...');

		// Clean up previous CubeOrange build configuration and wait for directory deletion
		console.log('DEBUG: Deleting previous CubeOrange task configuration...');
		APTaskProvider.delete('cubeorange-copter');
		const cubeOrangeBuildRoot = path.join(ardupilotDir, 'build', 'CubeOrange');
		const cubeOrangeDeleted = await waitForDirectoryDeletion(cubeOrangeBuildRoot, 3000);
		console.log(`DEBUG: CubeOrange build directory deleted: ${cubeOrangeDeleted} (${cubeOrangeBuildRoot})`);

		const cubeOrangeTask = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'copter', 'cubeorange-copter');
		if (!cubeOrangeTask) {
			throw new Error('Failed to create CubeOrange+ task');
		}

		const cubeOrangeBuildSuccess = await executeTask(cubeOrangeTask, 'CubeOrange+ Build');
		assert(cubeOrangeBuildSuccess, 'CubeOrange+ build task should succeed');
		console.log('DEBUG: CubeOrange+ build task completed successfully');

		// Verify CubeOrange+ build artifacts are created with timeout
		const cubeOrangeBuildDir = path.join(ardupilotDir, 'build', 'CubeOrange', 'bin');
		const cubeOrangeFirmware = path.join(cubeOrangeBuildDir, 'arducopter.apj');
		console.log(`DEBUG: Waiting for CubeOrange+ firmware creation at ${cubeOrangeFirmware}...`);
		const cubeOrangeCreated = await waitForFileCreation(cubeOrangeFirmware, 120000); // 2 minute timeout
		console.log(`DEBUG: CubeOrange+ firmware created: ${cubeOrangeCreated} (${cubeOrangeFirmware})`);
		assert(cubeOrangeCreated, `CubeOrange+ firmware should be created at ${cubeOrangeFirmware} within timeout`);

		console.log('DEBUG: Build artifact verification completed with timeout-based detection');

		console.log('DEBUG: E2E test completed successfully - all phases passed');
	});
});

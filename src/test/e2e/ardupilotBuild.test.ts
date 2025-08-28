/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as sinon from 'sinon';
import { spawn } from 'child_process';
import { APExtensionContext } from '../../extension';
import { APTaskProvider } from '../../taskProvider';
import { apLog } from '../../apLog';
import { ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { getApExtApi } from '../suite/common';
import { ProgramUtils } from '../../apProgramUtils';

suite('E2E: ArduPilot Build', function() {
	// Extended timeout for actual builds
	this.timeout(1800000); // 30 minutes

	let apExtensionContext: APExtensionContext;
	let tempDir: string;
	let ardupilotDir: string;
	let sandbox: sinon.SinonSandbox;
	let shellExecutionDisposable: vscode.Disposable | undefined;
	let shellCompletionDisposable: vscode.Disposable | undefined;
	const globalTerminalOutputBuffer: string[] = [];

	suiteSetup(async () => {
		sandbox = sinon.createSandbox();

		// Enable terminal shell integration for terminal output capture
		console.log('DEBUG: Enabling terminal shell integration...');
		const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
		await terminalConfig.update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Global);
		console.log('DEBUG: Terminal shell integration enabled successfully');

		// Verify the setting was applied
		const currentSetting = terminalConfig.get('shellIntegration.enabled');
		if (!currentSetting) {
			throw new Error('Failed to enable terminal shell integration - setting not applied');
		}

		// Set up global terminal shell execution monitoring
		try {
			// Listen for terminal shell execution events
			shellExecutionDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
				const execution = event.execution;
				console.log(`Global terminal shell execution started: ${execution.commandLine.value}`);

				try {
					// Read the output stream
					const stream = execution.read();

					// Process the stream data using async iterator
					const processStream = async () => {
						try {
							for await (const data of stream) {
								const output = data.toString();
								console.log(`[TERMINAL: ${event.terminal.name}] ${output.trim()}`);
								globalTerminalOutputBuffer.push(output.trim());

								// Also redirect to extension logger
								apLog.channel.appendLine(`[BUILD] ${output.trim()}`);
							}
						} catch (streamError) {
							console.log(`Error processing stream data: ${streamError}`);
						}
					};

					// Start processing stream in background
					processStream().catch(error => {
						console.log(`Stream processing error: ${error}`);
					});
				} catch (error) {
					console.log(`Error reading terminal stream: ${error}`);
				}
			});

			// Listen for when commands complete
			shellCompletionDisposable = vscode.window.onDidEndTerminalShellExecution((event) => {
				console.log(`Global terminal command finished with exit code: ${event.exitCode}`);
				console.log(`Command: ${event.execution.commandLine.value}`);
			});

			console.log('DEBUG: Global terminal shell execution monitoring enabled');
		} catch (error) {
			console.log(`Global terminal shell execution setup failed: ${error}`);
		}

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

		console.log('DEBUG: Starting E2E build test suite setup...');
		apExtensionContext = await getApExtApi(false);
		assert.ok(apExtensionContext.apWelcomeProviderInstance, 'Extension context should be available');

		// Use existing ardupilot-e2e directory from clone test
		tempDir = path.join(os.tmpdir(), 'ardupilot-e2e');
		ardupilotDir = path.join(tempDir, 'ardupilot');

		// Verify ArduPilot directory exists from previous clone test
		assert.ok(fs.existsSync(ardupilotDir), 'ArduPilot directory should exist from clone test');
		assert.ok(fs.existsSync(path.join(ardupilotDir, 'wscript')), 'ArduPilot wscript should exist from clone test');
		console.log('DEBUG: ArduPilot directory verified from clone test');
	});

	teardown(() => {
		// Clean up global shell execution listeners
		if (shellExecutionDisposable) {
			shellExecutionDisposable.dispose();
			shellExecutionDisposable = undefined;
		}
		if (shellCompletionDisposable) {
			shellCompletionDisposable.dispose();
			shellCompletionDisposable = undefined;
		}

		sandbox.restore();
	});

	suiteTeardown(() => {
		console.log('DEBUG: E2E build test cleanup...');
		// Keep the persistent ardupilot-e2e directory for future test runs
		console.log(`DEBUG: Preserving temp directory for future runs: ${tempDir}`);
	});

	test('ArduPilot SITL and CubeOrange+ Build', async function() {
		console.log('DEBUG: Starting E2E test - ArduPilot SITL and CubeOrange+ Build');

		// Phase 1: Python Virtual Environment Setup
		console.log('DEBUG: Phase 1 - Setting up Python virtual environment...');

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

					// Timeout after 60 seconds
					setTimeout(() => {
						venvProcess.kill();
						console.log('DEBUG: Virtual environment creation timed out, but continuing...');
						resolve();
					}, 60000);
					console.log(`DEBUG: Spawned venv process with PID: ${venvProcess.pid}`);
				});
			} catch (error) {
				console.log(`DEBUG: Python virtual environment setup failed: ${error}, but continuing...`);
			}
		} else {
			console.log('DEBUG: Virtual environment already exists, skipping creation');
		}

		// Set Python interpreter by directly updating configuration (more reliable for E2E tests)
		try {
			if (fs.existsSync(venvPath)) {
				const pythonPath = path.join(venvPath, 'bin', 'python');
				console.log(`DEBUG: Setting Python interpreter to: ${pythonPath}`);
				console.log(`DEBUG: Workspace root: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown'}`);

				// Directly update the workspace configuration to set the Python interpreter
				// This is more reliable for E2E tests than trying to mock the complex QuickPick UI
				try {
					const workspaceUri = vscode.Uri.file(ardupilotDir);
					const config = vscode.workspace.getConfiguration('python', workspaceUri);
					await config.update('defaultInterpreterPath', pythonPath, vscode.ConfigurationTarget.WorkspaceFolder);
					console.log(`DEBUG: Successfully set Python interpreter to: ${pythonPath}`);

					// Verify the interpreter was set
					const currentPythonPath = config.get('defaultInterpreterPath');
					console.log(`DEBUG: Current python interpreter after setting: ${currentPythonPath}`);

					// Also try to activate the Python extension to ensure it picks up the new interpreter
					const pythonExtension = vscode.extensions.getExtension('ms-python.python');
					if (pythonExtension) {
						await pythonExtension.activate();
						console.log('DEBUG: Python extension activated successfully');

						// Trigger a refresh of the Python environments if the API is available
						try {
							const pythonApi = pythonExtension.exports;
							if (pythonApi && typeof pythonApi.environments?.refreshEnvironments === 'function') {
								await pythonApi.environments.refreshEnvironments();
								console.log('DEBUG: Triggered Python environments refresh');
							}
						} catch (refreshError) {
							console.log(`DEBUG: Failed to refresh Python environments: ${refreshError}, but continuing...`);
						}
					}

					console.log('DEBUG: Python interpreter configuration completed successfully');
				} catch (configError) {
					console.log(`DEBUG: Failed to set interpreter via workspace config: ${configError}`);
				}
			} else {
				console.log('DEBUG: Virtual environment verification failed, but continuing...');
			}
		} catch (error) {
			console.log(`DEBUG: Python interpreter setup failed: ${error}, but continuing...`);
		}

		// Install Python packages in the virtual environment and wait for completion
		try {
			console.log('DEBUG: Starting Python packages installation...');
			await ValidateEnvironmentPanel.installPythonPackages();
			console.log('DEBUG: Python packages installation completed successfully');
		} catch (error) {
			console.log(`DEBUG: Python packages installation failed: ${error}`);
			throw new Error(`Python packages installation failed: ${error}`);
		}

		// Verify that critical packages are available before proceeding
		console.log('DEBUG: Verifying Python packages are available...');
		const packageStatus = await ProgramUtils.checkAllPythonPackages();
		const dronecanStatus = packageStatus.find(pkg => pkg.packageName === 'dronecan');
		if (!dronecanStatus || !dronecanStatus.result.available) {
			throw new Error(`DroneCAN package not available: ${dronecanStatus?.result.info || 'Package not found'}`);
		}
		console.log('DEBUG: DroneCAN package verified as available');

		// Phase 2: Build Testing using vscode.tasks.executeTask
		console.log('DEBUG: Phase 2 - Testing ArduPilot builds using vscode.tasks.executeTask...');

		// Helper function to wait for directory deletion with timeout
		const waitForDirectoryDeletion = async (dirPath: string, timeoutMs: number = 30000): Promise<boolean> => {
			const startTime = Date.now();
			while (fs.existsSync(dirPath) && (Date.now() - startTime) < timeoutMs) {
				console.log(`DEBUG: Waiting for directory deletion: ${dirPath}`);
				await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
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

		// Helper function to execute a task using vscode.tasks.executeTask with terminal output capture
		console.log(`DEBUG: Python packages status: ${JSON.stringify(await ProgramUtils.checkAllPythonPackages())}`);

		const executeTask = async (task: vscode.Task, taskName: string): Promise<boolean> => {
			return new Promise<boolean>((resolve) => {
				console.log(`DEBUG: Executing task: ${taskName}`);
				console.log(`DEBUG: Task configName: ${task.definition.configName}`);
				console.log(`Starting ${taskName} task execution`);

				// Log task execution details
				console.log(`Task details - Name: ${task.name}, Type: ${task.definition.type}, Config: ${task.definition.configName}`);

				// Set the task presentation options
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
				let taskTerminal: vscode.Terminal | undefined;

				// Terminal monitoring is now handled by apTerminalMonitor

				const cleanupAndResolve = (result: boolean, reason: string) => {
					if (isResolved) {
						return;
					}
					isResolved = true;
					console.log(`DEBUG: Task ${taskName} (${expectedConfigName}) completing: ${reason}`);

					// Terminal monitoring cleanup is handled automatically by apTerminalMonitor

					resolve(result);
				};

				// Execute the task using vscode.tasks.executeTask (returns Thenable<TaskExecution>)
				Promise.resolve(vscode.tasks.executeTask(task)).then((execution) => {
					console.log(`DEBUG: Task ${taskName} started, actual name: ${execution.task.name}, configName: ${execution.task.definition.configName}`);

					// Try to find the terminal associated with this task
					setTimeout(() => {
						// Give the task time to create its terminal, then try to find it
						const matchingTerminals = vscode.window.terminals.filter(terminal =>
							terminal.name.includes(expectedConfigName) ||
							terminal.name.includes(taskName) ||
							terminal.name.includes(task.name)
						);

						if (matchingTerminals.length > 0) {
							taskTerminal = matchingTerminals[0];
							console.log(`DEBUG: Found task terminal: ${taskTerminal.name}`);
							// print shellIntegration enabled status
							console.log(`DEBUG: Terminal shell integration enabled: ${JSON.stringify(taskTerminal.shellIntegration)}`);
						} else {
							console.log('DEBUG: No matching terminal found, will capture based on name matching');
						}
					}, 1000); // Wait 1 second for terminal to be created

					// Listen for task process completion - this is the most reliable for ArduPilot tasks
					const processEndDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
						// Match by configName from task definition (as per taskProvider.ts implementation)
						const taskMatches = event.execution.task.definition.configName === expectedConfigName;

						if (taskMatches) {
							console.log(`DEBUG: Task ${taskName} (${expectedConfigName}) process ended with exit code: ${event.exitCode}`);

							// Log the captured terminal output buffer if any
							if (globalTerminalOutputBuffer.length > 0) {
								console.log(`Global terminal output buffer (${globalTerminalOutputBuffer.length} entries):`);
								const taskRelevantOutput = globalTerminalOutputBuffer.filter(line =>
									line.includes(expectedConfigName) ||
									line.includes(taskName) ||
									line.includes('waf') ||
									line.includes('configure') ||
									line.includes('build')
								);

								if (taskRelevantOutput.length > 0) {
									console.log(`Task-relevant output (${taskRelevantOutput.length} entries):`);
									taskRelevantOutput.forEach((line, index) => {
										console.log(`[${index}] ${line}`);
									});
								}
							}

							// Cleanup disposables
							processEndDisposable.dispose();
							cleanupAndResolve(event.exitCode === 0, `process ended with code ${event.exitCode}`);
						}
					});

					// Monitor task execution progress and log key events
					const outputMonitorInterval = setInterval(() => {
						// Log terminal monitoring status
						const relevantTerminals = vscode.window.terminals.filter(terminal =>
							terminal.name.includes(expectedConfigName) || terminal.name.includes(taskName)
						);

						if (relevantTerminals.length > 0) {
							relevantTerminals.forEach(terminal => {
								console.log(`DEBUG: Monitoring terminal: ${terminal.name}`);
							});
						}

						// Log workspace build directory status if it exists
						const buildDir = path.join(ardupilotDir, 'build');
						if (fs.existsSync(buildDir)) {
							try {
								const buildDirs = fs.readdirSync(buildDir).filter(item =>
									fs.statSync(path.join(buildDir, item)).isDirectory()
								);
								if (buildDirs.length > 0) {
									console.log(`Build directories: ${buildDirs.join(', ')}`);
								}
							} catch (error) {
								console.log(`DEBUG: Error checking build directory: ${error}`);
							}
						}
					}, 10000); // Check every 10 seconds to avoid spam

					// Timeout for task execution (15 minutes for build tasks)
					setTimeout(() => {
						clearInterval(outputMonitorInterval);
						processEndDisposable.dispose();
						cleanupAndResolve(false, 'timeout after 30 minutes');
					}, 1800000);

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
		const sitlTask = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
		if (!sitlTask) {
			throw new Error('Failed to create SITL task');
		}

		// Wait a brief moment for VS Code to settle after package installation
		await new Promise(resolve => setTimeout(resolve, 5000));
		const sitlBuildSuccess = await executeTask(sitlTask, 'SITL Build');
		assert.ok(sitlBuildSuccess, 'SITL build task should succeed');
		console.log('DEBUG: SITL build task completed successfully');

		// Verify SITL build artifacts are created with timeout
		const sitlBuildDir = path.join(ardupilotDir, 'build', 'sitl', 'bin');
		const sitlBinary = path.join(sitlBuildDir, 'arducopter');
		console.log(`DEBUG: Waiting for SITL binary creation at ${sitlBinary}...`);
		const sitlCreated = await waitForFileCreation(sitlBinary, 1200000); // 20 minute timeout
		console.log(`DEBUG: SITL binary created: ${sitlCreated} (${sitlBinary})`);
		assert.ok(sitlCreated, `SITL binary should be created at ${sitlBinary} within timeout`);

		// Test CubeOrange+ build task with cleanup
		console.log('DEBUG: Testing CubeOrange+ build task...');

		// Clean up previous CubeOrange build configuration and wait for directory deletion
		console.log('DEBUG: Deleting previous CubeOrange task configuration...');
		APTaskProvider.delete('cubeorange-copter');
		const cubeOrangeBuildRoot = path.join(ardupilotDir, 'build', 'CubeOrange');
		const cubeOrangeDeleted = await waitForDirectoryDeletion(cubeOrangeBuildRoot, 3000);
		console.log(`DEBUG: CubeOrange build directory deleted: ${cubeOrangeDeleted} (${cubeOrangeBuildRoot})`);

		const cubeOrangeTask = await APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'copter', 'cubeorange-copter');
		if (!cubeOrangeTask) {
			throw new Error('Failed to create CubeOrange+ task');
		}

		const cubeOrangeBuildSuccess = await executeTask(cubeOrangeTask, 'CubeOrange+ Build');
		assert.ok(cubeOrangeBuildSuccess, 'CubeOrange+ build task should succeed');
		console.log('DEBUG: CubeOrange+ build task completed successfully');

		// Verify CubeOrange+ build artifacts are created with timeout
		const cubeOrangeBuildDir = path.join(ardupilotDir, 'build', 'CubeOrange', 'bin');
		const cubeOrangeFirmware = path.join(cubeOrangeBuildDir, 'arducopter.apj');
		console.log(`DEBUG: Waiting for CubeOrange+ firmware creation at ${cubeOrangeFirmware}...`);
		const cubeOrangeCreated = await waitForFileCreation(cubeOrangeFirmware, 1200000); // 20 minute timeout
		console.log(`DEBUG: CubeOrange+ firmware created: ${cubeOrangeCreated} (${cubeOrangeFirmware})`);
		assert.ok(cubeOrangeCreated, `CubeOrange+ firmware should be created at ${cubeOrangeFirmware} within timeout`);

		console.log('DEBUG: Build artifact verification completed with timeout-based detection');

		console.log('DEBUG: E2E build test completed successfully - all phases passed');
	});
});

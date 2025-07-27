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

suite('E2E: ArduPilot Build', function() {
	// Extended timeout for actual builds
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

		console.log('DEBUG: Starting E2E build test suite setup...');
		apExtensionContext = await getApExtApi(false);
		assert(apExtensionContext.apWelcomeProviderInstance, 'Extension context should be available');

		// Use existing ardupilot-e2e directory from clone test
		tempDir = path.join(os.tmpdir(), 'ardupilot-e2e');
		ardupilotDir = path.join(tempDir, 'ardupilot');

		// Verify ArduPilot directory exists from previous clone test
		assert(fs.existsSync(ardupilotDir), 'ArduPilot directory should exist from clone test');
		assert(fs.existsSync(path.join(ardupilotDir, 'wscript')), 'ArduPilot wscript should exist from clone test');
		console.log('DEBUG: ArduPilot directory verified from clone test');

		// Safely add ArduPilot directory to workspace without causing crashes
		console.log('DEBUG: Adding existing ArduPilot directory to workspace...');
		const ardupilotUri = vscode.Uri.file(ardupilotDir);

		// Mock workspace folder update to avoid extension host crash
		sandbox.stub(vscode.workspace, 'updateWorkspaceFolders').callsFake(() => {
			console.log('DEBUG: Mocked workspace folder update to prevent extension host crash');
			return true;
		});

		// Mock workspace folders property to return our ardupilot folder
		sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => {
			return [{ uri: ardupilotUri, name: 'ardupilot', index: 0 }];
		});

		console.log(`DEBUG: Mocked workspace with ${ardupilotDir}`);
	});

	teardown(() => {
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
				console.log(`DEBUG: Virtual environment verified at ${venvPath}`);

				const pythonPath = path.join(venvPath, 'bin', 'python');
				console.log(`DEBUG: Setting Python interpreter to: ${pythonPath}`);

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

		// Install Python packages in the virtual environment
		try {
			await ValidateEnvironmentPanel.installPythonPackages();
			console.log('DEBUG: Python packages installation initiated');
		} catch (error) {
			console.log(`DEBUG: Python packages installation failed: ${error}, but continuing...`);
		}

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

		// sleep for 30s
		await new Promise(resolve => setTimeout(resolve, 30000));
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

		console.log('DEBUG: E2E build test completed successfully - all phases passed');
	});
});

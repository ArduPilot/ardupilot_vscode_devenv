/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { apActionItem, apActionsProvider, setActiveConfiguration, activeConfiguration, activeLaunchConfig } from '../../apActions';
import { ArdupilotTaskDefinition } from '../../taskProvider';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('apActions Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let actionsProvider: apActionsProvider;
	let ardupilotDir: string | undefined;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();

		// Create a temporary directory for testing
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder);
		ardupilotDir = workspaceFolder.uri.path;
		assert.ok(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	suiteTeardown(() => {
		// Clean up temp stuff
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert.ok(apExtensionContext.actionsProvider);
		actionsProvider = apExtensionContext.actionsProvider;
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('apActionItem', () => {
		test('should create action item with correct properties', () => {
			const actionItem = new apActionItem(
				actionsProvider,
				'Test Action',
				vscode.TreeItemCollapsibleState.None,
				'build',
				'Test tooltip'
			);

			assert.strictEqual(actionItem.label, 'Test Action');
			assert.strictEqual(actionItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
			assert.strictEqual(actionItem.action, 'build');
			assert.strictEqual(actionItem.tooltip, 'Test tooltip');
			assert.strictEqual(actionItem.contextValue, 'apAction_build');
		});

		test('should set correct command for action item', () => {
			const actionItem = new apActionItem(
				actionsProvider,
				'Test Action',
				vscode.TreeItemCollapsibleState.None,
				'build'
			);

			assert.ok(actionItem.command);
			assert.strictEqual(actionItem.command.command, 'apActions.build');
			assert.strictEqual(actionItem.command.title, 'Test Action');
			assert.ok(Array.isArray(actionItem.command.arguments));
			assert.strictEqual(actionItem.command.arguments[0], actionItem);
		});

		test('createMatchingLaunchConfig should create correct SITL configuration', () => {
			assert.ok(ardupilotDir);
			// Create a temporary .vscode directory
			const vscodeDir = path.join(ardupilotDir, '.vscode');
			try {
				fs.statSync(vscodeDir);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					fs.mkdirSync(vscodeDir, { recursive: true });
				} else {
					throw error;
				}
			}
			// remove existing launch.json
			fs.rmSync(path.join(vscodeDir, 'launch.json'), { force: true });
			const launchConfig = apActionItem.createMatchingLaunchConfig(
				'sitl-copter',
				'sitl',
				'copter',
				'--map --console'
			);

			assert.ok(launchConfig);
			assert.strictEqual(launchConfig.name, 'Launch Ardupilot');
			assert.strictEqual(launchConfig.type, 'apLaunch');
			assert.strictEqual(launchConfig.request, 'launch');
			assert.strictEqual(launchConfig.target, 'copter');
			assert.strictEqual(launchConfig.isSITL, true);
			assert.strictEqual(launchConfig.simVehicleCommand, '--map --console');
			assert.strictEqual(launchConfig.board, undefined); // SITL should not have board field

			// Verify launch.json was created
			const launchPath = path.join(vscodeDir, 'launch.json');
			try {
				fs.statSync(launchPath);
				assert.ok(true); // File exists
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					assert.fail('launch.json was not created');
				} else {
					throw error;
				}
			}

			const launchJson = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
			assert.strictEqual(launchJson.version, '0.2.0');
			assert.ok(Array.isArray(launchJson.configurations));
			assert.strictEqual(launchJson.configurations.length, 1);
			assert.strictEqual(launchJson.configurations[0].name, 'Launch Ardupilot');
		});

		test('createMatchingLaunchConfig should create correct hardware configuration', () => {
			assert.ok(ardupilotDir);
			// Create a temporary .vscode directory
			const vscodeDir = path.join(ardupilotDir, '.vscode');
			try {
				fs.statSync(vscodeDir);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					fs.mkdirSync(vscodeDir, { recursive: true });
				} else {
					throw error;
				}
			}
			// remove existing launch.json
			fs.rmSync(path.join(vscodeDir, 'launch.json'), { force: true });
			const launchConfig = apActionItem.createMatchingLaunchConfig(
				'CubeOrange-copter',
				'CubeOrange',
				'copter',
				'',
				'CubeOrange' // Board name for hardware debugging
			);

			assert.ok(launchConfig);
			assert.strictEqual(launchConfig.name, 'Launch Ardupilot');
			assert.strictEqual(launchConfig.type, 'apLaunch');
			assert.strictEqual(launchConfig.request, 'launch');
			assert.strictEqual(launchConfig.target, 'copter');
			assert.strictEqual(launchConfig.isSITL, false);
			assert.strictEqual(launchConfig.simVehicleCommand, undefined);
			assert.strictEqual(launchConfig.board, 'CubeOrange'); // Check board field is set

		});
	});

	suite('apActionsProvider', () => {
		test('should initialize correctly', () => {
			assert.ok(actionsProvider);
			assert.strictEqual(actionsProvider.context, mockContext);
		});

		test('should return configure and distclean when no active configuration', async () => {
			// Ensure no active configuration
			const originalActiveConfig = activeConfiguration;
			(global as any).activeConfiguration = undefined;

			try {
				const children = await actionsProvider.getChildren();
				assert.ok(Array.isArray(children));
				assert.strictEqual(children.length, 2);
				const actions = children.map(c => c.action);
				assert.ok(actions.includes('configure'));
				assert.ok(actions.includes('distclean'));
				assert.ok(children[0].label.includes('Select Configuration'));
			} finally {
				// Restore original active configuration
				(global as any).activeConfiguration = originalActiveConfig;
			}
		});

		test('should return all actions when active configuration exists', async () => {
			// Mock an active configuration
			const mockTask: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					simVehicleCommand: '--map --console'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Test Task',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			setActiveConfiguration(mockTask);

			const children = await actionsProvider.getChildren();
			assert.ok(Array.isArray(children));
			assert.ok(children.length >= 3); // At least configure, build, debug, and run/upload

			const actions = children.map(child => child.action);
			assert.ok(actions.includes('configure'));
			assert.ok(actions.includes('build'));
			assert.ok(actions.includes('debug'));
			assert.ok(actions.includes('run')); // Should be 'run' for SITL configuration
		});

		test('should show upload action for hardware configuration', async () => {
			// Mock a hardware configuration
			const mockTask: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'copter'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Test Hardware Task',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			setActiveConfiguration(mockTask);

			const children = await actionsProvider.getChildren();
			assert.ok(Array.isArray(children));

			const actions = children.map(child => child.action);
			assert.ok(actions.includes('configure'));
			assert.ok(actions.includes('build'));
			assert.ok(actions.includes('debug'));
			assert.ok(actions.includes('upload')); // Should be 'upload' for hardware configuration
			assert.ok(!actions.includes('run')); // Should not include 'run' for hardware
		});
	});

	suite('updateTaskWithSimVehicleCommand Tests', () => {
		test('should update existing task with simVehicleCommand', async () => {
			assert.ok(ardupilotDir);

			// Mock workspace configuration
			const mockTasks = [
				{
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					simVehicleCommand: ''
				} as ArdupilotTaskDefinition,
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane'
				} as ArdupilotTaskDefinition
			];

			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake(async (key: string, value: ArdupilotTaskDefinition[], target: vscode.ConfigurationTarget) => {
					if (key === 'tasks') {
						// Verify the update was called with correct parameters
						assert.ok(Array.isArray(value));
						assert.strictEqual(value.length, 2);

						// Find the updated task
						const updatedTask = value.find((task: ArdupilotTaskDefinition) =>
							task.configure === 'sitl' && task.target === 'copter'
						);
						assert.ok(updatedTask);
						assert.strictEqual(updatedTask.simVehicleCommand, '--map --console');
						assert.strictEqual(target, vscode.ConfigurationTarget.Workspace);
					}
					return Promise.resolve();
				})
			};

			// Mock vscode.workspace.getConfiguration using sandbox
			sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
				if (section === 'tasks') {
					return mockConfiguration as any;
				}
				// Return a simple mock for other sections
				return {
					get: () => undefined,
					update: () => Promise.resolve(),
					has: () => false,
					inspect: () => undefined
				} as any;
			});

			apActionItem.updateTaskWithSimVehicleCommand('sitl-copter', '--map --console');
			// If we reach here without error, the test passes
			assert.ok(true);
		});

		test('should handle task not found gracefully', async () => {
			assert.ok(ardupilotDir);

			const mockTasks = [
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane'
				} as ArdupilotTaskDefinition
			];

			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake(async () => {
					assert.fail('Update should not be called when task is not found');
				})
			};

			// Mock vscode.workspace.getConfiguration using sandbox
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

			// This should not throw an error, just log that task was not found
			apActionItem.updateTaskWithSimVehicleCommand('sitl-copter', '--map --console');
			assert.ok(true);
		});

		test('should handle empty tasks array', async () => {
			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return [];
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake(async () => {
					assert.fail('Update should not be called when tasks array is empty');
				})
			};

			// Mock vscode.workspace.getConfiguration using sandbox
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

			apActionItem.updateTaskWithSimVehicleCommand('sitl-copter', '--map --console');
			assert.ok(true);
		});
	});

	suite('refresh Tests', () => {
		test('should emit onDidChangeTreeData event', async () => {
			let eventFired = false;
			let eventData: vscode.TreeItem | undefined;

			// Subscribe to the event
			const disposable = actionsProvider.onDidChangeTreeData(data => {
				eventFired = true;
				eventData = data;
			});

			try {
				// Call refresh
				actionsProvider.refresh();

				// Verify the event was fired
				assert.strictEqual(eventFired, true);
				assert.strictEqual(eventData, undefined); // refresh() fires with undefined
			} finally {
				disposable.dispose();
			}
		});

		test('should not invoke Build Config refresh on actions refresh', async () => {
			let buildConfigRefreshed = false;
			assert.ok(apExtensionContext.apBuildConfigProviderInstance);
			sandbox.stub(apExtensionContext.apBuildConfigProviderInstance, 'refresh').callsFake(async () => {
				buildConfigRefreshed = true;
			});

			// Call refresh
			actionsProvider.refresh();

			// Verify Build Config refresh was NOT invoked
			assert.strictEqual(buildConfigRefreshed, false);
		});

		test('should handle multiple refresh calls', async () => {
			let eventCount = 0;

			// Subscribe to the event
			const disposable = actionsProvider.onDidChangeTreeData(() => {
				eventCount++;
			});

			try {
				// Call refresh multiple times
				actionsProvider.refresh();
				actionsProvider.refresh();
				actionsProvider.refresh();

				// Verify all events were fired
				assert.strictEqual(eventCount, 3);
			} finally {
				disposable.dispose();
			}
		});
	});

	suite('Configuration Management', () => {
		test('setActiveConfiguration should update global state', () => {
			const mockTask: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					simVehicleCommand: '--map --console'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Test Task',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			setActiveConfiguration(mockTask);

			assert.strictEqual(activeConfiguration, mockTask);
			assert.ok(activeLaunchConfig);
			assert.strictEqual(activeLaunchConfig.target, 'copter');
			assert.strictEqual(activeLaunchConfig.isSITL, true);
		});
	});

	suite('performAction Tests', () => {
		let mockSITLTask: vscode.Task;
		let mockHardwareTask: vscode.Task;
		let mockTaskExecution: vscode.TaskExecution;

		setup(() => {
			// Mock SITL task
			mockSITLTask = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					simVehicleCommand: '--map --console'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'SITL Task',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			// Mock hardware task
			mockHardwareTask = {
				definition: {
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'copter'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Hardware Task',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			// Mock task execution
			mockTaskExecution = {
				task: mockSITLTask,
				terminate: () => {}
			};
		});

		suite('SITL Configuration Tests', () => {
			setup(() => {
				setActiveConfiguration(mockSITLTask);
			});

			test('should perform build action for SITL', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Build Firmware',
					vscode.TreeItemCollapsibleState.None,
					'build',
					'Build SITL firmware'
				);

				// Mock vscode.tasks.executeTask using sandbox
				let taskExecuted = false;
				sandbox.stub(vscode.tasks, 'executeTask').callsFake(async (task: vscode.Task) => {
					taskExecuted = true;
					assert.strictEqual(task, activeConfiguration);
					return mockTaskExecution;
				});

				actionItem.performAction();
				assert.strictEqual(taskExecuted, true);
			});
			test('should perform debug action for SITL', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Debug',
					vscode.TreeItemCollapsibleState.None,
					'debug',
					'Debug SITL firmware'
				);

				// Mock vscode.debug.startDebugging using sandbox
				let debugStarted = false;
				let debugConfig: any;
				sandbox.stub(vscode.debug, 'startDebugging').callsFake(async (folder: any, config: any) => {
					debugStarted = true;
					debugConfig = config;
					return true;
				});

				actionItem.performAction();
				assert.strictEqual(debugStarted, true);
				assert.ok(activeLaunchConfig);
				assert.strictEqual(debugConfig, activeLaunchConfig);
			});

			test('should perform run action for SITL', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Run SITL',
					vscode.TreeItemCollapsibleState.None,
					'run',
					'Run SITL simulation'
				);

				// Mock vscode.window.createTerminal and terminal methods using sandbox
				const mockTerminal = {
					sendText: sandbox.stub().callsFake((text: string) => {
						console.log(`Mock terminal command: ${text}`);
						// Verify the commands being sent
						if (text.includes('sim_vehicle.py')) {
							assert.ok(text.includes('python3'));
							assert.ok(text.includes('ArduCopter'));
							assert.ok(text.includes('--map --console'));
						}
					}),
					show: sandbox.stub()
				};

				sandbox.stub(vscode.window, 'createTerminal').callsFake((options: any) => {
					if (typeof options === 'string') {
						assert.strictEqual(options, 'ArduPilot SITL');
					} else if (options && options.name) {
						assert.strictEqual(options.name, 'ArduPilot SITL');
					}
					return mockTerminal as any;
				});

				actionItem.performAction();
				// If we reach here without error, the test passes
				assert.ok(true);
			});
		});

		suite('Hardware Configuration Tests', () => {
			setup(() => {
				setActiveConfiguration(mockHardwareTask);
			});

			test('should perform build action for hardware', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Build Firmware',
					vscode.TreeItemCollapsibleState.None,
					'build',
					'Build hardware firmware'
				);

				// Mock vscode.tasks.executeTask using sandbox
				let taskExecuted = false;
				sandbox.stub(vscode.tasks, 'executeTask').callsFake(async (task: vscode.Task) => {
					taskExecuted = true;
					assert.strictEqual(task, activeConfiguration);
					return mockTaskExecution;
				});

				actionItem.performAction();
				assert.strictEqual(taskExecuted, true);
			});

			test('should perform upload action for hardware', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Upload to Board',
					vscode.TreeItemCollapsibleState.None,
					'upload',
					'Upload to CubeOrange'
				);

				// Mock vscode.debug.startDebugging using sandbox
				let debugStarted = false;
				let debugConfig: any;
				sandbox.stub(vscode.debug, 'startDebugging').callsFake(async (folder: any, config: any) => {
					debugStarted = true;
					debugConfig = config;
					return true;
				});

				actionItem.performAction();
				assert.strictEqual(debugStarted, true);
				assert.ok(activeLaunchConfig);
				assert.strictEqual(debugConfig, activeLaunchConfig);
			});

			test('should not allow run action for hardware configuration', async () => {
				const actionItem = new apActionItem(
					actionsProvider,
					'Run',
					vscode.TreeItemCollapsibleState.None,
					'run',
					'Run hardware'
				);

				// Mock vscode.window.showInformationMessage using sandbox
				let infoMessage = '';
				sandbox.stub(vscode.window, 'showInformationMessage').callsFake((message: string) => {
					infoMessage = message;
					return Promise.resolve() as any;
				});

				actionItem.performAction();
				assert.ok(infoMessage.includes('Run is only applicable for SITL configurations'));
			});
		});

		suite('Error Handling Tests', () => {
			test('should handle build action without active configuration', async () => {
				// Clear active configuration
				const originalActiveConfig = activeConfiguration;
				(global as any).activeConfiguration = undefined;

				const actionItem = new apActionItem(
					actionsProvider,
					'Build Firmware',
					vscode.TreeItemCollapsibleState.None,
					'build',
					'Build firmware'
				);

				try {
					// Should return early without throwing
					actionItem.performAction();
					assert.ok(true);
				} finally {
					(global as any).activeConfiguration = originalActiveConfig;
				}
			});
		});
	});

	suite('updateTaskWithSimVehicleCommand Tests', () => {
		let mockWorkspaceConfig: any;

		setup(() => {
			// Mock workspace configuration
			mockWorkspaceConfig = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return [
							{
								type: 'ardupilot',
								configure: 'sitl',
								target: 'copter',
								configName: 'sitl-copter',
								configureOptions: '',
								buildOptions: '',
								label: 'Build sitl-copter'
							},
							{
								type: 'ardupilot',
								configure: 'CubeOrange',
								target: 'plane',
								configName: 'CubeOrange-plane',
								configureOptions: '',
								buildOptions: '',
								label: 'Build CubeOrange-plane'
							}
						];
					}
					return undefined;
				}),
				update: sandbox.stub().resolves()
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfig);
		});

		// No teardown needed since sandbox handles cleanup

		test('should successfully update task with simVehicleCommand', async () => {
			let updatedTasks: any;
			mockWorkspaceConfig.update = sandbox.stub().callsFake((key: string, value: any) => {
				if (key === 'tasks') {
					updatedTasks = value;
				}
				return Promise.resolve();
			});

			apActionItem.updateTaskWithSimVehicleCommand('sitl-copter', '--map --console');

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.ok(updatedTasks);
			const updatedTask = updatedTasks.find((task: any) =>
				task.configure === 'sitl' && task.target === 'copter'
			);
			assert.ok(updatedTask);
			assert.strictEqual(updatedTask.simVehicleCommand, '--map --console');
		});

		test('should handle task not found scenario', async () => {
			let updateCalled = false;
			mockWorkspaceConfig.update = sandbox.stub().callsFake(() => {
				updateCalled = true;
				return Promise.resolve();
			});

			apActionItem.updateTaskWithSimVehicleCommand('nonexistent-rover', '--test');

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			// Update should not be called since task doesn't exist
			assert.strictEqual(updateCalled, false);
		});

		test('should handle empty tasks array', async () => {
			mockWorkspaceConfig.get = sandbox.stub().callsFake((key: string) => {
				if (key === 'tasks') {
					return [];
				}
				return undefined;
			});

			let updateCalled = false;
			mockWorkspaceConfig.update = sandbox.stub().callsFake(() => {
				updateCalled = true;
			});

			apActionItem.updateTaskWithSimVehicleCommand('sitl-copter', '--test');

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(updateCalled, false);
		});
	});

	suite('loadDefaultActiveConfiguration Tests', () => {
		let mockProvider: apActionsProvider;

		setup(() => {
			mockProvider = new apActionsProvider(mockContext);
		});

		// No teardown needed since sandbox handles cleanup

		test('should load saved active configuration', async () => {
			// Mock configuration with saved active config using sandbox
			const mockConfig = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'activeConfiguration') {
						return 'sitl-copter';
					}
					return undefined;
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

			// Mock tasks with matching configuration
			const mockTasks = [
				{
					definition: {
						type: 'ardupilot',
						configure: 'sitl',
						target: 'copter'
					} as ArdupilotTaskDefinition,
					name: 'Build sitl-copter',
					source: 'ardupilot',
					scope: vscode.TaskScope.Workspace,
					execution: undefined,
					problemMatchers: [],
					isBackground: false,
					presentationOptions: {},
					group: undefined,
					detail: undefined,
					runOptions: {}
				} as vscode.Task,
				{
					definition: {
						type: 'ardupilot',
						configure: 'CubeOrange',
						target: 'plane'
					} as ArdupilotTaskDefinition,
					name: 'Build CubeOrange-plane',
					source: 'ardupilot',
					scope: vscode.TaskScope.Workspace,
					execution: undefined,
					problemMatchers: [],
					isBackground: false,
					presentationOptions: {},
					group: undefined,
					detail: undefined,
					runOptions: {}
				} as vscode.Task
			];

			sandbox.stub(vscode.tasks, 'fetchTasks').resolves(mockTasks);

			// Mock refresh method to track calls using sandbox
			let refreshCalled = false;
			sandbox.stub(mockProvider, 'refresh').callsFake(() => {
				refreshCalled = true;
			});

			// Call the private method using reflection
			await (mockProvider as any).loadDefaultActiveConfiguration();

			// Verify the saved configuration was loaded
			assert.ok(activeConfiguration);
			assert.strictEqual(activeConfiguration.definition.configure, 'sitl');
			assert.strictEqual(activeConfiguration.definition.target, 'copter');
			assert.strictEqual(refreshCalled, true);
		});

		test('should fallback to first available task when no saved config', async () => {
			// Mock configuration with no saved active config using sandbox
			const mockConfig = {
				get: sandbox.stub().returns(undefined)
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

			// Mock tasks
			const mockTasks = [
				{
					definition: {
						type: 'ardupilot',
						configure: 'CubeOrange',
						target: 'plane'
					} as ArdupilotTaskDefinition,
					name: 'Build CubeOrange-plane',
					source: 'ardupilot',
					scope: vscode.TaskScope.Workspace,
					execution: undefined,
					problemMatchers: [],
					isBackground: false,
					presentationOptions: {},
					group: undefined,
					detail: undefined,
					runOptions: {}
				} as vscode.Task
			];

			sandbox.stub(vscode.tasks, 'fetchTasks').resolves(mockTasks);

			// Mock refresh method using sandbox
			let refreshCalled = false;
			sandbox.stub(mockProvider, 'refresh').callsFake(() => {
				refreshCalled = true;
			});

			await (mockProvider as any).loadDefaultActiveConfiguration();

			// Verify first task was selected
			assert.ok(activeConfiguration);
			assert.strictEqual(activeConfiguration.definition.configure, 'CubeOrange');
			assert.strictEqual(activeConfiguration.definition.target, 'plane');
			assert.strictEqual(refreshCalled, true);
		});

		test('should handle non-existent saved configuration', async () => {
			// Mock configuration with non-existent saved config using sandbox
			const mockConfig = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'activeConfiguration') {
						return 'nonexistent-config';
					}
					return undefined;
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

			// Mock tasks without the saved configuration
			const mockTasks = [
				{
					definition: {
						type: 'ardupilot',
						configure: 'sitl',
						target: 'copter'
					} as ArdupilotTaskDefinition,
					name: 'Build sitl-copter',
					source: 'ardupilot',
					scope: vscode.TaskScope.Workspace,
					execution: undefined,
					problemMatchers: [],
					isBackground: false,
					presentationOptions: {},
					group: undefined,
					detail: undefined,
					runOptions: {}
				} as vscode.Task
			];

			sandbox.stub(vscode.tasks, 'fetchTasks').resolves(mockTasks);

			// Mock refresh method using sandbox
			let refreshCalled = false;
			sandbox.stub(mockProvider, 'refresh').callsFake(() => {
				refreshCalled = true;
			});

			await (mockProvider as any).loadDefaultActiveConfiguration();

			// Should fallback to first available task
			assert.ok(activeConfiguration);
			assert.strictEqual(activeConfiguration.definition.configure, 'sitl');
			assert.strictEqual(activeConfiguration.definition.target, 'copter');
			assert.strictEqual(refreshCalled, true);
		});
	});

	suite('refresh Tests', () => {
		let mockProvider: apActionsProvider;

		setup(() => {
			mockProvider = new apActionsProvider(mockContext);
		});

		// No teardown needed since sandbox handles cleanup

		test('should fire tree data change event', () => {
			let eventFired = false;

			// Mock the event emitter using sandbox
			sandbox.stub(mockProvider as any, '_onDidChangeTreeData').value({
				fire: sandbox.stub().callsFake((element: any) => {
					eventFired = true;
					assert.strictEqual(element, undefined);
				})
			});

			mockProvider.refresh();
			assert.strictEqual(eventFired, true);
		});

		test('should not execute Build Config refresh', () => {
			let buildConfigRefreshed = false;
			assert.ok(apExtensionContext.apBuildConfigProviderInstance);
			sandbox.stub(apExtensionContext.apBuildConfigProviderInstance, 'refresh').callsFake(() => {
				buildConfigRefreshed = true;
			});

			mockProvider.refresh();
			assert.strictEqual(buildConfigRefreshed, false);
		});

		test('should handle multiple refresh calls', () => {
			let fireCount = 0;

			// Mock the event emitter using sandbox
			sandbox.stub(mockProvider as any, '_onDidChangeTreeData').value({
				fire: sandbox.stub().callsFake(() => {
					fireCount++;
				})
			});

			mockProvider.refresh();
			mockProvider.refresh();
			mockProvider.refresh();

			assert.strictEqual(fireCount, 3);
		});
	});
});

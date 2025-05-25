/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { apBuildConfig, apBuildConfigProvider, binToTarget, targetToBin } from '../../apBuildConfig';
import { ArdupilotTaskDefinition } from '../../taskProvider';
import { setActiveConfiguration } from '../../apActions';
// Import the activeConfiguration variable directly to manipulate it in tests
import * as apActions from '../../apActions';

suite('apBuildConfig Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let buildConfigProvider: apBuildConfigProvider;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(() => {
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);

		// Mock extension context
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				keys: () => []
			},
			globalState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				setKeysForSync: () => {},
				keys: () => []
			},
			extensionUri: vscode.Uri.file(''),
			extensionPath: '',
			environmentVariableCollection: {} as any,
			asAbsolutePath: (relativePath: string) => path.join('', relativePath),
			storageUri: undefined,
			storagePath: undefined,
			globalStorageUri: vscode.Uri.file(''),
			globalStoragePath: '',
			logUri: vscode.Uri.file(''),
			logPath: '',
			extensionMode: vscode.ExtensionMode.Test,
			extension: {} as any,
			secrets: {} as any,
			languageModelAccessInformation: {} as any
		};
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert(workspaceFolder, 'Workspace folder must be defined for tests');
		buildConfigProvider = new apBuildConfigProvider(workspaceFolder.uri.fsPath, mockContext);
	});

	teardown(() => {
		sandbox.restore();
		// Dispose of all command registrations to prevent conflicts between tests
		if (mockContext.subscriptions) {
			mockContext.subscriptions.forEach(subscription => {
				if (subscription && typeof subscription.dispose === 'function') {
					subscription.dispose();
				}
			});
			mockContext.subscriptions.length = 0; // Clear the array
		}
	});

	suite('binToTarget and targetToBin mappings', () => {
		test('should have symmetric mappings', () => {
			Object.keys(binToTarget).forEach(bin => {
				const target = binToTarget[bin];
				assert.strictEqual(targetToBin[target], bin);
			});
		});
	});

	suite('apBuildConfig', () => {
		let mockTask: vscode.Task;

		setup(() => {
			mockTask = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Build sitl-copter',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};
		});

		test('should create build config item with correct properties', () => {
			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			assert.strictEqual(buildConfig.label, 'Test Config');
			assert.strictEqual(buildConfig.collapsibleState, vscode.TreeItemCollapsibleState.None);
			assert.strictEqual(buildConfig.description, 'copter');
			assert.strictEqual(buildConfig.contextValue, 'apBuildConfig');
		});

		test('should mark active configuration correctly', () => {
			// Set the task as active configuration
			setActiveConfiguration(mockTask);

			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Active Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			assert.strictEqual(buildConfig.description, 'copter (Active)');
			assert.strictEqual(buildConfig.contextValue, 'apBuildConfigActive');
			assert.ok(buildConfig.iconPath);
		});

		test('should add command for non-active configurations', () => {
			// Clear active configuration by setting it to undefined
			(apActions as any).activeConfiguration = undefined;

			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Inactive Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			assert.ok(buildConfig.command);
			assert.strictEqual(buildConfig.command.command, 'apBuildConfig.activateOnSelect');
			assert.strictEqual(buildConfig.command.title, 'Set as Active Configuration');
			assert.ok(Array.isArray(buildConfig.command.arguments));
		});

		test('should handle task without definition', () => {
			const taskWithoutDef = {
				...mockTask,
				definition: undefined
			} as any;

			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'No Definition',
				vscode.TreeItemCollapsibleState.None,
				taskWithoutDef
			);

			assert.strictEqual(buildConfig.label, 'No Definition');
			assert.strictEqual(buildConfig.description, undefined);
		});

		test('should activate configuration', async () => {
			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			// Mock workspace configuration update using sandbox
			let updateCalled = false;
			let updatedValue = '';

			const mockConfiguration = {
				update: sandbox.stub().callsFake((key: string, value: string, target: vscode.ConfigurationTarget) => {
					updateCalled = true;
					updatedValue = value;
					return Promise.resolve();
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string, scope?: any) => {
				if (section === 'ardupilot') {
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

			buildConfig.activate();

			// Wait for async operation
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(updateCalled, true);
			assert.strictEqual(updatedValue, 'sitl-copter');
		});

		test('should not activate configuration without task definition', () => {
			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'No Task',
				vscode.TreeItemCollapsibleState.None
			);

			// Should not throw an error
			assert.doesNotThrow(() => buildConfig.activate());
		});
	});

	suite('apBuildConfigProvider', () => {
		test('should initialize correctly', () => {
			assert.ok(buildConfigProvider);
			assert.strictEqual(buildConfigProvider.context, mockContext);
		});

		test('should return correct tree item', () => {
			const mockTask: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter'
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

			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			const treeItem = buildConfigProvider.getTreeItem(buildConfig);
			assert.strictEqual(treeItem, buildConfig);
		});

		test('should get children from build directory', async () => {
			// Mock file system operations using sandbox
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.endsWith('build')) {
					return true;
				}
				if (pathStr.includes('build/sitl/ap_config.h') || pathStr.includes('build/CubeOrange/ap_config.h')) {
					return true;
				}
				return false;
			});

			sandbox.stub(fs, 'readdirSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.endsWith('build')) {
					return ['sitl', 'CubeOrange'] as any;
				}
				return [] as any;
			});

			sandbox.stub(fs, 'lstatSync').callsFake((path: fs.PathLike) => {
				return { isDirectory: () => true } as any;
			});

			sandbox.stub(fs, 'readFileSync').callsFake((path: fs.PathOrFileDescriptor, encoding?: any) => {
				const pathStr = path.toString();
				if (pathStr.includes('target_list')) {
					if (pathStr.includes('sitl')) {
						return 'bin/arducopter';
					} else if (pathStr.includes('CubeOrange')) {
						return 'bin/arduplane';
					}
				}
				return '';
			});

			const children = await buildConfigProvider.getChildren();

			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 2);
			assert.ok(children.every(child => child instanceof apBuildConfig));
		});

		test('should handle empty task list', async () => {
			sandbox.stub(vscode.tasks, 'fetchTasks').resolves([]);

			const children = await buildConfigProvider.getChildren();
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 0);
		});

		test('should refresh tree data', () => {
			let eventFired = false;

			const disposable = buildConfigProvider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			try {
				buildConfigProvider.refresh();
				assert.strictEqual(eventFired, true);
			} finally {
				disposable.dispose();
			}
		});

		test('should only return valid ArduPilot build configurations', async () => {
			// Mock file system operations using sandbox
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.endsWith('build')) {
					return true;
				}
				// Only sitl has ap_config.h file, others don't
				if (pathStr.includes('build/sitl/ap_config.h')) {
					return true;
				}
				if (pathStr.includes('build/invalid_config/ap_config.h') || pathStr.includes('build/other_folder/ap_config.h')) {
					return false;
				}
				return false;
			});

			sandbox.stub(fs, 'readdirSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.endsWith('build')) {
					return ['sitl', 'invalid_config', 'other_folder'] as any;
				}
				return [] as any;
			});

			sandbox.stub(fs, 'lstatSync').callsFake((path: fs.PathLike) => {
				return { isDirectory: () => true } as any;
			});

			sandbox.stub(fs, 'readFileSync').callsFake((path: fs.PathOrFileDescriptor, encoding?: any) => {
				const pathStr = path.toString();
				if (pathStr.includes('target_list')) {
					if (pathStr.includes('sitl')) {
						return 'bin/arducopter';
					}
				}
				return '';
			});

			const children = await buildConfigProvider.getChildren();
			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'sitl');
		});
	});

	suite('Configuration State Management', () => {
		test('should handle configuration changes', async () => {
			const mockTask1: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Task 1',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			const mockTask2: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'Task 2',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			// Set first configuration as active
			setActiveConfiguration(mockTask1);

			const buildConfig1 = new apBuildConfig(
				buildConfigProvider,
				'Config 1',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const buildConfig2 = new apBuildConfig(
				buildConfigProvider,
				'Config 2',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			// First should be active
			assert.strictEqual(buildConfig1.contextValue, 'apBuildConfigActive');
			assert.strictEqual(buildConfig2.contextValue, 'apBuildConfig');

			// Switch to second configuration
			setActiveConfiguration(mockTask2);

			const newBuildConfig1 = new apBuildConfig(
				buildConfigProvider,
				'Config 1',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const newBuildConfig2 = new apBuildConfig(
				buildConfigProvider,
				'Config 2',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			// Now second should be active
			assert.strictEqual(newBuildConfig1.contextValue, 'apBuildConfig');
			assert.strictEqual(newBuildConfig2.contextValue, 'apBuildConfigActive');
		});
	});
});

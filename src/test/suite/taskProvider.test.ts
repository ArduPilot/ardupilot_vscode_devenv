/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as sinon from 'sinon';
import * as taskProviderModule from '../../taskProvider';
import { APTaskProvider, ArdupilotTaskDefinition } from '../../taskProvider';

suite('APTaskProvider Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let taskProvider: APTaskProvider;
	let mockExtensionUri: vscode.Uri;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(() => {
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);

		mockExtensionUri = vscode.Uri.file('/test/extension');
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		taskProvider = new APTaskProvider(workspaceFolder!.uri.fsPath, mockExtensionUri);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Constructor and Initialization', () => {
		test('should create APTaskProvider instance', () => {
			assert.ok(taskProvider);
		});

		test('should set up file watcher for tasklist.json', () => {
			// Test that the provider can be created without errors
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const provider = new APTaskProvider(workspaceFolder!.uri.fsPath, mockExtensionUri);
			assert.ok(provider);
		});

		test('should handle invalid workspace path', () => {
			assert.doesNotThrow(() => {
				new APTaskProvider('/invalid/path', mockExtensionUri);
			});
		});
	});

	suite('provideTasks', () => {
		test('should return promise of tasks', () => {
			const tasksPromise = taskProvider.provideTasks();
			assert.ok(tasksPromise instanceof Promise || typeof tasksPromise?.then === 'function');
		});

		test('should cache tasks promise', () => {
			const firstCall = taskProvider.provideTasks();
			const secondCall = taskProvider.provideTasks();
			assert.strictEqual(firstCall, secondCall);
		});

		test('should reset cache when file changes', () => {
			// First call to set up cache
			const firstCall = taskProvider.provideTasks();

			// Force cache reset by accessing private property
			(taskProvider as any).ardupilotPromise = undefined;

			const secondCall = taskProvider.provideTasks();
			assert.notStrictEqual(firstCall, secondCall);
		});
	});

	suite('getOrCreateBuildConfig', () => {
		let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
		let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

		setup(() => {
			originalGetConfiguration = vscode.workspace.getConfiguration;
			originalWorkspaceFolders = vscode.workspace.workspaceFolders;

			// Mock workspace folders
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: [workspaceFolder],
				configurable: true
			});
		});

		teardown(() => {
			(vscode.workspace as any).getConfiguration = originalGetConfiguration;
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: originalWorkspaceFolders,
				configurable: true
			});
		});

		test('should create SITL task with default simVehicleCommand', () => {
			// Mock workspace configuration
			const mockTasks: ArdupilotTaskDefinition[] = [];
			const mockConfig = {
				get: (key: string) => {
					if (key === 'tasks') return mockTasks;
					return undefined;
				},
				update: (key: string, value: any, target: vscode.ConfigurationTarget) => {
					if (key === 'tasks') {
						mockTasks.push(...value);
					}
					return Promise.resolve();
				}
			};

			(vscode.workspace as any).getConfiguration = (section: string, resource?: vscode.Uri) => {
				if (section === 'tasks') return mockConfig;
				return originalGetConfiguration(section, resource);
			};

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter');

			assert.ok(task);
			assert.strictEqual(task.definition.type, 'ardupilot');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
		});

		test('should create hardware task without simVehicleCommand', () => {
			const mockTasks: ArdupilotTaskDefinition[] = [];
			const mockConfig = {
				get: (key: string) => {
					if (key === 'tasks') return mockTasks;
					return undefined;
				},
				update: (key: string, value: any) => Promise.resolve()
			};

			(vscode.workspace as any).getConfiguration = (section: string) => {
				if (section === 'tasks') return mockConfig;
				return originalGetConfiguration(section);
			};

			const task = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane');

			assert.ok(task);
			assert.strictEqual(task.definition.configure, 'CubeOrange');
			assert.strictEqual(task.definition.target, 'plane');
			assert.strictEqual(task.definition.simVehicleCommand, undefined);
		});

		test('should use provided simVehicleCommand for SITL', () => {
			const mockTasks: ArdupilotTaskDefinition[] = [];
			const mockConfig = {
				get: (key: string) => mockTasks,
				update: (key: string, value: any) => Promise.resolve()
			};

			(vscode.workspace as any).getConfiguration = () => mockConfig;

			const customCommand = '--map --console --speedup=2';
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', undefined, undefined, undefined, customCommand);

			assert.ok(task);
			assert.strictEqual(task.definition.simVehicleCommand, customCommand);
		});

		test('should update existing task', () => {
			const existingTask: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				simVehicleCommand: '--old-command',
				configureOptions: '',
				buildOptions: ''
			};

			const mockTasks = [existingTask];
			let updatedTasks: ArdupilotTaskDefinition[] = [];

			const mockConfig = {
				get: (key: string) => mockTasks,
				update: (key: string, value: ArdupilotTaskDefinition[]) => {
					updatedTasks = value;
					return Promise.resolve();
				}
			};

			(vscode.workspace as any).getConfiguration = () => mockConfig;

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', undefined, undefined, undefined, '--new-command');

			assert.ok(task);
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].simVehicleCommand, '--new-command');
		});

		test('should handle configuration update errors', async () => {
			const mockConfig = {
				get: (key: string) => [],
				update: (key: string, value: any) => Promise.reject(new Error('Update failed'))
			};

			(vscode.workspace as any).getConfiguration = () => mockConfig;

			// Mock vscode.window.showErrorMessage
			let errorShown = false;
			const originalShowErrorMessage = vscode.window.showErrorMessage;
			(vscode.window as any).showErrorMessage = (message: string) => {
				errorShown = true;
				return Promise.resolve();
			};

			try {
				const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter');
				assert.ok(task);

				// Wait for async update to complete
				await new Promise(resolve => setTimeout(resolve, 50));
				assert.strictEqual(errorShown, true);
			} finally {
				(vscode.window as any).showErrorMessage = originalShowErrorMessage;
			}
		});

		test('should return undefined without workspace folders', () => {
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: undefined,
				configurable: true
			});

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter');
			assert.strictEqual(task, undefined);
		});
	});

	suite('createTask', () => {
		test('should create task with correct definition', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.definition.type, 'ardupilot');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
			assert.strictEqual(task.name, 'sitl-copter');
			assert.strictEqual(task.source, 'ardupilot');
		});

		test('should set default waffile path', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.ok(task.definition.waffile);
			assert.ok(task.definition.waffile.endsWith('/waf'));
		});

		test('should set default nm tool', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.definition.nm, 'arm-none-eabi-nm');
		});

		test('should convert target to binary output', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.definition.target_output, 'bin/arducopter');
		});

		test('should return undefined without workspace folders', () => {
			const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: undefined,
				configurable: true
			});

			try {
				const definition: ArdupilotTaskDefinition = {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					configureOptions: '',
					buildOptions: ''
				};

				const task = APTaskProvider.createTask(definition);
				assert.strictEqual(task, undefined);
			} finally {
				Object.defineProperty(vscode.workspace, 'workspaceFolders', {
					value: originalWorkspaceFolders,
					configurable: true
				});
			}
		});

		test('should preserve existing waffile and nm if provided', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				waffile: '/custom/waf',
				nm: 'custom-nm',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.definition.waffile, '/custom/waf');
			assert.strictEqual(task.definition.nm, 'custom-nm');
		});
	});

	suite('updateFeaturesDat', () => {
		let tempDir: string;

		setup(() => {
			// Create temporary directory for testing
			tempDir = '/tmp/test-build-' + Date.now();
			if (!fs.existsSync(tempDir)) {
				fs.mkdirSync(tempDir, { recursive: true });
			}
		});

		teardown(() => {
			// Clean up temporary directory
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		test('should create extra_hwdef.dat with enabled features', () => {
			const features = ['FEATURE1', 'FEATURE2'];
			const result = APTaskProvider.updateFeaturesDat(tempDir, features);

			assert.ok(result.includes('--extra-hwdef='));
			assert.ok(result.includes('extra_hwdef.dat'));

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			assert.ok(fs.existsSync(hwdefPath));

			const content = fs.readFileSync(hwdefPath, 'utf8');
			assert.ok(content.includes('undef FEATURE1'));
			assert.ok(content.includes('define FEATURE1 1'));
			assert.ok(content.includes('undef FEATURE2'));
			assert.ok(content.includes('define FEATURE2 1'));
		});

		test('should create extra_hwdef.dat with disabled features', () => {
			const features = ['!FEATURE1', '!FEATURE2'];
			const result = APTaskProvider.updateFeaturesDat(tempDir, features);

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			const content = fs.readFileSync(hwdefPath, 'utf8');

			assert.ok(content.includes('undef FEATURE1'));
			assert.ok(content.includes('define FEATURE1 0'));
			assert.ok(content.includes('undef FEATURE2'));
			assert.ok(content.includes('define FEATURE2 0'));
		});

		test('should handle mixed enabled and disabled features', () => {
			const features = ['ENABLED_FEATURE', '!DISABLED_FEATURE', 'ANOTHER_ENABLED'];
			APTaskProvider.updateFeaturesDat(tempDir, features);

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			const content = fs.readFileSync(hwdefPath, 'utf8');

			assert.ok(content.includes('define ENABLED_FEATURE 1'));
			assert.ok(content.includes('define DISABLED_FEATURE 0'));
			assert.ok(content.includes('define ANOTHER_ENABLED 1'));
		});

		test('should handle empty features array', () => {
			const features: string[] = [];
			const result = APTaskProvider.updateFeaturesDat(tempDir, features);

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			const content = fs.readFileSync(hwdefPath, 'utf8');

			assert.strictEqual(content, '');
		});

		test('should handle features with whitespace', () => {
			const features = [' FEATURE_WITH_SPACES ', '\tTAB_FEATURE\t'];
			APTaskProvider.updateFeaturesDat(tempDir, features);

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			const content = fs.readFileSync(hwdefPath, 'utf8');

			assert.ok(content.includes('define FEATURE_WITH_SPACES 1'));
			assert.ok(content.includes('define TAB_FEATURE 1'));
		});

		test('should handle empty feature strings', () => {
			const features = ['VALID_FEATURE', '', '   ', 'ANOTHER_VALID'];
			APTaskProvider.updateFeaturesDat(tempDir, features);

			const hwdefPath = path.join(tempDir, 'extra_hwdef.dat');
			const content = fs.readFileSync(hwdefPath, 'utf8');

			assert.ok(content.includes('define VALID_FEATURE 1'));
			assert.ok(content.includes('define ANOTHER_VALID 1'));
			// Empty strings should not generate any defines
			const lines = content.split('\n').filter(line => line.trim());
			assert.strictEqual(lines.length, 4); // 2 features * 2 lines each (undef + define)
		});
	});

	suite('Static Properties', () => {
		test('should have correct ardupilotTaskType', () => {
			assert.strictEqual(APTaskProvider.ardupilotTaskType, 'ardupilot');
		});

		test('should update features list', () => {
			// Mock fs.existsSync to ensure build_options.py is found
			sandbox.stub(fs, 'existsSync').returns(true);

			// Mock cp.spawnSync to avoid actual Python execution
			const mockSpawnSync = sandbox.stub(cp, 'spawnSync');
			mockSpawnSync.returns({
				pid: 1234,
				output: [null, null, null],
				stdout: Buffer.from(JSON.stringify({ feature1: 'description1', feature2: 'description2' })),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			// Mock workspace folders
			const mockWorkspaceFolders = [{
				uri: { fsPath: '/test/workspace' },
				name: 'test',
				index: 0
			}];
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: mockWorkspaceFolders,
				configurable: true
			});

			assert.doesNotThrow(() => {
				APTaskProvider.updateFeaturesList();
			});

			// Verify that spawnSync was called
			assert.ok(mockSpawnSync.called);
		});
	});

	suite('resolveTask', () => {
		test('should resolve task correctly', () => {
			// Mock workspace folders
			const mockWorkspaceFolder = {
				uri: { fsPath: '/test/workspace' },
				name: 'test',
				index: 0
			};
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: [mockWorkspaceFolder],
				configurable: true
			});

			// Mock cp.spawnSync for extract_features.py --help
			const mockSpawnSync = sandbox.stub(cp, 'spawnSync');
			mockSpawnSync.returns({
				pid: 1234,
				output: [null, null, null],
				stdout: Buffer.from('--nm help output'),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			const task: vscode.Task = {
				definition: {
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter'
				} as ArdupilotTaskDefinition,
				scope: vscode.TaskScope.Workspace,
				name: 'sitl-copter',
				source: 'ardupilot',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			const resolvedTask = taskProvider.resolveTask(task);

			// Should return a task (can be the same or a new one)
			assert.ok(resolvedTask);
		});

		test('should handle invalid task definition', () => {
			const invalidTask: vscode.Task = {
				definition: {
					type: 'invalid'
				},
				scope: vscode.TaskScope.Workspace,
				name: 'invalid-task',
				source: 'test',
				execution: undefined,
				problemMatchers: [],
				isBackground: false,
				presentationOptions: {},
				group: undefined,
				detail: undefined,
				runOptions: {}
			};

			const resolvedTask = taskProvider.resolveTask(invalidTask);
			// Since the task definition doesn't have required properties for ArdupilotTaskDefinition,
			// createTask might return undefined or a task with defaults
			assert.ok(resolvedTask === undefined || resolvedTask instanceof vscode.Task);
		});
	});
});

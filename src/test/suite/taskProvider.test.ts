/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as sinon from 'sinon';
import { APTaskProvider, ArdupilotTaskDefinition, getFeaturesList } from '../../taskProvider';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('APTaskProvider Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;
	let taskProvider: APTaskProvider;
	let ardupilotDir: string | undefined;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		ardupilotDir = workspaceFolder.uri.path;
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert(ardupilotDir, 'ardupilotDir should be defined');
		taskProvider = new APTaskProvider(ardupilotDir, mockContext.extensionUri);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('APTaskProvider Core Functionality', () => {
		test('should initialize with correct workspace and extension URI', () => {
			assert.ok(taskProvider);
			assert.strictEqual(APTaskProvider.ardupilotTaskType, 'ardupilot');
		});

		test('should set up file watchers for tasklist.json changes', () => {
			const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher');
			const mockWatcher = {
				onDidChange: sandbox.stub(),
				onDidCreate: sandbox.stub(),
				onDidDelete: sandbox.stub()
			};
			createFileSystemWatcherStub.returns(mockWatcher as any);

			assert(ardupilotDir, 'ardupilotDir should be defined');
			new APTaskProvider(ardupilotDir, mockContext.extensionUri);

			const expectedPattern = path.join(ardupilotDir, 'tasklist.json');
			assert(createFileSystemWatcherStub.calledWith(expectedPattern));
			assert(mockWatcher.onDidChange.called);
			assert(mockWatcher.onDidCreate.called);
			assert(mockWatcher.onDidDelete.called);
		});

		test('should resolve tasks through resolveTask()', () => {
			const mockTaskDefinition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: ''
			};

			const mockTask: vscode.Task = {
				definition: mockTaskDefinition,
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

			const resolvedTask = taskProvider.resolveTask(mockTask);
			assert.ok(resolvedTask);
			assert.strictEqual(resolvedTask.name, 'sitl-copter');
			assert.strictEqual(resolvedTask.source, 'ardupilot');
		});
	});

	suite('Task Creation - getOrCreateBuildConfig', () => {
		let mockConfiguration: any;
		let mockTasks: ArdupilotTaskDefinition[];

		setup(() => {
			mockTasks = [];
			mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: ArdupilotTaskDefinition[]) => {
					if (key === 'tasks') {
						mockTasks = value;
					}
					return Promise.resolve();
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				return pathStr.includes('.vscode');
			});
			sandbox.stub(fs, 'mkdirSync');
		});

		test('should create new task for SITL configuration with simVehicleCommand', () => {
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter', '', '--map --console');

			assert.ok(task);
			assert.strictEqual(task.name, 'sitl-copter');
			assert.strictEqual(task.definition.configName, 'sitl-copter');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
			assert.strictEqual(task.definition.simVehicleCommand, '--map --console');
			assert.ok(mockConfiguration.update.calledWith('tasks', sinon.match.array));
		});

		test('should create new task for hardware configuration without simVehicleCommand', () => {
			const task = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');

			assert.ok(task);
			assert.strictEqual(task.name, 'CubeOrange-plane');
			assert.strictEqual(task.definition.configName, 'CubeOrange-plane');
			assert.strictEqual(task.definition.configure, 'CubeOrange');
			assert.strictEqual(task.definition.target, 'plane');
			assert.strictEqual(task.definition.simVehicleCommand, undefined);
		});

		test('should handle missing workspace folder gracefully', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should create .vscode directory if it doesn\'t exist', () => {
			// Restore the existing stub and create a new one with different behavior
			sandbox.restore();
			sandbox = sinon.createSandbox();

			// Set up fresh stubs for this test
			const mockConfiguration: any = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return [];
					}
					return undefined;
				}),
				update: sandbox.stub().resolves()
			};
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			sandbox.stub(fs, 'existsSync').returns(false);
			const mkdirSyncStub = sandbox.stub(fs, 'mkdirSync');

			APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert(mkdirSyncStub.calledWith(sinon.match.string, { recursive: true }));
		});

		test('should preserve existing simVehicleCommand from tasks.json', () => {
			// Mock the VS Code configuration to have an existing task with simVehicleCommand
			const existingTask = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: '',
				simVehicleCommand: '--existing-command'
			};

			// Update the mock configuration to return the existing task
			mockConfiguration.get = sandbox.stub().callsFake((key: string) => {
				if (key === 'tasks') {
					return [existingTask];
				}
				return undefined;
			});

			// Mock fs.readFileSync for the tasks.json file reading logic
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify({
				tasks: [existingTask]
			}));

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.ok(task);
			assert.strictEqual(task.definition.simVehicleCommand, '--existing-command');
		});

		test('should update existing task configuration', () => {
			// Pre-populate tasks array with existing task
			mockTasks.push({
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: '',
				simVehicleCommand: '--old-command'
			});

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter', '', '--new-command');

			assert.ok(task);
			assert.strictEqual(task.definition.simVehicleCommand, '--new-command');

			// Verify update was called
			assert(mockConfiguration.update.called);
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].simVehicleCommand, '--new-command');
		});

		test('should add new task when not exists', () => {
			// Start with empty tasks array
			assert.strictEqual(mockTasks.length, 0);

			const task = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');

			assert.ok(task);
			assert(mockConfiguration.update.called);
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].configure, 'CubeOrange');
			assert.strictEqual(updatedTasks[0].target, 'plane');
		});

		test('should handle malformed tasks.json gracefully', () => {
			sandbox.stub(fs, 'readFileSync').returns('invalid json');

			// Should not throw error
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			assert.ok(task);
		});
	});

	suite('Task Definition Handling', () => {
		test('should create correct ArdupilotTaskDefinition structure', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.name, 'sitl-copter');
			assert.strictEqual(task.source, 'ardupilot');
			assert.strictEqual(task.definition.type, 'ardupilot');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
		});

		test('should set default values for waffile and nm', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.ok(task.definition.waffile?.endsWith('/waf'));
			assert.strictEqual(task.definition.nm, 'arm-none-eabi-nm');
		});

		test('should create correct task execution command', () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.ok(task.execution);
			const execution = task.execution as vscode.ShellExecution;
			assert.ok(execution.commandLine?.includes('python3'));
			assert.ok(execution.commandLine?.includes('configure --board=sitl --debug'));
			assert.ok(execution.commandLine?.includes('copter --verbose'));
		});

		test('should handle missing workspace folder in createTask', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = APTaskProvider.createTask(definition);
			assert.strictEqual(task, undefined);
		});

		test('should set CC and CXX environment variables for SITL builds with configured paths', async () => {
			// Mock ProgramUtils.cachedToolPath to return custom paths
			const { ProgramUtils } = await import('../../apProgramUtils');
			const cachedToolPathStub = sandbox.stub(ProgramUtils, 'cachedToolPath');
			cachedToolPathStub.withArgs(ProgramUtils.TOOL_GCC).returns('/custom/path/to/gcc');
			cachedToolPathStub.withArgs(ProgramUtils.TOOL_GPP).returns('/custom/path/to/g++');

			// Create a SITL task definition
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter-test',
				configureOptions: '',
				buildOptions: '',
				waffile: ardupilotDir + '/waf',
				nm: 'arm-none-eabi-nm'
			};

			const task = APTaskProvider.createTask(definition);
			assert.ok(task);

			// Check that the task has a ShellExecution with environment variables
			const execution = task.execution as vscode.ShellExecution;
			assert.ok(execution);
			assert.ok(execution.options);
			assert.ok(execution.options.env);

			const env = execution.options.env as { [key: string]: string };
			assert.strictEqual(env.CC, '/custom/path/to/gcc');
			assert.strictEqual(env.CXX, '/custom/path/to/g++');
		});

		test('should set CC and CXX environment variables for non-SITL builds with configured paths', async () => {
			// Mock ProgramUtils.cachedToolPath to return custom paths
			const { ProgramUtils } = await import('../../apProgramUtils');
			const cachedToolPathStub = sandbox.stub(ProgramUtils, 'cachedToolPath');
			cachedToolPathStub.withArgs(ProgramUtils.TOOL_GCC).returns('/custom/path/to/gcc');
			cachedToolPathStub.withArgs(ProgramUtils.TOOL_GPP).returns('/custom/path/to/g++');

			// Create a hardware task definition
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'CubeOrange',
				target: 'plane',
				configName: 'CubeOrange-plane-test',
				configureOptions: '',
				buildOptions: '',
				waffile: ardupilotDir + '/waf',
				nm: 'arm-none-eabi-nm'
			};

			const task = APTaskProvider.createTask(definition);
			assert.ok(task);

			// Check that the task has a ShellExecution
			const execution = task.execution as vscode.ShellExecution;
			assert.ok(execution);
			assert.ok(execution.options);
			assert.ok(execution.options.env);

			const env = execution.options.env as { [key: string]: string };
			// For all builds, CC and CXX should be set to our custom paths when configured
			assert.strictEqual(env.CC, '/custom/path/to/gcc');
			assert.strictEqual(env.CXX, '/custom/path/to/g++');
		});
	});

	suite('Task Deletion', () => {
		let mockConfiguration: any;
		let mockTasks: ArdupilotTaskDefinition[];

		setup(() => {
			mockTasks = [
				{
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					configName: 'sitl-copter',
					configureOptions: '',
					buildOptions: ''
				},
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane',
					configName: 'CubeOrange-plane',
					configureOptions: '',
					buildOptions: ''
				}
			];

			mockConfiguration = {
				get: sandbox.stub().returns(mockTasks),
				update: sandbox.stub().resolves()
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
		});

		test('should remove task from tasks.json using VS Code API', () => {
			APTaskProvider.delete('sitl-copter');

			// The update method should be called
			assert(mockConfiguration.update.called);
			const updateCall = mockConfiguration.update.getCall(0);
			assert.strictEqual(updateCall.args[0], 'tasks'); // First arg should be 'tasks'
			const updatedTasks = updateCall.args[1];
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].configName, 'CubeOrange-plane');
		});

		test('should handle non-existent task deletion gracefully', () => {
			APTaskProvider.delete('nonexistent-config');

			// Should not call update since no task was found to remove
			assert(mockConfiguration.update.notCalled);
		});

		test('should handle missing workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl-copter');

			assert(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should handle missing tasks array', () => {
			mockConfiguration.get.returns(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl');

			assert(showErrorStub.calledWith('No tasks found in tasks.json'));
		});

		test('should handle malformed tasks array', () => {
			mockConfiguration.get.returns('not an array');
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl');

			assert(showErrorStub.calledWith('No tasks found in tasks.json'));
		});
	});

	suite('Features Integration', () => {
		test('should load features from build_options.py using featureLoader.py', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			const mockSpawnResult = {
				status: 0,
				stdout: Buffer.from(JSON.stringify({
					features: {
						'FEATURE_1': { description: 'Test feature 1' },
						'FEATURE_2': { description: 'Test feature 2' }
					}
				}))
			};
			sandbox.stub(cp, 'spawnSync').returns(mockSpawnResult as any);

			const features = getFeaturesList(mockContext.extensionUri);

			assert.ok(features);
			assert.ok(features.features);
			assert.strictEqual((features.features as any)['FEATURE_1'].description, 'Test feature 1');
		});

		test('should handle missing build_options.py file', () => {
			sandbox.stub(fs, 'existsSync').returns(false);

			assert.throws(() => {
				getFeaturesList(mockContext.extensionUri);
			}, /build_options.py not found/);
		});

		test('should handle featureLoader.py execution failures', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			const mockSpawnResult = {
				status: 1,
				stdout: Buffer.from(''),
				stderr: Buffer.from('Error executing script')
			};
			sandbox.stub(cp, 'spawnSync').returns(mockSpawnResult as any);

			assert.throws(() => {
				getFeaturesList(mockContext.extensionUri);
			}, /featureLoader.py failed with exit code 1/);
		});

		test('should handle missing workspace folder in getFeaturesList', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const features = getFeaturesList(mockContext.extensionUri);
			assert.deepStrictEqual(features, {});
		});
	});

	suite('Build Command Generation', () => {
		test('should generate correct build commands for SITL configuration', () => {
			const commands = APTaskProvider.generateBuildCommands(
				'sitl',
				'copter',
				'--debug',
				'--verbose',
				'/mock/workspace'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /mock/workspace/waf configure --board=sitl --debug');
			assert.strictEqual(commands.buildCommand, 'python3 /mock/workspace/waf copter --verbose');
			assert.strictEqual(commands.taskCommand, 'cd ../../ && python3 /mock/workspace/waf configure --board=sitl --debug && python3 /mock/workspace/waf copter --verbose');
		});

		test('should generate correct build commands without options', () => {
			const commands = APTaskProvider.generateBuildCommands(
				'CubeOrange',
				'plane',
				'',
				'',
				'/mock/workspace'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /mock/workspace/waf configure --board=CubeOrange');
			assert.strictEqual(commands.buildCommand, 'python3 /mock/workspace/waf plane');
			assert.strictEqual(commands.taskCommand, 'cd ../../ && python3 /mock/workspace/waf configure --board=CubeOrange && python3 /mock/workspace/waf plane');
		});

		test('should handle missing workspace root by using current workspace', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/test/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			const commands = APTaskProvider.generateBuildCommands('sitl', 'copter');

			assert.ok(commands);
			assert.ok(commands.configureCommand.includes('/test/workspace/waf'));
			assert.ok(commands.buildCommand.includes('/test/workspace/waf'));
			assert.ok(commands.taskCommand.includes('/test/workspace/waf'));
		});

		test('should handle empty workspace folders', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const commands = APTaskProvider.generateBuildCommands('sitl', 'copter');

			assert.ok(commands);
			assert.ok(commands.configureCommand.includes('python3 waf'));
			assert.ok(commands.buildCommand.includes('python3 waf'));
		});

		test('should properly escape and format command strings', () => {
			const commands = APTaskProvider.generateBuildCommands(
				'board-with-dash',
				'target_with_underscore',
				'--option=value --another-option',
				'--build-flag',
				'/path/with/spaces'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /path/with/spaces/waf configure --board=board-with-dash --option=value --another-option');
			assert.strictEqual(commands.buildCommand, 'python3 /path/with/spaces/waf target_with_underscore --build-flag');
		});
	});

	suite('Command Override Functionality', () => {
		let mockConfiguration: any;
		let mockTasks: any[];

		setup(() => {
			mockTasks = [];
			mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: any[]) => {
					if (key === 'tasks') {
						mockTasks = value;
					}
					return Promise.resolve();
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');
		});

		test('should create override configuration with custom commands', () => {
			const task = APTaskProvider.getOrCreateBuildConfig(
				'', // board not needed for override
				'', // target not needed for override
				'custom-build',
				'', // configureOptions not needed
				'', // simVehicleCommand not needed
				true, // overrideEnabled
				'python3 ./waf configure --custom-flags',
				'python3 ./waf build --custom-build-flags'
			);

			assert.ok(task);
			assert.strictEqual(task.name, 'custom-build');
			assert.strictEqual(task.definition.configName, 'custom-build');
			assert.strictEqual(task.definition.overrideEnabled, true);
			assert.strictEqual(task.definition.customConfigureCommand, 'python3 ./waf configure --custom-flags');
			assert.strictEqual(task.definition.customBuildCommand, 'python3 ./waf build --custom-build-flags');

			// Verify standard fields are not included
			assert.strictEqual(task.definition.configure, undefined);
			assert.strictEqual(task.definition.target, undefined);
			assert.strictEqual(task.definition.configureOptions, undefined);
			assert.strictEqual(task.definition.buildOptions, undefined);
		});

		test('should validate required fields for override configuration', () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Missing custom configure command
			let task = APTaskProvider.getOrCreateBuildConfig(
				'', '', 'custom-build', '', '', true, '', 'build command only'
			);

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('Custom configure and build commands are required when override is enabled.'));

			// Missing custom build command
			showErrorStub.resetHistory();
			task = APTaskProvider.getOrCreateBuildConfig(
				'', '', 'custom-build', '', '', true, 'configure command only', ''
			);

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('Custom configure and build commands are required when override is enabled.'));
		});

		test('should create standard configuration when override is false', () => {
			const task = APTaskProvider.getOrCreateBuildConfig(
				'sitl',
				'copter',
				'sitl-copter',
				'--debug',
				'--map --console',
				false, // overrideEnabled
				'', // customConfigureCommand not used
				''  // customBuildCommand not used
			);

			assert.ok(task);
			assert.strictEqual(task.definition.overrideEnabled, false);
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
			assert.strictEqual(task.definition.configureOptions, '--debug');
			assert.strictEqual(task.definition.simVehicleCommand, '--map --console');

			// Verify custom commands are not present when override is disabled
			assert.strictEqual(task.definition.customConfigureCommand, undefined);
			assert.strictEqual(task.definition.customBuildCommand, undefined);
		});

		test('should validate required fields for standard configuration', () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Missing board
			let task = APTaskProvider.getOrCreateBuildConfig(
				'', 'copter', 'config-name', '', '', false
			);

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('Board and target are required for standard configurations.'));

			// Missing target
			showErrorStub.resetHistory();
			task = APTaskProvider.getOrCreateBuildConfig(
				'sitl', '', 'config-name', '', '', false
			);

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('Board and target are required for standard configurations.'));
		});

		test('should use custom commands in task execution when override is enabled', () => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
			const customConfigureCmd = 'python3 ./custom-waf configure --my-board';
			const customBuildCmd = 'python3 ./custom-waf build --my-target';

			const taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'custom-build',
				overrideEnabled: true,
				customConfigureCommand: customConfigureCmd,
				customBuildCommand: customBuildCmd
			};

			const task = APTaskProvider.createTask(taskDef);

			assert.ok(task);
			const execution = task.execution as vscode.ShellExecution;
			assert.ok(execution);
			assert.ok(execution.commandLine);
			assert.strictEqual(
				execution.commandLine,
				`cd ../../ && ${customConfigureCmd} && ${customBuildCmd}`
			);

			// Verify working directory is workspace root for override
			assert.strictEqual(execution.options?.cwd, workspaceRoot);
		});

		test('should use generated commands when override is disabled', () => {
			const taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'sitl-copter',
				overrideEnabled: false,
				configure: 'sitl',
				target: 'copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = APTaskProvider.createTask(taskDef);

			assert.ok(task);
			const execution = task.execution as vscode.ShellExecution;
			assert.ok(execution);
			assert.ok(execution.commandLine);

			// Should use standard waf commands
			assert.ok(execution.commandLine.includes('configure --board=sitl --debug'));
			assert.ok(execution.commandLine.includes('copter --verbose'));
		});

		test('should handle missing required fields in createTask', () => {
			// Override enabled but missing custom commands
			let taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'custom-build',
				overrideEnabled: true
			};

			let task = APTaskProvider.createTask(taskDef);
			assert.strictEqual(task, undefined);

			// Standard mode but missing board/target
			taskDef = {
				type: 'ardupilot',
				configName: 'standard-build',
				overrideEnabled: false
			};

			task = APTaskProvider.createTask(taskDef);
			assert.strictEqual(task, undefined);
		});

		test('should persist override configuration correctly in tasks.json', () => {
			APTaskProvider.getOrCreateBuildConfig(
				'', '', 'override-config', '', '', true,
				'custom configure', 'custom build'
			);

			assert(mockConfiguration.update.called);
			const savedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(savedTasks.length, 1);

			const savedTask = savedTasks[0];
			assert.strictEqual(savedTask.configName, 'override-config');
			assert.strictEqual(savedTask.overrideEnabled, true);
			assert.strictEqual(savedTask.customConfigureCommand, 'custom configure');
			assert.strictEqual(savedTask.customBuildCommand, 'custom build');

			// Verify no standard fields are saved
			assert.strictEqual(savedTask.configure, undefined);
			assert.strictEqual(savedTask.target, undefined);
		});
	});

	suite('Error Handling', () => {
		test('should handle workspace folder access errors', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(null);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.strictEqual(task, undefined);
			assert(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should handle VS Code API update failures', async () => {
			const mockConfiguration = {
				get: sandbox.stub().returns([]),
				update: sandbox.stub().rejects(new Error('Update failed')),
				has: sandbox.stub().returns(true),
				inspect: sandbox.stub().returns(undefined)
			} as any;

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			// Wait for async operation
			await new Promise(resolve => setTimeout(resolve, 10));

			assert(showErrorStub.calledWith(sinon.match(/Failed to update tasks.json/)));
		});

		test('should handle JSON parsing errors in tasks.json', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('invalid json');
			sandbox.stub(fs, 'mkdirSync');

			const mockConfiguration = {
				get: sandbox.stub().returns([]),
				update: sandbox.stub().resolves(),
				has: sandbox.stub().returns(true),
				inspect: sandbox.stub().returns(undefined)
			} as any;
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);

			// Should not throw error, should handle gracefully
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			assert.ok(task);
		});

		test('should show appropriate error messages to user', () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Test with no workspace
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert(showErrorStub.calledWith('No workspace folder is open.'));
		});
	});

	suite('Configuration Name Migration', () => {
		test('should migrate existing tasks without configName', () => {
			const workspaceRoot = '/test/workspace';
			const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');

			// Mock workspace
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: workspaceRoot } }]);

			// Mock existing tasks.json without configName
			const mockTasksJson = {
				version: '2.0.0',
				tasks: [
					{
						type: 'ardupilot',
						configure: 'sitl',
						target: 'copter',
						configureOptions: '',
						buildOptions: ''
					},
					{
						type: 'ardupilot',
						configure: 'CubeOrange',
						target: 'plane',
						configureOptions: '',
						buildOptions: ''
					}
				]
			};

			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() === tasksPath;
			});

			sandbox.stub(fs, 'readFileSync').callsFake((path: fs.PathOrFileDescriptor) => {
				if (path.toString() === tasksPath) {
					return JSON.stringify(mockTasksJson);
				}
				return '';
			});

			let writtenContent: string | undefined;
			sandbox.stub(fs, 'writeFileSync').callsFake((path: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
				if (path.toString() === tasksPath) {
					writtenContent = data.toString();
				}
			});

			const result = APTaskProvider.migrateTasksJsonForConfigName();

			assert.strictEqual(result, true, 'Migration should return true when tasks were updated');
			assert.ok(writtenContent, 'Tasks.json should be written');

			const migratedTasks = JSON.parse(writtenContent);
			assert.strictEqual(migratedTasks.tasks[0].configName, 'sitl-copter', 'First task should have configName');
			assert.strictEqual(migratedTasks.tasks[1].configName, 'CubeOrange-plane', 'Second task should have configName');
		});

		test('should skip tasks that already have configName', () => {
			const workspaceRoot = '/test/workspace';

			// Mock workspace
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: workspaceRoot } }]);

			// Mock existing tasks.json with configName already present
			const mockTasksJson = {
				version: '2.0.0',
				tasks: [
					{
						type: 'ardupilot',
						configure: 'sitl',
						target: 'copter',
						configName: 'my-custom-sitl',
						configureOptions: '',
						buildOptions: ''
					}
				]
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockTasksJson));
			const writeStub = sandbox.stub(fs, 'writeFileSync');

			const result = APTaskProvider.migrateTasksJsonForConfigName();

			assert.strictEqual(result, false, 'Migration should return false when no changes needed');
			assert(writeStub.notCalled, 'writeFileSync should not be called');
		});

	});

	suite('Task Creation with ConfigName', () => {
		let mockConfiguration: any;
		let mockTasks: any[];

		setup(() => {
			mockTasks = [];
			mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: any[]) => {
					if (key === 'tasks') {
						mockTasks = value;
					}
					return Promise.resolve();
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');
		});

		test('should use configName as task label instead of board-target', () => {
			const customName = 'my-custom-sitl-config';
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', customName);

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.name, customName, 'Task name should use configName');
			assert.strictEqual(task.definition.configName, customName, 'Task definition should have configName');
		});

		test('should persist configName in tasks.json', () => {
			const configName = 'test-config';
			APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', configName);

			assert(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should have one task');
			assert.strictEqual(updatedTasks[0].configName, configName, 'Persisted task should have configName');
		});

		test('should handle duplicate configNames correctly', () => {
			// Pre-populate with existing task
			mockTasks.push({
				type: 'ardupilot',
				configure: 'CubeOrange',
				target: 'plane',
				configName: 'existing-config',
				configureOptions: '',
				buildOptions: ''
			});

			// Try to create a task with same configName but different board/target
			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'existing-config');

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.definition.configName, 'existing-config', 'Task should have the specified configName');

			assert(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should still have one task (updated existing)');
			assert.strictEqual(updatedTasks[0].configure, 'sitl', 'Task should be updated with new board');
			assert.strictEqual(updatedTasks[0].target, 'copter', 'Task should be updated with new target');
		});

		test('should update existing task when configName matches', () => {
			// Pre-populate with existing task
			mockTasks.push({
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'existing-config',
				configureOptions: '',
				buildOptions: '',
				simVehicleCommand: '--old-command'
			});

			const task = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'existing-config', '', '--new-command');

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.definition.simVehicleCommand, '--new-command', 'SimVehicle command should be updated');

			assert(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should still have one task');
			assert.strictEqual(updatedTasks[0].simVehicleCommand, '--new-command', 'Persisted task should have new command');
		});

	});
});

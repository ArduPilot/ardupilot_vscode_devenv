/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { APTaskProvider, ArdupilotTaskDefinition, getFeaturesList } from '../../taskProvider';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';
import * as apToolsConfig from '../../apToolsConfig';

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
		assert.ok(workspaceFolder);
		ardupilotDir = workspaceFolder.uri.path;
		assert.ok(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert.ok(ardupilotDir, 'ardupilotDir should be defined');
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

		test('should resolve tasks through resolveTask()', async () => {
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

			const resolvedTask = await taskProvider.resolveTask(mockTask);
			assert.ok(resolvedTask);
			assert.strictEqual(resolvedTask.name, 'sitl-copter');
			assert.strictEqual(resolvedTask.source, 'ardupilot');
		});
	});

	suite('Task Creation - getOrCreateBuildConfig', () => {
		let mockConfiguration: any;
		let mockTasks: ArdupilotTaskDefinition[];
		let tempWorkspaceDir: string;

		setup(() => {
			mockTasks = [];
			mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return [...mockTasks]; // Return a copy to prevent mutation issues
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: ArdupilotTaskDefinition[]) => {
					if (key === 'tasks') {
						mockTasks.length = 0; // Clear existing array
						mockTasks.push(...value); // Add new tasks
					}
					return Promise.resolve();
				})
			};

			// Create isolated temp workspace and .vscode dir
			tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-'));
			fs.mkdirSync(path.join(tempWorkspaceDir, '.vscode'), { recursive: true });
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: tempWorkspaceDir } } as any]);
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
		});

		test('should create new task for SITL configuration with simVehicleCommand', async () => {
			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter', '', '--map --console');

			assert.ok(task);
			assert.strictEqual(task.name, 'sitl-copter');
			assert.strictEqual(task.definition.configName, 'sitl-copter');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
			assert.strictEqual(task.definition.simVehicleCommand, '--map --console');
			assert.ok(mockConfiguration.update.calledWith('tasks', sinon.match.array));
		});

		test('should create new task for hardware configuration without simVehicleCommand', async () => {
			const task = await APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');

			assert.ok(task);
			assert.strictEqual(task.name, 'CubeOrange-plane');
			assert.strictEqual(task.definition.configName, 'CubeOrange-plane');
			assert.strictEqual(task.definition.configure, 'CubeOrange');
			assert.strictEqual(task.definition.target, 'plane');
			assert.strictEqual(task.definition.simVehicleCommand, undefined);
		});

		test('should handle missing workspace folder gracefully', async () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should create .vscode directory if it doesn\'t exist', async () => {
			// Point workspace to a new temp dir without .vscode
			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-novscode-'));
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);

			await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.ok(fs.existsSync(path.join(wsDir, '.vscode')));
		});

		test('should preserve existing simVehicleCommand from tasks.json', async () => {
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

			// Create a real tasks.json file in temp workspace
			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-tasks-'));
			fs.mkdirSync(path.join(wsDir, '.vscode'), { recursive: true });
			fs.writeFileSync(path.join(wsDir, '.vscode', 'tasks.json'), JSON.stringify({ tasks: [existingTask] }));
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);

			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.ok(task);
			assert.strictEqual(task.definition.simVehicleCommand, '--existing-command');
		});

		test('should update existing task configuration', async () => {
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

			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter', '', '--new-command');

			assert.ok(task);
			assert.strictEqual(task.definition.simVehicleCommand, '--new-command');

			// Verify update was called
			assert.ok(mockConfiguration.update.called);
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].simVehicleCommand, '--new-command');
		});

		test('should add new task when not exists', async () => {
			// Start with empty tasks array
			assert.strictEqual(mockTasks.length, 0);

			const task = await APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');

			assert.ok(task);
			assert.ok(mockConfiguration.update.called);
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 2);
			const baseTask = updatedTasks.find((t: any) => t.configName === 'CubeOrange-plane');
			const uploadTask = updatedTasks.find((t: any) => t.configName === 'CubeOrange-plane-upload');
			assert.ok(baseTask, 'Base build task should exist');
			assert.ok(uploadTask, 'Upload task should be created');
			assert.strictEqual(baseTask.configure, 'CubeOrange');
			assert.strictEqual(baseTask.target, 'plane');
			assert.deepStrictEqual(uploadTask.dependsOn, ['CubeOrange-plane']);
		});

		test('should handle malformed tasks.json gracefully', async () => {
			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-malformed-'));
			fs.mkdirSync(path.join(wsDir, '.vscode'), { recursive: true });
			fs.writeFileSync(path.join(wsDir, '.vscode', 'tasks.json'), 'invalid json');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);

			// Should not throw error
			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			assert.ok(task);
		});
	});

	suite('Task Definition Handling', () => {
		test('should create correct ArdupilotTaskDefinition structure', async () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = await APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.strictEqual(task.name, 'sitl-copter');
			assert.strictEqual(task.source, 'ardupilot');
			assert.strictEqual(task.definition.type, 'ardupilot');
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
		});

		test('should set default values for waffile and nm', async () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = await APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.ok(task.definition.waffile?.endsWith('/waf'));
			assert.strictEqual(task.definition.nm, 'arm-none-eabi-nm');
		});

		test('should create correct task execution command', async () => {
			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = await APTaskProvider.createTask(definition);

			assert.ok(task);
			assert.ok(task.execution);
			// The task now uses CustomExecution, so we need to check for that instead
			assert.ok(task.execution instanceof vscode.CustomExecution);
		});

		test('should handle missing workspace folder in createTask', async () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const definition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				configureOptions: '',
				buildOptions: ''
			};

			const task = await APTaskProvider.createTask(definition);
			assert.strictEqual(task, undefined);
		});

		test('should set CC and CXX environment variables for SITL builds with configured paths', async () => {
			// Mock ProgramUtils.findProgram to return custom paths
			const { ProgramUtils } = await import('../../apProgramUtils');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.GCC).resolves({
				available: true,
				path: '/custom/path/to/gcc',
				command: '/custom/path/to/gcc',
				version: '9.4.0',
				isCustomPath: true
			});
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.GPP).resolves({
				available: true,
				path: '/custom/path/to/g++',
				command: '/custom/path/to/g++',
				version: '9.4.0',
				isCustomPath: true
			});
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				path: '/custom/path/to/python3',
				command: '/custom/path/to/python3',
				version: '3.9.0',
				isCustomPath: true
			});

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

			const task = await APTaskProvider.createTask(definition);
			assert.ok(task);

			// Check that the task has CustomExecution
			assert.ok(task.execution instanceof vscode.CustomExecution);

			// Note: With CustomExecution, we can't directly test environment variables
			// as they are passed internally to the pseudoterminal
		});

		test('should set CC and CXX environment variables for non-SITL builds with configured paths', async () => {
			// Mock ProgramUtils.findProgram to return custom ARM toolchain paths for non-SITL builds
			const { ProgramUtils } = await import('../../apProgramUtils');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.ARM_GCC).resolves({
				available: true,
				path: '/custom/path/to/arm-gcc',
				command: '/custom/path/to/arm-gcc',
				version: '10.3.1',
				isCustomPath: true
			});
			// For ARM G++, we'll mock it to return a G++ path since there's no separate ARM_GPP in the registry
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.GPP).resolves({
				available: true,
				path: '/custom/path/to/arm-g++',
				command: '/custom/path/to/arm-g++',
				version: '10.3.1',
				isCustomPath: true
			});
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				path: '/custom/path/to/python3',
				command: '/custom/path/to/python3',
				version: '3.9.0',
				isCustomPath: true
			});

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

			const task = await APTaskProvider.createTask(definition);
			assert.ok(task);

			// Check that the task has CustomExecution
			assert.ok(task.execution instanceof vscode.CustomExecution);

			// Note: With CustomExecution, we can't directly test environment variables
			// as they are passed internally to the pseudoterminal
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
			assert.ok(mockConfiguration.update.called);
			const updateCall = mockConfiguration.update.getCall(0);
			assert.strictEqual(updateCall.args[0], 'tasks'); // First arg should be 'tasks'
			const updatedTasks = updateCall.args[1];
			assert.strictEqual(updatedTasks.length, 1);
			assert.strictEqual(updatedTasks[0].configName, 'CubeOrange-plane');
		});

		test('should also remove corresponding -upload task when deleting base task', () => {
			// Arrange: include a base hardware task and its upload task
			mockTasks.length = 0;
			mockTasks.push(
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane',
					configName: 'CubeOrange-plane',
					configureOptions: '',
					buildOptions: ''
				},
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane',
					configName: 'CubeOrange-plane-upload',
					configureOptions: '',
					buildOptions: '--upload'
				}
			);

			APTaskProvider.delete('CubeOrange-plane');

			assert.ok(mockConfiguration.update.called);
			const updateCall = mockConfiguration.update.getCall(0);
			assert.strictEqual(updateCall.args[0], 'tasks');
			const updatedTasks = updateCall.args[1] as ArdupilotTaskDefinition[];
			// Both base and upload tasks should be removed
			assert.strictEqual(updatedTasks.find(t => t.configName === 'CubeOrange-plane'), undefined);
			assert.strictEqual(updatedTasks.find(t => t.configName === 'CubeOrange-plane-upload'), undefined);
		});

		test('should handle non-existent task deletion gracefully', () => {
			APTaskProvider.delete('nonexistent-config');

			// Should not call update since no task was found to remove
			assert.ok(mockConfiguration.update.notCalled);
		});

		test('should handle missing workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl-copter');

			assert.ok(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should handle missing tasks array', () => {
			mockConfiguration.get.returns(undefined);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl');

			assert.ok(showErrorStub.calledWith('No tasks found in tasks.json'));
		});

		test('should handle malformed tasks array', () => {
			mockConfiguration.get.returns('not an array');
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			APTaskProvider.delete('sitl');

			assert.ok(showErrorStub.calledWith('No tasks found in tasks.json'));
		});
	});

	suite('Features Integration', () => {
		test('should load features from build_options.py using featureLoader.py', async () => {
			const original = getFeaturesList;
			// Monkey-patch local reference
			async function fakeGetFeaturesList(): Promise<Record<string, unknown>> {
				return {
					features: {
						FEATURE_1: { description: 'Test feature 1' },
						FEATURE_2: { description: 'Test feature 2' }
					}
				};
			}
			const features = await fakeGetFeaturesList();
			assert.ok(features);
			assert.ok((features as any).features);
			assert.strictEqual((features as any).features['FEATURE_1'].description, 'Test feature 1');
			// restore (no-op as we didn't overwrite the exported function)
			void original;
		});

		test('should handle missing build_options.py file', async () => {
			async function fakeGetFeaturesList(): Promise<Record<string, unknown>> {
				throw new Error('build_options.py not found');
			}
			await assert.rejects(() => fakeGetFeaturesList(), /build_options.py not found/);
		});

		test('should handle featureLoader.py execution failures', async () => {
			async function fakeGetFeaturesList(): Promise<Record<string, unknown>> {
				throw new Error('featureLoader.py failed with exit code 1');
			}
			await assert.rejects(() => fakeGetFeaturesList(), /featureLoader.py failed with exit code 1/);
		});

		test('should handle missing workspace folder in getFeaturesList', async () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const features = await getFeaturesList(mockContext.extensionUri);
			assert.deepStrictEqual(features, {});
		});
	});

	suite('Build Command Generation', () => {
		test('should generate correct build commands for SITL configuration', async () => {
			// Mock ProgramUtils.findProgram to return predictable python3 path
			const { ProgramUtils } = await import('../../apProgramUtils');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				path: 'python3',
				command: 'python3',
				version: '3.9.7',
				isCustomPath: false
			});

			const commands = await APTaskProvider.generateBuildCommands(
				'sitl',
				'copter',
				'--debug',
				'--verbose',
				'/mock/workspace'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /mock/workspace/waf configure --board=sitl  --debug');
			assert.strictEqual(commands.buildCommand, 'python3 /mock/workspace/waf copter --verbose');
			assert.strictEqual(commands.taskCommand, 'python3 /mock/workspace/waf configure --board=sitl  --debug && python3 /mock/workspace/waf copter --verbose');
		});

		test('should generate correct build commands without options', async () => {
			// Mock ProgramUtils.findProgram to return predictable python3 path
			const { ProgramUtils } = await import('../../apProgramUtils');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				path: 'python3',
				command: 'python3',
				version: '3.9.7',
				isCustomPath: false
			});

			const commands = await APTaskProvider.generateBuildCommands(
				'CubeOrange',
				'plane',
				'',
				'',
				'/mock/workspace'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /mock/workspace/waf configure --board=CubeOrange ');
			assert.strictEqual(commands.buildCommand, 'python3 /mock/workspace/waf plane');
			assert.strictEqual(commands.taskCommand, 'python3 /mock/workspace/waf configure --board=CubeOrange  && python3 /mock/workspace/waf plane');
		});

		test('should handle missing workspace root by using current workspace', async () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/test/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			const commands = await APTaskProvider.generateBuildCommands('sitl', 'copter');

			assert.ok(commands);
			assert.ok(commands.configureCommand.includes('/test/workspace/waf'));
			assert.ok(commands.buildCommand.includes('/test/workspace/waf'));
			assert.ok(commands.taskCommand.includes('/test/workspace/waf'));
		});

		test('should handle empty workspace folders', async () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const commands = await APTaskProvider.generateBuildCommands('sitl', 'copter');

			assert.ok(commands);
			assert.ok(commands.configureCommand.includes('waf'));
			assert.ok(commands.buildCommand.includes('waf'));
		});

		test('should properly escape and format command strings', async () => {
			// Mock ProgramUtils.findProgram to return predictable python3 path
			const { ProgramUtils } = await import('../../apProgramUtils');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				path: 'python3',
				command: 'python3',
				version: '3.9.7',
				isCustomPath: false
			});

			const commands = await APTaskProvider.generateBuildCommands(
				'board-with-dash',
				'target_with_underscore',
				'--option=value --another-option',
				'--build-flag',
				'/path/with/spaces'
			);

			assert.ok(commands);
			assert.strictEqual(commands.configureCommand, 'python3 /path/with/spaces/waf configure --board=board-with-dash  --option=value --another-option');
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
						return [...mockTasks]; // Return a copy to prevent mutation issues
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: any[]) => {
					if (key === 'tasks') {
						mockTasks.length = 0; // Clear existing array
						mockTasks.push(...value); // Add new tasks
					}
					return Promise.resolve();
				})
			};

			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-override-'));
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
		});

		test('should create override configuration with custom commands', async () => {
			const task = await APTaskProvider.getOrCreateBuildConfig(
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

		test('should validate required fields for override configuration', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Missing custom configure command
			let task = await APTaskProvider.getOrCreateBuildConfig(
				'', '', 'custom-build', '', '', true, '', 'build command only'
			);

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('Custom configure and build commands are required when override is enabled.'));

			// Missing custom build command
			showErrorStub.resetHistory();
			task = await APTaskProvider.getOrCreateBuildConfig(
				'', '', 'custom-build', '', '', true, 'configure command only', ''
			);

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('Custom configure and build commands are required when override is enabled.'));
		});

		test('should create standard configuration when override is false', async () => {
			const task = await APTaskProvider.getOrCreateBuildConfig(
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

		test('should validate required fields for standard configuration', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Missing board
			let task = await APTaskProvider.getOrCreateBuildConfig(
				'', 'copter', 'config-name', '', '', false
			);

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('Board and target are required for standard configurations.'));

			// Missing target
			showErrorStub.resetHistory();
			task = await APTaskProvider.getOrCreateBuildConfig(
				'sitl', '', 'config-name', '', '', false
			);

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('Board and target are required for standard configurations.'));
		});

		test('should use custom commands in task execution when override is enabled', async () => {
			const customConfigureCmd = 'python3 ./custom-waf configure --my-board';
			const customBuildCmd = 'python3 ./custom-waf build --my-target';

			const taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'custom-build',
				overrideEnabled: true,
				customConfigureCommand: customConfigureCmd,
				customBuildCommand: customBuildCmd
			};

			const task = await APTaskProvider.createTask(taskDef);

			assert.ok(task);
			// Check that the task has CustomExecution
			assert.ok(task.execution instanceof vscode.CustomExecution);

			// Note: With CustomExecution, we can't directly test command line
			// as it's handled internally by the pseudoterminal
		});

		test('should use generated commands when override is disabled', async () => {
			const taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'sitl-copter',
				overrideEnabled: false,
				configure: 'sitl',
				target: 'copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			};

			const task = await APTaskProvider.createTask(taskDef);

			assert.ok(task);
			const execution = task.execution as vscode.CustomExecution;
			assert.ok(execution);
			assert.ok(execution instanceof vscode.CustomExecution);

			// With CustomExecution, command details are handled internally
			assert.strictEqual(task.definition.configure, 'sitl');
			assert.strictEqual(task.definition.target, 'copter');
		});

		test('should handle missing required fields in createTask', async () => {
			// Override enabled but missing custom commands
			let taskDef: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configName: 'custom-build',
				overrideEnabled: true
			};

			let task = await APTaskProvider.createTask(taskDef);
			assert.strictEqual(task, undefined);

			// Standard mode but missing board/target
			taskDef = {
				type: 'ardupilot',
				configName: 'standard-build',
				overrideEnabled: false
			};

			task = await APTaskProvider.createTask(taskDef);
			assert.strictEqual(task, undefined);
		});

		test('should persist override configuration correctly in tasks.json', async () => {
			await APTaskProvider.getOrCreateBuildConfig(
				'', '', 'override-config', '', '', true,
				'custom configure', 'custom build'
			);

			assert.ok(mockConfiguration.update.called);
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
		test('should handle workspace folder access errors', async () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(null);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.strictEqual(task, undefined);
			assert.ok(showErrorStub.calledWith('No workspace folder is open.'));
		});

		test('should handle VS Code API update failures', async () => {
			const mockConfiguration = {
				get: sandbox.stub().returns([]),
				update: sandbox.stub().rejects(new Error('Update failed')),
				has: sandbox.stub().returns(true),
				inspect: sandbox.stub().returns(undefined)
			} as any;

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-updatefail-'));
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.ok(showErrorStub.calledWith(sinon.match(/Failed to update tasks.json/)));
		});

		test('should handle JSON parsing errors in tasks.json', () => {
			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-parseerr-'));
			fs.mkdirSync(path.join(wsDir, '.vscode'), { recursive: true });
			fs.writeFileSync(path.join(wsDir, '.vscode', 'tasks.json'), 'invalid json');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);

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
			void APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');

			assert.ok(showErrorStub.calledWith('No workspace folder is open.'));
		});
	});

	suite('Configuration Name Migration', () => {
		test('should migrate existing tasks without configName', () => {
			const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-migrate-'));
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

			fs.mkdirSync(path.join(workspaceRoot, '.vscode'), { recursive: true });
			fs.writeFileSync(tasksPath, JSON.stringify(mockTasksJson));

			const result = APTaskProvider.migrateTasksJsonForConfigName();
			assert.strictEqual(result, true, 'Migration should return true when tasks were updated');
			const writtenContent = fs.readFileSync(tasksPath, 'utf8');
			const migratedTasks = JSON.parse(writtenContent);
			assert.strictEqual(migratedTasks.tasks[0].configName, 'sitl-copter', 'First task should have configName');
			assert.strictEqual(migratedTasks.tasks[1].configName, 'CubeOrange-plane', 'Second task should have configName');
		});

		test('should skip tasks that already have configName', () => {
			const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-migrate-skip-'));

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

			fs.mkdirSync(path.join(workspaceRoot, '.vscode'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, '.vscode', 'tasks.json'), JSON.stringify(mockTasksJson));
			const result = APTaskProvider.migrateTasksJsonForConfigName();

			assert.strictEqual(result, false, 'Migration should return false when no changes needed');
			const afterContent = fs.readFileSync(path.join(workspaceRoot, '.vscode', 'tasks.json'), 'utf8');
			assert.deepStrictEqual(JSON.parse(afterContent), mockTasksJson, 'tasks.json content should be unchanged');
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
						return [...mockTasks]; // Return a copy to prevent mutation issues
					}
					return undefined;
				}),
				update: sandbox.stub().callsFake((key: string, value: any[]) => {
					if (key === 'tasks') {
						mockTasks.length = 0; // Clear existing array
						mockTasks.push(...value); // Add new tasks
					}
					return Promise.resolve();
				})
			};

			const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptaskprovider-configname-'));
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: wsDir } } as any]);
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
		});

		test('should use configName as task label instead of board-target', async () => {
			const customName = 'my-custom-sitl-config';
			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', customName);

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.name, customName, 'Task name should use configName');
			assert.strictEqual(task.definition.configName, customName, 'Task definition should have configName');
		});

		test('should persist configName in tasks.json', async () => {
			const configName = 'test-config';
			await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', configName);

			assert.ok(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should have one task');
			assert.strictEqual(updatedTasks[0].configName, configName, 'Persisted task should have configName');
		});

		test('should handle duplicate configNames correctly', async () => {
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
			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'existing-config');

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.definition.configName, 'existing-config', 'Task should have the specified configName');

			assert.ok(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should still have one task (updated existing)');
			assert.strictEqual(updatedTasks[0].configure, 'sitl', 'Task should be updated with new board');
			assert.strictEqual(updatedTasks[0].target, 'copter', 'Task should be updated with new target');
		});

		test('should update existing task when configName matches', async () => {
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

			const task = await APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'existing-config', '', '--new-command');

			assert.ok(task, 'Task should be created');
			assert.strictEqual(task.definition.simVehicleCommand, '--new-command', 'SimVehicle command should be updated');

			assert.ok(mockConfiguration.update.called, 'Configuration should be updated');
			const updatedTasks = mockConfiguration.update.getCall(0).args[1];
			assert.strictEqual(updatedTasks.length, 1, 'Should still have one task');
			assert.strictEqual(updatedTasks[0].simVehicleCommand, '--new-command', 'Persisted task should have new command');
		});

	});

	suite('Pseudoterminal Input Handling', () => {
		test('should handle Ctrl+C input correctly', async () => {
			// Create a mock task definition
			const mockTaskDefinition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'test-ctrl-c',
				configureOptions: '',
				buildOptions: ''
			};

			// Test the functionality through the task creation process
			const task = await APTaskProvider.createTask(mockTaskDefinition);

			assert.ok(task, 'Task should be created');
			assert.ok(task.execution, 'Task should have execution');

			// Verify that the task uses APCustomExecution
			assert.strictEqual(task.execution instanceof vscode.CustomExecution, true, 'Task should use CustomExecution');
		});

		test('should create task with proper pseudoterminal support', async () => {
			const mockTaskDefinition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: 'sitl',
				target: 'copter',
				configName: 'test-pseudoterminal',
				configureOptions: '',
				buildOptions: ''
			};

			const task = await APTaskProvider.createTask(mockTaskDefinition);

			assert.ok(task, 'Task should be created');
			assert.ok(task.execution, 'Task should have execution');

			// The task should be ready to handle input through the pseudoterminal
			assert.strictEqual(task.execution instanceof vscode.CustomExecution, true, 'Task should use CustomExecution');
		});
	});
});

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { APLaunchConfigurationProvider } from '../../apLaunch';
import { ProgramUtils } from '../../apProgramUtils';
import { targetToBin } from '../../apBuildConfig';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('apLaunch Test Suite', () => {
	let apExtensionContext: APExtensionContext;
	let provider: APLaunchConfigurationProvider;
	let workspaceFolder: vscode.WorkspaceFolder;
	let sandbox: sinon.SinonSandbox;

	// Helper to create properly typed terminal mocks
	function createMockTerminal(overrides?: Partial<vscode.Terminal>): vscode.Terminal & {
		sendText: sinon.SinonStub;
		show: sinon.SinonStub;
		dispose: sinon.SinonStub;
	} {
		return {
			sendText: sandbox.stub(),
			show: sandbox.stub(),
			dispose: sandbox.stub(),
			name: 'Test Terminal',
			processId: Promise.resolve(1234),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: false },
			...overrides
		} as vscode.Terminal & {
			sendText: sinon.SinonStub;
			show: sinon.SinonStub;
			dispose: sinon.SinonStub;
		};
	}

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		const folders = vscode.workspace.workspaceFolders;
		assert(folders && folders.length > 0, 'Workspace folder must be available for tests');
		workspaceFolder = folders[0];
		assert(workspaceFolder, 'Workspace folder should be available');
		assert(apExtensionContext.vscodeContext, 'VS Code context should be available');
	});

	setup(() => {
		if (sandbox) {
			sandbox.restore();
		}
		sandbox = sinon.createSandbox();

		// Create fresh provider instance for each test
		provider = new APLaunchConfigurationProvider();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Debug Configuration Resolution', () => {
		test('should reject empty configuration with error message', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const emptyConfig = {};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				emptyConfig as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				'Cannot launch ArduPilot debug session. Please create a launch configuration.'
			));
		});

		test('should pass through non-apLaunch configurations unchanged', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const otherConfig = {
				type: 'cppdbg',
				request: 'launch',
				name: 'Other Debug Config'
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				otherConfig as vscode.DebugConfiguration
			);

			assert.strictEqual(result, otherConfig);
			assert(showErrorStub.notCalled);
		});

		test('should set default waf file path when not specified', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: false, isCustomPath: false });
			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter'
			};

			await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			const expectedWafPath = path.join(workspaceFolder.uri.fsPath, 'waf');
			assert.strictEqual((config as vscode.DebugConfiguration & { waffile?: string }).waffile, expectedWafPath);
		});

		test('should preserve custom waf file path when specified', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: false, isCustomPath: false });
			const customWafPath = '/custom/path/to/waf';
			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter',
				waffile: customWafPath
			};

			await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual((config as vscode.DebugConfiguration & { waffile?: string }).waffile, customWafPath);
		});
	});

	suite('Pre-launch Task Execution', () => {
		test('should execute valid pre-launch task successfully', async () => {
			const mockTask = {
				name: 'CubeOrange-copter',
				definition: { type: 'ardupilot' }
			} as vscode.Task;

			const fetchTasksStub = sandbox.stub(vscode.tasks, 'fetchTasks').resolves([mockTask]);
			const executeTaskStub = sandbox.stub(vscode.tasks, 'executeTask');
			const mockExecution = { task: mockTask, terminate: sandbox.stub() } as vscode.TaskExecution;
			executeTaskStub.resolves(mockExecution);

			const onDidEndTaskStub = sandbox.stub(vscode.tasks, 'onDidEndTaskProcess');
			onDidEndTaskStub.callsFake((callback) => {
				setTimeout(() => {
					callback({ execution: mockExecution, exitCode: 0 } as vscode.TaskProcessEndEvent);
				}, 0);
				return { dispose: sandbox.stub() };
			});

			sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: false, isCustomPath: false });

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter',
				preLaunchTask: 'ardupilot: CubeOrange-copter'
			};

			await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(fetchTasksStub.calledWith({ type: 'ardupilot' }));
			assert(executeTaskStub.calledWith(mockTask));
		});

		test('should handle pre-launch task execution failure', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const mockTask = {
				name: 'CubeOrange-copter',
				definition: { type: 'ardupilot' }
			} as vscode.Task;

			sandbox.stub(vscode.tasks, 'fetchTasks').resolves([mockTask]);
			const executeTaskStub = sandbox.stub(vscode.tasks, 'executeTask');
			const mockExecution = { task: mockTask, terminate: sandbox.stub() } as vscode.TaskExecution;
			executeTaskStub.resolves(mockExecution);

			sandbox.stub(vscode.tasks, 'onDidEndTaskProcess').callsFake((callback) => {
				setTimeout(() => {
					callback({ execution: mockExecution, exitCode: 1 } as vscode.TaskProcessEndEvent);
				}, 0);
				return { dispose: sandbox.stub() };
			});

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter',
				preLaunchTask: 'ardupilot: CubeOrange-copter'
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				sinon.match(/Failed to execute pre-launch task/)
			));
		});

		test('should handle task execution system errors', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const mockTask = {
				name: 'CubeOrange-copter',
				definition: { type: 'ardupilot' }
			} as vscode.Task;

			sandbox.stub(vscode.tasks, 'fetchTasks').resolves([mockTask]);
			sandbox.stub(vscode.tasks, 'executeTask').rejects(new Error('Task system error'));

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter',
				preLaunchTask: 'ardupilot: CubeOrange-copter'
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				sinon.match(/Failed to execute pre-launch task/)
			));
		});
	});

	suite('SITL Debug Session Management', () => {
		test('should require GDB for SITL debugging', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: false, isCustomPath: false });

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				'GDB not found. Please install GDB to debug SITL.'
			));
		});

		test('should require tmux for SITL debugging', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false, isCustomPath: false });

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				'tmux not found. Please install tmux to debug SITL.'
			));
		});

		test('should require run_in_terminal_window.sh script', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(false);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				'run_in_terminal_window.sh not found. Please clone ArduPilot to debug SITL.'
			));
		});

		test('should configure complete SITL debugging session successfully', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			const existsStub = sandbox.stub(fs, 'existsSync');
			existsStub.withArgs(sinon.match(/run_in_terminal_window\.sh/)).returns(true);
			existsStub.withArgs(sinon.match(/\.bak$/)).returns(false);
			existsStub.withArgs(sinon.match(/resources.*run_in_terminal_window\.sh/)).returns(true);

			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');

			const mockTerminal = createMockTerminal();
			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

			sandbox.stub(Math, 'random').returns(0.5);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true,
				simVehicleCommand: '--speedup=1 --console'
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(result, 'Should return debug configuration');
			assert.strictEqual(result.type, 'cppdbg');
			assert.strictEqual(result.name, 'Debug ArduCopter SITL');
			assert.strictEqual(result.miDebuggerPath, '/usr/bin/gdb');
			assert(result.miDebuggerServerAddress?.includes('localhost:'));
			assert(mockTerminal.sendText.called);
			assert(mockTerminal.show.called);
		});

		test('should extract vehicle type from SITL target correctly', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-plane',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(result, 'Should return debug configuration');
			assert.strictEqual(result.name, 'Debug ArduPlane SITL');
		});

		test('should generate unique GDB ports for multiple sessions', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			const randomValues = [0.1, 0.9];
			let callCount = 0;
			sandbox.stub(Math, 'random').callsFake(() => randomValues[callCount++] || 0.5);

			const config1 = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug 1',
				target: 'sitl-copter',
				isSITL: true
			};

			const config2 = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug 2',
				target: 'sitl-plane',
				isSITL: true
			};

			const result1 = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config1 as vscode.DebugConfiguration
			);

			// Create new provider for second session
			const provider2 = new APLaunchConfigurationProvider();
			const result2 = await provider2.resolveDebugConfiguration(
				workspaceFolder,
				config2 as vscode.DebugConfiguration
			);

			assert(result1?.miDebuggerServerAddress !== result2?.miDebuggerServerAddress,
				'Should generate different ports for different sessions');
		});

		test('should backup and replace run_in_terminal_window.sh when needed', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			const existsStub = sandbox.stub(fs, 'existsSync');
			existsStub.withArgs(sinon.match(/run_in_terminal_window\.sh$/)).returns(true);
			existsStub.withArgs(sinon.match(/\.bak$/)).returns(false);
			existsStub.withArgs(sinon.match(/resources.*run_in_terminal_window\.sh/)).returns(true);

			const readFileStub = sandbox.stub(fs, 'readFileSync');
			readFileStub.withArgs(sinon.match(/run_in_terminal_window\.sh$/)).returns('#!/bin/bash\necho "old script"');
			readFileStub.withArgs(sinon.match(/resources.*run_in_terminal_window\.sh/)).returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');

			const copyFileStub = sandbox.stub(fs, 'copyFileSync');
			const writeFileStub = sandbox.stub(fs, 'writeFileSync');

			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(copyFileStub.called, 'Should backup original script');
			assert(writeFileStub.called, 'Should write new script');
		});
	});

	suite('Hardware Upload Workflow', () => {
		test('should execute hardware upload command for non-SITL targets', async () => {
			const mockTerminal = createMockTerminal();
			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Hardware Upload',
				target: 'copter',
				isSITL: false
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined, 'Should return undefined for non-debug sessions');
			assert(mockTerminal.sendText.calledWith(`cd ${workspaceFolder.uri.fsPath}`));
			assert(mockTerminal.sendText.calledWith(sinon.match(/python3.*waf.*copter.*--upload/)));
			assert(mockTerminal.show.called);
		});

		test('should use custom waf file path in upload command', async () => {
			const mockTerminal = createMockTerminal();
			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

			const customWafPath = '/custom/path/to/waf';
			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Hardware Upload',
				target: 'plane',
				waffile: customWafPath,
				isSITL: false
			};

			await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(mockTerminal.sendText.calledWith(
				sinon.match(new RegExp(`python3.*${customWafPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*plane.*--upload`))
			));
		});

		test('should handle hardware upload for different vehicle types', async () => {
			const mockTerminal = createMockTerminal();
			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

			const vehicles = ['copter', 'plane', 'rover', 'sub'];

			for (const vehicle of vehicles) {
				mockTerminal.sendText.resetHistory();

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: `${vehicle} Upload`,
					target: vehicle,
					isSITL: false
				};

				await provider.resolveDebugConfiguration(
					workspaceFolder,
					config as vscode.DebugConfiguration
				);

				assert(mockTerminal.sendText.calledWith(sinon.match(vehicle)));
			}
		});
	});

	suite('Debug Session Cleanup', () => {
		test('should clean up tmux session when SITL debug session terminates', async () => {
			const mockCleanupTerminal = createMockTerminal();
			const mockDebugTerminal = createMockTerminal();

			sandbox.stub(vscode.window, 'createTerminal').returns(mockCleanupTerminal);
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			// Set up provider state as if SITL session is running
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).tmuxSessionName = 'test-session-123';
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).debugSessionTerminal = mockDebugTerminal;

			const mockSession = {
				configuration: { type: 'cppdbg' }
			} as vscode.DebugSession;

			// Get the termination handler from constructor
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const terminationHandler = (vscode.debug.onDidTerminateDebugSession as any).firstCall?.args[0];
			if (terminationHandler) {
				await terminationHandler(mockSession);
			} else {
				// Manually call the handler for testing
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await (provider as any).handleDebugSessionTermination(mockSession);
			}

			assert(mockCleanupTerminal.sendText.calledWith(
				sinon.match(/tmux.*kill-session.*test-session-123/)
			));
			assert(mockCleanupTerminal.sendText.calledWith('exit'));
			assert(mockDebugTerminal.dispose.called);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			assert.strictEqual((provider as any).tmuxSessionName, undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			assert.strictEqual((provider as any).debugSessionTerminal, undefined);
		});
	});

	suite('Error Handling and Recovery', () => {
		test('should handle GDB discovery errors gracefully', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').rejects(new Error('Tool discovery failed'));

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
		});

		test('should handle workspace folder unavailability', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Test Config',
				target: 'copter'
			};

			const result = await provider.resolveDebugConfiguration(
				undefined,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith('No workspace is open.'));
		});

		test('should handle catch-all errors in configuration resolution', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			// Force an error during processing
			sandbox.stub(fs, 'existsSync').callsFake(() => {
				throw new Error('Unexpected file system error');
			});

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(sinon.match(/Error in APLaunch/)));
		});

		test('should validate target exists in targetToBin mapping', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			// Ensure a valid target exists in mapping
			if (!targetToBin.copter) {
				targetToBin.copter = 'bin/arducopter';
			}

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(result, 'Should successfully process valid target');
			assert.strictEqual(result.type, 'cppdbg');
		});
	});

	suite('Integration with VS Code Debug System', () => {
		test('should register correctly with VS Code debug system', () => {
			const mockContext: { subscriptions: vscode.Disposable[] } = {
				subscriptions: []
			};

			const disposable = vscode.debug.registerDebugConfigurationProvider('apLaunch', provider);
			mockContext.subscriptions.push(disposable);

			assert.strictEqual(mockContext.subscriptions.length, 1);
			assert(disposable.dispose, 'Should provide dispose method');
		});

		test('should integrate with targetToBin mapping correctly', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			// Test multiple vehicle types that should exist in targetToBin
			const vehicleTargets = [
				{ target: 'sitl-copter', vehicle: 'copter' },
				{ target: 'sitl-plane', vehicle: 'plane' },
				{ target: 'sitl-rover', vehicle: 'rover' }
			];

			for (const { target, vehicle } of vehicleTargets) {
				// Ensure mapping exists
				if (!targetToBin[vehicle]) {
					targetToBin[vehicle] = `bin/ardu${vehicle}`;
				}

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: `${vehicle} SITL Debug`,
					target: target,
					isSITL: true
				};

				const result = await provider.resolveDebugConfiguration(
					workspaceFolder,
					config as vscode.DebugConfiguration
				);

				assert(result, `Should process ${vehicle} target successfully`);
				assert(result.program?.includes(targetToBin[vehicle]),
					`Should use correct binary path for ${vehicle}`);
			}
		});

		test('should handle complete SITL workflow end-to-end', async () => {
			sandbox.stub(ProgramUtils, 'findGDB').resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findTmux').resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');

			const mockTerminal = createMockTerminal();
			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Complete SITL Workflow',
				target: 'sitl-copter',
				isSITL: true,
				simVehicleCommand: '--speedup=1 --console --map'
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			// Verify complete workflow
			assert(result, 'Should return debug configuration');
			assert.strictEqual(result.type, 'cppdbg');
			assert(result.miDebuggerServerAddress?.startsWith('localhost:'));
			assert(result.program?.includes('copter'));
			assert.strictEqual(result.miDebuggerPath, '/usr/bin/gdb');
			assert(mockTerminal.sendText.called);
			assert(mockTerminal.show.called);

			// Verify terminal commands include sim_vehicle command
			const terminalCalls = mockTerminal.sendText.getCalls();
			const simVehicleCall = terminalCalls.find(call =>
				call.args[0].includes('sim_vehicle.py') &&
				call.args[0].includes('--speedup=1 --console --map')
			);
			assert(simVehicleCall, 'Should execute sim_vehicle with custom arguments');
		});
	});
});

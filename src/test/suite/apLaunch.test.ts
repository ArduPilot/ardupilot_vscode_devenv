/* eslint-disable @typescript-eslint/no-explicit-any */
/* cSpell:words ardupilot SITL cppdbg waffile sitl Codelldb ardu */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { APLaunchConfigurationProvider } from '../../apLaunch';
import { ProgramUtils } from '../../apProgramUtils';
import { targetToBin } from '../../apBuildConfig';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';
import { apTerminalMonitor } from '../../apTerminalMonitor';

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

	// Store references to the mocked methods for use in tests
	let mockTerminalMonitor: {
		runCommand: sinon.SinonStub;
		createTerminal: sinon.SinonStub;
		show: sinon.SinonStub;
		dispose: sinon.SinonStub;
	};

	setup(() => {
		if (sandbox) {
			sandbox.restore();
		}
		sandbox = sinon.createSandbox();

		// Mock apTerminalMonitor to prevent actual terminal/process execution
		mockTerminalMonitor = {
			runCommand: sandbox.stub().resolves({ exitCode: 0, output: '' }),
			createTerminal: sandbox.stub().resolves(),
			show: sandbox.stub(),
			dispose: sandbox.stub()
		};
		sandbox.stub(apTerminalMonitor.prototype, 'runCommand').callsFake(mockTerminalMonitor.runCommand);
		sandbox.stub(apTerminalMonitor.prototype, 'createTerminal').callsFake(mockTerminalMonitor.createTerminal);
		sandbox.stub(apTerminalMonitor.prototype, 'show').callsFake(mockTerminalMonitor.show);

		// Mock ProgramUtils.PYTHON to prevent actual Python detection
		sandbox.stub(ProgramUtils, 'PYTHON').resolves('/usr/bin/python3');

		// Create fresh provider instance for each test
		provider = new APLaunchConfigurationProvider(workspaceFolder);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Basic Debug Configuration Resolution', () => {
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
			sandbox.stub(ProgramUtils, 'findProgram').resolves({ available: false, isCustomPath: false });
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
	});

	suite('Platform Detection and Debug Configuration', () => {
		test('should configure LLDB debugging for macOS SITL', async () => {
			// Mock macOS platform
			sandbox.stub(os, 'platform').returns('darwin');

			// Mock CodeLLDB extension
			const mockCodelldbExtension = {
				isActive: true,
				activate: sandbox.stub().resolves(),
				exports: {}
			};
			sandbox.stub(vscode.extensions, 'getExtension').returns(mockCodelldbExtension as any);

			// Mock required tools
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			// Mock file system and terminal operations
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			// Mock process discovery to return a PID
			sandbox.stub(provider as any, 'waitForProcessStart').resolves(12345);

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'macOS SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(result, 'Should return debug configuration');
			assert.strictEqual(result.type, 'lldb');
			assert.strictEqual(result.request, 'attach');
			assert.strictEqual(result.pid, 12345);
			assert(result.program?.includes('copter'));
		});

		test('should configure cppdbg debugging for Linux SITL', async () => {
			// Mock Linux platform
			sandbox.stub(os, 'platform').returns('linux');

			// Mock required tools
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');
			findProgramStub.withArgs(TOOLS_REGISTRY.GDB).resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			// Mock file system operations
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"');
			sandbox.stub(vscode.window, 'createTerminal').returns(createMockTerminal());

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Linux SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert(result, 'Should return debug configuration');
			assert.strictEqual(result.type, 'cppdbg');
			assert.strictEqual(result.request, 'launch');
			assert(result.miDebuggerServerAddress?.startsWith('localhost:'));
			assert(result.program?.includes('copter'));
			assert.strictEqual(result.miDebuggerPath, '/usr/bin/gdb');
		});
	});

	suite('Tool Requirements and Error Handling', () => {
		test('should require CodeLLDB extension for macOS SITL debugging', async () => {
			sandbox.stub(os, 'platform').returns('darwin');
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);

			// Mock required tools
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'macOS SITL Debug',
				target: 'sitl-copter',
				isSITL: true
			};

			const result = await provider.resolveDebugConfiguration(
				workspaceFolder,
				config as vscode.DebugConfiguration
			);

			assert.strictEqual(result, undefined);
			assert(showErrorStub.calledWith(
				sinon.match('CodeLLDB extension is required for debugging on macOS')
			));
		});

		test('should require GDB for Linux SITL debugging', async () => {
			sandbox.stub(os, 'platform').returns('linux');
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');

			// Mock TMUX available but GDB not available
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});
			findProgramStub.withArgs(TOOLS_REGISTRY.GDB).resolves({ available: false, isCustomPath: false });

			const config = {
				type: 'apLaunch',
				request: 'launch',
				name: 'Linux SITL Debug',
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

		test('should require tmux for SITL debugging on both platforms', async () => {
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');

			// Mock GDB available but tmux not available
			findProgramStub.withArgs(TOOLS_REGISTRY.GDB).resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({ available: false, isCustomPath: false });

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
	});

	suite('Hardware Upload Workflow', () => {
		test('should execute hardware upload command for non-SITL targets', async () => {
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
			assert(mockTerminalMonitor.createTerminal.called, 'Should create terminal');
			assert(mockTerminalMonitor.show.called, 'Should show terminal');
			assert(mockTerminalMonitor.runCommand.calledWith(`cd ${workspaceFolder.uri.fsPath}`), 'Should cd to workspace');
			assert(mockTerminalMonitor.runCommand.calledWith(sinon.match(/python3.*waf.*copter.*--upload/)), 'Should run upload command');
		});

		test('should handle different vehicle types for hardware upload', async () => {
			const vehicles = ['copter', 'plane', 'rover', 'sub'];

			for (const vehicle of vehicles) {
				mockTerminalMonitor.runCommand.resetHistory();

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

				assert(mockTerminalMonitor.runCommand.calledWith(sinon.match(vehicle)), `Should include ${vehicle} in upload command`);
			}
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

			sandbox.stub(ProgramUtils, 'findProgram').resolves({ available: false, isCustomPath: false });

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
	});

	suite('Session Cleanup', () => {
		test('should clean up tmux session when debug session terminates', async () => {
			const mockCleanupTerminal = createMockTerminal();
			const mockDebugTerminal = { dispose: sandbox.stub() };

			sandbox.stub(vscode.window, 'createTerminal').returns(mockCleanupTerminal);
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
				available: true,
				path: '/usr/bin/tmux',
				isCustomPath: false
			});

			// Set up provider state as if SITL session is running
			(provider as any).tmuxSessionName = 'test-session-123';
			(provider as any).debugSessionTerminal = mockDebugTerminal;

			const mockSession = {
				configuration: { type: 'cppdbg' }
			} as vscode.DebugSession;

			// Manually call the handler for testing
			await (provider as any).handleDebugSessionTermination(mockSession);

			assert(mockDebugTerminal.dispose.called);
			assert.strictEqual((provider as any).tmuxSessionName, undefined);
			assert.strictEqual((provider as any).debugSessionTerminal, undefined);
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
			// Mock Linux platform for this test
			sandbox.stub(os, 'platform').returns('linux');

			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			const { TOOLS_REGISTRY } = await import('../../apToolsConfig');
			findProgramStub.withArgs(TOOLS_REGISTRY.GDB).resolves({
				available: true,
				path: '/usr/bin/gdb',
				isCustomPath: false
			});
			findProgramStub.withArgs(TOOLS_REGISTRY.TMUX).resolves({
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
	});
});

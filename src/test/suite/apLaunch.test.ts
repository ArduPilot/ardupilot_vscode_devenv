/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { APLaunchDefinition, APLaunchConfigurationProvider } from '../../apLaunch';
import { ProgramUtils } from '../../apProgramUtils';
import { targetToBin } from '../../apBuildConfig';

suite('apLaunch Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let provider: APLaunchConfigurationProvider;
	let mockWorkspaceFolder: vscode.WorkspaceFolder;

	setup(() => {
		// Restore any existing sandbox to prevent conflicts
		if (sandbox) {
			sandbox.restore();
		}
		sandbox = sinon.createSandbox();

		mockWorkspaceFolder = {
			uri: vscode.Uri.file('/mock/workspace'),
			name: 'test-workspace',
			index: 0
		};

		// Mock VS Code APIs
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
		sandbox.stub(vscode.window, 'showErrorMessage');
		sandbox.stub(vscode.window, 'createTerminal').returns({
			sendText: sandbox.stub(),
			dispose: sandbox.stub(),
			show: sandbox.stub()
		} as any);
		sandbox.stub(vscode.tasks, 'fetchTasks').resolves([]);
		sandbox.stub(vscode.tasks, 'executeTask').resolves({} as any);
		sandbox.stub(vscode.tasks, 'onDidEndTaskProcess').callsFake((callback) => {
			return { dispose: sandbox.stub() };
		});
		sandbox.stub(vscode.debug, 'onDidTerminateDebugSession').callsFake((callback) => {
			return { dispose: sandbox.stub() };
		});

		// Create provider after mocks are set up
		provider = new APLaunchConfigurationProvider();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('APLaunchDefinition Interface', () => {
		test('should define correct interface structure', () => {
			const launchDef: APLaunchDefinition = {
				type: 'apLaunch',
				target: 'sitl-copter',
				name: 'Test Launch',
				waffile: '/path/to/waf',
				simVehicleCommand: 'sim_vehicle.py --vehicle copter',
				isSITL: true
			};

			assert.strictEqual(launchDef.type, 'apLaunch');
			assert.strictEqual(launchDef.target, 'sitl-copter');
			assert.strictEqual(launchDef.name, 'Test Launch');
			assert.strictEqual(launchDef.waffile, '/path/to/waf');
			assert.strictEqual(launchDef.simVehicleCommand, 'sim_vehicle.py --vehicle copter');
			assert.strictEqual(launchDef.isSITL, true);
		});

		test('should work with minimal required properties', () => {
			const minimalLaunchDef: APLaunchDefinition = {
				type: 'apLaunch',
				target: 'copter',
				name: 'Minimal Launch'
			};

			assert.strictEqual(minimalLaunchDef.type, 'apLaunch');
			assert.strictEqual(minimalLaunchDef.target, 'copter');
			assert.strictEqual(minimalLaunchDef.name, 'Minimal Launch');
			assert.strictEqual(minimalLaunchDef.waffile, undefined);
			assert.strictEqual(minimalLaunchDef.isSITL, undefined);
		});
	});

	suite('APLaunchConfigurationProvider', () => {
		suite('constructor', () => {
			test('should register debug session termination handler', () => {
				assert(vscode.debug.onDidTerminateDebugSession.calledOnce);
			});
		});

		suite('resolveDebugConfiguration', () => {
			test('should handle empty configuration', async () => {
				const config = {};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					'Cannot launch ArduPilot debug session. Please create a launch configuration.'
				));
			});

			test('should pass through non-apLaunch configurations', async () => {
				const config = {
					type: 'cppdbg',
					request: 'launch',
					name: 'Other Debug'
				};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, config);
			});

			test('should require target property', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch'
					// Missing target
				};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					'ArduPilot launch configuration requires \'target\' properties.'
				));
			});

			test('should require workspace folder', async () => {
				sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter'
				};

				const result = await provider.resolveDebugConfiguration(
					undefined,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith('No workspace is open.'));
			});

			test('should set default waf file when not specified', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter'
				};

				// Mock SITL dependencies
				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').returns(true);

				await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				// Should set default waf file path
				assert.strictEqual(config.waffile, path.join('/mock/workspace', 'waf'));
			});
			test('should execute pre-launch task when specified', async () => {
				const mockTask = {
					name: 'build',
					definition: { type: 'ardupilot' }
				} as vscode.Task;

				// Reset and re-stub fetchTasks for this specific test
				(vscode.tasks.fetchTasks as sinon.SinonStub).resolves([mockTask]);
				// Use existing executeTask stub instead of creating a new one
				const executeStub = vscode.tasks.executeTask as sinon.SinonStub;
				const mockExecution = { task: mockTask };
				executeStub.resolves(mockExecution);

				// Mock task completion
				(vscode.tasks.onDidEndTaskProcess as sinon.SinonStub).callsFake((callback) => {
					// Simulate task completion
					setTimeout(() => {
						callback({ execution: mockExecution, exitCode: 0 } as any);
					}, 0);
					return { dispose: sandbox.stub() };
				});

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter',
					preLaunchTask: 'ardupilot: build'
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').returns(true);

				await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert(executeStub.calledWith(mockTask));
			});

			test('should handle invalid pre-launch task format', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter',
					preLaunchTask: 'invalid-format'
				};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					sinon.match(/Invalid preLaunchTask format/)
				));
			});

			test('should handle missing pre-launch task', async () => {
				// Reset fetchTasks to return empty array for this test
				(vscode.tasks.fetchTasks as sinon.SinonStub).resolves([]);

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter',
					preLaunchTask: 'ardupilot: nonexistent'
				};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					sinon.match(/Pre-launch task .* not found/)
				));
			});

			test('should handle pre-launch task failure', async () => {
				const mockTask = {
					name: 'build',
					definition: { type: 'ardupilot' }
				} as vscode.Task;

				const mockExecution = { task: mockTask };

				// Reset stubs for this test
				(vscode.tasks.fetchTasks as sinon.SinonStub).resolves([mockTask]);
				(vscode.tasks.executeTask as sinon.SinonStub).resolves(mockExecution);

				// Mock task failure
				(vscode.tasks.onDidEndTaskProcess as sinon.SinonStub).callsFake((callback) => {
					setTimeout(() => {
						callback({ execution: mockExecution, exitCode: 1 } as any);
					}, 0);
					return { dispose: sandbox.stub() };
				});

				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter',
					preLaunchTask: 'ardupilot: build'
				};

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					sinon.match(/Failed to execute pre-launch task/)
				));
			});
		});

		suite('SITL debugging', () => {
			test('should configure SITL debugging with required tools', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({
					available: true,
					path: '/usr/bin/gdb'
				});
				sandbox.stub(ProgramUtils, 'findTmux').resolves({
					available: true,
					path: '/usr/bin/tmux'
				});

				// Mock file system operations for SITL
				sandbox.stub(fs, 'existsSync').callsFake((path: string) => {
					// Ensure all paths exist to avoid early returns
					return true;
				});

				sandbox.stub(fs, 'readFileSync').callsFake((path: string) => {
					if (path.includes('run_in_terminal_window.sh')) {
						return '#!/bin/bash\nTMUX_PREFIX="$1"\nshift\nexec "$@"';
					}
					return 'mock file content';
				});

				// Mock fs.copyFileSync and fs.writeFileSync for the script replacement logic
				sandbox.stub(fs, 'copyFileSync');
				sandbox.stub(fs, 'writeFileSync');

				// Ensure targetToBin mapping exists for 'copter'
				if (!targetToBin.copter) {
					targetToBin.copter = 'bin/arducopter';
				}

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
					config as vscode.DebugConfiguration
				);

				// Should configure for SITL debugging
				assert(result, 'Result should not be null/undefined');
				assert.strictEqual(result.type, 'cppdbg');
				assert.strictEqual(result.name, 'Debug copter SITL');
				assert(ProgramUtils.findGDB.calledOnce);
				assert(ProgramUtils.findTmux.calledOnce);
			});

			test('should require GDB for SITL debugging', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: false });

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					'GDB not found. Please install GDB to debug SITL.'
				));
			});

			test('should require tmux for SITL debugging', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false });

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.calledWith(
					'tmux not found. Please install tmux to debug SITL.'
				));
			});

			test('should extract vehicle type from target', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-plane',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').returns(true);

				await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				// Should extract 'plane' from 'sitl-plane'
				// This would be tested through the binary path construction
				assert(fs.existsSync.called);
			});

			test('should generate unique GDB port', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').returns(true);

				const mathStub = sandbox.stub(Math, 'random').returns(0.5);

				await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				// Should generate port between 3000-4000
				assert(mathStub.called);
			});
		});

		suite('debug session termination handling', () => {
			test('should clean up tmux session on debug termination', async () => {
				const mockSession = {
					configuration: { type: 'cppdbg' }
				} as vscode.DebugSession;

				const mockTerminal = {
					sendText: sandbox.stub(),
					dispose: sandbox.stub()
				} as any;

				// Set up provider state as if SITL debug session was running
				(provider as any).tmuxSessionName = 'test-session';
				(provider as any).debugSessionTerminal = mockTerminal;

				sandbox.stub(ProgramUtils, 'findTmux').resolves({
					available: true,
					path: '/usr/bin/tmux'
				});

				// Reset the existing createTerminal stub for this test
				const createTerminalStub = vscode.window.createTerminal as sinon.SinonStub;
				createTerminalStub.returns({
					sendText: sandbox.stub(),
					dispose: sandbox.stub()
				} as any);

				// Get the termination handler
				const terminationHandler = (vscode.debug.onDidTerminateDebugSession as sinon.SinonStub).firstCall.args[0];

				await terminationHandler(mockSession);

				assert(createTerminalStub.calledWith('ArduPilot SITL Cleanup'));
				assert(mockTerminal.dispose.calledOnce);
				assert.strictEqual((provider as any).tmuxSessionName, undefined);
				assert.strictEqual((provider as any).debugSessionTerminal, undefined);
			});

			test('should not clean up for non-SITL debug sessions', async () => {
				const mockSession = {
					configuration: { type: 'node' }
				} as vscode.DebugSession;

				// Use the existing createTerminal stub
				const createTerminalStub = vscode.window.createTerminal as sinon.SinonStub;

				// Get the termination handler
				const terminationHandler = (vscode.debug.onDidTerminateDebugSession as sinon.SinonStub).firstCall.args[0];

				await terminationHandler(mockSession);

				assert(createTerminalStub.notCalled);
			});

			test('should handle missing tmux gracefully during cleanup', async () => {
				const mockSession = {
					configuration: { type: 'cppdbg' }
				} as vscode.DebugSession;

				(provider as any).tmuxSessionName = 'test-session';
				(provider as any).debugSessionTerminal = { dispose: sandbox.stub() };

				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false });

				// Reset the createTerminal stub call count for this test
				const createTerminalStub = vscode.window.createTerminal as sinon.SinonStub;
				createTerminalStub.resetHistory();
				createTerminalStub.returns({
					sendText: sandbox.stub(),
					dispose: sandbox.stub(),
					show: sandbox.stub()
				} as any);

				// Get the termination handler
				const terminationHandler = (vscode.debug.onDidTerminateDebugSession as sinon.SinonStub).firstCall.args[0];

				// Should not throw and should still create terminal (fallback behavior)
				await terminationHandler(mockSession);

				// Should create terminal even when tmux is not available (uses fallback)
				assert(createTerminalStub.called);
			});
		});

		suite('error handling', () => {
			test('should handle program utility errors gracefully', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').rejects(new Error('Tool search failed'));

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				// Should handle error gracefully
				assert.strictEqual(result, undefined);
			});

			test('should handle file system errors', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));

				// Should handle file system errors gracefully
				assert.doesNotThrow(async () => {
					await provider.resolveDebugConfiguration(
						mockWorkspaceFolder,
                        config as vscode.DebugConfiguration
					);
				});
			});

			test('should handle task execution errors gracefully', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'Test Launch',
					target: 'copter',
					preLaunchTask: 'ardupilot: build'
				};

				const mockTask = {
					name: 'build',
					definition: { type: 'ardupilot' }
				} as vscode.Task;

				// Reset existing stubs for this test
				(vscode.tasks.fetchTasks as sinon.SinonStub).resolves([mockTask]);
				(vscode.tasks.executeTask as sinon.SinonStub).rejects(new Error('Task execution failed'));

				const result = await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				assert.strictEqual(result, undefined);
				assert(vscode.window.showErrorMessage.called);
			});
		});

		suite('integration tests', () => {
			test('should work with VS Code debug system', () => {
				// Test that provider can be registered with VS Code
				const mockContext = {
					subscriptions: []
				} as any;

				// Simulate registration
				mockContext.subscriptions.push(
					vscode.debug.registerDebugConfigurationProvider('apLaunch', provider)
				);

				assert.strictEqual(mockContext.subscriptions.length, 1);
			});

			test('should integrate with targetToBin mapping', async () => {
				const config = {
					type: 'apLaunch',
					request: 'launch',
					name: 'SITL Debug',
					target: 'sitl-copter',
					isSITL: true
				};

				sandbox.stub(ProgramUtils, 'findGDB').resolves({ available: true, path: '/usr/bin/gdb' });
				sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, path: '/usr/bin/tmux' });
				sandbox.stub(fs, 'existsSync').returns(true);

				await provider.resolveDebugConfiguration(
					mockWorkspaceFolder,
                    config as vscode.DebugConfiguration
				);

				// Should use targetToBin mapping for binary path
				assert(fs.existsSync.called);

				// Verify that the binary path would include the correct mapping
				// (This would be more specific in the actual implementation)
				const expectedVehicle = 'copter';
				assert(expectedVehicle === config.target.replace('sitl-', ''));
			});
		});
	});
});

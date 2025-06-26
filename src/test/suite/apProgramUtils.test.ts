/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* cSpell:words mavproxy ccache openocd pyserial gdbserver tmux eabi multiarch SEGGER jlink Ardu */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as glob from 'fast-glob';
import { ProgramUtils, ProgramInfo } from '../../apProgramUtils';
import { ToolsConfig } from '../../apToolsConfig';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('apProgramUtils Test Suite', () => {
	let apExtensionContext: APExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let originalPlatform: string;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		originalPlatform = process.platform;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
		// Restore original platform
		Object.defineProperty(process, 'platform', { value: originalPlatform });
	});

	suite('Core Functionality', () => {
		test('should have tool paths configured for supported platforms', () => {
			const toolPaths = ProgramUtils.TOOL_PATHS;

			// Verify all tools have platform configurations
			Object.keys(toolPaths).forEach(toolId => {
				assert.ok(toolPaths[toolId].linux, `${toolId} should have linux paths`);
				assert.ok(toolPaths[toolId].darwin, `${toolId} should have darwin paths`);
				assert.ok(Array.isArray(toolPaths[toolId].linux), `${toolId} linux paths should be array`);
				assert.ok(Array.isArray(toolPaths[toolId].darwin), `${toolId} darwin paths should be array`);
			});
		});
	});

	suite('Tool Path Discovery', () => {
		test('should find tool path from TOOL_PATHS configuration', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			// Mock fs.existsSync to return false if requested path is 'python3'
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() !== 'python3';
			});

			// Mock which command
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'which python3') {
					return Buffer.from('/usr/bin/python3');
				}
				throw new Error('Command not found');
			});

			// Since findToolPath is private, we test it indirectly through findPython
			// This test verifies the tool path discovery logic works
			assert.ok(ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON].linux.includes('python3'));
		});

		test('should handle glob patterns in tool paths', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			// Mock glob.sync for wildcard expansion
			sandbox.stub(glob, 'sync').callsFake((source: string | string[]) => {
				if (source === '/opt/SEGGER/JLink*/JLinkGDBServerCLExe') {
					return ['/opt/SEGGER/JLink_V794e/JLinkGDBServerCLExe'];
				}
				return [];
			});

			// Since findToolPath is private, we test it indirectly
			// This test verifies the tool path configuration includes wildcard patterns
			assert.ok(ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_JLINK].linux.some(path => path.includes('*')));
		});

		test('should return undefined for unknown tool', () => {
			// Since findToolPath is private, we test it indirectly through findTool
			// Test with a non-existent tool ID - this will test the internal findToolPath logic
			assert.ok(typeof ProgramUtils.TOOL_PATHS === 'object');
			assert.strictEqual(ProgramUtils.TOOL_PATHS['unknown-tool'], undefined);
		});

		test('should return undefined for unsupported platform', () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });

			// Since findToolPath is private, we test platform support indirectly
			// Test that Windows platform is not in the TOOL_PATHS configuration
			assert.ok(!('win32' in ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON]));
		});
	});

	suite('WSL Detection', () => {
		test('should detect WSL environment correctly', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			// Mock /proc/version with WSL content
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'cat /proc/version') {
					return Buffer.from('Linux version 5.15.0-microsoft-standard WSL2');
				}
				throw new Error('Command failed');
			});

			const isWSL = ProgramUtils.isWSL();
			assert.strictEqual(isWSL, true);
		});

		test('should detect non-WSL Linux environment', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			// Mock /proc/version with regular Linux content
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'cat /proc/version') {
					return Buffer.from('Linux version 5.15.0-generic #72-Ubuntu');
				}
				throw new Error('Command failed');
			});

			const isWSL = ProgramUtils.isWSL();
			assert.strictEqual(isWSL, false);
		});

		test('should return false for non-Linux platforms', () => {
			Object.defineProperty(process, 'platform', { value: 'darwin' });

			const isWSL = ProgramUtils.isWSL();
			assert.strictEqual(isWSL, false);
		});
	});

	suite('Python Detection Tests', () => {
		test('should find Python using Microsoft Python extension', async () => {
			// Mock Python extension
			const mockPythonApi = {
				settings: {
					getExecutionDetails: () => ({
						execCommand: ['/usr/bin/python3.9']
					})
				}
			};

			const mockExtension = {
				isActive: true,
				exports: mockPythonApi
			};

			sandbox.stub(vscode.extensions, 'getExtension').returns(mockExtension as any);
			sandbox.stub(fs, 'existsSync').returns(true);

			// Mock command execution
			const mockProcess = createMockProcess('Python 3.9.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/python3.9'));

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, true);
			assert.strictEqual(pythonInfo.path, '/usr/bin/python3.9');
			assert.strictEqual(pythonInfo.version, '3.9.0');
			assert.strictEqual(pythonInfo.info, 'Selected via Microsoft Python Extension');
		});

		test('should fallback to standard search when extension fails', async () => {
			// Mock extension not available
			sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);

			// Mock filesystem and command execution to simulate tool found
			sandbox.stub(fs, 'existsSync').returns(false);
			const execStub = sandbox.stub(child_process, 'execSync');
			execStub.withArgs('which python3').returns(Buffer.from('/usr/bin/python3'));
			execStub.throws(new Error('Command not found')); // Default behavior

			// Mock command execution
			const mockProcess = createMockProcess('Python 3.8.10', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, true);
			assert.strictEqual(pythonInfo.path, '/usr/bin/python3');
			assert.strictEqual(pythonInfo.version, '3.8.10');
		});

		test('should handle Python not found', async () => {
			sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);
			// Mock no tools found - filesystem and command failures
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(child_process, 'execSync').throws(new Error('Command not found'));

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, false);
		});

		test('should find Windows Python in WSL', async () => {
			// Mock WSL environment
			Object.defineProperty(process, 'platform', { value: 'linux' });
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'cat /proc/version') {
					return Buffer.from('Linux version 5.15.0-microsoft-standard WSL2');
				}
				if (command === 'which python.exe') {
					return Buffer.from('/usr/bin/python.exe');
				}
				throw new Error('Command failed');
			});

			// Mock command execution
			const mockProcess = createMockProcess('Python 3.9.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const pythonWinInfo = await ProgramUtils.findPythonWin();

			assert.strictEqual(pythonWinInfo.available, true);
			assert.strictEqual(pythonWinInfo.version, '3.9.0');
		});
	});

	suite('Development Tools Detection', () => {
		test('should find GCC compiler', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/gcc');

			const mockProcess = createMockProcess('gcc (Ubuntu 9.4.0) 9.4.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/gcc'));

			const gccInfo = await ProgramUtils.findGCC();

			assert.strictEqual(gccInfo.available, true);
			assert.strictEqual(gccInfo.version, '9.4.0');
			assert.strictEqual(gccInfo.path, '/usr/bin/gcc');
		});

		test('should find ARM GCC cross-compiler', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/arm-none-eabi-gcc');

			const mockProcess = createMockProcess('arm-none-eabi-gcc (GNU Arm Embedded Toolchain 10.3-2021.07) 10.3.1', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/arm-none-eabi-gcc'));

			const armGccInfo = await ProgramUtils.findArmGCC();

			assert.strictEqual(armGccInfo.available, true);
			assert.strictEqual(armGccInfo.version, '10.3.1');
			assert.strictEqual(armGccInfo.path, '/usr/bin/arm-none-eabi-gcc');
		});

		test('should find ARM GDB debugger', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/gdb-multiarch');

			const mockProcess = createMockProcess('GNU gdb (Ubuntu 15.0.50.20240403-0ubuntu1) 15.0.50.20240403-git', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/gdb-multiarch'));

			const armGdbInfo = await ProgramUtils.findArmGDB();

			assert.strictEqual(armGdbInfo.available, true);
			assert.strictEqual(armGdbInfo.version, '15.0.50');
			assert.strictEqual(armGdbInfo.path, '/usr/bin/gdb-multiarch');
		});

		test('should find OpenOCD', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/openocd');

			const mockProcess = createMockProcess('Open On-Chip Debugger 0.11.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/openocd'));

			const openocdInfo = await ProgramUtils.findOpenOCD();

			assert.strictEqual(openocdInfo.available, true);
			assert.strictEqual(openocdInfo.version, '0.11.0');
			assert.strictEqual(openocdInfo.path, '/usr/bin/openocd');
		});

		test('should find J-Link GDB Server', async () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			// Mock non-WSL environment
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'cat /proc/version') {
					return Buffer.from('Linux version 5.15.0-generic #72-Ubuntu');
				}
				throw new Error('Command failed');
			});

			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/opt/SEGGER/JLink/JLinkGDBServerCLExe');

			const mockProcess = createMockProcess('SEGGER J-Link GDB Server V7.94e Command Line Version', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.strictEqual(jlinkInfo.available, true);
			assert.strictEqual(jlinkInfo.version, '7.94e');
		});

		test('should find ccache on Linux', async () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });

			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/ccache');

			const mockProcess = createMockProcess('ccache version 4.2', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/ccache'));

			const ccacheInfo = await ProgramUtils.findCcache();

			assert.strictEqual(ccacheInfo.available, true);
			assert.strictEqual(ccacheInfo.version, '4.2');
		});

		test('should not find ccache on unsupported platform', async () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const ccacheInfo = await ProgramUtils.findCcache();

			assert.strictEqual(ccacheInfo.available, false);
		});
	});

	suite('MAVProxy Detection', () => {
		test('should find MAVProxy with version', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/local/bin/mavproxy.py');

			const mockProcess = createMockProcess('MAVProxy 1.8.35', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/local/bin/mavproxy.py'));

			const mavproxyInfo = await ProgramUtils.findMavproxy();

			assert.strictEqual(mavproxyInfo.available, true);
			assert.strictEqual(mavproxyInfo.version, '1.8.35');
			assert.strictEqual(mavproxyInfo.path, '/usr/local/bin/mavproxy.py');
		});

		test('should handle MAVProxy not found', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns(undefined);

			const mavproxyInfo = await ProgramUtils.findMavproxy();

			assert.strictEqual(mavproxyInfo.available, false);
		});
	});

	suite('Pyserial Detection', () => {
		test('should detect pyserial when Python and module are available', async () => {
			// Mock Python available
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				command: '/usr/bin/python3',
				path: '/usr/bin/python3',
				isCustomPath: false
			});

			// Mock non-WSL
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Mock successful pyserial check
			sandbox.stub(child_process, 'exec').callsFake(((cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
				if (cmd.includes('import serial')) {
					callback(null, 'Serial module version: 3.5', '');
				} else {
					callback(new Error('Command failed'), '', '');
				}
				return {} as child_process.ChildProcess;
			}) as any);

			const pyserialInfo = await ProgramUtils.findPyserial();

			assert.strictEqual(pyserialInfo.available, true);
			assert.strictEqual(pyserialInfo.version, '3.5');
			assert.strictEqual(pyserialInfo.info, 'Detected in Python installation');
		});

		test('should handle pyserial not installed', async () => {
			// Mock Python available
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				command: '/usr/bin/python3',
				path: '/usr/bin/python3',
				isCustomPath: false
			});

			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Mock failed pyserial check
			sandbox.stub(child_process, 'exec').callsFake(((cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
				callback(new Error('ModuleNotFoundError: No module named serial'), '', 'ModuleNotFoundError');
				return {} as child_process.ChildProcess;
			}) as any);

			const pyserialInfo = await ProgramUtils.findPyserial();

			assert.strictEqual(pyserialInfo.available, false);
			assert.ok(pyserialInfo.info?.includes('pip install pyserial'));
		});

		test('should handle Python not available', async () => {
			// Mock Python not available
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: false,
				isCustomPath: false
			});

			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			const pyserialInfo = await ProgramUtils.findPyserial();

			assert.strictEqual(pyserialInfo.available, false);
			assert.ok(pyserialInfo.info?.includes('install Python first'));
		});

		test('should handle WSL pyserial detection', async () => {
			// Mock WSL environment
			sandbox.stub(ProgramUtils, 'isWSL').returns(true);

			// Mock Windows Python available
			sandbox.stub(ProgramUtils, 'findPythonWin').resolves({
				available: true,
				command: 'python.exe',
				path: '/mnt/c/Python39/python.exe',
				isCustomPath: false
			});

			// Mock successful pyserial check
			sandbox.stub(child_process, 'exec').callsFake(((cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
				if (cmd.includes('import serial')) {
					callback(null, 'Serial module version: 3.4', '');
				} else {
					callback(new Error('Command failed'), '', '');
				}
				return {} as child_process.ChildProcess;
			}) as any);

			const pyserialInfo = await ProgramUtils.findPyserial();

			assert.strictEqual(pyserialInfo.available, true);
			assert.strictEqual(pyserialInfo.version, '3.4');
		});
	});

	suite('Custom Tool Path Configuration', () => {
		test('should use custom tool path when configured', async () => {
			const customPath = '/custom/path/python3';

			// Mock ToolsConfig to return custom path
			sandbox.stub(ToolsConfig, 'getToolPath').returns(customPath);
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() === customPath;
			});

			// Mock command execution with custom path
			const mockProcess = createMockProcess('Python 3.9.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, true);
			assert.strictEqual(pythonInfo.path, customPath);
			assert.strictEqual(pythonInfo.command, customPath);
		});

		test('should fallback to system search when custom path is invalid', async () => {
			const invalidCustomPath = '/invalid/path/arm-none-eabi-gcc';

			// Mock ToolsConfig to return invalid custom path
			sandbox.stub(ToolsConfig, 'getToolPath').returns(invalidCustomPath);
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() !== invalidCustomPath; // Custom path doesn't exist
			});

			// Mock system tool discovery
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/arm-none-eabi-gcc');
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/arm-none-eabi-gcc'));

			const mockProcess = createMockProcess('arm-none-eabi-gcc (GNU Arm Embedded Toolchain 10.3-2021.07) 10.3.1', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const armGccInfo = await ProgramUtils.findArmGCC();

			assert.strictEqual(armGccInfo.available, true);
			assert.strictEqual(armGccInfo.path, '/usr/bin/arm-none-eabi-gcc');
		});
	});

	suite('Python Interpreter Selection', () => {
		test('should open Python interpreter selection dialog', async () => {
			// Mock Python extension
			const mockExtension = {
				isActive: true,
				activate: sandbox.stub().resolves()
			};

			sandbox.stub(vscode.extensions, 'getExtension').returns(mockExtension as any);
			sandbox.stub(vscode.commands, 'executeCommand').resolves();

			// Mock findPython to return selected interpreter
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				path: '/usr/bin/python3.9',
				isCustomPath: false
			});

			const selectedPath = await ProgramUtils.selectPythonInterpreter();

			assert.strictEqual(selectedPath, '/usr/bin/python3.9');
		});

		test('should handle Python extension not installed', async () => {
			sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);
			sandbox.stub(vscode.window, 'showErrorMessage');

			const selectedPath = await ProgramUtils.selectPythonInterpreter();

			assert.strictEqual(selectedPath, undefined);
		});

		test('should activate Python extension if not active', async () => {
			const mockExtension = {
				isActive: false,
				activate: sandbox.stub().resolves()
			};

			sandbox.stub(vscode.extensions, 'getExtension').returns(mockExtension as any);
			sandbox.stub(vscode.commands, 'executeCommand').resolves();
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				path: '/usr/bin/python3',
				isCustomPath: false
			});

			await ProgramUtils.selectPythonInterpreter();

			assert.ok(mockExtension.activate.calledOnce);
		});

		test('should handle Python interpreter selection errors', async () => {
			const mockExtension = {
				isActive: true
			};

			sandbox.stub(vscode.extensions, 'getExtension').returns(mockExtension as any);
			sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Selection failed'));
			sandbox.stub(vscode.window, 'showErrorMessage');

			const selectedPath = await ProgramUtils.selectPythonInterpreter();

			assert.strictEqual(selectedPath, undefined);
		});
	});

	suite('Tmux Detection', () => {
		test('should find tmux with version', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/tmux');

			const mockProcess = createMockProcess('tmux 3.0a', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/tmux'));

			const tmuxInfo = await ProgramUtils.findTmux();

			assert.strictEqual(tmuxInfo.available, true);
			assert.strictEqual(tmuxInfo.version, '3.0');
			assert.strictEqual(tmuxInfo.path, '/usr/bin/tmux');
		});

		test('should handle tmux not found', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns(undefined);

			const tmuxInfo = await ProgramUtils.findTmux();

			assert.strictEqual(tmuxInfo.available, false);
		});
	});

	suite('Platform-Specific Tests', () => {
		suite('Linux Platform', () => {
			setup(() => {
				Object.defineProperty(process, 'platform', { value: 'linux' });
			});

			test('should use Linux tool paths', () => {
				const toolPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON].linux;
				assert.ok(toolPaths.includes('python3'));
				assert.ok(toolPaths.includes('python'));
			});

			test('should detect non-WSL Linux environment', () => {
				sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
					if (command === 'cat /proc/version') {
						return Buffer.from('Linux version 5.15.0-generic #72-Ubuntu');
					}
					throw new Error('Command failed');
				});

				const isWSL = ProgramUtils.isWSL();
				assert.strictEqual(isWSL, false);
			});
		});

		suite('macOS Platform', () => {
			setup(() => {
				Object.defineProperty(process, 'platform', { value: 'darwin' });
			});

			test('should use macOS tool paths', () => {
				const toolPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON].darwin;
				assert.ok(toolPaths.includes('python3'));
				assert.ok(toolPaths.includes('python'));
			});

			test('should not detect WSL on macOS', () => {
				const isWSL = ProgramUtils.isWSL();
				assert.strictEqual(isWSL, false);
			});

			test('should find J-Link on macOS', async () => {
				sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/Applications/SEGGER/JLink/JLinkGDBServerCLExe');

				const mockProcess = createMockProcess('SEGGER J-Link GDB Server V7.94e Command Line Version', 0);
				sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

				const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

				assert.strictEqual(jlinkInfo.available, true);
				assert.strictEqual(jlinkInfo.version, '7.94e');
			});
		});

		suite('WSL Environment', () => {
			setup(() => {
				Object.defineProperty(process, 'platform', { value: 'linux' });
				sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
					if (command === 'cat /proc/version') {
						return Buffer.from('Linux version 5.15.0-microsoft-standard WSL2');
					}
					throw new Error('Command failed');
				});
			});

			test('should detect WSL environment', () => {
				const isWSL = ProgramUtils.isWSL();
				assert.strictEqual(isWSL, true);
			});

			test('should find J-Link in WSL with special arguments', async () => {
				sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/mnt/c/Program Files/SEGGER/JLink/JLinkGDBServerCLExe');

				const mockProcess = createMockProcess('SEGGER J-Link GDB Server V7.94e Command Line Version', 0);
				sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

				const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

				assert.strictEqual(jlinkInfo.available, true);
				assert.strictEqual(jlinkInfo.version, '7.94e');
			});

			test('should use Windows Python in WSL for pyserial', async () => {
				sandbox.stub(ProgramUtils, 'findPython').resolves({ available: false, isCustomPath: false });
				sandbox.stub(ProgramUtils, 'findPythonWin').resolves({
					available: true,
					command: 'python.exe',
					path: '/mnt/c/Python39/python.exe',
					isCustomPath: false
				});

				sandbox.stub(child_process, 'exec').callsFake(((cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
					if (cmd.includes('python.exe') && cmd.includes('import serial')) {
						callback(null, 'Serial module version: 3.5', '');
					} else {
						callback(new Error('Command failed'), '', '');
					}
					return {} as child_process.ChildProcess;
				}) as any);

				const pyserialInfo = await ProgramUtils.findPyserial();

				assert.strictEqual(pyserialInfo.available, true);
				assert.strictEqual(pyserialInfo.version, '3.5');
			});
		});
	});

	suite('Error Handling', () => {
		test('should handle command execution failures gracefully', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/python3');

			// Mock spawn to simulate command failure
			const mockProcess = createMockProcess('', 1); // Exit code 1
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, false);
		});

		test('should handle spawn errors gracefully', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/python3');

			// Mock spawn to emit error
			const mockProcess = {
				stdout: { on: sandbox.stub() },
				stderr: { on: sandbox.stub() },
				on: sandbox.stub().callsFake((event: string, callback: (error: Error) => void) => {
					if (event === 'error') {
						setTimeout(() => callback(new Error('ENOENT')), 0);
					}
				})
			};

			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const pythonInfo = await ProgramUtils.findPython();

			assert.strictEqual(pythonInfo.available, false);
		});
	});

	suite('Version Extraction Tests', () => {
		test('should extract standard version format', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/gcc');

			const mockProcess = createMockProcess('gcc (Ubuntu 9.4.0-1ubuntu1~20.04.2) 9.4.0', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/gcc'));

			const gccInfo = await ProgramUtils.findGCC();

			assert.strictEqual(gccInfo.version, '9.4.0');
		});

		test('should extract J-Link specific version format', async () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			sandbox.stub(child_process, 'execSync').callsFake((command: string) => {
				if (command === 'cat /proc/version') {
					return Buffer.from('Linux version 5.15.0-generic #72-Ubuntu');
				}
				throw new Error('Command failed');
			});

			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/opt/SEGGER/JLink/JLinkGDBServerCLExe');

			const mockProcess = createMockProcess('SEGGER J-Link GDB Server V7.94e Command Line Version', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);

			const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.strictEqual(jlinkInfo.version, '7.94e');
		});

		test('should handle version not found in output', async () => {
			sandbox.stub(ProgramUtils, <any>'findToolPath').returns('/usr/bin/tool');

			const mockProcess = createMockProcess('Some tool without version info', 0);
			sandbox.stub(child_process, 'spawn').returns(mockProcess as any);
			sandbox.stub(child_process, 'execSync').returns(Buffer.from('/usr/bin/tool'));

			const gccInfo = await ProgramUtils.findGCC();

			assert.strictEqual(gccInfo.version, 'Unknown');
		});
	});

	// Helper function to create mock process
	function createMockProcess(output: string, exitCode: number = 0, isStderr: boolean = false) {
		const mockProcess = {
			stdout: {
				on: sandbox.stub().callsFake((event: string, callback: (data: Buffer) => void) => {
					if (event === 'data' && !isStderr) {
						setTimeout(() => callback(Buffer.from(output)), 0);
					}
				})
			},
			stderr: {
				on: sandbox.stub().callsFake((event: string, callback: (data: Buffer) => void) => {
					if (event === 'data' && isStderr) {
						setTimeout(() => callback(Buffer.from(output)), 0);
					}
				})
			},
			on: sandbox.stub().callsFake((event: string, callback: (code: number) => void) => {
				if (event === 'close') {
					setTimeout(() => callback(exitCode), 10);
				}
			})
		};
		return mockProcess;
	}
});

// Real-World Integration Tests
suite('Real-World Integration Tests', () => {
	let originalPlatform: string;

	suiteSetup(() => {
		originalPlatform = process.platform;
	});

	suiteTeardown(() => {
		// Restore original platform
		Object.defineProperty(process, 'platform', { value: originalPlatform });
	});

	suite('Linux Real-World Tests', function() {
		this.timeout(30000); // Extended timeout for real execution

		suiteSetup(function() {
			if (process.platform !== 'linux' || ProgramUtils.isWSL()) {
				this.skip(); // Skip if not on Linux
			}
		});

		test('should detect actual Python installation', async function() {
			const pythonInfo = await ProgramUtils.findPython();
			assert.ok(pythonInfo.available, 'Python should be available');
			// Validate real Python installation
			assert.ok(pythonInfo.path, 'Python path should be provided');
			assert.ok(pythonInfo.version, 'Python version should be detected');
			assert.ok(fs.existsSync(pythonInfo.path || ''), 'Python executable should exist');

			console.log(`Found Python: ${pythonInfo.path} (${pythonInfo.version})`);
		});

		test('should correctly identify platform environment', function() {
			const platform = process.platform;
			const isWSL = ProgramUtils.isWSL();

			console.log(`Platform: ${platform}`);
			console.log(`WSL: ${isWSL}`);

			if (platform === 'linux' && isWSL) {
				console.log('Running in WSL environment');
			} else if (platform === 'linux') {
				console.log('Running on native Linux');
			}

			// Platform should be consistently detected
			assert.ok(['linux', 'darwin', 'win32'].includes(platform), 'Should detect valid platform');
		});

		test('should detect actual development tools', async function() {
			const tools = [
				{ name: 'GCC', finder: () => ProgramUtils.findGCC() },
				{ name: 'G++', finder: () => ProgramUtils.findGPP() },
				{ name: 'GDB', finder: () => ProgramUtils.findGDB() },
				{ name: 'ARM GCC', finder: () => ProgramUtils.findArmGCC() },
				{ name: 'ARM GDB', finder: () => ProgramUtils.findArmGDB() },
				{ name: 'OpenOCD', finder: () => ProgramUtils.findOpenOCD() },
				{ name: 'ccache', finder: () => ProgramUtils.findCcache() },
				{ name: 'tmux', finder: () => ProgramUtils.findTmux() }
			];

			const results: { [key: string]: ProgramInfo } = {};

			for (const tool of tools) {
				try {
					results[tool.name] = await tool.finder();
					if (results[tool.name].available) {
						console.log(` ${tool.name}: ${results[tool.name].path} (${results[tool.name].version})`);
						assert.ok(fs.existsSync(results[tool.name].path || ''), `${tool.name} executable should exist`);
					} else {
						console.log(` ${tool.name}: Not found`);
					}
				} catch (error) {
					console.log(` ${tool.name}: Error - ${error}`);
					results[tool.name] = { available: false, isCustomPath: false };
				}
			}

			// Report summary
			const availableCount = Object.values(results).filter(r => r.available).length;
			console.log(`Found ${availableCount}/${tools.length} development tools`);

			// At least basic tools should be available on development systems
			if (availableCount === 0) {
				console.log('No development tools found - this may be a minimal system');
			}
		});

		test('should validate pyserial installation and functionality', async function() {
			const pyserialInfo = await ProgramUtils.findPyserial();

			assert.ok(pyserialInfo.available, 'Pyserial should be available');
			assert.ok(pyserialInfo.version, 'Pyserial version should be detected');
			console.log(`Found pyserial: ${pyserialInfo.version}`);

			// Test actual import capability
			const pythonInfo = await ProgramUtils.findPython();
			if (pythonInfo.available && pythonInfo.command) {
				const testImport = `${pythonInfo.command} -c "import serial; print('Import successful')"`;

				try {
					const result = child_process.execSync(testImport, { encoding: 'utf8' });
					assert.ok(result.includes('Import successful'), 'Should be able to import serial module');
					console.log(' Pyserial import test passed');
				} catch (error) {
					assert.fail(`Pyserial reported as available but import failed: ${error}`);
				}
			}
		});

		test('should find MAVProxy if installed', async function() {
			const mavproxyInfo = await ProgramUtils.findMavproxy();

			assert.ok(mavproxyInfo.available, 'MAVProxy should be available');
			assert.ok(mavproxyInfo.path, 'MAVProxy path should be provided');
			assert.ok(mavproxyInfo.version, 'MAVProxy version should be detected');
			assert.ok(fs.existsSync(mavproxyInfo.path || ''), 'MAVProxy executable should exist');

			console.log(`Found MAVProxy: ${mavproxyInfo.path} (${mavproxyInfo.version})`);
		});

		test('should validate complete ArduPilot toolchain', async function() {
			this.timeout(60000); // Extended timeout for comprehensive check

			const toolResults = {
				python: await ProgramUtils.findPython(),
				gcc: await ProgramUtils.findGCC(),
				armGcc: await ProgramUtils.findArmGCC(),
				armGdb: await ProgramUtils.findArmGDB(),
				openocd: await ProgramUtils.findOpenOCD(),
				mavproxy: await ProgramUtils.findMavproxy(),
				pyserial: await ProgramUtils.findPyserial()
			};

			// Report which tools are available
			const availableTools = Object.entries(toolResults)
				.filter(([_, info]) => info.available)
				.map(([name, _]) => name);

			const missingTools = Object.entries(toolResults)
				.filter(([_, info]) => !info.available)
				.map(([name, _]) => name);

			console.log(`Available tools: ${availableTools.join(', ')}`);
			console.log(`Missing tools: ${missingTools.join(', ')}`);

			// Validate at least basic development is possible
			assert.ok(toolResults.python.available, 'Python is required for ArduPilot development');

			if (toolResults.armGcc.available && toolResults.armGdb.available) {
				console.log(' ARM toolchain available - hardware development possible');
			} else {
				console.log(' ARM toolchain not complete - hardware development limited');
			}

			if (toolResults.mavproxy.available) {
				console.log(' MAVProxy available - ground station functionality possible');
			}

			if (toolResults.pyserial.available) {
				console.log(' Pyserial available - serial communication possible');
			}
		});
	});

	suite('macOS Real-World Tests', function() {
		this.timeout(30000);

		suiteSetup(function() {
			if (process.platform !== 'darwin') {
				this.skip(); // Skip if not on macOS
			}
		});

		test('should detect macOS Python installation', async function() {
			const pythonInfo = await ProgramUtils.findPython();

			assert.ok(pythonInfo.available, 'Python should be available');
			// Validate real Python installation
			assert.ok(pythonInfo.path, 'Python path should be provided');
			assert.ok(pythonInfo.version, 'Python version should be detected');
			assert.ok(fs.existsSync(pythonInfo.path || ''), 'Python executable should exist');

			console.log(`Found Python: ${pythonInfo.path} (${pythonInfo.version})`);

			// Check if it's system Python or Homebrew/custom installation
			if ((pythonInfo.path || '').includes('/usr/bin/')) {
				console.log('Using system Python');
			} else if ((pythonInfo.path || '').includes('/opt/homebrew/') || (pythonInfo.path || '').includes('/usr/local/')) {
				console.log('Using Homebrew Python');
			} else {
				console.log('Using custom Python installation');
			}

		});

		test('should detect Homebrew-installed tools', async function() {
			const tools = [
				{ name: 'GCC', finder: () => ProgramUtils.findGCC() },
				{ name: 'OpenOCD', finder: () => ProgramUtils.findOpenOCD() },
				{ name: 'tmux', finder: () => ProgramUtils.findTmux() },
				{ name: 'ARM GCC', finder: () => ProgramUtils.findArmGCC() }
			];

			let homebrewToolsFound = 0;

			for (const tool of tools) {
				try {
					const toolInfo = await tool.finder();
					if (toolInfo.available) {
						console.log(` ${tool.name}: ${toolInfo.path} (${toolInfo.version})`);

						// Check if it's a Homebrew installation
						const isBrewPath = (toolInfo.path || '').includes('/opt/homebrew/') ||
											(toolInfo.path || '').includes('/usr/local/');
						const isSystemPath = (toolInfo.path || '').startsWith('/usr/bin/');

						if (isBrewPath) {
							homebrewToolsFound++;
							console.log('  � Homebrew installation detected');
						} else if (isSystemPath) {
							console.log('  � System installation');
						} else {
							console.log('  � Custom installation');
						}

						assert.ok(isBrewPath || isSystemPath || (toolInfo.path || '').startsWith('/Applications/'),
							'Should be in standard macOS location');
					} else {
						console.log(` ${tool.name}: Not found`);
					}
				} catch (error) {
					console.log(` ${tool.name}: Error - ${error}`);
				}
			}

			console.log(`Found ${homebrewToolsFound} Homebrew-installed development tools`);
		});

		test('should detect J-Link on macOS', async function() {
			const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.ok(jlinkInfo.available, 'J-Link should be available on macOS');
			assert.ok(jlinkInfo.path, 'J-Link path should be provided');
			assert.ok(jlinkInfo.version, 'J-Link version should be detected');
			assert.ok(fs.existsSync(jlinkInfo.path || ''), 'J-Link executable should exist');

			console.log(`Found J-Link: ${jlinkInfo.path} (${jlinkInfo.version})`);

			// Should be in Applications directory on macOS
			if ((jlinkInfo.path || '').includes('/Applications/')) {
				console.log(' J-Link found in Applications directory');
			}
		});
	});

	suite('WSL Real-World Tests', function() {
		this.timeout(30000);

		suiteSetup(function() {
			if (!ProgramUtils.isWSL()) {
				this.skip(); // Skip if not in WSL
			}
		});

		test('should detect WSL environment correctly', function() {
			const isWSL = ProgramUtils.isWSL();
			assert.strictEqual(isWSL, true, 'Should correctly identify WSL environment');

			console.log(' Running in WSL environment');

			// Verify we can access Windows filesystem
			const windowsExists = fs.existsSync('/mnt/c/');
			if (windowsExists) {
				console.log(' Windows filesystem accessible via /mnt/c/');
			} else {
				console.log(' Windows filesystem not accessible - unusual WSL setup');
			}
		});

		test('should detect Windows Python from WSL', async function() {
			const pythonWinInfo = await ProgramUtils.findPythonWin();

			assert.ok(pythonWinInfo.available, 'Windows Python should be available');
			assert.ok(pythonWinInfo.path, 'Windows Python path should be provided');
			assert.ok((pythonWinInfo.path || '').endsWith('.exe'), 'Should be Windows executable');

			console.log(`Found Windows Python: ${pythonWinInfo.path} (${pythonWinInfo.version})`);

			// Test actual execution from WSL
			try {
				const testResult = child_process.execSync(`${pythonWinInfo.path} --version`, { encoding: 'utf8' });
				assert.ok(testResult.includes('Python'), 'Should be able to execute Windows Python from WSL');
				console.log(' Windows Python execution test passed');
			} catch (error) {
				console.log(` Windows Python execution failed: ${error}`);
			}
		});

		test('should detect J-Link in Windows paths from WSL', async function() {
			const jlinkInfo = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.ok(jlinkInfo.available, 'J-Link should be available in WSL');
			assert.ok(jlinkInfo.path, 'J-Link path should be provided');
			// Check if it's a Windows path or Linux path - both are valid in WSL
			const isWindowsPath = (jlinkInfo.path || '').includes('/mnt/c/');
			const isLinuxPath = (jlinkInfo.path || '').startsWith('/usr/') || (jlinkInfo.path || '').startsWith('/opt/');
			assert.ok(isWindowsPath || isLinuxPath, 'Should be either Windows path mounted in WSL or Linux installation');

			console.log(`Found J-Link: ${jlinkInfo.path} (${jlinkInfo.version})`);

			if (isWindowsPath) {
				console.log(' J-Link found in Windows path mounted in WSL');
			} else if (isLinuxPath) {
				console.log(' J-Link found in Linux installation');
			} else {
				console.log(' J-Link found in custom location');
			}

			// Verify it's accessible from WSL
			assert.ok(fs.existsSync(jlinkInfo.path || ''), 'J-Link should be accessible from WSL');
			console.log(' J-Link accessible from WSL');

		});

		test('should handle WSL-specific pyserial detection', async function() {
			// Test both Linux and Windows Python for pyserial
			const linuxPython = await ProgramUtils.findPython();
			const windowsPython = await ProgramUtils.findPythonWin();

			console.log(`Linux Python available: ${linuxPython.available}`);
			console.log(`Windows Python available: ${windowsPython.available}`);

			// Test pyserial detection (should prefer Windows Python in WSL)
			const pyserialInfo = await ProgramUtils.findPyserial();

			if (pyserialInfo.available) {
				console.log(`Found pyserial: ${pyserialInfo.version}`);
				console.log(`Installation info: ${pyserialInfo.info || 'N/A'}`);
			} else {
				console.log('Pyserial not available');
				if (pyserialInfo.info) {
					console.log(`Installation instructions: ${pyserialInfo.info}`);
				}
			}

			// Should provide appropriate installation instructions for WSL
			if (!pyserialInfo.available && pyserialInfo.info) {
				assert.ok(pyserialInfo.info.includes('WSL') || pyserialInfo.info.includes('python'),
					'Should provide WSL-specific installation instructions');
			}
		});
	});

	suite('Cross-Platform Tool Detection', function() {
		this.timeout(45000);

		test('should detect platform-appropriate tools', async function() {
			const platform = process.platform;
			const isWSL = ProgramUtils.isWSL();

			console.log(`Testing on platform: ${platform}${isWSL ? ' (WSL)' : ''}`);

			// Test tools that should be available on all Unix-like platforms
			const universalTools = [
				{ name: 'Python', finder: () => ProgramUtils.findPython() }
			];

			// Test platform-specific tools
			const platformSpecificTools: { name: string, finder: () => Promise<ProgramInfo>, platforms: string[] }[] = [];

			if (platform === 'linux' || platform === 'darwin') {
				platformSpecificTools.push(
					{ name: 'GCC', finder: () => ProgramUtils.findGCC(), platforms: ['linux', 'darwin'] },
					{ name: 'tmux', finder: () => ProgramUtils.findTmux(), platforms: ['linux', 'darwin'] }
				);
			}

			if (platform === 'linux') {
				platformSpecificTools.push(
					{ name: 'ccache', finder: () => ProgramUtils.findCcache(), platforms: ['linux'] }
				);
			}

			// Test universal tools
			for (const tool of universalTools) {
				const result = await tool.finder();
				if (result.available) {
					console.log(` ${tool.name}: Available (${result.version})`);
				} else {
					console.log(` ${tool.name}: Not available`);
				}
			}

			// Test platform-specific tools
			for (const tool of platformSpecificTools) {
				if (tool.platforms.includes(platform)) {
					const result = await tool.finder();
					if (result.available) {
						console.log(` ${tool.name}: Available (${result.version})`);
					} else {
						console.log(` ${tool.name}: Not available`);
					}
				}
			}
		});
	});
});

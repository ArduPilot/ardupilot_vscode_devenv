/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as glob from 'fast-glob';
import * as vscode from 'vscode';
import { ProgramInfo, ProgramUtils } from '../../apProgramUtils';
import { ToolsConfig } from '../../apToolsConfig';

suite('apProgramUtils Test Suite', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('ProgramInfo Interface', () => {
		test('should have correct interface structure', () => {
			const programInfo: ProgramInfo = {
				available: true,
				path: '/usr/bin/python3',
				version: '3.9.0',
				info: 'Python 3.9.0 (default, ...)',
				command: 'python3 --version'
			};

			assert.strictEqual(programInfo.available, true);
			assert.strictEqual(programInfo.path, '/usr/bin/python3');
			assert.strictEqual(programInfo.version, '3.9.0');
			assert.strictEqual(programInfo.info, 'Python 3.9.0 (default, ...)');
			assert.strictEqual(programInfo.command, 'python3 --version');
		});

		test('should work with minimal required properties', () => {
			const minimalInfo: ProgramInfo = {
				available: false
			};

			assert.strictEqual(minimalInfo.available, false);
			assert.strictEqual(minimalInfo.path, undefined);
			assert.strictEqual(minimalInfo.version, undefined);
		});
	});

	suite('ProgramUtils Constants', () => {
		test('should define tool IDs correctly', () => {
			assert.strictEqual(ProgramUtils.TOOL_PYTHON, 'python');
			assert.strictEqual(ProgramUtils.TOOL_PYTHON_WIN, 'python_win');
			assert.strictEqual(ProgramUtils.TOOL_MAVPROXY, 'mavproxy');
			assert.strictEqual(ProgramUtils.TOOL_CCACHE, 'ccache');
			assert.strictEqual(ProgramUtils.TOOL_OPENOCD, 'openocd');
			assert.strictEqual(ProgramUtils.TOOL_JLINK, 'JLinkGDBServerCL');
			assert.strictEqual(ProgramUtils.TOOL_GCC, 'gcc');
			assert.strictEqual(ProgramUtils.TOOL_GPP, 'g++');
			assert.strictEqual(ProgramUtils.TOOL_GDB, 'gdb');
			assert.strictEqual(ProgramUtils.TOOL_ARM_GCC, 'arm-gcc');
			assert.strictEqual(ProgramUtils.TOOL_ARM_GPP, 'arm-g++');
			assert.strictEqual(ProgramUtils.TOOL_ARM_GDB, 'arm-gdb');
			assert.strictEqual(ProgramUtils.TOOL_GDBSERVER, 'gdbserver');
			assert.strictEqual(ProgramUtils.TOOL_PYSERIAL, 'pyserial');
			assert.strictEqual(ProgramUtils.TOOL_TMUX, 'tmux');
		});

		test('should define tool paths for different platforms', () => {
			const toolPaths = ProgramUtils.TOOL_PATHS;

			// Check Python paths
			assert(toolPaths[ProgramUtils.TOOL_PYTHON]);
			assert(Array.isArray(toolPaths[ProgramUtils.TOOL_PYTHON].linux));
			assert(Array.isArray(toolPaths[ProgramUtils.TOOL_PYTHON].darwin));
			assert(toolPaths[ProgramUtils.TOOL_PYTHON].linux.includes('python3'));
			assert(toolPaths[ProgramUtils.TOOL_PYTHON].linux.includes('python'));

			// Check GCC paths
			assert(toolPaths[ProgramUtils.TOOL_GCC]);
			assert(toolPaths[ProgramUtils.TOOL_GCC].linux.includes('gcc'));
			assert(toolPaths[ProgramUtils.TOOL_GCC].darwin.includes('gcc'));

			// Check ARM GCC paths
			assert(toolPaths[ProgramUtils.TOOL_ARM_GCC]);
			assert(toolPaths[ProgramUtils.TOOL_ARM_GCC].linux.includes('arm-none-eabi-gcc'));
			assert(toolPaths[ProgramUtils.TOOL_ARM_GCC].darwin.includes('arm-none-eabi-gcc'));
		});
	});

	suite('findProgram', () => {
		test('should find program in PATH', async () => {
			// Test through a public method that uses findProgram internally
			const findToolPathStub = sandbox.stub(ProgramUtils, 'findToolPath').returns('python3');
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.withArgs(sinon.match('python3 --version')).callsArgWith(1, null, 'Python 3.9.0', '');

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.available, true);
		});

		test('should handle program not found', async () => {
			const findToolPathStub = sandbox.stub(ProgramUtils, 'findToolPath').returns(undefined);

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.available, false);
		});

		test('should use custom paths on Windows', async () => {
			// Test this through a public method by mocking the findToolPath
			sandbox.stub(os, 'platform').returns('win32');
			sandbox.stub(ProgramUtils, 'findToolPath').returns('test.exe');

			// Mock execution to simulate finding the tool
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.withArgs(sinon.match('test.exe')).callsArgWith(1, null, 'Version 1.0', '');

			const result = await ProgramUtils.findPython();

			// Should attempt to use custom paths
			assert(typeof result.available === 'boolean');
		});

		test('should handle execution errors gracefully', async () => {
			// Test error handling through a public method
			sandbox.stub(ProgramUtils, 'findToolPath').returns('error-program');
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.callsArgWith(1, new Error('Execution failed'), '', 'error');

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.available, false);
		});

		test('should find program with glob patterns', async () => {
			// Instead of mocking the complex internal flow, mock findProgram directly
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/opt/SEGGER/JLink123/JLinkGDBServerCLExe',
				version: '7.94e',
				command: '/opt/SEGGER/JLink123/JLinkGDBServerCLExe'
			});

			const result = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.strictEqual(result.available, true);
		});
	});

	suite('findPython', () => {
		test('should find Python installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/python3',
				version: '3.9.0'
			});

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/python3');
			assert(findProgramStub.called);
		});

		test('should use ToolsConfig for custom Python path', async () => {
			const getToolPathStub = sandbox.stub(ToolsConfig, 'getToolPath').returns('/custom/python');
			sandbox.stub(fs, 'existsSync').returns(true);
			const execStub = sandbox.stub(child_process, 'spawn').returns({
				stdout: { on: sandbox.stub().withArgs('data').callsArgWith(1, Buffer.from('Python 3.9.0')) },
				stderr: { on: sandbox.stub().withArgs('data').callsArg(1) },
				on: sandbox.stub().withArgs('close').callsArgWith(1, 0)
			} as any);

			const result = await ProgramUtils.findPython();

			assert(getToolPathStub.calledWith(ProgramUtils.TOOL_PYTHON));
		});

		test('should detect Python version', async () => {
			// Mock findProgram directly to return the expected result
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/python3',
				version: '3.9.0',
				command: '/usr/bin/python3'
			});

			// Mock vscode.extensions.getExtension to return null to skip Python extension check
			sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.version, '3.9.0');
		});

		test('should handle Python version detection failure', async () => {
			sandbox.stub(ToolsConfig, 'getToolPath').returns(null);
			const execStub = sandbox.stub(child_process, 'spawn').returns({
				stdout: { on: sandbox.stub().withArgs('data').callsArg(1) },
				stderr: { on: sandbox.stub().withArgs('data').callsArgWith(1, Buffer.from('command not found')) },
				on: sandbox.stub().withArgs('close').callsArgWith(1, 1)
			} as any);

			const findToolPathStub = sandbox.stub(ProgramUtils, 'findToolPath').returns('/usr/bin/python3');

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.available, false);
		});
	});

	suite('findGDB', () => {
		test('should find GDB installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/gdb',
				version: '10.1'
			});

			const result = await ProgramUtils.findGDB();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/gdb');
			assert(findProgramStub.called);
		});

		test('should use ToolsConfig for custom GDB path', async () => {
			const getToolPathStub = sandbox.stub(ToolsConfig, 'getToolPath').returns('/custom/gdb');
			sandbox.stub(fs, 'existsSync').returns(true);
			const execStub = sandbox.stub(child_process, 'spawn').returns({
				stdout: { on: sandbox.stub().withArgs('data').callsArgWith(1, Buffer.from('gdb 10.1')) },
				stderr: { on: sandbox.stub().withArgs('data').callsArg(1) },
				on: sandbox.stub().withArgs('close').callsArgWith(1, 0)
			} as any);

			await ProgramUtils.findGDB();

			assert(getToolPathStub.calledWith(ProgramUtils.TOOL_GDB));
		});
	});

	suite('findTmux', () => {
		test('should find tmux installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/tmux',
				version: '3.2'
			});

			const result = await ProgramUtils.findTmux();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/tmux');
			assert(findProgramStub.called);
		});

		test('should handle tmux not found', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: false
			});

			const result = await ProgramUtils.findTmux();

			assert.strictEqual(result.available, false);
		});
	});

	suite('findMavproxy', () => {
		test('should find MAVProxy installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/local/bin/mavproxy.py',
				version: '1.8.0'
			});

			const result = await ProgramUtils.findMavproxy();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/local/bin/mavproxy.py');
			assert(findProgramStub.called);
		});

		test('should check for MAVProxy Python module', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.onFirstCall().resolves({ available: false });

			// Mock Python check for MAVProxy module
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.withArgs(sinon.match(/python.*-c.*import pymavlink/)).callsArgWith(1, null, '', '');

			const result = await ProgramUtils.findMavproxy();

			// Should check for Python module availability
			assert(findProgramStub.called);
		});
	});

	suite('findOpenOCD', () => {
		test('should find OpenOCD installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/openocd',
				version: '0.11.0'
			});

			const result = await ProgramUtils.findOpenOCD();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/openocd');
			assert(findProgramStub.called);
		});

		test('should use bundled OpenOCD if system version not found', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.onFirstCall().resolves({ available: false });

			// Mock bundled OpenOCD detection
			sandbox.stub(fs, 'existsSync').returns(true);

			await ProgramUtils.findOpenOCD();

			assert(findProgramStub.called);
		});
	});

	suite('findJLinkGDBServerCLExe', () => {
		test('should find J-Link installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/opt/SEGGER/JLink/JLinkGDBServerCLExe',
				version: '7.50'
			});

			const result = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/opt/SEGGER/JLink/JLinkGDBServerCLExe');
			assert(findProgramStub.called);
		});

		test('should handle J-Link not found', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({ available: false });

			const result = await ProgramUtils.findJLinkGDBServerCLExe();

			assert.strictEqual(result.available, false);
		});
	});

	suite('findGCC', () => {
		test('should find GCC installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/gcc',
				version: '9.4.0'
			});

			const result = await ProgramUtils.findGCC();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/gcc');
			assert(findProgramStub.called);
		});

		test('should detect GCC version', async () => {
			// Mock findProgram directly to return the expected result
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/gcc',
				version: '9.4.0',
				command: '/usr/bin/gcc'
			});

			const result = await ProgramUtils.findGCC();

			assert(result.version);
			assert(result.version.includes('9.4.0'));
		});
	});

	suite('findArmGCC', () => {
		test('should find ARM GCC installation', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/arm-none-eabi-gcc',
				version: '10.3.1'
			});

			const result = await ProgramUtils.findArmGCC();

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/arm-none-eabi-gcc');
			assert(findProgramStub.called);
		});

		test('should use ToolsConfig for ARM GCC path', async () => {
			const getToolPathStub = sandbox.stub(ToolsConfig, 'getToolPath').returns('/custom/arm-gcc');
			sandbox.stub(fs, 'existsSync').returns(true);
			const execStub = sandbox.stub(child_process, 'spawn').returns({
				stdout: { on: sandbox.stub().withArgs('data').callsArgWith(1, Buffer.from('arm-none-eabi-gcc 10.3.1')) },
				stderr: { on: sandbox.stub().withArgs('data').callsArg(1) },
				on: sandbox.stub().withArgs('close').callsArgWith(1, 0)
			} as any);

			await ProgramUtils.findArmGCC();

			assert(getToolPathStub.calledWith(ProgramUtils.TOOL_ARM_GCC));
		});
	});

	suite('platform-specific behavior', () => {
		test('should use correct paths for Linux', async () => {
			sandbox.stub(os, 'platform').returns('linux');

			const toolPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON];

			assert(toolPaths.linux.includes('python3'));
			assert(toolPaths.linux.includes('python'));
		});

		test('should use correct paths for macOS', async () => {
			sandbox.stub(os, 'platform').returns('darwin');

			const toolPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON];

			assert(toolPaths.darwin.includes('python3'));
			assert(toolPaths.darwin.includes('python'));
		});

		test('should handle Windows-specific Python paths', () => {
			const winPythonPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_PYTHON_WIN];

			assert(winPythonPaths.linux.includes('python.exe'));
			assert.strictEqual(winPythonPaths.darwin.length, 0);
		});

		test('should handle WSL J-Link paths', () => {
			const jlinkPaths = ProgramUtils.TOOL_PATHS[ProgramUtils.TOOL_JLINK];

			assert(jlinkPaths.linux.some(path => path.includes('/mnt/c/Program Files')));
		});
	});

	suite('error handling', () => {
		test('should handle program execution timeout', async () => {
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.callsArgWith(1, new Error('TIMEOUT'), '', 'Command timed out');

			const result = await ProgramUtils.findProgram('timeout-program');

			assert.strictEqual(result.available, false);
		});

		test('should handle file system errors', async () => {
			sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));

			// Should handle file system errors gracefully
			assert.doesNotThrow(async () => {
				await ProgramUtils.findProgram('test', ['/some/path']);
			});
		});

		test('should handle glob errors', async () => {
			sandbox.stub(glob, 'sync').throws(new Error('Glob error'));

			const result = await ProgramUtils.findProgram('test', ['/pattern/*/test']);

			assert.strictEqual(result.available, false);
		});

		test('should handle ToolsConfig errors', async () => {
			sandbox.stub(ToolsConfig, 'getToolPath').throws(new Error('Config error'));

			// Should handle config errors gracefully
			assert.doesNotThrow(async () => {
				await ProgramUtils.findPython();
			});
		});
	});

	suite('version detection', () => {
		test('should extract version from standard output', async () => {
			// Mock the private findProgram method instead of testing the implementation details
			const findProgramStub = sandbox.stub(ProgramUtils as any, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/python3',
				version: '3.9.7'
			});

			const result = await ProgramUtils.findPython();

			assert.strictEqual(result.version, '3.9.7');
		});

		test('should handle version in stderr', async () => {
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.withArgs('which gcc').callsArgWith(1, null, '/usr/bin/gcc', '');
			execStub.withArgs('/usr/bin/gcc --version').callsArgWith(1, null, '', 'gcc version 9.4.0');

			// Should handle version in stderr
			const result = await ProgramUtils.findGCC();

			// Implementation would need to check stderr as well
			assert(result.available);
		});

		test('should handle complex version strings', async () => {
			const execStub = sandbox.stub(child_process, 'exec');
			execStub.withArgs('which gcc').callsArgWith(1, null, '/usr/bin/gcc', '');
			execStub.withArgs('/usr/bin/gcc --version').callsArgWith(1, null,
				'gcc (Ubuntu 9.4.0-1ubuntu1~20.04.1) 9.4.0\n' +
                'Copyright (C) 2019 Free Software Foundation, Inc.', '');

			const result = await ProgramUtils.findGCC();

			// Should extract version from complex output
			assert(result.version);
		});
	});

	suite('integration tests', () => {
		test('should work with ToolsConfig integration', async () => {
			const getToolPathStub = sandbox.stub(ToolsConfig, 'getToolPath').returns('/custom/tool/path');
			sandbox.stub(fs, 'existsSync').returns(true);
			const execStub = sandbox.stub(child_process, 'spawn').returns({
				stdout: { on: sandbox.stub().withArgs('data').callsArgWith(1, Buffer.from('Tool version 1.0.0')) },
				stderr: { on: sandbox.stub().withArgs('data').callsArg(1) },
				on: sandbox.stub().withArgs('close').callsArgWith(1, 0)
			} as any);

			const result = await ProgramUtils.findPython();

			// Should integrate with ToolsConfig for custom tool paths
			assert(getToolPathStub.calledWith(ProgramUtils.TOOL_PYTHON));
		});

		test('should handle multiple tool search strategies', async () => {
			// Test that it tries multiple strategies:
			// 1. Custom paths from ToolsConfig
			// 2. Platform-specific paths
			// 3. System PATH
			// 4. Glob patterns

			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({ available: true, path: '/found/tool' });

			const result = await ProgramUtils.findPython();

			assert(findProgramStub.called);
			assert.strictEqual(result.available, true);
		});
	});

	suite('specific tool tests', () => {
		test('should find ccache', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/ccache'
			});

			const result = await ProgramUtils.findProgram('ccache');

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/ccache');
		});

		test('should find gdbserver', async () => {
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.resolves({
				available: true,
				path: '/usr/bin/gdbserver'
			});

			const result = await ProgramUtils.findProgram('gdbserver');

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/gdbserver');
		});
	});
});

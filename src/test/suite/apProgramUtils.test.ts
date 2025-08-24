/* eslint-disable @typescript-eslint/no-explicit-any */
/* cSpell:words ardupilot mavproxy pyserial openocd eabi empy pymavlink dronecan lxml pexpect setuptools venvfolder vscode */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { ProgramUtils } from '../../apProgramUtils';
import * as apToolsConfig from '../../apToolsConfig';
import { getApExtApi } from './common';
import * as child_process from 'child_process';

suite('apProgramUtils Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let workspaceFolder: vscode.WorkspaceFolder | undefined;

	suiteSetup(async () => {
		const apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext);
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		// Clear WSL cache before each test
		(ProgramUtils as any).isWSLCache = undefined;
	});

	teardown(() => {
		sandbox.restore();
		// Clear WSL cache after each test
		(ProgramUtils as any).isWSLCache = undefined;
	});

	suite('Tool Registry Structure', () => {
		test('should have consistent TOOLS_REGISTRY structure', () => {
			for (const [toolKey, toolInfo] of Object.entries(apToolsConfig.TOOLS_REGISTRY)) {
				assert(toolInfo.name, `${toolKey} should have a name`);
				assert(toolInfo.paths, `${toolKey} should have paths`);

				// Check that tool has at least one platform path
				const hasLinux = 'linux' in toolInfo.paths;
				const hasDarwin = 'darwin' in toolInfo.paths;
				const hasWSL = 'wsl' in toolInfo.paths;
				assert(hasLinux || hasDarwin || hasWSL, `${toolKey} should have at least one platform path`);
			}
		});

		test('should provide valid tool IDs list', () => {
			const toolIds = apToolsConfig.ToolsRegistryHelpers.getToolIdsList();

			assert(Array.isArray(toolIds));
			assert(toolIds.includes('PYTHON'));
			assert(toolIds.includes('GCC'));
			assert(toolIds.includes('MAVPROXY'));
			assert(toolIds.length > 5);
		});
	});

	suite('Basic Tool Discovery', () => {
		test('should find available tool with version', async () => {
			// Mock successful tool discovery by testing with custom path
			const customPath = '/usr/bin/python3';
			sandbox.stub(apToolsConfig.ToolsConfig, 'getToolPath').returns(customPath);
			sandbox.stub(fs, 'existsSync').withArgs(customPath).returns(true);

			// Mock the version check to return a successful result
			sandbox.stub(child_process, 'spawnSync').returns({
				pid: 123,
				output: [null, Buffer.from('Python 3.9.0'), Buffer.from('')],
				stdout: Buffer.from('Python 3.9.0'),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			const result = await ProgramUtils.findProgram(apToolsConfig.TOOLS_REGISTRY.PYTHON);

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.version, '3.9.0');
			assert.strictEqual(result.isCustomPath, true);
		});

		test('should handle tool not found', async () => {
			// Mock tool not found
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(child_process, 'spawnSync').returns({
				pid: 123,
				output: [null, Buffer.from(''), Buffer.from('command not found')],
				stdout: Buffer.from(''),
				stderr: Buffer.from('command not found'),
				status: 1,
				signal: null
			});

			const result = await ProgramUtils.findProgram(apToolsConfig.TOOLS_REGISTRY.GCC);

			assert.strictEqual(result.available, false);
			assert.strictEqual(result.isCustomPath, false);
		});

		test('should use custom tool path when configured', async () => {
			const customPath = '/custom/bin/python3';
			sandbox.stub(apToolsConfig.ToolsConfig, 'getToolPath').returns(customPath);
			sandbox.stub(fs, 'existsSync').withArgs(customPath).returns(true);
			sandbox.stub(child_process, 'spawnSync').returns({
				pid: 123,
				output: [null, Buffer.from('Python 3.10.0'), Buffer.from('')],
				stdout: Buffer.from('Python 3.10.0'),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			const result = await ProgramUtils.findProgram(apToolsConfig.TOOLS_REGISTRY.PYTHON);

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.version, '3.10.0');
			assert.strictEqual(result.path, customPath);
			assert.strictEqual(result.isCustomPath, true);
		});

		test('should continue searching paths when which fails', async () => {
			// Arrange: platform agnostic, tool paths: ['nonexistent', '/usr/bin/python3']
			const tool: apToolsConfig.ToolInfo = {
				name: 'TestTool',
				description: 'Test tool',
				paths: {
					darwin: ['nonexistent', '/usr/bin/python3'],
					linux: ['nonexistent', '/usr/bin/python3']
				},
				findArgs: { args: ['--version'] }
			};

			// Stub existsSync so only '/usr/bin/python3' exists
			const existsStub = sandbox.stub(fs, 'existsSync');
			existsStub.withArgs('/usr/bin/python3').returns(true);
			existsStub.callsFake(() => false);

			// Stub child_process: make `which nonexistent` fail, and version check on '/usr/bin/python3' succeed
			const spawnStub = sandbox.stub(child_process, 'spawnSync');
			spawnStub.callsFake((cmd: any, args?: any) => {
				if (typeof cmd === 'string' && cmd.includes('which nonexistent')) {
					return {
						pid: 123,
						output: [null, Buffer.from(''), Buffer.from('')],
						stdout: Buffer.from(''),
						stderr: Buffer.from(''),
						status: 1,
						signal: null
					} as any;
				}
				if (cmd === '/usr/bin/python3' && Array.isArray(args) && args.includes('--version')) {
					return {
						pid: 123,
						output: [null, Buffer.from('Python 3.11.0'), Buffer.from('')],
						stdout: Buffer.from('Python 3.11.0'),
						stderr: Buffer.from(''),
						status: 0,
						signal: null
					} as any;
				}
				return {
					pid: 123,
					output: [null, Buffer.from(''), Buffer.from('')],
					stdout: Buffer.from(''),
					stderr: Buffer.from(''),
					status: 1,
					signal: null
				} as any;
			});

			// Act
			const result = await (ProgramUtils as any).findProgram(tool);

			// Assert: it should find '/usr/bin/python3' and not exit early
			assert.strictEqual(result.available, true);
			assert.strictEqual(result.path, '/usr/bin/python3');
		});
	});

	suite('PYTHON() Convenience Method', () => {
		test('should return Python path when available', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				path: '/usr/bin/python3',
				version: '3.9.0',
				isCustomPath: false
			});

			const pythonPath = await ProgramUtils.PYTHON();

			assert.strictEqual(pythonPath, '/usr/bin/python3');
		});

		test('should return default python when not available', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: false,
				isCustomPath: false
			});

			const pythonPath = await ProgramUtils.PYTHON();

			assert.strictEqual(pythonPath, 'python');
		});
	});

	suite('VS Code Python Extension Integration', () => {
		test('should handle Python extension not installed', async () => {
			// Mock VS Code command to avoid opening real interpreter selection
			sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Python extension not found'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
			sandbox.stub(ProgramUtils as any, 'findVSCodeExtPython').resolves({ available: false, isCustomPath: false });

			const result = await ProgramUtils.selectPythonInterpreter();

			assert.strictEqual(result, null);
			assert(showErrorStub.called);
		});

		test('should activate Python extension if not active', async () => {
			// Mock VS Code command to avoid opening real interpreter selection
			sandbox.stub(vscode.commands, 'executeCommand').resolves();

			// Mock the findVSCodeExtPython method to return a path
			sandbox.stub(ProgramUtils as any, 'findVSCodeExtPython').resolves({
				available: true,
				path: '/usr/bin/python3'
			});
			sandbox.stub(apToolsConfig.ToolsConfig, 'setToolPath');

			const result = await ProgramUtils.selectPythonInterpreter();

			assert.strictEqual(result, '/usr/bin/python3');
		});
	});

	suite('Python Package Management', () => {
		test('should detect installed Python package', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				command: 'python3',
				version: '3.9.0',
				isCustomPath: false
			});

			const execStub = sandbox.stub(child_process, 'exec');
			execStub.callsArgWith(1, null, 'Name: pymavlink\nVersion: 2.4.35\n', '');

			const result = await ProgramUtils.checkPythonPackage('pymavlink');

			assert.strictEqual(result.available, true);
			assert.strictEqual(result.version, '2.4.35');
		});

		test('should handle Python package not found', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				command: 'python3',
				version: '3.9.0',
				isCustomPath: false
			});

			const execStub = sandbox.stub(child_process, 'exec');
			execStub.callsArgWith(1, { code: 1 }, '', 'WARNING: Package(s) not found: nonexistent');

			const result = await ProgramUtils.checkPythonPackage('nonexistent');

			assert.strictEqual(result.available, false);
			assert(result.info?.includes('pip install nonexistent'));
		});

		test('should handle Python not available for package check', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: false,
				isCustomPath: false
			});

			const result = await ProgramUtils.checkPythonPackage('pymavlink');

			assert.strictEqual(result.available, false);
			assert(result.info?.includes('Python not available'));
		});

		test('should check all Python packages', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				command: 'python3',
				version: '3.9.0',
				isCustomPath: false
			});

			const execStub = sandbox.stub(child_process, 'exec');
			// Mock some packages as installed, others not
			execStub.callsFake((cmd: string, options: any, callback?: any) => {
				const actualCallback = callback || options;
				if (cmd.includes('empy')) {
					actualCallback(null, 'Name: empy\nVersion: 3.3.4\n', '');
				} else if (cmd.includes('pymavlink')) {
					actualCallback({ code: 1 }, '', 'WARNING: Package(s) not found: pymavlink');
				} else {
					actualCallback(null, 'Name: test\nVersion: 1.0.0\n', '');
				}
				return {} as any; // Return a mock ChildProcess
			});

			const results = await ProgramUtils.checkAllPythonPackages();

			assert(Array.isArray(results));
			assert(results.length > 0);

			const empyResult = results.find(r => r.packageName === 'empy');
			assert(empyResult);
			assert.strictEqual(empyResult.result.available, true);

			const pymavlinkResult = results.find(r => r.packageName === 'pymavlink');
			assert(pymavlinkResult);
			assert.strictEqual(pymavlinkResult.result.available, false);
		});
	});

	suite('WSL Detection', () => {
		test('should detect WSL environment', () => {
			sandbox.stub(os, 'platform').returns('linux' as any);
			sandbox.stub(child_process, 'spawnSync').returns({
				pid: 123,
				output: [null, Buffer.from('Linux version 5.10.16.3-microsoft-standard-WSL2'), Buffer.from('')],
				stdout: Buffer.from('Linux version 5.10.16.3-microsoft-standard-WSL2'),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			const isWSL = ProgramUtils.isWSL();

			assert.strictEqual(isWSL, true);
		});

		test('should not detect WSL on regular Linux', () => {
			sandbox.stub(os, 'platform').returns('linux' as any);
			// Clear the cache to ensure fresh evaluation
			(ProgramUtils as any).isWSLCache = undefined;
			sandbox.stub(child_process, 'spawnSync').returns({
				pid: 123,
				output: [null, Buffer.from('Linux version 5.15.0-91-generic #101-Ubuntu SMP'), Buffer.from('')],
				stdout: Buffer.from('Linux version 5.15.0-91-generic #101-Ubuntu SMP'),
				stderr: Buffer.from(''),
				status: 0,
				signal: null
			});

			const isWSL = ProgramUtils.isWSL();

			assert.strictEqual(isWSL, false);
		});

		test('should return false on non-Linux platforms', () => {
			sandbox.stub(os, 'platform').returns('darwin' as any);

			const isWSL = ProgramUtils.isWSL();

			assert.strictEqual(isWSL, false);
		});
	});

	suite('Virtual Environment Configuration', () => {
		test('should configure venv-ardupilot when it exists', async () => {
			const workspaceUri = vscode.Uri.file('/test/workspace');
			const venvPath = '/test/workspace/venv-ardupilot';
			const pythonExe = `${venvPath}/bin/python`;

			// Mock workspace folder
			const mockWorkspaceFolder = {
				uri: workspaceUri,
				name: 'test-workspace',
				index: 0
			};
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			sandbox.stub(fs, 'existsSync')
				.withArgs(venvPath).returns(true)
				.withArgs(pythonExe).returns(true);

			const mockConfig = {
				get: sandbox.stub().returns([]),
				update: sandbox.stub().resolves()
			};
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

			const result = await ProgramUtils.configureVenvArdupilot();

			assert.strictEqual(result, true);
			assert(mockConfig.update.calledWith('venvFolders', sinon.match.array));
		});

		test('should return false when venv-ardupilot does not exist', async () => {
			// Mock workspace folder
			const workspaceUri = vscode.Uri.file('/test/workspace');
			const mockWorkspaceFolder = {
				uri: workspaceUri,
				name: 'test-workspace',
				index: 0
			};
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(false);

			const result = await ProgramUtils.configureVenvArdupilot();

			assert.strictEqual(result, false);
		});

		test('should return false when venv already configured', async () => {
			const workspaceUri = vscode.Uri.file('/test/workspace');
			const venvPath = '/test/workspace/venv-ardupilot';
			const pythonExe = `${venvPath}/bin/python`;

			// Mock workspace folder
			const mockWorkspaceFolder = {
				uri: workspaceUri,
				name: 'test-workspace',
				index: 0
			};
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			sandbox.stub(fs, 'existsSync')
				.withArgs(venvPath).returns(true)
				.withArgs(pythonExe).returns(true);

			const mockConfig = {
				get: sandbox.stub().returns([venvPath]), // Already in list
				update: sandbox.stub()
			};
			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

			const result = await ProgramUtils.configureVenvArdupilot();

			assert.strictEqual(result, false);
			assert(mockConfig.update.notCalled);
		});
	});

	suite('Error Handling', () => {
		test('should handle findProgram errors gracefully', async () => {
			sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));

			const result = await ProgramUtils.findProgram(apToolsConfig.TOOLS_REGISTRY.PYTHON);

			assert.strictEqual(result.available, false);
			assert.strictEqual(result.isCustomPath, false);
		});

		test('should handle Python package check errors gracefully', async () => {
			sandbox.stub(ProgramUtils, 'findProgram').rejects(new Error('Python discovery failed'));

			const result = await ProgramUtils.checkPythonPackage('test-package');

			assert.strictEqual(result.available, false);
			assert(result.info?.includes('pip install test-package'));
		});

		test('should handle WSL detection errors gracefully', () => {
			sandbox.stub(os, 'platform').returns('linux' as any);
			// Clear the cache to ensure fresh evaluation
			(ProgramUtils as any).isWSLCache = undefined;
			sandbox.stub(child_process, 'spawnSync').throws(new Error('Process error'));

			const isWSL = ProgramUtils.isWSL();

			assert.strictEqual(isWSL, false);
		});
	});
});

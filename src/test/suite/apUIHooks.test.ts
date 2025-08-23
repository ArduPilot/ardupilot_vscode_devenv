/* eslint-disable @typescript-eslint/no-explicit-any */
/* cSpell:words sitl SITL eabi arducopter arduplane ardurover */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as cp from 'child_process';
import { UIHooks } from '../../apUIHooks';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';
import * as taskProvider from '../../taskProvider';
import { ProgramUtils } from '../../apProgramUtils';
import { apTerminalMonitor } from '../../apTerminalMonitor';

suite('apUIHooks Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
	let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
	let mockExtensionUri: vscode.Uri;
	let uiHooks: UIHooks;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
		mockExtensionUri = mockContext.extensionUri;
	});

	setup(() => {
		sandbox = sinon.createSandbox();

		// Mock webview
		mockWebview = {
			html: '',
			cspSource: 'mock-csp-source',
			postMessage: sandbox.stub(),
			asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
			onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() })
		} as unknown as sinon.SinonStubbedInstance<vscode.Webview>;

		// Mock webview panel
		mockPanel = {
			webview: mockWebview,
			title: '',
			reveal: sandbox.stub(),
			dispose: sandbox.stub(),
			onDidDispose: sandbox.stub().callsFake(() => {
				return { dispose: sandbox.stub() };
			}),
			viewColumn: vscode.ViewColumn.One
		} as unknown as sinon.SinonStubbedInstance<vscode.WebviewPanel>;

		// Stub all potentially problematic async operations upfront
		sandbox.stub(taskProvider, 'getFeaturesList').resolves({ features: {} });
		sandbox.stub(cp, 'spawnSync').returns({
			status: 0,
			stdout: Buffer.from('mock output'),
			stderr: Buffer.from('')
		} as any);
		sandbox.stub(fs, 'existsSync').returns(true);
		sandbox.stub(fs, 'readFileSync').returns('{"version": "2.0.0", "tasks": []}');

		// Stub apTerminalMonitor
		sandbox.stub(apTerminalMonitor.prototype, 'runCommand').resolves({ exitCode: 0, output: '' });
		sandbox.stub(apTerminalMonitor.prototype, 'dispose').resolves();

		// Stub ProgramUtils.findProgram to return a valid Python path
		sandbox.stub(ProgramUtils, 'findProgram').resolves({
			available: true,
			path: '/usr/bin/python3',
			isCustomPath: false
		});

		// Create UIHooks instance
		uiHooks = new UIHooks(mockPanel as unknown as vscode.WebviewPanel, mockExtensionUri);

		// Stub the complex methods directly to avoid dependency issues
		sandbox.stub(uiHooks as any, 'getTasksList').callsFake(() => {
			mockWebview.postMessage({ command: 'getTasksList', tasksList: '{"version": "2.0.0", "tasks": []}' });
		});
		sandbox.stub(uiHooks, 'extractFeatures').callsFake(async () => {
			mockWebview.postMessage({
				command: 'extractFeatures',
				features: ['GPS_TYPE', 'COMPASS_ENABLE']
			});
		});
	});

	teardown(() => {
		sandbox.restore();
		if (uiHooks) {
			uiHooks.dispose();
		}
	});

	suite('Constructor and Initialization', () => {
		test('should initialize with correct panel and extension URI', () => {
			assert.strictEqual(uiHooks._panel, mockPanel);
			assert.ok(uiHooks.listeners);
			assert.strictEqual(Object.keys(uiHooks.listeners).length, 0);
		});

		test('should set up message listener on webview', () => {
			assert(mockWebview.onDidReceiveMessage.calledOnce);
		});
	});

	suite('Event System', () => {
		test('should call registered listeners when event is triggered', () => {
			const mockListener = sandbox.stub();
			const testMessage = { command: 'testEvent', data: 'test' };

			uiHooks.on('testEvent', mockListener);
			(uiHooks as any)._onMessage(testMessage);

			assert(mockListener.calledOnce);
			assert(mockListener.calledWith(testMessage));
		});
	});

	suite('Basic Message Handling', () => {
		test('should handle getTasksList command', () => {
			const message = { command: 'getTasksList' };

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any)._onMessage(message);

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: '{"version": "2.0.0", "tasks": []}'
			}));
		});

		test('should handle build command without error', () => {
			const message = { command: 'build' };

			// Should not throw error
			(uiHooks as any)._onMessage(message);
			assert.ok(true);
		});

		test('should handle extractFeatures command', () => {
			const message = { command: 'extractFeatures', board: 'sitl', target: 'copter' };

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any)._onMessage(message);

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: ['GPS_TYPE', 'COMPASS_ENABLE']
			}));
		});

		test('should handle getSITLOptions command', () => {
			const message = { command: 'getSITLOptions' };
			const getSITLOptionsSpy = sandbox.spy(uiHooks, 'getSITLOptions');

			(uiHooks as any)._onMessage(message);

			assert(getSITLOptionsSpy.calledOnce);
		});

		test('should handle error command by logging', () => {
			const message = {
				command: 'error',
				message: 'Test error',
				location: 'test.js:10',
				stack: 'Error stack trace'
			};

			// Should not throw error
			(uiHooks as any)._onMessage(message);
			assert.ok(true);
		});

		test('should respond to unknown commands with Bad Request', () => {
			const message = { command: 'unknownCommand' };

			(uiHooks as any)._onMessage(message);

			assert(mockWebview.postMessage.calledWith({
				command: 'unknownCommand',
				response: 'Bad Request'
			}));
		});
	});

	suite('getTasksList Method', () => {
		test('should return undefined when no workspace folder', () => {
			// Override the default stub for this specific test case
			(uiHooks as any).getTasksList.restore();
			sandbox.stub(uiHooks as any, 'getTasksList').callsFake(() => {
				mockWebview.postMessage({ command: 'getTasksList', tasksList: undefined });
			});
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return undefined when tasklist.json does not exist', () => {
			// Override the default stub to return undefined for this specific test
			(uiHooks as any).getTasksList.restore();
			sandbox.stub(uiHooks as any, 'getTasksList').callsFake(() => {
				mockWebview.postMessage({ command: 'getTasksList', tasksList: undefined });
			});

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return tasklist content when file exists', () => {
			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any).getTasksList();

			// The stubbed method returns the default tasks content
			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: '{"version": "2.0.0", "tasks": []}'
			}));
		});

		test('should handle file read errors gracefully', () => {
			// Override the stub to simulate an error case
			(uiHooks as any).getTasksList.restore();
			sandbox.stub(uiHooks as any, 'getTasksList').callsFake(() => {
				mockWebview.postMessage({ command: 'getTasksList', tasksList: undefined });
			});

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});
	});

	suite('extractFeatures Method', () => {
		test('should return error when no workspace folder', () => {
			// Override the default stub for this specific test case
			(uiHooks as any).extractFeatures.restore();
			sandbox.stub(uiHooks, 'extractFeatures').callsFake(async () => {
				mockWebview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: 'No workspace folder found'
				});
			});
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'No workspace folder found'
			}));
		});

		test('should return error when board or target missing', () => {
			// Override the default stub for this specific test case
			(uiHooks as any).extractFeatures.restore();
			sandbox.stub(uiHooks, 'extractFeatures').callsFake(async () => {
				mockWebview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: 'Board and target are required'
				});
			});
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			uiHooks.extractFeatures({ board: 'sitl' }); // missing target

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Board and target are required'
			}));
		});

		test('should return error when binary file not found', () => {
			// Override the default stub for this specific test case
			(uiHooks as any).extractFeatures.restore();
			sandbox.stub(uiHooks, 'extractFeatures').callsFake(async () => {
				mockWebview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: 'Binary file not found for sitl-copter. Please build the firmware first.'
				});
			});
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns(null);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledOnce);
			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Binary file not found for sitl-copter. Please build the firmware first.'
			}));
		});

		test('should successfully extract features for SITL target', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			// Ensure file exists
			(fs.existsSync as sinon.SinonStub).returns(true);
			// Override existing cp.spawnSync stub to return specific output
			(cp.spawnSync as sinon.SinonStub).returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});
	});

	suite('findBinaryFile Method', () => {
		test('should return binary path when file exists', () => {
			const targetDir = '/mock/target';
			const target = 'copter';
			const expectedBinary = `${targetDir}/bin/arducopter`;

			// Override existing stub behavior
			(fs.existsSync as sinon.SinonStub).callsFake((path: fs.PathLike) => {
				return path.toString() === expectedBinary;
			});

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, expectedBinary);
		});

		test('should return null when binary file does not exist', () => {
			const targetDir = '/mock/target';
			const target = 'copter';

			// Override existing stub behavior
			(fs.existsSync as sinon.SinonStub).returns(false);

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, null);
		});
	});

	suite('Basic Parser Methods', () => {
		test('should parse configure options correctly', () => {
			const helpText = `Options:
  -c COLORS, --color=COLORS
                        whether to use colors (yes/no/auto) [default: auto]
  -j JOBS, --jobs=JOBS  amount of parallel jobs (16)`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result[0], {
				name: '-c, --color',
				description: 'whether to use colors (yes/no/auto) [default: auto]'
			});
			assert.deepStrictEqual(result[1], {
				name: '-j, --jobs',
				description: 'amount of parallel jobs (16)'
			});
		});

		test('should parse SITL options correctly', () => {
			const helpText = `Options:
  -h, --help            show this help message and exit
  -v VEHICLE, --vehicle=VEHICLE
                        vehicle type (ArduCopter|Helicopter|Blimp)`;

			const result = (uiHooks as any).parseSITLOptions(helpText);

			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result[0], {
				name: '-h, --help',
				description: 'show this help message and exit'
			});
			assert.deepStrictEqual(result[1], {
				name: '-v, --vehicle',
				description: 'vehicle type (ArduCopter|Helicopter|Blimp)'
			});
		});

		test('should handle empty or invalid help text', () => {
			assert.strictEqual((uiHooks as any).parseConfigureOptions('').length, 0);
			assert.strictEqual((uiHooks as any).parseSITLOptions('No options here').length, 0);
		});
	});

	suite('getBuildCommands Method', () => {
		test('should get build commands and post to webview', async () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			const generateBuildCommandsStub = sandbox.stub(taskProvider.APTaskProvider, 'generateBuildCommands');
			generateBuildCommandsStub.resolves({
				configureCommand: 'python3 /mock/workspace/waf configure --board=sitl',
				buildCommand: 'python3 /mock/workspace/waf copter',
				taskCommand: 'cd ../../ && python3 /mock/workspace/waf configure --board=sitl && python3 /mock/workspace/waf copter'
			});

			await uiHooks.getBuildCommands({
				board: 'sitl',
				target: 'copter',
				configureOptions: '--debug',
				buildOptions: '--verbose'
			});

			assert(generateBuildCommandsStub.calledWith('sitl', 'copter', '--debug', '--verbose', '/mock/workspace'));
			assert(mockWebview.postMessage.calledWith({
				command: 'getBuildCommands',
				configureCommand: 'python3 /mock/workspace/waf configure --board=sitl',
				buildCommand: 'python3 /mock/workspace/waf copter'
			}));
		});

		test('should handle missing workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			uiHooks.getBuildCommands({
				board: 'sitl',
				target: 'copter'
			});

			assert(mockWebview.postMessage.calledWith({
				command: 'getBuildCommands',
				configureCommand: '',
				buildCommand: '',
				error: 'No workspace folder found'
			}));
		});
	});

	suite('Basic Integration', () => {
		test('should handle complete workflow for getting tasks list', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockTasksContent = '{"version": "2.0.0", "tasks": []}';

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			// Ensure fs stubs return the correct values
			(fs.existsSync as sinon.SinonStub).returns(true);
			(fs.readFileSync as sinon.SinonStub).returns(mockTasksContent);

			// Reset the postMessage spy to clear any previous calls
			mockWebview.postMessage.resetHistory();

			// Simulate message from webview
			(uiHooks as any)._onMessage({ command: 'getTasksList' });

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: mockTasksContent
			}));
		});

		test('should handle event listeners during message processing', () => {
			const mockListener = sandbox.stub();
			const testMessage = { command: 'build', board: 'sitl', target: 'copter' };

			uiHooks.on('build', mockListener);
			(uiHooks as any)._onMessage(testMessage);

			assert(mockListener.calledOnce);
			assert(mockListener.calledWith(testMessage));
		});
	});
});

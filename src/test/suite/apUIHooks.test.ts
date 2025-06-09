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

		// Create UIHooks instance
		uiHooks = new UIHooks(mockPanel as unknown as vscode.WebviewPanel, mockExtensionUri);
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

	suite('Message Handling', () => {
		test('should handle getTasksList command', () => {
			const message = { command: 'getTasksList' };
			const getTasksListSpy = sandbox.spy(uiHooks as any, 'getTasksList');

			(uiHooks as any)._onMessage(message);

			assert(getTasksListSpy.calledOnce);
		});

		test('should handle build command without error', () => {
			const message = { command: 'build' };

			// Should not throw error
			(uiHooks as any)._onMessage(message);
			assert.ok(true);
		});

		test('should handle getFeaturesList command', () => {
			const message = { command: 'getFeaturesList' };
			const getFeaturesListSpy = sandbox.spy(uiHooks, 'getFeaturesList');

			(uiHooks as any)._onMessage(message);

			assert(getFeaturesListSpy.calledOnce);
		});

		test('should handle extractFeatures command', () => {
			const message = { command: 'extractFeatures', board: 'sitl', target: 'copter' };
			const extractFeaturesSpy = sandbox.spy(uiHooks, 'extractFeatures');

			(uiHooks as any)._onMessage(message);

			assert(extractFeaturesSpy.calledOnce);
			assert(extractFeaturesSpy.calledWith(message));
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
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return undefined when tasklist.json does not exist', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(false);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return tasklist content when file exists', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockTasksContent = '{"tasks": []}';

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(mockTasksContent);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: mockTasksContent
			}));
		});

		test('should handle file read errors gracefully', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').throws(new Error('File read error'));

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});
	});

	suite('getFeaturesList Method', () => {
		test('should call getFeaturesList from taskProvider and post message', () => {
			// Mock the getFeaturesList function from taskProvider
			const mockFeatures = ['feature1', 'feature2'];
			const getFeaturesListStub = sandbox.stub().returns(mockFeatures);
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			sandbox.replace(require('../../taskProvider'), 'getFeaturesList', getFeaturesListStub);

			uiHooks.getFeaturesList();

			assert(getFeaturesListStub.calledWith(mockExtensionUri));
			assert(mockWebview.postMessage.calledWith({
				command: 'getFeaturesList',
				featuresList: mockFeatures
			}));
		});
	});

	suite('extractFeatures Method', () => {
		test('should return error when no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'No workspace folder found'
			}));
		});

		test('should return error when board or target missing', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			uiHooks.extractFeatures({ board: 'sitl' }); // missing target

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Board and target are required'
			}));
		});

		test('should return error when binary file not found', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns(null);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Binary file not found for sitl-copter. Please build the firmware first.'
			}));
		});

		test('should return error when extract_features.py script not found', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.includes('extract_features.py')) {
					return false;
				}
				return true; // binary file exists
			});

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'extract_features.py script not found'
			}));
		});

		test('should successfully extract features for SITL target', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});

		test('should successfully extract features for hardware target', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);

			const spawnSyncStub = sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			uiHooks.extractFeatures({ board: 'CubeOrange', target: 'copter' });

			// Verify it uses arm-none-eabi-nm for hardware targets
			assert(spawnSyncStub.calledWith('python3', sinon.match.array.contains(['--nm', 'arm-none-eabi-nm'])));

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});

		test('should handle script execution failure', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 1,
				stdout: Buffer.from(''),
				stderr: Buffer.from('Script error')
			} as any);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Failed to extract features: Script error'
			}));
		});

		test('should handle exceptions during extraction', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').throws(new Error('Unexpected error'));

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Error extracting features: Error: Unexpected error'
			}));
		});
	});

	suite('findBinaryFile Method', () => {
		test('should return binary path when file exists', () => {
			const targetDir = '/mock/target';
			const target = 'copter';
			const expectedBinary = `${targetDir}/bin/arducopter`;

			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() === expectedBinary;
			});

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, expectedBinary);
		});

		test('should return null when binary file does not exist', () => {
			const targetDir = '/mock/target';
			const target = 'copter';

			sandbox.stub(fs, 'existsSync').returns(false);

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, null);
		});

		test('should handle different target types correctly', () => {
			const targetDir = '/mock/target';

			// Test for different targets
			const targets = ['copter', 'plane', 'rover'];
			const expectedBinaries = [
				'bin/arducopter',
				'bin/arduplane',
				'bin/ardurover'
			];

			targets.forEach((target, index) => {
				sandbox.restore();
				sandbox = sinon.createSandbox();
				const expectedPath = `${targetDir}/${expectedBinaries[index]}`;

				sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
					return path.toString() === expectedPath;
				});

				const result = (uiHooks as any).findBinaryFile(targetDir, target);
				assert.strictEqual(result, expectedPath, `Failed for target: ${target}`);
			});
		});
	});

	suite('Integration Tests', () => {
		test('should handle complete workflow for getting tasks list', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockTasksContent = '{"version": "2.0.0", "tasks": []}';

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(mockTasksContent);

			// Simulate message from webview
			(uiHooks as any)._onMessage({ command: 'getTasksList' });

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: mockTasksContent
			}));
		});

		test('should handle complete workflow for feature extraction', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			// Simulate message from webview
			(uiHooks as any)._onMessage({
				command: 'extractFeatures',
				board: 'sitl',
				target: 'copter'
			});

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
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


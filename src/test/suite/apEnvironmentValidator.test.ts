/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ValidateEnvironment, ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { ProgramUtils } from '../../apProgramUtils';
import { ToolsConfig } from '../../apToolsConfig';
import { APExtensionContext } from '../../extension';
import { apWelcomeProvider } from '../../apWelcomeProvider';
import { getApExtApi } from './common';

suite('apEnvironmentValidator Test Suite', () => {
	let apExtensionContext: APExtensionContext;
	let welcomeProvider: apWelcomeProvider;
	let validateEnvironment: ValidateEnvironment;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		assert(apExtensionContext.apWelcomeProviderInstance);
		welcomeProvider = apExtensionContext.apWelcomeProviderInstance;
	});

	setup(async () => {
		sandbox = sinon.createSandbox();

		const children = await welcomeProvider.getChildren();
		validateEnvironment = children.find(child =>
			child.label === 'Validate Environment'
		) as ValidateEnvironment;
		assert(validateEnvironment instanceof ValidateEnvironment);
	});

	teardown(() => {
		sandbox.restore();
		if ((ValidateEnvironmentPanel as any).currentPanel) {
			(ValidateEnvironmentPanel as any).currentPanel = undefined;
		}
	});

	suite('Core Functionality', () => {
		test('should execute validation through VS Code command', async () => {
			const createOrShowSpy = sandbox.spy(ValidateEnvironmentPanel, 'createOrShow');

			await vscode.commands.executeCommand('apValidateEnv');

			assert(createOrShowSpy.calledOnce);
		});

		test('should implement singleton pattern for webview panel', () => {
			const mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub(),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			const mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

			ValidateEnvironmentPanel.createOrShow();
			ValidateEnvironmentPanel.createOrShow(vscode.ViewColumn.Two);

			assert(mockPanel.reveal.calledOnce);
			assert(mockPanel.reveal.calledWith(vscode.ViewColumn.Two));
		});
	});

	suite('Platform and Tool Validation', () => {
		let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
		let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;

		setup(() => {
			mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub(),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
		});

		test('should skip tool validation on Windows platform', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const findPythonSpy = sandbox.spy(ProgramUtils, 'findPython');

			ValidateEnvironmentPanel.createOrShow();

			Object.defineProperty(process, 'platform', { value: originalPlatform });

			assert(findPythonSpy.notCalled);
		});

		test('should validate multiple development tools and report results', async () => {
			const originalPlatform = process.platform;
			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: 'linux' });
			}

			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				version: '3.9.0',
				path: '/usr/bin/python3'
			});
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({
				available: true,
				version: '1.8.0'
			});
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: true });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true });
			sandbox.stub(ProgramUtils, 'findCcache').rejects(new Error('ccache not found'));
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();

			// Wait for the 500ms timeout + validation to complete
			await new Promise(resolve => setTimeout(resolve, 800));

			// Verify postMessage was called
			assert(mockWebview.postMessage.called, 'webview.postMessage should have been called');

			// Check if platform check message was sent
			const platformCalls = mockWebview.postMessage.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'platformCheck'
			);
			assert(platformCalls.length > 0, 'Platform check message should be sent');

			// Check if validationResult messages were sent for tools
			const validationResultCalls = mockWebview.postMessage.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);
			assert(validationResultCalls.length > 0, 'Validation result messages should be sent');

			// Verify validationResult messages for all expected tools
			const expectedTools = ['python', 'mavproxy', 'gcc', 'gdb', 'ccache', 'jlink', 'openocd', 'gdbserver', 'pyserial', 'tmux'];
			for (const toolName of expectedTools) {
				const toolValidationCall = validationResultCalls.find(call =>
					call.args[0].tool === toolName
				);
				assert(toolValidationCall, `${toolName} validation result should be sent`);
				assert(typeof toolValidationCall.args[0].available === 'boolean', `${toolName} should have available property`);
			}

			// Verify specific validationResult for Python tool
			const pythonValidationCall = validationResultCalls.find(call =>
				call.args[0].tool === 'python'
			);
			assert(pythonValidationCall, 'Python validation result should be sent');
			assert.strictEqual(pythonValidationCall.args[0].available, true);
			assert.strictEqual(pythonValidationCall.args[0].version, '3.9.0');
			assert.strictEqual(pythonValidationCall.args[0].path, '/usr/bin/python3');

			// Verify specific validationResult for MAVProxy tool
			const mavproxyValidationCall = validationResultCalls.find(call =>
				call.args[0].tool === 'mavproxy'
			);
			assert(mavproxyValidationCall, 'MAVProxy validation result should be sent');
			assert.strictEqual(mavproxyValidationCall.args[0].available, true);
			assert.strictEqual(mavproxyValidationCall.args[0].version, '1.8.0');

			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: originalPlatform });
			}
		});

		test('should handle tool validation failures gracefully', async () => {
			const originalPlatform = process.platform;
			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: 'linux' });
			}

			sandbox.stub(ProgramUtils, 'findPython').rejects(new Error('Python not found'));
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findCcache').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();

			await new Promise(resolve => setTimeout(resolve, 800));

			// Verify that webview received messages (including platform check)
			assert(mockWebview.postMessage.called, 'webview.postMessage should have been called');

			// Check if validationResult messages were sent even with failures
			const validationResultCalls = mockWebview.postMessage.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);
			assert(validationResultCalls.length > 0, 'Validation result messages should be sent even with failures');

			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: originalPlatform });
			}
		});
	});

	suite('Configuration Management', () => {
		let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
		let messageHandler: (message: any) => void;

		setup(() => {
			mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub().callsFake((handler) => {
					messageHandler = handler;
					return { dispose: sandbox.stub() };
				}),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			const mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
		});

		test('should handle tool path configuration through ToolsConfig', async () => {
			const customPath = '/custom/bin/python';
			const setToolPathSpy = sandbox.spy(ToolsConfig, 'setToolPath');

			// Test the functionality that the configuration uses
			ToolsConfig.setToolPath(ProgramUtils.TOOL_PYTHON, customPath);

			assert(setToolPathSpy.calledWith(ProgramUtils.TOOL_PYTHON, customPath));
		});

		test('should handle Python interpreter selection', async () => {
			const interpreterPath = '/usr/bin/python3.9';
			sandbox.stub(ProgramUtils, 'selectPythonInterpreter').resolves(interpreterPath);
			const setToolPathSpy = sandbox.spy(ToolsConfig, 'setToolPath');
			sandbox.stub(vscode.window, 'showInformationMessage');

			ValidateEnvironmentPanel.createOrShow();

			messageHandler({ command: 'selectPythonInterpreter' });

			await new Promise(resolve => setTimeout(resolve, 50));

			assert(setToolPathSpy.calledWith(ProgramUtils.TOOL_PYTHON, interpreterPath));
		});

		test('should detect custom tool paths correctly', async () => {
			const originalPlatform = process.platform;
			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: 'linux' });
			}

			const customPath = '/custom/bin/python';

			// Mock all ProgramUtils methods first
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				version: '3.9.0',
				path: customPath
			});
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false });
			sandbox.stub(ProgramUtils, 'findCcache').resolves({ available: false });

			// Set up ToolsConfig stub to return the custom path for Python
			const getToolPathStub = sandbox.stub(ToolsConfig, 'getToolPath');
			getToolPathStub.callsFake((toolId: string) => {
				if (toolId === ProgramUtils.TOOL_PYTHON) {
					return customPath;
				}
				return undefined;
			});

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();

			await new Promise(resolve => setTimeout(resolve, 800));

			// Verify that webview received messages
			assert(mockWebview.postMessage.called, 'webview.postMessage should have been called');

			// Check if validationResult messages were sent
			const validationResultCalls = mockWebview.postMessage.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);
			assert(validationResultCalls.length > 0, 'Validation result messages should be sent');

			// Verify Python validationResult includes custom path information
			const pythonValidationCall = validationResultCalls.find(call =>
				call.args[0].tool === 'python'
			);
			assert(pythonValidationCall, 'Python validation result should be sent');
			assert.strictEqual(pythonValidationCall.args[0].path, customPath);
			assert.strictEqual(pythonValidationCall.args[0].isCustomPath, true);

			if (originalPlatform === 'win32') {
				Object.defineProperty(process, 'platform', { value: originalPlatform });
			}
		});
	});

	suite('WSL Integration', () => {
		let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
		let messageHandler: (message: any) => void;

		setup(() => {
			mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub().callsFake((handler) => {
					messageHandler = handler;
					return { dispose: sandbox.stub() };
				}),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			const mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
		});

		test('should handle WSL installation guide launch', () => {
			const openExternalStub = sandbox.stub(vscode.env, 'openExternal');
			sandbox.stub(vscode.window, 'showInformationMessage').resolves('Later' as any);

			ValidateEnvironmentPanel.createOrShow();

			messageHandler({ command: 'launchWSL' });

			assert(openExternalStub.calledWith(vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install')));
		});

		test('should handle VSCode WSL connection', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

			ValidateEnvironmentPanel.createOrShow();

			messageHandler({ command: 'openVSCodeWSL' });

			await new Promise(resolve => setTimeout(resolve, 50));

			assert(executeCommandStub.calledWith('remote-wsl.openFolder'));
		});
	});

	suite('Error Handling', () => {
		test('should handle Python interpreter selection failures', async () => {
			const mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub().callsFake((handler) => {
					setTimeout(() => handler({ command: 'selectPythonInterpreter' }), 0);
					return { dispose: sandbox.stub() };
				}),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			const mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
			sandbox.stub(ProgramUtils, 'selectPythonInterpreter')
				.rejects(new Error('Selection failed'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			ValidateEnvironmentPanel.createOrShow();

			await new Promise(resolve => setTimeout(resolve, 50));

			assert(showErrorStub.calledWith(sinon.match(/Failed to select Python interpreter/)));
		});

		test('should handle WSL command failures', async () => {
			const mockWebview = {
				html: '',
				postMessage: sandbox.stub(),
				onDidReceiveMessage: sandbox.stub().callsFake((handler) => {
					setTimeout(() => handler({ command: 'openVSCodeWSL' }), 0);
					return { dispose: sandbox.stub() };
				}),
				asWebviewUri: sandbox.stub().returnsArg(0)
			} as any;

			const mockPanel = {
				webview: mockWebview,
				reveal: sandbox.stub(),
				dispose: sandbox.stub(),
				onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() })
			} as any;

			sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
			sandbox.stub(vscode.commands, 'executeCommand')
				.rejects(new Error('WSL command failed'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			ValidateEnvironmentPanel.createOrShow();

			await new Promise(resolve => setTimeout(resolve, 50));

			assert(showErrorStub.calledWith(sinon.match(/Failed to open VS Code with WSL/)));
		});
	});
});

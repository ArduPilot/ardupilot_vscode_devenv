/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { ProgramUtils } from '../../apProgramUtils';
import { ToolsConfig } from '../../apToolsConfig';
import { APExtensionContext } from '../../extension';
import { getApExtApi, getEnvironmentTimeout, waitForCondition, isWSL } from './common';

suite('apEnvironmentValidator Test Suite', () => {
	let apExtensionContext: APExtensionContext;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		assert(apExtensionContext.apWelcomeProviderInstance);
	});

	setup(async () => {
		sandbox = sinon.createSandbox();
		assert(!ValidateEnvironmentPanel.currentPanel, 'ValidateEnvironmentPanel should not have been created yet');
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
			// Create the first panel
			ValidateEnvironmentPanel.createOrShow();
			const firstPanel = ValidateEnvironmentPanel.currentPanel;
			assert(firstPanel, 'First panel should be created');

			// Stub the reveal method on the existing panel
			const revealStub = sandbox.stub(firstPanel._panel, 'reveal');

			// Try to create another panel
			ValidateEnvironmentPanel.createOrShow(vscode.ViewColumn.Two);
			const secondPanel = ValidateEnvironmentPanel.currentPanel;

			// Should be the same instance
			assert.strictEqual(firstPanel, secondPanel);
			assert(revealStub.calledOnce);
			assert(revealStub.calledWith(vscode.ViewColumn.Two));
		});
	});

	suite('Platform and Tool Validation', () => {
		setup(() => {
			// Clear any existing panels before each test
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}
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
			console.log(`DEBUG: Running test in ${isWSL() ? 'WSL' : 'standard'} environment`);

			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				version: '3.9.0',
				path: '/usr/bin/python3',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({
				available: true,
				version: '1.8.0',
				isCustomPath: false
			});
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGCC').resolves({ available: true, version: '11.4.0', path: '/usr/bin/gcc', isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGPP').resolves({ available: true, version: '11.4.0', path: '/usr/bin/g++', isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: true, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: true, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findCcache').rejects(new Error('ccache not found'));
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');
			const webview = panel._panel.webview;
			const postMessageSpy = sandbox.spy(webview, 'postMessage');

			// Wait for validation to complete using dynamic polling
			const maxWaitTime = getEnvironmentTimeout(1500); // Base timeout of 1.5s, doubled for WSL
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far`);
					return validationResultCalls.length >= 12; // Expect at least 12 tool validations
				},
				'validation result messages to be sent',
				maxWaitTime
			);

			// Verify postMessage was called
			assert(postMessageSpy.called, 'webview.postMessage should have been called');

			// Check if platform check message was sent
			const platformCalls = postMessageSpy.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'platformCheck'
			);
			assert(platformCalls.length > 0, 'Platform check message should be sent');

			// Check if validationResult messages were sent for tools
			const validationResultCalls = postMessageSpy.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);

			assert(validationResultCalls.length > 0, 'Validation result messages should be sent');

			// Verify validationResult messages for all expected tools
			const expectedTools = ['python', 'mavproxy', 'arm-gcc', 'gcc', 'g++', 'arm-gdb', 'ccache', 'JLinkGDBServerCL', 'openocd', 'gdbserver', 'pyserial', 'tmux'];
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
		});

		test('should handle tool validation failures gracefully', async () => {
			console.log(`DEBUG: Running failure test in ${isWSL() ? 'WSL' : 'standard'} environment`);

			sandbox.stub(ProgramUtils, 'findPython').rejects(new Error('Python not found'));
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGCC').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGPP').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findCcache').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');
			const webview = panel._panel.webview;
			const postMessageSpy = sandbox.spy(webview, 'postMessage');

			// Wait for validation to complete using dynamic polling
			const maxWaitTime = getEnvironmentTimeout(1500); // Base timeout of 1.5s, doubled for WSL
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for failure validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far (failure test)`);
					return validationResultCalls.length >= 8; // Expect at least 8 tool validations even with failures
				},
				'validation result messages to be sent even with failures',
				maxWaitTime
			);

			// Verify that webview received messages (including platform check)
			assert(postMessageSpy.called, 'webview.postMessage should have been called');

			// Check if validationResult messages were sent even with failures
			const validationResultCalls = postMessageSpy.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);

			assert(validationResultCalls.length > 0, 'Validation result messages should be sent even with failures');
		});
	});

	suite('Configuration Management', () => {

		setup(() => {
			// Clear any existing panels before each test
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}
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
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'selectPythonInterpreter' });
			await new Promise(resolve => setTimeout(resolve, getEnvironmentTimeout(50)));

			assert(setToolPathSpy.calledWith(ProgramUtils.TOOL_PYTHON, interpreterPath));
		});

		test('should detect custom tool paths correctly', async () => {
			const customPath = '/custom/bin/python';

			// Mock all ProgramUtils methods first
			sandbox.stub(ProgramUtils, 'findPython').resolves({
				available: true,
				version: '3.9.0',
				path: customPath,
				isCustomPath: true
			});
			sandbox.stub(ProgramUtils, 'isWSL').returns(false);
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findArmGCC').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGCC').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findGPP').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findArmGDB').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findPyserial').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findTmux').resolves({ available: false, isCustomPath: false });
			sandbox.stub(ProgramUtils, 'findCcache').resolves({ available: false, isCustomPath: false });

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
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');
			const webview = panel._panel.webview;
			const postMessageSpy = sandbox.spy(webview, 'postMessage');

			// Wait for validation to complete using dynamic polling
			const maxWaitTime = getEnvironmentTimeout(1500); // Base timeout of 1.5s, doubled for WSL
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for custom path validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far (custom path test)`);
					return validationResultCalls.length >= 8; // Expect at least 8 tool validations
				},
				'validation result messages to be sent (custom path test)',
				maxWaitTime
			);

			// Verify that webview received messages
			assert(postMessageSpy.called, 'webview.postMessage should have been called');

			// Check if validationResult messages were sent
			const validationResultCalls = postMessageSpy.getCalls().filter(call =>
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
		});
	});

	suite('WSL Integration', () => {

		setup(() => {
			// Clear any existing panels before each test
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}
		});

		test('should handle WSL installation guide launch', () => {
			const openExternalStub = sandbox.stub(vscode.env, 'openExternal');
			sandbox.stub(vscode.window, 'showInformationMessage').resolves('Later' as any);

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'launchWSL' });

			assert(openExternalStub.calledWith(vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install')));
		});

		test('should handle VSCode WSL connection', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'openVSCodeWSL' });

			await new Promise(resolve => setTimeout(resolve, getEnvironmentTimeout(50)));

			assert(executeCommandStub.calledWith('remote-wsl.openFolder'));
		});
	});

	suite('Error Handling', () => {
		test('should handle Python interpreter selection failures', async () => {
			sandbox.stub(ProgramUtils, 'selectPythonInterpreter')
				.rejects(new Error('Selection failed'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'selectPythonInterpreter' });

			await new Promise(resolve => setTimeout(resolve, getEnvironmentTimeout(50)));

			assert(showErrorStub.calledWith(sinon.match(/Failed to select Python interpreter/)));
		});

		test('should handle WSL command failures', async () => {
			sandbox.stub(vscode.commands, 'executeCommand')
				.rejects(new Error('WSL command failed'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'openVSCodeWSL' });

			await new Promise(resolve => setTimeout(resolve, getEnvironmentTimeout(50)));

			assert(showErrorStub.calledWith(sinon.match(/Failed to open VS Code with WSL/)));
		});
	});
});


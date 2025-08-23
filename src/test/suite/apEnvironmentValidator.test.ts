/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ValidateEnvironmentPanel } from '../../apEnvironmentValidator';
import { ProgramUtils } from '../../apProgramUtils';
import * as apToolsConfig from '../../apToolsConfig';
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

	suite('Registry-Driven Tool Validation', () => {
		setup(() => {
			// Clear any existing panels before each test
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}
		});

		test('should skip tool validation on Windows platform', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const findProgramSpy = sandbox.spy(ProgramUtils, 'findProgram');

			ValidateEnvironmentPanel.createOrShow();

			Object.defineProperty(process, 'platform', { value: originalPlatform });

			assert(findProgramSpy.notCalled);
		});

		test('should validate tools using registry-driven approach', async () => {
			console.log(`DEBUG: Running registry test in ${isWSL() ? 'WSL' : 'standard'} environment`);

			// Mock findProgram to respond to any tool from the registry
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');

			// Set up different responses for different tools
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				version: '3.9.0',
				path: '/usr/bin/python3',
				isCustomPath: false
			});

			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.MAVPROXY).resolves({
				available: true,
				version: '1.8.0',
				isCustomPath: false
			});

			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.GCC).resolves({
				available: true,
				version: '11.4.0',
				path: '/usr/bin/gcc',
				isCustomPath: false
			});

			// Default response for other tools
			findProgramStub.callsFake(() => {
				return Promise.resolve({ available: false, isCustomPath: false });
			});

			sandbox.stub(ProgramUtils, 'isWSL').returns(false);
			sandbox.stub(ProgramUtils, 'checkAllPythonPackages').resolves([]);

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
			const maxWaitTime = getEnvironmentTimeout(2000); // Base timeout of 2s
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for registry validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far`);
					return validationResultCalls.length >= 3; // Expect at least a few tool validations
				},
				'registry validation result messages to be sent',
				maxWaitTime
			);

			// Verify postMessage was called
			assert(postMessageSpy.called, 'webview.postMessage should have been called');

			// Check if platform check message was sent
			const platformCalls = postMessageSpy.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'platformCheck'
			);
			assert(platformCalls.length > 0, 'Platform check message should be sent');

			// Check if validationResult messages were sent
			const validationResultCalls = postMessageSpy.getCalls().filter(call =>
				call.args[0] && call.args[0].command === 'validationResult'
			);

			assert(validationResultCalls.length > 0, 'Validation result messages should be sent');

			// Verify that findProgram was called with registry tools
			assert(findProgramStub.called, 'findProgram should be called');

			// Check that it was called with actual ToolInfo objects from the registry
			const findProgramCalls = findProgramStub.getCalls();
			assert(findProgramCalls.some(call =>
				call.args[0] && call.args[0].name === 'Python'
			), 'findProgram should be called with Python tool from registry');
		});

		test('should handle tool validation failures gracefully with registry', async () => {
			console.log(`DEBUG: Running failure test in ${isWSL() ? 'WSL' : 'standard'} environment`);

			// Mock all tools to fail
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.callsFake(() => Promise.resolve({ available: false, isCustomPath: false }));

			sandbox.stub(ProgramUtils, 'isWSL').returns(false);
			sandbox.stub(ProgramUtils, 'checkAllPythonPackages').resolves([]);

			// Clear any existing panels
			if ((ValidateEnvironmentPanel as any).currentPanel) {
				(ValidateEnvironmentPanel as any).currentPanel = undefined;
			}

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');
			const webview = panel._panel.webview;
			const postMessageSpy = sandbox.spy(webview, 'postMessage');

			// Wait for validation to complete
			const maxWaitTime = getEnvironmentTimeout(1500);
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for failure validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far (failure test)`);
					return validationResultCalls.length >= 3; // Expect at least a few tool validations
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
			const setToolPathSpy = sandbox.spy(apToolsConfig.ToolsConfig, 'setToolPath');

			// Test the functionality that the configuration uses
			apToolsConfig.ToolsConfig.setToolPath('PYTHON', customPath);

			assert(setToolPathSpy.calledWith('PYTHON', customPath));
		});

		test('should handle Python interpreter selection', async () => {
			const interpreterPath = '/usr/bin/python3.9';

			// Mock the VS Code commands that selectPythonInterpreter uses
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.withArgs('python.setInterpreter').resolves();

			// Mock the private findVSCodeExtPython method by stubbing its behavior
			// @ts-expect-error accessing private method for testing
			sandbox.stub(ProgramUtils, 'findVSCodeExtPython').resolves({
				available: true,
				path: interpreterPath,
				command: interpreterPath,
				isCustomPath: false,
				info: 'Test interpreter'
			});

			const setToolPathSpy = sandbox.spy(apToolsConfig.ToolsConfig, 'setToolPath');
			sandbox.stub(vscode.window, 'showInformationMessage');

			ValidateEnvironmentPanel.createOrShow();
			const panel = ValidateEnvironmentPanel.currentPanel;
			assert(panel, 'Panel should be created');

			// @ts-expect-error this is a private method
			panel._onReceiveMessage({ command: 'selectPythonInterpreter' });
			await new Promise(resolve => setTimeout(resolve, getEnvironmentTimeout(200)));

			assert(setToolPathSpy.calledWith('PYTHON', interpreterPath));
		});

		test('should detect custom tool paths correctly with registry', async () => {
			const customPath = '/custom/bin/python';

			// Mock findProgram to return custom path information
			const findProgramStub = sandbox.stub(ProgramUtils, 'findProgram');
			findProgramStub.withArgs(apToolsConfig.TOOLS_REGISTRY.PYTHON).resolves({
				available: true,
				version: '3.9.0',
				path: customPath,
				isCustomPath: true
			});

			// Default response for other tools
			findProgramStub.callsFake(() => Promise.resolve({ available: false, isCustomPath: false }));

			sandbox.stub(ProgramUtils, 'isWSL').returns(false);
			sandbox.stub(ProgramUtils, 'checkAllPythonPackages').resolves([]);

			// Set up ToolsConfig stub to return the custom path for Python
			const getToolPathStub = sandbox.stub(apToolsConfig.ToolsConfig, 'getToolPath');
			getToolPathStub.callsFake((toolId: string) => {
				if (toolId === 'PYTHON') {
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
			const maxWaitTime = getEnvironmentTimeout(1500);
			console.log(`DEBUG: Waiting up to ${maxWaitTime}ms for custom path validation completion`);

			await waitForCondition(
				() => {
					const validationResultCalls = postMessageSpy.getCalls().filter(call =>
						call.args[0] && call.args[0].command === 'validationResult'
					);
					console.log(`DEBUG: Found ${validationResultCalls.length} validation result calls so far (custom path test)`);
					return validationResultCalls.length >= 3; // Expect at least a few tool validations
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
				call.args[0].tool === 'PYTHON'
			);

			if (pythonValidationCall) {
				assert.strictEqual(pythonValidationCall.args[0].path, customPath);
				assert.strictEqual(pythonValidationCall.args[0].isCustomPath, true);
			}
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

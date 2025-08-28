/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* cSpell:words ardupilot sitl */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { apBuildConfigPanel } from '../../apBuildConfigPanel';
import { UIHooks } from '../../apUIHooks';
import { APExtensionContext } from '../../extension';
import { APTaskProvider } from '../../taskProvider';
import { getApExtApi } from './common';

suite('apBuildConfigPanel Test Suite - createOrShow Implementation', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;
	let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
	let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
	let mockExtensionUri: vscode.Uri;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder);
		assert.ok(apExtensionContext.vscodeContext);
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
			onDidDispose: sandbox.stub().callsFake((_callback: () => void) => {
				return { dispose: sandbox.stub() };
			}),
			viewColumn: vscode.ViewColumn.One
		} as unknown as sinon.SinonStubbedInstance<vscode.WebviewPanel>;

		// Mock VS Code APIs
		sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel as unknown as vscode.WebviewPanel);
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);
		sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
		sandbox.stub(vscode.commands, 'executeCommand').resolves();
	});

	teardown(() => {
		sandbox.restore();
		// Clean up any existing panels
		if ((apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel) {
			(apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel = undefined;
		}
	});

	suite('Build Hook Configuration', () => {
		test('should invoke build hook and run task correctly', async () => {
			// Create the panel
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Access the panel instance to get UI hooks
			const panel = (apBuildConfigPanel as any).currentPanel;
			assert.ok(panel, 'Panel should be created');

			let buildHookMessage: Record<string, unknown> | null = null;
			const buildHookCalled = new Promise<void>((resolve) => {
				// Hook into the build event
				panel._uiHooks.on('build', (message: Record<string, unknown>) => {
					try {
						buildHookMessage = message;
						// Verify the message structure
						assert.ok(message.board, 'Message should have board');
						assert.ok(message.target, 'Message should have target');
						resolve();
					} catch (error) {
						console.error('Build hook validation failed:', error);
					}
				});
			});

			// Simulate webview sending build message for hardware target
			const buildMessage = {
				command: 'build',
				board: 'CubeOrangePlus',
				target: 'copter',
				configName: 'CubeOrangePlus-copter',
				extraConfig: '--debug',
			};

			// Trigger the build event directly through UI hooks
			panel._uiHooks._onMessage(buildMessage);

			// Wait for the build hook to be called
			await buildHookCalled;

			// Verify the hook received the correct message
			assert.ok(buildHookMessage, 'Build hook should have been called');
			assert.strictEqual((buildHookMessage as any).board, 'CubeOrangePlus', 'Hook should receive correct board');
			assert.strictEqual((buildHookMessage as any).target, 'copter', 'Hook should receive correct target');

		}).timeout(100000);

		test('should process build hook with SITL configuration', async () => {
			// Create the panel
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Access the panel instance to get UI hooks
			const panel = (apBuildConfigPanel as any).currentPanel;
			assert.ok(panel, 'Panel should be created');

			let buildHookMessage: Record<string, unknown> | null = null;
			const buildHookCalled = new Promise<void>((resolve) => {
				// Hook into the build event
				panel._uiHooks.on('build', (message: Record<string, unknown>) => {
					try {
						buildHookMessage = message;
						// Verify the message structure
						assert.ok(message.board, 'Message should have board');
						assert.ok(message.target, 'Message should have target');
						if (message.simVehicleCommand) {
							assert.ok(typeof message.simVehicleCommand === 'string', 'Message should have simVehicleCommand string');
						}
						resolve();
					} catch (error) {
						console.error('Build hook validation failed:', error);
					}
				});
			});

			// Create a build message with SITL-specific options
			const buildMessage = {
				command: 'build',
				board: 'sitl',
				target: 'copter',
				configName: 'sitl-copter',
				extraConfig: '--debug',
				simVehicleCommand: '--console --map'
			};

			// Trigger the build event directly through UI hooks
			panel._uiHooks._onMessage(buildMessage);

			// Wait for the build hook to be called
			await buildHookCalled;

			// Verify the hook received the correct message
			assert.ok(buildHookMessage, 'Build hook should have been called');
			assert.strictEqual((buildHookMessage as any).board, 'sitl', 'Hook should receive correct board');
			assert.strictEqual((buildHookMessage as any).target, 'copter', 'Hook should receive correct target');
			assert.strictEqual((buildHookMessage as any).simVehicleCommand, '--console --map', 'Hook should receive correct simVehicleCommand');

		}).timeout(100000);
	});

	suite('createOrShow with Existing Task', () => {
		test('should launch with Edit Build Configuration title when task provided', async () => {
			const mockTask = {
				definition: {
					type: 'ardupilot',
					configure: 'CubeOrangePlus',
					target: 'copter',
				}
			} as unknown as vscode.Task;

			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			// Verify panel was created with edit title
			assert.ok((vscode.window.createWebviewPanel as sinon.SinonStub).calledWith(
				'apBuildConfigPanel',
				'Edit Build Configuration',
				sinon.match.any,
				sinon.match.any
			), 'Panel should be created with Edit Build Configuration title');

			// Verify panel title is set correctly
			assert.strictEqual(mockPanel.title, 'Edit Build Configuration', 'Panel title should be Edit Build Configuration');

			// Test by triggering getCurrentTask directly since the constructor should have set up the task
			const panel = (apBuildConfigPanel as any).currentPanel;
			panel._uiHooks._onMessage({ command: 'getCurrentTask' });

			// Verify getCurrentTask message is posted with task data
			const postMessageCalls = (mockWebview.postMessage as sinon.SinonStub).getCalls();
			const getCurrentTaskCall = postMessageCalls.find(call =>
				call.args[0].command === 'getCurrentTask'
			);

			assert.ok(getCurrentTaskCall, 'Panel should post getCurrentTask message');
			const message = getCurrentTaskCall.args[0];
			assert.ok(message.task, 'Message should include task definition');
			assert.strictEqual(message.task.configure, 'CubeOrangePlus', 'Task should have correct board');
			assert.strictEqual(message.task.target, 'copter', 'Task should have correct target');
		});

		test('should handle switching between different tasks in edit mode', async () => {
			const initialTask = {
				definition: { type: 'ardupilot', configure: 'CubeOrangePlus' }
			} as unknown as vscode.Task;

			const newTask = {
				definition: { type: 'ardupilot', configure: 'CubeBlack' }
			} as unknown as vscode.Task;

			// Create panel with initial task (edit mode)
			apBuildConfigPanel.createOrShow(mockExtensionUri, initialTask);

			// Verify initial panel was created
			assert.strictEqual((vscode.window.createWebviewPanel as sinon.SinonStub).callCount, 1, 'Should create initial panel');

			// Verify initial panel has the task
			const initialPanel = (apBuildConfigPanel as any).currentPanel;
			assert.ok(initialPanel, 'Panel should exist');
			assert.ok(initialPanel._currentTask, 'Panel should have current task');

			let currentPanel = (apBuildConfigPanel as any).currentPanel;
			// Trigger getCurrentTask to verify the task was updated
			currentPanel._uiHooks._onMessage({ command: 'getCurrentTask' });

			// Verify task was set correctly
			let postMessageCalls = (mockWebview.postMessage as sinon.SinonStub).getCalls();
			const initialTaskCall = postMessageCalls.find(call =>
				call.args[0].command === 'getCurrentTask' &&
				call.args[0].task?.configure === 'CubeOrangePlus'
			);

			assert.ok(initialTaskCall, 'Panel should be initialized with initial task');

			// Clear previous messages and switch to new task (still edit mode)
			(mockWebview.postMessage as sinon.SinonStub).resetHistory();
			apBuildConfigPanel.createOrShow(mockExtensionUri, newTask);

			// The current implementation disposes and recreates panels when switching between different task objects
			// This is because it uses object identity comparison (task1 !== task2) rather than task content comparison
			// This behavior ensures that the panel is properly updated with the new task's features and configuration

			// Verify that the panel functionality works correctly regardless of implementation details
			currentPanel = (apBuildConfigPanel as any).currentPanel;
			assert.ok(currentPanel, 'Panel should exist after task switch');

			// Trigger getCurrentTask to verify the task was updated
			currentPanel._uiHooks._onMessage({ command: 'getCurrentTask' });

			// Verify task was updated to the new task
			postMessageCalls = (mockWebview.postMessage as sinon.SinonStub).getCalls();
			const updateTaskCall = postMessageCalls.find(call =>
				call.args[0].command === 'getCurrentTask' &&
				call.args[0].task?.configure === 'CubeBlack'
			);

			assert.ok(updateTaskCall, 'Panel should be updated with new task');

			// Verify panel title remains in edit mode
			assert.strictEqual(mockPanel.title, 'Edit Build Configuration', 'Panel title should remain Edit Build Configuration');

			// Verify the current panel has the new task
			assert.strictEqual(currentPanel._currentTask, newTask, 'Panel should have the updated task');
		});

		test('should dispose and recreate when switching from add to edit mode', () => {
			// Create panel in add mode
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const disposeStub = mockPanel.dispose;

			// Switch to edit mode
			const mockTask = {
				definition: { type: 'ardupilot', configure: 'CubeOrangePlus' }
			} as unknown as vscode.Task;
			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			assert.ok((disposeStub as sinon.SinonStub).calledOnce, 'Previous panel should be disposed');
			assert.strictEqual((vscode.window.createWebviewPanel as sinon.SinonStub).callCount, 2, 'New panel should be created');
		});

		test('should handle override configuration build message', () => {
			// Mock APTaskProvider.getOrCreateBuildConfig
			const getOrCreateBuildConfigStub = sandbox.stub(APTaskProvider, 'getOrCreateBuildConfig');
			const mockTask = {
				definition: {
					type: 'ardupilot',
					configName: 'custom-build',
					overrideEnabled: true,
					customConfigureCommand: 'custom configure',
					customBuildCommand: 'custom build'
				}
			} as unknown as vscode.Task;
			getOrCreateBuildConfigStub.resolves(mockTask);

			// Create panel and simulate build message with override
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const panel = (apBuildConfigPanel as any).currentPanel;

			// Simulate build message with override configuration
			panel._uiHooks._onMessage({
				command: 'build',
				board: '',
				target: '',
				configName: 'custom-build',
				extraConfig: '',
				simVehicleCommand: '',
				overrideEnabled: true,
				customConfigureCommand: 'custom configure',
				customBuildCommand: 'custom build'
			});

			// Verify getOrCreateBuildConfig was called with override parameters
			assert.ok(getOrCreateBuildConfigStub.calledWith(
				'', '', 'custom-build', '', '', true, 'custom configure', 'custom build'
			), 'Should call getOrCreateBuildConfig with override parameters');
		});
	});
});

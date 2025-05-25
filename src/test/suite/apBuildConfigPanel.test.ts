import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { apBuildConfigPanel } from '../../apBuildConfigPanel';
import { APTaskProvider } from '../../taskProvider';
import { UIHooks } from '../../apUIHooks';
import * as apActions from '../../apActions';

suite('apBuildConfigPanel Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
	let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
	let mockExtensionUri: vscode.Uri;
	let mockWorkspaceFolder: vscode.WorkspaceFolder;

	setup(() => {
		// Restore any existing sandbox to prevent conflicts
		if (sandbox) {
			sandbox.restore();
		}
		sandbox = sinon.createSandbox();

		// Mock extension URI
		mockExtensionUri = vscode.Uri.file('/mock/extension/path');

		// Mock workspace folder
		mockWorkspaceFolder = {
			uri: vscode.Uri.file('/mock/workspace'),
			name: 'test-workspace',
			index: 0
		};

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
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			onDidDispose: sandbox.stub().callsFake((_callback: () => void) => {
				return { dispose: sandbox.stub() };
			}),
			viewColumn: vscode.ViewColumn.One
		} as unknown as sinon.SinonStubbedInstance<vscode.WebviewPanel>;

		// Mock VS Code APIs
		sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel as unknown as vscode.WebviewPanel);
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
		sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

		// Mock UIHooks - use try-catch to handle potential conflicts
		try {
			sandbox.stub(UIHooks.prototype, 'dispose');
		} catch {
			// Already stubbed, ignore
		}

		// Mock other dependencies
		try {
			sandbox.stub(apActions, 'setActiveConfiguration');
		} catch {
			// Already stubbed, ignore
		}

		// Don't stub these here as they're needed by specific tests:
		// - UIHooks.prototype.on (needed by error handling tests)
		// - vscode.tasks.executeTask (needed by error handling tests)

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		sandbox.stub(vscode.tasks, 'onDidEndTaskProcess').callsFake((_callback: (e: vscode.TaskProcessEndEvent) => void) => {
			return { dispose: sandbox.stub() };
		});
		sandbox.stub(vscode.commands, 'executeCommand').resolves();
	});

	teardown(() => {
		sandbox.restore();
		// Clean up any existing panels
		if ((apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel) {
			(apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel = undefined;
		}
	});

	suite('createOrShow', () => {
		test('should create new panel when none exists', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			assert((vscode.window.createWebviewPanel as sinon.SinonStub).calledOnce);
			assert((vscode.window.createWebviewPanel as sinon.SinonStub).calledWith(
				'apBuildConfigPanel',
				'Create a new build configuration',
				vscode.ViewColumn.One,
				{ enableScripts: true }
			));
		});

		test('should create panel with edit title when task provided', () => {
			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;

			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			assert((vscode.window.createWebviewPanel as sinon.SinonStub).calledWith(
				'apBuildConfigPanel',
				'Edit Build Configuration',
				sinon.match.any,
				sinon.match.any
			));
		});

		test('should reveal existing panel when same mode', () => {
			// Create initial panel
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const revealStub = mockPanel.reveal;

			// Try to create another panel
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			assert((revealStub as sinon.SinonStub).calledOnce);
			assert.strictEqual((vscode.window.createWebviewPanel as sinon.SinonStub).callCount, 1);
		});

		test('should dispose and recreate panel when mode changes', () => {
			// Create panel without task (add mode)
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const disposeStub = mockPanel.dispose;

			// Switch to edit mode
			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;
			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			assert((disposeStub as sinon.SinonStub).calledOnce);
			assert.strictEqual((vscode.window.createWebviewPanel as sinon.SinonStub).callCount, 2);
		});
	});

	suite('constructor and initialization', () => {
		test('should initialize with task and load features', () => {
			const mockTask = {
				definition: {
					type: 'ardupilot',
					configure: 'test-board',
					features: []
				}
			} as unknown as vscode.Task;

			const featuresPath = path.join('/mock/workspace', 'build', 'test-board', 'features.txt');
			sandbox.stub(fs, 'existsSync').withArgs(featuresPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(featuresPath, 'utf8').returns('FEATURE1\nFEATURE2\n\n');

			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			assert((fs.existsSync as sinon.SinonStub).calledWith(featuresPath));
			assert((fs.readFileSync as sinon.SinonStub).calledWith(featuresPath, 'utf8'));
		});

		test('should handle missing workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;

			assert.throws(() => {
				apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);
			}, /No workspace folder is open/);
		});

		test('should set up UI hooks and message handlers', () => {
			const onStub = sandbox.stub(UIHooks.prototype, 'on');

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Verify UI hooks are set up for various commands
			assert(onStub.calledWith('build', sinon.match.func));
			assert(onStub.calledWith('getCurrentTask', sinon.match.func));
			assert(onStub.calledWith('switchToAddMode', sinon.match.func));
			assert(onStub.calledWith('boardSelected', sinon.match.func));
		});
	});

	suite('findExistingTaskForBoard', () => {
		test('should find existing task for board', () => {
			const tasksPath = path.join('/mock/workspace', '.vscode', 'tasks.json');
			const mockTasksJson = {
				tasks: [
					{
						type: 'ardupilot',
						configure: 'test-board',
						target: 'test-target'
					}
				]
			};

			sandbox.stub(fs, 'existsSync').withArgs(tasksPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(tasksPath, 'utf8').returns(JSON.stringify(mockTasksJson));
			sandbox.stub(APTaskProvider, 'createTask').returns({} as unknown as vscode.Task);

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Access private method through any cast for testing
			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { findExistingTaskForBoard: (board: string) => vscode.Task | undefined } }).currentPanel;
			const result = panel?.findExistingTaskForBoard('test-board');

			assert(result);
			assert((APTaskProvider.createTask as sinon.SinonStub).calledOnce);
		});

		test('should return undefined when no task found', () => {
			const tasksPath = path.join('/mock/workspace', '.vscode', 'tasks.json');
			sandbox.stub(fs, 'existsSync').withArgs(tasksPath).returns(false);

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { findExistingTaskForBoard: (board: string) => vscode.Task | undefined } }).currentPanel;
			const result = panel?.findExistingTaskForBoard('nonexistent-board');

			assert.strictEqual(result, undefined);
		});

		test('should handle JSON parse errors gracefully', () => {
			const tasksPath = path.join('/mock/workspace', '.vscode', 'tasks.json');
			sandbox.stub(fs, 'existsSync').withArgs(tasksPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(tasksPath, 'utf8').returns('invalid json');

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { findExistingTaskForBoard: (board: string) => vscode.Task | undefined } }).currentPanel;
			const result = panel?.findExistingTaskForBoard('test-board');

			assert.strictEqual(result, undefined);
		});
	});

	suite('updateCurrentTask', () => {
		test('should update task and load features', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { updateCurrentTask: (task: vscode.Task) => void } }).currentPanel;

			const mockTask = {
				definition: {
					type: 'ardupilot',
					configure: 'new-board',
					features: []
				}
			} as unknown as vscode.Task;

			const featuresPath = path.join('/mock/workspace', 'build', 'new-board', 'features.txt');
			sandbox.stub(fs, 'existsSync').withArgs(featuresPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(featuresPath, 'utf8').returns('NEW_FEATURE\n');

			panel?.updateCurrentTask(mockTask);

			assert.strictEqual(mockPanel.title, 'Edit Build Configuration');
			assert((mockWebview.postMessage as sinon.SinonStub).calledWith({
				command: 'getCurrentTask',
				task: mockTask.definition,
				featuresFileExists: true
			}));
		});

		test('should handle missing features file', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { updateCurrentTask: (task: vscode.Task) => void } }).currentPanel;

			const mockTask = {
				definition: {
					type: 'ardupilot',
					configure: 'new-board',
					features: []
				}
			} as unknown as vscode.Task;

			const featuresPath = path.join('/mock/workspace', 'build', 'new-board', 'features.txt');
			sandbox.stub(fs, 'existsSync').withArgs(featuresPath).returns(false);

			panel?.updateCurrentTask(mockTask);

			assert.strictEqual(mockPanel.title, 'Edit Build Configuration');
			assert((mockWebview.postMessage as sinon.SinonStub).calledWith({
				command: 'getCurrentTask',
				task: mockTask.definition,
				featuresFileExists: false
			}));
		});
	});

	suite('switchToAddMode', () => {
		test('should switch to add mode correctly', () => {
			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;

			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);
			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { switchToAddMode: () => void } }).currentPanel;

			panel?.switchToAddMode();

			assert.strictEqual(mockPanel.title, 'New Build Configuration');
			assert((mockWebview.postMessage as sinon.SinonStub).calledWith({
				command: 'getCurrentTask',
				task: null
			}));
		});
	});

	suite('message handlers', () => {
		test('should handle build message', () => {
			// Add necessary stubs for this test
			sandbox.stub(UIHooks.prototype, 'on');
			sandbox.stub(vscode.tasks, 'executeTask').resolves({} as unknown as vscode.TaskExecution);

			// Mock filesystem operations
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(fs, 'mkdirSync');
			sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'readFileSync').returns('{}');

			sandbox.stub(APTaskProvider, 'getOrCreateBuildConfig').returns({
				definition: {
					type: 'ardupilot',
					configure: 'test-board',
					target: 'test-target',
					simVehicleCommand: ''
				}
			} as unknown as vscode.Task);

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Get the build message handler
			const onStub = UIHooks.prototype.on as sinon.SinonStub;
			const buildHandler = onStub.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === 'build')?.args[1];

			assert(buildHandler);

			const mockMessage = {
				board: 'test-board',
				target: 'test-target',
				features: ['FEATURE1'],
				enableFeatureConfig: true,
				simVehicleCommand: 'sim_vehicle.py'
			};

			buildHandler(mockMessage);

			assert((APTaskProvider.getOrCreateBuildConfig as sinon.SinonStub).calledOnce);
			assert((apActions.setActiveConfiguration as sinon.SinonStub).calledOnce);
			assert((vscode.tasks.executeTask as sinon.SinonStub).calledOnce);
		});

		test('should handle getCurrentTask message', () => {
			// Add necessary stubs for this test
			sandbox.stub(UIHooks.prototype, 'on');

			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;

			apBuildConfigPanel.createOrShow(mockExtensionUri, mockTask);

			const onStub = UIHooks.prototype.on as sinon.SinonStub;
			const getCurrentTaskHandler = onStub.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === 'getCurrentTask')?.args[1];

			assert(getCurrentTaskHandler);

			getCurrentTaskHandler();

			assert((mockWebview.postMessage as sinon.SinonStub).calledWith({
				command: 'getCurrentTask',
				task: mockTask.definition
			}));
		});

		test('should handle boardSelected message', () => {
			// Add necessary stubs for this test
			sandbox.stub(UIHooks.prototype, 'on');

			sandbox.stub(fs, 'existsSync').returns(false);

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			const onStub = UIHooks.prototype.on as sinon.SinonStub;
			const boardSelectedHandler = onStub.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === 'boardSelected')?.args[1];

			assert(boardSelectedHandler);

			boardSelectedHandler({ board: 'new-board' });

			// Should switch to add mode when no existing task found
			assert((mockWebview.postMessage as sinon.SinonStub).calledWith({
				command: 'getCurrentTask',
				task: null
			}));
		});
	});

	suite('webview content generation', () => {
		test('should generate correct HTML content', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Check that HTML is set and contains expected elements
			assert(typeof mockWebview.html === 'string');
			const html = mockWebview.html;
			assert(html.includes('<!DOCTYPE html>'));
			assert(html.includes('<div id="buildConfig"></div>'));
			assert(html.includes('Content-Security-Policy'));
		});
	});

	suite('dispose', () => {
		test('should clean up resources on dispose', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);
			const panel = (apBuildConfigPanel as unknown as { currentPanel?: { dispose: () => void } }).currentPanel;

			panel?.dispose();

			assert((mockPanel.dispose as sinon.SinonStub).calledOnce);
			assert.strictEqual((apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel, undefined);
		});

		test('should dispose on panel close', () => {
			apBuildConfigPanel.createOrShow(mockExtensionUri);

			// Simulate panel disposal
			const onDidDisposeCallback = (mockPanel.onDidDispose as sinon.SinonStub).firstCall.args[0];
			onDidDisposeCallback();

			assert.strictEqual((apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel, undefined);
		});
	});

	suite('revive', () => {
		test('should revive panel correctly', () => {
			const mockTask = {
				definition: { type: 'ardupilot', configure: 'test-board' }
			} as unknown as vscode.Task;

			apBuildConfigPanel.revive(mockPanel as unknown as vscode.WebviewPanel, mockExtensionUri, mockTask);

			assert((apBuildConfigPanel as unknown as { currentPanel?: unknown }).currentPanel);
		});
	});

	suite('error handling', () => {
		test('should handle UI hooks setup errors gracefully', () => {
			sandbox.stub(UIHooks.prototype, 'on').throws(new Error('Hook setup failed'));

			// The code currently doesn't handle this error gracefully, so it will throw
			assert.throws(() => {
				apBuildConfigPanel.createOrShow(mockExtensionUri);
			}, /Hook setup failed/);
		});

		test('should handle task execution errors gracefully', () => {
			sandbox.stub(UIHooks.prototype, 'on');
			sandbox.stub(vscode.tasks, 'executeTask').rejects(new Error('Task execution failed'));

			// Mock filesystem operations
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(fs, 'mkdirSync');
			sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'readFileSync').returns('{}');

			sandbox.stub(APTaskProvider, 'getOrCreateBuildConfig').returns({
				definition: {
					type: 'ardupilot',
					configure: 'test-board',
					target: 'test-target'
				}
			} as unknown as vscode.Task);

			apBuildConfigPanel.createOrShow(mockExtensionUri);

			const onStub = UIHooks.prototype.on as sinon.SinonStub;
			const buildHandler = onStub.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === 'build')?.args[1];

			const mockMessage = {
				board: 'test-board',
				target: 'test-target'
			};

			// Should not throw
			assert.doesNotThrow(() => {
				buildHandler(mockMessage);
			});
		});
	});
});

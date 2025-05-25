/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ToolsConfig, ToolPaths } from '../../apToolsConfig';

suite('apToolsConfig Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockWorkspaceFolder: vscode.WorkspaceFolder;
	let mockExtensionContext: vscode.ExtensionContext;

	setup(() => {
		sandbox = sinon.createSandbox();

		mockWorkspaceFolder = {
			uri: vscode.Uri.file('/mock/workspace'),
			name: 'test-workspace',
			index: 0
		};

		mockExtensionContext = {
			subscriptions: []
		} as any;

		// Mock VS Code APIs
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
		sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
			onDidChange: sandbox.stub().callsFake((callback) => ({ dispose: sandbox.stub() })),
			onDidCreate: sandbox.stub().callsFake((callback) => ({ dispose: sandbox.stub() })),
			dispose: sandbox.stub()
		} as any);
		sandbox.stub(vscode.window, 'showErrorMessage');

		// Reset static state
		(ToolsConfig as any).toolPaths = {};
		(ToolsConfig as any).configWatcher = undefined;
		(ToolsConfig as any).onConfigChangedCallbacks = [];
	});

	teardown(() => {
		sandbox.restore();
		// Clean up static state
		(ToolsConfig as any).toolPaths = {};
		(ToolsConfig as any).configWatcher = undefined;
		(ToolsConfig as any).onConfigChangedCallbacks = [];
	});

	suite('ToolPaths Interface', () => {
		test('should define tool paths structure correctly', () => {
			const toolPaths: ToolPaths = {
				'python': '/usr/bin/python3',
				'gcc': '/usr/bin/gcc',
				'gdb': '/usr/bin/gdb'
			};

			assert.strictEqual(toolPaths.python, '/usr/bin/python3');
			assert.strictEqual(toolPaths.gcc, '/usr/bin/gcc');
			assert.strictEqual(toolPaths.gdb, '/usr/bin/gdb');
		});

		test('should allow dynamic key access', () => {
			const toolPaths: ToolPaths = {};
			const toolId = 'custom-tool';
			const toolPath = '/custom/path/tool';

			toolPaths[toolId] = toolPath;

			assert.strictEqual(toolPaths[toolId], toolPath);
		});
	});

	suite('initialize', () => {
		test('should initialize configuration and setup watcher', () => {
			const loadConfigSpy = sandbox.spy(ToolsConfig, 'loadConfig');

			ToolsConfig.initialize(mockExtensionContext);

			assert(loadConfigSpy.calledOnce);
			assert(vscode.workspace.createFileSystemWatcher.calledOnce);
		});

		test('should not setup watcher when no workspace', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			ToolsConfig.initialize(mockExtensionContext);

			assert(vscode.workspace.createFileSystemWatcher.notCalled);
		});

		test('should register watcher in extension context', () => {
			ToolsConfig.initialize(mockExtensionContext);

			assert.strictEqual(mockExtensionContext.subscriptions.length, 1);
		});
	});

	suite('loadConfig', () => {
		test('should load configuration from file', () => {
			const mockConfig = {
				toolPaths: {
					'python': '/custom/python',
					'gcc': '/custom/gcc'
				}
			};

			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('python'), '/custom/python');
			assert.strictEqual(ToolsConfig.getToolPath('gcc'), '/custom/gcc');
		});

		test('should handle missing configuration file', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(false);

			ToolsConfig.loadConfig();

			// Should use empty configuration
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
		});

		test('should handle invalid JSON in configuration file', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').returns('invalid json');

			// Should not throw
			assert.doesNotThrow(() => {
				ToolsConfig.loadConfig();
			});

			// Should use empty configuration
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
		});

		test('should handle file read errors', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').throws(new Error('Read error'));

			// Should not throw
			assert.doesNotThrow(() => {
				ToolsConfig.loadConfig();
			});

			// Should use empty configuration
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
		});

		test('should handle configuration without toolPaths', () => {
			const mockConfig = {}; // Missing toolPaths

			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			// Should use empty tool paths
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
		});

		test('should handle no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			// Should not throw
			assert.doesNotThrow(() => {
				ToolsConfig.loadConfig();
			});
		});
	});

	suite('saveConfig', () => {
		test('should save configuration to file', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			const vscodeDir = path.dirname(configPath);

			sandbox.stub(fs, 'existsSync').withArgs(vscodeDir).returns(true);
			const writeFileStub = sandbox.stub(fs, 'writeFileSync');

			ToolsConfig.setToolPath('python', '/custom/python');

			assert(writeFileStub.calledOnce);
			const [writePath, content] = writeFileStub.firstCall.args;
			assert.strictEqual(writePath, configPath);

			const config = JSON.parse(content as string);
			assert.strictEqual(config.toolPaths.python, '/custom/python');
		});

		test('should create .vscode directory if not exists', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			const vscodeDir = path.dirname(configPath);

			sandbox.stub(fs, 'existsSync').withArgs(vscodeDir).returns(false);
			const mkdirStub = sandbox.stub(fs, 'mkdirSync');
			sandbox.stub(fs, 'writeFileSync');

			ToolsConfig.setToolPath('python', '/custom/python');

			assert(mkdirStub.calledOnce);
			assert(mkdirStub.calledWith(vscodeDir, { recursive: true }));
		});

		test('should handle file write errors', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'writeFileSync').throws(new Error('Write error'));

			ToolsConfig.setToolPath('python', '/custom/python');

			assert(vscode.window.showErrorMessage.calledOnce);
			assert((vscode.window.showErrorMessage as sinon.SinonStub).calledWith(
				sinon.match(/Failed to save tool configuration/)
			));
		});

		test('should handle no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			// Should not throw
			assert.doesNotThrow(() => {
				ToolsConfig.saveConfig();
			});
		});
	});

	suite('getToolPath', () => {
		test('should return configured tool path', () => {
			ToolsConfig.setToolPath('python', '/custom/python');

			const result = ToolsConfig.getToolPath('python');

			assert.strictEqual(result, '/custom/python');
		});

		test('should return undefined for unconfigured tool', () => {
			const result = ToolsConfig.getToolPath('nonexistent');

			assert.strictEqual(result, undefined);
		});
	});

	suite('setToolPath', () => {
		test('should set tool path and save configuration', () => {
			const saveConfigSpy = sandbox.spy(ToolsConfig, 'saveConfig');

			ToolsConfig.setToolPath('gcc', '/custom/gcc');

			assert.strictEqual(ToolsConfig.getToolPath('gcc'), '/custom/gcc');
			assert(saveConfigSpy.calledOnce);
		});

		test('should update existing tool path', () => {
			ToolsConfig.setToolPath('python', '/old/python');
			ToolsConfig.setToolPath('python', '/new/python');

			assert.strictEqual(ToolsConfig.getToolPath('python'), '/new/python');
		});
	});

	suite('removeToolPath', () => {
		test('should remove tool path and save configuration', () => {
			const saveConfigSpy = sandbox.spy(ToolsConfig, 'saveConfig');

			ToolsConfig.setToolPath('python', '/custom/python');
			ToolsConfig.removeToolPath('python');

			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
			assert(saveConfigSpy.calledTwice); // Once for set, once for remove
		});

		test('should handle removing non-existent tool', () => {
			const saveConfigSpy = sandbox.spy(ToolsConfig, 'saveConfig');

			ToolsConfig.removeToolPath('nonexistent');

			assert(saveConfigSpy.calledOnce);
		});
	});

	suite('getAllToolPaths', () => {
		test('should return copy of all tool paths', () => {
			ToolsConfig.setToolPath('python', '/custom/python');
			ToolsConfig.setToolPath('gcc', '/custom/gcc');

			const allPaths = ToolsConfig.getAllToolPaths();

			assert.strictEqual(allPaths.python, '/custom/python');
			assert.strictEqual(allPaths.gcc, '/custom/gcc');

			// Should be a copy, not reference
			allPaths.newTool = '/new/tool';
			assert.strictEqual(ToolsConfig.getToolPath('newTool'), undefined);
		});

		test('should return empty object when no tools configured', () => {
			const allPaths = ToolsConfig.getAllToolPaths();

			assert.deepStrictEqual(allPaths, {});
		});
	});

	suite('configuration change handling', () => {
		test('should register configuration change callback', () => {
			const callback = sandbox.stub();

			ToolsConfig.onConfigChanged(callback);

			// Verify callback was registered
			const callbacks = (ToolsConfig as any).onConfigChangedCallbacks;
			assert(callbacks.includes(callback));
		});

		test('should notify callbacks when configuration changes', () => {
			const callback1 = sandbox.stub();
			const callback2 = sandbox.stub();

			ToolsConfig.onConfigChanged(callback1);
			ToolsConfig.onConfigChanged(callback2);

			// Trigger notification
			(ToolsConfig as any).notifyConfigChanged();

			assert(callback1.calledOnce);
			assert(callback2.calledOnce);
		});

		test('should handle file watcher events', () => {
			const loadConfigSpy = sandbox.spy(ToolsConfig, 'loadConfig');
			const notifyStub = sandbox.stub(ToolsConfig as any, 'notifyConfigChanged');

			ToolsConfig.initialize(mockExtensionContext);

			// Get the file watcher mock
			const watcher = vscode.workspace.createFileSystemWatcher.returnValues[0];

			// Simulate file change
			const onChangeCallback = watcher.onDidChange.firstCall.args[0];
			onChangeCallback();

			assert(loadConfigSpy.calledTwice); // Once during init, once during change
			assert(notifyStub.calledOnce);

			// Simulate file creation
			const onCreateCallback = watcher.onDidCreate.firstCall.args[0];
			onCreateCallback();

			assert(loadConfigSpy.calledThrice); // Once more for creation
			assert(notifyStub.calledTwice);
		});
	});

	suite('file system watcher', () => {
		test('should create watcher with correct pattern', () => {
			ToolsConfig.initialize(mockExtensionContext);

			assert(vscode.workspace.createFileSystemWatcher.calledOnce);

			const pattern = vscode.workspace.createFileSystemWatcher.firstCall.args[0];
			assert(pattern instanceof vscode.RelativePattern);
			// Compare the base URI properly - check that a RelativePattern was created with the right base
			// Since the constructor takes the workspace URI, just check the pattern string
			assert.strictEqual(pattern.pattern, '.vscode/apenv.json');
			assert.strictEqual(pattern.pattern, '.vscode/apenv.json');
		});

		test('should dispose watcher correctly', () => {
			ToolsConfig.initialize(mockExtensionContext);

			const watcher = vscode.workspace.createFileSystemWatcher.returnValues[0];

			// Simulate extension deactivation
			mockExtensionContext.subscriptions.forEach(disposable => disposable.dispose());

			assert(watcher.dispose.calledOnce);
		});
	});

	suite('error handling', () => {
		test('should handle JSON parsing errors gracefully', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').returns('{ invalid json }');

			// Should not throw
			assert.doesNotThrow(() => {
				ToolsConfig.loadConfig();
			});
		});

		test('should handle file system errors during save', () => {
			sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));

			// Should not throw, but should show error message
			assert.doesNotThrow(() => {
				ToolsConfig.setToolPath('test', '/test/path');
			});

			assert(vscode.window.showErrorMessage.called);
		});

		test('should handle missing permissions', () => {
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'writeFileSync').throws(new Error('EACCES: permission denied'));

			ToolsConfig.setToolPath('python', '/custom/python');

			assert(vscode.window.showErrorMessage.calledWith(
				sinon.match(/permission denied/)
			));
		});
	});

	suite('integration tests', () => {
		test('should work with real workspace structure', () => {
			// Mock a realistic workspace structure
			const workspaceRoot = '/real/workspace';
			const realWorkspaceFolder = {
				uri: vscode.Uri.file(workspaceRoot),
				name: 'real-workspace',
				index: 0
			};

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([realWorkspaceFolder]);

			const configPath = path.join(workspaceRoot, '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(false);

			ToolsConfig.loadConfig();

			// Should handle non-existent config gracefully
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
		});

		test('should integrate with VS Code file watcher system', () => {
			const mockWatcher = {
				onDidChange: sandbox.stub().returns({ dispose: sandbox.stub() }),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			// Restore the existing stub and create a new one
			vscode.workspace.createFileSystemWatcher.restore();
			sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher as any);

			ToolsConfig.initialize(mockExtensionContext);

			assert(mockWatcher.onDidChange.calledOnce);
			assert(mockWatcher.onDidCreate.calledOnce);
		});

		test('should persist configuration across extension reloads', () => {
			// Set some configuration
			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			const vscodeDir = path.dirname(configPath);

			const existsStub = sandbox.stub(fs, 'existsSync');
			existsStub.withArgs(vscodeDir).returns(true);
			const writeFileStub = sandbox.stub(fs, 'writeFileSync');

			ToolsConfig.setToolPath('python', '/persistent/python');

			// Verify it was written
			assert(writeFileStub.calledOnce);

			// Simulate reload by clearing state and loading again
			(ToolsConfig as any).toolPaths = {};

			const mockConfig = {
				toolPaths: {
					'python': '/persistent/python'
				}
			};

			// Use existing stubs or restore and create new ones
			const readFileStub = sandbox.stub(fs, 'readFileSync');
			readFileStub.withArgs(configPath, 'utf8').returns(JSON.stringify(mockConfig));

			existsStub.withArgs(configPath).returns(true);

			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('python'), '/persistent/python');
		});
	});

	suite('edge cases', () => {
		test('should handle empty tool paths object', () => {
			const mockConfig = {
				toolPaths: {}
			};

			const configPath = path.join('/mock/workspace', '.vscode', 'apenv.json');
			sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
			sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf8').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			assert.deepStrictEqual(ToolsConfig.getAllToolPaths(), {});
		});

		test('should handle special characters in tool paths', () => {
			const specialPath = '/path with spaces/and$special&chars/tool';

			ToolsConfig.setToolPath('special-tool', specialPath);

			assert.strictEqual(ToolsConfig.getToolPath('special-tool'), specialPath);
		});

		test('should handle very long tool paths', () => {
			const longPath = '/very'.repeat(100) + '/long/path/to/tool';

			ToolsConfig.setToolPath('long-path-tool', longPath);

			assert.strictEqual(ToolsConfig.getToolPath('long-path-tool'), longPath);
		});
	});
});

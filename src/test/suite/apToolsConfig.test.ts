/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* cSpell:words apenv eabi openocd */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { ToolsConfig } from '../../apToolsConfig';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('apToolsConfig Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;
	let tempConfigPath: string;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
		tempConfigPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'apenv.json');
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		// Reset static state
		(ToolsConfig as any).toolPaths = {};
		(ToolsConfig as any).onConfigChangedCallbacks = [];
		if ((ToolsConfig as any).configWatcher) {
			(ToolsConfig as any).configWatcher.dispose();
			(ToolsConfig as any).configWatcher = undefined;
		}
	});

	teardown(() => {
		sandbox.restore();
		// Clean up any created config files
		try {
			if (fs.existsSync(tempConfigPath)) {
				fs.unlinkSync(tempConfigPath);
			}
		} catch {
			// Ignore cleanup errors
		}
		// Reset static state
		(ToolsConfig as any).toolPaths = {};
		(ToolsConfig as any).onConfigChangedCallbacks = [];
		if ((ToolsConfig as any).configWatcher) {
			(ToolsConfig as any).configWatcher.dispose();
			(ToolsConfig as any).configWatcher = undefined;
		}
	});

	suite('Core Functionality', () => {
		test('should initialize with default empty configuration', () => {
			// Ensure no config file exists
			sandbox.stub(fs, 'existsSync').returns(false);

			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should load existing configuration successfully', () => {
			const mockConfig = {
				toolPaths: {
					'python': '/usr/bin/python3',
					'gcc': '/usr/bin/arm-none-eabi-gcc',
					'gdb': '/usr/bin/arm-none-eabi-gdb'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('python'), '/usr/bin/python3');
			assert.strictEqual(ToolsConfig.getToolPath('gcc'), '/usr/bin/arm-none-eabi-gcc');
			assert.strictEqual(ToolsConfig.getToolPath('gdb'), '/usr/bin/arm-none-eabi-gdb');
		});

		test('should handle malformed JSON configuration gracefully', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns('{ invalid json }');

			// Should not throw
			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should handle missing toolPaths property', () => {
			const mockConfig = {
				someOtherProperty: 'value'
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should return undefined for non-existent tool paths', () => {
			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('nonexistent'), undefined);
		});

		test('should return immutable copy of all tool paths', () => {
			const mockConfig = {
				toolPaths: {
					'python': '/usr/bin/python3'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			allPaths['python'] = '/modified/path';

			// Original should remain unchanged
			assert.strictEqual(ToolsConfig.getToolPath('python'), '/usr/bin/python3');
		});
	});

	suite('Tool Path Management', () => {
		test('should set and get tool paths correctly', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true); // .vscode directory exists
			sandbox.stub(fs, 'mkdirSync');

			const toolPath = '/custom/bin/python';
			ToolsConfig.setToolPath('python', toolPath);

			assert.strictEqual(ToolsConfig.getToolPath('python'), toolPath);
			assert(writeFileSyncStub.calledOnce);
		});

		test('should remove tool paths correctly', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			// Set a tool path first
			ToolsConfig.setToolPath('python', '/usr/bin/python');
			assert.strictEqual(ToolsConfig.getToolPath('python'), '/usr/bin/python');

			// Remove it
			ToolsConfig.removeToolPath('python');
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
			assert(writeFileSyncStub.calledTwice);
		});

		test('should handle multiple tool paths', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			const tools = {
				'python': '/usr/bin/python3',
				'gcc': '/usr/bin/arm-none-eabi-gcc',
				'gdb': '/usr/bin/arm-none-eabi-gdb',
				'openocd': '/usr/bin/openocd'
			};

			// Set multiple tool paths
			Object.entries(tools).forEach(([tool, toolPath]) => {
				ToolsConfig.setToolPath(tool, toolPath);
			});

			// Verify all are set correctly
			Object.entries(tools).forEach(([tool, expectedPath]) => {
				assert.strictEqual(ToolsConfig.getToolPath(tool), expectedPath);
			});

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, tools);
		});

		test('should handle empty and special characters in paths', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			const specialPaths = {
				'tool-with-dashes': '/path/with spaces/tool',
				'tool_with_underscores': '/path/with-special@chars/tool',
				'tool.with.dots': '/path/with/unicode/�o�l/tool'
			};

			Object.entries(specialPaths).forEach(([tool, toolPath]) => {
				ToolsConfig.setToolPath(tool, toolPath);
				assert.strictEqual(ToolsConfig.getToolPath(tool), toolPath);
			});
		});
	});

	suite('Configuration Persistence', () => {
		test('should save configuration with correct JSON structure', () => {
			let savedContent: string = '';
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync').callsFake((filePath, content) => {
				savedContent = content as string;
			});
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			ToolsConfig.setToolPath('python', '/usr/bin/python3');

			assert(writeFileSyncStub.calledOnce);
			const savedConfig = JSON.parse(savedContent);
			assert.deepStrictEqual(savedConfig, {
				toolPaths: {
					'python': '/usr/bin/python3'
				}
			});
		});

		test('should create .vscode directory if it does not exist', () => {
			const mkdirSyncStub = sandbox.stub(fs, 'mkdirSync');
			sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').callsFake((filePath: fs.PathLike) => {
				const pathStr = filePath.toString();
				// .vscode directory doesn't exist, but parent does
				return !pathStr.includes('.vscode');
			});

			ToolsConfig.setToolPath('python', '/usr/bin/python3');

			assert(mkdirSyncStub.calledOnce);
			const mkdirCall = mkdirSyncStub.getCall(0);
			assert(mkdirCall.args[0].toString().includes('.vscode'));
			assert.deepStrictEqual(mkdirCall.args[1], { recursive: true });
		});

		test('should handle workspace without folders', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			// Should not throw
			ToolsConfig.loadConfig();
			ToolsConfig.saveConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should handle empty workspace folders array', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);

			// Should not throw
			ToolsConfig.loadConfig();
			ToolsConfig.saveConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should preserve existing configuration when loading', () => {
			const existingConfig = {
				toolPaths: {
					'python': '/existing/python',
					'gcc': '/existing/gcc'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(existingConfig));

			ToolsConfig.loadConfig();

			// Add a new tool
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'mkdirSync');
			ToolsConfig.setToolPath('gdb', '/new/gdb');

			// Should preserve existing tools
			assert.strictEqual(ToolsConfig.getToolPath('python'), '/existing/python');
			assert.strictEqual(ToolsConfig.getToolPath('gcc'), '/existing/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('gdb'), '/new/gdb');
		});
	});

	suite('File System Watcher', () => {
		test('should initialize file system watcher correctly', () => {
			const mockWatcher = {
				onDidChange: sandbox.stub().returns({ dispose: sandbox.stub() }),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher')
				.returns(mockWatcher as any);

			ToolsConfig.initialize(mockContext);

			assert(createFileSystemWatcherStub.calledOnce);
			assert(mockWatcher.onDidChange.calledOnce);
			assert(mockWatcher.onDidCreate.calledOnce);

			// Verify the pattern includes the correct config file
			const watchPattern = createFileSystemWatcherStub.getCall(0).args[0];
			if (typeof watchPattern === 'string') {
				assert(watchPattern.includes('apenv.json'));
			} else {
				assert((watchPattern as vscode.RelativePattern).pattern.includes('apenv.json'));
			}
		});

		test('should not initialize watcher without workspace folders', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher');

			ToolsConfig.initialize(mockContext);

			assert(createFileSystemWatcherStub.notCalled);
		});

		test('should reload configuration when file changes', () => {
			let onDidChangeCallback: (() => void) | undefined;
			const mockWatcher = {
				onDidChange: sandbox.stub().callsFake((callback) => {
					onDidChangeCallback = callback;
					return { dispose: sandbox.stub() };
				}),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher as any);

			// Mock file operations for initial load
			sandbox.stub(fs, 'existsSync').returns(false);

			ToolsConfig.initialize(mockContext);

			// Initial state should be empty
			assert.deepStrictEqual(ToolsConfig.getAllToolPaths(), {});

			// Mock file exists now with content
			sandbox.restore();
			sandbox = sinon.createSandbox();
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify({
				toolPaths: { 'python': '/new/python' }
			}));

			// Trigger file change
			if (onDidChangeCallback) {
				onDidChangeCallback();
			}

			// Configuration should be reloaded
			assert.strictEqual(ToolsConfig.getToolPath('python'), '/new/python');
		});

		test('should notify callbacks when configuration changes', () => {
			let onDidChangeCallback: (() => void) | undefined;
			const mockWatcher = {
				onDidChange: sandbox.stub().callsFake((callback) => {
					onDidChangeCallback = callback;
					return { dispose: sandbox.stub() };
				}),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher as any);
			sandbox.stub(fs, 'existsSync').returns(false);

			ToolsConfig.initialize(mockContext);

			let callbackCount = 0;
			ToolsConfig.onConfigChanged(() => {
				callbackCount++;
			});

			// Trigger file change
			if (onDidChangeCallback) {
				onDidChangeCallback();
			}

			assert.strictEqual(callbackCount, 1);
		});

		test('should handle multiple callback registrations', () => {
			let onDidChangeCallback: (() => void) | undefined;
			const mockWatcher = {
				onDidChange: sandbox.stub().callsFake((callback) => {
					onDidChangeCallback = callback;
					return { dispose: sandbox.stub() };
				}),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher as any);
			sandbox.stub(fs, 'existsSync').returns(false);

			ToolsConfig.initialize(mockContext);

			let callback1Count = 0;
			let callback2Count = 0;

			ToolsConfig.onConfigChanged(() => {
				callback1Count++;
			});

			ToolsConfig.onConfigChanged(() => {
				callback2Count++;
			});

			// Trigger file change
			if (onDidChangeCallback) {
				onDidChangeCallback();
			}

			assert.strictEqual(callback1Count, 1);
			assert.strictEqual(callback2Count, 1);
		});
	});

	suite('Error Handling', () => {
		test('should handle file read errors gracefully', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').throws(new Error('Permission denied'));

			// Should not throw
			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should handle file write errors gracefully', () => {
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');
			sandbox.stub(fs, 'writeFileSync').throws(new Error('Disk full'));
			const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Should not throw
			ToolsConfig.setToolPath('python', '/usr/bin/python');

			assert(showErrorMessageStub.calledOnce);
			assert(showErrorMessageStub.getCall(0).args[0].includes('Failed to save tool configuration'));
		});

		test('should handle directory creation errors', () => {
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(fs, 'mkdirSync').throws(new Error('Permission denied'));
			sandbox.stub(fs, 'writeFileSync');
			const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Should not throw
			ToolsConfig.setToolPath('python', '/usr/bin/python');

			assert(showErrorMessageStub.calledOnce);
		});

	});

	suite('Integration Tests', () => {
		test('should work with real workspace configuration', () => {
			// Use actual workspace folder
			const realConfigPath = path.join(workspaceFolder?.uri.fsPath || '', '.vscode', 'apenv.json');

			// Ensure .vscode directory exists
			const vscodeDir = path.dirname(realConfigPath);
			if (!fs.existsSync(vscodeDir)) {
				fs.mkdirSync(vscodeDir, { recursive: true });
			}

			// Create a test configuration
			const testConfig = {
				toolPaths: {
					'test-python': '/test/bin/python',
					'test-gcc': '/test/bin/gcc'
				}
			};

			fs.writeFileSync(realConfigPath, JSON.stringify(testConfig, null, 4));

			try {
				// Load the real configuration
				ToolsConfig.loadConfig();

				assert.strictEqual(ToolsConfig.getToolPath('test-python'), '/test/bin/python');
				assert.strictEqual(ToolsConfig.getToolPath('test-gcc'), '/test/bin/gcc');

				// Modify and save
				ToolsConfig.setToolPath('test-gdb', '/test/bin/gdb');

				// Reload and verify persistence
				ToolsConfig.loadConfig();
				assert.strictEqual(ToolsConfig.getToolPath('test-python'), '/test/bin/python');
				assert.strictEqual(ToolsConfig.getToolPath('test-gcc'), '/test/bin/gcc');
				assert.strictEqual(ToolsConfig.getToolPath('test-gdb'), '/test/bin/gdb');

			} finally {
				// Clean up
				if (fs.existsSync(realConfigPath)) {
					fs.unlinkSync(realConfigPath);
				}
			}
		});

		test('should dispose watcher properly on context disposal', () => {
			const mockWatcher = {
				onDidChange: sandbox.stub().returns({ dispose: sandbox.stub() }),
				onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
				dispose: sandbox.stub()
			};

			sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher as any);

			ToolsConfig.initialize(mockContext);

			// Verify watcher is created and subscribed to context
			assert(mockContext.subscriptions.includes(mockWatcher as any));
		});

		test('should handle concurrent configuration operations', async () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			// Simulate concurrent tool path updates
			const promises = [
				Promise.resolve(ToolsConfig.setToolPath('python', '/usr/bin/python')),
				Promise.resolve(ToolsConfig.setToolPath('gcc', '/usr/bin/gcc')),
				Promise.resolve(ToolsConfig.setToolPath('gdb', '/usr/bin/gdb')),
				Promise.resolve(ToolsConfig.removeToolPath('python')),
				Promise.resolve(ToolsConfig.setToolPath('openocd', '/usr/bin/openocd'))
			];

			await Promise.all(promises);

			// All operations should complete without errors
			assert(writeFileSyncStub.callCount >= 5);

			// Final state should be consistent
			assert.strictEqual(ToolsConfig.getToolPath('python'), undefined);
			assert.strictEqual(ToolsConfig.getToolPath('gcc'), '/usr/bin/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('gdb'), '/usr/bin/gdb');
			assert.strictEqual(ToolsConfig.getToolPath('openocd'), '/usr/bin/openocd');
		});
	});
});

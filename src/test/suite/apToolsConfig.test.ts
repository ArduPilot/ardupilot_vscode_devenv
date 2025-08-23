/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* cSpell:words apenv eabi openocd mavproxy empy pymavlink */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { ToolsConfig } from '../../apToolsConfig';
import * as apToolsConfig from '../../apToolsConfig';
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
					'GCC': '/usr/bin/gcc',
					'ARM_GCC': '/usr/bin/arm-none-eabi-gcc',
					'GDB': '/usr/bin/arm-none-eabi-gdb'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('ARM_GCC'), '/usr/bin/arm-none-eabi-gcc');
			assert.strictEqual(ToolsConfig.getToolPath('GDB'), '/usr/bin/arm-none-eabi-gdb');
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

		test('should return immutable copy of all tool paths', () => {
			const mockConfig = {
				toolPaths: {
					'GCC': '/usr/bin/gcc'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			allPaths['python'] = '/modified/path';

			// Original should remain unchanged
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');
		});
	});

	suite('Tool Path Management', () => {
		test('should set and get tool paths correctly', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true); // .vscode directory exists
			sandbox.stub(fs, 'mkdirSync');

			const toolPath = '/custom/bin/gcc';
			ToolsConfig.setToolPath('GCC', toolPath);

			assert.strictEqual(ToolsConfig.getToolPath('GCC'), toolPath);
			assert(writeFileSyncStub.calledOnce);
		});

		test('should remove tool paths correctly', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			// Set a tool path first
			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');

			// Remove it
			ToolsConfig.removeToolPath('GCC');
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), undefined);
			assert(writeFileSyncStub.calledTwice);
		});

		test('should handle multiple tool paths', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			const tools = {
				'GCC': '/usr/bin/gcc',
				'ARM_GCC': '/usr/bin/arm-none-eabi-gcc',
				'GDB': '/usr/bin/arm-none-eabi-gdb',
				'OPENOCD': '/usr/bin/openocd'
			};

			// Set multiple tool paths
			Object.entries(tools).forEach(([tool, toolPath]) => {
				ToolsConfig.setToolPath(tool as apToolsConfig.ToolID, toolPath);
			});

			// Verify all are set correctly
			Object.entries(tools).forEach(([tool, expectedPath]) => {
				assert.strictEqual(ToolsConfig.getToolPath(tool as apToolsConfig.ToolID), expectedPath);
			});

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, tools);
		});

		test('should handle special characters in paths', () => {
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'mkdirSync');

			const specialPaths = {
				'GCC': '/path/with spaces/gcc',
				'ARM_GCC': '/path/with-special@chars/gcc',
				'MAVPROXY': '/path/with/unicode/tool'
			};

			Object.entries(specialPaths).forEach(([tool, toolPath]) => {
				ToolsConfig.setToolPath(tool as apToolsConfig.ToolID, toolPath);
				assert.strictEqual(ToolsConfig.getToolPath(tool as apToolsConfig.ToolID), toolPath);
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

			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

			assert(writeFileSyncStub.calledOnce);
			const savedConfig = JSON.parse(savedContent);
			assert.deepStrictEqual(savedConfig, {
				toolPaths: {
					'GCC': '/usr/bin/gcc'
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

			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

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
					'GCC': '/existing/gcc',
					'ARM_GCC': '/existing/arm-gcc'
				}
			};

			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(existingConfig));

			ToolsConfig.loadConfig();

			// Add a new tool
			const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
			sandbox.stub(fs, 'mkdirSync');
			ToolsConfig.setToolPath('GDB', '/new/gdb');

			// Should preserve existing tools
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/existing/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('ARM_GCC'), '/existing/arm-gcc');
			assert.strictEqual(ToolsConfig.getToolPath('GDB'), '/new/gdb');
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
				toolPaths: { 'GCC': '/new/gcc' }
			}));

			// Trigger file change
			if (onDidChangeCallback) {
				onDidChangeCallback();
			}

			// Configuration should be reloaded
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/new/gcc');
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
			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

			assert(showErrorMessageStub.calledOnce);
			assert(showErrorMessageStub.getCall(0).args[0].includes('Failed to save tool configuration'));
		});

		test('should handle directory creation errors', () => {
			sandbox.stub(fs, 'existsSync').returns(false);
			sandbox.stub(fs, 'mkdirSync').throws(new Error('Permission denied'));
			sandbox.stub(fs, 'writeFileSync');
			const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Should not throw
			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

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
					'GCC': '/test/bin/gcc',
					'ARM_GCC': '/test/bin/arm-gcc'
				}
			};

			fs.writeFileSync(realConfigPath, JSON.stringify(testConfig, null, 4));

			try {
				// Load the real configuration
				ToolsConfig.loadConfig();

				assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/test/bin/gcc');
				assert.strictEqual(ToolsConfig.getToolPath('ARM_GCC'), '/test/bin/arm-gcc');

				// Modify and save
				ToolsConfig.setToolPath('GDB', '/test/bin/gdb');

				// Reload and verify persistence
				ToolsConfig.loadConfig();
				assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/test/bin/gcc');
				assert.strictEqual(ToolsConfig.getToolPath('ARM_GCC'), '/test/bin/arm-gcc');
				assert.strictEqual(ToolsConfig.getToolPath('GDB'), '/test/bin/gdb');

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
				Promise.resolve(ToolsConfig.setToolPath('GCC', '/usr/bin/gcc')),
				Promise.resolve(ToolsConfig.setToolPath('GCC', '/usr/bin/gcc')),
				Promise.resolve(ToolsConfig.setToolPath('GDB', '/usr/bin/gdb')),
				Promise.resolve(ToolsConfig.removeToolPath('GCC')),
				Promise.resolve(ToolsConfig.setToolPath('OPENOCD', '/usr/bin/openocd'))
			];

			await Promise.all(promises);

			// All operations should complete without errors
			assert(writeFileSyncStub.callCount >= 5);

			// Final state should be consistent
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), undefined);
			assert.strictEqual(ToolsConfig.getToolPath('GDB'), '/usr/bin/gdb');
			assert.strictEqual(ToolsConfig.getToolPath('OPENOCD'), '/usr/bin/openocd');
		});
	});

	suite('Registry Architecture', () => {
		test('should have consistent TOOLS_REGISTRY structure', () => {
			// Verify each tool has required properties
			for (const [toolKey, toolInfo] of Object.entries(apToolsConfig.TOOLS_REGISTRY)) {
				assert(toolInfo.name, `${toolKey} should have a name`);
				assert(toolInfo.paths, `${toolKey} should have paths`);
				assert((toolInfo as apToolsConfig.ToolInfo).id === toolKey, `${toolKey} should have id field set to key`);

				// Check that tool has at least one platform path
				const hasLinux = 'linux' in toolInfo.paths;
				const hasDarwin = 'darwin' in toolInfo.paths;
				const hasWSL = 'wsl' in toolInfo.paths;
				assert(hasLinux || hasDarwin || hasWSL, `${toolKey} should have at least one platform path`);
			}
		});

		test('should provide type-safe tool access', () => {
			// Test that registry keys provide compile-time safety
			const gccTool = apToolsConfig.TOOLS_REGISTRY.GCC;
			assert.strictEqual(gccTool.name, 'GCC');
		});

		test('should have consistent PYTHON_PACKAGES_REGISTRY structure', () => {
			// Verify each package has required properties
			for (const [packageKey, packageInfo] of Object.entries(apToolsConfig.PYTHON_PACKAGES_REGISTRY)) {
				assert(packageInfo.name, `${packageKey} should have a name`);
				assert(packageInfo.description, `${packageKey} should have a description`);
			}
		});
	});

	suite('Registry Helpers', () => {
		test('should provide tool IDs list', () => {
			const toolIds = apToolsConfig.ToolsRegistryHelpers.getToolIdsList();

			assert(Array.isArray(toolIds));
			assert(toolIds.includes('GCC'));
			assert(toolIds.includes('ARM_GCC'));
			assert(toolIds.includes('MAVPROXY'));
		});

		test('should format Python packages for installation', () => {
			const packages = apToolsConfig.ToolsRegistryHelpers.getPythonPackagesForInstallation();

			assert(Array.isArray(packages));
			// Check that packages are formatted correctly with versions where specified
			assert(packages.some(pkg => pkg === 'empy==3.3.4'));
			assert(packages.some(pkg => pkg === 'future'));
			assert(packages.some(pkg => pkg === 'pymavlink'));
		});
	});
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* cSpell:words apenv eabi openocd mavproxy empy pymavlink */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
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
	let tempWorkspaceDir: string;
	let tempConfigPath: string;
	let tempVscodeDir: string;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		assert.ok(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		// Create isolated temp workspace
		tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptoolsconfig-'));
		tempVscodeDir = path.join(tempWorkspaceDir, '.vscode');
		tempConfigPath = path.join(tempVscodeDir, 'apenv.json');
		workspaceFolder = { uri: vscode.Uri.file(tempWorkspaceDir), name: 'temp', index: 0 } as vscode.WorkspaceFolder;
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);

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
		// Clean up temp workspace
		try {
			if (tempWorkspaceDir && fs.existsSync(tempWorkspaceDir)) {
				fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
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
			// Ensure no config file exists in temp workspace
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

			// Write real file under temp workspace
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}
			fs.writeFileSync(tempConfigPath, JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('ARM_GCC'), '/usr/bin/arm-none-eabi-gcc');
			assert.strictEqual(ToolsConfig.getToolPath('GDB'), '/usr/bin/arm-none-eabi-gdb');
		});

		test('should handle malformed JSON configuration gracefully', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}
			fs.writeFileSync(tempConfigPath, '{ invalid json }');

			// Should not throw
			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should handle missing toolPaths property', () => {
			const mockConfig = {
				someOtherProperty: 'value'
			};

			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}
			fs.writeFileSync(tempConfigPath, JSON.stringify(mockConfig));

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

			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}
			fs.writeFileSync(tempConfigPath, JSON.stringify(mockConfig));

			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			allPaths['python'] = '/modified/path';

			// Original should remain unchanged
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');
		});
	});

	suite('Tool Path Management', () => {
		test('should set and get tool paths correctly', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

			const toolPath = '/custom/bin/gcc';
			ToolsConfig.setToolPath('GCC', toolPath);

			assert.strictEqual(ToolsConfig.getToolPath('GCC'), toolPath);
			assert.ok(fs.existsSync(tempConfigPath));
			const content = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
			assert.strictEqual(content.toolPaths['GCC'], toolPath);
		});

		test('should remove tool paths correctly', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

			// Set a tool path first
			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), '/usr/bin/gcc');

			// Remove it
			ToolsConfig.removeToolPath('GCC');
			assert.strictEqual(ToolsConfig.getToolPath('GCC'), undefined);
			assert.ok(fs.existsSync(tempConfigPath));
			const content = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
			assert.strictEqual(content.toolPaths['GCC'], undefined);
		});

		test('should handle multiple tool paths', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

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

			// Verify file contents too
			assert.ok(fs.existsSync(tempConfigPath));
			const content = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
			assert.deepStrictEqual(content.toolPaths, tools);
		});

		test('should handle special characters in paths', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

			const specialPaths = {
				'GCC': '/path/with spaces/gcc',
				'ARM_GCC': '/path/with-special@chars/gcc',
				'MAVPROXY': '/path/with/unicode/tool'
			};

			Object.entries(specialPaths).forEach(([tool, toolPath]) => {
				ToolsConfig.setToolPath(tool as apToolsConfig.ToolID, toolPath);
				assert.strictEqual(ToolsConfig.getToolPath(tool as apToolsConfig.ToolID), toolPath);
			});

			const content = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
			assert.deepStrictEqual(content.toolPaths, specialPaths);
		});
	});

	suite('Configuration Persistence', () => {
		test('should save configuration with correct JSON structure', () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

			const savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
			assert.deepStrictEqual(savedConfig, {
				toolPaths: {
					'GCC': '/usr/bin/gcc'
				}
			});
		});

		test('should create .vscode directory if it does not exist', () => {
			// Ensure parent exists but .vscode does not
			assert.ok(fs.existsSync(tempWorkspaceDir));
			if (fs.existsSync(tempVscodeDir)) {
				fs.rmSync(tempVscodeDir, { recursive: true, force: true });
			}

			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

			assert.ok(fs.existsSync(tempVscodeDir));
			assert.ok(fs.existsSync(tempConfigPath));
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

			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}
			fs.writeFileSync(tempConfigPath, JSON.stringify(existingConfig));

			ToolsConfig.loadConfig();

			// Add a new tool
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

			assert.ok(createFileSystemWatcherStub.calledOnce);
			assert.ok(mockWatcher.onDidChange.calledOnce);
			assert.ok(mockWatcher.onDidCreate.calledOnce);

			// Verify the pattern includes the correct config file
			const watchPattern = createFileSystemWatcherStub.getCall(0).args[0];
			if (typeof watchPattern === 'string') {
				assert.ok(watchPattern.includes('apenv.json'));
			} else {
				assert.ok((watchPattern as vscode.RelativePattern).pattern.includes('apenv.json'));
			}
		});

		test('should not initialize watcher without workspace folders', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher');

			ToolsConfig.initialize(mockContext);

			assert.ok(createFileSystemWatcherStub.notCalled);
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

			ToolsConfig.initialize(mockContext);

			// Initial state should be empty
			assert.deepStrictEqual(ToolsConfig.getAllToolPaths(), {});

			// Mock file exists now with content
			fs.mkdirSync(tempVscodeDir, { recursive: true });
			fs.writeFileSync(tempConfigPath, JSON.stringify({ toolPaths: { 'GCC': '/new/gcc' } }));

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
			// Write an unreadable file then simulate read throwing by replacing with a directory
			fs.mkdirSync(tempVscodeDir, { recursive: true });
			fs.writeFileSync(tempConfigPath, '{"toolPaths":{}}');
			// Replace file by directory to cause readFileSync to throw
			fs.rmSync(tempConfigPath, { force: true });
			fs.mkdirSync(tempConfigPath);

			// Should not throw
			ToolsConfig.loadConfig();

			const allPaths = ToolsConfig.getAllToolPaths();
			assert.deepStrictEqual(allPaths, {});
		});

		test('should handle file write errors gracefully', () => {
			// Point config path to a directory to force write failure
			fs.mkdirSync(tempVscodeDir, { recursive: true });
			// Create a directory at the config file path
			fs.mkdirSync(tempConfigPath, { recursive: true });
			const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

			// Should not throw
			ToolsConfig.setToolPath('GCC', '/usr/bin/gcc');

			assert.ok(showErrorMessageStub.calledOnce);
			assert.ok(showErrorMessageStub.getCall(0).args[0].includes('Failed to save tool configuration'));
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
			assert.ok(mockContext.subscriptions.includes(mockWatcher as any));
		});

		test('should handle concurrent configuration operations', async () => {
			if (!fs.existsSync(tempVscodeDir)) {
				fs.mkdirSync(tempVscodeDir, { recursive: true });
			}

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
			assert.ok(fs.existsSync(tempConfigPath));

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
				assert.ok(toolInfo.name, `${toolKey} should have a name`);
				assert.ok(toolInfo.paths, `${toolKey} should have paths`);
				assert.ok((toolInfo as apToolsConfig.ToolInfo).id === toolKey, `${toolKey} should have id field set to key`);

				// Check that tool has at least one platform path
				const hasLinux = 'linux' in toolInfo.paths;
				const hasDarwin = 'darwin' in toolInfo.paths;
				const hasWSL = 'wsl' in toolInfo.paths;
				assert.ok(hasLinux || hasDarwin || hasWSL, `${toolKey} should have at least one platform path`);
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
				assert.ok(packageInfo.name, `${packageKey} should have a name`);
				assert.ok(packageInfo.description, `${packageKey} should have a description`);
			}
		});
	});

	suite('Registry Helpers', () => {
		test('should provide tool IDs list', () => {
			const toolIds = apToolsConfig.ToolsRegistryHelpers.getToolIdsList();

			assert.ok(Array.isArray(toolIds));
			assert.ok(toolIds.includes('GCC'));
			assert.ok(toolIds.includes('ARM_GCC'));
			assert.ok(toolIds.includes('MAVPROXY'));
		});

		test('should format Python packages for installation', () => {
			const packages = apToolsConfig.ToolsRegistryHelpers.getPythonPackagesForInstallation();

			assert.ok(Array.isArray(packages));
			// Check that packages are formatted correctly with versions where specified
			assert.ok(packages.some(pkg => pkg === 'empy==3.3.4'));
			assert.ok(packages.some(pkg => pkg === 'future'));
			assert.ok(packages.some(pkg => pkg === 'pymavlink'));
		});
	});
});

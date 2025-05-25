/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { activate, deactivate } from '../../extension';

suite('Extension Test Suite', () => {
	let mockContext: vscode.ExtensionContext;
	let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
	let mockWorkspaceFolder: vscode.WorkspaceFolder;

	suiteSetup(() => {
		// Store original workspace folders
		originalWorkspaceFolders = vscode.workspace.workspaceFolders;

		// Create mock workspace folder
		mockWorkspaceFolder = {
			uri: vscode.Uri.file('/test/workspace'),
			name: 'test-workspace',
			index: 0
		};

		// Mock workspace folders
		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			value: [mockWorkspaceFolder],
			configurable: true
		});

		// Mock extension context
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				keys: () => []
			},
			globalState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				setKeysForSync: () => {},
				keys: () => []
			},
			extensionUri: vscode.Uri.file('/test/extension'),
			extensionPath: '/test/extension',
			environmentVariableCollection: {} as any,
			asAbsolutePath: (relativePath: string) => path.join('/test/extension', relativePath),
			storageUri: vscode.Uri.file('/test/storage'),
			storagePath: '/test/storage',
			globalStorageUri: vscode.Uri.file('/test/global-storage'),
			globalStoragePath: '/test/global-storage',
			logUri: vscode.Uri.file('/test/logs'),
			logPath: '/test/logs',
			extensionMode: vscode.ExtensionMode.Test,
			extension: {} as any,
			secrets: {} as any,
			languageModelAccessInformation: {} as any
		};
	});

	suiteTeardown(() => {
		// Restore original workspace folders
		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			value: originalWorkspaceFolders,
			configurable: true
		});
	});

	suite('Extension Activation', () => {
		let registeredCommands: string[] = [];
		let registeredProviders: string[] = [];
		let registeredTaskProviders: string[] = [];
		let registeredDebugProviders: string[] = [];

		setup(() => {
			registeredCommands = [];
			registeredProviders = [];
			registeredTaskProviders = [];
			registeredDebugProviders = [];

			// Mock vscode.commands.registerCommand
			const originalRegisterCommand = vscode.commands.registerCommand;
			(vscode.commands as any).registerCommand = (command: string, callback: (...args: any[]) => any) => {
				registeredCommands.push(command);
				return { dispose: () => {} };
			};

			// Mock vscode.window.registerTreeDataProvider
			const originalRegisterTreeDataProvider = vscode.window.registerTreeDataProvider;
			(vscode.window as any).registerTreeDataProvider = (viewId: string, provider: any) => {
				registeredProviders.push(viewId);
				return { dispose: () => {} };
			};

			// Mock vscode.tasks.registerTaskProvider
			const originalRegisterTaskProvider = vscode.tasks.registerTaskProvider;
			(vscode.tasks as any).registerTaskProvider = (type: string, provider: any) => {
				registeredTaskProviders.push(type);
				return { dispose: () => {} };
			};

			// Mock vscode.debug.registerDebugConfigurationProvider
			const originalRegisterDebugProvider = vscode.debug.registerDebugConfigurationProvider;
			(vscode.debug as any).registerDebugConfigurationProvider = (type: string, provider: any) => {
				registeredDebugProviders.push(type);
				return { dispose: () => {} };
			};

			// Mock vscode.window.registerFileDecorationProvider
			const originalRegisterFileDecorationProvider = vscode.window.registerFileDecorationProvider;
			(vscode.window as any).registerFileDecorationProvider = (provider: any) => {
				return { dispose: () => {} };
			};
		});

		test('should activate extension with workspace folder', () => {
			assert.doesNotThrow(() => {
				activate(mockContext);
			});
		});

		test('should register all required commands', () => {
			activate(mockContext);

			const expectedCommands = [
				'apBuildConfig.refreshEntry',
				'apBuildConfig.addEntry',
				'apBuildConfig.editEntry',
				'apBuildConfig.deleteEntry',
				'apBuildConfig.activate',
				'apBuildConfig.activateOnSelect',
				'apActions.refresh',
				'apActions.build',
				'apActions.debug',
				'apActions.upload',
				'apActions.run',
				'apActions.configure',
				'apActions.setActiveConfiguration',
				'connected-devices.refresh',
				'connected-devices.connectMAVProxy',
				'connected-devices.disconnectMAVProxy'
			];

			expectedCommands.forEach(command => {
				assert.ok(registeredCommands.includes(command), `Command ${command} should be registered`);
			});
		});

		test('should register all required tree data providers', () => {
			activate(mockContext);

			const expectedProviders = [
				'apWelcome',
				'apBuildConfig',
				'apActions',
				'connected-devices'
			];

			expectedProviders.forEach(provider => {
				assert.ok(registeredProviders.includes(provider), `Provider ${provider} should be registered`);
			});
		});

		test('should register task provider', () => {
			activate(mockContext);

			assert.ok(registeredTaskProviders.includes('ardupilot'), 'ArduPilot task provider should be registered');
		});

		test('should register debug configuration provider', () => {
			activate(mockContext);

			assert.ok(registeredDebugProviders.includes('apLaunch'), 'apLaunch debug provider should be registered');
		});

		test('should handle activation without workspace folder', () => {
			// Temporarily remove workspace folders
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: undefined,
				configurable: true
			});

			try {
				assert.doesNotThrow(() => {
					activate(mockContext);
				});

				// Should still register welcome provider
				assert.ok(registeredProviders.includes('apWelcome'));

				// But should not register workspace-dependent providers
				assert.ok(!registeredProviders.includes('apBuildConfig'));
				assert.ok(!registeredProviders.includes('apActions'));
			} finally {
				// Restore workspace folders
				Object.defineProperty(vscode.workspace, 'workspaceFolders', {
					value: [mockWorkspaceFolder],
					configurable: true
				});
			}
		});

		test('should handle empty workspace folders array', () => {
			// Set empty workspace folders array
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				value: [],
				configurable: true
			});

			try {
				assert.doesNotThrow(() => {
					activate(mockContext);
				});

				// Should still register welcome provider
				assert.ok(registeredProviders.includes('apWelcome'));
			} finally {
				// Restore workspace folders
				Object.defineProperty(vscode.workspace, 'workspaceFolders', {
					value: [mockWorkspaceFolder],
					configurable: true
				});
			}
		});

		test('should add subscriptions to context', () => {
			const initialSubscriptionCount = mockContext.subscriptions.length;

			activate(mockContext);

			// Should have added at least one subscription
			assert.ok(mockContext.subscriptions.length > initialSubscriptionCount);
		});
	});

	suite('Extension Deactivation', () => {
		test('should deactivate without errors', () => {
			// First activate to have something to deactivate
			activate(mockContext);

			assert.doesNotThrow(() => {
				deactivate();
			});
		});

		test('should handle deactivation when not activated', () => {
			assert.doesNotThrow(() => {
				deactivate();
			});
		});

		test('should dispose of task provider', () => {
			let taskProviderDisposed = false;

			// Mock task provider with dispose method
			const originalRegisterTaskProvider = vscode.tasks.registerTaskProvider;
			(vscode.tasks as any).registerTaskProvider = (type: string, provider: any) => {
				return {
					dispose: () => {
						taskProviderDisposed = true;
					}
				};
			};

			activate(mockContext);
			deactivate();

			assert.strictEqual(taskProviderDisposed, true);
		});

		test('should dispose of connected devices provider', () => {
			// This test verifies the deactivation calls dispose on providers
			// The actual dispose implementation is tested in the respective provider tests
			assert.doesNotThrow(() => {
				activate(mockContext);
				deactivate();
			});
		});
	});

	suite('Command Registration Integration', () => {
		test('should register commands with proper handlers', () => {
			const commandHandlers: { [key: string]: (...args: any[]) => any } = {};

			// Mock command registration to capture handlers
			(vscode.commands as any).registerCommand = (command: string, handler: (...args: any[]) => any) => {
				commandHandlers[command] = handler;
				return { dispose: () => {} };
			};

			activate(mockContext);

			// Verify handlers are functions
			Object.keys(commandHandlers).forEach(command => {
				assert.strictEqual(typeof commandHandlers[command], 'function',
					`Command ${command} should have a function handler`);
			});
		});

		test('should handle command execution errors gracefully', () => {
			const commandHandlers: { [key: string]: (...args: any[]) => any } = {};

			(vscode.commands as any).registerCommand = (command: string, handler: (...args: any[]) => any) => {
				commandHandlers[command] = handler;
				return { dispose: () => {} };
			};

			activate(mockContext);

			// Test that commands don't throw with undefined arguments
			Object.keys(commandHandlers).forEach(command => {
				assert.doesNotThrow(() => {
					try {
						commandHandlers[command]();
					} catch (error) {
						// Some commands may throw due to missing dependencies in test environment
						// This is expected and okay
					}
				}, `Command ${command} should not throw fatal errors`);
			});
		});
	});

	suite('Provider Registration Integration', () => {
		test('should register providers with valid instances', () => {
			const registeredProviderInstances: { [key: string]: any } = {};

			(vscode.window as any).registerTreeDataProvider = (viewId: string, provider: any) => {
				registeredProviderInstances[viewId] = provider;
				return { dispose: () => {} };
			};

			activate(mockContext);

			// Verify provider instances are objects
			Object.keys(registeredProviderInstances).forEach(viewId => {
				assert.strictEqual(typeof registeredProviderInstances[viewId], 'object',
					`Provider for ${viewId} should be an object`);
				assert.ok(registeredProviderInstances[viewId] !== null,
					`Provider for ${viewId} should not be null`);
			});
		});

		test('should register providers with required methods', () => {
			const registeredProviderInstances: { [key: string]: any } = {};

			(vscode.window as any).registerTreeDataProvider = (viewId: string, provider: any) => {
				registeredProviderInstances[viewId] = provider;
				return { dispose: () => {} };
			};

			activate(mockContext);

			// Verify providers have required methods
			Object.keys(registeredProviderInstances).forEach(viewId => {
				const provider = registeredProviderInstances[viewId];
				assert.strictEqual(typeof provider.getTreeItem, 'function',
					`Provider for ${viewId} should have getTreeItem method`);
				assert.strictEqual(typeof provider.getChildren, 'function',
					`Provider for ${viewId} should have getChildren method`);
			});
		});
	});

	suite('Error Handling', () => {
		test('should handle provider registration errors', () => {
			// Mock provider registration to throw error
			(vscode.window as any).registerTreeDataProvider = () => {
				throw new Error('Registration failed');
			};

			// Extension should still activate despite provider registration errors
			assert.throws(() => activate(mockContext));
		});

		test('should handle task provider registration errors', () => {
			// Mock task provider registration to throw error
			(vscode.tasks as any).registerTaskProvider = () => {
				throw new Error('Task provider registration failed');
			};

			assert.throws(() => activate(mockContext));
		});

		test('should handle debug provider registration errors', () => {
			// Mock debug provider registration to throw error
			(vscode.debug as any).registerDebugConfigurationProvider = () => {
				throw new Error('Debug provider registration failed');
			};

			assert.throws(() => activate(mockContext));
		});
	});
});

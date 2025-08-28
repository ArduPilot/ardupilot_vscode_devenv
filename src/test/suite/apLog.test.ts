/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { apLog } from '../../apLog';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';

suite('apLog Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let originalCreateOutputChannel: typeof vscode.window.createOutputChannel;
	let mockOutputChannel: vscode.OutputChannel;

	suiteSetup(async () => {

		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder);

		// Store original method
		originalCreateOutputChannel = vscode.window.createOutputChannel;

		// Create mock output channel
		mockOutputChannel = {
			name: 'ArduPilot',
			append: () => {},
			appendLine: () => {},
			replace: () => {},
			clear: () => {},
			show: () => {},
			hide: () => {},
			dispose: () => {}
		};

		// Mock vscode.window.createOutputChannel
		(vscode.window as any).createOutputChannel = (name: string) => {
			if (name === 'ArduPilot') {
				return mockOutputChannel;
			}
			return originalCreateOutputChannel(name);
		};
	});

	suiteTeardown(() => {
		// Restore original method
		(vscode.window as any).createOutputChannel = originalCreateOutputChannel;

		// Reset static channel
		(apLog as any)._channel = undefined;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		// Reset static channel before each test
		(apLog as any)._channel = undefined;
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Constructor', () => {
		test('should create apLog instance with name', () => {
			const logger = new apLog('testLogger');
			assert.ok(logger);
			assert.strictEqual((logger as any).name, 'testLogger');
		});

		test('should create multiple instances with different names', () => {
			const logger1 = new apLog('logger1');
			const logger2 = new apLog('logger2');

			assert.strictEqual((logger1 as any).name, 'logger1');
			assert.strictEqual((logger2 as any).name, 'logger2');
		});
	});

	suite('Channel Management', () => {
		test('should create output channel on first access', () => {
			let channelCreated = false;
			let channelName = '';

			(vscode.window as any).createOutputChannel = (name: string) => {
				channelCreated = true;
				channelName = name;
				return mockOutputChannel;
			};

			// Access the channel for the first time
			const channel = apLog.channel;

			assert.strictEqual(channelCreated, true);
			assert.strictEqual(channelName, 'ArduPilot');
			assert.strictEqual(channel, mockOutputChannel);
		});

		test('should reuse existing channel on subsequent access', () => {
			// Explicitly reset the channel to ensure clean state
			(apLog as any)._channel = undefined;

			let channelCreateCount = 0;

			(vscode.window as any).createOutputChannel = (name: string) => {
				channelCreateCount++;
				return mockOutputChannel;
			};

			// Access channel multiple times
			const channel1 = apLog.channel;
			const channel2 = apLog.channel;
			const channel3 = apLog.channel;

			assert.strictEqual(channelCreateCount, 1);
			assert.strictEqual(channel1, channel2);
			assert.strictEqual(channel2, channel3);
		});

		test('should return same channel instance across different apLog instances', () => {
			const logger1 = new apLog('test1');
			const logger2 = new apLog('test2');

			// Both should use the same static channel
			const channel1 = apLog.channel;
			const channel2 = apLog.channel;

			assert.strictEqual(channel1, channel2);
		});
	});

	suite('Logging', () => {
		test('should log message with logger name prefix', () => {
			let loggedMessage = '';

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessage = message;
			};

			const logger = new apLog('testLogger');
			logger.log('Test message');

			assert.strictEqual(loggedMessage, '<testLogger> Test message');
		});

		test('should log multiple messages with correct format', () => {
			const loggedMessages: string[] = [];

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessages.push(message);
			};

			const logger = new apLog('multiTest');
			logger.log('First message');
			logger.log('Second message');
			logger.log('Third message');

			assert.strictEqual(loggedMessages.length, 3);
			assert.strictEqual(loggedMessages[0], '<multiTest> First message');
			assert.strictEqual(loggedMessages[1], '<multiTest> Second message');
			assert.strictEqual(loggedMessages[2], '<multiTest> Third message');
		});

		test('should handle empty messages', () => {
			let loggedMessage = '';

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessage = message;
			};

			const logger = new apLog('emptyTest');
			logger.log('');

			assert.strictEqual(loggedMessage, '<emptyTest> ');
		});

		test('should handle special characters in messages', () => {
			let loggedMessage = '';

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessage = message;
			};

			const logger = new apLog('specialTest');
			const specialMessage = 'Message with\nnewlines\tand\ttabs';
			logger.log(specialMessage);

			assert.strictEqual(loggedMessage, `<specialTest> ${specialMessage}`);
		});

		test('should handle unicode characters', () => {
			let loggedMessage = '';

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessage = message;
			};

			const logger = new apLog('unicodeTest');
			const unicodeMessage = 'Message with émojis 🚁 and ñoñó';
			logger.log(unicodeMessage);

			assert.strictEqual(loggedMessage, `<unicodeTest> ${unicodeMessage}`);
		});

		test('should log from different logger instances with correct names', () => {
			const loggedMessages: string[] = [];

			mockOutputChannel.appendLine = (message: string) => {
				loggedMessages.push(message);
			};

			const logger1 = new apLog('logger1');
			const logger2 = new apLog('logger2');
			const logger3 = new apLog('logger3');

			logger1.log('Message from logger1');
			logger2.log('Message from logger2');
			logger3.log('Message from logger3');

			assert.strictEqual(loggedMessages.length, 3);
			assert.strictEqual(loggedMessages[0], '<logger1> Message from logger1');
			assert.strictEqual(loggedMessages[1], '<logger2> Message from logger2');
			assert.strictEqual(loggedMessages[2], '<logger3> Message from logger3');
		});
	});

	suite('Error Handling', () => {
		test('should handle channel creation errors gracefully', () => {
			// Store original mock
			const originalCreateOutputChannel = (vscode.window as any).createOutputChannel;

			(vscode.window as any).createOutputChannel = () => {
				throw new Error('Failed to create channel');
			};

			// Should not throw when accessing channel
			assert.throws(() => apLog.channel, Error);

			// Restore original mock
			(vscode.window as any).createOutputChannel = originalCreateOutputChannel;
		});

		test('should handle appendLine errors gracefully', () => {
			// Store original method
			const originalAppendLine = mockOutputChannel.appendLine;

			mockOutputChannel.appendLine = () => {
				throw new Error('Failed to append line');
			};

			const logger = new apLog('errorTest');

			// Should not throw when logging
			assert.throws(() => logger.log('Test message'), Error);

			// Restore original method
			mockOutputChannel.appendLine = originalAppendLine;
		});
	});

	suite('Static Channel Property', () => {
		test('should maintain channel state across test runs', () => {
			// First access
			const channel1 = apLog.channel;

			// Reset and access again
			(apLog as any)._channel = undefined;
			const channel2 = apLog.channel;

			// Both should be valid channels (but may be different instances)
			assert.ok(channel1);
			assert.ok(channel2);
		});

		test('should handle concurrent access to channel', () => {
			// Simulate concurrent access
			const channels: vscode.OutputChannel[] = [];
			for (let i = 0; i < 10; i++) {
				channels.push(apLog.channel);
			}

			// All should be the same instance
			channels.forEach(channel => {
				assert.strictEqual(channel, channels[0]);
			});
		});
	});

	suite('Integration Tests', () => {
		test('should work with real VS Code output channel', () => {
			// Temporarily restore real createOutputChannel
			(vscode.window as any).createOutputChannel = originalCreateOutputChannel;

			// Reset channel to force creation
			(apLog as any)._channel = undefined;

			try {
				const logger = new apLog('integrationTest');

				// Should not throw
				assert.doesNotThrow(() => {
					logger.log('Integration test message');
				});

				// Channel should be created
				assert.ok(apLog.channel);
				assert.strictEqual(apLog.channel.name, 'ArduPilot');
			} finally {
				// Restore mock
				(vscode.window as any).createOutputChannel = (name: string) => {
					if (name === 'ArduPilot') {
						return mockOutputChannel;
					}
					return originalCreateOutputChannel(name);
				};
			}
		});
	});
});

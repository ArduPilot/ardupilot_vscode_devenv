/*
 * Test suite for apCommonUtils module
 *
 * Tests the FireAndForget decorator functionality including:
 * - Error catching and logging
 * - Stack trace capture
 * - Popup display configuration
 * - Fire-and-forget behavior (returns void)
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FireAndForget, FireAndForgetOptions } from '../../apCommonUtils';
import { apLog } from '../../apLog';

suite('apCommonUtils Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockLog: sinon.SinonStubbedInstance<apLog>;
	let showErrorMessageStub: sinon.SinonStub;
	let channelShowStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();

		// Mock apLog instance
		mockLog = sandbox.createStubInstance(apLog);

		// Mock vscode.window.showErrorMessage
		showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
		showErrorMessageStub.resolves('View Logs');

		// Mock apLog.channel.show
		channelShowStub = sandbox.stub();
		sandbox.stub(apLog, 'channel').get(() => ({
			show: channelShowStub,
			appendLine: sandbox.stub()
		}));
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('FireAndForget Decorator', () => {
		test('should catch and log async method errors and return void', (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async throwError(): Promise<string> {
					throw new Error('Test error message');
				}
			}

			const instance = new TestClass();

			// The decorated method now returns void
			const result = instance.throwError();
			assert.strictEqual(result, undefined);

			// Give time for the async error handling to complete
			setTimeout(() => {
				assert.ok(mockLog.log.calledOnce);
				const loggedMessage = mockLog.log.getCall(0).args[0];
				assert.ok(loggedMessage.includes('Error in throwError(): Test error message'));
				assert.ok(loggedMessage.includes('Error stack:'));
				assert.ok(loggedMessage.includes('Call site stack:'));
				done();
			}, 10);
		});

		test('should log both error stack and call site stack', (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async throwErrorWithStack(): Promise<void> {
					const error = new Error('Stack trace test');
					error.stack = 'Error: Stack trace test\n    at TestClass.throwErrorWithStack\n    at errorMethod';
					throw error;
				}
			}

			const instance = new TestClass();
			void instance.throwErrorWithStack();

			setTimeout(() => {
				const loggedMessage = mockLog.log.getCall(0).args[0];
				assert.ok(loggedMessage.includes('Error stack: Error: Stack trace test'));
				assert.ok(loggedMessage.includes('at TestClass.throwErrorWithStack'));
				assert.ok(loggedMessage.includes('Call site stack:'));
				// The call site stack should show where instance.throwErrorWithStack() was called
				assert.ok(loggedMessage.includes('at TestClass.throwErrorWithStack') ||
						loggedMessage.includes('at Context.'));
				done();
			}, 10);
		});

		test('should show popup by default', async (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog
			};

			class TestClass {
				@FireAndForget(options)
				async throwError(): Promise<void> {
					throw new Error('Popup test error');
				}
			}

			const instance = new TestClass();
			await instance.throwError();

			setTimeout(() => {
				assert.ok(showErrorMessageStub.calledOnce);
				const [message, button] = showErrorMessageStub.getCall(0).args;
				assert.ok(message.includes('Error: Popup test error'));
				assert.strictEqual(button, 'View Logs');
				done();
			}, 10);
		});

		test('should not show popup when showErrorPopup is false', (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async throwError(): Promise<void> {
					throw new Error('No popup test');
				}
			}

			const instance = new TestClass();
			void instance.throwError();

			setTimeout(() => {
				assert.ok(showErrorMessageStub.notCalled);
				done();
			}, 10);
		});

		test('should show popup when showErrorPopup is explicitly true', (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: true
			};

			class TestClass {
				@FireAndForget(options)
				async throwError(): Promise<void> {
					throw new Error('Explicit popup test');
				}
			}

			const instance = new TestClass();
			void instance.throwError();

			setTimeout(() => {
				assert.ok(showErrorMessageStub.calledOnce);
				done();
			}, 10);
		});

		test('should return void for successful methods', () => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async successMethod(): Promise<string> {
					return 'success result';
				}
			}

			const instance = new TestClass();
			const result = instance.successMethod();

			// Fire-and-forget always returns void, even for successful methods
			assert.strictEqual(result, undefined);
			assert.ok(mockLog.log.notCalled);
			assert.ok(showErrorMessageStub.notCalled);
		});

		test('should handle non-Error objects thrown', (done) => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async throwString(): Promise<void> {
					throw 'String error';
				}
			}

			const instance = new TestClass();
			void instance.throwString();

			setTimeout(() => {
				const loggedMessage = mockLog.log.getCall(0).args[0];
				assert.ok(loggedMessage.includes('Error in throwString(): String error'));
				assert.ok(loggedMessage.includes('Error stack: No error stack available'));
				assert.ok(loggedMessage.includes('Call site stack:'));
				done();
			}, 10);
		});

		test('should handle methods with parameters', () => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog,
				showErrorPopup: false
			};

			class TestClass {
				@FireAndForget(options)
				async methodWithParams(param1: string, param2: number): Promise<string> {
					return `${param1}-${param2}`;
				}
			}

			const instance = new TestClass();
			const result = instance.methodWithParams('hello', 42);

			// Fire-and-forget always returns void
			assert.strictEqual(result, undefined);
		});

		test('should return undefined when descriptor.value is undefined', () => {
			const options: FireAndForgetOptions = {
				apLog: mockLog as unknown as apLog
			};

			const decorator = FireAndForget(options);
			const descriptor: PropertyDescriptor = {};

			const result = decorator({}, 'testMethod', descriptor);
			assert.strictEqual(result, undefined);
		});
	});
});

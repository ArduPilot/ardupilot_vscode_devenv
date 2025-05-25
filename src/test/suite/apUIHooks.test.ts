/*
	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import { UIHooks } from '../../apUIHooks';
import * as taskProvider from '../../taskProvider';

suite('UIHooks Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockPanel: any;
	let mockWebview: any;
	let mockExtensionUri: vscode.Uri;
	let uiHooks: UIHooks;

	setup(() => {
		sandbox = sinon.createSandbox();

		// Mock webview
		mockWebview = {
			onDidReceiveMessage: sandbox.stub(),
			postMessage: sandbox.stub()
		};

		// Mock panel
		mockPanel = {
			webview: mockWebview,
			dispose: sandbox.stub()
		};

		// Mock extension URI
		mockExtensionUri = vscode.Uri.file('/mock/extension/path');

		// Mock workspace
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([
			{ uri: vscode.Uri.file('/mock/workspace') }
		]);
	});

	teardown(() => {
		sandbox.restore();
		if (uiHooks) {
			uiHooks.dispose();
		}
	});

	test('UIHooks constructor should set up message listener', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		assert.strictEqual(uiHooks._panel, mockPanel);
		assert.ok(mockWebview.onDidReceiveMessage.calledOnce);
	});

	test('dispose should clean up panel and disposables', () => {
		const mockDisposable = { dispose: sandbox.stub() };
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		uiHooks._disposables.push(mockDisposable);

		uiHooks.dispose();

		assert.ok(mockPanel.dispose.calledOnce);
		assert.ok(mockDisposable.dispose.calledOnce);
	});

	test('on method should add listeners correctly', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		const listener1 = sandbox.stub();
		const listener2 = sandbox.stub();

		uiHooks.on('testEvent', listener1);
		uiHooks.on('testEvent', listener2);
		uiHooks.on('otherEvent', listener1);

		assert.strictEqual(uiHooks.listeners['testEvent'].length, 2);
		assert.strictEqual(uiHooks.listeners['otherEvent'].length, 1);
		assert.strictEqual(uiHooks.listeners['testEvent'][0], listener1);
		assert.strictEqual(uiHooks.listeners['testEvent'][1], listener2);
	});

	test('_onMessage should call registered listeners', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		const listener1 = sandbox.stub();
		const listener2 = sandbox.stub();
		const testMessage = { command: 'testCommand', data: 'testData' };

		uiHooks.on('testCommand', listener1);
		uiHooks.on('testCommand', listener2);

		// Simulate message reception
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler(testMessage);

		assert.ok(listener1.calledOnceWith(testMessage));
		assert.ok(listener2.calledOnceWith(testMessage));
	});

	test('_onMessage should handle getTasksList command with existing file', () => {
		const mockTasksData = JSON.stringify({ tasks: ['task1', 'task2'] });
		const expectedPath = path.join('/mock/workspace', 'tasklist.json');

		sandbox.stub(fs, 'existsSync').withArgs(expectedPath).returns(true);
		sandbox.stub(fs, 'readFileSync').withArgs(expectedPath, 'utf8').returns(mockTasksData);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate getTasksList message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'getTasksList' });

		assert.ok(mockWebview.postMessage.calledWith({
			command: 'getTasksList',
			tasksList: mockTasksData
		}));
	});

	test('_onMessage should handle getTasksList command with non-existing file', () => {
		const expectedPath = path.join('/mock/workspace', 'tasklist.json');

		sandbox.stub(fs, 'existsSync').withArgs(expectedPath).returns(false);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate getTasksList message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'getTasksList' });

		assert.ok(mockWebview.postMessage.calledWith({
			command: 'getTasksList',
			tasksList: undefined
		}));
	});

	test('_onMessage should handle getTasksList command with no workspace', () => {
		sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate getTasksList message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'getTasksList' });

		assert.ok(mockWebview.postMessage.calledWith({
			command: 'getTasksList',
			tasksList: undefined
		}));
	});

	test('_onMessage should handle getFeaturesList command', () => {
		const mockFeaturesList = { feature1: 'description1', feature2: 'description2' };
		sandbox.stub(taskProvider, 'getFeaturesList').returns(mockFeaturesList);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate getFeaturesList message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'getFeaturesList' });

		assert.ok((taskProvider.getFeaturesList as sinon.SinonStub).calledWith(mockExtensionUri));
		assert.ok(mockWebview.postMessage.calledWith({
			command: 'getFeaturesList',
			featuresList: mockFeaturesList
		}));
	});

	test('getFeaturesList public method should work correctly', () => {
		const mockFeaturesList = { feature1: 'description1', feature2: 'description2' };
		sandbox.stub(taskProvider, 'getFeaturesList').returns(mockFeaturesList);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		uiHooks.getFeaturesList();

		assert.ok((taskProvider.getFeaturesList as sinon.SinonStub).calledWith(mockExtensionUri));
		assert.ok(mockWebview.postMessage.calledWith({
			command: 'getFeaturesList',
			featuresList: mockFeaturesList
		}));
	});

	test('_onMessage should handle error command and log appropriately', () => {
		const logStub = sandbox.stub();
		// Mock the static log method
		sandbox.stub(UIHooks as any, 'log').value(logStub);

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		const errorMessage = {
			command: 'error',
			message: 'Test error message',
			location: 'test.js:10:5',
			stack: 'Error stack trace'
		};

		// Simulate error message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler(errorMessage);

		assert.ok(logStub.calledTwice);
		assert.ok(logStub.firstCall.calledWith('Error from webview: Test error message at test.js:10:5'));
		assert.ok(logStub.secondCall.calledWith('Stack: Error stack trace'));
	});

	test('_onMessage should handle build command (no action)', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate build message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'build' });

		// Build command should not trigger any webview postMessage
		assert.ok(mockWebview.postMessage.notCalled);
	});

	test('_onMessage should handle unknown commands', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate unknown command message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'unknownCommand' });

		assert.ok(mockWebview.postMessage.calledWith({
			command: 'unknownCommand',
			response: 'Bad Request'
		}));
	});

	test('_onMessage should handle missing command property', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Simulate message without command
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ data: 'some data' });

		assert.ok(mockWebview.postMessage.calledWith({
			command: undefined,
			response: 'Bad Request'
		}));
	});

	test('getTasksList should handle file read errors gracefully', () => {
		const expectedPath = path.join('/mock/workspace', 'tasklist.json');

		sandbox.stub(fs, 'existsSync').withArgs(expectedPath).returns(true);
		sandbox.stub(fs, 'readFileSync').withArgs(expectedPath, 'utf8').throws(new Error('File read error'));

		uiHooks = new UIHooks(mockPanel, mockExtensionUri);

		// Should not throw when file read fails
		assert.doesNotThrow(() => {
			const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
			messageHandler({ command: 'getTasksList' });
		});
	});

	test('listeners should be called in order of registration', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		const callOrder: number[] = [];

		const listener1 = () => callOrder.push(1);
		const listener2 = () => callOrder.push(2);
		const listener3 = () => callOrder.push(3);

		uiHooks.on('testEvent', listener1);
		uiHooks.on('testEvent', listener2);
		uiHooks.on('testEvent', listener3);

		// Simulate message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler({ command: 'testEvent' });

		assert.deepStrictEqual(callOrder, [1, 2, 3]);
	});

	test('should handle messages with complex data structures', () => {
		uiHooks = new UIHooks(mockPanel, mockExtensionUri);
		const listener = sandbox.stub();

		const complexMessage = {
			command: 'complexCommand',
			data: {
				nested: {
					array: [1, 2, 3],
					object: { key: 'value' }
				},
				timestamp: Date.now()
			}
		};

		uiHooks.on('complexCommand', listener);

		// Simulate complex message
		const messageHandler = mockWebview.onDidReceiveMessage.getCall(0).args[0];
		messageHandler(complexMessage);

		assert.ok(listener.calledOnceWith(complexMessage));
	});
});

/*
	Licensed under the Apache License, 	test('apWelcomeProvider should implement TreeDataProvider', () => {
		provider = new apWelcomeProvider();

		// Should implement required TreeDataProvider methods
		assert.ok(typeof provider.getTreeItem === 'function');
		assert.ok(typeof provider.getChildren === 'function');
		assert.ok(typeof provider.onDidChangeTreeData === 'function');
	});2.0 (the "License");
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
import { apWelcomeProvider } from '../../apWelcomeProvider';
import { apWelcomeItem } from '../../apWelcomeItem';
import { ValidateEnvironment } from '../../apEnvironmentValidator';
import { CloneArdupilot } from '../../apCloneArdupilot';

suite('apWelcomeProvider Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let provider: apWelcomeProvider;

	setup(() => {
		sandbox = sinon.createSandbox();
		// Mock command registration to avoid conflicts
		sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => {} } as vscode.Disposable);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('apWelcomeProvider should implement TreeDataProvider', () => {
		provider = new apWelcomeProvider();

		// Should implement the required interface methods
		assert.ok(typeof provider.getTreeItem === 'function');
		assert.ok(typeof provider.getChildren === 'function');
		assert.ok(typeof provider.onDidChangeTreeData === 'function');
	});

	test('constructor should initialize correctly', () => {
		provider = new apWelcomeProvider();

		// Should have event emitter for tree data changes
		assert.ok(provider.onDidChangeTreeData);
		assert.ok(typeof provider.onDidChangeTreeData === 'function');
	});

	test('getTreeItem should return the same item', () => {
		provider = new apWelcomeProvider();
		const testItem = new apWelcomeItem('Test Item', vscode.TreeItemCollapsibleState.None);

		const result = provider.getTreeItem(testItem);

		assert.strictEqual(result, testItem);
	});

	test('getTreeItem should handle different item types', () => {
		provider = new apWelcomeProvider();

		// Test with different collapsible states
		const noneItem = new apWelcomeItem('None Item', vscode.TreeItemCollapsibleState.None);
		const collapsedItem = new apWelcomeItem('Collapsed Item', vscode.TreeItemCollapsibleState.Collapsed);
		const expandedItem = new apWelcomeItem('Expanded Item', vscode.TreeItemCollapsibleState.Expanded);

		assert.strictEqual(provider.getTreeItem(noneItem), noneItem);
		assert.strictEqual(provider.getTreeItem(collapsedItem), collapsedItem);
		assert.strictEqual(provider.getTreeItem(expandedItem), expandedItem);
	});

	test('getChildren should return CloneArdupilot and ValidateEnvironment items', async () => {
		provider = new apWelcomeProvider();

		const children = await provider.getChildren();

		assert.strictEqual(children.length, 2);
		assert.ok(children[0] instanceof CloneArdupilot);
		assert.ok(children[1] instanceof ValidateEnvironment);

		// Check labels
		assert.strictEqual(children[0].label, 'Clone Ardupilot');
		assert.strictEqual(children[1].label, 'Validate Environment');

		// Check collapsible states
		assert.strictEqual(children[0].collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.strictEqual(children[1].collapsibleState, vscode.TreeItemCollapsibleState.None);
	});

	test('getChildren should return same structure on multiple calls', async () => {
		provider = new apWelcomeProvider();

		const children1 = await provider.getChildren();
		const children2 = await provider.getChildren();

		assert.strictEqual(children1.length, children2.length);
		assert.strictEqual(children1[0].label, children2[0].label);
		assert.strictEqual(children1[1].label, children2[1].label);

		// Should create new instances each time
		assert.notStrictEqual(children1[0], children2[0]);
		assert.notStrictEqual(children1[1], children2[1]);
	});

	test('refresh should fire onDidChangeTreeData event', () => {
		provider = new apWelcomeProvider();
		const eventSpy = sandbox.spy();

		provider.onDidChangeTreeData(eventSpy);
		provider.refresh();

		assert.ok(eventSpy.calledOnce);

		// Check the event data
		const eventData = eventSpy.getCall(0).args[0];
		assert.ok(eventData instanceof apWelcomeItem);
		assert.strictEqual(eventData.label, 'Welcome');
		assert.strictEqual(eventData.collapsibleState, vscode.TreeItemCollapsibleState.None);
	});

	test('refresh should work multiple times', () => {
		provider = new apWelcomeProvider();
		const eventSpy = sandbox.spy();

		provider.onDidChangeTreeData(eventSpy);

		provider.refresh();
		provider.refresh();
		provider.refresh();

		assert.strictEqual(eventSpy.callCount, 3);

		// Each call should have the same event data structure
		eventSpy.getCalls().forEach(call => {
			const eventData = call.args[0];
			assert.ok(eventData instanceof apWelcomeItem);
			assert.strictEqual(eventData.label, 'Welcome');
		});
	});

	test('multiple event listeners should be notified on refresh', () => {
		provider = new apWelcomeProvider();
		const eventSpy1 = sandbox.spy();
		const eventSpy2 = sandbox.spy();
		const eventSpy3 = sandbox.spy();

		provider.onDidChangeTreeData(eventSpy1);
		provider.onDidChangeTreeData(eventSpy2);
		provider.onDidChangeTreeData(eventSpy3);

		provider.refresh();

		assert.ok(eventSpy1.calledOnce);
		assert.ok(eventSpy2.calledOnce);
		assert.ok(eventSpy3.calledOnce);
	});

	test('should handle event listener disposal', () => {
		provider = new apWelcomeProvider();
		const eventSpy = sandbox.spy();

		const disposable = provider.onDidChangeTreeData(eventSpy);

		provider.refresh();
		assert.ok(eventSpy.calledOnce);

		disposable.dispose();

		provider.refresh();
		// Should still be called once (not twice) after disposal
		assert.ok(eventSpy.calledOnce);
	});

	test('getChildren should return children correctly', async () => {
		provider = new apWelcomeProvider();

		// When called without element (root level)
		const rootChildren = await provider.getChildren();
		assert.strictEqual(rootChildren.length, 2);

		// Verify that the children are of correct types
		assert.ok(rootChildren[0] instanceof CloneArdupilot);
		assert.ok(rootChildren[1] instanceof ValidateEnvironment);
	});

	test('provider should work with VS Code TreeView', () => {
		provider = new apWelcomeProvider();

		// Simulate VS Code TreeView usage
		const mockTreeView = {
			onDidChangeTreeData: provider.onDidChangeTreeData,
			getTreeItem: provider.getTreeItem.bind(provider),
			getChildren: provider.getChildren.bind(provider)
		};

		// Should be able to get tree item
		const testItem = new apWelcomeItem('Test', vscode.TreeItemCollapsibleState.None);
		const treeItem = mockTreeView.getTreeItem(testItem);
		assert.strictEqual(treeItem, testItem);

		// Should be able to get children
		return mockTreeView.getChildren().then(children => {
			assert.strictEqual(children.length, 2);
		});
	});

	test('should handle concurrent getChildren calls', () => {
		provider = new apWelcomeProvider();

		// Make multiple concurrent calls
		const promises = [
			provider.getChildren(),
			provider.getChildren(),
			provider.getChildren()
		];

		return Promise.all(promises).then(results => {
			results.forEach(children => {
				assert.strictEqual(children.length, 2);
				assert.ok(children[0] instanceof CloneArdupilot);
				assert.ok(children[1] instanceof ValidateEnvironment);
			});
		});
	});

	test('CloneArdupilot and ValidateEnvironment should have correct properties', async () => {
		provider = new apWelcomeProvider();

		const children = await provider.getChildren();
		const cloneItem = children[0] as CloneArdupilot;
		const validateItem = children[1] as ValidateEnvironment;

		// Check CloneArdupilot
		assert.strictEqual(cloneItem.label, 'Clone Ardupilot');
		assert.strictEqual(cloneItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.ok(cloneItem instanceof CloneArdupilot);
		assert.ok(cloneItem instanceof apWelcomeItem);

		// Check ValidateEnvironment
		assert.strictEqual(validateItem.label, 'Validate Environment');
		assert.strictEqual(validateItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.ok(validateItem instanceof ValidateEnvironment);
		assert.ok(validateItem instanceof apWelcomeItem);
	});

	test('provider should maintain consistent ordering', async () => {
		provider = new apWelcomeProvider();

		// Get children multiple times and verify order
		for (let i = 0; i < 5; i++) {
			const children = await provider.getChildren();
			assert.strictEqual(children[0].label, 'Clone Ardupilot');
			assert.strictEqual(children[1].label, 'Validate Environment');
			assert.ok(children[0] instanceof CloneArdupilot);
			assert.ok(children[1] instanceof ValidateEnvironment);
		}
	});

	test('event emitter should handle errors gracefully', () => {
		provider = new apWelcomeProvider();

		// Add a listener that throws an error
		provider.onDidChangeTreeData(() => {
			throw new Error('Test error');
		});

		// Add a normal listener
		const normalSpy = sandbox.spy();
		provider.onDidChangeTreeData(normalSpy);

		// Refresh should not fail even if one listener throws
		assert.doesNotThrow(() => {
			provider.refresh();
		});

		// Normal listener should still be called
		assert.ok(normalSpy.calledOnce);
	});
});

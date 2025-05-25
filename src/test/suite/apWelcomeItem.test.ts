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

import * as assert from 'assert';
import * as vscode from 'vscode';
import { apWelcomeItem } from '../../apWelcomeItem';

suite('apWelcomeItem Test Suite', () => {

	test('apWelcomeItem should extend TreeItem', () => {
		const item = new apWelcomeItem('Test Label', vscode.TreeItemCollapsibleState.None);

		assert.ok(item instanceof vscode.TreeItem);
		assert.ok(item instanceof apWelcomeItem);
	});

	test('apWelcomeItem constructor should set label correctly', () => {
		const testLabel = 'Test Welcome Item';
		const item = new apWelcomeItem(testLabel, vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(item.label, testLabel);
	});

	test('apWelcomeItem constructor should set collapsibleState correctly', () => {
		const testLabel = 'Test Item';

		// Test None state
		const noneItem = new apWelcomeItem(testLabel, vscode.TreeItemCollapsibleState.None);
		assert.strictEqual(noneItem.collapsibleState, vscode.TreeItemCollapsibleState.None);

		// Test Collapsed state
		const collapsedItem = new apWelcomeItem(testLabel, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(collapsedItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

		// Test Expanded state
		const expandedItem = new apWelcomeItem(testLabel, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(expandedItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
	});

	test('apWelcomeItem should preserve readonly properties', () => {
		const testLabel = 'Readonly Test';
		const testState = vscode.TreeItemCollapsibleState.Collapsed;
		const item = new apWelcomeItem(testLabel, testState);

		// Properties should be accessible
		assert.strictEqual(item.label, testLabel);
		assert.strictEqual(item.collapsibleState, testState);

		// Properties should be readonly (TypeScript compile-time check)
		// Runtime verification that the properties exist and are correct
		assert.ok(Object.prototype.hasOwnProperty.call(item, 'label'));
		assert.ok(Object.prototype.hasOwnProperty.call(item, 'collapsibleState'));
	});

	test('apWelcomeItem should handle empty label', () => {
		const emptyLabel = '';
		const item = new apWelcomeItem(emptyLabel, vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(item.label, emptyLabel);
	});

	test('apWelcomeItem should handle special characters in label', () => {
		const specialLabel = 'Test @#$%^&*()_+ Item with 123 numbers and symbols!';
		const item = new apWelcomeItem(specialLabel, vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(item.label, specialLabel);
	});

	test('apWelcomeItem should handle very long labels', () => {
		const longLabel = 'A'.repeat(1000); // Very long label
		const item = new apWelcomeItem(longLabel, vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(item.label, longLabel);
		assert.strictEqual(item.label.length, 1000);
	});

	test('apWelcomeItem should handle unicode characters in label', () => {
		const unicodeLabel = '🚁 ArduPilot Welcome Item 测试 🔧';
		const item = new apWelcomeItem(unicodeLabel, vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(item.label, unicodeLabel);
	});

	test('apWelcomeItem should inherit TreeItem properties and methods', () => {
		const item = new apWelcomeItem('Test', vscode.TreeItemCollapsibleState.None);

		// Should have TreeItem properties
		assert.ok('label' in item);
		assert.ok('collapsibleState' in item);

		// Should be able to set other TreeItem properties
		item.tooltip = 'Test tooltip';
		item.description = 'Test description';
		item.contextValue = 'testContext';

		assert.strictEqual(item.tooltip, 'Test tooltip');
		assert.strictEqual(item.description, 'Test description');
		assert.strictEqual(item.contextValue, 'testContext');
	});

	test('apWelcomeItem should support all TreeItemCollapsibleState values', () => {
		const testLabel = 'State Test';

		// Test all possible collapsible states
		const states = [
			vscode.TreeItemCollapsibleState.None,
			vscode.TreeItemCollapsibleState.Collapsed,
			vscode.TreeItemCollapsibleState.Expanded
		];

		states.forEach(state => {
			const item = new apWelcomeItem(testLabel, state);
			assert.strictEqual(item.collapsibleState, state);
		});
	});

	test('multiple apWelcomeItem instances should be independent', () => {
		const item1 = new apWelcomeItem('Item 1', vscode.TreeItemCollapsibleState.None);
		const item2 = new apWelcomeItem('Item 2', vscode.TreeItemCollapsibleState.Collapsed);

		// Items should be independent
		assert.strictEqual(item1.label, 'Item 1');
		assert.strictEqual(item2.label, 'Item 2');
		assert.strictEqual(item1.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.strictEqual(item2.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

		// Modifying one should not affect the other
		item1.tooltip = 'Tooltip 1';
		item2.tooltip = 'Tooltip 2';

		assert.strictEqual(item1.tooltip, 'Tooltip 1');
		assert.strictEqual(item2.tooltip, 'Tooltip 2');
	});

	test('apWelcomeItem should work with TreeView integration', () => {
		// Create items that would work in a tree view context
		const parentItem = new apWelcomeItem('Parent', vscode.TreeItemCollapsibleState.Expanded);
		const childItem = new apWelcomeItem('Child', vscode.TreeItemCollapsibleState.None);

		// Set up typical tree view properties
		parentItem.contextValue = 'welcomeParent';
		childItem.contextValue = 'welcomeChild';

		assert.strictEqual(parentItem.contextValue, 'welcomeParent');
		assert.strictEqual(childItem.contextValue, 'welcomeChild');
		assert.strictEqual(parentItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(childItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
	});
});

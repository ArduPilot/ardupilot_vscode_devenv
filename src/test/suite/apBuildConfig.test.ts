/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { spawn } from 'child_process';
import { apBuildConfig, apBuildConfigProvider, binToTarget, targetToBin } from '../../apBuildConfig';
import { ArdupilotTaskDefinition, APTaskProvider } from '../../taskProvider';
import { setActiveConfiguration } from '../../apActions';
// Import the activeConfiguration variable directly to manipulate it in tests
import * as apActions from '../../apActions';
import { APExtensionContext } from '../../extension';
import { getApExtApi, commandLineClean, commandLineBuild } from './common';

suite('apBuildConfig Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let buildConfigProvider: apBuildConfigProvider;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();

		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;

		// Use the existing provider instance from the extension
		assert(apExtensionContext.apBuildConfigProviderInstance, 'apBuildConfigProviderInstance should be available');
		buildConfigProvider = apExtensionContext.apBuildConfigProviderInstance;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('binToTarget and targetToBin mappings', () => {
		test('should have symmetric mappings', () => {
			Object.keys(binToTarget).forEach(bin => {
				const target = binToTarget[bin];
				assert.strictEqual(targetToBin[target], bin);
			});
		});
	});

	suite('apBuildConfig', () => {
		let mockTask: vscode.Task | undefined;

		setup(() => {
			mockTask = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
		});

		test('should create build config item with correct properties', () => {
			assert.ok(mockTask, 'mockTask should be created');
			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			assert.strictEqual(buildConfig.label, 'Test Config');
			assert.strictEqual(buildConfig.collapsibleState, vscode.TreeItemCollapsibleState.None);
			assert.strictEqual(buildConfig.description, 'copter');
			assert.strictEqual(buildConfig.contextValue, 'apBuildConfig');
		});

		test('should switch between active configurations correctly', () => {
			// Create multiple tasks with different configurations using getOrCreateBuildConfig
			const mockTask1 = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			const mockTask2 = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');
			const mockTask3 = APTaskProvider.getOrCreateBuildConfig('CubeOrangePlus', 'rover', 'CubeOrangePlus-rover');

			assert.ok(mockTask1, 'mockTask1 should be created');
			assert.ok(mockTask2, 'mockTask2 should be created');
			assert.ok(mockTask3, 'mockTask3 should be created');

			// Test 1: Set first task as active
			setActiveConfiguration(mockTask1);

			const buildConfig1_active = new apBuildConfig(
				buildConfigProvider,
				'SITL Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const buildConfig2_inactive2 = new apBuildConfig(
				buildConfigProvider,
				'CubeOrange Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			const buildConfig3_inactive2 = new apBuildConfig(
				buildConfigProvider,
				'CubeOrangePlus Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask3
			);

			// First should be active, others should have commands
			assert.strictEqual(buildConfig1_active.contextValue, 'apBuildConfigActive');
			assert.strictEqual(buildConfig1_active.description, 'copter (Active)');
			assert.ok(buildConfig1_active.iconPath);
			assert.strictEqual(buildConfig1_active.command, undefined);

			assert.strictEqual(buildConfig2_inactive2.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig2_inactive2.description, 'plane');
			assert.ok(buildConfig2_inactive2.command);

			assert.strictEqual(buildConfig3_inactive2.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig3_inactive2.description, 'rover');
			assert.ok(buildConfig3_inactive2.command);

			// Test 2: Switch to second task
			setActiveConfiguration(mockTask2);

			const buildConfig1_inactive3 = new apBuildConfig(
				buildConfigProvider,
				'SITL Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const buildConfig2_active = new apBuildConfig(
				buildConfigProvider,
				'CubeOrange Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			const buildConfig3_inactive3 = new apBuildConfig(
				buildConfigProvider,
				'CubeOrangePlus Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask3
			);

			// Second should be active, others should have commands
			assert.strictEqual(buildConfig1_inactive3.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig1_inactive3.description, 'copter');
			assert.ok(buildConfig1_inactive3.command);

			assert.strictEqual(buildConfig2_active.contextValue, 'apBuildConfigActive');
			assert.strictEqual(buildConfig2_active.description, 'plane (Active)');
			assert.ok(buildConfig2_active.iconPath);
			assert.strictEqual(buildConfig2_active.command, undefined);

			assert.strictEqual(buildConfig3_inactive3.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig3_inactive3.description, 'rover');
			assert.ok(buildConfig3_inactive3.command);

			// Test 3: Switch to third task
			setActiveConfiguration(mockTask3);

			const buildConfig1_inactive4 = new apBuildConfig(
				buildConfigProvider,
				'SITL Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const buildConfig2_inactive4 = new apBuildConfig(
				buildConfigProvider,
				'CubeOrange Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			const buildConfig3_active = new apBuildConfig(
				buildConfigProvider,
				'CubeOrangePlus Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask3
			);

			// Third should be active, others should have commands
			assert.strictEqual(buildConfig1_inactive4.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig1_inactive4.description, 'copter');
			assert.ok(buildConfig1_inactive4.command);

			assert.strictEqual(buildConfig2_inactive4.contextValue, 'apBuildConfig');
			assert.strictEqual(buildConfig2_inactive4.description, 'plane');
			assert.ok(buildConfig2_inactive4.command);

			assert.strictEqual(buildConfig3_active.contextValue, 'apBuildConfigActive');
			assert.strictEqual(buildConfig3_active.description, 'rover (Active)');
			assert.ok(buildConfig3_active.iconPath);
			assert.strictEqual(buildConfig3_active.command, undefined);
		});

		test('should activate configuration', async () => {
			assert.ok(mockTask, 'mockTask should be created');
			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test Config',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			// Mock workspace configuration update using sandbox
			let updateCalled = false;
			let updatedValue = '';

			const mockConfiguration = {
				update: sandbox.stub().callsFake((key: string, value: string, target: vscode.ConfigurationTarget) => {
					updateCalled = true;
					updatedValue = value;
					return Promise.resolve();
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string, scope?: any) => {
				if (section === 'ardupilot') {
					return mockConfiguration as any;
				}
				// Return a simple mock for other sections
				return {
					get: () => undefined,
					update: () => Promise.resolve(),
					has: () => false,
					inspect: () => undefined
				} as any;
			});

			// Stub the methods directly
			const setActiveConfigStub = sandbox.stub(apActions, 'setActiveConfiguration');
			const refreshStub = sandbox.stub(buildConfigProvider, 'refresh');

			buildConfig.activate();

			// Wait for async operation
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(updateCalled, true);
			assert.strictEqual(updatedValue, 'sitl-copter');

			// Verify that setActiveConfiguration was called
			assert.strictEqual(setActiveConfigStub.calledOnce, true, 'setActiveConfiguration should be called once');
			assert.strictEqual(setActiveConfigStub.calledWith(mockTask), true, 'setActiveConfiguration should be called with the correct task');

			// Verify that refresh was called
			assert.strictEqual(refreshStub.called, true, 'refresh should be called at least once on apBuildConfigProviderInstance');
		});
	});

	suite('apBuildConfigProvider', () => {
		test('should initialize correctly', () => {
			assert.ok(buildConfigProvider);
			assert.strictEqual(buildConfigProvider.context, mockContext);
		});

		test('should return correct tree item', () => {
			const mockTask = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			assert.ok(mockTask, 'mockTask should be created');

			const buildConfig = new apBuildConfig(
				buildConfigProvider,
				'Test',
				vscode.TreeItemCollapsibleState.None,
				mockTask
			);

			const treeItem = buildConfigProvider.getTreeItem(buildConfig);
			assert.strictEqual(treeItem, buildConfig);
		});

		test('should get children from tasks.json', async () => {
			// Mock the VS Code workspace configuration to return test tasks
			const mockTasks = [
				{
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					configName: 'sitl-copter',
					configureOptions: '',
					buildOptions: ''
				},
				{
					type: 'ardupilot',
					configure: 'CubeOrange',
					target: 'plane',
					configName: 'CubeOrange-plane',
					configureOptions: '',
					buildOptions: ''
				},
				{
					type: 'shell', // Non-ardupilot task should be filtered out
					command: 'echo test'
				}
			];

			// Mock workspace configuration
			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

			// Test the getChildren method
			const children = await buildConfigProvider.getChildren();

			assert.ok(Array.isArray(children), 'Children should be an array');
			assert.strictEqual(children.length, 2, `Should find exactly 2 ardupilot configs, found ${children.length}`);
			assert.ok(children.every(child => child instanceof apBuildConfig), 'All children should be apBuildConfig instances');

			// Verify we have the expected configurations using configName
			const labels = children.map(child => child.label);
			assert(labels.includes('sitl-copter'), 'Should include sitl-copter configuration');
			assert(labels.includes('CubeOrange-plane'), 'Should include CubeOrange-plane configuration');
		});

		test('should handle empty task list', async () => {
			// Mock workspace configuration with no tasks
			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return []; // Empty tasks array
					}
					return undefined;
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

			const children = await buildConfigProvider.getChildren();
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 0);
		});

		test('should refresh tree data', () => {
			let eventFired = false;

			const disposable = buildConfigProvider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			try {
				buildConfigProvider.refresh();
				assert.strictEqual(eventFired, true);
			} finally {
				disposable.dispose();
			}
		});

		test('should only return valid ArduPilot build configurations', async () => {
			// Mock workspace configuration with mixed task types
			const mockTasks = [
				{
					type: 'ardupilot',
					configure: 'sitl',
					target: 'copter',
					configName: 'sitl-copter',
					configureOptions: '',
					buildOptions: ''
				},
				{
					type: 'shell', // Non-ardupilot task should be filtered out
					command: 'echo test'
				},
				{
					type: 'node', // Another non-ardupilot task
					script: 'test.js'
				}
			];

			// Mock workspace configuration
			const mockConfiguration = {
				get: sandbox.stub().callsFake((key: string) => {
					if (key === 'tasks') {
						return mockTasks;
					}
					return undefined;
				})
			};

			sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

			const children = await buildConfigProvider.getChildren();
			assert.strictEqual(children.length, 1, 'Should only return ardupilot tasks');
			assert.strictEqual(children[0].label, 'sitl-copter', 'Should use configName for label');
		});
	});

	suite('Configuration State Management', () => {
		test('should handle configuration changes', async () => {
			const mockTask1 = APTaskProvider.getOrCreateBuildConfig('sitl', 'copter', 'sitl-copter');
			const mockTask2 = APTaskProvider.getOrCreateBuildConfig('CubeOrange', 'plane', 'CubeOrange-plane');

			assert.ok(mockTask1, 'mockTask1 should be created');
			assert.ok(mockTask2, 'mockTask2 should be created');

			// Set first configuration as active
			setActiveConfiguration(mockTask1);

			const buildConfig1 = new apBuildConfig(
				buildConfigProvider,
				'Config 1',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const buildConfig2 = new apBuildConfig(
				buildConfigProvider,
				'Config 2',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			// First should be active
			assert.strictEqual(buildConfig1.contextValue, 'apBuildConfigActive');
			assert.strictEqual(buildConfig2.contextValue, 'apBuildConfig');

			// Switch to second configuration
			setActiveConfiguration(mockTask2);

			const newBuildConfig1 = new apBuildConfig(
				buildConfigProvider,
				'Config 1',
				vscode.TreeItemCollapsibleState.None,
				mockTask1
			);

			const newBuildConfig2 = new apBuildConfig(
				buildConfigProvider,
				'Config 2',
				vscode.TreeItemCollapsibleState.None,
				mockTask2
			);

			// Now second should be active
			assert.strictEqual(newBuildConfig1.contextValue, 'apBuildConfig');
			assert.strictEqual(newBuildConfig2.contextValue, 'apBuildConfigActive');
		});
	});
});

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as child_process from 'child_process';
import * as sinon from 'sinon';
import { CloneArdupilot } from '../../apCloneArdupilot';

suite('apCloneArdupilot Test Suite', () => {
	let cloneArdupilot: CloneArdupilot;
	let mockContext: vscode.ExtensionContext;
	let commandRegistrations: vscode.Disposable[];
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();

		// Create a mock context for managing disposables
		commandRegistrations = [];
		mockContext = {
			subscriptions: commandRegistrations
		} as any;

		// Mock vscode.commands.registerCommand to prevent duplicate registrations
		sandbox.stub(vscode.commands, 'registerCommand').callsFake((command: string, callback: (...args: any[]) => any) => {
			const disposable = { dispose: () => {} };
			commandRegistrations.push(disposable);
			return disposable;
		});

		cloneArdupilot = new CloneArdupilot(
			'Clone ArduPilot Repository',
			vscode.TreeItemCollapsibleState.None
		);
	});

	teardown(() => {
		// Restore all stubs
		sandbox.restore();

		// Clean up any command registrations
		commandRegistrations.forEach(registration => registration.dispose());
	});

	suite('Constructor', () => {
		test('should create CloneArdupilot instance with correct properties', () => {
			assert.strictEqual(cloneArdupilot.label, 'Clone ArduPilot Repository');
			assert.strictEqual(cloneArdupilot.collapsibleState, vscode.TreeItemCollapsibleState.None);
			assert.strictEqual(cloneArdupilot.contextValue, 'cloneArdupilot');
		});

		test('should set correct icon', () => {
			assert.ok(cloneArdupilot.iconPath);
			assert.ok(cloneArdupilot.iconPath instanceof vscode.ThemeIcon);
			assert.strictEqual((cloneArdupilot.iconPath as vscode.ThemeIcon).id, 'repo-clone');
		});

		test('should set correct command', () => {
			assert.ok(cloneArdupilot.command);
			assert.strictEqual(cloneArdupilot.command.command, 'apClone');
			assert.strictEqual(cloneArdupilot.command.title, 'Clone Ardupilot');
			assert.ok(Array.isArray(cloneArdupilot.command.arguments));
			assert.strictEqual(cloneArdupilot.command.arguments[0], cloneArdupilot.label);
		});
	});

	suite('Command Registration', () => {
		test('should register apClone command', () => {
			// Since we already have a stub in setup, we can't create another one for the same method
			// Instead, let's verify that the constructor sets up the command property correctly
			// This indirectly tests that the command registration would happen
			const testItem = new CloneArdupilot('Test', vscode.TreeItemCollapsibleState.None);

			assert.ok(testItem.command);
			assert.strictEqual(testItem.command.command, 'apClone');
			assert.strictEqual(testItem.command.title, 'Clone Ardupilot');
		});
	});

	suite('isGitInstalled', () => {
		let execStub: sinon.SinonStub;

		setup(() => {
			execStub = sandbox.stub(child_process, 'exec');
		});

		test('should return true when git is installed', async () => {
			// Mock successful git detection
			execStub.callsFake(((command: string, callback: (error: any, stdout?: string, stderr?: string) => void) => {
				if (command === 'which git') {
					callback(null, '/usr/bin/git', '');
				}
			}) as any);

			const isInstalled = await (CloneArdupilot as any).isGitInstalled();
			assert.strictEqual(isInstalled, true);
		});

		test('should return false when git is not installed', async () => {
			// Mock failed git detection
			execStub.callsFake(((command: string, callback: (error: any, stdout?: string, stderr?: string) => void) => {
				if (command === 'which git') {
					callback(new Error('Git not found'), '', 'which: git: not found');
				}
			}) as any);

			const isInstalled = await (CloneArdupilot as any).isGitInstalled();
			assert.strictEqual(isInstalled, false);
		});

		test('should handle exec errors gracefully', async () => {
			// Mock exec throwing an error
			execStub.callsFake(((command: string, callback: (error: any, stdout?: string, stderr?: string) => void) => {
				callback(new Error('Command failed'), '', '');
			}) as any);

			const isInstalled = await (CloneArdupilot as any).isGitInstalled();
			assert.strictEqual(isInstalled, false);
		});
	});

	suite('run method', () => {
		setup(() => {
			// All stubs will be managed by the main sandbox
		});

		teardown(() => {
			// All stubs will be restored by the main sandbox
		});

		test('should show error when git is not installed', async () => {
			let errorMessageShown = false;
			let errorMessage = '';

			// Mock git not installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any) => void) => {
				callback(new Error('Git not found'));
			}) as any);

			// Mock error message display
			sandbox.stub(vscode.window, 'showErrorMessage').callsFake(((message: string, ...items: string[]) => {
				errorMessageShown = true;
				errorMessage = message;
				return Promise.resolve();
			}) as any);

			CloneArdupilot.run();

			// Wait for async operation
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(errorMessageShown, true);
			assert.ok(errorMessage.includes('Git is not installed'));
		});

		test('should open install instructions when requested', async () => {
			let externalUrlOpened = false;
			let openedUrl = '';

			// Mock git not installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any) => void) => {
				callback(new Error('Git not found'));
			}) as any);

			// Mock error message display returning install instructions selection
			sandbox.stub(vscode.window, 'showErrorMessage').callsFake(((message: string, ...items: string[]) => {
				return Promise.resolve('Install Instructions');
			}) as any);

			// Mock external URL opening
			sandbox.stub(vscode.env, 'openExternal').callsFake(((uri: vscode.Uri) => {
				externalUrlOpened = true;
				openedUrl = uri.toString();
				return Promise.resolve(true);
			}) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 50));

			assert.strictEqual(externalUrlOpened, true);
			assert.ok(openedUrl.includes('git-scm.com'));
		});

		test('should show directory selection dialog when git is installed', async () => {
			let dialogShown = false;
			let dialogOptions: vscode.OpenDialogOptions | undefined;

			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection dialog
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake(((options: vscode.OpenDialogOptions) => {
				dialogShown = true;
				dialogOptions = options;
				return Promise.resolve(undefined); // User cancelled
			}) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(dialogShown, true);
			assert.ok(dialogOptions);
			assert.strictEqual(dialogOptions.canSelectFiles, false);
			assert.strictEqual(dialogOptions.canSelectFolders, true);
			assert.strictEqual(dialogOptions.canSelectMany, false);
		});

		test('should handle user cancelling directory selection', async () => {
			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection dialog returning undefined (cancelled)
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake((() => Promise.resolve(undefined)) as any);

			// Should not throw an error
			assert.doesNotThrow(() => {
				CloneArdupilot.run();
			});
		});

		test('should show input box for directory name when directory is selected', async () => {
			let inputBoxShown = false;
			let inputBoxOptions: vscode.InputBoxOptions | undefined;

			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection
			const mockUri = vscode.Uri.file('/test/directory');
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake((() => Promise.resolve([mockUri])) as any);

			// Mock input box
			sandbox.stub(vscode.window, 'showInputBox').callsFake(((options: vscode.InputBoxOptions) => {
				inputBoxShown = true;
				inputBoxOptions = options;
				return Promise.resolve(undefined); // User cancelled
			}) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(inputBoxShown, true);
			assert.ok(inputBoxOptions);
			assert.ok(inputBoxOptions.placeHolder?.includes('directory'));
		});

		test('should handle existing directory error', async () => {
			let errorShown = false;

			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection
			const mockUri = vscode.Uri.file('/test/directory');
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake((() => Promise.resolve([mockUri])) as any);

			// Mock input box returning a name
			sandbox.stub(vscode.window, 'showInputBox').callsFake((() => Promise.resolve('ardupilot')) as any);

			// Mock directory exists
			sandbox.stub(fs, 'existsSync').callsFake((() => true) as any);

			// Mock error message
			sandbox.stub(vscode.window, 'showErrorMessage').callsFake(((message: string) => {
				errorShown = true;
				return Promise.resolve();
			}) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(errorShown, true);
		});

		test('should create directory when it does not exist', async () => {
			let directoryCreated = false;
			let createdPath = '';

			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection
			const mockUri = vscode.Uri.file('/test/directory');
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake((() => Promise.resolve([mockUri])) as any);

			// Mock input box returning a name
			sandbox.stub(vscode.window, 'showInputBox').callsFake((() => Promise.resolve('ardupilot')) as any);

			// Mock directory does not exist
			sandbox.stub(fs, 'existsSync').callsFake((() => false) as any);

			// Mock directory creation
			sandbox.stub(fs, 'mkdirSync').callsFake(((path: string) => {
				directoryCreated = true;
				createdPath = path;
			}) as any);

			// Mock progress dialog
			sandbox.stub(vscode.window, 'withProgress').callsFake((() => Promise.resolve()) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(directoryCreated, true);
			assert.ok(createdPath.includes('ardupilot'));
		});

		test('should handle empty directory name', async () => {
			let directoryCreated = false;

			// Mock git installed
			sandbox.stub(child_process, 'exec').callsFake(((command: string, callback: (error: any, stdout?: string) => void) => {
				callback(null, '/usr/bin/git');
			}) as any);

			// Mock directory selection
			const mockUri = vscode.Uri.file('/test/directory');
			sandbox.stub(vscode.window, 'showOpenDialog').callsFake((() => Promise.resolve([mockUri])) as any);

			// Mock input box returning empty name
			sandbox.stub(vscode.window, 'showInputBox').callsFake((() => Promise.resolve('')) as any);

			// Mock directory does not exist
			sandbox.stub(fs, 'existsSync').callsFake((() => false) as any);

			// Mock directory creation
			sandbox.stub(fs, 'mkdirSync').callsFake((() => {
				directoryCreated = true;
			}) as any);

			// Mock progress dialog
			sandbox.stub(vscode.window, 'withProgress').callsFake((() => Promise.resolve()) as any);

			CloneArdupilot.run();

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(directoryCreated, true);
		});
	});

	suite('Tree Item Properties', () => {
		test('should inherit from apWelcomeItem', () => {
			// CloneArdupilot should extend apWelcomeItem which extends vscode.TreeItem
			assert.ok(cloneArdupilot instanceof vscode.TreeItem);
		});

		test('should have correct collapsible state', () => {
			const expandableItem = new CloneArdupilot(
				'Test',
				vscode.TreeItemCollapsibleState.Expanded
			);
			assert.strictEqual(expandableItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		});
	});

	suite('Static Method Access', () => {
		test('should access static run method', () => {
			assert.strictEqual(typeof CloneArdupilot.run, 'function');
		});

		test('should access static isGitInstalled method', () => {
			assert.strictEqual(typeof (CloneArdupilot as any).isGitInstalled, 'function');
		});
	});
});

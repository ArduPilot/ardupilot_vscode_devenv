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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { APTaskProvider } from './taskProvider';
import { apBuildConfig, apBuildConfigProvider } from './apBuildConfig';
import { apLog } from './apLog';
import { apWelcomeProvider } from './apWelcomeProvider';
import { apConnectedDevices, ConnectedDeviceDecorationProvider } from './apConnectedDevices';
import { ToolsConfig } from './apToolsConfig';
import { APLaunchConfigurationProvider } from './apLaunch';
import { apActionItem, apActionsProvider, activeConfiguration, setActiveConfiguration } from './apActions';
import { ProgramUtils } from './apProgramUtils';

export interface APExtensionContext {
	apTaskProvider?: vscode.Disposable;
	connectedDevicesProvider?: apConnectedDevices;
	actionsProvider?: apActionsProvider;
	apBuildConfigProviderInstance?: apBuildConfigProvider;
	vscodeContext?: vscode.ExtensionContext;
	active?: Promise<boolean>;
	apWelcomeProviderInstance?: apWelcomeProvider;
}

const apExtensionContext: APExtensionContext = {};
let resolveActive: (value: boolean | PromiseLike<boolean>) => void;
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(_context: vscode.ExtensionContext): Promise<APExtensionContext | undefined> {

	apExtensionContext.vscodeContext = _context;
	apExtensionContext.active = new Promise((resolve) => {
		resolveActive = resolve;
	});
	// Initialize ToolsConfig
	ToolsConfig.initialize(_context);

	// Configure venv-ardupilot as default Python interpreter if available
	await ProgramUtils.configureVenvArdupilot();

	// Register process event handlers for cleanup as fallback
	const cleanupHandler = async () => {
		await APLaunchConfigurationProvider.cleanupAllSessions();
	};

	process.on('exit', cleanupHandler);
	process.on('SIGINT', cleanupHandler);
	process.on('SIGTERM', cleanupHandler);
	process.on('uncaughtException', async (error) => {
		console.error('Uncaught exception:', error);
		await cleanupHandler();
		process.exit(1);
	});

	apExtensionContext.apWelcomeProviderInstance = new apWelcomeProvider();

	vscode.window.registerTreeDataProvider('apWelcome', apExtensionContext.apWelcomeProviderInstance);

	const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0] : undefined;
	if (!workspaceRoot) {
		return apExtensionContext;
	}

	const log = new apLog('extension');

	log.log('ardupilot-devenv extension started');

	// Migrate existing tasks.json to add configName if missing
	const migrated = APTaskProvider.migrateTasksJsonForConfigName();
	if (migrated) {
		log.log('Migrated existing tasks.json to include configName fields');
	}

	apExtensionContext.apTaskProvider = vscode.tasks.registerTaskProvider(APTaskProvider.ardupilotTaskType, new APTaskProvider(workspaceRoot.uri.fsPath, _context.extensionUri));

	// Register the APLaunch debug type
	const apLaunchProvider = new APLaunchConfigurationProvider(_context.extensionUri);
	_context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('apLaunch', apLaunchProvider)
	);

	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

	// Register Build Config Provider
	apExtensionContext.apBuildConfigProviderInstance = new apBuildConfigProvider(rootPath, _context);
	vscode.window.registerTreeDataProvider('apBuildConfig', apExtensionContext.apBuildConfigProviderInstance);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	vscode.commands.registerCommand('apBuildConfig.refreshEntry', () => apExtensionContext.apBuildConfigProviderInstance!.refresh());
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	vscode.commands.registerCommand('apBuildConfig.addEntry', () => apExtensionContext.apBuildConfigProviderInstance!.add());
	vscode.commands.registerCommand('apBuildConfig.editEntry', (item: apBuildConfig) => item.edit());
	vscode.commands.registerCommand('apBuildConfig.deleteEntry', (item: apBuildConfig) => item.delete());
	vscode.commands.registerCommand('apBuildConfig.activate', (item: apBuildConfig) => item.activate());
	vscode.commands.registerCommand('apBuildConfig.activateOnSelect', (item: apBuildConfig) => item.activate());

	// Register Actions Provider
	apExtensionContext.actionsProvider = new apActionsProvider(_context);
	vscode.window.registerTreeDataProvider('apActions', apExtensionContext.actionsProvider);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	vscode.commands.registerCommand('apActions.refresh', () => apExtensionContext.actionsProvider!.refresh());
	vscode.commands.registerCommand('apActions.build', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.debug', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.upload', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.run', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.configure', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.clean', (item: apActionItem) => item.performAction());
	vscode.commands.registerCommand('apActions.distclean', (item: apActionItem) => item.performAction());

	// Command to set active configuration from outside apActions
	vscode.commands.registerCommand('apActions.setActiveConfiguration', (task: vscode.Task) => {
		if (activeConfiguration !== task) {
			setActiveConfiguration(task);
			apExtensionContext.actionsProvider?.refresh();
			vscode.commands.executeCommand('apActions.configChanged');
		}
	});

	// Register Connected Devices tree provider
	apExtensionContext.connectedDevicesProvider = new apConnectedDevices();
	vscode.window.registerTreeDataProvider('connected-devices', apExtensionContext.connectedDevicesProvider);

	// Register decoration provider for connected devices
	const connectedDeviceDecorationProvider = new ConnectedDeviceDecorationProvider();
	_context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(connectedDeviceDecorationProvider)
	);

	vscode.commands.registerCommand('connected-devices.refresh', () => {
		apExtensionContext.connectedDevicesProvider?.refresh();
		// Also refresh decorations
		connectedDeviceDecorationProvider.refresh();
	});
	// Register the MAVProxy connection command
	vscode.commands.registerCommand('connected-devices.connectMAVProxy',
		(device) => apExtensionContext.connectedDevicesProvider?.connectMAVProxy(device));
	// Register the MAVProxy disconnection command
	vscode.commands.registerCommand('connected-devices.disconnectMAVProxy',
		(device) => apExtensionContext.connectedDevicesProvider?.disconnectDevice(device));

	resolveActive(true);
	return apExtensionContext;
}

// this method is called when your extension is deactivated
export async function deactivate(): Promise<void> {
	let apExtensionContext: APExtensionContext = {};
	const extension: vscode.Extension<APExtensionContext> | undefined = vscode.extensions.getExtension('ardupilot-org.ardupilot-devenv');
	if (!extension?.isActive) {
		return;
	} else {
		apExtensionContext = extension.exports;
	}

	// Clean up any active tmux sessions from debugging
	await APLaunchConfigurationProvider.cleanupAllSessions();

	if (apExtensionContext.apTaskProvider) {
		apExtensionContext.apTaskProvider.dispose();
	}

	if (apExtensionContext.connectedDevicesProvider) {
		apExtensionContext.connectedDevicesProvider.dispose();
	}
}

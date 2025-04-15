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

let apTaskProvider: vscode.Disposable | undefined;
let connectedDevicesProvider: apConnectedDevices | undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(_context: vscode.ExtensionContext): void {

	// Initialize ToolsConfig
	ToolsConfig.initialize(_context);

	const apWelcomeProviderInstance = new apWelcomeProvider();

	vscode.window.registerTreeDataProvider('apWelcome', apWelcomeProviderInstance);

	const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	if (!workspaceRoot) {
		return;
	}

	const log = new apLog('extension');

	log.log('ardupilot-devenv extension started');
	apTaskProvider = vscode.tasks.registerTaskProvider(APTaskProvider.ardupilotTaskType, new APTaskProvider(workspaceRoot, _context.extensionUri));

	// Register the APLaunch debug type
	const apLaunchProvider = new APLaunchConfigurationProvider();
	_context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('apLaunch', apLaunchProvider)
	);

	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

	const apBuildConfigProviderInstance = new apBuildConfigProvider(rootPath, _context);
	vscode.window.registerTreeDataProvider('apBuildConfig', apBuildConfigProviderInstance);
	vscode.commands.registerCommand('apBuildConfig.refreshEntry', () => apBuildConfigProviderInstance.refresh());
	vscode.commands.registerCommand('apBuildConfig.addEntry', () => apBuildConfigProviderInstance.add());
	vscode.commands.registerCommand('apBuildConfig.editEntry', (item: apBuildConfig) => item.edit());
	vscode.commands.registerCommand('apBuildConfig.deleteEntry', (item: apBuildConfig) => item.delete());
	vscode.commands.registerCommand('apBuildConfig.buildFirmware', (item: apBuildConfig) => item.build());

	// Register Connected Devices tree provider
	connectedDevicesProvider = new apConnectedDevices();
	vscode.window.registerTreeDataProvider('connected-devices', connectedDevicesProvider);

	// Register decoration provider for connected devices
	const connectedDeviceDecorationProvider = new ConnectedDeviceDecorationProvider();
	_context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(connectedDeviceDecorationProvider)
	);

	vscode.commands.registerCommand('connected-devices.refresh', () => {
		connectedDevicesProvider?.refresh();
		// Also refresh decorations
		connectedDeviceDecorationProvider.refresh();
	});
	// Register the MAVProxy connection command
	vscode.commands.registerCommand('connected-devices.connectMAVProxy',
		(device) => connectedDevicesProvider?.connectMAVProxy(device));
	// Register the MAVProxy disconnection command
	vscode.commands.registerCommand('connected-devices.disconnectMAVProxy',
		(device) => connectedDevicesProvider?.disconnectDevice(device));
}

// this method is called when your extension is deactivated
export function deactivate(): void {
	if (apTaskProvider) {
		apTaskProvider.dispose();
	}

	if (connectedDevicesProvider) {
		connectedDevicesProvider.dispose();
	}
}

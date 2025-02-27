/*
   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <http://www.gnu.org/licenses/>.

   Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { APTaskProvider } from './taskProvider';
import { apBuildConfig, apBuildConfigProvider } from './apBuildConfig';
import { apLog } from './apLog';
import { apWelcomeProvider } from './apWelcome';

let apTaskProvider: vscode.Disposable | undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(_context: vscode.ExtensionContext): void {

  const apWelcomeProviderInstance = new apWelcomeProvider();

  vscode.window.registerTreeDataProvider('apWelcome', apWelcomeProviderInstance);

	const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	if (!workspaceRoot) {
		return;
	}

  const log = new apLog('extension');

	log.log("ardupilot-devenv extension started");
	apTaskProvider = vscode.tasks.registerTaskProvider(APTaskProvider.ardupilotTaskType, new APTaskProvider(workspaceRoot, _context.extensionUri));

  const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

  const apBuildConfigProviderInstance = new apBuildConfigProvider(rootPath, _context);
  vscode.window.registerTreeDataProvider('apBuildConfig', apBuildConfigProviderInstance);
  vscode.commands.registerCommand('apBuildConfig.refreshEntry', () => apBuildConfigProviderInstance.refresh());
	vscode.commands.registerCommand('apBuildConfig.addEntry', () => apBuildConfigProviderInstance.add());
  vscode.commands.registerCommand('apBuildConfig.editEntry', (item: apBuildConfig) => item.edit());
  vscode.commands.registerCommand('apBuildConfig.deleteEntry', (item: apBuildConfig) => item.delete());
}

// this method is called when your extension is deactivated

export function deactivate(): void {
	if (apTaskProvider) {
		apTaskProvider.dispose();
	}
}
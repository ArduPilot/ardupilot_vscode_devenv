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
 */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ArdupilotTaskProvider } from './ardupilotTaskProvider';

let ardupilotTaskProvider: vscode.Disposable | undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(_context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}
	console.log("ardupilot-devenv extension started");
	ardupilotTaskProvider = vscode.tasks.registerTaskProvider(ArdupilotTaskProvider.ardupilotTaskType, new ArdupilotTaskProvider(workspaceRoot));
}

// this method is called when your extension is deactivated

export function deactivate(): void {
	if (ardupilotTaskProvider) {
		ardupilotTaskProvider.dispose();
	}
}
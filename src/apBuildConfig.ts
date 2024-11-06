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

import * as vscode from 'vscode';
import { apLog } from './apLog';
import { log } from 'console';
import * as fs from 'fs';
import { apBuildConfigPanel } from './apBuildConfigPanel';

export class apBuildConfig extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
	}
}

export class apBuildConfigProvider implements vscode.TreeDataProvider<apBuildConfig> {
	private _onDidChangeTreeData: vscode.EventEmitter<apBuildConfig | undefined> = new vscode.EventEmitter<apBuildConfig | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apBuildConfig | undefined> = this._onDidChangeTreeData.event;
	static log = new apLog('buildConfig');

	constructor(private workspaceRoot: string | undefined, private _context: vscode.ExtensionContext) {
		apBuildConfigProvider.log.log('apBuildConfigProvider constructor');
	}

	getTreeItem(element: apBuildConfig): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		apBuildConfigProvider.log.log('refresh');
		this._onDidChangeTreeData.fire(undefined);
	}

	// add option
	add(): void {
		apBuildConfigProvider.log.log('addOption');
		apBuildConfigPanel.createOrShow(this._context.extensionUri);
	}

	getChildren(element?: apBuildConfig): Thenable<apBuildConfig[]> {
		apBuildConfigProvider.log.log('getChildren');
		// check folders inside the workspace/build directory
		if (!this.workspaceRoot) {
			return Promise.resolve([]);
		}

		// check if build directory exists in the workspace
		const buildDir = vscode.Uri.file(this.workspaceRoot + '/build');
		if (!buildDir) {
			return Promise.resolve([]);
		}

		// get the list of folders inside the build directory
		// create a list of apBuildConfig objects for each folder containing ap_config.h file
		const buildConfigList: apBuildConfig[] = [];
		fs.readdirSync(buildDir.fsPath).forEach(file => {
			if (fs.lstatSync(buildDir.fsPath + '/' + file).isDirectory() && fs.existsSync(buildDir.fsPath + '/' + file + '/ap_config.h')) {
				buildConfigList.push(new apBuildConfig(file, vscode.TreeItemCollapsibleState.None));
			}
		});
		return Promise.resolve(buildConfigList);
	}
}

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
import * as fs from 'fs';
import { simpleGit, SimpleGitProgressEvent } from 'simple-git';

export class apWelcomeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
	}
}

class cloneArdupilot extends apWelcomeItem {
	static log = new apLog('cloneArdupilot');
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		vscode.commands.registerCommand('apClone', () => cloneArdupilot.run());
	}

	static run(): void {
		// clone the ardupilot repository
		this.log.log('cloneArdupilot called');
		// show open dialog box to select the directory
		const options: vscode.OpenDialogOptions = {
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Select Directory to Clone Ardupilot',
		};
		vscode.window.showOpenDialog(options).then((uri) => {
			if (uri) {
				let finalUri = uri[0];
				// ask the user to name the directory
				vscode.window.showInputBox({
					placeHolder: 'Enter the name of the directory to clone Ardupilot',
					prompt: 'Enter the name of the directory to clone Ardupilot'
				}).then((name) => {
					if (!name) {
						name = '';
					}
					finalUri = vscode.Uri.joinPath(uri[0], name);
					// create the directory if it does not exist
					if (!fs.existsSync(finalUri.fsPath)) {
						fs.mkdirSync(finalUri.fsPath);
					} else {
						// fail if the directory already exists
						vscode.window.showErrorMessage('Directory already exists');
					}

					const abortController = new AbortController();

					let progressReference: vscode.Progress<{ message?: string; increment?: number; }> | null = null;
					let progressFinishPromiseResolve: () => void;
					const progressFinishPromise: Promise<void>  = new Promise<void>((resolve) => {
						progressFinishPromiseResolve = resolve;
					});
					// show progress bar
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Cloning Ardupilot',
						cancellable: true
					}, (prog, token) => {
						token.onCancellationRequested(() => {
							this.log.log('Clone cancelled by user');
							abortController.abort();
						});
						progressReference = prog;
						return progressFinishPromise;
					});
					let lastProgress = 0;
					// clone the repository using simple-git and pass the percent progress to vscode
					const progController = ({method, stage, progress}: SimpleGitProgressEvent) => {
						this.log.log(`git.${method} ${stage} stage ${progress}% complete`);
						if (method === 'clone' && progressReference && progress != lastProgress) {
							progressReference.report({ message: `${stage}`, increment: progress - lastProgress });
							lastProgress = progress;
						}
					};
					const git = simpleGit({ baseDir: finalUri.fsPath, progress: progController , abort: abortController.signal});
					git.clone('https://www.github.com/ardupilot/ardupilot.git', finalUri.fsPath, ['--progress'])
						.then(() => {
						// close the progress bar
							progressFinishPromiseResolve();
							// add the cloned repository to the workspace
							vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri : finalUri });
						}, () => {
							progressFinishPromiseResolve();
							if (!abortController.signal.aborted) {
							// show failed to clone
								vscode.window.showErrorMessage('Failed to clone ardupilot');
							}
						});

					return finalUri;
				});
			}
		});
	}

	// set logo for the tree item
	iconPath = new vscode.ThemeIcon('repo-clone');

	command = {
		command: 'apClone',
		title: 'Clone Ardupilot',
		arguments: [this.label]
	};

	contextValue = 'cloneArdupilot';
}

export class apWelcomeProvider implements vscode.TreeDataProvider<apWelcomeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<apWelcomeItem | undefined> = new vscode.EventEmitter<apWelcomeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apWelcomeItem | undefined> = this._onDidChangeTreeData.event;
	private log = new apLog('apWelcomeProvider');

	constructor() {
		this.log.log('apWelcomeProvider constructor');
	}

	getTreeItem(element: apWelcomeItem): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(new apWelcomeItem('Welcome', vscode.TreeItemCollapsibleState.None));
	}

	getChildren(): Thenable<apWelcomeItem[]> {
		// Removed unused parameter and console.log since they were causing linting warnings
		return Promise.resolve([
			new cloneArdupilot('Clone Ardupilot', vscode.TreeItemCollapsibleState.None)]);
	}
}

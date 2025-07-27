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
/*
	CloneArdupilot.ts
	Clones the Ardupilot repository to a user specified directory.
*/
import * as vscode from 'vscode';
import { apLog } from './apLog';
import { apWelcomeItem } from './apWelcomeItem';
import * as fs from 'fs';
import { simpleGit, SimpleGitProgressEvent } from 'simple-git';
import * as child_process from 'child_process';

export class CloneArdupilot extends apWelcomeItem {
	static log = new apLog('cloneArdupilot');
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		vscode.commands.registerCommand('apClone', () => CloneArdupilot.run());
	}

	// Check if Git is installed
	private static async isGitInstalled(): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			const gitCommand = 'which git';

			child_process.exec(gitCommand, (error) => {
				if (error) {
					this.log.log(`Git not found: ${error.message}`);
					resolve(false);
				} else {
					this.log.log('Git is installed');
					resolve(true);
				}
			});
		});
	}

	static run(): void {
		// clone the ardupilot repository
		this.log.log('CloneArdupilot called');

		// First check if Git is installed
		this.isGitInstalled().then(gitInstalled => {
			if (!gitInstalled) {
				vscode.window.showErrorMessage(
					'Git is not installed. Please install Git before cloning Ardupilot.',
					'Install Instructions'
				).then(selection => {
					if (selection === 'Install Instructions') {
						vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/book/en/v2/Getting-Started-Installing-Git'));
					}
				});
				return;
			}

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
						// Check if the directory already exists and fail if it does
						if (fs.existsSync(finalUri.fsPath)) {
							vscode.window.showErrorMessage('Directory already exists');
							return;
						}
						// Don't create the directory - let git clone create it

						const abortController = new AbortController();

						let progressReference: vscode.Progress<{ message?: string; increment?: number; }> | null = null;
						let progressFinishPromiseResolve: () => void;
						const progressFinishPromise: Promise<void> = new Promise<void>((resolve) => {
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
						const progController = ({ method, stage, progress }: SimpleGitProgressEvent) => {
							this.log.log(`git.${method} ${stage} stage ${progress}% complete`);
							if (method === 'clone' && progressReference && progress != lastProgress) {
								progressReference.report({ message: `${stage}`, increment: progress - lastProgress });
								lastProgress = progress;
							}
						};
						const git = simpleGit({ baseDir: uri[0].fsPath, progress: progController, abort: abortController.signal });
						git.clone('https://www.github.com/ardupilot/ardupilot.git', name || 'ardupilot', ['--progress'])
							.then(async () => {
								this.log.log('Clone completed, initializing submodules...');
								progressReference?.report({ message: 'Initializing submodules...', increment: 0 });

								// Initialize and update submodules
								const repoGit = simpleGit({ baseDir: finalUri.fsPath, abort: abortController.signal });
								try {
									this.log.log('Starting submodule initialization...');
									await repoGit.submoduleInit();
									this.log.log('Submodules initialized');
									progressReference?.report({ message: 'Updating submodules...', increment: 0 });

									this.log.log('Starting submodule update...');
									await repoGit.submoduleUpdate(['--init', '--recursive']);
									this.log.log('Submodules updated');
									progressReference?.report({ message: 'Clone complete', increment: 0 });
								} catch (submoduleError) {
									this.log.log(`Submodule error: ${submoduleError}`);
									// Don't fail the entire clone for submodule issues
									vscode.window.showWarningMessage('Repository cloned successfully, but submodule initialization failed. You may need to run "git submodule update --init --recursive" manually.');
								}

								// close the progress bar
								progressFinishPromiseResolve();
								// add the cloned repository to the workspace
								vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: finalUri });
								vscode.window.showInformationMessage(`Cloned Ardupilot to ${finalUri.fsPath}`);
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

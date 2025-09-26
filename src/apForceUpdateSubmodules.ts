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

import * as vscode from 'vscode';
import { simpleGit, SimpleGitProgressEvent } from 'simple-git';
import { apWelcomeItem } from './apWelcomeItem';

export class ForceUpdateSubmodules extends apWelcomeItem {

	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		this.command = {
			command: 'ardupilot.forceUpdateSubmodules',
			title: 'Force Update Submodules'
		};
		this.iconPath = new vscode.ThemeIcon('sync');
	}

	/**
     * Force update all submodules using the same commands as submodule-sync.sh script
     * Executes: git submodule update --recursive --force --init (3 times)
     * and: git submodule sync --recursive (3 times)
     */
	private async forceUpdateSubmodulesWithGit(gitBaseDir: string, report: (message: string, increment?: number) => void, abortSignal: AbortSignal): Promise<void> {
		// Create a git instance configured for progress and cancellation
		let lastProgress = 0;
		const progressController = ({ method, stage, progress }: SimpleGitProgressEvent) => {
			if (method && typeof progress === 'number' && progress >= 0 && progress <= 100) {
				const delta = progress - lastProgress;
				if (delta !== 0) {
					report(`${stage}`, delta);
					lastProgress = progress;
				}
			} else if (stage) {
				report(`${stage}`);
			}
		};

		const git = simpleGit({ baseDir: gitBaseDir, progress: progressController, abort: abortSignal });

		// Check if we're in a git repository
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			throw new Error('Not in a Git repository. Please open a Git repository in VS Code workspace.');
		}

		// Execute the same commands as submodule-sync.sh script
		// Run 3 times due to poor handling of recursion
		for (let i = 0; i < 3; i++) {
			report(`Updating submodules (pass ${i + 1}/3)...`);
			await git.submoduleUpdate(['--recursive', '--force', '--init']);
			report(`Syncing submodules (pass ${i + 1}/3)...`);
			await git.subModule(['sync', '--recursive']);
		}
	}

	/**
     * Show progress indication for submodule operations
     */
	showProgress(): void {
		const workspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: process.cwd();

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Force Updating Submodules',
			cancellable: true
		}, async (progress, token) => {
			const abortController = new AbortController();
			token.onCancellationRequested(() => {
				abortController.abort();
			});

			const report = (message: string, increment?: number) => {
				if (typeof increment === 'number') {
					progress.report({ message, increment });
				} else {
					progress.report({ message });
				}
			};

			try {
				report('Checking Git repository...');
				await this.forceUpdateSubmodulesWithGit(workspaceRoot, report, abortController.signal);
				report('Submodules updated successfully!', 100);
				vscode.window.showInformationMessage('Submodules force updated successfully!');
			} catch (error) {
				if (abortController.signal.aborted) {
					vscode.window.showWarningMessage('Force update submodules cancelled.');
					return;
				}
				const errorMessage = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to update submodules: ${errorMessage}`);
				throw error;
			}
		});
	}
}

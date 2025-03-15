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
import * as path from 'path';
import * as fs from 'fs';
import { APTaskProvider } from './taskProvider';
import { Uri, Webview } from 'vscode';
import { UIHooks } from './apUIHooks';
/**
 * Manages Build Configuration webview panels
 */
export class apBuildConfigPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: apBuildConfigPanel | undefined;

	public static readonly viewType = 'apBuildConfigPanel';
	private static log = new apLog('apBuildConfigPanel').log;

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private _currentTask: vscode.Task | undefined;
	private _currentFeaturesList: string[] = [];
	private _uiHooks: UIHooks;

	private fileUri = (fp: string): vscode.Uri => {
		const fragments = fp.split('/');

		return vscode.Uri.file(
			path.join(this._extensionUri.path, ...fragments)
		);
	};

	public static createOrShow(extensionUri: vscode.Uri, currentTask?: vscode.Task): void {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// dispose the current panel and create a fresh one
		if (currentTask !== undefined && apBuildConfigPanel.currentPanel) {
			apBuildConfigPanel.currentPanel.dispose();
			apBuildConfigPanel.currentPanel = undefined;
		}

		// If we already have a panel, show it.
		if (apBuildConfigPanel.currentPanel) {
			this.log('Revealing existing panel');
			apBuildConfigPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel and enable js
		const panel = vscode.window.createWebviewPanel(
			apBuildConfigPanel.viewType,
			'Create a new build configuration',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
			}
		);
		this.log('Creating new panel');
		apBuildConfigPanel.currentPanel = new apBuildConfigPanel(panel, extensionUri, currentTask);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, currentTask?: vscode.Task): void {
		apBuildConfigPanel.currentPanel = new apBuildConfigPanel(panel, extensionUri, currentTask);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, currentTask?: vscode.Task) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._currentTask = currentTask;

		// load features.txt from build/<board> directory
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
		} else if (this._currentTask) {
			const featuresPath = path.join(workspaceRoot, 'build', this._currentTask.definition.configure, 'features.txt');
			if (fs.existsSync(featuresPath)) {
				const features = fs.readFileSync(featuresPath, 'utf8').split('\n');
				for (const feature of features) {
					this._currentFeaturesList.push(feature);
				}
			}
			this._currentTask.definition.features = this._currentFeaturesList;
		}

		this._uiHooks = new UIHooks(panel, extensionUri);
		panel.onDidDispose(() => {
			this.dispose();
			this._uiHooks.dispose();
		}, null, this._disposables);

		this._panel.title = 'New Build Configuration';
		this._panel.webview.html = this._getWebviewContent(this._panel.webview);

		// Handle messages from the webview
		this._uiHooks.on('build', (message: Record<string, unknown>) => {
			// create a new build configuration
			apBuildConfigPanel.log('Received message from webview: build');
			console.log(message);
			const currentTaskDef = APTaskProvider.getOrCreateBuildConfig(message.board as string, message.target as string, message.configureOptions as string, message.features as string[]);
			// execute the task
			if (currentTaskDef) {
				vscode.tasks.executeTask(currentTaskDef).then((execution) => {
					vscode.tasks.onDidEndTaskProcess((e) => {
						if (e.execution == execution) {
							apBuildConfigPanel.createOrShow(this._extensionUri, currentTaskDef);
							vscode.commands.executeCommand('apBuildConfig.refreshEntry');
						}
					});
				});
			}
			return;
		});

		this._uiHooks.on('getCurrentTask', () => {
			// send the current task to the webview
			apBuildConfigPanel.log(`Current task: ${this._currentTask?.definition}`);
			this._panel.webview.postMessage({ command: 'getCurrentTask', task: this._currentTask?.definition });
			return;
		});
	}

	private _getWebviewContent(webview: Webview): string {
		// The CSS file from the Svelte build output
		const stylesUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'index.css']);
		// The JS file from the Svelte build output
		const scriptUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'index.js']);
		// get html file from the Svelte build output

		const nonce = getNonce();

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
		  <!DOCTYPE html>
		  <html lang="en">
			<head>
			  <title>Hello World</title>
			  <meta charset="UTF-8" />
			  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
			  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
			  <link href="${stylesUri}" rel="stylesheet">
			  <script nonce="${nonce}" src="${scriptUri}" async></script>
			</head>
			<body>
			<div id="buildConfig"></div>
			</body>
		  </html>
		`;
	}

	public doRefactor(): void {
		// Send a message to the webview webview.
		// You can send any JSON serializable data.
		this._panel.webview.postMessage({ command: 'refactor' });
	}

	public dispose(): void {
		apBuildConfigPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getUri(webview: Webview, extensionUri: Uri, pathList: string[]): Uri {
	return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}

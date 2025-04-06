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

	/**
	 * Looks for existing task configurations for the given board
	 * @param board The board name to search for
	 * @returns The task if found, undefined otherwise
	 */
	private findExistingTaskForBoard(board: string): vscode.Task | undefined {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			return undefined;
		}

		const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			return undefined;
		}

		try {
			const tasksJson = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			const tasks = tasksJson.tasks || [];

			// Find a task with the matching board name
			const matchingTask = tasks.find((task: any) =>
				task.type === 'ardupilot' && task.configure === board
			);

			if (matchingTask) {
				// Convert to a proper vscode.Task
				return APTaskProvider.createTask(matchingTask);
			}
		} catch (error) {
			apBuildConfigPanel.log(`Error looking up task for board ${board}: ${error}`);
		}

		return undefined;
	}

	public static createOrShow(extensionUri: vscode.Uri, currentTask?: vscode.Task): void {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (currentTask !== undefined && apBuildConfigPanel.currentPanel) {
			apBuildConfigPanel.currentPanel.dispose();
			apBuildConfigPanel.currentPanel = undefined;
		}

		// If we already have a panel but the mode has changed (editing vs creating new)
		// dispose the current panel and create a fresh one
		if (apBuildConfigPanel.currentPanel) {
			if ((currentTask && !apBuildConfigPanel.currentPanel._currentTask) ||
					(!currentTask && apBuildConfigPanel.currentPanel._currentTask)) {
				apBuildConfigPanel.currentPanel.dispose();
				apBuildConfigPanel.currentPanel = undefined;
			} else {
				// Mode hasn't changed, just reveal the panel
				this.log('Revealing existing panel');
				apBuildConfigPanel.currentPanel._panel.reveal(column);

				// If we're switching to a different task in edit mode, update the current task
				if (currentTask && apBuildConfigPanel.currentPanel._currentTask !== currentTask) {
					apBuildConfigPanel.currentPanel.updateCurrentTask(currentTask);
				}
				return;
			}
		}

		// Create a new panel
		const panel = vscode.window.createWebviewPanel(
			apBuildConfigPanel.viewType,
			currentTask ? 'Edit Build Configuration' : 'Create a new build configuration',
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
				const features = fs.readFileSync(featuresPath, 'utf8').split('\n')
					.filter(feature => feature.trim()); // Filter out empty lines
				for (const feature of features) {
					this._currentFeaturesList.push(feature);
				}
			}
			// Ensure the task definition has the features array
			if (!this._currentTask.definition.features) {
				this._currentTask.definition.features = [];
			}
			this._currentTask.definition.features = this._currentFeaturesList;
		}

		this._uiHooks = new UIHooks(panel, extensionUri);
		panel.onDidDispose(() => {
			this.dispose();
			this._uiHooks.dispose();
		}, null, this._disposables);

		this._panel.title = currentTask ? 'Edit Build Configuration' : 'New Build Configuration';
		this._panel.webview.html = this._getWebviewContent(this._panel.webview);

		// Handle messages from the webview
		this._uiHooks.on('build', (message: Record<string, unknown>) => {
			// create a new build configuration
			apBuildConfigPanel.log('Received message from webview: build');
			console.log(message);
			// Create a TaskDefinition with all required properties
			const taskDefinition = {
				type: 'ardupilot',
				configure: message.board as string,
				target: message.target as string,
				configureOptions: message.extraConfig as string || '',
				buildOptions: '',
				features: message.features as string[] || [],
				enableFeatureConfig: message.enableFeatureConfig as boolean,
			};
			const currentTaskDef = APTaskProvider.getOrCreateBuildConfig(
				taskDefinition.configure,
				taskDefinition.target,
				taskDefinition.configureOptions,
				taskDefinition.features,
				taskDefinition.enableFeatureConfig,
			);
			if (taskDefinition.configure.toLowerCase().startsWith('sitl')) {
				// add configure options to waf-configure-arg to simVehicleCommand
				message.simVehicleCommand = `--waf-configure-arg="${taskDefinition.configureOptions}" ${message.simVehicleCommand}`;
			}
			// Create matching launch.json entry for apLaunch
			this.createMatchingLaunchConfig(
				taskDefinition.configure,
				taskDefinition.target,
				message.simVehicleCommand as string || ''
			);

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

		// Handle switching to add mode from the UI
		this._uiHooks.on('switchToAddMode', () => {
			apBuildConfigPanel.log('Switching to add mode');
			this.switchToAddMode();
			return;
		});

		// Handle board selection changes
		this._uiHooks.on('boardSelected', (data: Record<string, unknown>) => {
			const board = data.board as string;
			apBuildConfigPanel.log(`Board selected: ${board}`);
			const existingTask = this.findExistingTaskForBoard(board);
			if (existingTask) {
				apBuildConfigPanel.createOrShow(this._extensionUri, existingTask);
			} else {
				this.switchToAddMode();
			}
			return;
		});
	}

	/**
	 * Updates the current task and refreshes the panel
	 * @param task The new task to edit
	 */
	public updateCurrentTask(task: vscode.Task): void {
		this._currentTask = task;
		this._currentFeaturesList = [];

		// Update the panel title to reflect we're in edit mode
		this._panel.title = 'Edit Build Configuration';

		// Load features for the new task
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		let featuresFileExists = false;

		if (workspaceRoot) {
			const featuresPath = path.join(workspaceRoot, 'build', task.definition.configure, 'features.txt');
			featuresFileExists = fs.existsSync(featuresPath);

			if (featuresFileExists) {
				const features = fs.readFileSync(featuresPath, 'utf8').split('\n');
				for (const feature of features) {
					if (feature.trim()) { // Only add non-empty features
						this._currentFeaturesList.push(feature);
					}
				}
			}
			task.definition.features = this._currentFeaturesList;
		}

		// Update the enableFeatureConfig flag based on if features.txt exists
		if (task.definition.enableFeatureConfig === undefined) {
			task.definition.enableFeatureConfig = featuresFileExists;
		}

		// Notify the webview about the updated task
		this._panel.webview.postMessage({
			command: 'getCurrentTask',
			task: this._currentTask.definition,
			featuresFileExists: featuresFileExists
		});

		apBuildConfigPanel.log(`Updated current task to: ${this._currentTask.definition.configure}`);
	}

	/**
	 * Switch to add mode (new configuration)
	 */
	public switchToAddMode(): void {
		this._currentTask = undefined;
		this._currentFeaturesList = [];
		this._panel.title = 'New Build Configuration';

		// Notify the webview that we're now in add mode
		this._panel.webview.postMessage({ command: 'getCurrentTask', task: null });

		apBuildConfigPanel.log('Switched to add mode');
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

	private createMatchingLaunchConfig(configure: string, target: string, simVehicleCommand: string): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			apBuildConfigPanel.log('No workspace folder is open.');
			return;
		}

		const launchPath = path.join(workspaceRoot, '.vscode', 'launch.json');
		let launchJson: any = { configurations: [] };

		if (fs.existsSync(launchPath)) {
			try {
				launchJson = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
			} catch (error) {
				apBuildConfigPanel.log(`Error reading launch.json: ${error}`);
			}
		}

		const newConfig = {
			name: `Launch ${configure} - ${target}`,
			type: 'apLaunch',
			request: 'launch',
			target: target,
			preLaunchTask: `${APTaskProvider.ardupilotTaskType}: ${configure}-${target}`,
			isSITL: configure.toLowerCase().startsWith('sitl'),
			...(simVehicleCommand && { simVehicleCommand })
		};

		// Check if a similar configuration already exists
		const existingConfigIndex = launchJson.configurations.findIndex((config: any) =>
			config.type === 'apLaunch' &&
			config.name === newConfig.name
		);

		// Only add the configuration if it doesn't already exist
		if (existingConfigIndex >= 0) {
			// Update the existing configuration
			launchJson.configurations[existingConfigIndex] = newConfig;
			apBuildConfigPanel.log(`Updated existing launch configuration: ${newConfig.name}`);
			return;
		}

		launchJson.configurations.push(newConfig);

		try {
			fs.writeFileSync(launchPath, JSON.stringify(launchJson, null, 2), 'utf8');
			apBuildConfigPanel.log(`Added new launch configuration: ${newConfig.name}`);
		} catch (error) {
			apBuildConfigPanel.log(`Error writing to launch.json: ${error}`);
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

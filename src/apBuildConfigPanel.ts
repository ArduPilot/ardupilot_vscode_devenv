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
import { apLog } from './apLog';
import { APTaskProvider, ArdupilotTaskDefinition } from './taskProvider';
import { Uri, Webview } from 'vscode';
import { UIHooks } from './apUIHooks';
import { setActiveConfiguration } from './apActions';

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
	private _uiHooks: UIHooks;

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

		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
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

			// Step 1: Create and save configuration first
			try {
				// Create a TaskDefinition with all required properties
				const taskDefinition = {
					type: 'ardupilot',
					configure: message.board as string,
					target: message.target as string,
					configureOptions: message.extraConfig as string || '',
					buildOptions: ''
				};

				const currentTaskDef = APTaskProvider.getOrCreateBuildConfig(
					taskDefinition.configure,
					taskDefinition.target,
					message?.configName as string,
					taskDefinition.configureOptions,
					message?.simVehicleCommand as string || '',
					message?.overrideEnabled as boolean || false,
					message?.customConfigureCommand as string || '',
					message?.customBuildCommand as string || ''
				);

				if (currentTaskDef?.definition.simVehicleCommand) {
					currentTaskDef.definition.simVehicleCommand = message.simVehicleCommand as string || '';
				}

				// Update override fields in the task definition
				if (currentTaskDef?.definition) {
					const def = currentTaskDef.definition as ArdupilotTaskDefinition;
					def.overrideEnabled = message?.overrideEnabled as boolean || false;
					def.customConfigureCommand = message?.customConfigureCommand as string || '';
					def.customBuildCommand = message?.customBuildCommand as string || '';
				}

				if (!currentTaskDef) {
					vscode.window.showErrorMessage('Failed to create build configuration');
					return;
				}

				apBuildConfigPanel.log('Configuration saved successfully');

				// Step 2: Set active configuration and execute build task
				setActiveConfiguration(currentTaskDef);

				vscode.tasks.executeTask(currentTaskDef).then((execution) => {
					vscode.tasks.onDidEndTaskProcess((e) => {
						if (e.execution == execution) {
							apBuildConfigPanel.createOrShow(this._extensionUri, currentTaskDef);
							vscode.commands.executeCommand('apBuildConfig.refreshEntry');
						}
					});
				}, (error) => {
					vscode.window.showErrorMessage(`Failed to execute build task: ${error.message || error}`);
				});

			} catch (error) {
				apBuildConfigPanel.log(`Error in build configuration process: ${error}`);
				vscode.window.showErrorMessage(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
				return;
			}
		});

		this._uiHooks.on('getCurrentTask', () => {
			// send the current task to the webview
			apBuildConfigPanel.log(`Current task: ${this._currentTask?.definition}`);
			const taskDef = this._currentTask?.definition ? {...this._currentTask?.definition} : undefined;
			this._panel.webview.postMessage({ command: 'getCurrentTask', task: taskDef });
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
			// Always stay in add mode for new configurations
			this.switchToAddMode();
			return;
		});

		// Handle request for existing config names
		this._uiHooks.on('getExistingConfigNames', () => {
			const configNames = this.getExistingConfigNames();
			this._panel.webview.postMessage({ command: 'getExistingConfigNames', configNames: configNames });
			return;
		});
	}

	/**
	 * Get all existing configuration names from tasks.json
	 */
	private getExistingConfigNames(): string[] {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			return [];
		}

		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return [];
			}
			const tasksConfig = vscode.workspace.getConfiguration('tasks', workspaceFolders[0].uri);
			const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];

			// Extract all configName values from tasks
			const configNames = tasks
				.filter(task => task.type === 'ardupilot' && task.configName)
				.map(task => task.configName);

			apBuildConfigPanel.log(`Found ${configNames.length} existing config names`);
			return configNames;
		} catch (error) {
			apBuildConfigPanel.log(`Error getting existing config names: ${error}`);
			return [];
		}
	}

	/**
	 * Updates the current task and refreshes the panel
	 * @param task The new task to edit
	 */
	public updateCurrentTask(task: vscode.Task): void {
		this._currentTask = task;

		// Update the panel title to reflect we're in edit mode
		this._panel.title = 'Edit Build Configuration';

		// Notify the webview about the updated task
		this._panel.webview.postMessage({
			command: 'getCurrentTask',
			task: this._currentTask.definition
		});

		apBuildConfigPanel.log(`Updated current task to: ${this._currentTask.definition.configure}`);
	}

	/**
	 * Switch to add mode (new configuration)
	 */
	public switchToAddMode(): void {
		this._currentTask = undefined;
		this._panel.title = 'New Build Configuration';

		// Notify the webview that we're now in add mode
		this._panel.webview.postMessage({ command: 'getCurrentTask', task: null });

		apBuildConfigPanel.log('Switched to add mode');
	}

	private _getWebviewContent(webview: Webview): string {
		// The CSS file from the Svelte build output
		const stylesUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'build-config.css']);
		// The JS file from the Svelte build output
		const scriptUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'build-config.js']);
		// The source map file
		const sourceMapUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'build-config.js.map']);

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<title>Hello World</title>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<meta http-equiv="Content-Security-Policy" content="default-src 'none';
																		style-src ${webview.cspSource};
																		script-src ${webview.cspSource} 'unsafe-eval' 'unsafe-inline';
																		connect-src ${webview.cspSource} vscode-resource: vscode-webview-resource: https:;">
					<link href="${stylesUri}" rel="stylesheet">
					<script>
						// Make source map URL available to our error handler
						window.SOURCE_MAP_URL = "${sourceMapUri}";
					</script>
					<script type="module" src="${scriptUri}"></script>
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

function getUri(webview: Webview, extensionUri: Uri, pathList: string[]): Uri {
	return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}

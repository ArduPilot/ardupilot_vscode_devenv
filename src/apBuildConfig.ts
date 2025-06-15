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
import * as fs from 'fs';
import { apBuildConfigPanel } from './apBuildConfigPanel';
import { APTaskProvider, ArdupilotTaskDefinition } from './taskProvider';
import { activeConfiguration } from './apActions';

export const binToTarget : { [target: string]: string} = {
	'bin/arducopter': 'copter',
	'bin/arducopter-heli': 'heli',
	'bin/antennatracker': 'antennatracker',
	'bin/arduplane': 'plane',
	'bin/ardurover': 'rover',
	'bin/ardusub': 'sub',
	'bin/blimp': 'blimp',
	'bin/AP_Periph': 'AP_Periph',
};

export const targetToBin : { [target: string]: string} = {};
Object.keys(binToTarget).forEach(key => {
	targetToBin[binToTarget[key]] = key;
});

export class apBuildConfig extends vscode.TreeItem {
	private static log = new apLog('apBuildConfig').log;

	constructor(
		private _buildProvider: apBuildConfigProvider,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly task?: vscode.Task,
	) {
		super(label, collapsibleState);
		if (this.task && this.task.definition) {
			const taskDef = this.task.definition as ArdupilotTaskDefinition;

			// Set the description to include the target name
			this.description = taskDef.target;

			// Check if this is the active configuration using configName
			if (activeConfiguration && taskDef.configName === activeConfiguration.definition.configName) {
				// Highlight active configuration with blue check circle
				this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('terminal.ansiBlue'));
				this.description = `${taskDef.target} (Active)`;
				this.contextValue = 'apBuildConfigActive';
			} else {
				this.contextValue = 'apBuildConfig';

				// Add command to activate configuration when clicked
				this.command = {
					title: 'Set as Active Configuration',
					command: 'apBuildConfig.activateOnSelect',
					arguments: [this]
				};
			}
		}
	}

	edit(): void {
		apBuildConfig.log(`edit ${this.label}`);
		if (this.task) {
			apBuildConfigPanel.createOrShow(this._buildProvider.context.extensionUri, this.task);
		}
	}

	// Set this configuration as the active configuration
	activate(): void {
		apBuildConfig.log(`Activating ${this.label} as current configuration`);
		if (!this.task || !this.task.definition) {
			return;
		}

		const taskDef = this.task.definition as ArdupilotTaskDefinition;

		// Save the selection to workspace settings using configName
		vscode.workspace.getConfiguration('ardupilot').update(
			'activeConfiguration',
			taskDef.configName,
			vscode.ConfigurationTarget.Workspace
		).then(() => {
			// Set as active configuration (this will trigger a refresh through the watcher)
			vscode.commands.executeCommand('apActions.setActiveConfiguration', this.task);
			vscode.window.showInformationMessage(`Activated ${taskDef.configName} configuration`);
		});

		// Refresh the tree view to update UI
		vscode.commands.executeCommand('apBuildConfig.refreshEntry');
	}

	delete(): void {
		// delete the folder
		apBuildConfig.log(`delete ${this.label}`);
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		try {
			fs.rmSync(workspaceRoot + '/build/' + this.label, { recursive: true });
			// also remove c4che/{board}_cache.py
			fs.unlinkSync(workspaceRoot + '/build/c4che/' + this.label + '_cache.py');
		} catch (err) {
			apBuildConfig.log(`Error deleting build folder: ${err}`);
		}
		vscode.commands.executeCommand('apBuildConfig.refreshEntry');
		// also delete the task from tasks.json using configName
		if (this.task && this.task.definition) {
			const taskDef = this.task.definition as ArdupilotTaskDefinition;
			APTaskProvider.delete(taskDef.configName);
		}
	}
}

export class apBuildConfigProvider implements vscode.TreeDataProvider<apBuildConfig> {
	private _onDidChangeTreeData: vscode.EventEmitter<apBuildConfig | undefined> = new vscode.EventEmitter<apBuildConfig | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apBuildConfig | undefined> = this._onDidChangeTreeData.event;
	static log = new apLog('buildConfig').log;

	constructor(private workspaceRoot: string | undefined, public context: vscode.ExtensionContext) {
		apBuildConfigProvider.log('apBuildConfigProvider constructor');

		// Watch for changes to the active configuration
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ardupilot.activeConfiguration')) {
				this.refresh();
			}
		});

		// Refresh when apActions updates the active configuration
		context.subscriptions.push(
			vscode.commands.registerCommand('apActions.configChanged', () => {
				this.refresh();
			})
		);
	}

	getTreeItem(element: apBuildConfig): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		apBuildConfigProvider.log('refresh');
		this._onDidChangeTreeData.fire(undefined);
	}

	// add option
	add(): void {
		apBuildConfigProvider.log('addOption');
		apBuildConfigPanel.createOrShow(this.context.extensionUri);
	}

	getChildren(): Thenable<apBuildConfig[]> {
		apBuildConfigProvider.log('getChildren');
		if (!this.workspaceRoot) {
			return Promise.resolve([]);
		}

		// Get all configurations from tasks.json instead of scanning build folders
		const taskConfiguration = vscode.workspace.workspaceFolders
			? vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri)
			: vscode.workspace.getConfiguration('tasks');
		const tasks = taskConfiguration.get('tasks') as Array<ArdupilotTaskDefinition> || [];

		const buildConfigList: apBuildConfig[] = [];

		// Filter and process only ardupilot tasks
		const ardupilotTasks = tasks.filter(task => task.type === 'ardupilot');

		for (const taskDef of ardupilotTasks) {
			try {
				// Create a VS Code task from the task definition
				const task = APTaskProvider.createTask(taskDef);
				if (task) {
					// Use configName for display
					const displayName = taskDef.configName;
					buildConfigList.push(new apBuildConfig(this, displayName, vscode.TreeItemCollapsibleState.None, task));
					apBuildConfigProvider.log(`Added config: ${displayName}`);
				}
			} catch (err) {
				apBuildConfigProvider.log(`Error processing task ${taskDef.configName}: ${err}`);
			}
		}

		apBuildConfigProvider.log(`Found ${buildConfigList.length} configurations in tasks.json`);
		return Promise.resolve(buildConfigList);
	}
}

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
import * as path from 'path';
import { apBuildConfigPanel } from './apBuildConfigPanel';
import { APTaskProvider, ArdupilotTaskDefinition } from './taskProvider';

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
	}

	edit(): void {
		apBuildConfig.log(`edit ${this.label}`);
		if (this.task) {
			apBuildConfigPanel.createOrShow(this._buildProvider.context.extensionUri, this.task);
		}
	}

	build(): void {
		apBuildConfig.log(`build firmware for ${this.label}`);
		if (!this.task) {
			return;
		}
		// Execute the build task
		vscode.tasks.executeTask(this.task).then(taskExecution => {
			if (!taskExecution) {
				return;
			}

			// Create a task execution finished listener
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution === taskExecution) {
					disposable.dispose();  // Clean up the listener

					if (e.exitCode === 0) {
						vscode.window.showInformationMessage(`Build successful for ${this.label}`);
					} else {
						vscode.window.showErrorMessage(`Build failed for ${this.label}`);
					}
				}
			});
		});
	}

	delete(): void {
		// delete the folder
		apBuildConfig.log(`delete ${this.label}`);
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		fs.rmdirSync(workspaceRoot + '/build/' + this.label, { recursive: true });
		// also remove c4che/{board}_cache.py
		fs.unlinkSync(workspaceRoot + '/build/c4che/' + this.label + '_cache.py');
		vscode.commands.executeCommand('apBuildConfig.refreshEntry');
		// also delete the task from tasks.json
		APTaskProvider.delete(this.label);
	}
}

export class apBuildConfigProvider implements vscode.TreeDataProvider<apBuildConfig> {
	private _onDidChangeTreeData: vscode.EventEmitter<apBuildConfig | undefined> = new vscode.EventEmitter<apBuildConfig | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apBuildConfig | undefined> = this._onDidChangeTreeData.event;
	static log = new apLog('buildConfig').log;

	constructor(private workspaceRoot: string | undefined, public context: vscode.ExtensionContext) {
		apBuildConfigProvider.log('apBuildConfigProvider constructor');
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
		let buildConfigList: apBuildConfig[] = [];
		fs.readdirSync(buildDir.fsPath).forEach(file => {
			if (fs.lstatSync(buildDir.fsPath + '/' + file).isDirectory() && fs.existsSync(buildDir.fsPath + '/' + file + '/ap_config.h')) {
				// get current task from target_list in the folder
				try {
					const data = fs.readFileSync(buildDir.fsPath + '/' + file + '/target_list', 'utf8');
					// split the data by comma
					const targetList:string[] = data.split(',');
					let target: string;
					if (binToTarget[targetList[0]] !== undefined) {
						target = binToTarget[targetList[0]];
					} else {
						target = targetList[0].split('/')[1];
					}

					// Load features if features.txt exists
					let features: string[] = [];
					const featuresPath = path.join(buildDir.fsPath, file, 'features.txt');
					if (fs.existsSync(featuresPath)) {
						features = fs.readFileSync(featuresPath, 'utf8')
							.split('\n')
							.filter(feature => feature.trim());
					}
					// Get configure options from existing task configuration
					let configureOptions: string = '';
					const taskConfiguration = vscode.workspace.workspaceFolders
						? vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri)
						: vscode.workspace.getConfiguration('tasks');
					const tasks = taskConfiguration.get('tasks') as Array<ArdupilotTaskDefinition> || [];
					if (tasks) {
						const existingTask = tasks.find(t =>
							t.configure === file &&
							t.target === target &&
							t.type === 'ardupilot'
						);
						if (existingTask && existingTask.configureOptions) {
							// Extract configure options from args array
							configureOptions = existingTask.configureOptions;
						}
					}
					const task = APTaskProvider.getOrCreateBuildConfig(file, target, configureOptions, features);
					apBuildConfigProvider.log(`getOrCreateBuildConfig ${file} ${target} with ${features.length} features`);
					buildConfigList = [new apBuildConfig(this, file, vscode.TreeItemCollapsibleState.None, task), ...buildConfigList];
				} catch (err) {
					apBuildConfigProvider.log(`Error reading target_list file ${err}`);
				}
			}
		});
		console.log(buildConfigList);
		return Promise.resolve(buildConfigList);
	}
}

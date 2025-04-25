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

// Interface for launch configuration
interface LaunchConfiguration {
	name: string;
	type: string;
	request: string;
	target: string;
	preLaunchTask: string;
	isSITL: boolean;
	simVehicleCommand?: string;
	debug?: boolean;
}

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
			this.createMatchingLaunchConfig(
				taskDef.configure,
				taskDef.target,
				taskDef.simVehicleCommand || ''
			);
		}
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

						// After successful build, create matching launch configuration
						if (this.task && this.task.definition) {
							const taskDef = this.task.definition as ArdupilotTaskDefinition;
							this.createMatchingLaunchConfig(
								taskDef.configure,
								taskDef.target,
								taskDef.simVehicleCommand || ''
							);
						}
					} else {
						vscode.window.showErrorMessage(`Build failed for ${this.label}`);
					}
				}
			});
		});
	}

	private createMatchingLaunchConfig(configure: string, target: string, simVehicleCommand: string): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			apBuildConfig.log('No workspace folder is open.');
			return;
		}

		const launchPath = path.join(workspaceRoot, '.vscode', 'launch.json');
		let launchJson: any = { configurations: [] };

		if (fs.existsSync(launchPath)) {
			try {
				launchJson = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
			} catch (error) {
				apBuildConfig.log(`Error reading launch.json: ${error}`);
			}
		}

		// Check if launch.json has a version property
		if (!launchJson.version) {
			launchJson.version = '0.2.0';
		}

		// Check if launch.json has a configurations array
		if (!launchJson.configurations) {
			launchJson.configurations = [];
		}

		const isSITL = configure.toLowerCase().startsWith('sitl');
		const launchConfigName = 'Launch Ardupilot';

		// Create standard launch configuration
		const newConfig: LaunchConfiguration = {
			name: launchConfigName,
			type: 'apLaunch',
			request: 'launch',
			target: target,
			preLaunchTask: `${APTaskProvider.ardupilotTaskType}: ${configure}-${target}`,
			isSITL: isSITL,
			...(simVehicleCommand && { simVehicleCommand })
		};

		if (isSITL) {
			newConfig.debug = true;
		}

		// Check if a similar configuration already exists
		const existingConfigIndex = launchJson.configurations.findIndex((config: LaunchConfiguration) =>
			config.type === 'apLaunch' &&
			config.name === launchConfigName
		);

		// Only add the configuration if it doesn't already exist
		if (existingConfigIndex >= 0) {
			// Update the existing configuration
			launchJson.configurations[existingConfigIndex] = newConfig;
		} else {
			launchJson.configurations.push(newConfig);
		}

		// Also update the task configuration with the simVehicleCommand
		if (isSITL && simVehicleCommand) {
			this.updateTaskWithSimVehicleCommand(configure, target, simVehicleCommand);
		}

		// Create .vscode directory if it doesn't exist
		const vscodeDir = path.dirname(launchPath);
		if (!fs.existsSync(vscodeDir)) {
			fs.mkdirSync(vscodeDir, { recursive: true });
		}

		try {
			fs.writeFileSync(launchPath, JSON.stringify(launchJson, null, 2), 'utf8');
			apBuildConfig.log(`Updated launch configurations for ${configure}-${target}`);
		} catch (error) {
			apBuildConfig.log(`Error writing to launch.json: ${error}`);
		}
	}

	/**
	 * Updates the task configuration with the simVehicleCommand
	 * @param configure The board name
	 * @param target The build target
	 * @param simVehicleCommand The simVehicleCommand to save
	 */
	private updateTaskWithSimVehicleCommand(configure: string, target: string, simVehicleCommand: string): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			apBuildConfig.log('No workspace folder is open.');
			return;
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));

		// Get current tasks array
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];
		if (!tasks || !Array.isArray(tasks)) {
			apBuildConfig.log('No tasks found in tasks.json');
			return;
		}

		// Find the task with the matching board name and target
		const taskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) =>
			task.configure === configure &&
			task.target === target &&
			task.type === 'ardupilot'
		);

		if (taskIndex >= 0) {
			// Update the task with the simVehicleCommand
			tasks[taskIndex].simVehicleCommand = simVehicleCommand;

			// Update the tasks configuration
			tasksConfig.update('tasks', tasks, vscode.ConfigurationTarget.Workspace).then(() => {
				apBuildConfig.log(`Updated simVehicleCommand for ${configure}-${target} in tasks.json`);
			}, (error) => {
				apBuildConfig.log(`Error updating tasks.json: ${error}`);
			});
		} else {
			apBuildConfig.log(`No task found for ${configure}-${target}`);
		}
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

					// Get configure options and simVehicleCommand from existing task configuration
					let configureOptions: string = '';
					let simVehicleCommand: string = '';
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
						if (existingTask) {
							// Extract configure options and simVehicleCommand from existing task
							if (existingTask.configureOptions) {
								configureOptions = existingTask.configureOptions;
							}
							if (existingTask.simVehicleCommand) {
								simVehicleCommand = existingTask.simVehicleCommand;
							}
						}
					}

					const task = APTaskProvider.getOrCreateBuildConfig(
						file,
						target,
						configureOptions,
						features,
						undefined,
						simVehicleCommand
					);

					apBuildConfigProvider.log(`getOrCreateBuildConfig ${file} ${target} with ${features.length} features` +
						(simVehicleCommand ? ` and simVehicleCommand: ${simVehicleCommand}` : ''));

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

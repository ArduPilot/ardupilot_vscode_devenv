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
import * as path from 'path';
import * as fs from 'fs';
import { apLog } from './apLog';
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
}

// Store the currently active build configuration
export let activeConfiguration: vscode.Task | undefined;
export let activeLaunchConfig: LaunchConfiguration | null;

// Function to update the active configuration
export function setActiveConfiguration(task: vscode.Task): void {
	activeConfiguration = task;
	// After successful build, create matching launch configuration
	if (activeConfiguration && activeConfiguration.definition) {
		const taskDef = activeConfiguration.definition as ArdupilotTaskDefinition;
		activeLaunchConfig = apActionItem.createMatchingLaunchConfig(
			taskDef.configName,
			taskDef.configure,
			taskDef.target,
			taskDef.simVehicleCommand || ''
		);
	}
}

// TreeItem representing an action
export class apActionItem extends vscode.TreeItem {
	private static log = new apLog('apActionItem').log;

	constructor(
		private _actionsProvider: apActionsProvider,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly action: string,
		public readonly tooltip?: string,
		public readonly configuration?: vscode.Task
	) {
		super(label, collapsibleState);

		// Set icon based on the action
		switch(action) {
		case 'build':
			this.iconPath = new vscode.ThemeIcon('tools');
			break;
		case 'debug':
			this.iconPath = new vscode.ThemeIcon('bug');
			break;
		case 'upload':
			this.iconPath = new vscode.ThemeIcon('cloud-upload');
			break;
		case 'run':
			this.iconPath = new vscode.ThemeIcon('run');
			break;
		case 'configure':
			this.iconPath = new vscode.ThemeIcon('gear');
			break;
		default:
			this.iconPath = new vscode.ThemeIcon('symbol-event');
		}

		this.tooltip = tooltip || label;

		// Set up the command to execute when clicked
		this.command = {
			title: label,
			command: `apActions.${action}`,
			arguments: [this]
		};

		// Mark items as action items for context menus
		this.contextValue = `apAction_${action}`;
	}

	performAction(): void {
		apActionItem.log(`Performing action: ${this.action} for ${this.label}`);
		switch(this.action) {
		case 'build':
			this.buildFirmware();
			break;
		case 'debug':
			this.debugFirmware();
			break;
		case 'upload':
			this.uploadFirmware();
			break;
		case 'run':
			this.runFirmware();
			break;
		case 'configure':
			this.configure();
			break;
		}
	}

	private buildFirmware(): void {
		apActionItem.log(`build firmware for ${this.label}`);
		if (!activeConfiguration) {
			return;
		}
		// Execute the build task
		vscode.tasks.executeTask(activeConfiguration).then(taskExecution => {
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

	static createMatchingLaunchConfig(configName: string, configure: string, target: string, simVehicleCommand: string): LaunchConfiguration | null {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			apActionItem.log('No workspace folder is open.');
			return null;
		}

		const launchPath = path.join(workspaceRoot, '.vscode', 'launch.json');

		// Define a type for the launch configuration object
		interface LaunchConfigFile {
			version?: string;
			configurations: LaunchConfiguration[];
		}

		let launchJson: LaunchConfigFile = { configurations: [] };

		if (fs.existsSync(launchPath)) {
			try {
				launchJson = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
			} catch (error) {
				apActionItem.log(`Error reading launch.json: ${error}`);
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
			preLaunchTask: `${APTaskProvider.ardupilotTaskType}: ${configName}`,
			isSITL: isSITL,
			...(simVehicleCommand && { simVehicleCommand })
		};

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
			this.updateTaskWithSimVehicleCommand(configName, simVehicleCommand);
		}

		// Create .vscode directory if it doesn't exist
		const vscodeDir = path.dirname(launchPath);
		if (!fs.existsSync(vscodeDir)) {
			fs.mkdirSync(vscodeDir, { recursive: true });
		}

		try {
			fs.writeFileSync(launchPath, JSON.stringify(launchJson, null, 2), 'utf8');
			apActionItem.log(`Updated launch configurations for ${configName}`);
		} catch (error) {
			apActionItem.log(`Error writing to launch.json: ${error}`);
		}
		return newConfig;
	}

	/**
		 * Updates the task configuration with the simVehicleCommand
		 * @param configName The configuration name
		 * @param simVehicleCommand The simVehicleCommand to save
		 */
	static updateTaskWithSimVehicleCommand(configName: string, simVehicleCommand: string): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			apActionItem.log('No workspace folder is open.');
			return;
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));

		// Get current tasks array
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];
		if (!tasks || !Array.isArray(tasks)) {
			apActionItem.log('No tasks found in tasks.json');
			return;
		}

		// Find the task with the matching configName
		const taskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) =>
			task.configName === configName &&
				task.type === 'ardupilot'
		);

		if (taskIndex >= 0) {
			// Update the task with the simVehicleCommand
			tasks[taskIndex].simVehicleCommand = simVehicleCommand;

			// Update the tasks configuration
			tasksConfig.update('tasks', tasks, vscode.ConfigurationTarget.Workspace).then(() => {
				apActionItem.log(`Updated simVehicleCommand for ${configName} in tasks.json`);
			}, (error) => {
				apActionItem.log(`Error updating tasks.json: ${error}`);
			});
		} else {
			apActionItem.log(`No task found for ${configName}`);
		}
	}

	private debugFirmware(): void {
		if (!activeConfiguration) {
			vscode.window.showErrorMessage('No active configuration selected');
			return;
		}
		// Launch active launch configuration
		if (activeLaunchConfig) {
			vscode.debug.startDebugging(undefined, activeLaunchConfig);
		}
	}

	private uploadFirmware(): void {
		if (!activeConfiguration) {
			vscode.window.showErrorMessage('No active configuration selected');
			return;
		}
		if (activeLaunchConfig) {
			vscode.debug.startDebugging(undefined, activeLaunchConfig);
		}
	}

	private runFirmware(): void {
		if (!activeConfiguration) {
			vscode.window.showErrorMessage('No active configuration selected');
			return;
		}

		const config = activeConfiguration.definition as ArdupilotTaskDefinition;
		const isSITL = config.configure.toLowerCase().startsWith('sitl');

		if (!isSITL) {
			vscode.window.showInformationMessage('Run is only applicable for SITL configurations');
			return;
		}

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		// For SITL, run the simulation
		const vehicleType = config.target.replace('sitl-', '');
		const simVehiclePath = path.join(workspaceRoot, 'Tools', 'autotest', 'sim_vehicle.py');

		if (!fs.existsSync(simVehiclePath)) {
			vscode.window.showErrorMessage('sim_vehicle.py not found. Please ensure ArduPilot is properly cloned.');
			return;
		}

		// Run the SITL simulation using sim_vehicle.py
		const terminal = vscode.window.createTerminal('ArduPilot SITL');
		terminal.sendText(`cd ${workspaceRoot}`);
		const simVehicleCommand = `python3 ${simVehiclePath} --no-rebuild -v ${vehicleType} ${config.simVehicleCommand || ''}`;
		terminal.sendText(simVehicleCommand);
		terminal.show();
	}

	private configure(): void {
		// Show quick pick to select a configuration
		this._actionsProvider.showConfigurationSelector();
	}
}

// Provider for the apActions tree view
export class apActionsProvider implements vscode.TreeDataProvider<apActionItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<apActionItem | undefined> = new vscode.EventEmitter<apActionItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apActionItem | undefined> = this._onDidChangeTreeData.event;
	private log = new apLog('apActionsProvider');
	private readonly workspaceRoot: string | undefined;
	public context: vscode.ExtensionContext;

	constructor(workspaceRoot: string | undefined, context: vscode.ExtensionContext) {
		this.workspaceRoot = workspaceRoot;
		this.context = context;
		this.log.log('apActionsProvider constructor');

		// Listen for task events to detect when tasks are started/ended
		vscode.tasks.onDidStartTask(e => {
			const taskDef = e.execution.task.definition;
			if (taskDef.type === 'ardupilot') {
				this.log.log(`Task started: ${taskDef.configName}`);
				activeConfiguration = e.execution.task;
				this.refresh();
			}
		});

		// Try to find a default active configuration
		this.loadDefaultActiveConfiguration();
	}

	refresh(): void {
		this.log.log('Refreshing actions view');
		this._onDidChangeTreeData.fire(undefined);
		vscode.commands.executeCommand('apBuildConfig.refreshEntry');
	}

	getTreeItem(element: apActionItem): vscode.TreeItem {
		return element;
	}

	// Load the default active configuration from workspace settings or tasks
	private async loadDefaultActiveConfiguration(): Promise<void> {
		// Check if we have a saved active configuration
		const taskConfig = vscode.workspace.getConfiguration('ardupilot');
		const activeConfigName = taskConfig.get<string>('activeConfiguration');

		if (activeConfigName) {
			// Try to find this task
			const tasks = await vscode.tasks.fetchTasks();
			const arduPilotTasks = tasks.filter(task =>
				task.definition.type === 'ardupilot'
			);

			const matchingTask = arduPilotTasks.find(task =>
				task.definition.configName === activeConfigName
			);

			if (matchingTask) {
				setActiveConfiguration(matchingTask);
				this.log.log(`Loaded active configuration: ${activeConfigName}`);
				this.refresh();
				return;
			}
		}

		// If no saved configuration, try to use the first available configuration
		const tasks = await vscode.tasks.fetchTasks();
		const arduPilotTasks = tasks.filter(task =>
			task.definition.type === 'ardupilot'
		);

		if (arduPilotTasks.length > 0) {
			setActiveConfiguration(arduPilotTasks[0]);
			this.log.log(`Using default configuration: ${activeConfiguration?.definition.configName}`);
			this.refresh();
		}
	}

	async showConfigurationSelector(): Promise<void> {
		// Fetch all available tasks
		const tasks = await vscode.tasks.fetchTasks();
		const arduPilotTasks = tasks.filter(task =>
			task.definition.type === 'ardupilot'
		);

		if (arduPilotTasks.length === 0) {
			vscode.window.showInformationMessage('No Ardupilot configurations found. Create one using the Build Configurations view.');
			return;
		}

		// Create quick pick items
		const quickPickItems = arduPilotTasks.map(task => {
			const isActive = activeConfiguration &&
				activeConfiguration.definition.configName === task.definition.configName;

			return {
				label: task.definition.configName,
				description: isActive ? '(Active)' : '',
				task: task
			};
		});

		// Show quick pick
		const selected = await vscode.window.showQuickPick(quickPickItems, {
			placeHolder: 'Select an Ardupilot configuration to activate',
			title: 'Ardupilot Configurations'
		});

		if (selected) {
			// Set the selected task as active
			setActiveConfiguration(selected.task);
			this.log.log(`Set active configuration to: ${selected.label}`);

			// Save the selection to workspace settings
			await vscode.workspace.getConfiguration('ardupilot').update(
				'activeConfiguration',
				selected.label,
				vscode.ConfigurationTarget.Workspace
			);

			this.refresh();
		}
	}

	getChildren(): Thenable<apActionItem[]> {
		this.log.log('Getting action items');

		const actionItems: apActionItem[] = [];

		// Add configuration item first
		let configLabel = 'Select Configuration';
		let configTooltip = 'Select an active build configuration';

		if (activeConfiguration) {
			const def = activeConfiguration.definition as ArdupilotTaskDefinition;
			configLabel = `Configuration: ${def.configName}`;
			configTooltip = `Active configuration: ${def.configName}`;
		}

		actionItems.push(new apActionItem(
			this,
			configLabel,
			vscode.TreeItemCollapsibleState.None,
			'configure',
			configTooltip
		));

		// Only add other actions if we have an active configuration
		if (activeConfiguration) {
			const def = activeConfiguration.definition as ArdupilotTaskDefinition;
			const isSITL = def.configure.toLowerCase().startsWith('sitl');

			// Add Build action
			actionItems.push(new apActionItem(
				this,
				'Build Firmware',
				vscode.TreeItemCollapsibleState.None,
				'build',
				`Build firmware for ${def.configName}`,
				activeConfiguration
			));

			// Add Debug action
			actionItems.push(new apActionItem(
				this,
				'Debug',
				vscode.TreeItemCollapsibleState.None,
				'debug',
				`Debug firmware for ${def.configName}`,
				activeConfiguration
			));

			// Add Upload action for hardware configurations or Run for SITL
			if (isSITL) {
				actionItems.push(new apActionItem(
					this,
					'Run SITL',
					vscode.TreeItemCollapsibleState.None,
					'run',
					`Run SITL simulation for ${def.target}`,
					activeConfiguration
				));
			} else {
				actionItems.push(new apActionItem(
					this,
					'Upload to Board',
					vscode.TreeItemCollapsibleState.None,
					'upload',
					`Upload firmware to ${def.configure} board`,
					activeConfiguration
				));
			}
		}

		return Promise.resolve(actionItems);
	}
}

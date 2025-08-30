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
import { ProgramUtils } from './apProgramUtils';
import { TOOLS_REGISTRY } from './apToolsConfig';
import { targetToVehicleType } from './apLaunch';
import { FireAndForget, isVehicleTarget } from './apCommonUtils';

// Interface for launch configuration
interface LaunchConfiguration {
	name: string;
	type: string;
	request: string;
	target: string;
	preLaunchTask?: string; // Optional for non-vehicle targets
	isSITL: boolean;
	simVehicleCommand?: string;
	board?: string; // Board name for hardware debugging
}

// Store the currently active build configuration
export let activeConfiguration: vscode.Task | undefined;
export let activeLaunchConfig: LaunchConfiguration | null;

// Function to update the active configuration
export function setActiveConfiguration(task: vscode.Task): void {
	if (task.name.endsWith('-upload')) {
		return;
	}
	activeConfiguration = task;
	// After successful build, create matching launch configuration
	if (activeConfiguration && activeConfiguration.definition) {
		const taskDef = activeConfiguration.definition as ArdupilotTaskDefinition;

		// Only create launch config and update properties for non-override tasks
		if (!taskDef.overrideEnabled && taskDef.configure && taskDef.target) {
			activeLaunchConfig = apActionItem.createMatchingLaunchConfig(
				taskDef.configName,
				taskDef.configure,
				taskDef.target,
				taskDef.simVehicleCommand || '',
				taskDef.configure // Pass board name (same as configure for hardware builds)
			);
			// Update c_cpp_properties.json for IntelliSense
			updateCppProperties(taskDef.configure).catch(error => {
				new apLog('setActiveConfiguration').log(`Error updating C++ properties: ${error}`);
			});
		}
	}
}

// Interface for C++ configuration based on c_cpp_properties.json schema
interface CppConfiguration {
	name: string;
	includePath?: string[];
	defines?: string[];
	compilerPath?: string;
	cStandard?: string;
	cppStandard?: string;
	intelliSenseMode?: string;
	compileCommands?: string;
	configurationProvider?: string;
	browse?: {
		path?: string[];
		limitSymbolsToIncludedHeaders?: boolean;
		databaseFilename?: string;
	};
}

// Interface for c_cpp_properties.json
interface CppProperties {
	configurations: CppConfiguration[];
	version: number;
}

// Function to update c_cpp_properties.json with the current configuration's compile_commands.json path
async function updateCppProperties(boardName: string): Promise<void> {
	const log = new apLog('updateCppProperties').log;

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		log('No workspace folder is open.');
		return;
	}

	const vscodeDir = path.join(workspaceRoot, '.vscode');
	const cppPropertiesPath = path.join(vscodeDir, 'c_cpp_properties.json');

	// Create .vscode directory if it doesn't exist
	if (!fs.existsSync(vscodeDir)) {
		fs.mkdirSync(vscodeDir, { recursive: true });
	}

	// Check if this is a SITL configuration
	const isSITL = boardName.toLowerCase().startsWith('sitl');

	// Get the appropriate compiler path
	let compilerPath: string;
	if (isSITL) {
		const gccInfo = await ProgramUtils.findProgram(TOOLS_REGISTRY.GCC);
		compilerPath = gccInfo.path || 'gcc';
	} else {
		const armGccInfo = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GCC);
		compilerPath = armGccInfo.path || 'arm-none-eabi-gcc';
	}

	// Default C++ properties structure
	const defaultConfig: CppConfiguration = {
		name: 'ArduPilot',
		includePath: [
			'${workspaceFolder}/**'
		],
		defines: [],
		compilerPath: compilerPath,
		cStandard: 'c11',
		cppStandard: 'gnu++11',
		intelliSenseMode: isSITL ? 'gcc-x64' : 'gcc-arm'
	};

	let cppProperties: CppProperties = {
		configurations: [defaultConfig],
		version: 4
	};

	// Read existing c_cpp_properties.json if it exists
	if (fs.existsSync(cppPropertiesPath)) {
		try {
			const content = fs.readFileSync(cppPropertiesPath, 'utf8');
			cppProperties = JSON.parse(content) as CppProperties;
		} catch (error) {
			log(`Error reading c_cpp_properties.json: ${error}`);
		}
	}

	// Ensure configurations array exists
	if (!cppProperties.configurations || !Array.isArray(cppProperties.configurations)) {
		cppProperties.configurations = [];
	}

	// Find or create ArduPilot configuration
	let apConfig = cppProperties.configurations.find((cfg: CppConfiguration) => cfg.name === 'ArduPilot');
	if (!apConfig) {
		apConfig = {
			name: 'ArduPilot',
			includePath: [
				'${workspaceFolder}/**'
			],
			defines: [],
			compilerPath: compilerPath,
			cStandard: 'c11',
			cppStandard: 'gnu++11',
			intelliSenseMode: isSITL ? 'gcc-x64' : 'gcc-arm'
		};
		cppProperties.configurations.push(apConfig);
	}

	// Update compiler settings based on board type
	apConfig.compilerPath = compilerPath;
	apConfig.intelliSenseMode = isSITL ? 'gcc-x64' : 'gcc-arm';

	// Update compile commands path
	const compileCommandsPath = '${workspaceFolder}/build/' + boardName + '/compile_commands.json';
	apConfig.compileCommands = compileCommandsPath;

	// Write updated c_cpp_properties.json
	try {
		fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 4), 'utf8');
		log(`Updated c_cpp_properties.json with compile commands path: ${compileCommandsPath}`);
	} catch (error) {
		log(`Error writing c_cpp_properties.json: ${error}`);
		vscode.window.showErrorMessage(`Failed to update c_cpp_properties.json: ${error}`);
	}
}

// TreeItem representing an action
export class apActionItem extends vscode.TreeItem {
	private static logger = new apLog('apActionItem');
	private static log = apActionItem.logger.log;

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
			void this.runFirmware();
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

	static createMatchingLaunchConfig(configName: string, configure: string, target: string, simVehicleCommand: string, board?: string): LaunchConfiguration | null {
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

		// Determine if this is a vehicle target that needs upload functionality
		const isVehicle = isVehicleTarget(target);

		// Set preLaunchTask based on target type
		let preLaunchTask: string | undefined;
		if (isVehicle) {
			// For vehicle targets, depend on upload task (will be created separately)
			preLaunchTask = `${APTaskProvider.ardupilotTaskType}: ${configName}-upload`;
			apActionItem.log(`Vehicle target detected: ${target}, using upload task dependency`);
		} else {
			// For non-vehicle targets (AP_Periph, bootloaders, etc.), no preLaunchTask needed
			apActionItem.log(`Non-vehicle target detected: ${target}, no upload task needed`);
		}

		// Create standard launch configuration
		const newConfig: LaunchConfiguration = {
			name: launchConfigName,
			type: 'apLaunch',
			request: 'launch',
			target: target,
			...(preLaunchTask && { preLaunchTask }), // Only add preLaunchTask if defined
			isSITL: isSITL,
			...(simVehicleCommand && { simVehicleCommand }),
			...(!isSITL && board && { board }) // Add board field for hardware debugging
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
		apActionItem.log(`upload firmware for ${this.label}`);
		if (!activeConfiguration) {
			vscode.window.showErrorMessage('No active configuration selected');
			return;
		}

		// Find the upload task for the current configuration
		const configName = (activeConfiguration.definition as ArdupilotTaskDefinition).configName;
		if (!configName) {
			vscode.window.showErrorMessage('Active configuration missing configName');
			return;
		}

		const uploadTaskName = `${configName}-upload`;

		// Get all tasks and find the upload task
		vscode.tasks.fetchTasks().then(tasks => {
			const uploadTask = tasks.find(task =>
				task.definition.type === 'ardupilot' &&
				(task.definition as ArdupilotTaskDefinition).configName === uploadTaskName
			);

			if (!uploadTask) {
				vscode.window.showErrorMessage(`Upload task not found: ${uploadTaskName}`);
				return;
			}

			// Execute the upload task
			vscode.tasks.executeTask(uploadTask).then(taskExecution => {
				if (!taskExecution) {
					vscode.window.showErrorMessage('Failed to start upload task execution');
					return;
				}

				// Create a task execution finished listener
				const disposable = vscode.tasks.onDidEndTaskProcess(e => {
					if (e.execution === taskExecution) {
						disposable.dispose();  // Clean up the listener

						if (e.exitCode === 0) {
							vscode.window.showInformationMessage(`Upload successful for ${this.label}`);
						} else {
							vscode.window.showErrorMessage(`Upload failed for ${this.label}`);
						}
					}
				});
			}, (error: unknown) => {
				vscode.window.showErrorMessage(`Failed to execute upload task: ${error}`);
			});
		}, (error: unknown) => {
			vscode.window.showErrorMessage(`Failed to fetch tasks: ${error}`);
		});
	}

	@FireAndForget({ apLog: apActionItem.logger, showErrorPopup: true })
	private async runFirmware(): Promise<void> {
		if (!activeConfiguration) {
			vscode.window.showErrorMessage('No active configuration selected');
			return;
		}

		const config = activeConfiguration.definition as ArdupilotTaskDefinition;

		// Check if this is an override configuration or if we have standard fields
		if (config.overrideEnabled) {
			vscode.window.showInformationMessage('Run is not supported for override configurations');
			return;
		}

		if (!config.configure) {
			vscode.window.showErrorMessage('Configuration is missing board information');
			return;
		}

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
		if (!config.target) {
			vscode.window.showErrorMessage('Configuration is missing target information');
			return;
		}

		const vehicleBaseType = config.target.replace('sitl-', '');

		// Get ArduPilot vehicle name for sim_vehicle.py -v argument (e.g., 'ArduCopter')
		let vehicleType = targetToVehicleType[vehicleBaseType] || vehicleBaseType;

		// Special handling for helicopter - use ArduCopter with -f heli
		let additionalArgs = '';
		if (vehicleBaseType === 'heli') {
			vehicleType = 'ArduCopter';
			// Only add -f heli if not already in the user's command
			const userCommand = config.simVehicleCommand || '';
			if (!userCommand.includes('-f ')) {
				additionalArgs = '-f heli';
			}
		}

		const simVehiclePath = path.join(workspaceRoot, 'Tools', 'autotest', 'sim_vehicle.py');

		
		if (!fs.existsSync(simVehiclePath)) {
			vscode.window.showErrorMessage('sim_vehicle.py not found. Please ensure ArduPilot is properly cloned.');
			return;
		}

		// Prepare environment variables using the shared method from APTaskProvider
		// This will set CC/CXX appropriately based on SITL vs non-SITL builds
		const terminalEnv = await APTaskProvider.prepareEnvironmentVariables(config);

		// Run the SITL simulation using sim_vehicle.py
		const terminal = vscode.window.createTerminal({
			name: 'ArduPilot SITL',
			env: terminalEnv
		});
		terminal.sendText(`cd ${workspaceRoot}`);
		const simVehicleCommand = `python ${simVehiclePath} --no-rebuild -v ${vehicleType} ${additionalArgs} ${config.simVehicleCommand || ''}`;
		terminal.sendText(simVehicleCommand);
		terminal.show();
	}

	private configure(): void {
		// Show quick pick to select a configuration
		void this._actionsProvider.showConfigurationSelector();
	}
}

// Provider for the apActions tree view
export class apActionsProvider implements vscode.TreeDataProvider<apActionItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<apActionItem | undefined> = new vscode.EventEmitter<apActionItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apActionItem | undefined> = this._onDidChangeTreeData.event;
	private static logger = new apLog('apActionsProvider');
	private log = apActionsProvider.logger.log;

	public context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.log('apActionsProvider constructor');

		// Listen for task events to detect when tasks are started/ended
		vscode.tasks.onDidStartTask(e => {
			const taskDef = e.execution.task.definition;
			if (taskDef.type === 'ardupilot') {
				this.log(`Task started: ${taskDef.configName}`);
				setActiveConfiguration(e.execution.task);
				this.refresh();
			}
		});

		// Try to find a default active configuration
		this.loadDefaultActiveConfiguration().catch(err => {
			this.log(`Error loading default active configuration: ${err}`);
			vscode.window.showErrorMessage(`Error loading default active configuration: ${err.message ?? err}`);
		});
	}

	refresh(): void {
		this.log('Refreshing actions view');
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
				this.log(`Loaded active configuration: ${activeConfigName}`);
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
			this.log(`Using default configuration: ${activeConfiguration?.definition.configName}`);
			this.refresh();
		}
	}

	@FireAndForget({ apLog: apActionsProvider.logger, showErrorPopup: true })
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
			this.log(`Set active configuration to: ${selected.label}`);

			// Save the selection to workspace settings if workspace is available
			if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
				try {
					await vscode.workspace.getConfiguration('ardupilot').update(
						'activeConfiguration',
						selected.label,
						vscode.ConfigurationTarget.Workspace
					);
				} catch (error) {
					this.log(`Error saving active configuration: ${error}`);
				}
			} else {
				this.log('No workspace available to save active configuration');
			}

			this.refresh();
		}
	}

	getChildren(): Thenable<apActionItem[]> {
		this.log('Getting action items');

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
			const isSITL = !def.overrideEnabled && def.configure && def.configure.toLowerCase().startsWith('sitl');

			// Add Build action (available for all configurations)
			actionItems.push(new apActionItem(
				this,
				'Build Firmware',
				vscode.TreeItemCollapsibleState.None,
				'build',
				`Build firmware for ${def.configName}`,
				activeConfiguration
			));

			// Only add Debug and Upload/Run actions for non-overridden configurations
			if (!def.overrideEnabled) {
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
					const boardName = def.configure || 'unknown board';
					actionItems.push(new apActionItem(
						this,
						'Upload to Board',
						vscode.TreeItemCollapsibleState.None,
						'upload',
						`Upload firmware to ${boardName}`,
						activeConfiguration
					));
				}
			}
		}

		return Promise.resolve(actionItems);
	}
}

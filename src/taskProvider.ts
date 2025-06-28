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

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { apLog } from './apLog';
import { ProgramUtils } from './apProgramUtils';

export class APTaskProvider implements vscode.TaskProvider {
	static ardupilotTaskType = 'ardupilot';
	private ardupilotPromise: Thenable<vscode.Task[]> | undefined = undefined;
	private static log = new apLog('apBuildConfigPanel');
	private static _extensionUri: vscode.Uri;
	private log = APTaskProvider.log.log;

	/**
	 * Migrates existing tasks.json to add configName field if missing
	 */
	/**
	 * Generates build commands from task definition parameters
	 * This method is used both by task creation and UI display
	 */
	public static generateBuildCommands(
		board: string,
		target: string,
		configureOptions: string = '',
		buildOptions: string = '',
		workspaceRoot?: string
	): { configureCommand: string; buildCommand: string; taskCommand: string } {
		if (!workspaceRoot) {
			workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
		}

		const waffile = path.join(workspaceRoot, 'waf');
		const wafCommand = `python3 ${waffile}`;

		// Generate configure command
		const configureCommand = `${wafCommand} configure --board=${board}${configureOptions ? ' ' + configureOptions : ''}`;

		// Generate build command
		const buildCommand = `${wafCommand} ${target}${buildOptions ? ' ' + buildOptions : ''}`;

		// Generate task command (with cd prefix for task execution)
		const taskCommand = `cd ../../ && ${configureCommand} && python3 ${waffile} ${target}${buildOptions ? ' ' + buildOptions : ''}`;

		return {
			configureCommand,
			buildCommand,
			taskCommand
		};
	}

	public static migrateTasksJsonForConfigName(): boolean {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			return false;
		}

		const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			return false;
		}

		try {
			const tasksJson = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			let modified = false;

			if (tasksJson.tasks) {
				tasksJson.tasks.forEach((task: vscode.TaskDefinition) => {
					if (task.type === 'ardupilot' && !task.configName) {
						task.configName = `${task.configure}-${task.target}`;
						modified = true;
						APTaskProvider.log.log(`Migrated task: ${task.configName}`);
					}
				});
			}

			if (modified) {
				fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, '\t'));
				APTaskProvider.log.log('Tasks.json migration completed');
				return true;
			}
		} catch (error) {
			APTaskProvider.log.log(`Error during tasks.json migration: ${error}`);
		}

		return false;
	}

	constructor(workspaceRoot: string, extensionUri: vscode.Uri) {
		const pattern = path.join(workspaceRoot, 'tasklist.json');
		const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		fileWatcher.onDidChange(() => this.ardupilotPromise = undefined);
		fileWatcher.onDidCreate(() => this.ardupilotPromise = undefined);
		fileWatcher.onDidDelete(() => this.ardupilotPromise = undefined);
		APTaskProvider._extensionUri = extensionUri;
	}

	public provideTasks(): Thenable<vscode.Task[]> | undefined {
		return undefined;
	}

	public static getOrCreateBuildConfig(board: string, target: string, configName: string, configureOptions?: string, simVehicleCommand?: string): vscode.Task | undefined {
		// create a new task definition in tasks.json
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		APTaskProvider.log.log(`Creating new build configuration for ${board} ${target} @ ${workspaceRoot}`);
		if (!workspaceRoot || !vscode.workspace.workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}

		// Prepare .vscode folder if it doesn't exist
		const vscodeFolder = path.join(workspaceRoot, '.vscode');
		if (!fs.existsSync(vscodeFolder)) {
			try {
				fs.mkdirSync(vscodeFolder, { recursive: true });
			} catch (error) {
				APTaskProvider.log.log(`Failed to create .vscode directory: ${error}`);
				vscode.window.showErrorMessage(`Failed to create .vscode directory: ${error}`);
				return undefined;
			}
		}

		// Create task definition
		const taskDef: ArdupilotTaskDefinition = {
			type: 'ardupilot',
			configure: board,
			target: target,
			configName: configName,
			configureOptions: configureOptions === undefined ? '' : configureOptions,
			buildOptions: '',
			group: {
				kind: 'build',
			}
		};

		// Add simVehicleCommand for SITL builds (case insensitive check)
		if (board.toLowerCase().startsWith('sitl')) {
			// If simVehicleCommand is provided, use it
			if (simVehicleCommand) {
				taskDef.simVehicleCommand = simVehicleCommand;
				APTaskProvider.log.log(`Using provided simVehicleCommand: ${simVehicleCommand}`);
			} else {
				// Check for existing simVehicleCommand in tasks.json
				const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
				if (fs.existsSync(tasksPath)) {
					try {
						const tasksJson = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
						// Define an interface for task to avoid using 'any'
						interface TaskJsonDefinition {
							type: string;
							configure: string;
							target: string;
							configName?: string;
							simVehicleCommand?: string;
						}

						const matchingTask = tasksJson.tasks?.find((task: TaskJsonDefinition) =>
							task.type === 'ardupilot' &&
							task.configName === configName
						);

						if (matchingTask?.simVehicleCommand) {
							taskDef.simVehicleCommand = matchingTask.simVehicleCommand;
							APTaskProvider.log.log(`Loaded existing simVehicleCommand from tasks.json: ${taskDef.simVehicleCommand}`);
						}
					} catch (error) {
						APTaskProvider.log.log(`Error reading tasks.json: ${error}`);
					}
				}
			}
		}

		const task = taskDef ? this.createTask(taskDef) : undefined;
		if (!task) {
			vscode.window.showErrorMessage('Failed to create task definition.');
			return undefined;
		}
		if (task.definition.simVehicleCommand) {
			APTaskProvider.log.log(`Task created with simVehicleCommand: ${task.definition.simVehicleCommand}`);
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri);

		// Get current tasks array or initialize empty array if it doesn't exist
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];

		// Check if task already exists with this configName
		const existingTaskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) =>
			task.configName === configName
		);

		if (existingTaskIndex !== -1) {
			// Update existing task
			tasks[existingTaskIndex] = task.definition as ArdupilotTaskDefinition;
		} else {
			// Add new task
			tasks.push(task.definition as ArdupilotTaskDefinition);
		}

		// Update the tasks configuration
		tasksConfig.update('tasks', tasks, vscode.ConfigurationTarget.Workspace).then(() => {
			APTaskProvider.log.log(`Added/updated task ${configName} to tasks.json using VS Code API`);
		}, (error) => {
			APTaskProvider.log.log(`Error updating tasks.json: ${error}`);
			vscode.window.showErrorMessage(`Failed to update tasks.json: ${error}`);
		});

		return task;
	}

	/**
	 * Prepares environment variables with configured CC and CXX paths
	 * Uses cached tool paths for synchronous operation
	 * @returns Environment variables object
	 */
	private static prepareEnvironmentVariables(): { [key: string]: string } {
		const env: { [key: string]: string } = {};

		// Copy process.env but filter out undefined values
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				env[key] = value;
			}
		}

		// Get GCC and G++ tool paths using cached values
		const gccPath = ProgramUtils.cachedToolPath(ProgramUtils.TOOL_GCC);
		const gppPath = ProgramUtils.cachedToolPath(ProgramUtils.TOOL_GPP);

		if (gccPath) {
			env.CC = gccPath;
			APTaskProvider.log.log(`Setting CC environment variable to: ${gccPath}`);
		}

		if (gppPath) {
			env.CXX = gppPath;
			APTaskProvider.log.log(`Setting CXX environment variable to: ${gppPath}`);
		}

		return env;
	}

	static createTask(definition: ArdupilotTaskDefinition): vscode.Task | undefined {
		const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
		if (!workspaceRoot) {
			return undefined;
		}
		if (definition.waffile === undefined) {
			// use the waf file from the workspace
			definition.waffile = workspaceRoot.uri.fsPath + '/waf';
		}
		if (definition.nm === undefined) {
			definition.nm = 'arm-none-eabi-nm';
		}
		// Use configName for task label
		const task_name = definition.configName;

		// make build directory if it doesn't exist
		const buildDir = path.join(workspaceRoot.uri.fsPath, 'build', definition.configure);
		if (!fs.existsSync(buildDir)) {
			try {
				fs.mkdirSync(buildDir, { recursive: true });
			} catch (error) {
				APTaskProvider.log.log(`Failed to create build directory: ${error}`);
				vscode.window.showErrorMessage(`Failed to create build directory: ${error}`);
				return undefined;
			}
		}

		// Prepare environment variables with CC and CXX paths
		const env = this.prepareEnvironmentVariables();

		// Generate commands using shared method
		const commands = this.generateBuildCommands(
			definition.configure,
			definition.target,
			definition.configureOptions,
			definition.buildOptions,
			workspaceRoot.uri.fsPath
		);

		return new vscode.Task(
			definition,
			vscode.TaskScope.Workspace,
			task_name,
			'ardupilot',
			new vscode.ShellExecution(
				commands.taskCommand,
				{ cwd: buildDir, env: env }
			),
			'$apgcc'
		);
	}

	public static delete(taskName: string): void {
		// delete the task from tasks.json using VS Code API
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', workspaceRoot.uri);

		// Get current tasks array
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition>;
		if (!tasks || !Array.isArray(tasks)) {
			vscode.window.showErrorMessage('No tasks found in tasks.json');
			return;
		}

		// Filter out the task with the matching configName
		const newTasks = tasks.filter((task: ArdupilotTaskDefinition) => task.configName !== taskName);

		// Only update if we actually removed a task
		if (newTasks.length !== tasks.length) {
			// Update the tasks configuration
			tasksConfig.update('tasks', newTasks, vscode.ConfigurationTarget.Workspace).then(() => {
				APTaskProvider.log.log(`Removed task for ${taskName} from tasks.json`);
			}, (error) => {
				APTaskProvider.log.log(`Error removing task from tasks.json: ${error}`);
				vscode.window.showErrorMessage(`Failed to remove task from tasks.json: ${error}`);
			});
		} else {
			APTaskProvider.log.log(`No task found for ${taskName}`);
		}
	}

	public resolveTask(task: vscode.Task): vscode.Task | undefined {
		const taskDef = task.definition;
		if (taskDef) {
			// Note: resolveTask cannot be async, so we return the task without environment variables
			// Environment variables will be set when the task is actually executed
			return this.createTaskSync(taskDef as ArdupilotTaskDefinition);
		}
		return undefined;
	}

	/**
	 * Creates a task synchronously without environment variable setup
	 * Used by resolveTask which cannot be async
	 */
	private createTaskSync(definition: ArdupilotTaskDefinition): vscode.Task | undefined {
		const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
		if (!workspaceRoot) {
			return undefined;
		}
		if (definition.waffile === undefined) {
			// use the waf file from the workspace
			definition.waffile = workspaceRoot.uri.fsPath + '/waf';
		}
		if (definition.nm === undefined) {
			definition.nm = 'arm-none-eabi-nm';
		}
		// Use configName for task label
		const task_name = definition.configName;

		// make build directory if it doesn't exist
		const buildDir = path.join(workspaceRoot.uri.fsPath, 'build', definition.configure);
		if (!fs.existsSync(buildDir)) {
			try {
				fs.mkdirSync(buildDir, { recursive: true });
			} catch (error) {
				APTaskProvider.log.log(`Failed to create build directory: ${error}`);
				vscode.window.showErrorMessage(`Failed to create build directory: ${error}`);
				return undefined;
			}
		}

		// Use basic environment without CC/CXX setup for resolveTask
		const env: { [key: string]: string } = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				env[key] = value;
			}
		}

		// Generate commands using shared method
		const commands = APTaskProvider.generateBuildCommands(
			definition.configure,
			definition.target,
			definition.configureOptions,
			definition.buildOptions,
			workspaceRoot.uri.fsPath
		);

		return new vscode.Task(
			definition,
			vscode.TaskScope.Workspace,
			task_name,
			'ardupilot',
			new vscode.ShellExecution(
				commands.taskCommand,
				{ cwd: buildDir, env: env }
			),
			'$apgcc'
		);
	}
}

export interface ArdupilotTaskDefinition extends vscode.TaskDefinition {
	/**
	 * configure boardname
	 */
	configure: string;
	/**
	 * target
	 */
	target: string;
	/**
	 * custom configuration name
	 */
	configName: string;
	/**
	 * target output binary
	 */
	target_output?: string;
	/**
	 * configure options
	 */
	configureOptions: string;
    /**
     * build options
     */
    buildOptions: string;
    /**
     * waf file
     */
    waffile?: string;
	/**
	 * nm command
	 */
	nm?: string;
	/**
	 * sim_vehicle.py command for SITL builds
	 */
	simVehicleCommand?: string;
}

export function getFeaturesList(extensionUri: vscode.Uri): Record<string, unknown> {
	// run resources/featureLoader.py on workspaceRoot/Tools/scripts/build_options.py
	const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	if (workspaceRoot === undefined) {
		return {};
	}
	const buildOptionsPath = path.join(workspaceRoot, 'Tools', 'scripts', 'build_options.py');
	if (!fs.existsSync(buildOptionsPath)) {
		throw new Error('build_options.py not found');
	}
	// run python script resources/featureLoader.py
	const featureLoaderPath = path.join(extensionUri.path, 'resources', 'featureLoader.py');
	const featureLoader = cp.spawnSync('python3', [featureLoaderPath, buildOptionsPath]);
	if (featureLoader.status !== 0) {
		throw new Error('featureLoader.py failed with exit code ' + featureLoader.status);
	}
	const features = JSON.parse(featureLoader.stdout.toString());
	return features;
}

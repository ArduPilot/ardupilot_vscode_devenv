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

export class APTaskProvider implements vscode.TaskProvider {
	static ardupilotTaskType = 'ardupilot';
	private ardupilotPromise: Thenable<vscode.Task[]> | undefined = undefined;
	private static log = new apLog('apBuildConfigPanel');
	private static _extensionUri: vscode.Uri;
	private log = APTaskProvider.log.log;

	/**
	 * Migrates existing tasks.json to add configName field if missing
	 */
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
				tasksJson.tasks.forEach((task: any) => {
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
		if (!this.ardupilotPromise) {
			this.ardupilotPromise = getArdupilotTasks();
		}
		return this.ardupilotPromise;
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

		return new vscode.Task(
			definition,
			vscode.TaskScope.Workspace,
			task_name,
			'ardupilot',
			new vscode.ShellExecution(
				`python3 ${definition.waffile} configure --board=${definition.configure} ${definition.configureOptions} && python3 ${definition.waffile} ${definition.target} ${definition.buildOptions}`
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
			return APTaskProvider.createTask(taskDef as ArdupilotTaskDefinition);
		}
		return undefined;
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

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('Ardupilot Tasks Auto Detection');
	}
	return _channel;
}

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
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

async function getArdupilotTasks(): Promise<vscode.Task[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const result: vscode.Task[] = [];
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return result;
	}

	for (const workspaceFolder of workspaceFolders) {
		const folderString = workspaceFolder.uri.fsPath;
		if (!folderString) {
			continue;
		}
		const waf = path.join(folderString, 'waf');
		if (!await exists(waf)) {
			continue;
		}

		console.log('Generating Tasklist');
		const commandLine = './waf generate_tasklist';
		try {
			const tasksPath = path.join(folderString, '.vscode', 'tasks.json');
			let tasks = undefined;
			if (fs.existsSync(tasksPath)) {
				const raw = fs.readFileSync(tasksPath, 'utf8');
				tasks = JSON.parse(raw);
				// Include existing tasks from tasks.json
				for (const task of tasks.tasks) {
					// Only process ardupilot type tasks
					if (task.type !== 'ardupilot') {
						continue;
					}
					const taskDef = task as ArdupilotTaskDefinition;

					const existingTask = APTaskProvider.createTask(taskDef);
					if (!existingTask) {
						continue;
					}
					result.push(existingTask);
					if (taskDef.group.kind === 'build') {
						existingTask.group = vscode.TaskGroup.Build;
					}
				}
			}
			const { stdout, stderr } = await exec(commandLine, { cwd: folderString });
			if (stderr && stderr.length > 0) {
				getOutputChannel().appendLine(stderr);
				getOutputChannel().show(true);
			}
			if (stdout) {
				const tasklist = JSON.parse(stdout.split('\n')[0]) as ArdupilotTaskDefinition[];
				for (const boardtask of tasklist) {
					for (const buildtask of boardtask.targets) {
						// // check if task exists in tasks.json using the auto-generated configName pattern
						const autoConfigName = `${boardtask.configure}-${buildtask}`;
						const taskExists = tasks.tasks.some((task: ArdupilotTaskDefinition) => task.configName === autoConfigName);
						if (taskExists) {
							continue;
						}
						let buildOptions = '';
						if (boardtask.buildOptions) {
							buildOptions = boardtask.buildOptions;
						}
						let configureOptions = '';
						if (boardtask.configureOptions) {
							configureOptions = boardtask.configureOptions;
						}
						const kind: ArdupilotTaskDefinition = {
							type: 'ardupilot',
							configure: boardtask.configure,
							target: buildtask,
							configName: `${boardtask.configure}-${buildtask}`,
							buildOptions: buildOptions,
							configureOptions: configureOptions,
						};
						const task_name = boardtask.configure + '-' + buildtask;
						const task = new vscode.Task(kind, workspaceFolder, task_name, 'ardupilot', new vscode.ShellExecution(`${waf} configure --board=${boardtask.configure} ${configureOptions} && ${waf} ${buildtask} ${buildOptions}`),'$apgcc');
						result.push(task);
					}
				}
			}
		} catch (err: unknown) {
			const channel = getOutputChannel();
			const error = err as {stderr?: string; stdout?: string};
			if (error.stderr) {
				channel.appendLine(error.stderr);
			}
			if (error.stdout) {
				channel.appendLine(error.stdout);
			}
			channel.appendLine('Auto detecting ardupilot tasks failed.');
		}
	}
	return result;
}

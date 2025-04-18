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
import { targetToBin } from './apBuildConfig';

export class APTaskProvider implements vscode.TaskProvider {
	static ardupilotTaskType = 'ardupilot';
	private ardupilotPromise: Thenable<vscode.Task[]> | undefined = undefined;
	private static log = new apLog('apBuildConfigPanel');
	private static _extensionUri: vscode.Uri;
	private log = APTaskProvider.log.log;
	private static featureDetails: Record<string, unknown>;

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

	public static getOrCreateBuildConfig(board: string, target: string, configureOptions?: string, features?: string[], enableFeatureConfig?: boolean, simVehicleCommand?: string): vscode.Task | undefined {
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
			fs.mkdirSync(vscodeFolder, { recursive: true });
		}

		if (enableFeatureConfig === false) {
			features = [];
		}

		// Create task definition with features
		const taskDef: ArdupilotTaskDefinition = {
			type: 'ardupilot',
			configure: board,
			target: target,
			configureOptions: configureOptions === undefined ? '' : configureOptions,
			buildOptions: '',
			features: features || [],
			enableFeatureConfig: (features && features.length > 0) ? true : (enableFeatureConfig === undefined ? false : enableFeatureConfig),
			group: {
				kind: 'build',
			}
		};

		// Add simVehicleCommand for SITL builds (case insensitive check)
		if (board.toLowerCase().startsWith('sitl') && simVehicleCommand) {
			taskDef.simVehicleCommand = simVehicleCommand;
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri);

		// Get current tasks array or initialize empty array if it doesn't exist
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];

		// Check if task already exists for this board-target combination
		const existingTaskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) => 
			task.configure === board && task.target === target
		);

		// If task exists and is a SITL build, check for existing simVehicleCommand
		if (existingTaskIndex !== -1 && board.toLowerCase().startsWith('sitl')) {
			// Check for existing simVehicleCommand in launch.json
			const launchPath = path.join(workspaceRoot, '.vscode', 'launch.json');
			if (fs.existsSync(launchPath)) {
				try {
					const launchJson = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
					const launchConfigName = `Launch ${board} - ${target}`;
					
					const matchingLaunchConfig = launchJson.configurations?.find((config: any) => 
						config.type === 'apLaunch' &&
						config.name === launchConfigName
					);

					// If we found a matching launch config with simVehicleCommand and no new one was provided
					if (matchingLaunchConfig?.simVehicleCommand && !simVehicleCommand) {
						taskDef.simVehicleCommand = matchingLaunchConfig.simVehicleCommand;
						// remove --waf-configure-arg="<args>" from simVehicleCommand
						taskDef.simVehicleCommand = taskDef.simVehicleCommand?.replace(/--waf-configure-arg="[^"]*" /g, '');
						APTaskProvider.log.log(`Loaded existing simVehicleCommand: ${taskDef.simVehicleCommand}`);
					}
				} catch (error) {
					APTaskProvider.log.log(`Error reading launch.json: ${error}`);
				}
			}
		}

		const task = taskDef ? this.createTask(taskDef) : undefined;
		if (!task) {
			vscode.window.showErrorMessage('Failed to create task definition.');
			return undefined;
		}
		if (existingTaskIndex !== -1) {
			// Update existing task
			tasks[existingTaskIndex] = task.definition as ArdupilotTaskDefinition;
		} else {
			// Add new task
			tasks.push(task.definition as ArdupilotTaskDefinition);
		}

		// Update the tasks configuration
		tasksConfig.update('tasks', tasks, vscode.ConfigurationTarget.Workspace).then(() => {
			APTaskProvider.log.log(`Added/updated task ${board}-${target} to tasks.json using VS Code API`);
		}, (error) => {
			APTaskProvider.log.log(`Error updating tasks.json: ${error}`);
			vscode.window.showErrorMessage(`Failed to update tasks.json: ${error}`);
		});

		return task;
	}

	static updateFeaturesList(): void {
		this.featureDetails = getFeaturesList(APTaskProvider._extensionUri);
	}

	static updateFeaturesDat(buildFolder: string ,features: string[]): string {
		// open extra_hwdef.dat and update features
		const extra_hwdef = path.join(buildFolder, 'extra_hwdef.dat');
		let feature_define = '';
		for (let feature of features) {
			feature = feature.replace(/\s/g, '');
			if (feature.startsWith('!')) {
				feature_define += `undef ${feature.slice(1)}\ndefine ${feature.slice(1)} 0\n`;
			} else if (feature.length > 0) {
				feature_define += `undef ${feature}\ndefine ${feature} 1\n`;
			}
		}
		fs.writeFileSync(extra_hwdef, feature_define, 'utf8');
		return `--extra-hwdef=${buildFolder}/extra_hwdef.dat`;
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
		// convert target to binary
		definition.target_output = targetToBin[definition.target];
		const target_dir = `${workspaceRoot.uri.fsPath}/build/${definition.configure}`;
		const target_binary = `${target_dir}/${definition.target_output}`;
		const task_name = definition.configure + '-' + definition.target;
		const featureOptions = definition.features && definition.features.length > 0 ?
			APTaskProvider.updateFeaturesDat(target_dir, definition.features) : '';

		// check if extract_features.py uses -nm or --nm by running with --help
		const extractFeaturesHelp = cp.spawnSync('python3', [`${workspaceRoot.uri.fsPath}/Tools/scripts/extract_features.py`, '--help']);
		let nmArg = '';
		const extractFeaturesHelpOutput = extractFeaturesHelp.stdout.toString();
		if (extractFeaturesHelpOutput.includes('--nm')) {
			nmArg = '--nm';
		} else if (extractFeaturesHelpOutput.includes('-nm')) {
			nmArg = '-nm';
		} else {
			APTaskProvider.log.log('Error: extract_features.py does not support --nm or -nm');
			return undefined;
		}
		// Conditionally add the extract_features.py script call based on enableFeatureConfig flag
		const extractFeaturesCmd = definition.enableFeatureConfig === true ?
			`&& python3 Tools/scripts/extract_features.py ${target_binary} ${nmArg} ${definition.nm} > ${target_dir}/features.txt` :
			'';

		return new vscode.Task(
			definition,
			vscode.TaskScope.Workspace,
			task_name,
			'ardupilot',
			new vscode.ShellExecution(
				`python3 ${definition.waffile} configure --board=${definition.configure} ${featureOptions} ${definition.configureOptions} && python3 ${definition.waffile} ${definition.target} ${definition.buildOptions} && rm -f ${target_dir}/features.txt ${extractFeaturesCmd}`
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

		// Filter out the task with the matching board name
		const newTasks = tasks.filter((task: ArdupilotTaskDefinition) => task.configure !== taskName);

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
	 * features
	 */
	features?: string[];
	/**
	 * enable features
	 */
	enableFeatureConfig?: boolean;
	/**
	 * sim_vehicle.py command for SITL builds
	 */
	simVehicleCommand?: string;
}

export interface APLaunchDefinition {
	/**
	 * Type of launch (must be 'apLaunch')
	 */
	type: string;
	/**
	 * Target to build
	 */
	target: string;
	/**
	 * Name of the launch
	 */
	name: string;
	/**
	 * Waf file path
	 */
	waffile?: string;
	/**
	 * sim_vehicle.py command arguments for SITL builds
	 */
	simVehicleCommand?: string,
	/**
	 * is it a SITL build
	 */
	isSITL?: boolean;
}

export class APLaunchConfigurationProvider implements vscode.DebugConfigurationProvider {
	private static log = new apLog('APLaunchConfigurationProvider');

	constructor() {}

	public async resolveDebugConfiguration(
		_folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration
	): Promise<vscode.DebugConfiguration | undefined> {
		// If launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const message = 'Cannot launch ArduPilot debug session. Please create a launch configuration.';
			vscode.window.showErrorMessage(message);
			return undefined;
		}

		// Make sure it's an apLaunch type
		if (config.type !== 'apLaunch') {
			return config;
		}

		// Cast to APLaunchDefinition after validation
		if (!config.target) {
			vscode.window.showErrorMessage('ArduPilot launch configuration requires \'target\' properties.');
			return undefined;
		}

		const apConfig = config as unknown as APLaunchDefinition;

		// Get the workspace root
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace is open.');
			return undefined;
		}

		// Set default waf file if not specified
		if (!apConfig.waffile) {
			apConfig.waffile = path.join(workspaceRoot, 'waf');
		}

		if (config.preLaunchTask) {
			// preLaunchTask is specified as <type>: <taskname>
			// find and execute it
			// Parse the task identifier (format: "<type>: <taskname>")
			const taskParts = config.preLaunchTask.split(':');
			if (taskParts.length !== 2) {
				vscode.window.showErrorMessage(`Invalid preLaunchTask format '${config.preLaunchTask}'. Expected format is 'type: taskname'`);
				return undefined;
			}

			const taskType = taskParts[0].trim();
			const taskName = taskParts[1].trim();

			// Find the task by type and name
			const tasks = await vscode.tasks.fetchTasks({ type: taskType });
			const task = tasks.find(t => t.name === taskName);

			if (!task) {
				vscode.window.showErrorMessage(`Pre-launch task '${taskName}' of type '${taskType}' not found.`);
				return undefined;
			}

			// Execute the task and wait for it to complete
			try {
				// executeTask in terminal
				const execution = await vscode.tasks.executeTask(task);

				// Create a promise that resolves when the task completes
				const taskExecution = new Promise<void>((resolve, reject) => {
					const disposable = vscode.tasks.onDidEndTaskProcess(e => {
						if (e.execution === execution) {
							disposable.dispose();
							if (e.exitCode === 0) {
								resolve();
							} else {
								reject(new Error(`Task '${task.name}' failed with exit code ${e.exitCode}`));
							}
						}
					});
				});

				// Wait for the task to complete
				await taskExecution;
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to execute pre-launch task: ${error}`);
				return undefined;
			}
		}

		try {
			// Create the terminal for ArduPilot commands
			const terminal = vscode.window.createTerminal(config.isSITL ? 'ArduPilot SITL' : 'ArduPilot Upload');
			terminal.sendText(`cd ${workspaceRoot}`);

			if (config.isSITL) {
				// For SITL builds, use sim_vehicle.py with the provided command arguments
				const simVehiclePath = path.join(workspaceRoot, 'Tools', 'autotest', 'sim_vehicle.py');

				// Extract vehicle type from target (e.g., 'copter' from 'sitl-copter')
				const vehicleType = apConfig.target.replace('sitl-', '');

				// Build the sim_vehicle.py command with the provided arguments
				const simVehicleCmd = `python3 ${simVehiclePath} -v ${vehicleType} ${apConfig.simVehicleCommand || ''}`;
				APLaunchConfigurationProvider.log.log(`Running SITL simulation: ${simVehicleCmd}`);

				terminal.sendText(simVehicleCmd);
			} else {
				// For physical board builds, run the upload command
				const uploadCommand = `python3 ${apConfig.waffile} ${apConfig.target} --upload`;
				APLaunchConfigurationProvider.log.log(`Running upload command: ${uploadCommand}`);

				terminal.sendText(uploadCommand);
			}

			terminal.show();

			// This is a custom launch type that we've fully handled, so return undefined
			// to prevent VS Code from trying to start a debug session
			return undefined;
		} catch (error) {
			vscode.window.showErrorMessage(`Error in APLaunch: ${error}`);
			return undefined;
		}
	}
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
			// update features list
			APTaskProvider.updateFeaturesList();
			const raw = fs.readFileSync(path.join(folderString, '.vscode', 'tasks.json'), 'utf8');
			const tasks = JSON.parse(raw);
			// Include existing tasks from tasks.json
			for (const task of tasks.tasks) {
				// Only process ardupilot type tasks
				if (task.type === 'ardupilot') {
					const taskDef = task as ArdupilotTaskDefinition;
					const existingTask = APTaskProvider.createTask(taskDef);
					if (existingTask) {
						result.push(existingTask);
						if (taskDef.group.kind === 'build') {
							existingTask.group = vscode.TaskGroup.Build;
						}
						// print the json existing task
						// APTaskProvider.log.log(`Existing task ${JSON.stringify(existingTask)}`);
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
						// // check if task exists in tasks.json
						const taskExists = tasks.tasks.some((task: ArdupilotTaskDefinition) => task.configure === boardtask.configure && task.target === buildtask);
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

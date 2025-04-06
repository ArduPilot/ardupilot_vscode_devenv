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

		// Add simVehicleCommand for SITL builds
		if (board.toLowerCase() === 'sitl' && simVehicleCommand) {
			taskDef.simVehicleCommand = simVehicleCommand;
		}

		// Get the tasks configuration using the VS Code API
		const tasksConfig = vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri);

		// Get current tasks array or initialize empty array if it doesn't exist
		const tasks = tasksConfig.get('tasks') as Array<ArdupilotTaskDefinition> || [];

		// Check if task already exists for this board
		const existingTaskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) => task.configure === board);

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

		// Conditionally add the extract_features.py script call based on enableFeatureConfig flag
		const extractFeaturesCmd = definition.enableFeatureConfig === true ?
			`&& python3 Tools/scripts/extract_features.py ${target_binary} -nm ${definition.nm} >> ${target_dir}/features.txt` :
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
	 * current features
	 */
	features?: string[];
	/**
	 * nm command
	 */
	nm?: string;
	/**
	 * enable features
	 */
	enableFeatureConfig?: boolean;
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
			channel.show(true);
		}
	}
	return result;
}

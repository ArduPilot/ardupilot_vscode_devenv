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

	public static getOrCreateBuildConfig(board: string, target: string, configureOptions?: string, features?: string[], enableFeatureConfig?: boolean): vscode.Task | undefined {
		// create a new task definition in tasks.json
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		APTaskProvider.log.log(`Creating new build configuration for ${board} ${target} @ ${workspaceRoot}`);
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}
		const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			// create a new tasks.json file
			fs.writeFileSync(tasksPath, '{"version": "2.0", "tasks": []}', 'utf8');
		}
		const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		const taskName = `${board}-${target}`;

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
		};

		// If task already exists for this board, update it instead of adding a new one
		const existingTaskIndex = tasks.tasks.findIndex((task: ArdupilotTaskDefinition) => task.configure === board);
		if (existingTaskIndex !== -1) {
			// Update existing task
			tasks.tasks[existingTaskIndex] = taskDef;
		} else {
			// Add new task
			tasks.tasks.push(taskDef);
		}

		// Write updated tasks to the tasks.json file
		fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 4), 'utf8');
		APTaskProvider.log.log(`Added/updated task ${taskName} to ${tasksPath}`);

		return taskDef ? this.createTask(taskDef) : undefined;
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
		// delete the task from tasks.json
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}
		const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			vscode.window.showErrorMessage('tasks.json not found');
			return;
		}
		const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		const newTasks = tasks.tasks.filter((task: ArdupilotTaskDefinition) => task.configure !== taskName);
		tasks.tasks = newTasks;
		fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 4), 'utf8');
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

/**
 * Creates a task to upload firmware to a connected board
 * @param definition The task definition to use for building and uploading
 * @returns A VS Code task or undefined if workspace not available
 */
export function createUploadTask(definition: ArdupilotTaskDefinition): vscode.Task | undefined {
	const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
	if (!workspaceRoot) {
		return undefined;
	}

	if (definition.waffile === undefined) {
		// use the waf file from the workspace
		definition.waffile = workspaceRoot.uri.fsPath + '/waf';
	}

	const task_name = `${definition.configure}-${definition.target}-upload`;

	// ArduPilot's WAF build system requires:
	// 1. The target in the format "target.upload"
	// 2. The build directory to be specified with --out=build/boardname
	const uploadCommand = `cd ${workspaceRoot.uri.fsPath} && python3 ${definition.waffile} ${definition.target} --upload`;

	// Create upload task with the correct command structure
	return new vscode.Task(
		{
			...definition,
			type: 'ardupilot',
			isUpload: true // Custom property to identify this as an upload task
		},
		vscode.TaskScope.Workspace,
		task_name,
		'ardupilot',
		new vscode.ShellExecution(uploadCommand),
		'$apgcc'
	);
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

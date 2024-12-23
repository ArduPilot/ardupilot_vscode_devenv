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

export class APTaskProvider implements vscode.TaskProvider {
	static ardupilotTaskType = "ardupilot";
    private ardupilotPromise: Thenable<vscode.Task[]> | undefined = undefined;
    
    constructor(workspaceRoot: string) {
		const pattern = path.join(workspaceRoot, 'tasklist.json');
		const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		fileWatcher.onDidChange(() => this.ardupilotPromise = undefined);
		fileWatcher.onDidCreate(() => this.ardupilotPromise = undefined);
		fileWatcher.onDidDelete(() => this.ardupilotPromise = undefined);
	}

    public provideTasks(): Thenable<vscode.Task[]> | undefined {
		if (!this.ardupilotPromise) {
			this.ardupilotPromise = getArdupilotTasks();
		}
		return this.ardupilotPromise;
    }

	static createTask(definition: ArdupilotTaskDefinition): vscode.Task {
		const kind: ArdupilotTaskDefinition = {
			type: 'ardupilot',
			configure: definition.configure,
			target: definition.target,
			buildOptions: definition.buildOptions,
			configureOptions: definition.configureOptions,
		};
		if (definition.waffile === undefined) {
			// use the waf file from the workspace
			definition.waffile = vscode.workspace.workspaceFolders![0].uri.fsPath + '/waf';
		}
		if (definition.nm === undefined) {
			definition.nm = 'arm-none-eabi-nm';
		}
		// switch case
		switch (definition.target) {
			case 'plane':
				definition.target_output = 'bin/arduplane';
				break;
			case 'copter':
				definition.target_output = 'bin/arducopter';
				break;
			case 'rover':
				definition.target_output = 'bin/ardurover';
				break;
			case 'sub':
				definition.target_output = 'bin/ardusub';
				break;
			case 'heli':
				definition.target_output = 'bin/arducopter-heli';
				break;
			case 'antennatracker':
				definition.target_output = 'bin/antennatracker';
				break;
			case 'bootloader':
				definition.target_output = 'bootloader/AP_Bootloader';
				break;
		}
		const target_dir = `${vscode.workspace.workspaceFolders![0].uri.fsPath}/build/${definition.configure}`;
		const target_binary = `${target_dir}/${definition.target_output}`;
		const task_name = definition.configure + '-' + definition.target;
		const task = new vscode.Task(kind, vscode.TaskScope.Workspace, task_name, 'ardupilot', new vscode.ShellExecution(`python3 ${definition.waffile} configure --board=${definition.configure} ${definition.configureOptions} && python3 ${definition.waffile} ${definition.target} ${definition.buildOptions} && rm ${target_dir}/features.txt && python3 Tools/scripts/extract_features.py ${target_binary} -nm ${definition.nm} >> ${target_dir}/features.txt`),'$apgcc');
		return task;
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		const task = _task.definition.task;
		if (task) {
			// resolveTask requires that the same definition object be used.
            const definition: ArdupilotTaskDefinition = <any>_task.definition;
			return APTaskProvider.createTask(definition);
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
    waffile?: string
}

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('Ardupilot Tasks Auto Detection');
	}
	return _channel;
}

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
}

interface Tasklist {
	/**
	 * configure boardname
	 */
	configure: string;
	/**
	 * target binary name
	 */
	targets: string[];
	/**
	 * configure options
	 */
	configureOptions?: string;
    /**
     * build options
     */
    buildOptions?: string;
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
            const { stdout, stderr } = await exec(commandLine, { cwd: folderString });
			if (stderr && stderr.length > 0) {
				getOutputChannel().appendLine(stderr);
				getOutputChannel().show(true);
			}
			if (stdout) {
				const tasklist = JSON.parse(stdout.split('\n')[0]) as Tasklist[];
				for (const boardtask of tasklist) {
					for (const buildtask of boardtask.targets) {
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
        } catch (err:any) {
			const channel = getOutputChannel();
			if (err.stderr) {
				channel.appendLine(err.stderr);
			}
			if (err.stdout) {
				channel.appendLine(err.stdout);
			}
			channel.appendLine('Auto detecting ardupilot tasks failed.');
			channel.show(true);
		}
    }
    return result;
}
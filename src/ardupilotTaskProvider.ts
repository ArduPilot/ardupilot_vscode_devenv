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
 */
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';

export class ArdupilotTaskProvider implements vscode.TaskProvider {
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
    
	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		const task = _task.definition.task;
		if (task) {
			// resolveTask requires that the same definition object be used.
            const definition: ArdupilotTaskDefinition = <any>_task.definition;
			return new vscode.Task(definition, _task.scope ?? vscode.TaskScope.Workspace, definition.task, 'ardupilot', new vscode.ShellExecution(`. ${definition.waffile} configure --board=${definition.configure} ${definition.configure_options} && ./waf ${definition.target} ${definition.build_options}`));
		}
		return undefined;
	}
}

interface ArdupilotTaskDefinition extends vscode.TaskDefinition {
	/**
	 * configure boardname
	 */
	configure: string;
	/**
	 * target binary name
	 */
	target: string;
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
						let buildOptions = ''
						if (boardtask.buildOptions) {
							buildOptions = boardtask.buildOptions
						}
						let configureOptions = ''
						if (boardtask.configureOptions) {
							configureOptions = boardtask.configureOptions
						}
						const kind: ArdupilotTaskDefinition = {
							type: 'ardupilot',
							configure: boardtask.configure,
							target: buildtask,
							buildOptions: buildOptions,
							configureOptions: configureOptions,
							problemMatcher: ["$gcc"]
						};
						let task_name = boardtask.configure + '-' + buildtask
						const task = new vscode.Task(kind, workspaceFolder, task_name, 'ardupilot', new vscode.ShellExecution(`${waf} configure --board=${boardtask.configure} ${configureOptions} && ${waf} ${buildtask} ${buildOptions}`));
						result.push(task);
					}
				}
			}
        } catch (err) {
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
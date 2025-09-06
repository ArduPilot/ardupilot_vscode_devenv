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
import { TOOLS_REGISTRY } from './apToolsConfig';
import { isVehicleTarget } from './apCommonUtils';
import { setCleanTask, setDistCleanTask } from './apActions';

/**
 * Custom execution class for ArduPilot build tasks
 * Uses direct child_process.spawn with Python extension integration
 */
class APCustomExecution extends vscode.CustomExecution {
	public static readonly TERMINAL_NAME_PREFIX = 'ArduPilot Build';
	private static log = new apLog('APCustomExecution');
	private terminalOutputDisposables: vscode.Disposable[] = [];

	constructor(
		private definition: ArdupilotTaskDefinition
	) {
		super(async (): Promise<vscode.Pseudoterminal> => {
			return new APBuildPseudoterminal(
				this.definition
			);
		});
	}
}

/**
 * Pseudoterminal implementation for ArduPilot build tasks
 * Uses direct child_process.spawn with pseudoterminal-like behavior
 */
class APBuildPseudoterminal implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();
	private static log = new apLog('APBuildPseudoterminal');
	private childProcess: cp.ChildProcess | null = null;
	private commandFinished = false;

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	/**
	 * Handle user input from the terminal
	 * This method is called by VS Code when the user types in the terminal
	 */
	handleInput(data: string): void {
		// Handle Ctrl+C (SIGINT) - ASCII code 3
		if (data === '\x03') {
			APBuildPseudoterminal.log.log('Received Ctrl+C, terminating build process');
			this.writeEmitter.fire('\r\n^C\r\n');

			if (this.childProcess && !this.childProcess.killed) {
				// Send SIGINT to the child process
				this.childProcess.kill('SIGINT');

				// Give it a moment to handle the signal gracefully
				setTimeout(() => {
					if (this.childProcess && !this.childProcess.killed) {
						// If still running, force kill with SIGTERM
						APBuildPseudoterminal.log.log('Force killing build process with SIGTERM');
						this.childProcess.kill('SIGTERM');
					}
				}, 2000);
			}

			// Mark as finished and close with exit code 130 (standard for SIGINT)
			if (!this.commandFinished) {
				this.handleBuildCompletion({ exitCode: 130 });
			}
			return;
		}

		// Handle other input by forwarding to child process if it's still running
		if (this.childProcess && !this.childProcess.killed && this.childProcess.stdin) {
			this.childProcess.stdin.write(data);
		}
	}

	/**
	 * Handle terminal dimension changes
	 * This method is called by VS Code when the terminal is resized
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	setDimensions(dimensions: vscode.TerminalDimensions): void {
		// Send SIGWINCH signal to notify the child process of dimension changes
		// This is particularly useful for processes that need to know terminal size
		// Note: dimensions parameter is available for future use if needed
		if (this.childProcess && !this.childProcess.killed) {
			this.childProcess.kill('SIGWINCH');
		}
	}

	/*
	 * Process terminal output to handle carriage returns and formatting properly
	 */
	private processTerminalOutput(text: string): string {
		// Preserve carriage returns (\r) so in-line updates work correctly
		// Normalize lone LFs to CRLFs so VS Code renders newlines properly
		// 1) Collapse existing CRLF to LF, then
		// 2) Convert all LFs back to CRLF
		// This keeps standalone CR characters intact
		return text
			.replace(/\r\n/g, '\n')
			.replace(/\n/g, '\r\n')
			// Remove sequences of whitespace followed by "../../" to make paths workspace-root-relative
			.replace(/(^|\s+)\.\.\/\.\.\//gm, '$1');
	}

	constructor(
		private definition: ArdupilotTaskDefinition
	) {}

	async open(): Promise<void> {
		this.writeEmitter.fire('Starting ArduPilot build task...\r\n');
		APBuildPseudoterminal.log.log(`Opening pseudoterminal for task: ${this.definition.configName}`);

		// Execute the build command directly with spawn
		void this.executeBuildCommand();
	}

	close(): void {
		APBuildPseudoterminal.log.log(`Closing pseudoterminal for task: ${this.definition.configName}`);

		// Clean up child process if still running
		if (this.childProcess && !this.childProcess.killed) {
			APBuildPseudoterminal.log.log('Terminating child process');
			this.childProcess.kill('SIGTERM');
		}

		// Mark as finished to prevent duplicate handling
		this.commandFinished = true;

		this.writeEmitter.fire('Build task completed.\r\n');
		this.closeEmitter.fire(0);
	}

	private handleBuildCompletion(result?: { exitCode: number }): void {
		if (this.commandFinished) {
			return; // Prevent duplicate handling
		}
		this.commandFinished = true;

		const exitCode = result?.exitCode || 0;
		const buildStatus = exitCode === 0 ? 'SUCCESS ✅' : 'FAILED ❌';

		this.writeEmitter.fire(`Build completed with exit code: ${exitCode}\r\n`);

		// Log completion info
		apLog.channel.appendLine('[BUILD] ======== Build Completed ========');
		apLog.channel.appendLine(`[BUILD] Task: ${this.definition.configName}`);
		apLog.channel.appendLine(`[BUILD] Exit code: ${exitCode}`);
		apLog.channel.appendLine(`[BUILD] Status: ${buildStatus}`);
		apLog.channel.appendLine('[BUILD] ===================================');

		// Close the pseudoterminal with the exit code
		this.closeEmitter.fire(exitCode);
	}

	private async executeBuildCommand(): Promise<void> {
		try {
			const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri.fsPath;

			// Prepare environment variables lazily
			const baseEnv = await APTaskProvider.prepareEnvironmentVariables(this.definition);

			// Build the command lazily
			let taskCommand = '';
			if (this.definition.overrideEnabled && this.definition.customConfigureCommand && this.definition.customBuildCommand) {
				taskCommand = `${this.definition.customConfigureCommand} && ${this.definition.customBuildCommand}`;
			} else {
				if (!this.definition.configure || !this.definition.target) {
					const msg = 'Missing configure or target for non-override task';
					APBuildPseudoterminal.log.log(msg);
					this.writeEmitter.fire(msg + '\r\n');
					this.closeEmitter.fire(1);
					return;
				}
				const commands = await APTaskProvider.generateBuildCommands(
					this.definition.configure,
					this.definition.target,
					this.definition.configureOptions || '',
					this.definition.buildOptions || '',
					workspaceRoot
				);
				taskCommand = commands.taskCommand;
			}

			// Integrate Python extension for venv activation lazily
			const activateCommand = await ProgramUtils.getPythonActivateCommand();
			if (activateCommand) {
				APBuildPseudoterminal.log.log(`Updated command with Python activation: ${activateCommand}`);
				taskCommand = `${activateCommand} && ${taskCommand}`;
			}

			APBuildPseudoterminal.log.log(`Executing build command: ${taskCommand}`);
			this.writeEmitter.fire(`Executing: ${taskCommand}\r\n`);

			// Log build start info
			apLog.channel.appendLine('[BUILD] ======== Build Started ========');
			apLog.channel.appendLine(`[BUILD] Task: ${this.definition.configName}`);
			apLog.channel.appendLine(`[BUILD] Command: ${taskCommand}`);
			apLog.channel.appendLine(`[BUILD] Working Directory: ${workspaceRoot ?? process.cwd()}`);
			apLog.channel.appendLine('[BUILD] ================================');

			// Enhanced environment for better terminal behavior
			const terminalEnv = {
				...baseEnv,
				TERM: 'xterm-256color',
				FORCE_COLOR: '1',
				COLORTERM: 'truecolor',
				COLUMNS: '120',
				LINES: '30',
				// Additional environment variables to ensure color output
				// Additional environment variables to ensure color output
				NO_COLOR: undefined,
				CLICOLOR_FORCE: '1'
			};

			// Use spawn with shell and inherit stdio for proper terminal behavior
			this.childProcess = cp.spawn(taskCommand, [], {
				cwd: workspaceRoot,
				env: terminalEnv,
				shell: true,
				stdio: ['pipe', 'pipe', 'pipe'],
				// Enable proper terminal behavior
				detached: false
			});
		} catch (error) {
			const errorMsg = `Failed to start build: ${error instanceof Error ? error.message : String(error)}`;
			APBuildPseudoterminal.log.log(errorMsg);
			this.writeEmitter.fire(errorMsg + '\r\n');
			if (!this.commandFinished) {
				this.handleBuildCompletion({ exitCode: 1 });
			}
			return;
		}

		if (!this.childProcess) {
			this.writeEmitter.fire('Error: Failed to spawn build process\r\n');
			this.closeEmitter.fire(1);
			return;
		}

		// Handle stdout output
		this.childProcess.stdout?.on('data', (data: Buffer) => {
			// Use utf8 encoding explicitly to preserve ANSI escape sequences
			const text = data.toString('utf8');
			// Process text to handle carriage returns properly for pseudoterminal
			const processedText = this.processTerminalOutput(text);
			this.writeEmitter.fire(processedText);
			// Log to extension channel (strip ANSI codes for clean logging)
			// eslint-disable-next-line no-control-regex
			const cleanText = text.replace(/\u001b\[[0-9;]*[mGKH]/g, '');
			const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
			lines.forEach(line => {
				if (line.trim()) {
					apLog.channel.appendLine(`[BUILD] ${line.trim()}`);
				}
			});
		});

		// Handle stderr output
		this.childProcess.stderr?.on('data', (data: Buffer) => {
			// Use utf8 encoding explicitly to preserve ANSI escape sequences
			const text = data.toString('utf8');
			// Process text to handle carriage returns properly for pseudoterminal
			const processedText = this.processTerminalOutput(text);
			this.writeEmitter.fire(processedText);
			// Log to extension channel (strip ANSI codes for clean logging)
			// eslint-disable-next-line no-control-regex
			const cleanText = text.replace(/\u001b\[[0-9;]*[mGKH]/g, '');
			const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
			lines.forEach(line => {
				if (line.trim()) {
					apLog.channel.appendLine(`[BUILD] ${line.trim()}`);
				}
			});
		});

		// Handle process errors
		this.childProcess.on('error', (error) => {
			const errorMsg = `Process error: ${error.message}`;
			APBuildPseudoterminal.log.log(errorMsg);
			this.writeEmitter.fire(`${errorMsg}\r\n`);
			if (!this.commandFinished) {
				this.handleBuildCompletion({ exitCode: 1 });
			}
		});

		// Handle process exit
		this.childProcess.on('exit', (code, signal) => {
			const exitCode = code !== null ? code : (signal ? 1 : 0);
			APBuildPseudoterminal.log.log(`Process exited with code: ${exitCode}, signal: ${signal}`);

			if (!this.commandFinished) {
				this.handleBuildCompletion({ exitCode });
			}
		});

		APBuildPseudoterminal.log.log('Build process spawned successfully');
	}

}

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
	public static async generateBuildCommands(
		board: string,
		target: string,
		configureOptions: string = '',
		buildOptions: string = '',
		workspaceRoot?: string
	): Promise<{ configureCommand: string; buildCommand: string; taskCommand: string; }> {
		if (!workspaceRoot) {
			workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
		}

		const waffile = path.join(workspaceRoot, 'waf');

		// Generate configure command with optional --python argument
		const configureCommand = `${await ProgramUtils.PYTHON()} ${waffile} configure --board=${board} ${configureOptions ? ' ' + configureOptions : ''}`;

		// Generate build command
		const buildCommand = `${await ProgramUtils.PYTHON()} ${waffile} ${target}${buildOptions ? ' ' + buildOptions : ''}`;

		// Generate task command without changing directories; execution CWD will be set by the runner
		const taskCommand = `${configureCommand} && ${await ProgramUtils.PYTHON()} ${waffile} ${target}${buildOptions ? ' ' + buildOptions : ''}`;

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
				// First pass: Fix missing configName fields
				tasksJson.tasks.forEach((task: vscode.TaskDefinition) => {
					if (task.type === 'ardupilot' && !task.configName) {
						task.configName = `${task.configure}-${task.target}`;
						modified = true;
						APTaskProvider.log.log(`Migrated task configName: ${task.configName}`);
					}
				});

				// Second pass: Create missing upload tasks for vehicle targets
				const ardupilotTasks = tasksJson.tasks.filter((task: ArdupilotTaskDefinition) =>
					task.type === 'ardupilot' && !task.configName.endsWith('-upload')
				);

				const uploadTasksToAdd: ArdupilotTaskDefinition[] = [];

				ardupilotTasks.forEach((task: ArdupilotTaskDefinition) => {
					// Check if this is a vehicle target that needs an upload task
					if (task.target && isVehicleTarget(task.target) && !(task.configure && task.configure.toLowerCase().startsWith('sitl'))) {
						const uploadTaskName = `${task.configName}-upload`;

						// Check if upload task already exists
						const uploadTaskExists = tasksJson.tasks.some((existingTask: ArdupilotTaskDefinition) =>
							existingTask.configName === uploadTaskName
						);

						if (!uploadTaskExists) {
							// Create upload task definition
							const uploadTaskDef = APTaskProvider.createUploadTaskDefinition(task.configName, task);
							uploadTasksToAdd.push(uploadTaskDef);
							modified = true;
							APTaskProvider.log.log(`Created missing upload task: ${uploadTaskName}`);
						}
					}
				});

				// Add all new upload tasks to the tasks array
				tasksJson.tasks.push(...uploadTasksToAdd);
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
		return (async () => {
			const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
			if (!workspaceRoot) {
				return [];
			}

			const waffile = path.join(workspaceRoot.uri.fsPath, 'waf');
			const pythonPath = await ProgramUtils.PYTHON();

			const definitions: ArdupilotTaskDefinition[] = [
				{
					type: 'ardupilot',
					configName: 'ardupilot-clean',
					overrideEnabled: true,
					customConfigureCommand: `${pythonPath} ${waffile} clean`,
					customBuildCommand: 'true'
				},
				{
					type: 'ardupilot',
					configName: 'ardupilot-distclean',
					overrideEnabled: true,
					customConfigureCommand: `${pythonPath} ${waffile} distclean`,
					customBuildCommand: 'true'
				}
			];

			const tasks: vscode.Task[] = [];
			for (const def of definitions) {
				const task = await APTaskProvider.createTask(def);
				if (task) {
					tasks.push(task);
				}
			}

			// Set preset clean/distclean tasks for direct execution in apActions
			const cleanTask = tasks.find(t => t.definition?.type === 'ardupilot' && t.name === 'ardupilot-clean');
			const distcleanTask = tasks.find(t => t.definition?.type === 'ardupilot' && t.name === 'ardupilot-distclean');
			setCleanTask(cleanTask);
			setDistCleanTask(distcleanTask);

			return tasks;
		})();
	}

	public static async getOrCreateBuildConfig(board: string, target: string, configName: string, configureOptions?: string, simVehicleCommand?: string, overrideEnabled?: boolean, customConfigureCommand?: string, customBuildCommand?: string): Promise<vscode.Task | undefined> {
		// create a new task definition in tasks.json
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

		// Log with appropriate information based on override mode
		if (overrideEnabled) {
			APTaskProvider.log.log(`Creating new override build configuration for ${configName} @ ${workspaceRoot}`);
		} else {
			APTaskProvider.log.log(`Creating new build configuration for ${board} ${target} @ ${workspaceRoot}`);
		}

		if (!workspaceRoot || !vscode.workspace.workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}

		// Validate required fields based on mode
		if (overrideEnabled) {
			if (!customConfigureCommand || !customConfigureCommand.trim() || !customBuildCommand || !customBuildCommand.trim()) {
				vscode.window.showErrorMessage('Custom configure and build commands are required when override is enabled.');
				return;
			}
		} else {
			if (!board || !board.trim() || !target || !target.trim()) {
				vscode.window.showErrorMessage('Board and target are required for standard configurations.');
				return;
			}
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
			configName: configName,
			overrideEnabled: overrideEnabled || false,
			group: {
				kind: 'build',
			}
		};

		// Only include standard fields if override is not enabled
		if (!overrideEnabled) {
			taskDef.configure = board;
			taskDef.target = target;
			taskDef.configureOptions = configureOptions === undefined ? '' : configureOptions;
			taskDef.buildOptions = '';
		} else {
			// Include custom commands when override is enabled
			taskDef.customConfigureCommand = customConfigureCommand || '';
			taskDef.customBuildCommand = customBuildCommand || '';
		}

		// Add simVehicleCommand for SITL builds (only when not using override)
		if (!overrideEnabled && board.toLowerCase().startsWith('sitl')) {
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

		const task = taskDef ? await this.createTask(taskDef) : undefined;
		if (!task) {
			vscode.window.showErrorMessage('Failed to create task definition.');
			return undefined;
		}
		if (task.definition.simVehicleCommand) {
			APTaskProvider.log.log(`Task created with simVehicleCommand: ${task.definition.simVehicleCommand}`);
		}

		// Get the tasks configuration using the VS Code API
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			APTaskProvider.log.log('No workspace folders available for tasks configuration');
			vscode.window.showErrorMessage('No workspace folder is open for tasks configuration.');
			return undefined;
		}
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

		// For vehicle targets, also create and add an upload task (skip for SITL)
		if (!overrideEnabled && target && isVehicleTarget(target) && !(board && board.toLowerCase().startsWith('sitl'))) {
			const uploadTaskDef = this.createUploadTaskDefinition(configName, task.definition as ArdupilotTaskDefinition);

			// Check if upload task already exists
			const existingUploadTaskIndex = tasks.findIndex((task: ArdupilotTaskDefinition) =>
				task.configName === `${configName}-upload`
			);

			if (existingUploadTaskIndex !== -1) {
				// Update existing upload task
				tasks[existingUploadTaskIndex] = uploadTaskDef;
			} else {
				// Add new upload task
				tasks.push(uploadTaskDef);
			}

			APTaskProvider.log.log(`Created upload task for vehicle target: ${target}`);
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
	 * Creates an upload task definition that depends on the build task and adds --upload flag
	 * This just creates a task definition object, not an actual VS Code task
	 * @param configName The configuration name for the build task this upload depends on
	 * @param definition The base task definition to copy settings from
	 * @returns Upload task definition
	 */
	public static createUploadTaskDefinition(configName: string, definition: ArdupilotTaskDefinition): ArdupilotTaskDefinition {
		// Create upload task definition based on build task definition
		const uploadTaskDef: ArdupilotTaskDefinition = {
			...definition,
			configName: `${configName}-upload`,
			buildOptions: `${definition.buildOptions || ''} --upload`.trim(),
			group: {
				kind: 'build',
			},
			dependsOn: [configName] // Upload depends on build task
		};

		return uploadTaskDef;
	}

	/**
	 * Prepares environment variables with Python extension integration
	 * Uses cached tool paths and Python extension API for enhanced environment setup
	 * @param definition The task definition to determine SITL vs non-SITL builds
	 * @returns Environment variables object with Python environment integration
	 */
	public static async prepareEnvironmentVariables(definition?: ArdupilotTaskDefinition): Promise<{ [key: string]: string }> {
		const env: { [key: string]: string } = {};

		// Copy process.env but filter out undefined values
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				env[key] = value;
			}
		}

		// Check if this is a SITL build from the task definition
		const isSitlBuild = definition && definition.configure &&
			definition.configure.toLowerCase().startsWith('sitl');

		if (isSitlBuild) {
			// For SITL builds, use regular GCC/G++
			const gccPath = await ProgramUtils.findProgram(TOOLS_REGISTRY.GCC);
			const gppPath = await ProgramUtils.findProgram(TOOLS_REGISTRY.GPP);

			if (gccPath.path) {
				env.CC = gccPath.path;
				APTaskProvider.log.log(`Setting CC environment variable for SITL to: ${gccPath.path}`);
			}

			if (gppPath.path) {
				env.CXX = gppPath.path;
				APTaskProvider.log.log(`Setting CXX environment variable for SITL to: ${gppPath.path}`);
			}
		} else {
			// For non-SITL builds, use ARM toolchain
			const armGccPath = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GCC);

			const armBinPath = armGccPath.path ? path.dirname(armGccPath.path) : undefined;
			if (armBinPath) {
				env.PATH = env.PATH ? `${env.PATH}:${armBinPath}` : armBinPath;
			}
		}

		// also set PYTHON environment variable
		const pythonInfo = await ProgramUtils.findProgram(TOOLS_REGISTRY.PYTHON);
		if (pythonInfo.path) {
			env.PYTHON = pythonInfo.path;
			APTaskProvider.log.log(`Setting PYTHON environment variable to: ${pythonInfo.path}`);
		} else {
			APTaskProvider.log.log('No PYTHON environment variable set, using default');
		}
		return env;
	}

	static async createTask(definition: ArdupilotTaskDefinition): Promise<vscode.Task | undefined> {
		const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
		if (!workspaceRoot) {
			return undefined;
		}

		const progressTitle = `Preparing Task: ${definition.configName}...`;
		let createdTask: vscode.Task | undefined;

		const runCreate = async (): Promise<void> => {
			// Use configName for task label
			const task_name = definition.configName;

			if (definition.overrideEnabled) {
				// Validate that custom commands are provided for override mode
				if (!definition.customConfigureCommand || !definition.customConfigureCommand.trim() ||
					!definition.customBuildCommand || !definition.customBuildCommand.trim()) {
					APTaskProvider.log.log('Missing custom commands for override-enabled task');
					createdTask = undefined;
					return;
				}
			} else {
				if (!definition.configure || !definition.target) {
					APTaskProvider.log.log('Missing configure or target for non-override task');
					createdTask = undefined;
					return;
				}
				// Set cheap defaults used elsewhere
				if (definition.waffile === undefined) {
					definition.waffile = workspaceRoot.uri.fsPath + '/waf';
				}
				if (definition.nm === undefined) {
					definition.nm = 'arm-none-eabi-nm';
				}
			}

			createdTask = new vscode.Task(
				definition,
				vscode.TaskScope.Workspace,
				task_name,
				'ardupilot',
				new APCustomExecution(
					definition
				),
				'$apgcc'
			);
		};

		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false }, async () => {
			await runCreate();
		});

		return createdTask;
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
		// If it's a base task (not already an -upload task), also remove its corresponding -upload task
		const uploadTaskName = taskName.endsWith('-upload') ? undefined : `${taskName}-upload`;
		const newTasks = tasks.filter((task: ArdupilotTaskDefinition) => {
			if (task.configName === taskName) {
				return false;
			}
			if (uploadTaskName && task.configName === uploadTaskName) {
				return false;
			}
			return true;
		});

		// Only update if we actually removed a task
		if (newTasks.length !== tasks.length) {
			// Update the tasks configuration
			tasksConfig.update('tasks', newTasks, vscode.ConfigurationTarget.Workspace).then(() => {
				if (uploadTaskName && tasks.some(t => t.configName === uploadTaskName)) {
					APTaskProvider.log.log(`Removed task for ${taskName} and its upload task ${uploadTaskName} from tasks.json`);
				} else {
					APTaskProvider.log.log(`Removed task for ${taskName} from tasks.json`);
				}
			}, (error) => {
				APTaskProvider.log.log(`Error removing task from tasks.json: ${error}`);
				vscode.window.showErrorMessage(`Failed to remove task from tasks.json: ${error}`);
			});
		} else {
			APTaskProvider.log.log(`No task found for ${taskName}`);
		}
	}

	public async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		const taskDef = task.definition;
		if (taskDef) {
			// Full environment variables will be set when the task is actually executed
			return APTaskProvider.createTask(taskDef as ArdupilotTaskDefinition);
		}
		return undefined;
	}

}

export interface ArdupilotTaskDefinition extends vscode.TaskDefinition {
	/**
	 * custom configuration name
	 */
	configName: string;
	/**
	 * whether to override commands with custom ones
	 */
	overrideEnabled?: boolean;
	/**
	 * configure boardname (only used when override is false)
	 */
	configure?: string;
	/**
	 * target (only used when override is false)
	 */
	target?: string;
	/**
	 * target output binary
	 */
	target_output?: string;
	/**
	 * configure options (only used when override is false)
	 */
	configureOptions?: string;
    /**
     * build options (only used when override is false)
     */
    buildOptions?: string;
    /**
     * waf file
     */
    waffile?: string;
	/**
	 * nm command
	 */
	nm?: string;
	/**
	 * sim_vehicle.py command for SITL builds (only used when override is false)
	 */
	simVehicleCommand?: string;
	/**
	 * custom configure command (only used when override is true)
	 */
	customConfigureCommand?: string;
	/**
	 * custom build command (only used when override is true)
	 */
	customBuildCommand?: string;
	/**
	 * MCU target from hwdef.dat (e.g., "STM32H743xx")
	 */
	mcuTarget?: string;
	/**
	 * Flash size in KB from hwdef.dat
	 */
	flashSizeKB?: number;
	/**
	 * Tasks that this task depends on (for upload tasks depending on build tasks)
	 */
	dependsOn?: string[];
}

export async function getFeaturesList(extensionUri: vscode.Uri): Promise<Record<string, unknown>> {
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
	// use python tool from ProgramUtils
	const pythonInfo = await ProgramUtils.findProgram(TOOLS_REGISTRY.PYTHON);
	if (!pythonInfo.path) {
		throw new Error('Python tool not found');
	}
	const featureLoader = cp.spawnSync(pythonInfo.path, [featureLoaderPath, buildOptionsPath]);
	if (featureLoader.status !== 0) {
		throw new Error('featureLoader.py failed with exit code ' + featureLoader.status);
	}
	const features = JSON.parse(featureLoader.stdout.toString());
	return features;
}

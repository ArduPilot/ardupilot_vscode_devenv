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
import { apTerminalMonitor } from './apTerminalMonitor';
import { TOOLS_REGISTRY } from './apToolsConfig';

/**
 * Custom execution class for ArduPilot build tasks
 * Manages dedicated terminals and monitors output using terminal shell execution APIs
 */
class APCustomExecution extends vscode.CustomExecution {
	public static readonly TERMINAL_NAME_PREFIX = 'ArduPilot Build';
	private static log = new apLog('APCustomExecution');
	private terminalOutputDisposables: vscode.Disposable[] = [];

	constructor(
		private definition: ArdupilotTaskDefinition,
		private taskCommand: string,
		private buildDir: string,
		private env: { [key: string]: string }
	) {
		super(async (): Promise<vscode.Pseudoterminal> => {
			return new APBuildPseudoterminal(
				this.definition,
				this.taskCommand,
				this.buildDir,
				this.env
			);
		});
	}
}

/**
 * Pseudoterminal implementation for ArduPilot build tasks
 * Handles terminal creation, command execution, and output monitoring using apTerminalMonitor
 */
class APBuildPseudoterminal implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();
	private static log = new apLog('APBuildPseudoterminal');
	private terminalMonitor: apTerminalMonitor | undefined;

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	constructor(
		private definition: ArdupilotTaskDefinition,
		private taskCommand: string,
		private buildDir: string,
		private env: { [key: string]: string }
	) {}

	async open(): Promise<void> {
		this.writeEmitter.fire('Starting ArduPilot build task...\r\n');
		APBuildPseudoterminal.log.log(`Opening pseudoterminal for task: ${this.definition.configName}`);

		// Set up terminal monitoring with apTerminalMonitor
		this.setupTerminalMonitoring();
		if (!this.terminalMonitor) {
			this.writeEmitter.fire('Error: Terminal monitor could not be initialized.\r\n');
			return;
		}

		await this.terminalMonitor.createTerminal({
			env: this.env,
			cwd: this.buildDir
		}, true); // we dispose existing terminal and start again

		// Execute the build command
		this.executeBuildCommand();
	}

	close(): void {
		APBuildPseudoterminal.log.log(`Closing pseudoterminal for task: ${this.definition.configName}`);

		// Clean up terminal monitoring
		if (this.terminalMonitor) {
			this.terminalMonitor.dispose();
			this.terminalMonitor = undefined;
		}

		this.writeEmitter.fire('Build task completed.\r\n');
		this.closeEmitter.fire(0);
	}

	private setupTerminalMonitoring(): void {
		const terminalName = `${APCustomExecution.TERMINAL_NAME_PREFIX}: ${this.definition.configName}`;

		// Create terminal monitor instance
		this.terminalMonitor = new apTerminalMonitor(terminalName);

		// Set up text callback for real-time output
		this.terminalMonitor.addTextCallback((text) => {
			const trimmedOutput = text.trim();
			if (trimmedOutput) {
				// Write to pseudoterminal
				this.writeEmitter.fire(`${text}\r\n`);

				// Redirect to extension logger
				apLog.channel.appendLine(`[BUILD] ${trimmedOutput}`);
			}
		});

		APBuildPseudoterminal.log.log('Terminal monitoring setup completed with apTerminalMonitor');
	}

	private executeBuildCommand(): void {
		if (!this.terminalMonitor) {
			this.writeEmitter.fire('Error: No terminal or terminal monitor available for build execution\r\n');
			this.closeEmitter.fire(1);
			return;
		}

		if (!this.terminalMonitor) {
			this.writeEmitter.fire('Error: Terminal monitor was closed during initialization delay\r\n');
			this.closeEmitter.fire(1);
			return;
		}

		APBuildPseudoterminal.log.log(`Executing build command: ${this.taskCommand}`);
		this.writeEmitter.fire(`Executing: ${this.taskCommand}\r\n`);

		// Use the terminalMonitor.runCommand method for better command lifecycle tracking
		this.terminalMonitor.runCommand(this.taskCommand)
			.then(async exitCode => {
				APBuildPseudoterminal.log.log(`Shell execution ended with exit code: ${exitCode}`);
				this.writeEmitter.fire(`Build completed with exit code: ${exitCode}\r\n`);
				// Redirect completion info to extension logger
				apLog.channel.appendLine('[BUILD] ======== Build Completed ========');
				apLog.channel.appendLine(`[BUILD] Task: ${this.definition.configName}`);
				apLog.channel.appendLine(`[BUILD] Exit code: ${exitCode}`);
				apLog.channel.appendLine(`[BUILD] Status: ${exitCode === 0 ? 'SUCCESS ✅' : 'FAILED ❌'}`);
				apLog.channel.appendLine('[BUILD] ===================================');

				// Close the pseudoterminal with the actual exit code
				this.closeEmitter.fire(exitCode || 0);
			})
			.catch(error => {
				const errorMsg = error instanceof Error ? error.message : String(error);
				APBuildPseudoterminal.log.log(`Build command failed: ${errorMsg}`);
				this.writeEmitter.fire(`Error: ${errorMsg}\r\n`);
				this.closeEmitter.fire(1);
			});

		APBuildPseudoterminal.log.log('Build command initiated');

		// Log build start info immediately when command is initiated
		apLog.channel.appendLine('[BUILD] ======== Build Started ========');
		apLog.channel.appendLine(`[BUILD] Task: ${this.definition.configName}`);
		apLog.channel.appendLine(`[BUILD] Command: ${this.taskCommand}`);
		apLog.channel.appendLine(`[BUILD] Working Directory: ${this.buildDir}`);
		apLog.channel.appendLine('[BUILD] ================================');
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

		// Generate configure command with optional --python argument
		const configureCommand = `${waffile} configure --board=${board} ${configureOptions ? ' ' + configureOptions : ''}`;

		// Generate build command
		const buildCommand = `${waffile} ${target}${buildOptions ? ' ' + buildOptions : ''}`;

		// Generate task command (with cd prefix for task execution and optional venv activation)
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
	 * Prepares environment variables with optional CC and CXX paths
	 * Uses cached tool paths for synchronous operation
	 * @param includeToolPaths Whether to include CC and CXX environment variables
	 * @param definition The task definition to determine SITL vs non-SITL builds
	 * @returns Environment variables object
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

		// Use configName for task label
		const task_name = definition.configName;

		// Prepare environment variables - with or without CC/CXX paths
		const env = await this.prepareEnvironmentVariables(definition);

		// Generate commands using shared method or use custom commands
		let taskCommand: string;
		let buildDir: string;

		if (definition.overrideEnabled && definition.customConfigureCommand && definition.customBuildCommand) {
			// For override mode, use custom commands and a generic build directory
			taskCommand = `cd ../../ && ${definition.customConfigureCommand} && ${definition.customBuildCommand}`;
			buildDir = workspaceRoot.uri.fsPath; // Use workspace root as working directory
		} else {
			// For standard mode, use generated commands and board-specific build directory
			if (!definition.configure || !definition.target) {
				APTaskProvider.log.log('Missing configure or target for non-override task');
				return undefined;
			}

			if (definition.waffile === undefined) {
				// use the waf file from the workspace
				definition.waffile = workspaceRoot.uri.fsPath + '/waf';
			}
			if (definition.nm === undefined) {
				definition.nm = 'arm-none-eabi-nm';
			}

			buildDir = path.join(workspaceRoot.uri.fsPath, 'build', definition.configure);

			// make build directory if it doesn't exist
			if (!fs.existsSync(buildDir)) {
				try {
					fs.mkdirSync(buildDir, { recursive: true });
					APTaskProvider.log.log(`Created build directory: ${buildDir}`);
				} catch (error) {
					APTaskProvider.log.log(`Failed to create build directory: ${error}`);
					vscode.window.showErrorMessage(`Failed to create build directory: ${error}`);
					return undefined;
				}
			}

			const commands = this.generateBuildCommands(
				definition.configure,
				definition.target,
				definition.configureOptions || '',
				definition.buildOptions || '',
				workspaceRoot.uri.fsPath
			);
			taskCommand = commands.taskCommand;
		}

		return new vscode.Task(
			definition,
			vscode.TaskScope.Workspace,
			task_name,
			'ardupilot',
			new APCustomExecution(
				definition,
				taskCommand,
				buildDir,
				env
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

	public async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		const taskDef = task.definition;
		if (taskDef) {
			// Note: resolveTask cannot be async, so we return the task without CC/CXX environment variables
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

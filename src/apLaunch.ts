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
import * as vscode from 'vscode';
import { apLog } from './apLog';
import { ProgramUtils } from './apProgramUtils';
import { targetToBin } from './apBuildConfig';
import * as fs from 'fs';

// Map vehicle types to ArduPilot binary names
export const targetToVehicleType: { [key: string]: string } = {
	'copter': 'ArduCopter',
	'heli': 'Helicopter',
	'blimp': 'Blimp',
	'plane': 'ArduPlane',
	'rover': 'Rover',
	'sub': 'ArduSub',
	'antennatracker': 'AntennaTracker',
	'sitl_periph_universal': 'AP_Periph'
};

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
	private tmuxSessionName: string | undefined;
	private debugSessionTerminal: vscode.Terminal | undefined;

	constructor() {
		// Register a debug session termination listener
		vscode.debug.onDidTerminateDebugSession(this.handleDebugSessionTermination.bind(this));
	}

	private async handleDebugSessionTermination(session: vscode.DebugSession) {
		// Only handle termination of our own debug sessions (SITL)
		if (session.configuration.type === 'cppdbg' && this.tmuxSessionName && this.debugSessionTerminal) {
			APLaunchConfigurationProvider.log.log(`Debug session terminated, cleaning up tmux session: ${this.tmuxSessionName}`);

			// Find tmux path
			const tmux = await ProgramUtils.findTmux();
			const tmuxPath = tmux.available && tmux.path ? tmux.path : 'tmux';

			// Kill the tmux session
			// Create a separate terminal to kill the tmux session
			const cleanupTerminal = vscode.window.createTerminal('ArduPilot SITL Cleanup');
			cleanupTerminal.sendText(`"${tmuxPath}" kill-session -t "${this.tmuxSessionName}"`);
			cleanupTerminal.sendText('exit'); // Close the cleanup terminal when done

			// Close the debug session terminal as well
			this.debugSessionTerminal.dispose();

			// Reset the session tracking variables
			this.tmuxSessionName = undefined;
			this.debugSessionTerminal = undefined;
		}
	}

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
			if (config.isSITL) {
				// For SITL builds
				const simVehiclePath = path.join(workspaceRoot, 'Tools', 'autotest', 'sim_vehicle.py');

				// Extract vehicle type from target (e.g., 'copter' from 'sitl-copter')
				const vehicleBaseType = apConfig.target.replace('sitl-', '');

				// Get ArduPilot vehicle name for sim_vehicle.py -v argument (e.g., 'ArduCopter')
				let vehicleType = targetToVehicleType[vehicleBaseType] || vehicleBaseType;

				// Special handling for helicopter - use ArduCopter with -f heli
				let additionalArgs = '';
				if (vehicleBaseType === 'heli') {
					vehicleType = 'ArduCopter';
					// Only add -f heli if not already in the user's command
					const userCommand = apConfig.simVehicleCommand || '';
					if (!userCommand.includes('-f ')) {
						additionalArgs = '-f heli';
					}
				}
				// Check if GDB is available
				const gdb = await ProgramUtils.findGDB();
				if (!gdb.available) {
					vscode.window.showErrorMessage('GDB not found. Please install GDB to debug SITL.');
					return undefined;
				}

				// Check if tmux is available
				const tmux = await ProgramUtils.findTmux();
				if (!tmux.available || !tmux.path) {
					vscode.window.showErrorMessage('tmux not found. Please install tmux to debug SITL.');
					return undefined;
				}

				// Find the binary path for the vehicle (use base type for targetToBin lookup)
				const binaryPath = path.join(workspaceRoot, 'build', 'sitl', targetToBin[vehicleBaseType]);
				APLaunchConfigurationProvider.log.log(`Debug binary path: ${binaryPath}`);

				// Generate a unique port for gdbserver (between 3000-4000)
				const gdbPort = 3000 + Math.floor(Math.random() * 1000);

				// check if run_in_terminal_window.sh contains TMUX_PREFIX
				if (!fs.existsSync(path.join(workspaceRoot, 'Tools', 'autotest', 'run_in_terminal_window.sh'))) {
					vscode.window.showErrorMessage('run_in_terminal_window.sh not found. Please clone ArduPilot to debug SITL.');
					return undefined;
				} else {
					// check file contains TMUX_PREFIX
					const fileContent = fs.readFileSync(path.join(workspaceRoot, 'Tools', 'autotest', 'run_in_terminal_window.sh'), 'utf8');
					if (!fileContent.includes('TMUX_PREFIX')) {
						// if it doesn't contain TMUX_PREFIX, replace it with run_in_terminal_window.sh from resources, do backup of existing file
						const backupPath = path.join(workspaceRoot, 'Tools', 'autotest', 'run_in_terminal_window.sh.bak');
						if (!fs.existsSync(backupPath)) {
							// backup the existing file
							fs.copyFileSync(path.join(workspaceRoot, 'Tools', 'autotest', 'run_in_terminal_window.sh'), backupPath);
						}
						const runInTerminalWindowPath = path.join(__dirname, '..', 'resources', 'run_in_terminal_window.sh');
						if (fs.existsSync(runInTerminalWindowPath)) {
							// write the data to the file
							fs.writeFileSync(path.join(workspaceRoot, 'Tools', 'autotest', 'run_in_terminal_window.sh'), fs.readFileSync(runInTerminalWindowPath));
						}
					}
				}

				// Generate a unique tmux session name
				this.tmuxSessionName = `ardupilot_sitl_${vehicleType}_${Date.now()}`;

				// Set up the environment to use gdbserver through TMUX_PREFIX
				const tmuxPath = tmux.path; // Use the discovered tmux path
				const tmuxCommand = `"${tmuxPath}" new-session -s "${this.tmuxSessionName}" -n "SimVehicle"`;
				const simVehicleCmd = `export TMUX_PREFIX="gdbserver localhost:${gdbPort}" && python3 ${simVehiclePath} --no-rebuild -v ${vehicleType} ${additionalArgs} ${apConfig.simVehicleCommand || ''}`;
				APLaunchConfigurationProvider.log.log(`Running SITL simulation with debug: ${simVehicleCmd}`);

				// Start the SITL simulation in a terminal and store the terminal reference
				this.debugSessionTerminal = vscode.window.createTerminal('ArduPilot SITL');
				this.debugSessionTerminal.sendText(`cd ${workspaceRoot}`);
				// Check if tmux session already exists before creating it
				this.debugSessionTerminal.sendText(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`);
				this.debugSessionTerminal.sendText('sleep 1'); // Give tmux a moment to start
				this.debugSessionTerminal.sendText(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`);
				this.debugSessionTerminal.sendText(`"${tmuxPath}" set mouse on`);
				this.debugSessionTerminal.sendText(simVehicleCmd);

				this.debugSessionTerminal.show();

				// Create a debug configuration for the C++ debugger
				const cppDebugConfig = {
					type: 'cppdbg',
					request: 'launch',
					name: `Debug ${vehicleType} SITL`,
					miDebuggerServerAddress: `localhost:${gdbPort}`,
					program: binaryPath,
					args: [],
					stopAtEntry: false,
					cwd: workspaceRoot,
					environment: [],
					externalConsole: false,
					MIMode: 'gdb',
					miDebuggerPath: gdb.path,
					setupCommands: [
						{
							description: 'Enable pretty-printing for gdb',
							text: '-enable-pretty-printing',
							ignoreFailures: true
						},
						{
							description: 'Set Disassembly Flavor to Intel',
							text: '-gdb-set disassembly-flavor intel',
							ignoreFailures: true
						}
					]
				};
				// Start the C++ debugger
				APLaunchConfigurationProvider.log.log('Starting C++ debugger session');
				return cppDebugConfig;
			} else {
				// For physical board builds, run the upload command
				const terminal = vscode.window.createTerminal('ArduPilot Upload');
				terminal.sendText(`cd ${workspaceRoot}`);

				const uploadCommand = `python3 ${apConfig.waffile} ${apConfig.target} --upload`;
				APLaunchConfigurationProvider.log.log(`Running upload command: ${uploadCommand}`);

				terminal.sendText(uploadCommand);
				terminal.show();
			}

			// If we're here and we're not debugging, return undefined
			// to prevent VS Code from trying to start a debug session
			return undefined;
		} catch (error) {
			vscode.window.showErrorMessage(`Error in APLaunch: ${error}`);
			return undefined;
		}
	}
}

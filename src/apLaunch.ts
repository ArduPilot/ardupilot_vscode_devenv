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
import * as os from 'os';
import * as vscode from 'vscode';
import { spawn, spawnSync } from 'child_process';
import { apLog } from './apLog';
import { ProgramUtils } from './apProgramUtils';
import { targetToBin } from './apBuildConfig';
import { TOOLS_REGISTRY } from './apToolsConfig';
import { apTerminalMonitor } from './apTerminalMonitor';
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
	private static activeSessions: Set<string> = new Set();
	private tmuxSessionName: string | undefined;
	private debugSessionTerminal: apTerminalMonitor | undefined;
	private workspaceFolder: vscode.WorkspaceFolder;
	private simVehicleCommand: string | null = null; // The exact sim_vehicle.py command executed

	constructor(workspaceFolder: vscode.WorkspaceFolder) {
		this.workspaceFolder = workspaceFolder;
		// Register a debug session termination listener
		vscode.debug.onDidTerminateDebugSession(this.handleDebugSessionTermination.bind(this));
	}

	/*
	 * Find sim_vehicle.py process PID using shell command
	 * @param simVehicleCommand - The exact sim_vehicle.py command that was executed
	 * @returns PID of the sim_vehicle.py process or null if not found
	 */
	private findSimVehicleProcess(simVehicleCommand: string): number | null {
		try {
			APLaunchConfigurationProvider.log.log('DEBUG: Searching for sim_vehicle.py processes');
			APLaunchConfigurationProvider.log.log(`DEBUG: Target command: ${simVehicleCommand}`);

			// First, get all sim_vehicle.py process PIDs
			const pgrepResult = spawnSync('pgrep', ['-f', 'sim_vehicle.py'], { encoding: 'utf8' });

			if (pgrepResult.status !== 0) {
				APLaunchConfigurationProvider.log.log('DEBUG: No sim_vehicle.py processes found');
				return null;
			}

			const pids = pgrepResult.stdout.trim().split('\n').filter(line => line.trim() !== '');
			if (pids.length === 0) {
				APLaunchConfigurationProvider.log.log('DEBUG: No sim_vehicle.py process PIDs found');
				return null;
			}

			APLaunchConfigurationProvider.log.log(`DEBUG: Found ${pids.length} sim_vehicle.py processes: ${pids.join(', ')}`);

			// Now check each PID to find the one with our exact command
			for (const pidStr of pids) {
				const pid = parseInt(pidStr, 10);
				if (isNaN(pid)) continue;

				// Get the full command line for this PID
				const psResult = spawnSync('ps', ['-p', pid.toString(), '-o', 'args='], { encoding: 'utf8' });

				if (psResult.status === 0 && psResult.stdout) {
					const processCommand = psResult.stdout.trim();
					APLaunchConfigurationProvider.log.log(`DEBUG: PID ${pid} command: ${processCommand}`);

					// Check if this matches our target command
					if (this.isCommandMatch(processCommand, simVehicleCommand)) {
						APLaunchConfigurationProvider.log.log(`DEBUG: Found matching sim_vehicle.py process with PID: ${pid}`);
						return pid;
					}
				}
			}

			APLaunchConfigurationProvider.log.log('DEBUG: No matching sim_vehicle.py process found for our command');
			return null;
		} catch (error) {
			APLaunchConfigurationProvider.log.log(`DEBUG: Error finding sim_vehicle.py process: ${error}`);
			return null;
		}
	}

	/*
	 * Check if the running command matches our expected command
	 * @param processCommand - Command line from ps output
	 * @param expectedCommand - Command we originally executed
	 * @returns true if commands match, false otherwise
	 */
	private isCommandMatch(processCommand: string, expectedCommand: string): boolean {
		// Normalize commands for comparison (remove extra whitespace)
		const normalizeCmd = (cmd: string) => cmd.trim().replace(/\s+/g, ' ');
		const normalizedProcess = normalizeCmd(processCommand);
		const normalizedExpected = normalizeCmd(expectedCommand);

		// Check if the process command contains the key parts of our expected command
		// We look for sim_vehicle.py and the main arguments
		return normalizedProcess.includes('sim_vehicle.py') &&
			normalizedProcess.includes(normalizedExpected.replace(/^.*sim_vehicle\.py\s+/, ''));
	}

	/*
	 * Send graceful shutdown signal to sim_vehicle.py process
	 * @param pid - Process ID of sim_vehicle.py
	 * @returns true if signal was sent successfully, false otherwise
	 */
	private sendGracefulShutdownSignal(pid: number): boolean {
		try {
			APLaunchConfigurationProvider.log.log(`DEBUG: Sending SIGTERM to sim_vehicle.py process ${pid}`);

			// Send SIGINT signal for graceful shutdown
			const result = spawnSync('kill', ['-INT', pid.toString()]);

			if (result.status === 0) {
				APLaunchConfigurationProvider.log.log(`DEBUG: Successfully sent SIGINT to process ${pid}`);
				return true;
			} else {
				APLaunchConfigurationProvider.log.log(`DEBUG: Failed to send SIGINT to process ${pid} (exit code: ${result.status})`);
				return false;
			}
		} catch (error) {
			APLaunchConfigurationProvider.log.log(`DEBUG: Error sending signal to process ${pid}: ${error}`);
			return false;
		}
	}

	/*
	 * Find ArduPilot process PID directly from tmux panes by command name
	 * @param sessionName - Name of the tmux session to search in
	 * @param binaryName - Name of the ArduPilot binary to find (e.g., 'arduplane')
	 * @returns PID of the ArduPilot process or null if not found
	 */
	private async findArduPilotProcessInTmux(sessionName: string, binaryName: string): Promise<number | null> {
		const tmux = await ProgramUtils.findProgram(TOOLS_REGISTRY.TMUX);
		if (!tmux.available || !tmux.path) {
			throw new Error('tmux not found');
		}

		return new Promise((resolve, reject) => {
			if (!tmux.path) {
				reject(new Error('tmux path is undefined'));
				return;
			}

			// List all panes across all windows in the specific session
			const args = ['list-panes', '-t', sessionName, '-a', '-F', '#{session_name}:#{window_index}.#{pane_index} #{pane_pid} #{pane_current_command}'];

			const tmuxProcess = spawn(tmux.path, args);
			APLaunchConfigurationProvider.log.log(`DEBUG: Searching for ${binaryName} in tmux session: ${sessionName}`);

			let output = '';
			tmuxProcess.stdout?.on('data', (data: Buffer) => {
				output += data.toString();
			});

			tmuxProcess.on('close', (code: number | null) => {
				if (code !== 0) {
					APLaunchConfigurationProvider.log.log(`DEBUG: tmux list-panes failed with exit code ${code} for session ${sessionName}`);
					resolve(null);
					return;
				}

				const lines = output.trim().split('\n').filter(line => line.trim() !== '');
				APLaunchConfigurationProvider.log.log(`DEBUG: tmux panes output for session ${sessionName}:\n${lines.join('\n')}`);

				// Parse each line: "session:window.pane pid command"
				for (const line of lines) {
					const parts = line.trim().split(' ');
					if (parts.length >= 3) {
						const paneInfo = parts[0]; // session:window.pane
						const pidStr = parts[1];
						const command = parts.slice(2).join(' '); // Join remaining parts as command might have spaces

						const pid = parseInt(pidStr, 10);
						if (!isNaN(pid)) {
							APLaunchConfigurationProvider.log.log(`DEBUG: Found pane ${paneInfo}: PID ${pid}, command '${command}'`);

							// Check if the command matches our binary name (case-insensitive)
							if (command.toLowerCase().includes(binaryName.toLowerCase())) {
								APLaunchConfigurationProvider.log.log(`DEBUG: Found ${binaryName} process: PID ${pid} in pane ${paneInfo}`);
								resolve(pid);
								return;
							}
						}
					}
				}

				APLaunchConfigurationProvider.log.log(`DEBUG: ${binaryName} process not found in tmux session ${sessionName}`);
				resolve(null);
			});

			tmuxProcess.on('error', (error: Error) => {
				APLaunchConfigurationProvider.log.log(`DEBUG: Error running tmux list-panes for session ${sessionName}: ${error}`);
				reject(error);
			});
		});
	}

	/*
	 * Wait for ArduPilot process to start in tmux session
	 * @param sessionName - Name of the tmux session
	 * @param binaryName - Name of the ArduPilot binary (e.g., 'arduplane')
	 * @param timeoutMs - Maximum time to wait in milliseconds
	 * @returns PID of the ArduPilot process
	 */
	private async waitForProcessStart(sessionName: string, binaryName: string, timeoutMs: number = 30000): Promise<number> {
		const startTime = Date.now();
		const pollInterval = 1000; // Poll every 1 second

		APLaunchConfigurationProvider.log.log(`DEBUG: Waiting for ${binaryName} process to start in tmux session ${sessionName}`);

		while (Date.now() - startTime < timeoutMs) {
			try {
				// Look for ArduPilot process directly in tmux panes
				const arduPilotPid = await this.findArduPilotProcessInTmux(sessionName, binaryName);
				if (arduPilotPid !== null) {
					APLaunchConfigurationProvider.log.log(`DEBUG: Found ${binaryName} process with PID: ${arduPilotPid}`);

					// Give the process additional time to fully initialize before considering it "ready"
					APLaunchConfigurationProvider.log.log(`DEBUG: Allowing ${binaryName} process to stabilize for 3 seconds...`);
					await new Promise(resolve => setTimeout(resolve, 3000));

					// Verify process is still running after the wait
					const processStillExists = await this.verifyProcessExists(arduPilotPid);
					if (!processStillExists) {
						APLaunchConfigurationProvider.log.log(`DEBUG: ${binaryName} process ${arduPilotPid} terminated during stabilization wait`);
						// Continue polling instead of returning - the process might restart
						continue;
					}

					APLaunchConfigurationProvider.log.log(`DEBUG: ${binaryName} process ${arduPilotPid} is stable and ready for debugging`);
					return arduPilotPid;
				}

				APLaunchConfigurationProvider.log.log(`DEBUG: ${binaryName} process not found yet, continuing to poll...`);
			} catch (error) {
				APLaunchConfigurationProvider.log.log(`DEBUG: Error while polling for process: ${error}`);
			}

			// Wait before next poll
			await new Promise(resolve => setTimeout(resolve, pollInterval));
		}

		throw new Error(`Timeout waiting for ${binaryName} process to start after ${timeoutMs}ms`);
	}

	/*
	 * Verify that a process with the given PID still exists
	 * @param pid - Process ID to check
	 * @returns Promise<boolean> - true if process exists, false otherwise
	 */
	private async verifyProcessExists(pid: number): Promise<boolean> {
		return new Promise((resolve) => {
			const psProcess = spawn('ps', ['-p', pid.toString()]);

			psProcess.on('close', (code: number | null) => {
				// ps returns 0 if process exists, 1 if it doesn't
				resolve(code === 0);
			});

			psProcess.on('error', () => {
				resolve(false);
			});
		});
	}

	/*
	 * Register a tmux session to track for cleanup
	 * @param sessionName - Name of the tmux session to register
	 */
	private static registerSession(sessionName: string): void {
		APLaunchConfigurationProvider.activeSessions.add(sessionName);
		APLaunchConfigurationProvider.log.log(`DEBUG: Registered tmux session: ${sessionName}`);
	}

	/*
	 * Unregister a tmux session from tracking
	 * @param sessionName - Name of the tmux session to unregister
	 */
	private static unregisterSession(sessionName: string): void {
		APLaunchConfigurationProvider.activeSessions.delete(sessionName);
		APLaunchConfigurationProvider.log.log(`DEBUG: Unregistered tmux session: ${sessionName}`);
	}

	/*
	 * Clean up all tracked tmux sessions
	 * This method is called during extension deactivation
	 */
	public static async cleanupAllSessions(): Promise<void> {
		APLaunchConfigurationProvider.log.log(`DEBUG: Cleaning up ${APLaunchConfigurationProvider.activeSessions.size} tracked tmux sessions`);

		if (APLaunchConfigurationProvider.activeSessions.size === 0) {
			return;
		}

		const tmux = await ProgramUtils.findProgram(TOOLS_REGISTRY.TMUX);
		if (!tmux.available || !tmux.path) {
			APLaunchConfigurationProvider.log.log('DEBUG: tmux not available for cleanup');
			return;
		}

		const sessionsToCleanup = Array.from(APLaunchConfigurationProvider.activeSessions);
		APLaunchConfigurationProvider.log.log(`DEBUG: Attempting to kill sessions: ${sessionsToCleanup.join(', ')}`);

		const cleanupPromises = sessionsToCleanup.map(sessionName => {
			if (tmux.path) {
				return APLaunchConfigurationProvider.killSpecificSession(tmux.path, sessionName);
			}
			return Promise.resolve();
		});

		await Promise.allSettled(cleanupPromises);
		APLaunchConfigurationProvider.activeSessions.clear();
		APLaunchConfigurationProvider.log.log('DEBUG: Session cleanup completed');
	}

	/*
	 * Kill a specific tmux session
	 * @param tmuxPath - Path to the tmux executable
	 * @param sessionName - Name of the session to kill
	 */
	private static async killSpecificSession(tmuxPath: string, sessionName: string): Promise<void> {
		return new Promise((resolve) => {
			const killProcess = spawn(tmuxPath, ['kill-session', '-t', sessionName]);

			killProcess.on('close', (code: number | null) => {
				if (code === 0) {
					APLaunchConfigurationProvider.log.log(`DEBUG: Successfully killed tmux session: ${sessionName}`);
				} else {
					APLaunchConfigurationProvider.log.log(`DEBUG: Failed to kill tmux session: ${sessionName} (exit code: ${code})`);
				}
				resolve();
			});

			killProcess.on('error', (error: Error) => {
				APLaunchConfigurationProvider.log.log(`DEBUG: Error killing tmux session ${sessionName}: ${error}`);
				resolve();
			});
		});
	}

	private async handleDebugSessionTermination(session: vscode.DebugSession) {
		// Only handle termination of our own debug sessions (SITL) - both cppdbg (Linux) and lldb (macOS)
		if ((session.configuration.type === 'cppdbg' || session.configuration.type === 'lldb') && this.tmuxSessionName && this.debugSessionTerminal) {
			APLaunchConfigurationProvider.log.log(`DEBUG: Debug session terminated for type '${session.configuration.type}', cleaning up tmux session: ${this.tmuxSessionName}`);
			APLaunchConfigurationProvider.log.log(`DEBUG: Debug session configuration: ${JSON.stringify(session.configuration, null, 2)}`);

			// try gracefully closing sim_vehicle.py by sending Ctrl+C 2 times
			for (let i = 0; i < 2; i++) {
				this.debugSessionTerminal?.sendInterruptSignal();
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			// Try to find and gracefully shutdown sim_vehicle.py process
			if (this.simVehicleCommand) {
				const simVehiclePid = this.findSimVehicleProcess(this.simVehicleCommand);
				if (simVehiclePid) {
					APLaunchConfigurationProvider.log.log(`DEBUG: sim_vehicle.py process ${simVehiclePid} is still running`);
					vscode.window.showErrorMessage('Failed to shut down sim_vehicle.py gracefully, try killing the process manually.');
					return;
				}
			}
			// force dispose
			await this.debugSessionTerminal?.dispose(true);

			const tmux = await ProgramUtils.findProgram(TOOLS_REGISTRY.TMUX);
			if (tmux.path) {
				// Kill the tmux session
				await APLaunchConfigurationProvider.killSpecificSession(tmux.path, this.tmuxSessionName);
			}

			// Reset the session tracking variables
			this.tmuxSessionName = undefined;
			this.debugSessionTerminal = undefined;
			this.simVehicleCommand = null;
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
				// Check if tmux is available
				const tmux = await ProgramUtils.findProgram(TOOLS_REGISTRY.TMUX);
				if (!tmux.available || !tmux.path) {
					vscode.window.showErrorMessage('tmux not found. Please install tmux to debug SITL.');
					return undefined;
				}

				// Find the binary path for the vehicle (use base type for targetToBin lookup)
				const binaryPath = path.join(workspaceRoot, 'build', 'sitl', targetToBin[vehicleBaseType]);
				APLaunchConfigurationProvider.log.log(`Debug binary path: ${binaryPath}`);

				// Generate a unique tmux session name
				this.tmuxSessionName = `ardupilot_sitl_${vehicleType}_${Date.now()}`;

				// Register the session for cleanup tracking
				APLaunchConfigurationProvider.registerSession(this.tmuxSessionName);

				// Platform-specific debugging setup
				const isMacOS = os.platform() === 'darwin';
				APLaunchConfigurationProvider.log.log(`DEBUG: Platform detected: ${os.platform()} (macOS: ${isMacOS})`);

				if (isMacOS) {
					// macOS: Use CodeLLDB with PID attachment
					APLaunchConfigurationProvider.log.log('DEBUG: Setting up macOS debugging with CodeLLDB');

					// Check if CodeLLDB extension is installed
					const codelldbExtension = vscode.extensions.getExtension('vadimcn.vscode-lldb');
					if (!codelldbExtension) {
						const message = 'CodeLLDB extension is required for debugging on macOS. Would you like to install it?';
						const installButton = 'Install CodeLLDB';
						const cancelButton = 'Cancel';

						const choice = await vscode.window.showErrorMessage(message, installButton, cancelButton);
						if (choice === installButton) {
							// Open the extension in the marketplace
							await vscode.commands.executeCommand('workbench.extensions.search', 'vadimcn.vscode-lldb');
						}
						return undefined;
					}

					// Check if CodeLLDB extension is activated
					if (!codelldbExtension.isActive) {
						try {
							APLaunchConfigurationProvider.log.log('DEBUG: Activating CodeLLDB extension...');
							await codelldbExtension.activate();
							APLaunchConfigurationProvider.log.log('DEBUG: CodeLLDB extension activated successfully');
						} catch (error) {
							APLaunchConfigurationProvider.log.log(`DEBUG: Failed to activate CodeLLDB extension: ${error}`);
							vscode.window.showErrorMessage(`Failed to activate CodeLLDB extension: ${error}`);
							return undefined;
						}
					} else {
						APLaunchConfigurationProvider.log.log('DEBUG: CodeLLDB extension already active');
					}

					const tmuxPath = tmux.path;
					const tmuxCommand = `"${tmuxPath}" new-session -s "${this.tmuxSessionName}" -n "SimVehicle"`;
					const simVehicleCmd = `${await ProgramUtils.PYTHON()} ${simVehiclePath} --no-rebuild -v ${vehicleType} ${additionalArgs} ${apConfig.simVehicleCommand || ''}`;
					this.simVehicleCommand = simVehicleCmd; // Store the command for cleanup
					APLaunchConfigurationProvider.log.log(`DEBUG: Running SITL simulation: ${simVehicleCmd}`);

					// Start the SITL simulation in a terminal using apTerminalMonitor
					this.debugSessionTerminal = new apTerminalMonitor('ArduPilot SITL');
					await this.debugSessionTerminal.runCommand(`cd ${workspaceRoot}`);
					// we push following commands back to back without waiting, as most of them will run till debugging is over.
					this.debugSessionTerminal.runCommand(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to create tmux session: ${error}`);
					});
					await new Promise(resolve => setTimeout(resolve, 1000)); // Give tmux a moment to start
					this.debugSessionTerminal.runCommand(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to create tmux session: ${error}`);
					});
					this.debugSessionTerminal.runCommand(`"${tmuxPath}" set mouse on`).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to set mouse on: ${error}`);
					});
					this.debugSessionTerminal.runCommand(simVehicleCmd).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to start SITL simulation: ${error}`);
					}); // we don't await here as this is the main command that will start the simulation

					// Wait for ArduPilot process to start and get its PID
					try {
						const binaryName = path.basename(binaryPath);
						APLaunchConfigurationProvider.log.log(`DEBUG: Waiting for ${binaryName} process to start...`);
						const arduPilotPid = await this.waitForProcessStart(this.tmuxSessionName, binaryName, 60000); // 60 second timeout

						// Create CodeLLDB debug configuration
						const lldbDebugConfig = {
							type: 'lldb',
							request: 'attach',
							name: `Debug ${vehicleType} SITL`,
							program: binaryPath,
							pid: arduPilotPid,
							waitFor: false,
							stopOnEntry: false,
							initCommands: [
								'setting set target.max-string-summary-length 10000'
							]
						};

						APLaunchConfigurationProvider.log.log(`DEBUG: Starting CodeLLDB debugger session with PID ${arduPilotPid}`);
						APLaunchConfigurationProvider.log.log(`DEBUG: CodeLLDB config: ${JSON.stringify(lldbDebugConfig, null, 2)}`);
						return lldbDebugConfig;
					} catch (error) {
						vscode.window.showErrorMessage(`Failed to find ArduPilot process for debugging: ${error}`);
						return undefined;
					}
				} else {
					// Linux: Use existing gdbserver + cppdbg approach
					APLaunchConfigurationProvider.log.log('DEBUG: Setting up Linux debugging with gdbserver + cppdbg');

					// Check if GDB is available
					const gdb = await ProgramUtils.findProgram(TOOLS_REGISTRY.GDB);
					if (!gdb.available) {
						vscode.window.showErrorMessage('GDB not found. Please install GDB to debug SITL.');
						return undefined;
					}

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

					// Set up the environment to use gdbserver through TMUX_PREFIX
					const tmuxPath = tmux.path;
					const tmuxCommand = `"${tmuxPath}" new-session -s "${this.tmuxSessionName}" -n "SimVehicle"`;
					const simVehicleCmd = `export TMUX_PREFIX="gdbserver localhost:${gdbPort}" && ${await ProgramUtils.PYTHON()} ${simVehiclePath} --no-rebuild -v ${vehicleType} ${additionalArgs} ${apConfig.simVehicleCommand || ''}`;
					this.simVehicleCommand = simVehicleCmd; // Store the command for cleanup
					APLaunchConfigurationProvider.log.log(`DEBUG: Running SITL simulation with gdbserver: ${simVehicleCmd}`);

					// Start the SITL simulation in a terminal using apTerminalMonitor
					this.debugSessionTerminal = new apTerminalMonitor('ArduPilot SITL');
					await this.debugSessionTerminal.createTerminal();
					await this.debugSessionTerminal.runCommand(`cd ${workspaceRoot}`);
					// we push following commands back to back without waiting, as most of them will run till debugging is over.
					// Check if tmux session already exists before creating it
					this.debugSessionTerminal.runCommand(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`, { nonblocking: true }).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to create tmux session: ${error}`);
					});
					await new Promise(resolve => setTimeout(resolve, 1000)); // Give tmux a moment to start
					this.debugSessionTerminal.runCommand(`if ! "${tmuxPath}" has-session -t "${this.tmuxSessionName}" 2>/dev/null; then ${tmuxCommand}; fi`, { nonblocking: true }).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to create tmux session: ${error}`);
					});
					this.debugSessionTerminal.runCommand(`"${tmuxPath}" set mouse on`).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to set mouse on: ${error}`);
					});
					this.debugSessionTerminal.runCommand(simVehicleCmd).catch(error => {
						APLaunchConfigurationProvider.log.log(`Failed to start SITL simulation: ${error}`);
					}); // we don't await here as this is the main command that will start the simulation

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
					APLaunchConfigurationProvider.log.log('DEBUG: Starting cppdbg debugger session');
					return cppDebugConfig;
				}
			} else {
				// For physical board builds, run the upload command
				this.debugSessionTerminal = new apTerminalMonitor('ArduPilot Upload');
				await this.debugSessionTerminal.createTerminal();
				await this.debugSessionTerminal.runCommand(`cd ${workspaceRoot}`);

				const uploadCommand = `${await ProgramUtils.PYTHON()} ${apConfig.waffile} ${apConfig.target} --upload`;
				APLaunchConfigurationProvider.log.log(`Running upload command: ${uploadCommand}`);

				this.debugSessionTerminal.runCommand(uploadCommand).catch(error => {
					APLaunchConfigurationProvider.log.log(`Failed to run upload command: ${error}`);
				});
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

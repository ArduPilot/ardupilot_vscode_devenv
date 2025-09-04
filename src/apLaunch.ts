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
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { apLog } from './apLog';
import { ProgramUtils } from './apProgramUtils';
import { targetToBin } from './apBuildConfig';
import { TOOLS_REGISTRY } from './apToolsConfig';
import { apTerminalMonitor } from './apTerminalMonitor';
import * as fs from 'fs';
import { readHwdefFile, getDebugConfigFromMCU, HwdefInfo, DebugConfig } from './apBuildConfig';

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
	/**
	 * board name for hardware debugging
	 */
	board?: string;
}

/*
 * Debug Server pseudoterminal implementation for VS Code
 * Can be used for both JLink GDB Server and OpenOCD
 */
class DebugServerPseudoterminal implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number | void>();
	private process: ChildProcess | undefined;
	private dimensions: vscode.TerminalDimensions | undefined;
	private outputBuffer: string = '';
	private waitForTextPromise: Promise<boolean> | undefined;
	private waitForTextResolve: ((value: boolean) => void) | undefined;

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

	constructor(private serverName: string, private command: string, private args: string[], private waitForText?: string) {
		this.outputBuffer = '';
	}

	open(initialDimensions: vscode.TerminalDimensions | undefined): void {
		this.dimensions = initialDimensions;
		this.writeEmitter.fire(`Starting ${this.serverName}...\r\n`);
		this.writeEmitter.fire(`Command: ${this.command} ${this.args.join(' ')}\r\n\r\n`);

		// Set up environment with proper terminal settings
		const env = {
			...process.env,
			TERM: 'xterm-256color',
			COLUMNS: this.dimensions?.columns?.toString() || '80',
			LINES: this.dimensions?.rows?.toString() || '24'
		};

		this.process = spawn(`"${this.command}"`, this.args, {
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true
		});

		if (this.process.stdout) {
			this.process.stdout.on('data', (data) => {
				// Convert output to proper terminal format
				const output = data.toString().replace(/\n/g, '\r\n');
				this.writeEmitter.fire(output);
				this.handleOutput(data.toString());
			});
		}

		if (this.process.stderr) {
			this.process.stderr.on('data', (data) => {
				// Convert output to proper terminal format
				const output = data.toString().replace(/\n/g, '\r\n');
				this.writeEmitter.fire(output);
				this.handleOutput(data.toString());
			});
		}

		this.process.on('exit', (code) => {
			this.writeEmitter.fire(`\r\n${this.serverName} exited with code: ${code}\r\n`);
			if (code === 0) {
				// Only close terminal on successful exit
				this.closeEmitter.fire(code);
			} else {
				// Keep terminal open on error for debugging
				this.writeEmitter.fire('\r\nTerminal kept open for debugging. Press Ctrl+C or close manually.\r\n');
			}
		});

		this.process.on('error', (error) => {
			this.writeEmitter.fire(`\r\n${this.serverName} error: ${error.message}\r\n`);
			this.writeEmitter.fire('\r\nTerminal kept open for debugging. Press Ctrl+C or close manually.\r\n');
			// Don't close terminal on error - keep it open for debugging
		});

	}

	private handleOutput(data: string): void {
		this.outputBuffer += data;

		// Check if we're waiting for specific text and it appears in the output
		if (this.waitForText && this.waitForTextResolve && this.outputBuffer.includes(this.waitForText)) {
			this.waitForTextResolve(true);
			this.waitForTextResolve = undefined;
			this.waitForTextPromise = undefined;
		}
	}

	public waitForTextInOutput(timeoutMs: number = 10000): Promise<boolean> {
		if (!this.waitForText) {
			return Promise.resolve(true);
		}

		// If text already found in buffer, resolve immediately
		if (this.outputBuffer.includes(this.waitForText)) {
			return Promise.resolve(true);
		}

		// Create promise to wait for the text
		this.waitForTextPromise = new Promise((resolve) => {
			this.waitForTextResolve = resolve;
		});

		// Set timeout to resolve with false if text not found
		setTimeout(() => {
			if (this.waitForTextResolve) {
				this.waitForTextResolve(false);
				this.waitForTextResolve = undefined;
				this.waitForTextPromise = undefined;
			}
		}, timeoutMs);

		return this.waitForTextPromise;
	}

	close(): void {
		if (this.process) {
			this.process.kill('SIGTERM');
		}
	}
}

export class APLaunchConfigurationProvider implements vscode.DebugConfigurationProvider {
	private static log = new apLog('APLaunchConfigurationProvider');
	private static activeSessions: Set<string> = new Set();
	private tmuxSessionName: string | undefined;
	private debugSessionTerminal: apTerminalMonitor | undefined;
	private simVehicleCommand: string | null = null; // The exact sim_vehicle.py command executed
	private debugServerTerminal: vscode.Terminal | undefined; // For JLink/OpenOCD pseudoterminal
	private extensionUri: vscode.Uri;
	private attachedDebug: boolean = false;

	constructor(private _extensionUri: vscode.Uri) {
		this.extensionUri = _extensionUri;
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
	 * Find ArduPilot process PID by binary path/name
	 * @param binaryPath - Full path to the ArduPilot binary
	 * @returns PID of the ArduPilot process or null if not found
	 */
	private findArduPilotProcessByBinary(binaryPath: string): { pid: number; etime?: string; cmd: string }[] | null {
		try {
			// Build a list of running ArduPilot PIDs and let user choose
			const binaryName = path.basename(binaryPath);
			let pidList: number[] = [];
			try {
				const pgrepResult = spawnSync('pgrep', ['-f', binaryName], { encoding: 'utf8' });
				if (pgrepResult.status === 0 && pgrepResult.stdout) {
					pidList = pgrepResult.stdout.trim().split('\n').filter(l => l.trim() !== '').map(l => parseInt(l, 10)).filter(n => !isNaN(n));
				}
			} catch { /* ignore */ }

			const candidates: { pid: number; etime?: string; cmd: string }[] = [];
			for (const pid of pidList) {
				const ps = spawnSync('ps', ['-p', pid.toString(), '-o', 'pid=,etime=,args='], { encoding: 'utf8' });
				if (ps.status === 0 && ps.stdout) {
					const line = ps.stdout.trim();
					const parts = line.split(/\s+/, 3);
					const pidNum = parseInt(parts[0], 10);
					const etime = parts[1];
					const cmd = parts.slice(2).join(' ');
					if (!isNaN(pidNum) && (cmd.includes(binaryName) || cmd.includes(binaryPath))) {
						candidates.push({ pid: pidNum, etime, cmd });
					}
				}
			}
			return candidates;
		} catch (error) {
			APLaunchConfigurationProvider.log.log(`DEBUG: Error finding ArduPilot process: ${error}`);
			return null;
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
		if (this.attachedDebug) {
			// we are attached to the process that's all
			return;
		}
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

			// Check if this is an upload task and prompt user (never for SITL)
			let shouldExecuteTask = true;
			if (taskName.endsWith('-upload')) {
				if (apConfig.isSITL) {
					APLaunchConfigurationProvider.log.log('SITL launch detected; skipping upload task and prompt.');
					shouldExecuteTask = false;
				} else {
					const choice = await vscode.window.showWarningMessage(
						'This will upload firmware to the target before debugging. Do you want to proceed with the upload?',
						{ modal: true },
						'Run Upload & Debug',
						'Skip Upload & Debug'
					);

					if (choice === 'Skip Upload & Debug') {
						APLaunchConfigurationProvider.log.log('User chose to skip upload task, proceeding directly to debug');
						shouldExecuteTask = false; // Skip task execution
					} else {
						// choice === 'Run Upload & Debug' or undefined (ESC pressed - default to upload)
						APLaunchConfigurationProvider.log.log('User chose to run upload task before debugging');
						shouldExecuteTask = true; // Execute the upload task as normal
					}
				}
			} else if (apConfig.isSITL && taskType === 'ardupilot') {
				// For SITL, ask if the user wants to build before debugging (mirrors upload prompt UX)
				const choice = await vscode.window.showWarningMessage(
					'This will build SITL before debugging. Do you want to proceed with the build?',
					{ modal: true },
					'Build & Debug',
					'Skip Build & Debug'
				);

				if (choice === 'Skip Build & Debug') {
					APLaunchConfigurationProvider.log.log('User chose to skip SITL build, proceeding directly to debug');
					shouldExecuteTask = false; // Skip build execution
				} else {
					// choice === 'Build & Debug' or undefined (ESC pressed - default to build)
					APLaunchConfigurationProvider.log.log('User chose to build before debugging SITL');
					shouldExecuteTask = true; // Execute the build task as normal
				}
			}

			// Execute the task and wait for it to complete (only if not skipping)
			if (shouldExecuteTask) {
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

				// Detect existing running ArduPilot binary and prompt user
				const existingArduPidList = this.findArduPilotProcessByBinary(binaryPath);
				if (existingArduPidList && existingArduPidList.length !== 0) {
					APLaunchConfigurationProvider.log.log(`DEBUG: Detected existing ArduPilot binary process (PIDs ${existingArduPidList.join(', ')}).`);

					APLaunchConfigurationProvider.log.log('DEBUG: User chose to attach to existing ArduPilot process.');
					// No TCP connection required; proceed to attach directly
					const isMacOS = os.platform() === 'darwin';
					if (isMacOS) {
						// Ensure CodeLLDB is available
						if (!(await this.ensureCodeLLDBAvailable())) {
							return undefined;
						}
					}
					interface ProcessQuickPickItem extends vscode.QuickPickItem { pid: number }
					const processPickList = existingArduPidList.map(c => ({
						label: `PID ${c.pid}`,
						description: c.etime ? `uptime ${c.etime}` : '',
						detail: c.cmd,
						pid: c.pid
					} as ProcessQuickPickItem));
					processPickList.push({
						label: 'Kill all and Start new',
					} as ProcessQuickPickItem);
					const selection = await vscode.window.showQuickPick(
						processPickList,
						{ placeHolder: 'Select ArduPilot process to attach' }
					);
					const skipAttach = !selection || selection.label == 'Kill all and Start new';
					if (isMacOS && !skipAttach) {
						this.attachedDebug = true;
						const lldbAttachConfig = {
							type: 'lldb',
							request: 'attach',
							name: `Debug ${vehicleType} SITL`,
							program: binaryPath,
							pid: (selection as ProcessQuickPickItem).pid,
							waitFor: false,
							stopOnEntry: true,
							initCommands: [
								'setting set target.max-string-summary-length 10000'
							]
						};
						APLaunchConfigurationProvider.log.log(`DEBUG: Attaching LLDB to PID ${(selection as ProcessQuickPickItem).pid}`);
						return lldbAttachConfig;
					} else if (!skipAttach) {
						this.attachedDebug = true;
						const gdb = await ProgramUtils.findProgram(TOOLS_REGISTRY.GDB);
						if (!gdb.available) {
							vscode.window.showErrorMessage('GDB not found. Please install GDB to attach to SITL.');
							return undefined;
						}
						const cppAttachConfig = {
							type: 'cppdbg',
							request: 'attach',
							name: `Debug ${vehicleType} SITL`,
							program: binaryPath,
							processId: (selection as ProcessQuickPickItem).pid,
							cwd: workspaceRoot,
							MIMode: 'gdb',
							miDebuggerPath: gdb.path,
							setupCommands: [
								{ description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true },
								{ description: 'Set Disassembly Flavor to Intel', text: '-gdb-set disassembly-flavor intel', ignoreFailures: true }
							]
						};
						APLaunchConfigurationProvider.log.log(`DEBUG: Attaching GDB to PID ${(selection as ProcessQuickPickItem).pid}`);
						return cppAttachConfig;
					}

					APLaunchConfigurationProvider.log.log('DEBUG: User chose to kill existing ArduPilot process and start new. Attempting graceful shutdown...');
					for (const existingArduPid of existingArduPidList) {
						// Try graceful SIGINT first
						spawnSync('kill', ['-INT', existingArduPid.pid.toString()]);
						await new Promise(resolve => setTimeout(resolve, 2000));
						// Recheck if ArduPilot binary is still running
						const stillRunningList = this.findArduPilotProcessByBinary(binaryPath);
						if (stillRunningList && existingArduPid.pid in stillRunningList.map(c => c.pid)) {
							const killChoice = await vscode.window.showWarningMessage(
								'Graceful shutdown failed. Force kill the existing ArduPilot process?',
								{ modal: true },
								'Force Kill',
								'Cancel'
							);
							if (killChoice !== 'Force Kill') {
								APLaunchConfigurationProvider.log.log('DEBUG: User cancelled after failed graceful shutdown.');
								return undefined;
							}
							spawnSync('kill', ['-9', existingArduPid.toString()]);
							APLaunchConfigurationProvider.log.log(`DEBUG: Sent SIGKILL to ArduPilot PID ${existingArduPid}`);
							await new Promise(resolve => setTimeout(resolve, 1000));
						}
					}
				}

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
				// Hardware debugging
				return await this.setupHardwareDebugging(workspaceRoot, apConfig);
			}

			// If we're here and we're not debugging, return undefined
			// to prevent VS Code from trying to start a debug session
			return undefined;
		} catch (error) {
			vscode.window.showErrorMessage(`Error in APLaunch: ${error}`);
			return undefined;
		}
	}

	/*
	 * Set up hardware debugging for physical boards
	 * @param workspaceRoot - The workspace root directory
	 * @param config - The launch configuration
	 * @returns Debug configuration for cortex-debug
	 */
	private async setupHardwareDebugging(workspaceRoot: string, config: APLaunchDefinition): Promise<vscode.DebugConfiguration | undefined> {
		if (!config.board) {
			vscode.window.showErrorMessage('Board name is required for hardware debugging.');
			return undefined;
		}

		// Get hardware definition info for the board
		const hwdefInfo = await readHwdefFile(config.board);
		if (!hwdefInfo.mcuTarget || !hwdefInfo.flashSizeKB) {
			vscode.window.showErrorMessage(`Incomplete debug information for board: ${config.board}. MCU target: ${hwdefInfo.mcuTarget}, Flash size: ${hwdefInfo.flashSizeKB}`);
			return undefined;
		}

		// Get debug configuration from MCU target and flash size
		const debugConfig = getDebugConfigFromMCU(hwdefInfo.mcuTarget, hwdefInfo.flashSizeKB, this.extensionUri);
		if (!debugConfig.openocdTarget && !debugConfig.jlinkDevice) {
			vscode.window.showErrorMessage(`No debug configuration found for MCU target: ${hwdefInfo.mcuTarget}`);
			return undefined;
		}

		APLaunchConfigurationProvider.log.log(`Hardware debug info: MCU=${hwdefInfo.mcuTarget}, Flash=${hwdefInfo.flashSizeKB}KB, OpenOCD=${debugConfig.openocdTarget}, JLink=${debugConfig.jlinkDevice}, SVD=${debugConfig.svdFile}`);

		// Determine which debugger to use
		const debuggerType = await this.selectDebuggerType();
		if (!debuggerType) {
			return undefined;
		}

		// Get the ELF file path
		const elfFile = path.join(workspaceRoot, 'build', config.board, targetToBin[config.target]);
		if (!fs.existsSync(elfFile)) {
			vscode.window.showErrorMessage(`ELF file not found: ${elfFile}. Please build the firmware first.`);
			return undefined;
		}

		if (debuggerType === 'openocd') {
			return await this.createOpenOCDDebugConfig(workspaceRoot, config, hwdefInfo, debugConfig, elfFile);
		} else {
			return await this.createJLinkDebugConfig(workspaceRoot, config, hwdefInfo, debugConfig, elfFile);
		}
	}

	/*
	 * Select debugger type (OpenOCD or JLink)
	 * @returns Selected debugger type or undefined if cancelled
	 */
	private async selectDebuggerType(): Promise<'openocd' | 'jlink' | undefined> {
		// Check available debuggers
		const openOCD = await ProgramUtils.findProgram(TOOLS_REGISTRY.OPENOCD);
		const jLink = await ProgramUtils.findProgram(TOOLS_REGISTRY.JLINK);

		const availableDebuggers: {label: string, value: 'openocd' | 'jlink', description: string}[] = [];

		if (openOCD.available) {
			availableDebuggers.push({ label: 'STLink/OpenOCD', value: 'openocd', description: 'Use STLink debugger via OpenOCD' });
		}

		if (jLink.available) {
			availableDebuggers.push({ label: 'JLink', value: 'jlink', description: 'Use JLink debugger' });
		}

		if (availableDebuggers.length === 0) {
			vscode.window.showErrorMessage('No debuggers available. Please install OpenOCD or JLink tools.');
			return undefined;
		}

		if (availableDebuggers.length === 1) {
			APLaunchConfigurationProvider.log.log(`Using only available debugger: ${availableDebuggers[0].value}`);
			return availableDebuggers[0].value;
		}

		// Ask user to choose
		const selected = await vscode.window.showQuickPick(availableDebuggers, {
			placeHolder: 'Select a debugger to use',
			title: 'ArduPilot Hardware Debugger Selection'
		});

		return selected?.value;
	}

	/*
	 * Create OpenOCD debug configuration
	 * @param workspaceRoot - Workspace root directory
	 * @param config - Launch configuration
	 * @param hwdefInfo - Hardware definition information from hwdef.dat
	 * @param debugConfig - Debug configuration from getDebugConfigFromMCU
	 * @param elfFile - Path to ELF file
	 * @returns OpenOCD debug configuration
	 */
	private async createOpenOCDDebugConfig(
		workspaceRoot: string,
		config: APLaunchDefinition,
		hwdefInfo: HwdefInfo,
		debugConfig: DebugConfig,
		elfFile: string
	): Promise<vscode.DebugConfiguration> {
		const openOCD = await ProgramUtils.findProgram(TOOLS_REGISTRY.OPENOCD);
		if (!openOCD.available || !openOCD.path) {
			throw new Error('OpenOCD not found');
		}

		if (!debugConfig.openocdTarget) {
			throw new Error(`No OpenOCD target configured for ${hwdefInfo.mcuTarget}`);
		}

		const svdPath = debugConfig.svdFile ? path.join(__dirname, '..', 'resources', 'STMicro', debugConfig.svdFile) : undefined;

		// OpenOCD configuration
		const gdbPort = 3333; // default OpenOCD GDB port
		let openOCDHelperPath = path.join(this.extensionUri.fsPath, 'resources', 'openocd-helper.tcl');
		let openocdScriptPath = path.join(path.dirname(openOCD.path), '../scripts');
		const openOCDPath = openOCD.path;
		if (ProgramUtils.isWSL()) {
			// convert to using wsl path by appending \\wsl.localhost\Ubuntu
			const wslDistro = ProgramUtils.wslDistro();
			openOCDHelperPath = `\\\\\\\\wsl.localhost\\${wslDistro}${openOCDHelperPath.replace(/\//g, '\\')}`;
			openocdScriptPath = `\\\\\\\\wsl.localhost\\${wslDistro}${openocdScriptPath.replace(/\//g, '\\')}`;

		}

		APLaunchConfigurationProvider.log.log(`HARDWARE_DEBUG: Starting debug session for ${config.board}`);

		// Start OpenOCD server for debugging using pseudoterminal (expects firmware already flashed)
		const openOCDArgs = [
			'-c', `"gdb port ${gdbPort}"`,
			'-f', `"${openOCDHelperPath}"`,
			'-f', '"interface/stlink.cfg"',
			'-c', '"transport select swd"',
			'-f', `"target/${debugConfig.openocdTarget}"`,
			'-c', '"bindto 0.0.0.0"',
			'-c', '"init"',
			'-c', '"CDRTOSConfigure chibios"',
			'-s', `"${openocdScriptPath}"`
		];

		APLaunchConfigurationProvider.log.log(`Starting OpenOCD for debugging with args: ${openOCDArgs.join(' ')}`);
		await this.startDebugServerTerminal('OpenOCD Server', openOCDPath, openOCDArgs, 'Listening on port 3333 for gdb connections');

		// for wsl platform use wslIP
		let gdbTarget = 'localhost:3333';
		if (ProgramUtils.isWSL()) {
			gdbTarget = `${ProgramUtils.wslIP()}:3333`;
		}

		// Create cortex-debug configuration with memory access enablement
		const cortexDebugConfig: vscode.DebugConfiguration = {
			type: 'cortex-debug',
			request: 'attach',
			name: `Debug ${config.target} on ${config.board} (OpenOCD)`,
			cwd: workspaceRoot,
			executable: elfFile,
			servertype: 'external',
			gdbTarget,
		};

		if (svdPath && fs.existsSync(svdPath)) {
			cortexDebugConfig.svdPath = svdPath;
			APLaunchConfigurationProvider.log.log(`Using SVD file: ${svdPath}`);
		}

		// Find ARM GDB and related tools
		const armGdb = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GDB);
		if (armGdb.available && armGdb.path) {
			cortexDebugConfig.gdbPath = armGdb.path;
		}

		// Find ARM GCC toolchain for objdump and nm
		const armGcc = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GCC);
		if (armGcc.available && armGcc.path) {
			const gccDir = path.dirname(armGcc.path);
			cortexDebugConfig.objdumpPath = path.join(gccDir, 'arm-none-eabi-objdump');
			cortexDebugConfig.nmPath = path.join(gccDir, 'arm-none-eabi-nm');
		} else {
			// Fallback to system PATH
			cortexDebugConfig.objdumpPath = 'arm-none-eabi-objdump';
			cortexDebugConfig.nmPath = 'arm-none-eabi-nm';
		}

		const message = `Starting hardware debug session for ${config.board} using OpenOCD (${debugConfig.openocdTarget})`;
		vscode.window.showInformationMessage(message);
		APLaunchConfigurationProvider.log.log(message);

		return cortexDebugConfig;
	}

	/*
	 * Get platform-specific RTOSPlugin file for JLink
	 * @returns RTOSPlugin file path or undefined if not available
	 */
	private getRTOSPluginPath(): string | undefined {
		const platform = os.platform();
		let pluginFileName: string;

		switch (platform) {
		case 'linux':
			if (ProgramUtils.isWSL()) {
				pluginFileName = 'RTOSPlugin_ChibiOS-windows-x64.dll';
			} else {
				pluginFileName = 'libRTOSPlugin_ChibiOS-linux-x86_64.so';
			}
			break;
		case 'darwin':
			pluginFileName = 'libRTOSPlugin_ChibiOS-macos-universal.so';
			break;
		default:
			APLaunchConfigurationProvider.log.log(`RTOS_PLUGIN: Unsupported platform: ${platform}`);
			return undefined;
		}

		let pluginPath = path.join(this.extensionUri.fsPath, 'resources', 'JLinkRTOSPlugins', pluginFileName);
		// Check if the plugin file exists
		if (fs.existsSync(pluginPath)) {
			APLaunchConfigurationProvider.log.log(`RTOS_PLUGIN: Found plugin for ${platform}: ${pluginPath}`);
			if (ProgramUtils.isWSL()) {
				pluginPath = `\\\\\\\\wsl.localhost\\${ProgramUtils.wslDistro()}${pluginPath.replace(/\//g, '\\')}`;
			}
			return pluginPath;
		} else {
			APLaunchConfigurationProvider.log.log(`RTOS_PLUGIN: Plugin file not found: ${pluginPath}`);
			return undefined;
		}
	}

	/*
	 * Check and approve macOS RTOSPlugin using Python ctypes loading test and Security & Privacy preferences
	 * @param pluginPath - Path to the RTOSPlugin file
	 * @returns Promise<boolean> - true if plugin can be loaded or manual approval succeeded, false otherwise
	 */
	private async checkAndApproveMacOSPlugin(pluginPath: string): Promise<boolean> {
		const platform = os.platform();
		if (platform !== 'darwin') {
			// Not macOS, no plugin verification needed
			return true;
		}

		try {
			APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Testing library loading for: ${pluginPath}`);

			// Warn user about potential delete request before running Python test
			const warningMessage = 'Testing RTOS Plugin loading... IMPORTANT: If macOS asks you to delete the .so file, please ignore that request and click "Cancel" or "Keep".';
			vscode.window.showWarningMessage(warningMessage);

			// Test if the plugin can be loaded using Python ctypes
			const pythonScript = `
import ctypes
try:
    lib = ctypes.CDLL('${pluginPath}')
    print('Library loaded successfully')
except OSError as e:
    print(f'Failed to load library: {e}')
`;

			const pythonPath = await ProgramUtils.PYTHON();
			const loadTestResult = spawnSync(pythonPath, ['-c', pythonScript], {
				encoding: 'utf8',
				timeout: 15000
			});

			if (loadTestResult.status === 0 && loadTestResult.stdout.includes('Library loaded successfully')) {
				APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Plugin can be loaded successfully: ${pluginPath}`);
				return true;
			}

			APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Plugin cannot be loaded, opening Security & Privacy preferences: ${pluginPath}`);
			APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Python loading test output: ${loadTestResult.stderr || loadTestResult.stdout}`);

			// Show user notification about manual approval process
			const message = 'ArduPilot RTOS Plugin needs to be approved for debugging. The Security & Privacy preferences will open. Please scroll down and click "Allow Anyway" for libRTOSPlugin_ChibiOS-macos-universal.so, then click "Continue" in this dialog when done.';
			const continueButton = 'Continue';
			const cancelButton = 'Cancel';

			// Open Security & Privacy preferences
			APLaunchConfigurationProvider.log.log('PLUGIN_CHECK: Opening Security & Privacy preferences');
			const openResult = spawnSync('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Security'], {
				encoding: 'utf8',
				timeout: 5000
			});

			if (openResult.status !== 0) {
				APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Failed to open Security & Privacy preferences: ${openResult.stderr}`);
			}

			// Ask user to manually approve and wait for their confirmation
			const userChoice = await vscode.window.showInformationMessage(message, continueButton, cancelButton);

			if (userChoice !== continueButton) {
				APLaunchConfigurationProvider.log.log('PLUGIN_CHECK: User cancelled plugin approval process');
				return false;
			}

			APLaunchConfigurationProvider.log.log('PLUGIN_CHECK: User indicated they have approved the plugin, verifying...');

			// Verify the manual approval worked by testing library loading again
			const verifyResult = spawnSync(pythonPath, ['-c', pythonScript], {
				encoding: 'utf8',
				timeout: 15000
			});

			if (verifyResult.status === 0 && verifyResult.stdout.includes('Library loaded successfully')) {
				APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Plugin successfully approved and library can now be loaded: ${pluginPath}`);
				vscode.window.showInformationMessage('RTOS Plugin approved successfully');
				return true;
			} else {
				APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Plugin approval failed or library still cannot be loaded: ${verifyResult.stderr || verifyResult.stdout}`);
				vscode.window.showErrorMessage('Plugin approval failed. Please ensure you clicked "Allow Anyway" in Security & Privacy preferences. Debugging will continue without RTOS support.');
				return false;
			}

		} catch (error) {
			APLaunchConfigurationProvider.log.log(`PLUGIN_CHECK: Error during plugin verification or approval process: ${error}`);
			vscode.window.showErrorMessage(`Error during RTOS Plugin approval process: ${error}`);
			return false;
		}
	}

	/*
	 * Create JLink debug configuration
	 * @param workspaceRoot - Workspace root directory
	 * @param config - Launch configuration
	 * @param hwdefInfo - Hardware definition information from hwdef.dat
	 * @param debugConfig - Debug configuration from getDebugConfigFromMCU
	 * @param elfFile - Path to ELF file
	 * @returns JLink debug configuration
	 */
	private async createJLinkDebugConfig(
		workspaceRoot: string,
		config: APLaunchDefinition,
		hwdefInfo: HwdefInfo,
		debugConfig: DebugConfig,
		elfFile: string
	): Promise<vscode.DebugConfiguration> {
		const jLink = await ProgramUtils.findProgram(TOOLS_REGISTRY.JLINK);
		if (!jLink.available || !jLink.path) {
			throw new Error('JLink GDB Server not found');
		}

		if (!debugConfig.jlinkDevice) {
			throw new Error(`No JLink device configured for ${hwdefInfo.mcuTarget}`);
		}

		const jlinkDevice = debugConfig.jlinkDevice;
		const svdPath = debugConfig.svdFile ? path.join(__dirname, '..', 'resources', 'STMicro', debugConfig.svdFile) : undefined;

		// Get platform-specific RTOSPlugin
		const rtosPluginPath = this.getRTOSPluginPath();
		let rtosPluginEnabled = false;
		if (rtosPluginPath) {
			// Check and approve the plugin on macOS if needed
			const pluginApproved = await this.checkAndApproveMacOSPlugin(rtosPluginPath);
			if (pluginApproved) {
				rtosPluginEnabled = true;
				APLaunchConfigurationProvider.log.log(`RTOS_PLUGIN: Using ChibiOS RTOS plugin: ${rtosPluginPath}`);
			} else {
				APLaunchConfigurationProvider.log.log('RTOS_PLUGIN: Plugin approval failed, continuing without RTOS support');
			}
		} else {
			APLaunchConfigurationProvider.log.log('RTOS_PLUGIN: No RTOS plugin available, continuing without RTOS support');
		}

		// Start JLink GDB Server using external server management with pseudoterminal
		const gdbPort = 2331; // Default JLink GDB port
		const jlinkArgs = [
			'-singlerun',
			'-device', jlinkDevice,
			'-if', 'SWD',
			'-speed', 'auto',
			'-port', gdbPort.toString(),
			'-nogui',
			'-nolocalhostonly'
		];

		// Add RTOS plugin if available and approved
		if (rtosPluginEnabled && rtosPluginPath) {
			jlinkArgs.push('-rtos', `"${rtosPluginPath}"`);
			APLaunchConfigurationProvider.log.log(`Configuring RTOS plugin: ${rtosPluginPath}`);
		}

		// Start JLink GDB Server in pseudoterminal and wait for it to be ready
		await this.startDebugServerTerminal('JLink GDB Server', jLink.path, jlinkArgs, 'Waiting for GDB connection');

		// for wsl platform use wslIP
		let gdbTarget = `localhost:${gdbPort}`;
		if (ProgramUtils.isWSL()) {
			gdbTarget = `${ProgramUtils.wslIP()}:${gdbPort}`;
		}
		APLaunchConfigurationProvider.log.log('Using JLink GDB Server with external server management');
		const cortexDebugConfig: vscode.DebugConfiguration = {
			type: 'cortex-debug',
			request: 'attach',
			name: `Debug ${config.target} on ${config.board} (JLink External)`,
			cwd: workspaceRoot,
			executable: elfFile,
			servertype: 'external',
			gdbTarget,
			postResetCommands: [
				'interpreter-exec console "monitor halt"',
				'interpreter-exec console "monitor reset"'
			],
			resetToEntryPoint: 'main',
			objdumpPath: '',
			nmPath: ''
		};

		if (svdPath && fs.existsSync(svdPath)) {
			cortexDebugConfig.svdPath = svdPath;
			APLaunchConfigurationProvider.log.log(`Using SVD file: ${svdPath}`);
		}

		// Find ARM GDB and related tools
		const armGdb = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GDB);
		if (armGdb.available && armGdb.path) {
			cortexDebugConfig.gdbPath = armGdb.path;
		}

		// Find ARM GCC toolchain for objdump and nm
		const armGcc = await ProgramUtils.findProgram(TOOLS_REGISTRY.ARM_GCC);
		if (armGcc.available && armGcc.path) {
			const gccDir = path.dirname(armGcc.path);
			cortexDebugConfig.objdumpPath = path.join(gccDir, 'arm-none-eabi-objdump');
			cortexDebugConfig.nmPath = path.join(gccDir, 'arm-none-eabi-nm');
		} else {
			// Fallback to system PATH
			cortexDebugConfig.objdumpPath = 'arm-none-eabi-objdump';
			cortexDebugConfig.nmPath = 'arm-none-eabi-nm';
		}

		const message = `Starting hardware debug session for ${config.board} using JLink (${jlinkDevice})`;
		vscode.window.showInformationMessage(message);
		APLaunchConfigurationProvider.log.log(message);

		return cortexDebugConfig;
	}

	/*
	 * Create a debug server terminal using pseudoterminal for external server management
	 * @param serverName - Display name for the server (e.g., "JLink GDB Server", "OpenOCD")
	 * @param command - Command to execute
	 * @param args - Arguments for the command
	 * @returns VS Code Terminal running the debug server
	 */
	private async startDebugServerTerminal(serverName: string, command: string, args: string[], waitForText?: string): Promise<void> {
		// Close existing debug server terminal if any
		if (this.debugServerTerminal) {
			this.debugServerTerminal.dispose();
		}

		// Create new pseudoterminal for the debug server
		const pty = new DebugServerPseudoterminal(serverName, command, args, waitForText);
		this.debugServerTerminal = vscode.window.createTerminal({ name: serverName, pty });

		// Show the terminal
		this.debugServerTerminal.show();

		// Wait for specific text or timeout
		if (waitForText) {
			APLaunchConfigurationProvider.log.log(`Waiting for "${waitForText}" in ${serverName} output...`);
			const found = await pty.waitForTextInOutput(10000); // 10 second timeout
			if (found) {
				APLaunchConfigurationProvider.log.log(`Found "${waitForText}" - ${serverName} is ready`);
			} else {
				APLaunchConfigurationProvider.log.log(`Timeout waiting for "${waitForText}" - continuing anyway`);
			}
		} else {
			// Fallback: Give the server a moment to start
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
	}

	/*
	 * Ensure CodeLLDB (vadimcn.vscode-lldb) is installed and active on macOS
	 */
	private async ensureCodeLLDBAvailable(): Promise<boolean> {
		const codelldbExtension = vscode.extensions.getExtension('vadimcn.vscode-lldb');
		if (!codelldbExtension) {
			const message = 'CodeLLDB extension is required for debugging on macOS. Would you like to install it?';
			const installButton = 'Install CodeLLDB';
			const cancelButton = 'Cancel';
			const choice = await vscode.window.showErrorMessage(message, installButton, cancelButton);
			if (choice === installButton) {
				await vscode.commands.executeCommand('workbench.extensions.search', 'vadimcn.vscode-lldb');
			}
			return false;
		}
		if (!codelldbExtension.isActive) {
			try {
				APLaunchConfigurationProvider.log.log('DEBUG: Activating CodeLLDB extension...');
				await codelldbExtension.activate();
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to activate CodeLLDB extension: ${error}`);
				return false;
			}
		}
		return true;
	}
}

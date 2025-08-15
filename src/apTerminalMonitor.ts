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

import * as vscode from 'vscode';
import { apLog } from './apLog';

/*
 * Terminal Monitor API for ArduPilot VS Code Extension
 *
 * Provides comprehensive terminal monitoring capabilities including:
 * - Shell execution event tracking (start/end)
 * - Real-time text streaming and callbacks
 * - Event-based task monitoring
 * - Promise-based waiting for specific events
 * - Static management of multiple terminal monitors
 */

// Types of terminal events that can be monitored
export enum TerminalEventType {
	TEXT_RECEIVED = 'text_received',              // Fired when text is received from terminal
	TERMINAL_CLOSED = 'terminal_closed',          // Fired when terminal is closed
	TERMINAL_OPENED = 'terminal_opened',          // Fired when terminal is opened
	SHELL_EXECUTION_START = 'shell_execution_start', // Fired when shell execution starts
	SHELL_EXECUTION_END = 'shell_execution_end'   // Fired when shell execution ends
}

// Event object containing terminal event data
export interface TerminalEvent {
	type: TerminalEventType;                      // Type of the event
	timestamp: Date;                              // Timestamp when event occurred
	data?: string;                                // Optional text data associated with event
	exitCode?: number;                            // Exit code for execution end events
	shellExecution?: vscode.TerminalShellExecution; // Reference to VS Code shell execution object
	commandLine?: string;                         // Command line that was executed
}

// Callback function for receiving terminal text
export interface TerminalTextCallback {
	(text: string): void;
}

/*
 * Terminal Monitor class for tracking terminal events and shell execution
 *
 * Features:
 * - Monitors shell execution start/end events
 * - Provides text callbacks and event listeners
 * - Supports promise-based waiting for events
 * - Manages terminal lifecycle (create, dispose, etc.)
 * - Static registry of all terminal monitors
 */
export class apTerminalMonitor {
	// Static properties for managing all terminal monitors
	private static terminalMonitors: Map<string, apTerminalMonitor> = new Map(); // Registry of all active monitors
	private static shellExecutionListenersInitialized = false;                   // Flag to ensure listeners are only set up once
	private static shellExecutionDisposables: vscode.Disposable[] = [];          // Disposables for cleanup
	private static globalLog = new apLog('apTerminalMonitor-Global');            // Global logger

	// Instance properties
	private terminal: vscode.Terminal | null = null;                             // VS Code terminal instance
	private writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>(); // For PTY output
	private ptyProcess: vscode.Pseudoterminal | null = null;                     // PTY process for custom terminals
	private log: apLog;                                                          // Instance logger
	private eventListeners: Map<TerminalEventType, ((event: TerminalEvent) => void)[]> = new Map(); // Event listeners
	private textCallbacks: TerminalTextCallback[] = [];                          // Text callbacks
	private terminalName: string;                                                // Unique terminal name
	private eventPromises: Map<TerminalEventType, { resolve: (event: TerminalEvent) => void; reject: (reason: unknown) => void; }[]> = new Map(); // Promise handlers
	private activeShellExecution: vscode.TerminalShellExecution | null = null;   // Current shell execution
	private currentCommand: string | null = null;                                // Current command being tracked by runCommand

	/*
	 * Constructor - Creates a new terminal monitor instance
	 * @param terminalName - Unique name for the terminal to monitor
	 */
	constructor(terminalName: string) {
		this.terminalName = terminalName;
		this.log = new apLog(`apTerminalMonitor-${terminalName}`);
		this.initializeEventMaps();

		// Initialize shell execution listeners on first use
		apTerminalMonitor.initializeShellExecutionListeners();

		// Register this monitor in the static registry
		apTerminalMonitor.terminalMonitors.set(terminalName, this);
	}

	/*
	 * Static method to initialize VS Code shell execution listeners
	 * Only called once on first terminal monitor creation
	 */
	private static initializeShellExecutionListeners(): void {
		if (apTerminalMonitor.shellExecutionListenersInitialized) {
			return; // Already initialized
		}

		apTerminalMonitor.globalLog.log('Initializing shell execution listeners');

		// Listen for shell execution start events
		const startDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
			apTerminalMonitor.handleShellExecutionStart(event);
		});

		// Listen for shell execution end events
		const endDisposable = vscode.window.onDidEndTerminalShellExecution(async (event) => {
			apTerminalMonitor.handleShellExecutionEnd(event);
		});

		// Store disposables for cleanup
		apTerminalMonitor.shellExecutionDisposables.push(startDisposable, endDisposable);
		apTerminalMonitor.shellExecutionListenersInitialized = true;
	}

	/*
	 * Static handler for shell execution start events
	 * Routes events to the appropriate terminal monitor and sets up text streaming
	 */
	private static handleShellExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
		const terminalName = event.terminal.name;
		const monitor = apTerminalMonitor.terminalMonitors.get(terminalName);

		if (monitor) {
			apTerminalMonitor.globalLog.log(`Shell execution started for terminal: ${terminalName}`);
			apTerminalMonitor.globalLog.log(`Command line from event: ${event.execution.commandLine.value}`);
			apTerminalMonitor.globalLog.log(`Current command in monitor: ${monitor.currentCommand}`);

			// Check if we should handle this command
			// For compound commands (with &&, ||, ;), we should handle if the current execution is part of the original command
			const shouldHandle = !monitor.currentCommand ||
				monitor.normalizeCommand(event.execution.commandLine.value) === monitor.normalizeCommand(monitor.currentCommand) ||
				monitor.isPartOfCompoundCommand(event.execution.commandLine.value, monitor.currentCommand);

			apTerminalMonitor.globalLog.log(`Should handle command: "${event.execution.commandLine.value}" ${shouldHandle ? '==' : '!='} "${monitor.currentCommand}"`);

			if (shouldHandle) {
				monitor.activeShellExecution = event.execution;

				// Emit shell execution start event to monitor
				monitor.emitEvent({
					type: TerminalEventType.SHELL_EXECUTION_START,
					timestamp: new Date(),
					shellExecution: event.execution,
					commandLine: event.execution.commandLine.value
				});

				// Set up stream reading for real-time text output
				const stream = event.execution.read();

				// Process the async stream in background
				(async () => {
					try {
						for await (const data of stream) {
							monitor.handleShellExecutionData(data);
						}
					} catch (error) {
						monitor.log.log(`Error reading shell execution stream: ${error}`);
					}
				})();
			} else {
				apTerminalMonitor.globalLog.log(`Ignoring shell execution for terminal: ${terminalName} - command mismatch`);
			}
		}
	}

	/*
	 * Static handler for shell execution end events
	 * Routes events to the appropriate terminal monitor with exit code
	 */
	private static handleShellExecutionEnd(event: vscode.TerminalShellExecutionEndEvent): void {
		const terminalName = event.terminal.name;
		const monitor = apTerminalMonitor.terminalMonitors.get(terminalName);

		if (monitor && monitor.activeShellExecution === event.execution) {
			apTerminalMonitor.globalLog.log(`Shell execution end for terminal: ${terminalName}`);
			apTerminalMonitor.globalLog.log(`Command line from end event: ${event.execution.commandLine.value}`);
			apTerminalMonitor.globalLog.log(`Current command in monitor: ${monitor.currentCommand}`);
			apTerminalMonitor.globalLog.log(`Exit code: ${event.exitCode}`);

			// Check if we should handle this command end event
			// For compound commands (with &&, ||, ;), we should handle if the current execution is part of the original command
			const shouldHandle = !monitor.currentCommand ||
				monitor.normalizeCommand(event.execution.commandLine.value) === monitor.normalizeCommand(monitor.currentCommand) ||
				monitor.isPartOfCompoundCommand(event.execution.commandLine.value, monitor.currentCommand);

			apTerminalMonitor.globalLog.log(`Should handle command end: ${shouldHandle}`);

			if (shouldHandle) {
				apTerminalMonitor.globalLog.log(`Shell execution ended for terminal: ${terminalName} with exit code: ${event.exitCode}`);
				monitor.activeShellExecution = null;

				// Emit shell execution end event with exit code
				monitor.emitEvent({
					type: TerminalEventType.SHELL_EXECUTION_END,
					timestamp: new Date(),
					data: `Command finished with exit code: ${event.exitCode}`,
					exitCode: event.exitCode,
					shellExecution: event.execution,
					commandLine: event.execution.commandLine.value
				});
			} else {
				apTerminalMonitor.globalLog.log(`Ignoring shell execution end for terminal: ${terminalName} - command mismatch`);
			}
		}
	}

	// Handle text data from shell execution stream
	private handleShellExecutionData(data: string): void {
		this.log.log(`Shell execution data: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
		this.handleTextReceived(data);
	}

	// Normalize command string by removing extra whitespace for comparison
	private normalizeCommand(command: string): string {
		return command.trim().replace(/\s+/g, ' ');
	}

	// Check if the executed command is part of a compound command (with &&, ||, ;)
	private isPartOfCompoundCommand(executedCommand: string, originalCommand: string): boolean {
		if (!originalCommand || !executedCommand) {
			return false;
		}

		const normalizedOriginal = this.normalizeCommand(originalCommand);
		const normalizedExecuted = this.normalizeCommand(executedCommand);

		// Split the original command by common shell operators
		const commandParts = normalizedOriginal.split(/\s*(?:&&|\|\||;)\s*/);

		// Check if the executed command matches any part of the compound command
		return commandParts.some(part => this.normalizeCommand(part) === normalizedExecuted);
	}

	// Initialize event listener and promise maps for all event types
	private initializeEventMaps(): void {
		Object.values(TerminalEventType).forEach(eventType => {
			this.eventListeners.set(eventType, []);
			this.eventPromises.set(eventType, []);
		});
	}

	// Get the VS Code terminal instance
	public getTerminal(): vscode.Terminal | null {
		return this.terminal;
	}

	/*
	 * Create a new VS Code terminal
	 * @returns The created terminal instance
	 */
	public async createTerminal(options?: Omit<vscode.TerminalOptions, 'name'>, disposeExisting?: boolean): Promise<void> {
		if (this.terminal && disposeExisting) {
			this.terminal.dispose();
		}
		// check if the terminal already exists
		const existingTerminal = this.findExistingTerminal();
		if (existingTerminal && !disposeExisting) {
			this.terminal = existingTerminal;
		} else {
			if (existingTerminal && disposeExisting) {
				existingTerminal.dispose();
			}
			this.terminal = vscode.window.createTerminal({
				name: this.terminalName,
				...options,
			});
		}
		this.terminal.show();

		this.setupTerminalListeners();

		// Send the command after 3 second to allow terminal setup
		// TODO: replace this with a proper mechanism to catch python venv activation
		await new Promise(resolve => setTimeout(resolve, 2000));
	}

	public findExistingTerminal(): vscode.Terminal | null {
		const existingTerminal = vscode.window.terminals.find(t => t.name === this.terminalName);
		if (existingTerminal) {
			this.terminal = existingTerminal;
			this.setupTerminalListeners();
			return this.terminal;
		}
		return null;
	}

	private setupTerminalListeners(): void {
		if (!this.terminal) {
			return;
		}

		const closeDisposable = vscode.window.onDidCloseTerminal(closedTerminal => {
			if (closedTerminal === this.terminal) {
				this.log.log(`Terminal ${this.terminalName} was closed`);
				this.emitEvent({
					type: TerminalEventType.TERMINAL_CLOSED,
					timestamp: new Date()
				});
				closeDisposable.dispose();
				this.terminal = null;
				this.ptyProcess = null;
			}
		});
	}

	private handleTerminalInput(data: string): void {
		this.writeEmitter.fire(data);
		this.handleTextReceived(data);
	}

	private handleTextReceived(text: string): void {
		this.log.log(`Terminal text received: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);

		this.emitEvent({
			type: TerminalEventType.TEXT_RECEIVED,
			timestamp: new Date(),
			data: text
		});

		this.textCallbacks.forEach(callback => {
			try {
				callback(text);
			} catch (error) {
				this.log.log(`Error in text callback: ${error}`);
			}
		});
	}

	public addEventListener(eventType: TerminalEventType, callback: (event: TerminalEvent) => void): void {
		const listeners = this.eventListeners.get(eventType);
		if (listeners) {
			listeners.push(callback);
		}
	}

	public removeEventListener(eventType: TerminalEventType, callback: (event: TerminalEvent) => void): void {
		const listeners = this.eventListeners.get(eventType);
		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index > -1) {
				listeners.splice(index, 1);
			}
		}
	}

	public addTextCallback(callback: TerminalTextCallback): void {
		this.textCallbacks.push(callback);
	}

	public removeTextCallback(callback: TerminalTextCallback): void {
		const index = this.textCallbacks.indexOf(callback);
		if (index > -1) {
			this.textCallbacks.splice(index, 1);
		}
	}

	public waitForEvent(eventType: TerminalEventType, timeoutMs?: number): Promise<TerminalEvent> {
		return new Promise((resolve, reject) => {
			const timeoutId = timeoutMs ? setTimeout(() => {
				this.removePromiseHandlers(eventType, resolve, reject);
				reject(new Error(`Timeout waiting for ${eventType} event after ${timeoutMs}ms`));
			}, timeoutMs) : null;

			const wrappedResolve = (event: TerminalEvent) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				this.removePromiseHandlers(eventType, resolve, reject);
				resolve(event);
			};

			const wrappedReject = (reason: unknown) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				this.removePromiseHandlers(eventType, resolve, reject);
				reject(reason);
			};

			const promises = this.eventPromises.get(eventType);
			if (promises) {
				promises.push({ resolve: wrappedResolve, reject: wrappedReject });
			}
		});
	}

	/*
	 * Wait for shell execution to start
	 * @param timeoutMs - Timeout in milliseconds (default: undefined)
	 * @returns Promise that resolves when shell execution starts
	 */
	public waitForShellExecutionStart(timeoutMs?: number): Promise<TerminalEvent> {
		return this.waitForEvent(TerminalEventType.SHELL_EXECUTION_START, timeoutMs);
	}

	/*
	 * Wait for shell execution to end
	 * @param timeoutMs - Timeout in milliseconds (default: undefined)
	 * @returns Promise that resolves when shell execution ends with exit code
	 */
	public waitForShellExecutionEnd(timeoutMs?: number): Promise<TerminalEvent> {
		return this.waitForEvent(TerminalEventType.SHELL_EXECUTION_END, timeoutMs);
	}

	/*
	 * Wait for specific text pattern in terminal output
	 * @param pattern - String or RegExp pattern to match
	 * @param timeoutMs - Timeout in milliseconds (default: 30000)
	 * @returns Promise that resolves with matching text
	 */
	public waitForText(pattern: string | RegExp, timeoutMs: number = 30000): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.removeTextCallback(textCallback);
				reject(new Error(`Timeout waiting for text pattern after ${timeoutMs}ms`));
			}, timeoutMs);

			const textCallback: TerminalTextCallback = (text: string) => {
				const matches = typeof pattern === 'string'
					? text.includes(pattern)
					: pattern.test(text);

				if (matches) {
					clearTimeout(timeoutId);
					this.removeTextCallback(textCallback);
					resolve(text);
				}
			};

			this.addTextCallback(textCallback);
		});
	}

	private removePromiseHandlers(eventType: TerminalEventType, resolve: (event: TerminalEvent) => void, reject: (reason: unknown) => void): void {
		const promises = this.eventPromises.get(eventType);
		if (promises) {
			const index = promises.findIndex(p => p.resolve === resolve && p.reject === reject);
			if (index > -1) {
				promises.splice(index, 1);
			}
		}
	}

	private emitEvent(event: TerminalEvent): void {
		this.log.log(`Emitting event for ${this.terminal?.name}: ${event.type}`);

		const listeners = this.eventListeners.get(event.type);
		if (listeners) {
			listeners.forEach(listener => {
				try {
					listener(event);
				} catch (error) {
					this.log.log(`Error in event listener for ${event.type}: ${error}`);
				}
			});
		}

		const promises = this.eventPromises.get(event.type);
		if (promises) {
			promises.forEach(({ resolve }) => {
				try {
					resolve(event);
				} catch (error) {
					this.log.log(`Error resolving promise for ${event.type}: ${error}`);
				}
			});
			promises.length = 0;
		}
	}

	/*
	 * Run a command in the terminal and wait for completion
	 * @param command - The command to execute
	 * @returns Promise that resolves with the exit code
	 */
	public async runCommand(command: string, options: {
		nonblocking?: boolean,
		onShellExecutionStart?: (event: TerminalEvent) => void,
		onShellExecutionEnd?: (event: TerminalEvent) => void
	} = {}): Promise<number> {
		// Ensure terminal is available, create one if needed
		if (!this.terminal) {
			this.log.log('Terminal not available, attempting to find or create one');

			// Try to find existing terminal first
			if (!this.findExistingTerminal()) {
				// If no existing terminal found, create a new one
				this.log.log('No existing terminal found, creating new terminal');
				await this.createTerminal();
			}

			// Double-check we now have a terminal
			if (!this.terminal) {
				throw (new Error('Failed to create or find terminal'));
			}
		}

		this.log.log(`Running command: ${command}`);

		// Set the current command to filter shell execution events
		this.currentCommand = command;

		// Add event listeners
		if (options.onShellExecutionStart) {
			this.addEventListener(TerminalEventType.SHELL_EXECUTION_START, options.onShellExecutionStart);
		}
		if (options.onShellExecutionEnd) {
			this.addEventListener(TerminalEventType.SHELL_EXECUTION_END, options.onShellExecutionEnd);
		}

		this.log.log(`Sending command to terminal: ${command}`);
		this.terminal.sendText(command, true);

		if (!options.nonblocking) {
			// wait for shell execution to complete
			const exitCode = (await this.waitForShellExecutionEnd()).exitCode;
			if (typeof exitCode === 'number') {
				return exitCode;
			}
			throw new Error('Failed to get exit code');
		} else {
			// No events option is set, return 0
			return 0;
		}
	}

	public show(preserveFocus?: boolean): void {
		if (this.terminal) {
			this.terminal.show(preserveFocus);
		}
	}

	public hide(): void {
		if (this.terminal) {
			this.terminal.hide();
		}
	}

	/*
	 * Attempt to interrupt and clean up any running processes in the terminal
	 * Sends Ctrl+C signal and waits for shell execution to end
	 * @returns Promise that resolves to true if cleanup succeeded, false if it failed
	 */
	private async interruptAndWaitForCleanup(): Promise<boolean> {
		const maxRetries = 5;
		const retryInterval = 1000; // 1 second

		this.log.log('Attempting to interrupt and cleanup running processes');

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			this.log.log(`Cleanup attempt ${attempt}/${maxRetries}`);

			// Send Ctrl+C signal to interrupt running processes
			if (this.terminal) {
				this.terminal.sendText('\x03'); // \x03 is Ctrl+C
			}

			try {
				// Wait for shell execution to end with retry interval timeout
				await this.waitForShellExecutionEnd(retryInterval);
				this.log.log(`Cleanup succeeded on attempt ${attempt}`);
				return true; // Success - process terminated cleanly
			} catch (timeoutError) {
				this.log.log(`Cleanup attempt ${attempt} timed out: ${timeoutError}`);
				if (attempt === maxRetries) {
					this.log.log('All cleanup attempts failed');
					return false; // All retries exhausted
				}
				// Continue to next retry
			}
		}

		return false; // Should never reach here, but just in case
	}

	public async dispose(): Promise<void> {
		// If there are active shell executions, attempt to clean them up first
		if (this.hasActiveShellExecution()) {
			this.log.log('Active shell execution detected, attempting cleanup');

			const cleanupSucceeded = await this.interruptAndWaitForCleanup();

			if (!cleanupSucceeded) {
				// Cleanup failed - show warning and exit early without disposing
				vscode.window.showWarningMessage(
					`Failed to cleanly terminate processes in terminal '${this.terminalName}'. ` +
					'Please manually stop any running processes before closing this terminal. ' +
					'The terminal has been left open to prevent orphaning background processes.'
				);
				this.log.log('Dispose cancelled due to failed process cleanup');
				return; // Exit early without disposing the terminal
			}
		}

		// Remove from static monitor list
		apTerminalMonitor.terminalMonitors.delete(this.terminalName);

		this.eventListeners.clear();
		this.eventPromises.clear();
		this.textCallbacks.length = 0;
		this.activeShellExecution = null;
		this.currentCommand = null;

		if (this.terminal) {
			this.terminal.dispose();
			this.terminal = null;
		}

		if (this.ptyProcess) {
			this.ptyProcess = null;
		}

		this.writeEmitter.dispose();
		this.log.log(`Terminal monitor ${this.terminalName} disposed`);
	}

	public static async disposeAll(): Promise<void> {
		// Dispose all shell execution listeners
		apTerminalMonitor.shellExecutionDisposables.forEach(disposable => disposable.dispose());
		apTerminalMonitor.shellExecutionDisposables.length = 0;
		apTerminalMonitor.shellExecutionListenersInitialized = false;

		// Dispose all monitors (now async)
		const disposePromises = Array.from(apTerminalMonitor.terminalMonitors.values())
			.map(monitor => monitor.dispose());
		await Promise.all(disposePromises);
		apTerminalMonitor.terminalMonitors.clear();

		apTerminalMonitor.globalLog.log('All terminal monitors disposed');
	}

	public isTerminalActive(): boolean {
		return this.terminal !== null && vscode.window.terminals.includes(this.terminal);
	}

	public getTerminalName(): string {
		return this.terminalName;
	}

	public static getMonitor(terminalName: string): apTerminalMonitor | undefined {
		return apTerminalMonitor.terminalMonitors.get(terminalName);
	}

	public static getAllMonitors(): Map<string, apTerminalMonitor> {
		return new Map(apTerminalMonitor.terminalMonitors);
	}

	public hasActiveShellExecution(): boolean {
		return this.activeShellExecution !== null;
	}

	public getActiveShellExecution(): vscode.TerminalShellExecution | null {
		return this.activeShellExecution;
	}
}

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

import * as child_process from 'child_process';
import * as os from 'os';
import { apLog } from './apLog';

/**
 * Interface for program information
 */
export interface ProgramInfo {
	/** Whether the program is available */
	available: boolean;
	/** The path to the program, if available */
	path?: string;
	/** The version of the program, if available */
	version?: string;
	/** Additional information about the program */
	info?: string;
}

/**
 * Utilities for working with external programs
 */
export class ProgramUtils {
	private static log = new apLog('ProgramUtils');

	/**
	 * Finds a program in the system path and returns information about it
	 * @param command The command to check
	 * @param args The arguments to pass to the command (typically for version check)
	 * @param options Additional options
	 * @returns Promise resolving to program information
	 */
	public static async findProgram(
		command: string,
		args: string[] = ['--version'],
		options?: {
			alternativeCommands?: string[],
			versionRegex?: RegExp,
			platformOverrides?: { [platform: string]: string }
		}
	): Promise<ProgramInfo> {
		try {
			// Apply platform-specific command overrides if provided
			const platform = os.platform();
			if (options?.platformOverrides && options.platformOverrides[platform]) {
				command = options.platformOverrides[platform];
			}

			// Try to execute the command
			const result = await this._tryExecuteCommand(command, args);
			if (result) {
				return result;
			}

			// If command fails and alternatives are provided, try those
			if (options?.alternativeCommands && options.alternativeCommands.length > 0) {
				for (const altCommand of options.alternativeCommands) {
					this.log.log(`Command ${command} not found, trying alternative ${altCommand}`);
					const altResult = await this._tryExecuteCommand(altCommand, args, options?.versionRegex);
					if (altResult) {
						return altResult;
					}
				}
			}

			// If we get here, all attempts failed
			return { available: false };
		} catch (error) {
			this.log.log(`Error finding program ${command}: ${error}`);
			return { available: false };
		}
	}

	/**
	 * Attempts to execute a command and extract its version and path
	 * @param command The command to execute
	 * @param args The arguments to pass to the command
	 * @param versionRegex Optional regex to extract version
	 * @returns Program information if successful, null if not
	 */
	private static async _tryExecuteCommand(
		command: string,
		args: string[],
		versionRegex?: RegExp
	): Promise<ProgramInfo | null> {
		return new Promise<ProgramInfo | null>((resolve) => {
			try {
				const process = child_process.spawn(command, args);
				let output = '';
				let errorOutput = '';

				process.stdout.on('data', (data) => {
					output += data.toString();
				});

				process.stderr.on('data', (data) => {
					errorOutput += data.toString();
				});

				process.on('close', (code) => {
					if (code === 0) {
						// Tool exists, now find its path
						child_process.exec(`which ${command}`, (error, stdout) => {
							const path = error ? 'Unknown' : stdout.trim();

							// Extract version from output
							const versionOutput = output || errorOutput;
							let version = 'Unknown';

							// Special handling for JLinkGDBServerCLExe which has a different version format
							if (command === 'JLinkGDBServerCLExe') {
								// Example: "SEGGER J-Link GDB Server V7.94e Command Line Version"
								const jlinkVersionMatch = versionOutput.match(/GDB Server V([\d.]+[a-z]?)/);
								if (jlinkVersionMatch) {
									version = jlinkVersionMatch[1];
								}
							} else if (versionRegex) {
								// Use custom regex if provided
								const match = versionOutput.match(versionRegex);
								if (match && match[1]) {
									version = match[1];
								}
							} else {
								// Standard version extraction for other tools
								const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
								if (versionMatch) {
									version = versionMatch[1];
								}
							}

							resolve({
								available: true,
								version,
								path
							});
						});
					} else {
						resolve(null);
					}
				});

				process.on('error', () => {
					resolve(null);
				});
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (error) {
				resolve(null);
			}
		});
	}

	/**
	 * Gets the platform-appropriate path separator
	 * @returns The path separator for the current platform
	 */
	public static getPathSeparator(): string {
		return os.platform() === 'win32' ? ';' : ':';
	}

	/**
	 * Checks if running in Windows Subsystem for Linux
	 * @returns True if running in WSL, false otherwise
	 */
	public static isWSL(): boolean {
		// Check if running in WSL
		const platform = os.platform();
		if (platform !== 'linux') {
			return false;
		}

		// Check for WSL in release info
		try {
			const releaseInfo = child_process.execSync('cat /proc/version').toString();
			return releaseInfo.toLowerCase().includes('microsoft') || releaseInfo.toLowerCase().includes('wsl');
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (error) {
			return false;
		}
	}
}

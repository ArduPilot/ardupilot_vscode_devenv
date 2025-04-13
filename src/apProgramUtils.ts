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
import { ToolsConfig } from './apToolsConfig';
import * as fs from 'fs';

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
	/** command string */
	command?: string;
}

/**
 * Utilities for working with external programs
 */
export class ProgramUtils {
	private static log = new apLog('ProgramUtils');

	/**
	 * Tool IDs for configuration
	 */
	public static readonly TOOL_PYTHON = 'python';
	public static readonly TOOL_MAVPROXY = 'mavproxy';
	public static readonly TOOL_CCACHE = 'ccache';
	public static readonly TOOL_OPENOCD = 'openocd';
	public static readonly TOOL_JLINK = 'JLinkGDBServerCL';
	public static readonly TOOL_GCC = 'gcc';
	public static readonly TOOL_GPP = 'g++';
	public static readonly TOOL_GDB = 'gdb';
	public static readonly TOOL_ARM_GCC = 'arm-gcc';
	public static readonly TOOL_ARM_GPP = 'arm-g++';
	public static readonly TOOL_ARM_GDB = 'arm-gdb';

	/**
	 * Finds a program in the system path and returns information about it
	 * @param command The command to check
	 * @param args The arguments to pass to the command (typically for version check)
	 * @param options Additional options
	 * @returns Promise resolving to program information
	 */
	private static async findProgram(
		command: string,
		args: string[] = ['--version'],
		options?: {
			alternativeCommands?: string[],
			versionRegex?: RegExp,
			platformOverrides?: { [platform: string]: string },
			toolId?: string,
			ignoreRunError?: boolean
		}
	): Promise<ProgramInfo> {
		try {
			// Check if there's a custom path configured for this tool
			if (options?.toolId) {
				const customPath = ToolsConfig.getToolPath(options.toolId);
				if (customPath && fs.existsSync(customPath)) {
					this.log.log(`Using custom path for ${options.toolId}: ${customPath}`);

					// Try using the custom path
					const result = await this._tryExecuteCommand(customPath, args, options?.versionRegex, options?.ignoreRunError);
					if (result) {
						result.command = command; // Keep the original command name
						result.path = customPath; // Use the custom path
						return result;
					}

					this.log.log(`Custom path for ${options.toolId} is invalid, falling back to default search`);
				}
			}

			// Apply platform-specific command overrides if provided
			const platform = os.platform();
			if (options?.platformOverrides && options.platformOverrides[platform]) {
				command = options.platformOverrides[platform];
			}

			// Try to execute the command
			const result = await this._tryExecuteCommand(command, args, options?.versionRegex, options?.ignoreRunError);
			if (result) {
				result.command = command;
				return result;
			}

			// If command fails and alternatives are provided, try those
			if (options?.alternativeCommands && options.alternativeCommands.length > 0) {
				for (const altCommand of options.alternativeCommands) {
					this.log.log(`Command ${command} not found, trying alternative ${altCommand}`);
					const altResult = await this._tryExecuteCommand(altCommand, args, options?.versionRegex, options?.ignoreRunError);
					if (altResult) {
						altResult.command = altCommand;
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

	public static async findMavproxy(): Promise<ProgramInfo> {
		// check for mavproxy by platform
		const platform = os.platform();
		if (platform === 'win32' || this.isWSL()) {
			// Windows: check for mavproxy.bat
			return this.findProgram('mavproxy.exe', ['--version'], { toolId: this.TOOL_MAVPROXY });
		} else {
			// Linux: check for mavproxy
			return this.findProgram('mavproxy.py', ['--version'], { toolId: this.TOOL_MAVPROXY });
		}
	}

	public static async findPython(): Promise<ProgramInfo> {
		// check for python by platform
		const platform = os.platform();
		if (platform === 'win32' || this.isWSL()) {
			// Windows: check for python
			return this.findProgram('python.exe', ['--version'], { toolId: this.TOOL_PYTHON });
		} else {
			// Linux: check for python3
			return this.findProgram('python3', ['--version'], { toolId: this.TOOL_PYTHON });
		}
	}

	public static async findCcache(): Promise<ProgramInfo> {
		// check for ccache by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for ccache
			return this.findProgram('ccache', ['-V'], { toolId: this.TOOL_CCACHE });
		}
		return { available: false };
	}

	public static async findOpenOCD(): Promise<ProgramInfo> {
		// check for openocd by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for openocd
			return this.findProgram('openocd', ['--version'], { toolId: this.TOOL_OPENOCD });
		} else if (platform === 'win32') {
			// Windows: check for openocd.exe
			return this.findProgram('openocd.exe', ['--version'], { toolId: this.TOOL_OPENOCD });
		}
		return { available: false };
	}

	public static async findJLinkGDBServerCLExe(): Promise<ProgramInfo> {
		// check for JLinkGDBServerCLExe by platform
		const platform = os.platform();
		if ((platform === 'linux' && !this.isWSL()) || platform === 'darwin') {
			// Linux: check for JLinkGDBServerCLExe
			return this.findProgram('JLinkGDBServerCLExe', ['--version'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/,
				platformOverrides: {
					darwin: 'JLinkGDBServerCLExe'
				},
				toolId: this.TOOL_JLINK
			});
		} else if (platform === 'win32' || this.isWSL()) {
			// Windows: check for JLinkGDBServerCLExe.exe
			return this.findProgram('JLinkGDBServerCL.exe', ['-version', '-nogui'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/,
				toolId: this.TOOL_JLINK,
				ignoreRunError: true
			});
		}
		return { available: false };
	}

	public static async findGCC(): Promise<ProgramInfo> {
		// check for gcc by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for gcc
			return this.findProgram('gcc', ['--version'], { toolId: this.TOOL_GCC });
		} else if (platform === 'win32') {
			// Windows: check for gcc.exe
			return this.findProgram('gcc.exe', ['--version'], { toolId: this.TOOL_GCC });
		}
		return { available: false };
	}

	public static async findGPP(): Promise<ProgramInfo> {
		// check for g++ by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for g++
			return this.findProgram('g++', ['--version'], { toolId: this.TOOL_GPP });
		} else if (platform === 'win32') {
			// Windows: check for g++.exe
			return this.findProgram('g++.exe', ['--version'], { toolId: this.TOOL_GPP });
		}
		return { available: false };
	}

	public static async findGDB(): Promise<ProgramInfo> {
		// check for gdb by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for gdb
			return this.findProgram('gdb', ['--version'], { toolId: this.TOOL_GDB });
		} else if (platform === 'win32') {
			// Windows: check for gdb.exe
			return this.findProgram('gdb.exe', ['--version'], { toolId: this.TOOL_GDB });
		}
		return { available: false };
	}

	// find arm-none-eabi-gcc and arm-none-eabi-g++
	public static async findArmGCC(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gcc by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-gcc
			return this.findProgram('arm-none-eabi-gcc', ['--version'], { toolId: this.TOOL_ARM_GCC });
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-gcc.exe
			return this.findProgram('arm-none-eabi-gcc.exe', ['--version'], { toolId: this.TOOL_ARM_GCC });
		}
		return { available: false };
	}

	// find arm-none-eabi-gcc and arm-none-eabi-g++
	public static async findArmGPP(): Promise<ProgramInfo> {
		// check for arm-none-eabi-g++ by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-g++
			return this.findProgram('arm-none-eabi-g++', ['--version'], { toolId: this.TOOL_ARM_GPP });
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-g++.exe
			return this.findProgram('arm-none-eabi-g++.exe', ['--version'], { toolId: this.TOOL_ARM_GPP });
		}
		return { available: false };
	}

	// find arm-none-eabi-gdb or gdb-multiarch
	public static async findArmGDB(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gdb by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-gdb
			return this.findProgram('arm-none-eabi-gdb', ['--version'], {
				alternativeCommands: ['gdb-multiarch'],
				toolId: this.TOOL_ARM_GDB
			});
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-gdb.exe
			return this.findProgram('arm-none-eabi-gdb.exe', ['--version'], {
				alternativeCommands: ['gdb-multiarch.exe'],
				toolId: this.TOOL_ARM_GDB
			});
		}
		return { available: false };
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
		versionRegex?: RegExp,
		ignoreRunError = false
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
					if (code === 0 || ignoreRunError) {
						// Tool exists, now find its path if it's not a custom path
						// If command includes a path separator, it's likely a custom path
						const isCustomPath = command.includes('/') || command.includes('\\');
						const path = isCustomPath ? command : this.findCommandPath(command);

						// Extract version from output
						const versionOutput = output || errorOutput;
						let version = 'Unknown';

						// Special handling for JLinkGDBServerCL which has a different version format
						if (command.includes('JLinkGDBServerCL')) {
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
	 * Finds the path of a command using 'which' (Linux/Mac) or 'where' (Windows)
	 * @param command The command to find
	 * @returns The path to the command
	 */
	private static findCommandPath(command: string): string {
		try {
			const platform = os.platform();
			const whichCommand = platform === 'win32' ? 'where' : 'which';
			return child_process.execSync(`${whichCommand} ${command}`).toString().trim();
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (error) {
			return 'Unknown';
		}
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

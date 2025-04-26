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
import * as glob from 'fast-glob';
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
	public static readonly TOOL_GDBSERVER = 'gdbserver';
	public static readonly TOOL_PYSERIAL = 'pyserial';

	// usual list of paths for the tools per platform per tool id
	public static readonly TOOL_PATHS: {
		[key: string]: {
			linux: string[];
			win32: string[];
			darwin: string[];
		}
	} = {
			[ProgramUtils.TOOL_PYTHON]:
				{ linux: ['python.exe', 'python3', 'python'], win32: ['python.exe', 'python'], darwin: ['python3', 'python'] },
			[ProgramUtils.TOOL_MAVPROXY]:
				{ linux: ['mavproxy.exe','mavproxy.py'], win32: ['mavproxy.exe'], darwin: ['mavproxy.py'] },
			[ProgramUtils.TOOL_CCACHE]:
				{ linux: ['ccache'], win32: ['ccache.exe'], darwin: ['ccache'] },
			[ProgramUtils.TOOL_OPENOCD]:
				{ linux: ['openocd'], win32: ['openocd.exe'], darwin: ['openocd'] },
			[ProgramUtils.TOOL_JLINK]:
				{ linux: ['/mnt/c/Program Files/SEGGER/JLink/JLinkGDBServerCLExe', //wsl
					'/mnt/c/Program Files (x86)/SEGGER/JLink/JLinkGDBServerCLExe', //wsl
					'/opt/SEGGER/JLink*/JLinkGDBServerCLExe'
				], win32: ['JLinkGDBServerCL.exe',
					'C:\\Program Files\\SEGGER\\JLink\\JLinkGDBServerCL.exe',
					'C:\\Program Files (x86)\\SEGGER\\JLink\\JLinkGDBServerCL.exe'
				], darwin: ['JLinkGDBServerCLExe',
					'/Applications/SEGGER/JLink/JLinkGDBServerCLExe'
				]
				},
			[ProgramUtils.TOOL_GCC]:
				{ linux: ['gcc'], win32: ['gcc.exe'], darwin: ['gcc'] },
			[ProgramUtils.TOOL_GPP]:
				{ linux: ['g++'], win32: ['g++.exe'], darwin: ['g++'] },
			[ProgramUtils.TOOL_GDB]:
				{ linux: ['gdb'], win32: ['gdb.exe'], darwin: ['gdb'] },
			[ProgramUtils.TOOL_ARM_GCC]:
				{ linux: ['arm-none-eabi-gcc'], win32: ['arm-none-eabi-gcc.exe'], darwin: ['arm-none-eabi-gcc'] },
			[ProgramUtils.TOOL_ARM_GPP]:
				{ linux: ['arm-none-eabi-g++'], win32: ['arm-none-eabi-g++.exe'], darwin: ['arm-none-eabi-g++'] },
			[ProgramUtils.TOOL_ARM_GDB]:
				{ linux: ['gdb-multiarch', 'arm-none-eabi-gdb'], win32: ['arm-none-eabi-gdb.exe'], darwin: ['arm-none-eabi-gdb'] },
			[ProgramUtils.TOOL_GDBSERVER]:
				{ linux: ['gdbserver'], win32: ['gdbserver.exe'], darwin: ['gdbserver'] },
		};

	// find the tool path for the tool id
	public static findToolPath(toolId: string): string | undefined {
		const toolPaths = ProgramUtils.TOOL_PATHS[toolId];
		if (!toolPaths) {
			return undefined;
		}
		const platform = os.platform() as 'linux' | 'win32' | 'darwin';
		if (!toolPaths[platform]) {
			return undefined;
		}
		for (const toolPath of toolPaths[platform]) {
			if (toolPath) {
				// Check if the path is a wildcard
				if (toolPath.includes('*')) {
					// Expand the wildcard using glob
					const expandedPaths = glob.sync(toolPath);
					if (expandedPaths.length > 0) {
						return expandedPaths[0]; // Return the first matching path
					}
				} else if (toolPath.includes('?')) {
					// Expand the wildcard using glob
					const expandedPaths = glob.sync(toolPath);
					if (expandedPaths.length > 0) {
						return expandedPaths[0]; // Return the first matching path
					}
				} else if (fs.existsSync(toolPath)) {
					// Check if the path exists
					return toolPath;
				} else {
					// use which or where to find the tool
					const command = platform === 'win32' ? 'where' : 'which';
					try {
						const result = child_process.execSync(`${command} ${toolPath}`).toString().trim();
						if (result) {
							return result; // Return the first matching path
						}
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					catch (error) {
						// Ignore errors, continue searching
					}
				}
			}
		}
		return undefined;
	}

	/**
	 * Finds a program in the system path and returns information about it
	 * @param command The command to check
	 * @param args The arguments to pass to the command (typically for version check)
	 * @param options Additional options
	 * @returns Promise resolving to program information
	 */
	private static async findProgram(
		toolId: string,
		args: string[] = ['--version'],
		options?: {
			versionRegex?: RegExp,
			ignoreRunError?: boolean
		}
	): Promise<ProgramInfo> {
		try {
			// Check if there's a custom path configured for this tool
			const customPath = ToolsConfig.getToolPath(toolId);
			if (customPath && fs.existsSync(customPath)) {
				this.log.log(`Using custom path for ${toolId}: ${customPath}`);

				// Try using the custom path
				const result = await this._tryExecuteCommand(customPath, args, options?.versionRegex, options?.ignoreRunError);
				if (result) {
					result.command = customPath; // Keep the original command name
					result.path = customPath; // Use the custom path
					return result;
				}

				this.log.log(`Custom path for ${toolId} is invalid, falling back to default search`);
			}

			// Try to execute the command
			const command = this.findToolPath(toolId);
			if (!command) {
				this.log.log(`Command ${toolId} not found in system path`);
				return { available: false };
			}
			const result = await this._tryExecuteCommand(command, args, options?.versionRegex, options?.ignoreRunError);
			if (result) {
				result.command = command;
				return result;
			}

			// If we get here, all attempts failed
			return { available: false };
		} catch (error) {
			this.log.log(`Error finding program ${toolId}: ${error}`);
			return { available: false };
		}
	}

	public static async findMavproxy(): Promise<ProgramInfo> {
		// check for mavproxy by platform
		const platform = os.platform();
		if (platform === 'win32' || this.isWSL()) {
			// Windows: check for mavproxy.bat
			return this.findProgram(this.TOOL_MAVPROXY, ['--version']);
		} else {
			// Linux: check for mavproxy
			return this.findProgram(this.TOOL_MAVPROXY, ['--version']);
		}
	}

	public static async findPython(): Promise<ProgramInfo> {
		// check for python by platform
		const platform = os.platform();
		if (platform === 'win32' || this.isWSL()) {
			// Windows: check for python
			return this.findProgram(this.TOOL_PYTHON, ['--version']);
		} else {
			// Linux: check for python3
			return this.findProgram(this.TOOL_PYTHON, ['--version']);
		}
	}

	public static async findCcache(): Promise<ProgramInfo> {
		// check for ccache by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for ccache
			return this.findProgram(this.TOOL_CCACHE, ['-V']);
		}
		return { available: false };
	}

	public static async findOpenOCD(): Promise<ProgramInfo> {
		// check for openocd by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for openocd
			return this.findProgram(this.TOOL_OPENOCD, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for openocd.exe
			return this.findProgram(this.TOOL_OPENOCD, ['--version']);
		}
		return { available: false };
	}

	public static async findJLinkGDBServerCLExe(): Promise<ProgramInfo> {
		// check for JLinkGDBServerCLExe by platform
		const platform = os.platform();
		if ((platform === 'linux' && !this.isWSL()) || platform === 'darwin') {
			// Linux: check for JLinkGDBServerCLExe
			return this.findProgram(this.TOOL_JLINK, ['--version'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/
			});
		} else if (platform === 'win32' || this.isWSL()) {
			// Windows: check for JLinkGDBServerCLExe.exe
			return this.findProgram(this.TOOL_JLINK, ['-version', '-nogui'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/,
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
			return this.findProgram(this.TOOL_GCC, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for gcc.exe
			return this.findProgram(this.TOOL_GCC, ['--version']);
		}
		return { available: false };
	}

	public static async findGPP(): Promise<ProgramInfo> {
		// check for g++ by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for g++
			return this.findProgram(this.TOOL_GPP, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for g++.exe
			return this.findProgram(this.TOOL_GPP, ['--version']);
		}
		return { available: false };
	}

	public static async findGDB(): Promise<ProgramInfo> {
		// check for gdb by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for gdb
			return this.findProgram(this.TOOL_GDB, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for gdb.exe
			return this.findProgram(this.TOOL_GDB, ['--version']);
		}
		return { available: false };
	}

	// find arm-none-eabi-gcc and arm-none-eabi-g++
	public static async findArmGCC(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gcc by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-gcc
			return this.findProgram(this.TOOL_ARM_GCC, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-gcc.exe
			return this.findProgram(this.TOOL_ARM_GCC, ['--version']);
		}
		return { available: false };
	}

	// find arm-none-eabi-gcc and arm-none-eabi-g++
	public static async findArmGPP(): Promise<ProgramInfo> {
		// check for arm-none-eabi-g++ by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-g++
			return this.findProgram(this.TOOL_ARM_GPP, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-g++.exe
			return this.findProgram(this.TOOL_ARM_GPP, ['--version']);
		}
		return { available: false };
	}

	// find arm-none-eabi-gdb or gdb-multiarch
	public static async findArmGDB(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gdb by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for arm-none-eabi-gdb
			return this.findProgram(this.TOOL_ARM_GDB, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for arm-none-eabi-gdb.exe
			return this.findProgram(this.TOOL_ARM_GDB, ['--version']);
		}
		return { available: false };
	}

	// find gdbserver
	public static async findGDBServer(): Promise<ProgramInfo> {
		// check for gdbserver by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux: check for gdbserver
			return this.findProgram(this.TOOL_GDBSERVER, ['--version']);
		} else if (platform === 'win32') {
			// Windows: check for gdbserver.exe
			return this.findProgram(this.TOOL_GDBSERVER, ['--version']);
		}
		return { available: false };
	}

	public static async findPyserial(): Promise<ProgramInfo> {
		try {
			const pythonInfo = await this.findPython();
			if (!pythonInfo.available) {
				// If Python is not available, include the installation instructions
				// but for Python first, then pyserial
				const platform = os.platform();
				let installInstructions = '';

				// Python install instructions based on platform
				if (platform === 'win32' || this.isWSL()) {
					installInstructions = 'Please install Python first, then run: pip.exe install pyserial';
				} else {
					installInstructions = 'Please install Python first, then run: pip install pyserial';
				}

				return {
					available: false,
					info: installInstructions
				};
			}

			// Use Python to check for pyserial module
			const pythonCmd = pythonInfo.path || (os.platform() === 'win32' ? 'python.exe' : 'python3');
			const cmd = `${pythonCmd} -c "import serial; print('Serial module version:', serial.__version__)"`;

			return new Promise<ProgramInfo>((resolve) => {
				child_process.exec(cmd, (error, stdout) => {
					if (error) {
						this.log.log(`Pyserial check failed: ${error}`);

						// Provide platform-specific installation instructions
						const platform = os.platform();
						let installInstructions = '';

						if (platform === 'win32' || this.isWSL()) {
							installInstructions = 'To install pyserial, run: pip.exe install pyserial';
						} else {
							installInstructions = 'To install pyserial, run: pip install pyserial';
						}

						resolve({
							available: false,
							info: installInstructions
						});
						return;
					}

					const versionMatch = stdout.match(/Serial module version: ([\d.]+)/);
					const version = versionMatch ? versionMatch[1] : 'Unknown';

					resolve({
						available: true,
						version,
						path: pythonInfo.path,
						info: 'Detected in Python installation'
					});
				});
			});
		} catch (error) {
			this.log.log(`Error finding pyserial: ${error}`);

			// Provide platform-specific installation instructions on error as well
			const platform = os.platform();
			let installInstructions = '';

			if (platform === 'win32' || this.isWSL()) {
				installInstructions = 'To install pyserial, run: pip.exe install pyserial';
			} else {
				installInstructions = 'To install pyserial, run: pip install pyserial';
			}

			return {
				available: false,
				info: installInstructions
			};
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

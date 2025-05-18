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
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as glob from 'fast-glob';
import { ToolsConfig } from './apToolsConfig';
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
	public static readonly TOOL_PYTHON_WIN = 'python_win'; // Renamed ID for Windows Python used in WSL
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
            darwin: string[];
        }
    } = {
			[ProgramUtils.TOOL_PYTHON]:
				{ linux: ['python3', 'python'], darwin: ['python3', 'python'] },
			[ProgramUtils.TOOL_PYTHON_WIN]: // Paths for Python when in WSL (still 'linux' platform, but targeting Windows Python)
				{ linux: ['python.exe'], darwin: [] }, // WSL python.exe often in path
			[ProgramUtils.TOOL_MAVPROXY]:
				{ linux: ['mavproxy.exe','mavproxy.py'], darwin: ['mavproxy.py'] },
			[ProgramUtils.TOOL_CCACHE]:
				{ linux: ['ccache'], darwin: ['ccache'] },
			[ProgramUtils.TOOL_OPENOCD]:
				{ linux: ['openocd'], darwin: ['openocd'] },
			[ProgramUtils.TOOL_JLINK]:
				{ linux: ['/mnt/c/Program Files/SEGGER/JLink/JLinkGDBServerCLExe', //wsl
					'/mnt/c/Program Files (x86)/SEGGER/JLink/JLinkGDBServerCLExe', //wsl
					'/opt/SEGGER/JLink*/JLinkGDBServerCLExe'
				], darwin: ['JLinkGDBServerCLExe',
					'/Applications/SEGGER/JLink/JLinkGDBServerCLExe'
				]
				},
			[ProgramUtils.TOOL_GCC]:
				{ linux: ['gcc'], darwin: ['gcc'] },
			[ProgramUtils.TOOL_GPP]:
				{ linux: ['g++'], darwin: ['g++'] },
			[ProgramUtils.TOOL_GDB]:
				{ linux: ['gdb'], darwin: ['gdb'] },
			[ProgramUtils.TOOL_ARM_GCC]:
				{ linux: ['arm-none-eabi-gcc'], darwin: ['arm-none-eabi-gcc'] },
			[ProgramUtils.TOOL_ARM_GPP]:
				{ linux: ['arm-none-eabi-g++'], darwin: ['arm-none-eabi-g++'] },
			[ProgramUtils.TOOL_ARM_GDB]:
				{ linux: ['gdb-multiarch', 'arm-none-eabi-gdb'], darwin: ['arm-none-eabi-gdb'] },
			[ProgramUtils.TOOL_GDBSERVER]:
				{ linux: ['gdbserver'], darwin: ['gdbserver'] },
		};

	// find the tool path for the tool id
	public static findToolPath(toolId: string): string | undefined {
		const toolPaths = ProgramUtils.TOOL_PATHS[toolId];
		if (!toolPaths) {
			return undefined;
		}
		const platform = os.platform() as 'linux' | 'darwin';
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
					try {
						const result = child_process.execSync(`which ${toolPath}`).toString().trim();
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
		// check for mavproxy
		return this.findProgram(this.TOOL_MAVPROXY, ['--version']);
	}

	public static async findPython(): Promise<ProgramInfo> {
		// First check if there's a Python interpreter configured via the Microsoft Python extension
		try {
			const pythonExtension = vscode.extensions.getExtension('ms-python.python');
			if (pythonExtension && pythonExtension.isActive) {
				const pythonApi = pythonExtension.exports;
				const interpreterPath = pythonApi.settings.getExecutionDetails().execCommand[0];

				if (interpreterPath && fs.existsSync(interpreterPath)) {
					this.log.log(`Using Python interpreter from MS Python extension: ${interpreterPath}`);

					// Try using this interpreter
					const result = await this._tryExecuteCommand(interpreterPath, ['--version']);
					if (result) {
						result.command = interpreterPath;
						result.path = interpreterPath;
						result.info = 'Selected via Microsoft Python Extension';
						return result;
					}
				}
			}
		} catch (error) {
			this.log.log(`Error getting Python interpreter from extension: ${error}`);
			// Fall back to standard search
		}

		// Fall back to standard Python search
		return this.findProgram(this.TOOL_PYTHON, ['--version']);
	}

	public static async findPythonWin(): Promise<ProgramInfo> {
		// check for python in WSL
		return this.findProgram(this.TOOL_PYTHON_WIN, ['--version']);
	}

	public static async findCcache(): Promise<ProgramInfo> {
		// check for ccache by platform
		const platform = os.platform();
		if (platform === 'linux' || platform === 'darwin') {
			// Linux/Darwin: check for ccache
			return this.findProgram(this.TOOL_CCACHE, ['-V']);
		}
		return { available: false };
	}

	public static async findOpenOCD(): Promise<ProgramInfo> {
		// check for openocd
		return this.findProgram(this.TOOL_OPENOCD, ['--version']);
	}

	public static async findJLinkGDBServerCLExe(): Promise<ProgramInfo> {
		// check for JLinkGDBServerCLExe by platform
		const platform = os.platform();
		if ((platform === 'linux' && !this.isWSL()) || platform === 'darwin') {
			// Linux/Darwin: check for JLinkGDBServerCLExe
			return this.findProgram(this.TOOL_JLINK, ['--version'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/
			});
		} else if (this.isWSL()) {
			// Windows/WSL: check for JLinkGDBServerCLExe.exe
			return this.findProgram(this.TOOL_JLINK, ['-version', '-nogui'], {
				versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/,
				ignoreRunError: true
			});
		}
		return { available: false };
	}

	public static async findGCC(): Promise<ProgramInfo> {
		// check for gcc
		return this.findProgram(this.TOOL_GCC, ['--version']);
	}

	public static async findGPP(): Promise<ProgramInfo> {
		// check for g++
		return this.findProgram(this.TOOL_GPP, ['--version']);
	}

	public static async findGDB(): Promise<ProgramInfo> {
		// check for gdb
		return this.findProgram(this.TOOL_GDB, ['--version']);
	}

	// find arm-none-eabi-gcc
	public static async findArmGCC(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gcc
		return this.findProgram(this.TOOL_ARM_GCC, ['--version']);
	}

	// find arm-none-eabi-g++
	public static async findArmGPP(): Promise<ProgramInfo> {
		// check for arm-none-eabi-g++
		return this.findProgram(this.TOOL_ARM_GPP, ['--version']);
	}

	// find arm-none-eabi-gdb or gdb-multiarch
	public static async findArmGDB(): Promise<ProgramInfo> {
		// check for arm-none-eabi-gdb/gdb-multiarch
		return this.findProgram(this.TOOL_ARM_GDB, ['--version']);
	}

	// find gdbserver
	public static async findGDBServer(): Promise<ProgramInfo> {
		// check for gdbserver
		return this.findProgram(this.TOOL_GDBSERVER, ['--version']);
	}

	public static async findPyserial(): Promise<ProgramInfo> {
		try {
			let pythonInfo = await this.findPython();
			if (this.isWSL()) {
				pythonInfo = await this.findPythonWin(); // Use Windows Python in WSL
			}
			if (!pythonInfo.available || !pythonInfo.command) { // Check for command
				// If Python is not available, include the installation instructions
				// but for Python first, then pyserial
				let installInstructions = '';

				// Python install instructions based on platform
				if (this.isWSL()) {
					installInstructions = 'Please install Python first (e.g., python.exe accessible from WSL, or a Linux Python in WSL), then run: <python_cmd> -m pip install pyserial';
				} else {
					installInstructions = 'Please install Python first, then run: python3 -m pip install pyserial';
				}

				return {
					available: false,
					info: installInstructions
				};
			}

			// Use Python to check for pyserial module
			const pythonCmd = pythonInfo.command; // Use the command from pythonInfo
			const cmd = `${pythonCmd} -c "import serial; print('Serial module version:', serial.__version__)"`;

			return new Promise<ProgramInfo>((resolve) => {
				child_process.exec(cmd, (error, stdout) => {
					if (error) {
						this.log.log(`Pyserial check failed: ${error}`);

						// Provide platform-specific installation instructions
						let installInstructions = '';

						if (this.isWSL()) {
							installInstructions = `To install pyserial, run: ${pythonCmd} -m pip install pyserial (or pip.exe install pyserial if using Windows Python)`;
						} else {
							installInstructions = `To install pyserial, run: ${pythonCmd} -m pip install pyserial`;
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
			let installInstructions = '';

			if (this.isWSL()) {
				installInstructions = 'To install pyserial, run: pip.exe install pyserial or <python_cmd> -m pip install pyserial';
			} else {
				installInstructions = 'To install pyserial, run: pip install pyserial or python3 -m pip install pyserial';
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
			return child_process.execSync(`which ${command}`).toString().trim();
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (error) {
			return 'Unknown';
		}
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

	/**
	 * Opens the Python interpreter selection dialog using Microsoft's Python extension
	 * and returns the selected interpreter path
	 * @returns Promise resolving to the selected Python interpreter path or undefined if cancelled
	 */
	public static async selectPythonInterpreter(): Promise<string | undefined> {
		this.log.log('Opening Python interpreter selection dialog');

		// Check if ms-python.python extension is installed and active
		const pythonExtension = vscode.extensions.getExtension('ms-python.python');
		if (!pythonExtension) {
			vscode.window.showErrorMessage('Microsoft Python extension is not installed. Please install it to use this feature.');
			return undefined;
		}

		if (!pythonExtension.isActive) {
			this.log.log('Activating Python extension');
			await pythonExtension.activate();
		}

		try {
			// Show the interpreter picker
			await vscode.commands.executeCommand('python.setInterpreter');

			// Get the selected interpreter path after the user makes a selection
			// Access the path properly based on the Python extension API
			const selectedInterpreter = await this.findPython();

			if (selectedInterpreter) {
				this.log.log(`Selected Python interpreter: ${selectedInterpreter}`);
				return selectedInterpreter.path; // Return the path of the selected interpreter
			} else {
				this.log.log('No Python interpreter selected');
				return undefined;
			}
		} catch (error) {
			this.log.log(`Error selecting Python interpreter: ${error}`);
			vscode.window.showErrorMessage(`Failed to select Python interpreter: ${error}`);
			return undefined;
		}
	}

	/**
	 * Gets the path of the currently selected Python interpreter from the Python extension API
	 * @param pythonApi The Python extension API
	 * @returns Promise resolving to the interpreter path or undefined if not available
	 */
	private static async getPythonInterpreterPath(pythonApi: unknown): Promise<string | undefined> {
		try {
			this.log.log('Getting Python interpreter path');

			// Type guard and safe access patterns for the Python API
			if (!pythonApi || typeof pythonApi !== 'object') {
				return undefined;
			}

			// Try the newer API structure first (settings.getActiveInterpreterPath)
			if ('settings' in pythonApi &&
				pythonApi.settings &&
				typeof pythonApi.settings === 'object' &&
				'getActiveInterpreterPath' in pythonApi.settings) {

				const getPath = (pythonApi.settings as { getActiveInterpreterPath: () => string }).getActiveInterpreterPath;
				if (typeof getPath === 'function') {
					const path = getPath();
					if (path && typeof path === 'string') {
						this.log.log(`Found interpreter via getActiveInterpreterPath: ${path}`);
						return path;
					}
				}
			}

			// Try alternative API path (environments.getActiveEnvironmentPath)
			if ('environments' in pythonApi &&
				pythonApi.environments &&
				typeof pythonApi.environments === 'object' &&
				'getActiveEnvironmentPath' in pythonApi.environments) {

				const getEnvPath = (pythonApi.environments as {
					getActiveEnvironmentPath: () => Promise<{ path: string }>
				}).getActiveEnvironmentPath;

				if (typeof getEnvPath === 'function') {
					try {
						const envPath = await getEnvPath();
						if (envPath && typeof envPath === 'object' && 'path' in envPath) {
							this.log.log(`Found interpreter via getActiveEnvironmentPath: ${envPath.path}`);
							return envPath.path as string;
						}
					} catch (e) {
						this.log.log(`Error getting environment path: ${e}`);
					}
				}
			}

			// Fall back to VS Code settings
			const pythonConfig = vscode.workspace.getConfiguration('python');
			const defaultPath = pythonConfig.get<string>('defaultInterpreterPath');
			if (defaultPath) {
				this.log.log(`Found interpreter via settings (defaultInterpreterPath): ${defaultPath}`);
				return defaultPath;
			}

			const legacyPath = pythonConfig.get<string>('pythonPath');
			if (legacyPath) {
				this.log.log(`Found interpreter via settings (pythonPath): ${legacyPath}`);
				return legacyPath;
			}

			this.log.log('Could not determine Python interpreter path from extension API');
			return undefined;
		} catch (error) {
			this.log.log(`Error getting Python interpreter path: ${error}`);
			return undefined;
		}
	}
}

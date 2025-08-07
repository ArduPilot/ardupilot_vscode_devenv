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
import * as path from 'path';
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
	/** Whether this program is using a custom configured path */
	isCustomPath: boolean;
}

/**
 * Utilities for working with external programs
 */
export class ProgramUtils {
	private static log = new apLog('ProgramUtils');

	// Cache for tool paths from last full findTool call
	private static toolPathCache = new Map<string, string>();

	/**
     * Tool IDs enum for configuration
     */
	public static readonly ToolId = {
		PYTHON: 'python',
		PYTHON_WIN: 'python_win', // Renamed ID for Windows Python used in WSL
		MAVPROXY: 'mavproxy',
		CCACHE: 'ccache',
		OPENOCD: 'openocd',
		JLINK: 'JLinkGDBServerCL',
		GCC: 'gcc',
		GPP: 'g++',
		GDB: 'gdb',
		ARM_GCC: 'arm-gcc',
		ARM_GPP: 'arm-g++',
		ARM_GDB: 'arm-gdb',
		GDBSERVER: 'gdbserver',
		PYSERIAL: 'pyserial',
		TMUX: 'tmux',
		LSUSB: 'lsusb'
	} as const;

	/**
     * Tool IDs for configuration (legacy constants for backward compatibility)
     */
	public static readonly TOOL_PYTHON = ProgramUtils.ToolId.PYTHON;
	public static readonly TOOL_PYTHON_WIN = ProgramUtils.ToolId.PYTHON_WIN;
	public static readonly TOOL_MAVPROXY = ProgramUtils.ToolId.MAVPROXY;
	public static readonly TOOL_CCACHE = ProgramUtils.ToolId.CCACHE;
	public static readonly TOOL_OPENOCD = ProgramUtils.ToolId.OPENOCD;
	public static readonly TOOL_JLINK = ProgramUtils.ToolId.JLINK;
	public static readonly TOOL_GCC = ProgramUtils.ToolId.GCC;
	public static readonly TOOL_GPP = ProgramUtils.ToolId.GPP;
	public static readonly TOOL_GDB = ProgramUtils.ToolId.GDB;
	public static readonly TOOL_ARM_GCC = ProgramUtils.ToolId.ARM_GCC;
	public static readonly TOOL_ARM_GPP = ProgramUtils.ToolId.ARM_GPP;
	public static readonly TOOL_ARM_GDB = ProgramUtils.ToolId.ARM_GDB;
	public static readonly TOOL_GDBSERVER = ProgramUtils.ToolId.GDBSERVER;
	public static readonly TOOL_PYSERIAL = ProgramUtils.ToolId.PYSERIAL;
	public static readonly TOOL_TMUX = ProgramUtils.ToolId.TMUX;
	public static readonly TOOL_LSUSB = ProgramUtils.ToolId.LSUSB;

	// Python packages for ArduPilot
	public static readonly REQUIRED_PYTHON_PACKAGES: readonly {
		readonly name: string;
		readonly version?: string;
		readonly description: string;
	}[] = [
		{ name: 'empy', version: '3.3.4', description: 'Template engine for code generation' },
		{ name: 'future', description: 'Python 2/3 compatibility' },
		{ name: 'pymavlink', description: 'MAVLink protocol implementation' },
		{ name: 'lxml', description: 'XML processing for MAVLink' },
		{ name: 'pexpect', description: 'Process control and automation' },
		{ name: 'dronecan', description: 'DroneCAN protocol implementation' },
		{ name: 'pyserial', description: 'Serial communication library' },
		{ name: 'setuptools', description: 'Python package development utilities (provides pkg_resources)' }
	] as const;

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
				{ linux: ['/mnt/c/Program Files/SEGGER/JLink*/JLinkGDBServerCL.exe', //wsl
					'/mnt/c/Program Files (x86)/SEGGER/JLink*/JLinkGDBServerCL.exe', //wsl
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
				{ linux: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-gcc'], darwin: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-gcc'] },
			[ProgramUtils.TOOL_ARM_GPP]:
				{ linux: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-g++'], darwin: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-g++'] },
			[ProgramUtils.TOOL_ARM_GDB]:
				{ linux: ['gdb-multiarch', 'arm-none-eabi-gdb'], darwin: ['arm-none-eabi-gdb'] },
			[ProgramUtils.TOOL_GDBSERVER]:
				{ linux: ['gdbserver'], darwin: ['gdbserver'] },
			[ProgramUtils.TOOL_TMUX]:
				{ linux: ['tmux'], darwin: ['tmux'] },
			[ProgramUtils.TOOL_LSUSB]:
				{ linux: ['lsusb'], darwin: [] }, // lsusb is Linux-specific
		};

	// find the tool path for the tool id
	private static findToolPath(toolId: string): string | undefined {
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
						ProgramUtils.log.log(`which ${toolPath} : ${result}`);
						if (result) {
							return result; // Return the first matching path
						}
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					catch (error) {
						// Ignore errors, continue searching
						ProgramUtils.log.log(`Error finding tool ${toolPath}: ${error}`);
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
					result.isCustomPath = true; // Mark as custom path
					return result;
				}

				this.log.log(`Custom path for ${toolId} is invalid, falling back to default search`);
			}

			// Try to execute the command
			const command = this.findToolPath(toolId);
			if (!command) {
				this.log.log(`Command ${toolId} not found in system path`);
				return { available: false, isCustomPath: false };
			}
			const result = await this._tryExecuteCommand(command, args, options?.versionRegex, options?.ignoreRunError);
			if (result) {
				result.command = command;
				result.isCustomPath = false; // Mark as system path
				return result;
			}

			// If we get here, all attempts failed
			return { available: false, isCustomPath: false };
		} catch (error) {
			this.log.log(`Error finding program ${toolId}: ${error}`);
			return { available: false, isCustomPath: false };
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
						result.isCustomPath = false; // Extension-selected, not custom path
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
		return { available: false, isCustomPath: false };
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
		return { available: false, isCustomPath: false };
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
					info: installInstructions,
					isCustomPath: false
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
							info: installInstructions,
							isCustomPath: false
						});
						return;
					}

					const versionMatch = stdout.match(/Serial module version: ([\d.]+)/);
					const version = versionMatch ? versionMatch[1] : 'Unknown';

					resolve({
						available: true,
						version,
						path: pythonInfo.path,
						info: 'Detected in Python installation',
						isCustomPath: pythonInfo.isCustomPath || false
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
				info: installInstructions,
				isCustomPath: false
			};
		}
	}

	// find tmux
	public static async findTmux(): Promise<ProgramInfo> {
		// check for tmux
		return this.findProgram(this.TOOL_TMUX, ['-V']);
	}

	// find lsusb
	public static async findLsusb(): Promise<ProgramInfo> {
		// lsusb is only available on Linux
		const platform = os.platform();
		if (platform === 'linux') {
			const result = await this.findProgram(this.TOOL_LSUSB, ['-V'], {
				versionRegex: /lsusb\s+(\S+)/
			});

			// If lsusb is not available, provide installation instructions
			if (!result.available) {
				return {
					available: false,
					info: 'To install lsusb, run: sudo apt-get install usbutils',
					isCustomPath: false
				};
			}

			return result;
		}
		return { available: false, info: 'lsusb is only available on Linux systems', isCustomPath: false };
	}

	/**
	 * Check for Python package using pip show command
	 * @param packageName The name of the Python package to check
	 * @returns Promise with package information
	 */
	public static async checkPythonPackage(packageName: string): Promise<ProgramInfo> {
		try {
			const pythonInfo = await this.findPython();
			if (!pythonInfo.available || !pythonInfo.command) {
				return {
					available: false,
					info: `Python not available. Please install Python first, then run: pip install ${packageName}`,
					isCustomPath: false
				};
			}

			const pythonCmd = pythonInfo.command;
			// Use pip show to check if package is installed
			const cmd = `${pythonCmd} -m pip show ${packageName}`;

			return new Promise<ProgramInfo>((resolve) => {
				child_process.exec(cmd, (error, stdout) => {
					if (error) {
						resolve({
							available: false,
							info: `To install ${packageName}, run: ${pythonCmd} -m pip install ${packageName}`,
							isCustomPath: false
						});
						return;
					}

					// Extract version from pip show output
					const versionMatch = stdout.match(/Version: ([\d.\w-]+)/);
					const version = versionMatch ? versionMatch[1] : 'Unknown';

					resolve({
						available: true,
						version,
						path: pythonInfo.path,
						info: `Installed via pip in Python ${pythonInfo.version}`,
						isCustomPath: pythonInfo.isCustomPath || false
					});
				});
			});
		} catch (error) {
			this.log.log(`Error checking Python package ${packageName}: ${error}`);
			return {
				available: false,
				info: `Error checking package. Run: pip install ${packageName}`,
				isCustomPath: false
			};
		}
	}

	/**
	 * Check all required Python packages
	 * @returns Promise with array of package check results
	 */
	public static async checkAllPythonPackages(): Promise<Array<{packageName: string, result: ProgramInfo}>> {
		const results = [];
		for (const pkg of this.REQUIRED_PYTHON_PACKAGES) {
			const result = await this.checkPythonPackage(pkg.name);
			results.push({ packageName: pkg.name, result });
		}
		return results;
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
							// Try to match major.minor.patch format first
							const versionMatchFull = versionOutput.match(/(\d+\.\d+\.\d+)/);
							if (versionMatchFull) {
								version = versionMatchFull[1];
							} else {
								// Fall back to major.minor format
								const versionMatchPartial = versionOutput.match(/(\d+\.\d+)/);
								if (versionMatchPartial) {
									version = versionMatchPartial[1];
								}
							}
						}

						resolve({
							available: true,
							version,
							path,
							isCustomPath: false // Will be set by calling function
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
	 * Adds venv-ardupilot to the VS Code Python extension's venvFolders list if it exists
	 * @returns Promise resolving to true if venv-ardupilot was added, false otherwise
	 */
	public static async configureVenvArdupilot(): Promise<boolean> {
		// Get the workspace folder
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			this.log.log('No workspace folder found');
			return false;
		}

		// Check if venv-ardupilot exists
		const venvDir = path.join(workspaceFolder.uri.fsPath, 'venv-ardupilot');
		const pythonExe = path.join(venvDir, 'bin', 'python');

		if (!fs.existsSync(venvDir) || !fs.existsSync(pythonExe)) {
			this.log.log('venv-ardupilot not found');
			return false;
		}

		this.log.log(`Found venv-ardupilot at: ${venvDir}`);

		try {
			const config = vscode.workspace.getConfiguration('python', workspaceFolder.uri);

			// Get current venvFolders setting
			const currentVenvFolders = config.get<string[]>('venvFolders') || [];

			// Check if venv-ardupilot directory is already in the list
			if (!currentVenvFolders.includes(venvDir)) {
				// Add venv-ardupilot directory to venvFolders so VS Code can discover it
				const updatedVenvFolders = [...currentVenvFolders, venvDir];
				await config.update('venvFolders', updatedVenvFolders, vscode.ConfigurationTarget.Global);

				this.log.log(`Added ${venvDir} to Python venvFolders list`);

				return true;
			} else {
				this.log.log(`${venvDir} already in venvFolders list`);
				return false;
			}
		} catch (error) {
			this.log.log(`Error configuring venv-ardupilot: ${error}`);
			return false;
		}
	}

	/**
	 * Finds a tool and returns its information including custom path status
	 * Also updates the tool path cache for fast synchronous access
	 * @param toolId The ID of the tool to find
	 * @returns Promise resolving to program information
	 */
	public static async findTool(toolId: string): Promise<ProgramInfo> {
		let result: ProgramInfo;

		switch (toolId) {
		case this.TOOL_PYTHON:
			result = await this.findPython();
			break;
		case this.TOOL_PYTHON_WIN:
			result = await this.findPythonWin();
			break;
		case this.TOOL_MAVPROXY:
			result = await this.findMavproxy();
			break;
		case this.TOOL_CCACHE:
			result = await this.findCcache();
			break;
		case this.TOOL_OPENOCD:
			result = await this.findOpenOCD();
			break;
		case this.TOOL_JLINK:
			result = await this.findJLinkGDBServerCLExe();
			break;
		case this.TOOL_GCC:
			result = await this.findGCC();
			break;
		case this.TOOL_GPP:
			result = await this.findGPP();
			break;
		case this.TOOL_GDB:
			result = await this.findGDB();
			break;
		case this.TOOL_ARM_GCC:
			result = await this.findArmGCC();
			break;
		case this.TOOL_ARM_GPP:
			result = await this.findArmGPP();
			break;
		case this.TOOL_ARM_GDB:
			result = await this.findArmGDB();
			break;
		case this.TOOL_GDBSERVER:
			result = await this.findGDBServer();
			break;
		case this.TOOL_PYSERIAL:
			result = await this.findPyserial();
			break;
		case this.TOOL_TMUX:
			result = await this.findTmux();
			break;
		case this.TOOL_LSUSB:
			result = await this.findLsusb();
			break;
		default:
			result = { available: false, isCustomPath: false };
		}

		// Cache the tool path for fast synchronous access
		if (result.available && result.path) {
			this.toolPathCache.set(toolId, result.path);
		} else {
			this.toolPathCache.delete(toolId);
		}

		return result;
	}

	/**
	 * Gets cached tool path from the last findTool call
	 * This is synchronous and fast, but may not reflect the latest state
	 * For Python, always fetches fresh from extension to ensure correct interpreter is used
	 * @param toolId The ID of the tool
	 * @returns Cached tool path or undefined if not cached or not available
	 */
	public static cachedToolPath(toolId: string): string | undefined {
		// Special handling for Python - always fetch fresh from extension
		if (toolId === this.TOOL_PYTHON) {
			try {
				const pythonExtension = vscode.extensions.getExtension('ms-python.python');
				if (pythonExtension && pythonExtension.isActive) {
					const pythonApi = pythonExtension.exports;
					const interpreterPath = pythonApi.settings.getExecutionDetails().execCommand[0];

					if (interpreterPath && fs.existsSync(interpreterPath)) {
						this.log.log(`Using fresh Python interpreter from MS Python extension: ${interpreterPath}`);
						return interpreterPath;
					}
				}
			} catch (error) {
				this.log.log(`Error getting fresh Python interpreter from extension: ${error}`);
				// Fall back to cache if extension query fails
			}
		}

		// For all other tools (and Python fallback), use cache
		if (!this.toolPathCache.has(toolId)) {
			ProgramUtils.log.log(`Tool path for ${toolId} not found in cache. Please run findTool first.`);
			throw new Error(`Tool path for ${toolId} not found in cache. Please run findTool first.`);
		}
		return this.toolPathCache.get(toolId);
	}

	/**
	 * Sets the custom path for a tool and updates the cache
	 * @param toolId The ID of the tool
	 * @param path The path to the tool
	 */
	public static async setToolCustomPath(toolId: string, path: string): Promise<void> {
		ToolsConfig.setToolPath(toolId, path);

		// Immediately update the cache with the new path by re-running findTool
		try {
			const result = await this.findTool(toolId);
			if (result.available && result.path) {
				this.log.log(`Updated cached tool ${toolId}: ${result.path}`);
			} else {
				this.log.log(`Failed to update cache for ${toolId} after setting custom path`);
			}
		} catch (error) {
			this.log.log(`Error updating cache for ${toolId}: ${error}`);
		}
	}

	/**
	 * Removes the configured custom path for a tool and updates the cache
	 * @param toolId The ID of the tool
	 */
	public static async removeToolCustomPath(toolId: string): Promise<void> {
		ToolsConfig.removeToolPath(toolId);

		// Immediately update the cache by re-running findTool (will now use system path)
		try {
			const result = await this.findTool(toolId);
			if (result.available && result.path) {
				this.log.log(`Updated cached tool ${toolId} to system path: ${result.path}`);
			} else {
				this.log.log(`Tool ${toolId} not available after removing custom path`);
				// Remove from cache if no longer available
				this.toolPathCache.delete(toolId);
			}
		} catch (error) {
			this.log.log(`Error updating cache for ${toolId}: ${error}`);
			// Remove from cache on error
			this.toolPathCache.delete(toolId);
		}
	}

	/**
	 * Initialize tools cache by calling findTool for all tools
	 * This populates the cache so CC/CXX environment variables are available when tasks are created
	 */
	public static async initializeToolsCache(): Promise<void> {
		this.log.log('Initializing tools cache...');

		// Get all tool IDs from the ToolId object
		const toolIds = Object.values(this.ToolId);

		// Find all tools concurrently to populate cache
		const promises = toolIds.map(async (toolId) => {
			try {
				const result = await this.findTool(toolId);
				if (result.available && result.path) {
					this.log.log(`Cached tool ${toolId}: ${result.path}`);
				}
			} catch (error) {
				this.log.log(`Failed to cache tool ${toolId}: ${error}`);
			}
		});

		try {
			await Promise.all(promises);
			this.log.log('Tools cache initialization completed');
		} catch (error) {
			this.log.log(`Tools cache initialization failed: ${error}`);
		}
	}
}

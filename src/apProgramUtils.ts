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
import * as apToolsConfig from './apToolsConfig';
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

	// find the tool path for the tool using the registry
	private static findToolPath(toolInfo: apToolsConfig.ToolInfo): string | undefined {

		const platform = os.platform() as 'linux' | 'darwin';
		const isWSL = this.isWSL();

		// Get the appropriate paths based on platform
		let paths: readonly string[] | undefined;
		if (isWSL && toolInfo.paths.wsl) {
			paths = toolInfo.paths.wsl;
		} else if (toolInfo.paths[platform]) {
			paths = toolInfo.paths[platform];
		} else {
			paths = undefined;
		}

		if (!paths) {
			return undefined;
		}

		for (const toolPath of paths) {
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
	public static async findProgram(
		toolInfo: apToolsConfig.ToolInfo
	): Promise<ProgramInfo> {
		try {
			// Special handling for specific tools
			if (toolInfo.name === 'Python') {
				// Try VS Code extension first, fall through to default logic if not found
				const vscodeResult = await this.findVSCodeExtPython();
				if (vscodeResult.available) {
					return vscodeResult;
				}
				// Fall through to default logic below
			}

			// Default handling for all other tools
			if (!toolInfo || !toolInfo.findArgs) {
				this.log.log(`Tool ${toolInfo.name} has no findArgs`);
				return { available: false, isCustomPath: false };
			}

			const args = toolInfo.findArgs.args;
			const versionRegex = toolInfo.findArgs.versionRegex;

			// Check if there's a custom path configured for this tool
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const customPath = apToolsConfig.ToolsConfig.getToolPath(toolInfo.id! as apToolsConfig.ToolID);
			if (customPath && fs.existsSync(customPath)) {
				this.log.log(`Using custom path for ${toolInfo.name}: ${customPath}`);

				// Try using the custom path
				const result = await this._tryExecuteCommand(customPath, args, versionRegex);
				if (result) {
					result.command = customPath; // Keep the original command name
					result.path = customPath; // Use the custom path
					result.isCustomPath = true; // Mark as custom path
					return result;
				}

				this.log.log(`Custom path for ${toolInfo.name} is invalid, falling back to default search`);
			}

			// Try to execute the command
			const command = this.findToolPath(toolInfo);
			if (!command) {
				this.log.log(`Command ${toolInfo.name} not found in system path`);
				return { available: false, isCustomPath: false };
			}
			const result = await this._tryExecuteCommand(command, args, versionRegex);
			if (result) {
				result.command = command;
				result.isCustomPath = false; // Mark as system path
				return result;
			}

			// If we get here, all attempts failed
			return { available: false, isCustomPath: false };
		} catch (error) {
			this.log.log(`Error finding program ${toolInfo.name}: ${error}`);
			return { available: false, isCustomPath: false };
		}
	}

	private static async findVSCodeExtPython(): Promise<ProgramInfo> {
		// Check if there's a Python interpreter configured via the Microsoft Python extension
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
		}

		// Return not available so caller can fall through to default logic
		return { available: false, isCustomPath: false };
	}

	/**
	 * Check for Python package using pip show command
	 * @param packageName The name of the Python package to check
	 * @returns Promise with package information
	 */
	public static async checkPythonPackage(packageName: string): Promise<ProgramInfo> {
		try {
			const pythonInfo = await this.findProgram(apToolsConfig.TOOLS_REGISTRY.PYTHON);
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
		for (const [, pkg] of Object.entries(apToolsConfig.PYTHON_PACKAGES_REGISTRY)) {
			const result = await this.checkPythonPackage((pkg as apToolsConfig.PythonPackageInfo).name);
			results.push({ packageName: (pkg as apToolsConfig.PythonPackageInfo).name, result });
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
		args: readonly string[],
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
			// Access the path via the Python extension's interpreterPath command
			const interpreterPath = await vscode.commands.executeCommand('python.interpreterPath') as string;

			if (interpreterPath) {
				this.log.log(`Selected Python interpreter: ${interpreterPath}`);

				// Save the selected interpreter path to the configuration
				apToolsConfig.ToolsConfig.setToolPath('PYTHON', interpreterPath);

				return interpreterPath; // Return the path of the selected interpreter
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

}

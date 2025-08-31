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
import { TOOLS_REGISTRY } from './apToolsConfig';
import { PythonExtension, Environment as PythonEnv} from '@vscode/python-extension';

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
	private static isWSLCache: boolean | undefined;
	public static pythonEnv: PythonEnv | undefined;

	// find the tool path for the tool using the registry
	private static async findToolPath(toolInfo: apToolsConfig.ToolInfo): Promise<string | undefined> {

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
				} else if (!toolPath.includes('/')) {
					// use which or where to find the tool
					try {
						const found = await this.findCommandPath(toolPath);
						if (found) {
							return found;
						}
					} catch (error) {
						// Ignore errors, continue searching
						ProgramUtils.log.log(`Error finding tool ${toolPath}: ${error}`);
					}
				}
			}
		}
		return undefined;
	}

	public static async PYTHON() : Promise<string> {
		return (await ProgramUtils.findProgram(TOOLS_REGISTRY.PYTHON))?.path || 'python';
	}

	/**
	 * Gets the Python virtual environment activation command if available
	 * @returns Promise resolving to activation command string or null if not in venv
	 */
	public static async getPythonActivateCommand(): Promise<string | null> {
		try {
			const pythonApi = await PythonExtension.api();
			const activeEnvPath = pythonApi.environments.getActiveEnvironmentPath();

			if (activeEnvPath) {
				const environment = await pythonApi.environments.resolveEnvironment(activeEnvPath);

				if (environment?.environment?.type === 'VirtualEnvironment') {
					const venvPath = environment.environment.folderUri?.fsPath || '';
					const activateScript = path.join(venvPath, 'bin', 'activate');

					if (fs.existsSync(activateScript)) {
						ProgramUtils.log.log(`Found virtual environment activation script: ${activateScript}`);
						return `. ${activateScript}`;
					}
				}
			}
		} catch (error) {
			ProgramUtils.log.log(`Failed to get Python environment info: ${error}`);
		}

		return null;
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

			// Check if there's a custom path configured for this tool
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const customPath = apToolsConfig.ToolsConfig.getToolPath(toolInfo.id! as apToolsConfig.ToolID);
			if (customPath && fs.existsSync(customPath)) {
				this.log.log(`Using custom path for ${toolInfo.name}: ${customPath}`);

				// Try using the custom path
				const version = await this.getVersion(toolInfo);
				if (version) {
					return {
						command: customPath,
						path: customPath,
						version,
						isCustomPath: true,
						available: true
					};
				}

				this.log.log(`Custom path for ${toolInfo.name} is invalid, falling back to default search`);
			}

			// Try to execute the command
			const command = await this.findToolPath(toolInfo);
			if (!command) {
				this.log.log(`Command ${toolInfo.name} not found in system path`);
				return { available: false, isCustomPath: false };
			}
			const version = await this.getVersion(toolInfo);
			if (version) {
				return {
					available: true,
					path: command,
					version,
					command: command,
					isCustomPath: false
				};
			}

			// If we get here, all attempts failed
			return { available: false, isCustomPath: false };
		} catch (error) {
			this.log.log(`Error finding program ${toolInfo.name}: ${error}`);
			return { available: false, isCustomPath: false };
		}
	}

	private static async getVersion(tool: apToolsConfig.ToolInfo): Promise<string | undefined> {
		const toolPath = await this.findToolPath(tool);
		if (!toolPath) {
			ProgramUtils.log.log(`Tool ${tool.name} not found`);
			return undefined;
		}
		const result = child_process.spawnSync(toolPath, tool.findArgs?.args, { stdio: 'pipe' });
		const stdoutStr = result.stdout ? result.stdout.toString().trim() : '';
		const stderrStr = result.stderr ? result.stderr.toString().trim() : '';
		if (result.status === 0) {
			// Some tools (e.g., openocd, python) may print version to stderr
			const output = stdoutStr || stderrStr;
			// Use regex to extract version
			const versionMatch = output.match(tool.findArgs?.versionRegex ?? /(\d+\.\d+\.\d+)/);
			return versionMatch ? versionMatch[1] : output;
		}
		return undefined;
	}

	private static async findVSCodeExtPython(): Promise<ProgramInfo> {
		try {
			const pythonApi = await PythonExtension.api();
			await pythonApi.ready;
			const environmentPath = pythonApi.environments.getActiveEnvironmentPath();

			if (environmentPath && environmentPath.path) {
				const environment = await pythonApi.environments.resolveEnvironment(environmentPath);

				if (environment && environment.executable && environment.executable.uri) {
					const interpreterPath = environment.executable.uri.fsPath;
					this.pythonEnv = environment;

					if (fs.existsSync(interpreterPath)) {
						this.log.log(`Using Python interpreter from Python extension: ${interpreterPath}`);

						const result = child_process.spawnSync(interpreterPath, ['--version'], { stdio: 'pipe' });

						if (result.status === 0) {
							const versionMatch = result.stdout.toString().trim().match(/Python (\d+\.\d+\.\d+)/);
							const version = versionMatch ? versionMatch[1] : result.stdout.toString().trim();

							return {
								command: interpreterPath,
								path: interpreterPath,
								version,
								info: 'Selected via Microsoft Python Extension',
								isCustomPath: false,
								available: true
							};
						}
					}
				}
			}
		} catch (error) {
			this.log.log(`Error getting Python interpreter from extension: ${error}`);
		}

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
	 * Finds the path of a command using 'which' (Linux/Mac) or 'where' (Windows)
	 * @param command The command to find
	 * @returns The path to the command
	 */
	private static async findCommandPath(command: string): Promise<string | undefined> {
		try {
			// Source rc file first to load environment, then run which/where
			const commandToRun = `exec ${process.env.SHELL || 'bash'} -l -c "which ${command}"`;

			const result = child_process.spawnSync(commandToRun, { stdio: 'pipe', shell: true });
			if (result.status === 0) {
				// cleanup result output from shell decorations
				return result.stdout.toString().trim();
			} else {
				return undefined;
			}
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (error) {
			return undefined;
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
		if (this.isWSLCache !== undefined) {
			return this.isWSLCache;
		}
		// Check for WSL in release info
		try {
			const releaseInfo = child_process.spawnSync('cat', ['/proc/version'], { stdio: 'pipe' }).stdout.toString();
			ProgramUtils.log.log(`WSL release info: ${releaseInfo}`);
			this.isWSLCache = releaseInfo.toLowerCase().includes('microsoft') || releaseInfo.toLowerCase().includes('wsl');
			return this.isWSLCache;
		} catch {
			return false;
		}
	}

	/**
	 * Gets the WSL distribution name
	 * @returns The WSL distribution name, or 'Ubuntu' if not in WSL
	 */
	public static wslDistro(): string {
		// Get the WSL distribution name
		try {
			const osRelease = child_process.spawnSync('cat', ['/etc/os-release'], { stdio: 'pipe' });
			if (osRelease.status === 0) {
				const output = osRelease.stdout.toString();
				const nameMatch = output.match(/^NAME="?([^"\n]+)"?/m);
				const distroName = nameMatch ? nameMatch[1] : 'Ubuntu';
				ProgramUtils.log.log(`WSL distribution from /etc/os-release: ${distroName}`);
				return distroName;
			}
		} catch (error) {
			ProgramUtils.log.log(`Error reading /etc/os-release: ${error}`);
		}
		return 'Ubuntu';
	}

	/**
	 * Gets the IP address for WSL networking
	 * @returns The IP address for WSL, or 'localhost' if not in WSL
	 */
	public static wslIP(): string {
		if (!ProgramUtils.isWSL()) {
			return 'localhost';
		}
		let ip = 'localhost';
		// If running in WSL, check wslinfo networking mode
		const networkingMode = child_process.execSync('wslinfo --networking-mode').toString().trim();
		if (networkingMode === 'nat') {
			// extract the IP address from ip route show | grep -i default | awk '{ print $3}'`
			// as mentioned here https://learn.microsoft.com/en-us/windows/wsl/networking
			const ipRoute = child_process.execSync('ip route show | grep -i default | awk \'{ print $3}\'').toString().trim();
			if (ipRoute) {
				ip = ipRoute;
			}
		}
		return ip;
	}

	/**
	 * Opens the Python interpreter selection dialog using Microsoft's Python extension
	 * and returns the selected interpreter path
	 * @returns Promise resolving to the selected Python interpreter path or undefined if cancelled
	 */
	public static async selectPythonInterpreter(): Promise<string | null> {
		this.log.log('Opening Python interpreter selection dialog');

		try {
			// Show the interpreter picker
			await vscode.commands.executeCommand('python.setInterpreter');

			// Get the selected interpreter path after the user makes a selection
			const interpreterPath = (await this.findVSCodeExtPython()).path;

			if (interpreterPath) {
				this.log.log(`Selected Python interpreter: ${interpreterPath}`);

				// Save the selected interpreter path to the configuration
				apToolsConfig.ToolsConfig.setToolPath('PYTHON', interpreterPath);

				return interpreterPath;
			} else {
				this.log.log('No Python interpreter configured');
				return null;
			}
		} catch (error) {
			this.log.log(`Error selecting Python interpreter: ${error}`);
			vscode.window.showErrorMessage(`Failed to select Python interpreter: ${error}`);
			return null;
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
	 * Installs a VS Code extension using the VS Code API
	 * @param extensionId - The ID of the extension to install
	 * @returns Promise resolving to true if installation was successful, false otherwise
	 */
	public static async installVSCodeExtension(extensionId: string): Promise<boolean> {
		this.log.log(`Installing VS Code extension: ${extensionId}`);

		try {
			// Use VS Code's built-in extension installation command
			await vscode.commands.executeCommand('workbench.extensions.installExtension', extensionId);
			this.log.log(`Successfully installed extension: ${extensionId}`);
			return true;
		} catch (error) {
			this.log.log(`Failed to install extension ${extensionId}: ${error}`);
			return false;
		}
	}

	/**
	 * Checks if a VS Code extension is installed and returns version information
	 * @param extensionId - The ID of the extension to check
	 * @returns Promise resolving to object with installation status and version
	 */
	public static async isVSCodeExtensionInstalled(extensionId: string): Promise<{ installed: boolean; version?: string }> {
		try {
			// Get all installed extensions
			const extensions = vscode.extensions.all;
			const extension = extensions.find(ext => ext.id === extensionId);

			if (extension) {
				return {
					installed: true,
					version: extension.packageJSON.version
				};
			} else {
				return {
					installed: false
				};
			}
		} catch (error) {
			this.log.log(`Error checking if extension ${extensionId} is installed: ${error}`);
			return {
				installed: false
			};
		}
	}

}

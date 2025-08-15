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
import * as fs from 'fs';
import * as path from 'path';
import { apLog } from './apLog';

/**
 * Interface for tool path configurations
 */
export interface ToolPaths {
    [key: string]: string;
}

/**
 * Interface for tool configuration file
 */
interface ToolsConfigFile {
    toolPaths: ToolPaths;
}

/**
 * Type for install method - either a command or a URL
 */
export type InstallMethod =
    | { type: 'command'; command: string }
    | { type: 'url'; url: string };

/**
 * Interface for consolidated tool information
 */
export interface ToolInfo {
    id?: string;
    name: string;
    description: string;
    optional?: boolean;
	webUrl?: string;
    paths: {
        linux?: readonly string[];
        darwin?: readonly string[];
        wsl?: readonly string[];
    };
    installCommands?: {
        linux?: InstallMethod;
        darwin?: InstallMethod;
        wsl?: InstallMethod;
    };
    findArgs?: {
        args: readonly string[];
        versionRegex?: RegExp;
    };
}

/**
 * Interface for Python package information
 */
export interface PythonPackageInfo {
    name: string;
    version?: string;
    description: string;
}

/**
 * Class to manage tool configurations
 */
/**
 * Consolidated registry for all tools with enum-like access
 */
export const TOOLS_REGISTRY = {
	PYTHON: {
		name: 'Python',
		description: 'Install Python 3 and pip',
		webUrl: 'https://www.python.org/downloads/',
		paths: {
			linux: ['python3', 'python'],
			darwin: ['python3', 'python']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip' },
			darwin: { type: 'command', command: 'brew install python3' },
		},
		findArgs: {
			args: ['--version']
		}
	},
	PYTHON_WIN: {
		name: 'Python (Windows)',
		description: 'Download and install Python for Windows, then restart WSL',
		webUrl: 'https://www.python.org/downloads/windows/',
		paths: {
			wsl: ['python.exe']
		},
		installCommands: {
			wsl: { type: 'url', url: 'https://www.python.org/downloads/windows/' },
		},
		findArgs: {
			args: ['--version']
		}
	},
	MAVPROXY: {
		name: 'MAVProxy',
		description: 'Install MAVProxy via pip',
		paths: {
			wsl: ['mavproxy.exe']
		},
		installCommands: {
			wsl: { type: 'url', url: 'https://firmware.ardupilot.org/Tools/MAVProxy/' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	CCACHE: {
		name: 'ccache',
		description: 'Install ccache for faster builds',
		paths: {
			linux: ['ccache'],
			darwin: ['ccache']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y ccache' },
			darwin: { type: 'command', command: 'brew install ccache' }
		},
		findArgs: {
			args: ['-V']
		}
	},
	OPENOCD: {
		name: 'OpenOCD',
		description: 'Install OpenOCD for debugging',
		optional: true,
		paths: {
			linux: ['openocd'],
			darwin: ['openocd']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y openocd' },
			darwin: { type: 'command', command: 'brew install openocd' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	JLINK: {
		name: 'J-Link',
		description: 'Download J-Link software from SEGGER website',
		optional: true,
		webUrl: 'https://www.segger.com/',
		paths: {
			linux: [
				'/mnt/c/Program Files/SEGGER/JLink*/JLinkGDBServerCL.exe',
				'/mnt/c/Program Files (x86)/SEGGER/JLink*/JLinkGDBServerCL.exe',
				'/opt/SEGGER/JLink*/JLinkGDBServerCLExe'
			],
			darwin: [
				'JLinkGDBServerCLExe',
				'/Applications/SEGGER/JLink/JLinkGDBServerCLExe'
			],
			wsl: [
				'/mnt/c/Program Files/SEGGER/JLink*/JLinkGDBServerCL.exe',
				'/mnt/c/Program Files (x86)/SEGGER/JLink*/JLinkGDBServerCL.exe'
			]
		},
		installCommands: {
			linux: { type: 'url', url: 'https://www.segger.com/downloads/jlink/' },
			darwin: { type: 'url', url: 'https://www.segger.com/downloads/jlink/' }
		},
		findArgs: {
			args: ['-version', '-nogui'],
			versionRegex: /SEGGER J-Link GDB Server V([\d.]+[a-z]?)/
		}
	},
	GCC: {
		name: 'GCC',
		description: 'Install GCC compiler',
		paths: {
			linux: ['gcc'],
			darwin: ['gcc']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y gcc' },
			darwin: { type: 'command', command: 'xcode-select --install' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	GPP: {
		name: 'G++',
		description: 'Install G++ compiler',
		paths: {
			linux: ['g++'],
			darwin: ['g++']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y g++' },
			darwin: { type: 'command', command: 'xcode-select --install' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	GDB: {
		name: 'GDB',
		description: 'Install GDB debugger',
		paths: {
			linux: ['gdb'],
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y gdb' },
		},
		findArgs: {
			args: ['--version']
		}
	},
	LLDB: {
		name: 'LLDB',
		description: 'Install LLDB Debugger',
		paths: {
			darwin: ['lldb'],
		},
		installCommands: {
			darwin: { type: 'command', command: 'xcode-select --install' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	ARM_GCC: {
		name: 'ARM GCC Toolchain',
		description: 'Download and install ARM GCC toolchain version 10',
		paths: {
			linux: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-gcc'],
			darwin: ['/opt/gcc-arm-none-eabi/bin/arm-none-eabi-gcc', '/Applications/ARM/bin/arm-none-eabi-gcc']
		},
		installCommands: {
			linux: {
				type: 'command',
				command: 'cd /tmp && wget -O gcc-arm-none-eabi.tar.bz2 https://firmware.ardupilot.org/Tools/STM32-tools/gcc-arm-none-eabi-10-2020-q4-major-x86_64-linux.tar.bz2 && sudo mkdir -p /opt/gcc-arm-none-eabi && sudo tar -xjf gcc-arm-none-eabi.tar.bz2 -C /opt/gcc-arm-none-eabi --strip-components=1'
			},
			darwin: { type: 'command', command: 'cd /tmp && curl --progress-bar -fL -o gcc-arm-none-eabi.pkg https://firmware.ardupilot.org/Tools/STM32-tools/gcc-arm-none-eabi-10-2020-q4-major-mac.pkg && sudo installer -pkg gcc-arm-none-eabi.pkg -target /' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	ARM_GDB: {
		name: 'ARM GDB',
		description: 'Install GDB for ARM debugging',
		paths: {
			linux: ['gdb-multiarch', 'arm-none-eabi-gdb'],
			darwin: ['arm-none-eabi-gdb']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y gdb-multiarch' },
			darwin: { type: 'command', command: 'brew install gdb' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	GDBSERVER: {
		name: 'GDB Server',
		description: 'Install GDB server',
		paths: {
			linux: ['gdbserver'],
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y gdbserver' }
		},
		findArgs: {
			args: ['--version']
		}
	},
	TMUX: {
		name: 'tmux',
		description: 'Install tmux terminal multiplexer',
		paths: {
			linux: ['tmux'],
			darwin: ['tmux']
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y tmux' },
			darwin: { type: 'command', command: 'brew install tmux' }
		},
		findArgs: {
			args: ['-V']
		}
	},
	LSUSB: {
		name: 'lsusb',
		description: 'Install lsusb utility for USB device detection',
		paths: {
			linux: ['lsusb'],
		},
		installCommands: {
			linux: { type: 'command', command: 'sudo apt-get update && sudo apt-get install -y usbutils' }
		},
		findArgs: {
			args: ['-V'],
			versionRegex: /lsusb\s+(\S+)/
		}
	},
} as const;

/**
 * Type for ToolID
 */
export type ToolID = keyof typeof TOOLS_REGISTRY;

// Initialize the id field for each tool with its key
Object.entries(TOOLS_REGISTRY).forEach(([key, tool]) => {
	(tool as ToolInfo).id = key;
});

/**
 * Registry of required Python packages
 */
export const PYTHON_PACKAGES_REGISTRY = {
	EMPY: { name: 'empy', version: '3.3.4', description: 'Template engine for code generation' },
	FUTURE: { name: 'future', description: 'Python 2/3 compatibility' },
	PYMAVLINK: { name: 'pymavlink', description: 'MAVLink protocol implementation' },
	LXML: { name: 'lxml', description: 'XML processing for MAVLink' },
	PEXPECT: { name: 'pexpect', description: 'Process control and automation' },
	DRONECAN: { name: 'dronecan', description: 'DroneCAN protocol implementation' },
	PYSERIAL: { name: 'pyserial', description: 'Serial communication library' },
	SETUPTOOLS: { name: 'setuptools', description: 'Python package development utilities (provides pkg_resources)' },
	MAVPROXY: { name: 'mavproxy', description: 'MAVLink proxy for communication' }
} as const;

/**
 * Type for PythonPackageId
 */
export type PythonPackageId = keyof typeof PYTHON_PACKAGES_REGISTRY;

/**
 * Interface for environment check information
 */
export interface EnvCheckInfo {
    id?: string;
    name: string;
    description: string;
    required?: boolean;
    checks: {
        linux?: string;
        darwin?: string;
        wsl?: string;
    };
    fix_issue?: {
        linux?: InstallMethod;
        darwin?: InstallMethod;
        wsl?: InstallMethod;
    };
}

/**
 * Registry of environment checks per platform
 */
export const ENV_CHECK_REGISTRY = {
	MODEMMANAGER_NOT_INSTALLED: {
		name: 'ModemManager Not Installed',
		description: 'ModemManager interferes with ArduPilot device communication',
		required: true,
		checks: {
			linux: '! command -v ModemManager',
			wsl: '! command -v ModemManager'
		},
		fix_issue: {
			linux: { type: 'command', command: 'sudo apt-get remove -y modemmanager' },
			wsl: { type: 'command', command: 'sudo apt-get remove -y modemmanager' }
		}
	},
	DIALOUT_GROUP_MEMBERSHIP: {
		name: 'Dialout Group Membership',
		description: 'User must be in dialout group to access serial devices',
		required: true,
		checks: {
			linux: 'groups | grep -q dialout',
			wsl: 'groups | grep -q dialout'
		},
		fix_issue: {
			linux: { type: 'command', command: 'sudo usermod -a -G dialout $USER && echo "Please log out and log back in for group changes to take effect"' },
			wsl: { type: 'command', command: 'sudo usermod -a -G dialout $USER && echo "Please restart WSL for group changes to take effect"' }
		}
	},
	HOMEBREW_INSTALLED: {
		name: 'Homebrew Package Manager',
		description: 'Homebrew is required for installing development tools on macOS',
		required: true,
		checks: {
			darwin: 'command -v brew'
		},
		fix_issue: {
			darwin: { type: 'command', command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' }
		}
	},
	XCODE_CLI_TOOLS: {
		name: 'Xcode Command Line Tools',
		description: 'Xcode CLI tools provide essential build tools for macOS development',
		required: true,
		checks: {
			darwin: 'xcode-select -p'
		},
		fix_issue: {
			darwin: { type: 'command', command: 'xcode-select --install' }
		}
	}
} as const;

/**
 * Type for EnvCheckID
 */
export type EnvCheckID = keyof typeof ENV_CHECK_REGISTRY;

// Initialize the id field for each environment check with its key
Object.entries(ENV_CHECK_REGISTRY).forEach(([key, envCheck]) => {
	(envCheck as EnvCheckInfo).id = key;
});

/**
 * Helper functions for working with the tools registry
 */
export class ToolsRegistryHelpers {
	/**
	 * Get all tool IDs as an array
	 */
	static getToolIdsList(): ToolID[] {
		return Object.keys(TOOLS_REGISTRY) as ToolID[];
	}

	/**
	 * Get all tools as an array
	 */
	static getAllTools(): Array<ToolInfo & { key: string }> {
		return Object.entries(TOOLS_REGISTRY).map(([key, info]) => ({
			key,
			...info
		}));
	}

	/**
	 * Get all Python packages as an array
	 */
	static getAllPythonPackages(): Array<PythonPackageInfo & { key: string }> {
		return Object.entries(PYTHON_PACKAGES_REGISTRY).map(([key, info]) => ({
			key,
			...info
		}));
	}

	/**
	 * Get Python packages formatted for pip installation
	 */
	static getPythonPackagesForInstallation(): string[] {
		return Object.entries(PYTHON_PACKAGES_REGISTRY).map(([, pkg]) => {
			// Include version if specified
			return (pkg as PythonPackageInfo).version ? `${pkg.name}==${(pkg as PythonPackageInfo).version}` : pkg.name;
		});
	}

	/**
	 * Get all environment check IDs as an array
	 */
	static getEnvCheckIdsList(): EnvCheckID[] {
		return Object.keys(ENV_CHECK_REGISTRY) as EnvCheckID[];
	}

	/**
	 * Get all environment checks as an array
	 */
	static getAllEnvChecks(): Array<EnvCheckInfo & { key: string }> {
		return Object.entries(ENV_CHECK_REGISTRY).map(([key, info]) => ({
			key,
			...info
		}));
	}

}

export class ToolsConfig {
	private static log = new apLog('ToolsConfig');
	private static readonly CONFIG_FILE = '.vscode/apenv.json';
	private static toolPaths: ToolPaths = {};
	private static configWatcher: vscode.FileSystemWatcher | undefined;
	private static onConfigChangedCallbacks: (() => void)[] = [];

	/**
     * Initializes the tools configuration
     * @param context VS Code extension context
     */
	public static initialize(context: vscode.ExtensionContext): void {
		this.loadConfig();
		this.setupConfigWatcher(context);
	}

	/**
     * Sets up a file watcher to monitor changes to the configuration file
     * @param context VS Code extension context
     */
	private static setupConfigWatcher(context: vscode.ExtensionContext): void {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}

		const workspaceRoot = workspaceFolders[0].uri;
		const configPattern = new vscode.RelativePattern(workspaceRoot, this.CONFIG_FILE);

		this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

		// Register event handlers for file changes
		this.configWatcher.onDidChange(() => {
			this.log.log('Configuration file changed, reloading...');
			this.loadConfig();
			this.notifyConfigChanged();
		});

		this.configWatcher.onDidCreate(() => {
			this.log.log('Configuration file created, loading...');
			this.loadConfig();
			this.notifyConfigChanged();
		});

		context.subscriptions.push(this.configWatcher);
	}

	/**
     * Registers a callback to be notified when the configuration changes
     * @param callback Function to call when configuration changes
     */
	public static onConfigChanged(callback: () => void): void {
		this.onConfigChangedCallbacks.push(callback);
	}

	/**
     * Notifies all registered callbacks about configuration changes
     */
	private static notifyConfigChanged(): void {
		for (const callback of this.onConfigChangedCallbacks) {
			callback();
		}
	}

	/**
     * Loads the tool configuration from the workspace
     */
	public static loadConfig(): void {
		const configPath = this.getConfigFilePath();
		if (!configPath) {
			this.log.log('No workspace folder found, using default configurations');
			return;
		}

		try {
			if (fs.existsSync(configPath)) {
				const configContent = fs.readFileSync(configPath, 'utf8');
				const config = JSON.parse(configContent) as ToolsConfigFile;
				this.toolPaths = config.toolPaths || {};
				this.log.log('Configuration loaded successfully');
			} else {
				this.log.log('Configuration file not found, using default configurations');
				this.toolPaths = {};
			}
		} catch (error) {
			this.log.log(`Error loading configuration: ${error}`);
			this.toolPaths = {};
		}
	}

	/**
     * Saves the current tool configuration to the workspace
     */
	public static saveConfig(): void {
		const configPath = this.getConfigFilePath();
		if (!configPath) {
			this.log.log('No workspace folder found, cannot save configuration');
			return;
		}

		try {
			// Ensure the .vscode directory exists
			const vscodeDir = path.dirname(configPath);
			if (!fs.existsSync(vscodeDir)) {
				fs.mkdirSync(vscodeDir, { recursive: true });
			}

			const config: ToolsConfigFile = {
				toolPaths: this.toolPaths
			};

			fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
			this.log.log('Configuration saved successfully');
		} catch (error) {
			this.log.log(`Error saving configuration: ${error}`);
			vscode.window.showErrorMessage(`Failed to save tool configuration: ${error}`);
		}
	}

	/**
     * Gets the path to the configuration file
     * @returns The absolute path to the configuration file, or undefined if no workspace is open
     */
	private static getConfigFilePath(): string | undefined {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined;
		}

		return path.join(workspaceFolders[0].uri.fsPath, this.CONFIG_FILE);
	}

	/**
     * Gets the configured path for a tool
     * @param toolId The ID of the tool
     * @returns The configured path for the tool, or undefined if not configured
     */
	public static getToolPath(toolId: ToolID): string | undefined {
		return this.toolPaths[toolId];
	}

	/**
     * Sets the path for a tool
     * @param toolId The ID of the tool
     * @param path The path to the tool
     */
	public static setToolPath(toolId: ToolID, path: string): void {
		this.toolPaths[toolId] = path;
		this.saveConfig();
	}

	/**
     * Removes the configured path for a tool
     * @param toolId The ID of the tool
     */
	public static removeToolPath(toolId: ToolID): void {
		delete this.toolPaths[toolId];
		this.saveConfig();
	}

	/**
     * Gets all configured tool paths
     * @returns A copy of the tool paths object
     */
	public static getAllToolPaths(): ToolPaths {
		return { ...this.toolPaths };
	}
}

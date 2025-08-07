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

/*
	ValidateEnvironment.ts
	Validates the development environment for ArduPilot.
*/

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { apWelcomeItem } from './apWelcomeItem';
import { apLog } from './apLog';
import { ProgramUtils, ProgramInfo } from './apProgramUtils';
import { apTerminalMonitor } from './apTerminalMonitor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class ValidateEnvironment extends apWelcomeItem {
	static log = new apLog('validateEnvironment');

	// List of commands that should be handled by ValidateEnvironmentPanel
	static readonly ENVIRONMENT_COMMANDS = [
		'validateEnvironment',
		'checkEnvironment',
		'configureToolPath',
		'installTool',
		'selectPythonInterpreter',
		'installPythonPackages',
		'launchWSL',
		'openVSCodeWSL',
		'resetAllPaths',
		'getPythonPackagesList',
		'getToolsList'
	];

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		vscode.commands.registerCommand('apValidateEnv', () => ValidateEnvironment.run());
	}

	static run(): void {
		this.log.log('validateEnvironment called');
		// Create a webview panel to show the validation results
		ValidateEnvironmentPanel.createOrShow(vscode.window.activeTextEditor?.viewColumn);
	}

	// set logo for the tree item
	iconPath = new vscode.ThemeIcon('inspect');

	command = {
		command: 'apValidateEnv',
		title: 'Validate Environment',
		arguments: [this.label]
	};

	contextValue = 'validateEnvironment';
}

/**
 * Manages Environment Validation webview panel
 */
export class ValidateEnvironmentPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: ValidateEnvironmentPanel | undefined;

	public static readonly viewType = 'validateEnvironmentPanel';
	private static log = new apLog('validateEnvironmentPanel');

	readonly _panel: vscode.WebviewPanel;
	readonly _disposables: vscode.Disposable[] = [];

	public static createOrShow(column?: vscode.ViewColumn): void {
		const activeColumn = column || vscode.ViewColumn.One;

		// If we already have a panel, show it
		if (ValidateEnvironmentPanel.currentPanel) {
			ValidateEnvironmentPanel.currentPanel._panel.reveal(activeColumn);
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			ValidateEnvironmentPanel.viewType,
			'ArduPilot Environment Validation',
			activeColumn,
			{
				// Enable scripts in the webview
				enableScripts: true
			}
		);

		ValidateEnvironmentPanel.currentPanel = new ValidateEnvironmentPanel(panel);
	}

	private constructor(panel: vscode.WebviewPanel) {
		this._panel = panel;

		// Set the webview's initial html content
		this._panel.webview.html = this._getInitialHtml(panel.webview);

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				this._onReceiveMessage(message);
			},
			null,
			this._disposables
		);

		// Handle when webview becomes visible
		this._panel.onDidChangeViewState(
			e => {
				if (e.webviewPanel.visible) {
					// Resend data when webview becomes visible
					this._sendToolsList();
					this._sendPythonPackagesList();
				}
			},
			null,
			this._disposables
		);

		// Start validation automatically
		setTimeout(() => {
			this._sendToolsList();
			this._sendPythonPackagesList();
			this._validateEnvironment();
		}, 500);
	}

	private _onReceiveMessage(message: {command: string, toolId: string, toolName: string}): void {
		switch (message.command) {
		case 'checkEnvironment':
			this._validateEnvironment();
			break;
		case 'configureToolPath':
			this._configureToolPath(message.toolId, message.toolName);
			break;
		case 'resetAllPaths':
			this._resetAllToolPaths();
			break;
		case 'launchWSL':
			this._launchWSL();
			break;
		case 'openVSCodeWSL':
			this._openVSCodeWithWSL();
			break;
		case 'selectPythonInterpreter':
			this._selectPythonInterpreter();
			break;
		case 'installTool':
			ValidateEnvironmentPanel.installTool(message.toolId).catch(error => {
				ValidateEnvironmentPanel.log.log(`Tool installation failed: ${error}`);
			});
			break;
		case 'installPythonPackages':
			ValidateEnvironmentPanel.installPythonPackages(this).catch(error => {
				ValidateEnvironmentPanel.log.log(`Python package installation failed: ${error}`);
			});
			break;
		case 'getPythonPackagesList':
			this._sendPythonPackagesList();
			break;
		case 'getToolsList':
			this._sendToolsList();
			break;
		}
	}

	private _getInitialHtml(webview: vscode.Webview): string {
		// Get the extension context (we'll need to pass this from the calling code)
		const extensionUri = vscode.extensions.getExtension('ardupilot-org.ardupilot-devenv')?.extensionUri;
		if (!extensionUri) {
			vscode.window.showErrorMessage('Failed to get extension URI');
			return '';
		}

		const stylesUri = this.getUri(webview, extensionUri, ['webview-ui', 'dist', 'environment-validator.css']);
		const scriptUri = this.getUri(webview, extensionUri, ['webview-ui', 'dist', 'environment-validator.js']);
		const sourceMapUri = this.getUri(webview, extensionUri, ['webview-ui', 'dist', 'environment-validator.js.map']);

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<title>Environment Validator - ArduPilot DevEnv</title>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<meta http-equiv="Content-Security-Policy" content="default-src 'none';
																		style-src ${webview.cspSource};
																		script-src ${webview.cspSource} 'unsafe-eval' 'unsafe-inline';
																		connect-src ${webview.cspSource} vscode-resource: vscode-webview-resource: https:;">
					<link href="${stylesUri}" rel="stylesheet">
					<script>
						// Make source map URL available to our error handler
						window.SOURCE_MAP_URL = "${sourceMapUri}";
					</script>
					<script type="module" src="${scriptUri}"></script>
				</head>
				<body>
					<div id="environmentValidator"></div>
				</body>
			</html>
		`;
	}

	private getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]): vscode.Uri {
		return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
	}

	private async _validateEnvironment(): Promise<void> {
		// First check if the platform is supported
		this._checkPlatform();

		// If we're on Windows, don't proceed with tool validation
		if (process.platform === 'win32') {
			return;
		}

		const isWSL = ProgramUtils.isWSL();

		const pythonCheck = ProgramUtils.findPython();
		const pythonWinCheck = isWSL ? ProgramUtils.findPythonWin() : Promise.resolve({ available: false, info: 'Not applicable outside WSL.', isCustomPath: false });

		// Python package checks
		const pythonPackagesCheck = ProgramUtils.checkAllPythonPackages();

		const mavproxyCheck = ProgramUtils.findMavproxy();
		const armGccCheck = ProgramUtils.findArmGCC();
		const gccCheck = ProgramUtils.findGCC();
		const gppCheck = ProgramUtils.findGPP();
		const gdbCheck = ProgramUtils.findArmGDB();
		const ccacheCheck = this._checkCCache();
		const pyserialCheck = ProgramUtils.findPyserial();
		const tmuxCheck = ProgramUtils.findTmux();
		const lsusbCheck = ProgramUtils.findLsusb();

		// Check optional tools
		const jlinkCheck = ProgramUtils.findJLinkGDBServerCLExe().catch(() => ({ available: false, isCustomPath: false }));
		const openocdCheck = ProgramUtils.findOpenOCD().catch(() => ({ available: false, isCustomPath: false }));
		const gdbserverCheck = ProgramUtils.findGDBServer().catch(() => ({ available: false, isCustomPath: false }));

		// Await all checks
		const [
			pythonResult,
			pythonWinResult,
			pythonPackagesResult,
			mavproxyResult,
			armGccResult,
			gccResult,
			gppResult,
			gdbResult,
			ccacheResult,
			jlinkResult,
			openocdResult,
			gdbserverResult,
			pyserialResult,
			tmuxResult,
			lsusbResult
		] = await Promise.all([
			pythonCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			pythonWinCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			pythonPackagesCheck.catch(() => []),
			mavproxyCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			armGccCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			gccCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			gppCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			gdbCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			ccacheCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			jlinkCheck,
			openocdCheck,
			gdbserverCheck,
			pyserialCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			tmuxCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message })),
			lsusbCheck.catch(error => ({ available: false, isCustomPath: false, info: error.message }))
		]);

		// Report results to webview
		this._reportToolStatus(ProgramUtils.TOOL_PYTHON, pythonResult);
		if (isWSL) {
			this._reportToolStatus(ProgramUtils.TOOL_PYTHON_WIN, pythonWinResult);
		}

		// Report Python packages results
		for (const {packageName, result} of pythonPackagesResult) {
			this._reportPackageStatus(packageName, result);
		}

		// Check if any Python packages are missing to show install button
		const hasMissingPackages = pythonPackagesResult.some(({result}) => !result.available);
		this._updateInstallPackagesButton(hasMissingPackages);

		this._reportToolStatus(ProgramUtils.TOOL_MAVPROXY, mavproxyResult);
		this._reportToolStatus(ProgramUtils.TOOL_ARM_GCC, armGccResult);
		this._reportToolStatus(ProgramUtils.TOOL_GCC, gccResult);
		this._reportToolStatus(ProgramUtils.TOOL_GPP, gppResult);
		this._reportToolStatus(ProgramUtils.TOOL_ARM_GDB, gdbResult);
		this._reportToolStatus(ProgramUtils.TOOL_CCACHE, ccacheResult);
		this._reportToolStatus(ProgramUtils.TOOL_JLINK, jlinkResult);
		this._reportToolStatus(ProgramUtils.TOOL_OPENOCD, openocdResult);
		this._reportToolStatus(ProgramUtils.TOOL_GDBSERVER, gdbserverResult);
		this._reportToolStatus(ProgramUtils.TOOL_PYSERIAL, pyserialResult);
		this._reportToolStatus(ProgramUtils.TOOL_TMUX, tmuxResult);
		this._reportToolStatus(ProgramUtils.TOOL_LSUSB, lsusbResult);

		// Generate summary - only include required tools in the summary
		const summaryTools = [pythonResult, mavproxyResult, armGccResult, gccResult, gppResult, gdbResult, ccacheResult, gdbserverResult, pyserialResult, tmuxResult];
		if (isWSL) {
			// Add Windows Python to summary if in WSL, as it's important for SITL components like PySerial.
			summaryTools.push(pythonWinResult);
		}
		this._generateSummary(summaryTools);
	}

	/**
	 * Checks if the current platform is supported (Linux or macOS)
	 */
	private _checkPlatform(): void {
		this._panel.webview.postMessage({
			command: 'platformCheck',
			platform: process.platform,
			supported: process.platform === 'linux' || process.platform === 'darwin',
			isWSL: ProgramUtils.isWSL()
		});
	}

	/**
	 * Launch WSL installation guide when the user clicks the WSL button
	 */
	private _launchWSL(): void {
		// Open Microsoft's WSL installation guide in the default browser
		vscode.env.openExternal(vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install'));

		// Also suggest the user to install VS Code Remote WSL extension
		vscode.window.showInformationMessage(
			'Would you like to install the VS Code Remote - WSL extension to work with ArduPilot in WSL?',
			'Install Extension', 'Later'
		).then(choice => {
			if (choice === 'Install Extension') {
				vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-wsl');
			}
		});
	}

	/**
	 * Installs a missing tool based on the tool ID and platform
	 * @param toolId - The ID of the tool to install
	 * @returns Promise that resolves on successful installation (exit code 0) or rejects on failure
	 */
	public static installTool(toolId: string): Promise<void> {
		const platform = process.platform;
		const isWSL = ProgramUtils.isWSL();

		// Get tool name for display
		const toolNames: { [key: string]: string } = {
			[ProgramUtils.TOOL_PYTHON]: 'Python',
			[ProgramUtils.TOOL_PYTHON_WIN]: 'Python (Windows)',
			[ProgramUtils.TOOL_MAVPROXY]: 'MAVProxy',
			[ProgramUtils.TOOL_ARM_GCC]: 'ARM GCC Toolchain',
			[ProgramUtils.TOOL_ARM_GDB]: 'ARM GDB',
			[ProgramUtils.TOOL_GCC]: 'GCC',
			[ProgramUtils.TOOL_GPP]: 'G++',
			[ProgramUtils.TOOL_GDB]: 'GDB',
			[ProgramUtils.TOOL_CCACHE]: 'ccache',
			[ProgramUtils.TOOL_JLINK]: 'J-Link',
			[ProgramUtils.TOOL_OPENOCD]: 'OpenOCD',
			[ProgramUtils.TOOL_GDBSERVER]: 'GDB Server',
			[ProgramUtils.TOOL_PYSERIAL]: 'PySerial',
			[ProgramUtils.TOOL_TMUX]: 'tmux',
			[ProgramUtils.TOOL_LSUSB]: 'lsusb'
		};

		const toolName = toolNames[toolId] || toolId;

		// Define installation commands and web pages
		const installations: { [key: string]: {
			wsl?: string,
			linux?: string,
			darwin?: string,
			win32?: string,
			webUrl?: string,
			description?: string
		} } = {
			[ProgramUtils.TOOL_PYTHON]: {
				linux: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip',
				darwin: 'brew install python3',
				webUrl: 'https://www.python.org/downloads/',
				description: 'Install Python 3 and pip'
			},
			[ProgramUtils.TOOL_PYTHON_WIN]: {
				webUrl: 'https://www.python.org/downloads/',
				description: 'Download and install Python for Windows, then restart WSL'
			},
			[ProgramUtils.TOOL_MAVPROXY]: {
				linux: 'pip3 install mavproxy',
				darwin: 'pip3 install mavproxy',
				webUrl: isWSL ? 'https://firmware.ardupilot.org/Tools/MAVProxy/' : undefined,
				description: isWSL ? 'Download MAVProxy installer for WSL' : 'Install MAVProxy via pip'
			},
			[ProgramUtils.TOOL_ARM_GCC]: {
				linux: ValidateEnvironmentPanel._getArmGccInstallCommand('linux'),
				darwin: ValidateEnvironmentPanel._getArmGccInstallCommand('darwin'),
				webUrl: 'https://firmware.ardupilot.org/Tools/STM32-tools/',
				description: 'Download and install ARM GCC toolchain version 10'
			},
			[ProgramUtils.TOOL_ARM_GDB]: {
				linux: 'sudo apt-get update && sudo apt-get install -y gdb-multiarch',
				darwin: 'brew install gdb',
				description: 'Install GDB for ARM debugging'
			},
			[ProgramUtils.TOOL_GCC]: {
				linux: 'sudo apt-get update && sudo apt-get install -y gcc',
				darwin: 'xcode-select --install',
				description: 'Install GCC compiler'
			},
			[ProgramUtils.TOOL_GPP]: {
				linux: 'sudo apt-get update && sudo apt-get install -y g++',
				darwin: 'xcode-select --install',
				description: 'Install G++ compiler'
			},
			[ProgramUtils.TOOL_GDB]: {
				linux: 'sudo apt-get update && sudo apt-get install -y gdb',
				darwin: 'brew install gdb',
				description: 'Install GDB debugger'
			},
			[ProgramUtils.TOOL_CCACHE]: {
				linux: 'sudo apt-get update && sudo apt-get install -y ccache',
				darwin: 'brew install ccache',
				description: 'Install ccache for faster builds'
			},
			[ProgramUtils.TOOL_JLINK]: {
				webUrl: 'https://www.segger.com/downloads/jlink/',
				description: 'Download J-Link software from SEGGER website'
			},
			[ProgramUtils.TOOL_OPENOCD]: {
				linux: 'sudo apt-get update && sudo apt-get install -y openocd',
				darwin: 'brew install openocd',
				description: 'Install OpenOCD for debugging'
			},
			[ProgramUtils.TOOL_GDBSERVER]: {
				linux: 'sudo apt-get update && sudo apt-get install -y gdbserver',
				description: 'Install GDB server'
			},
			[ProgramUtils.TOOL_PYSERIAL]: {
				wsl: 'pip.exe install pyserial',
				linux: 'pip3 install pyserial',
				darwin: 'pip3 install pyserial',
				description: 'Install PySerial via pip'
			},
			[ProgramUtils.TOOL_TMUX]: {
				linux: 'sudo apt-get update && sudo apt-get install -y tmux',
				darwin: 'brew install tmux',
				description: 'Install tmux terminal multiplexer'
			},
			[ProgramUtils.TOOL_LSUSB]: {
				linux: 'sudo apt-get update && sudo apt-get install -y usbutils',
				description: 'Install lsusb utility for USB device detection'
			}
		};

		const installation = installations[toolId];
		if (!installation) {
			const errorMsg = `Installation not supported for ${toolName}`;
			vscode.window.showErrorMessage(errorMsg);
			return Promise.reject(new Error(errorMsg));
		}

		// Determine the appropriate installation method
		let command: string | undefined;

		// Special handling for MAVProxy in WSL - use web installer
		if (isWSL && toolId === ProgramUtils.TOOL_MAVPROXY) {
			command = undefined; // Force web installation
		} else if (platform === 'linux' || isWSL) {
			command = installation.linux;
		} else if (platform === 'darwin') {
			command = installation.darwin;
		} else if (platform === 'win32') {
			command = installation.win32;
		}

		return new Promise<void>((resolve, reject) => {
			if (command) {
				// Use terminal installation with monitoring
				const terminalName = `Install ${toolName}`;

				// Create terminal monitor to track installation progress
				const terminalMonitor = new apTerminalMonitor(terminalName);
				terminalMonitor.createTerminal();

				vscode.window.showInformationMessage(
					`Installing ${toolName}... Check the terminal for progress.`
				);

				// Set up text callback for logging terminal output
				terminalMonitor.addTextCallback((text) => {
					ValidateEnvironmentPanel.log.log(`Terminal output[${terminalName}]: ${text}`);
				});

				// Use the terminalMonitor.runCommand method for better command lifecycle tracking
				terminalMonitor.runCommand(command)
					.then(async exitCode => {
						ValidateEnvironmentPanel.log.log(`Installation completed with exit code: ${exitCode}`);

						// Clean up the terminal monitor
						terminalMonitor.dispose();

						// Resolve or reject based on exit code
						if (exitCode === 0) {
							vscode.window.showInformationMessage(`${toolName} installed successfully!`);
							const tool = await ProgramUtils.findTool(toolId);
							if (tool.available) {
								ValidateEnvironmentPanel.log.log(`${toolName} installed successfully at ${tool.info}`);
								resolve();
							} else {
								const errorMsg = `Installation succeeded but ${toolName} not found in PATH. Please check your installation.`;
								ValidateEnvironmentPanel.log.log(errorMsg);
								vscode.window.showErrorMessage(errorMsg);
								reject(new Error(errorMsg));
							}
						} else {
							const errorMsg = `Installation failed with exit code ${exitCode}`;
							vscode.window.showErrorMessage(`Failed to install ${toolName}: ${errorMsg}`);
							reject(new Error(errorMsg));
						}
					})
					.catch(error => {
						// Clean up the terminal monitor on error
						terminalMonitor.dispose();

						const errorMsg = error instanceof Error ? error.message : String(error);
						ValidateEnvironmentPanel.log.log(`Tool installation failed: ${errorMsg}`);
						vscode.window.showErrorMessage(`Failed to install ${toolName}: ${errorMsg}`);
						reject(error);
					});

			} else if (installation.webUrl) {
				// Use web-based installation - resolve immediately as we can't track completion
				vscode.env.openExternal(vscode.Uri.parse(installation.webUrl));
				vscode.window.showInformationMessage(
					`Opening ${toolName} download page. ${installation.description || 'Please download and install manually.'}`
				);
				resolve(); // Web installation can't be tracked, so resolve immediately

			} else {
				const errorMsg = `No installation method available for ${toolName} on ${platform}`;
				vscode.window.showErrorMessage(errorMsg);
				reject(new Error(errorMsg));
			}
		});
	}

	/**
	 * Gets the ARM GCC installation command for the specified platform
	 */
	private static _getArmGccInstallCommand(platform: 'linux' | 'darwin'): string {
		const arch = process.arch;
		let filename: string;

		if (platform === 'linux') {
			if (arch === 'arm64') {
				filename = 'gcc-arm-none-eabi-10-2020-q4-major-aarch64-linux.tar.bz2';
			} else {
				filename = 'gcc-arm-none-eabi-10.3-2021.10-x86_64-linux.tar.bz2';
			}
		} else { // darwin
			filename = 'gcc-arm-none-eabi-10-2020-q4-major-mac.tar.bz2';
		}

		const url = `https://firmware.ardupilot.org/Tools/STM32-tools/${filename}`;

		return `cd /tmp && wget "${url}" && mkdir -p gcc-arm-none-eabi && tar -xjf "${filename}" -C gcc-arm-none-eabi --strip-components=1 && sudo mv gcc-arm-none-eabi /opt/gcc-arm-none-eabi && echo "ARM GCC installed! Please restart your terminal or run: source ~/.bashrc"`;
	}

	/**
	 * Opens a new VS Code window connected to WSL
	 */
	private _openVSCodeWithWSL(): void {
		// Execute the VS Code command to open a new window connected to WSL
		vscode.commands.executeCommand('remote-wsl.openFolder')
			.then(() => {
				// Success - no action needed as VS Code will handle opening the new window
			}, (error) => {
				// If there's an error, it might be because the Remote WSL extension is not installed
				vscode.window.showErrorMessage(
					'Failed to open VS Code with WSL. Make sure the Remote - WSL extension is installed.',
					'Install Extension'
				).then(choice => {
					if (choice === 'Install Extension') {
						vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-wsl');
					}
				});

				ValidateEnvironment.log.log(`Failed to open VS Code with WSL: ${error}`);
			});
	}

	private _checkCCache(): Promise<ProgramInfo> {
		// disabled eslint rule for async promise executor as we are
		// specifically catching errors for each check
		// and handling them in the promise chain
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
				// First check if ccache is installed
				const ccacheResult = await ProgramUtils.findCcache().catch(() => null);

				if (!ccacheResult) {
					reject(new Error('ccache is not installed'));
					return;
				}

				// Check if gcc compilers are linked to ccache
				const ccacheInfo: string[] = [];
				let gccLinked = false;
				let gppLinked = false;
				let armGccLinked = false;
				let armGppLinked = false;

				// Check arm-none-eabi-gcc symlink
				const armGccLinkCheck = new Promise<void>((resolveCheck) => {
					child_process.exec('ls -la $(which arm-none-eabi-gcc)', (error, stdout) => {
						if (!error && stdout.includes('ccache')) {
							armGccLinked = true;
							ccacheInfo.push('✅ arm-none-eabi-gcc is linked to ccache');
						} else {
							ccacheInfo.push('❌ arm-none-eabi-gcc is NOT linked to ccache');
						}
						resolveCheck();
					});
				});
				// check if arm-none-eabi-g++ symlink
				const armGppLinkCheck = new Promise<void>((resolveCheck) => {
					child_process.exec('ls -la $(which arm-none-eabi-g++)', (error, stdout) => {
						if (!error && stdout.includes('ccache')) {
							armGppLinked = true;
							ccacheInfo.push('✅ arm-none-eabi-g++ is linked to ccache');
						} else {
							ccacheInfo.push('❌ arm-none-eabi-g++ is NOT linked to ccache');
						}
						resolveCheck();
					});
				});

				// Check gcc symlink
				const gccLinkCheck = new Promise<void>((resolveCheck) => {
					child_process.exec('ls -la $(which gcc)', (error, stdout) => {
						if (!error && stdout.includes('ccache')) {
							gccLinked = true;
							ccacheInfo.push('✅ gcc is linked to ccache');
						} else {
							ccacheInfo.push('❌ gcc is NOT linked to ccache');
						}
						resolveCheck();
					});
				});

				// Check g++ symlink
				const gppLinkCheck = new Promise<void>((resolveCheck) => {
					child_process.exec('ls -la $(which g++)', (error, stdout) => {
						if (!error && stdout.includes('ccache')) {
							gppLinked = true;
							ccacheInfo.push('✅ g++ is linked to ccache');
						} else {
							ccacheInfo.push('❌ g++ is NOT linked to ccache');
						}
						resolveCheck();
					});
				});
				// Wait for all checks to complete
				await Promise.all([armGccLinkCheck, gccLinkCheck, armGppLinkCheck, gppLinkCheck]);

				// Add tips for setup if needed
				if (!armGccLinked || !gccLinked || !armGppLinked || !gppLinked) {
					ccacheInfo.push('⚠️ It seems that ccache is not properly set up for arm-none-eabi-gcc and/or gcc. Please check your setup. For more information, visit the <a href="https://ardupilot.org/dev/docs/building-setup-linux.html#ccache-for-faster-builds">ArduPilot ccache documentation</a>.');
				}

				resolve({
					available: true,
					version: ccacheResult.version,
					path: ccacheResult.path,
					info: ccacheInfo.join('<br>'),
					isCustomPath: ccacheResult.isCustomPath
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	private _generateSummary(results: Array<{ available: boolean }>): void {
		const missingCount = results.filter(r => !r.available).length;

		if (missingCount === 0) {
			this._panel.webview.postMessage({
				command: 'validationSummary',
				status: 'ok',
				message: '✅ Great! All required tools are available.'
			});
		} else if (missingCount < results.length) {
			this._panel.webview.postMessage({
				command: 'validationSummary',
				status: 'warning',
				message: `⚠️ Some tools are missing (${missingCount}/${results.length}). You may need to install them.`
			});
		} else {
			this._panel.webview.postMessage({
				command: 'validationSummary',
				status: 'error',
				message: '❌ All required tools are missing. Please set up your development environment.'
			});
		}
	}

	/**
	 * Opens a dialog to configure a custom path for a tool
	 * @param toolId The ID of the tool to configure
	 * @param toolName The display name of the tool
	 */
	private async _configureToolPath(toolId: string, toolName: string): Promise<void> {
		// Get the existing tool info to use its directory as default location
		const existingToolInfo = await ProgramUtils.findTool(toolId);
		const existingToolPath = existingToolInfo.path;

		// Show open file dialog to select the tool executable
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: `Select ${toolName} Executable`,
			filters: {
				'Executable Files': ['*'],
				'All Files': ['*']
			}
		};

		// If there's an existing tool path, set the default URI to its directory
		// Otherwise, open the home directory
		if (existingToolPath && fs.existsSync(existingToolPath)) {
			const toolDir = path.dirname(existingToolPath);
			options.defaultUri = vscode.Uri.file(toolDir);
		} else {
			const homeDir = os.homedir();
			options.defaultUri = vscode.Uri.file(homeDir);
		}

		const fileUri = await vscode.window.showOpenDialog(options);
		if (fileUri && fileUri.length > 0) {
			const filePath = fileUri[0].fsPath;

			try {
				// Verify the file exists and is executable
				const stat = fs.statSync(filePath);

				if (!stat.isFile()) {
					vscode.window.showErrorMessage(`${filePath} is not a file.`);
					return;
				}

				// Save the custom path in the configuration
				await ProgramUtils.setToolCustomPath(toolId, filePath);

				// Notify the webview that configuration was saved
				this._panel.webview.postMessage({
					command: 'configurationSaved'
				});

				// Show success message
				vscode.window.showInformationMessage(`Custom path for ${toolName} saved successfully.`);

				// Run validation again to check with the new path
				this._validateEnvironment();

			} catch (error) {
				vscode.window.showErrorMessage(`Error configuring custom path: ${error}`);
			}
		}
	}

	/**
	 * Resets all custom tool paths
	 */
	private async _resetAllToolPaths(): Promise<void> {
		// Confirm with the user
		vscode.window.showWarningMessage(
			'Are you sure you want to reset all custom tool paths?',
			'Yes', 'No'
		).then(async (answer) => {
			if (answer === 'Yes') {
				// Get all tool IDs from the ProgramUtils
				const toolIds = [
					ProgramUtils.TOOL_PYTHON,
					ProgramUtils.TOOL_PYTHON_WIN,
					ProgramUtils.TOOL_MAVPROXY,
					ProgramUtils.TOOL_CCACHE,
					ProgramUtils.TOOL_OPENOCD,
					ProgramUtils.TOOL_JLINK,
					ProgramUtils.TOOL_GCC,
					ProgramUtils.TOOL_GPP,
					ProgramUtils.TOOL_GDB,
					ProgramUtils.TOOL_ARM_GCC,
					ProgramUtils.TOOL_ARM_GPP,
					ProgramUtils.TOOL_ARM_GDB,
					ProgramUtils.TOOL_GDBSERVER,
					ProgramUtils.TOOL_PYSERIAL,
					ProgramUtils.TOOL_TMUX,
					ProgramUtils.TOOL_LSUSB
				];

				// Remove each tool path
				for (const toolId of toolIds) {
					await ProgramUtils.removeToolCustomPath(toolId);
				}

				// Notify the webview that configuration was reset
				this._panel.webview.postMessage({
					command: 'configurationSaved'
				});

				// Show success message
				vscode.window.showInformationMessage('All custom tool paths have been reset.');

				// Run validation again to check with default paths
				this._validateEnvironment();
			}
		});
	}

	/**
	 * Reports a tool's status to the webview, including whether it's using a custom path
	 * @param tool The tool ID in the webview
	 * @param result The result of the tool check
	 */
	private _reportToolStatus(tool: string, result: ProgramInfo): void {
		// The isCustomPath is already set in the result from ProgramUtils.findTool()
		const isCustomPath = result.isCustomPath;

		this._panel.webview.postMessage({
			command: 'validationResult',
			tool,
			available: result.available,
			version: result.version,
			path: result.path,
			info: result.info,
			isCustomPath
		});
	}

	/**
	 * Opens the Python interpreter selection dialog using Microsoft's Python extension
	 * and updates the tool path configuration
	 */
	private async _selectPythonInterpreter(): Promise<void> {
		try {
			const interpreterPath = await ProgramUtils.selectPythonInterpreter();
			if (interpreterPath) {
				// Save the selected interpreter path as the Python tool path
				await ProgramUtils.setToolCustomPath(ProgramUtils.TOOL_PYTHON, interpreterPath);

				vscode.window.showInformationMessage(`Python interpreter set to: ${interpreterPath}`);

				// Refresh the validation to show the new interpreter
				this._validateEnvironment();
			}
		} catch (error) {
			ValidateEnvironmentPanel.log.log(`Error selecting Python interpreter: ${error}`);
			vscode.window.showErrorMessage(`Failed to select Python interpreter: ${error}`);
		}
	}

	/**
	 * Sends the tools list to the webview
	 */
	private _sendToolsList(): void {
		const isWSL = ProgramUtils.isWSL();

		const allTools = [
			{ id: ProgramUtils.TOOL_PYTHON, name: 'Python' },
			{ id: ProgramUtils.TOOL_PYTHON_WIN, name: 'Python (Windows via WSL)', wslOnly: true },
			{ id: ProgramUtils.TOOL_MAVPROXY, name: 'MAVProxy' },
			{ id: ProgramUtils.TOOL_ARM_GCC, name: 'arm-none-eabi-gcc' },
			{ id: ProgramUtils.TOOL_GCC, name: 'gcc' },
			{ id: ProgramUtils.TOOL_GPP, name: 'g++' },
			{ id: ProgramUtils.TOOL_ARM_GDB, name: 'arm-none-eabi-gdb / gdb-multiarch' },
			{ id: ProgramUtils.TOOL_CCACHE, name: 'ccache' },
			{ id: ProgramUtils.TOOL_JLINK, name: 'JLinkGDBServerCLExe (Optional)' },
			{ id: ProgramUtils.TOOL_OPENOCD, name: 'OpenOCD (Optional)' },
			{ id: ProgramUtils.TOOL_GDBSERVER, name: 'GDB Server' },
			{ id: ProgramUtils.TOOL_PYSERIAL, name: 'PySerial' },
			{ id: ProgramUtils.TOOL_TMUX, name: 'tmux' },
			{ id: ProgramUtils.TOOL_LSUSB, name: 'lsusb (Linux USB utilities)', linuxOnly: true }
		];

		// Filter tools based on current platform
		const tools = allTools.filter(tool => {
			if (tool.wslOnly) {
				return isWSL;
			}
			if (tool.linuxOnly) {
				return os.platform() === 'linux';
			}
			return true;
		});

		this._panel.webview.postMessage({
			command: 'toolsList',
			tools: tools
		});
	}

	/**
	 * Sends the Python packages list to the webview
	 */
	private _sendPythonPackagesList(): void {
		const packages = ProgramUtils.REQUIRED_PYTHON_PACKAGES.map((pkg: {name: string; description: string}) => ({
			name: pkg.name,
			description: pkg.description || pkg.name
		}));

		this._panel.webview.postMessage({
			command: 'pythonPackagesList',
			packages: packages
		});
	}

	/**
	 * Reports a Python package's status to the webview
	 * @param packageName The package name
	 * @param result The result of the package check
	 */
	private _reportPackageStatus(packageName: string, result: ProgramInfo): void {
		this._panel.webview.postMessage({
			command: 'packageResult',
			package: packageName,
			available: result.available,
			version: result.version,
			info: result.info
		});
	}

	/**
	 * Updates the install packages button visibility
	 * @param showButton Whether to show the install button
	 */
	private _updateInstallPackagesButton(showButton: boolean): void {
		this._panel.webview.postMessage({
			command: 'updateInstallButton',
			show: showButton
		});
	}

	/**
	 * Opens a terminal to install missing Python packages
	 * @param instance - Optional ValidateEnvironmentPanel instance for auto-refresh
	 * @returns Promise that resolves on successful installation (exit code 0) or rejects on failure
	 */
	public static async installPythonPackages(instance?: ValidateEnvironmentPanel): Promise<void> {
		const packages = ProgramUtils.REQUIRED_PYTHON_PACKAGES.map(pkg => {
			// Include version if specified
			return pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name;
		});
		const packageList = packages.join(' ');

		// Get the same Python interpreter that was used for validation
		try {
			const pythonInfo = await ProgramUtils.findPython();
			if (!pythonInfo.available || !pythonInfo.command) {
				vscode.window.showErrorMessage('Python not found. Please install Python first.');
				return;
			}

			ValidateEnvironmentPanel.log.log(`Installing Python packages: ${packageList} using command: ${pythonInfo.command}`);
			const installCommand = `${pythonInfo.command} -m pip install ${packageList}`;

			// Create terminal with a unique name to track it
			const terminalName = 'Install Python Packages';

			// Create terminal monitor to track installation progress
			const terminalMonitor = new apTerminalMonitor(terminalName);

			terminalMonitor.createTerminal();

			vscode.window.showInformationMessage(
				'Installing Python packages... Please wait for completion.'
			);

			// Set up text callback for logging terminal output
			terminalMonitor.addTextCallback((text) => {
				ValidateEnvironmentPanel.log.log(`[${terminalName}] ${text}`);
			});

			// Use the new runCommand method which handles the complete command lifecycle
			try {
				const exitCode = await terminalMonitor.runCommand(installCommand);
				ValidateEnvironmentPanel.log.log(`Python package installation completed with exit code: ${exitCode}`);

				// Clean up the terminal monitor
				terminalMonitor.dispose();

				// Auto-refresh validation if instance provided
				if (instance && exitCode === 0) {
					ValidateEnvironmentPanel.log.log('Package installation successful, refreshing validation...');
					setTimeout(() => {
						instance._validateEnvironment();
					}, 1000); // Small delay to ensure pip install has completed
				}

				// Resolve or reject based on exit code
				if (exitCode === 0) {
					vscode.window.showInformationMessage('Python packages installed successfully!');
				} else {
					const errorMsg = `Installation failed with exit code ${exitCode}`;
					vscode.window.showErrorMessage(`Failed to install Python packages: ${errorMsg}`);
					throw new Error(errorMsg);
				}
			} catch (error) {
				terminalMonitor.dispose();
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Python package installation failed: ${errorMsg}`);
				throw error;
			}

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to get Python path: ${error}`);
		}
	}

	public dispose(): void {
		ValidateEnvironmentPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

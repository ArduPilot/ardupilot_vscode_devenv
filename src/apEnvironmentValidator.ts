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
import { apLog } from './apLog';
import * as child_process from 'child_process';
import { apWelcomeItem } from './apWelcomeItem';
import { ProgramUtils } from './apProgramUtils';
import { ToolsConfig } from './apToolsConfig';
import * as fs from 'fs';

export class ValidateEnvironment extends apWelcomeItem {
	static log = new apLog('validateEnvironment');

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

	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

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
		this._panel.webview.html = this._getInitialHtml();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
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
				}
			},
			null,
			this._disposables
		);

		// Start validation automatically
		setTimeout(() => {
			this._validateEnvironment();
		}, 500);
	}

	private _getInitialHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ArduPilot Environment Validation</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        h1 {
            color: var(--vscode-editor-foreground);
            font-size: 24px;
            margin-bottom: 20px;
        }
        .tool-container {
            margin-bottom: 20px;
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
        }
        .tool-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .tool-name {
            font-weight: bold;
            font-size: 16px;
        }
        .tool-status {
            font-size: 14px;
            padding: 3px 8px;
            border-radius: 3px;
        }
        .status-checking {
            background-color: #5c5c5c;
            color: white;
        }
        .status-available {
            background-color: #388a34;
            color: white;
        }
        .status-missing {
            background-color: #cc2222;
            color: white;
        }
        .tool-version {
            margin-top: 5px;
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        .tool-path {
            margin-top: 5px;
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
            display: flex;
            align-items: center;
        }
        .tool-path-text {
            flex-grow: 1;
            margin-right: 10px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 5px;
            margin-right: 5px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .config-button {
            padding: 4px 8px;
            font-size: 12px;
            margin-top: 0;
        }
        .action-buttons {
            margin-top: 20px;
            display: flex;
            gap: 10px;
        }
        #summary {
            margin-top: 20px;
            padding: 10px;
            border-radius: 5px;
            font-weight: bold;
        }
        .summary-ok {
            background-color: rgba(56, 138, 52, 0.1);
            border: 1px solid #388a34;
        }
        .summary-warning {
            background-color: rgba(204, 129, 0, 0.1);
            border: 1px solid #cc8100;
        }
        .summary-error {
            background-color: rgba(204, 34, 34, 0.1);
            border: 1px solid #cc2222;
        }
        .tool-info {
            margin-top: 5px;
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        .custom-path-notification {
            font-style: italic;
            color: var(--vscode-notificationsInfoIcon-foreground);
            margin-top: 5px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <h1>ArduPilot Environment Validation</h1>
    <div id="validation-results">
        <div class="tool-container" id="python" data-tool-id="${ProgramUtils.TOOL_PYTHON}">
            <div class="tool-header">
                <div class="tool-name">Python</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="mavproxy" data-tool-id="${ProgramUtils.TOOL_MAVPROXY}">
            <div class="tool-header">
                <div class="tool-name">MAVProxy</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="gcc" data-tool-id="${ProgramUtils.TOOL_ARM_GCC}">
            <div class="tool-header">
                <div class="tool-name">arm-none-eabi-gcc</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="gdb" data-tool-id="${ProgramUtils.TOOL_ARM_GDB}">
            <div class="tool-header">
                <div class="tool-name">arm-none-eabi-gdb / gdb-multiarch</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="ccache" data-tool-id="${ProgramUtils.TOOL_CCACHE}">
            <div class="tool-header">
                <div class="tool-name">ccache</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
            <div class="tool-info"></div>
        </div>
        
        <div class="tool-container" id="jlink" data-tool-id="${ProgramUtils.TOOL_JLINK}">
            <div class="tool-header">
                <div class="tool-name">JLinkGDBServerCLExe (Optional)</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="openocd" data-tool-id="${ProgramUtils.TOOL_OPENOCD}">
            <div class="tool-header">
                <div class="tool-name">OpenOCD (Optional)</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="pyserial" data-tool-id="${ProgramUtils.TOOL_PYSERIAL}">
            <div class="tool-header">
                <div class="tool-name">PySerial</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
            </div>
            <div class="custom-path-notification"></div>
            <div class="tool-info"></div>
        </div>
        
        <div id="summary"></div>
        
        <div class="action-buttons">
            <button id="refresh-btn">Refresh Validation</button>
            <button id="reset-all-paths-btn">Reset All Paths</button>
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            
            // Setup tool path configuration buttons
            document.querySelectorAll('.config-path-btn').forEach(btn => {
                btn.addEventListener('click', (event) => {
                    const toolContainer = event.target.closest('.tool-container');
                    const toolId = toolContainer.getAttribute('data-tool-id');
                    const toolName = toolContainer.querySelector('.tool-name').textContent;
                    
                    vscode.postMessage({
                        command: 'configureToolPath',
                        toolId: toolId,
                        toolName: toolName
                    });
                });
            });
            
            // Setup refresh button
            document.getElementById('refresh-btn').addEventListener('click', () => {
                // Reset all status indicators to "Checking..."
                document.querySelectorAll('.tool-status').forEach(el => {
                    el.className = 'tool-status status-checking';
                    el.textContent = 'Checking...';
                });
                
                // Clear all version and path info
                document.querySelectorAll('.tool-version, .tool-path-text, .tool-info, .custom-path-notification').forEach(el => {
                    el.textContent = '';
                });
                
                // Remove the summary
                document.getElementById('summary').textContent = '';
                document.getElementById('summary').className = '';
                
                // Send message to request validation
                vscode.postMessage({ command: 'checkEnvironment' });
            });
            
            // Setup reset all paths button
            document.getElementById('reset-all-paths-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'resetAllPaths' });
            });
            
            // Request initial validation when the page loads
            vscode.postMessage({ command: 'checkEnvironment' });
            
            // Handle messages from the extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'validationResult') {
                    const { tool, available, version, path, info, isCustomPath } = message;
                    const toolElement = document.getElementById(tool);
                    
                    if (toolElement) {
                        const statusElement = toolElement.querySelector('.tool-status');
                        const versionElement = toolElement.querySelector('.tool-version');
                        const pathElement = toolElement.querySelector('.tool-path-text');
                        const infoElement = toolElement.querySelector('.tool-info');
                        const notificationElement = toolElement.querySelector('.custom-path-notification');
                        
                        statusElement.className = 'tool-status ' + (available ? 'status-available' : 'status-missing');
                        statusElement.textContent = available ? 'Available' : 'Missing';
                        
                        if (version) {
                            versionElement.textContent = 'Version: ' + version;
                        }
                        
                        if (path) {
                            pathElement.textContent = 'Path: ' + path;
                        }
                        
                        if (isCustomPath) {
                            notificationElement.textContent = 'Using custom configured path';
                        } else {
                            notificationElement.textContent = '';
                        }
                        
                        if (info && infoElement) {
                            infoElement.innerHTML = info;
                        }
                    }
                } else if (message.command === 'validationSummary') {
                    const summaryElement = document.getElementById('summary');
                    summaryElement.textContent = message.message;
                    summaryElement.className = 'summary-' + message.status;
                } else if (message.command === 'configurationSaved') {
                    // Refresh validation after configuration is saved
                    vscode.postMessage({ command: 'checkEnvironment' });
                }
            });
        })();
    </script>
</body>
</html>`;
	}

	private async _validateEnvironment(): Promise<void> {
		const pythonCheck = ProgramUtils.findPython();
		const mavproxyCheck = ProgramUtils.findMavproxy();
		const gccCheck = ProgramUtils.findArmGCC();
		const gdbCheck = ProgramUtils.findArmGDB();
		const ccacheCheck = this._checkCCache();
		const pyserialCheck = ProgramUtils.findPyserial();

		// Check optional tools
		const jlinkCheck = ProgramUtils.findJLinkGDBServerCLExe().catch(() => ({ available: false }));
		const openocdCheck = ProgramUtils.findOpenOCD().catch(() => ({ available: false }));

		const [pythonResult, mavproxyResult, gccResult, gdbResult, ccacheResult, jlinkResult, openocdResult, pyserialResult] = await Promise.all([
			pythonCheck.catch(error => ({ available: false, error })),
			mavproxyCheck.catch(error => ({ available: false, error })),
			gccCheck.catch(error => ({ available: false, error })),
			gdbCheck.catch(error => ({ available: false, error })),
			ccacheCheck.catch(error => ({ available: false, error })),
			jlinkCheck,
			openocdCheck,
			pyserialCheck.catch(error => ({ available: false, error }))
		]);

		// Report results to webview
		this._reportToolStatus('python', pythonResult);
		this._reportToolStatus('mavproxy', mavproxyResult);
		this._reportToolStatus('gcc', gccResult);
		this._reportToolStatus('gdb', gdbResult);
		this._reportToolStatus('ccache', ccacheResult);
		this._reportToolStatus('jlink', jlinkResult);
		this._reportToolStatus('openocd', openocdResult);
		this._reportToolStatus('pyserial', pyserialResult);

		// Generate summary - only include required tools in the summary
		this._generateSummary([pythonResult, mavproxyResult, gccResult, gdbResult, ccacheResult, pyserialResult]);
	}

	private _checkCCache(): Promise<{ available: boolean, version?: string, path?: string, info?: string }> {
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
					info: ccacheInfo.join('<br>')
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
		// Show open file dialog to select the tool executable
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: `Select ${toolName} Executable`,
			filters: {
				'Executable Files': ['*'],
				'All Files': ['*']
			}
		};

		const fileUri = await vscode.window.showOpenDialog(options);
		if (fileUri && fileUri.length > 0) {
			const filePath = fileUri[0].fsPath;

			try {
				// Verify the file exists and is executable
				const stat = fs.statSync(filePath);

				// Check if file is executable (on Linux/Mac)
				// On Windows, we can't easily check this, so we just check if it's a file
				const isExecutable = process.platform === 'win32' ||
					!!(stat.mode & fs.constants.S_IXUSR);

				if (!stat.isFile()) {
					vscode.window.showErrorMessage(`${filePath} is not a file.`);
					return;
				}

				if (!isExecutable && process.platform !== 'win32') {
					const makeExecutable = await vscode.window.showWarningMessage(
						`${filePath} is not executable. Do you want to make it executable?`,
						'Yes', 'No'
					);

					if (makeExecutable === 'Yes') {
						// Make the file executable (user+group+others)
						fs.chmodSync(filePath, stat.mode | fs.constants.S_IXUSR | fs.constants.S_IXGRP | fs.constants.S_IXOTH);
					} else {
						return;
					}
				}

				// Save the custom path in the configuration
				ToolsConfig.setToolPath(toolId, filePath);

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
	private _resetAllToolPaths(): void {
		// Confirm with the user
		vscode.window.showWarningMessage(
			'Are you sure you want to reset all custom tool paths?',
			'Yes', 'No'
		).then(answer => {
			if (answer === 'Yes') {
				// Get all tool IDs from the ProgramUtils
				const toolIds = [
					ProgramUtils.TOOL_PYTHON,
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
					ProgramUtils.TOOL_PYSERIAL
				];

				// Remove each tool path
				for (const toolId of toolIds) {
					ToolsConfig.removeToolPath(toolId);
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
	private _reportToolStatus(tool: string, result: { available: boolean, version?: string, path?: string, info?: string, command?: string }): void {
		// Map the tool ID in the webview to the actual tool ID for configuration
		let toolId: string;
		switch (tool) {
		case 'python':
			toolId = ProgramUtils.TOOL_PYTHON;
			break;
		case 'mavproxy':
			toolId = ProgramUtils.TOOL_MAVPROXY;
			break;
		case 'gcc':
			toolId = ProgramUtils.TOOL_ARM_GCC;
			break;
		case 'gdb':
			toolId = ProgramUtils.TOOL_ARM_GDB;
			break;
		case 'ccache':
			toolId = ProgramUtils.TOOL_CCACHE;
			break;
		case 'jlink':
			toolId = ProgramUtils.TOOL_JLINK;
			break;
		case 'openocd':
			toolId = ProgramUtils.TOOL_OPENOCD;
			break;
		case 'pyserial':
			toolId = ProgramUtils.TOOL_PYSERIAL;
			break;
		default:
			toolId = '';
		}

		// Check if this tool is using a custom path
		const customPath = ToolsConfig.getToolPath(toolId);
		const isCustomPath = !!customPath && result.path === customPath;

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

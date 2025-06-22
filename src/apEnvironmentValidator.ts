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
import { ProgramUtils } from './apProgramUtils';
import { ToolsConfig } from './apToolsConfig';
import * as fs from 'fs';
import { install } from 'source-map-support';

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
		this._panel.webview.html = this._getInitialHtml();

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

		// Start validation automatically
		setTimeout(() => {
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
			this._installTool(message.toolId);
			break;
		}
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
        .install-button {
            background-color: #007acc;
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 5px;
            margin-top: 0;
            display: none;
        }
        .install-button:hover {
            background-color: #005a9e;
        }
        .tool-container .install-button {
            display: none;
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
        .platform-warning {
            margin-bottom: 20px;
            padding: 15px;
            background-color: rgba(204, 34, 34, 0.1);
            border: 1px solid #cc2222;
            border-radius: 5px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .platform-warning h2 {
            margin-top: 0;
            color: #cc2222;
        }
    </style>
</head>
<body>
    <h1>ArduPilot Environment Validation</h1>
    
    <div id="platform-warning" style="display:none;" class="platform-warning">
        <h2>Unsupported Platform Detected</h2>
        <p>ArduPilot development is only supported on macOS and Linux.</p>
        <p>You appear to be using Windows. Please install Windows Subsystem for Linux (WSL) to continue.</p>
        <div class="action-buttons">
            <button id="launch-wsl-btn">Launch WSL Installation Guide</button>
            <button id="open-vscode-wsl-btn">Open VSCode with WSL</button>
        </div>
    </div>
    
    <div id="validation-results">
        <div class="tool-container" id="python" data-tool-id="${ProgramUtils.TOOL_PYTHON}">
            <div class="tool-header">
                <div class="tool-name">Python</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button select-interpreter-btn" style="margin-left: 5px;">Select Interpreter</button>
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_PYTHON}">Install</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>

        <div class="tool-container" id="python-win" data-tool-id="${ProgramUtils.TOOL_PYTHON_WIN}" style="display:none;">
            <div class="tool-header">
                <div class="tool-name">Python (Windows via WSL)</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_PYTHON_WIN}">Install</button>
            </div>
            <div class="custom-path-notification"></div>
            <div class="tool-info">This Python is expected to be a Windows installation accessible from WSL (ensure python.exe is in your Windows PATH, if not Modify your installation and check the box to Add Python to  environment path). If the error is still present, try restarting WSL Instance, and chacking if python.exe is accessible in your WSL terminal</div>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_MAVPROXY}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_ARM_GCC}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_ARM_GDB}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_CCACHE}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_JLINK}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_OPENOCD}">Install</button>
            </div>
            <div class="custom-path-notification"></div>
        </div>
        
        <div class="tool-container" id="gdbserver" data-tool-id="${ProgramUtils.TOOL_GDBSERVER}">
            <div class="tool-header">
                <div class="tool-name">GDB Server</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_GDBSERVER}">Install</button>
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
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_PYSERIAL}">Install</button>
            </div>
            <div class="custom-path-notification"></div>
            <div class="tool-info"></div>
        </div>
        
        <div class="tool-container" id="tmux" data-tool-id="${ProgramUtils.TOOL_TMUX}">
            <div class="tool-header">
                <div class="tool-name">tmux</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path">
                <div class="tool-path-text"></div>
                <button class="config-button config-path-btn">Configure Path</button>
                <button class="install-button" data-tool-id="${ProgramUtils.TOOL_TMUX}">Install</button>
            </div>
            <div class="custom-path-notification"></div>
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
            
            // Platform detection - will be updated by the extension
            let currentPlatform = null;
            
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
            
            // Setup install tool buttons
            document.querySelectorAll('.install-button').forEach(btn => {
                btn.addEventListener('click', (event) => {
                    const toolContainer = event.target.closest('.tool-container');
                    const toolId = toolContainer.getAttribute('data-tool-id');
                    const toolName = toolContainer.querySelector('.tool-name').textContent;
                    
                    vscode.postMessage({
                        command: 'installTool',
                        toolId: toolId,
                        toolName: toolName
                    });
                });
            });
            
            // Setup Python interpreter selection button
            document.querySelectorAll('.select-interpreter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'selectPythonInterpreter'
                    });
                });
            });
            
            // Setup WSL launch button
            document.getElementById('launch-wsl-btn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'launchWSL'
                });
            });
            
            // Setup Open VSCode with WSL button
            document.getElementById('open-vscode-wsl-btn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'openVSCodeWSL'
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
                document.querySelectorAll('.tool-version, .tool-path-text, .custom-path-notification').forEach(el => {
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
                        const installButton = toolElement.querySelector('.install-button');
                        
                        statusElement.className = 'tool-status ' + (available ? 'status-available' : 'status-missing');
                        statusElement.textContent = available ? 'Available' : 'Missing';
                        
                        // Show/hide install button based on availability
                        if (installButton) {
                            installButton.style.display = available ? 'none' : 'inline-block';
                        }
                        
                        if (version) {
                            versionElement.textContent = 'Version: ' + version;
                        } else {
                            versionElement.textContent = '';
                        }
                        
                        if (path) {
                            pathElement.textContent = 'Path: ' + path;
                        } else {
                            pathElement.textContent = '';
                        }
                        
                        if (isCustomPath) {
                            notificationElement.textContent = 'Using custom configured path';
                        } else {
                            notificationElement.textContent = '';
                        }
                    }
                } else if (message.command === 'validationSummary') {
                    const summaryElement = document.getElementById('summary');
                    summaryElement.textContent = message.message;
                    summaryElement.className = 'summary-' + message.status;
                } else if (message.command === 'configurationSaved') {
                    // Refresh validation after configuration is saved
                    vscode.postMessage({ command: 'checkEnvironment' });
                } else if (message.command === 'platformCheck') {
                    currentPlatform = message.platform;
                    const platformWarningElement = document.getElementById('platform-warning');
                    const pythonWinElement = document.getElementById('python-win');
                    
                    if (message.platform === 'win32') {
                        platformWarningElement.style.display = 'block';
                        document.getElementById('validation-results').style.display = 'none';
                        if (pythonWinElement) pythonWinElement.style.display = 'none';
                    } else {
                        platformWarningElement.style.display = 'none';
                        document.getElementById('validation-results').style.display = 'block';
                        if (pythonWinElement) {
                            if (message.isWSL) {
                                pythonWinElement.style.display = 'block';
                            } else {
                                pythonWinElement.style.display = 'none';
                            }
                        }
                    }
                }
            });
        })();
    </script>
</body>
</html>`;
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
		const pythonWinCheck = isWSL ? ProgramUtils.findPythonWin() : Promise.resolve({ available: false, info: 'Not applicable outside WSL.' });
		const mavproxyCheck = ProgramUtils.findMavproxy();
		const gccCheck = ProgramUtils.findArmGCC();
		const gdbCheck = ProgramUtils.findArmGDB();
		const ccacheCheck = this._checkCCache();
		const pyserialCheck = ProgramUtils.findPyserial();
		const tmuxCheck = ProgramUtils.findTmux();

		// Check optional tools
		const jlinkCheck = ProgramUtils.findJLinkGDBServerCLExe().catch(() => ({ available: false }));
		const openocdCheck = ProgramUtils.findOpenOCD().catch(() => ({ available: false }));
		const gdbserverCheck = ProgramUtils.findGDBServer().catch(() => ({ available: false }));

		// Await all checks
		const [
			pythonResult,
			pythonWinResult,
			mavproxyResult,
			gccResult,
			gdbResult,
			ccacheResult,
			jlinkResult,
			openocdResult,
			gdbserverResult,
			pyserialResult,
			tmuxResult
		] = await Promise.all([
			pythonCheck.catch(error => ({ available: false, error: error.message })),
			pythonWinCheck.catch(error => ({ available: false, error: error.message })),
			mavproxyCheck.catch(error => ({ available: false, error: error.message })),
			gccCheck.catch(error => ({ available: false, error: error.message })),
			gdbCheck.catch(error => ({ available: false, error: error.message })),
			ccacheCheck.catch(error => ({ available: false, error: error.message })),
			jlinkCheck,
			openocdCheck,
			gdbserverCheck,
			pyserialCheck.catch(error => ({ available: false, error: error.message })),
			tmuxCheck.catch(error => ({ available: false, error: error.message }))
		]);

		// Report results to webview
		this._reportToolStatus('python', pythonResult);
		if (isWSL) {
			this._reportToolStatus('python-win', pythonWinResult);
		}
		this._reportToolStatus('mavproxy', mavproxyResult);
		this._reportToolStatus('gcc', gccResult);
		this._reportToolStatus('gdb', gdbResult);
		this._reportToolStatus('ccache', ccacheResult);
		this._reportToolStatus('jlink', jlinkResult);
		this._reportToolStatus('openocd', openocdResult);
		this._reportToolStatus('gdbserver', gdbserverResult);
		this._reportToolStatus('pyserial', pyserialResult);
		this._reportToolStatus('tmux', tmuxResult);

		// Generate summary - only include required tools in the summary
		const summaryTools = [pythonResult, mavproxyResult, gccResult, gdbResult, ccacheResult, gdbserverResult, pyserialResult, tmuxResult];
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
	 */
	private _installTool(toolId: string): void {
		const platform = process.platform;
		const isWSL = ProgramUtils.isWSL();

		// Get tool name for display
		const toolNames: { [key: string]: string } = {
			[ProgramUtils.TOOL_PYTHON]: 'Python',
			[ProgramUtils.TOOL_PYTHON_WIN]: 'Python (Windows)',
			[ProgramUtils.TOOL_MAVPROXY]: 'MAVProxy',
			[ProgramUtils.TOOL_ARM_GCC]: 'ARM GCC Toolchain',
			[ProgramUtils.TOOL_ARM_GDB]: 'ARM GDB',
			[ProgramUtils.TOOL_CCACHE]: 'ccache',
			[ProgramUtils.TOOL_JLINK]: 'J-Link',
			[ProgramUtils.TOOL_OPENOCD]: 'OpenOCD',
			[ProgramUtils.TOOL_GDBSERVER]: 'GDB Server',
			[ProgramUtils.TOOL_PYSERIAL]: 'PySerial',
			[ProgramUtils.TOOL_TMUX]: 'tmux'
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
				linux: this._getArmGccInstallCommand('linux'),
				darwin: this._getArmGccInstallCommand('darwin'),
				webUrl: 'https://firmware.ardupilot.org/Tools/STM32-tools/',
				description: 'Download and install ARM GCC toolchain version 10'
			},
			[ProgramUtils.TOOL_ARM_GDB]: {
				linux: 'sudo apt-get update && sudo apt-get install -y gdb-multiarch',
				darwin: 'brew install gdb',
				description: 'Install GDB for ARM debugging'
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
			}
		};

		const installation = installations[toolId];
		if (!installation) {
			vscode.window.showErrorMessage(`Installation not supported for ${toolName}`);
			return;
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

		if (command) {
			// Use terminal installation
			const terminal = vscode.window.createTerminal(`Install ${toolName}`);
			terminal.sendText(command);
			terminal.show();

			vscode.window.showInformationMessage(
				`Installing ${toolName}... Check the terminal for progress.`,
				'Refresh Validation'
			).then(choice => {
				if (choice === 'Refresh Validation') {
					// Wait a bit for installation to complete, then refresh
					setTimeout(() => {
						this._validateEnvironment();
					}, 2000);
				}
			});
		} else if (installation.webUrl) {
			// Use web-based installation
			vscode.env.openExternal(vscode.Uri.parse(installation.webUrl));
			vscode.window.showInformationMessage(
				`Opening ${toolName} download page. ${installation.description || 'Please download and install manually.'}`,
				'Refresh Validation'
			).then(choice => {
				if (choice === 'Refresh Validation') {
					this._validateEnvironment();
				}
			});
		} else {
			vscode.window.showErrorMessage(`No installation method available for ${toolName} on ${platform}`);
		}
	}

	/**
	 * Gets the ARM GCC installation command for the specified platform
	 */
	private _getArmGccInstallCommand(platform: 'linux' | 'darwin'): string {
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
		const extractedDir = filename.replace('.tar.bz2', '');

		return `cd /tmp && wget "${url}" && tar -xjf "${filename}" && sudo mv "${extractedDir}" /opt/gcc-arm-none-eabi && echo 'export PATH="/opt/gcc-arm-none-eabi/bin:\\$PATH"' >> ~/.bashrc && echo "ARM GCC installed! Please restart your terminal or run: source ~/.bashrc"`;
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

				// Check if file is executable
				const isExecutable = !(stat.mode & fs.constants.S_IXUSR);

				if (!stat.isFile()) {
					vscode.window.showErrorMessage(`${filePath} is not a file.`);
					return;
				}

				if (!isExecutable) {
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
		case 'python-win':
			toolId = ProgramUtils.TOOL_PYTHON_WIN;
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
		case 'tmux':
			toolId = ProgramUtils.TOOL_TMUX;
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

	/**
	 * Opens the Python interpreter selection dialog using Microsoft's Python extension
	 * and updates the tool path configuration
	 */
	private async _selectPythonInterpreter(): Promise<void> {
		try {
			const interpreterPath = await ProgramUtils.selectPythonInterpreter();
			if (interpreterPath) {
				// Save the selected interpreter path as the Python tool path
				ToolsConfig.setToolPath(ProgramUtils.TOOL_PYTHON, interpreterPath);

				vscode.window.showInformationMessage(`Python interpreter set to: ${interpreterPath}`);

				// Refresh the validation to show the new interpreter
				this._validateEnvironment();
			}
		} catch (error) {
			ValidateEnvironmentPanel.log.log(`Error selecting Python interpreter: ${error}`);
			vscode.window.showErrorMessage(`Failed to select Python interpreter: ${error}`);
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

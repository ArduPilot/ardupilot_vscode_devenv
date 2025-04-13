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
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 20px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
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
    </style>
</head>
<body>
    <h1>ArduPilot Environment Validation</h1>
    <div id="validation-results">
        <div class="tool-container" id="python">
            <div class="tool-header">
                <div class="tool-name">Python</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div class="tool-container" id="mavproxy">
            <div class="tool-header">
                <div class="tool-name">MAVProxy</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div class="tool-container" id="gcc">
            <div class="tool-header">
                <div class="tool-name">arm-none-eabi-gcc</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div class="tool-container" id="gdb">
            <div class="tool-header">
                <div class="tool-name">arm-none-eabi-gdb / gdb-multiarch</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div class="tool-container" id="ccache">
            <div class="tool-header">
                <div class="tool-name">ccache</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
            <div class="tool-info"></div>
        </div>
        
        <div class="tool-container" id="jlink">
            <div class="tool-header">
                <div class="tool-name">JLinkGDBServerCLExe (Optional)</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div class="tool-container" id="openocd">
            <div class="tool-header">
                <div class="tool-name">OpenOCD (Optional)</div>
                <div class="tool-status status-checking">Checking...</div>
            </div>
            <div class="tool-version"></div>
            <div class="tool-path"></div>
        </div>
        
        <div id="summary"></div>
        
        <button id="refresh-btn">Refresh Validation</button>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            
            document.getElementById('refresh-btn').addEventListener('click', () => {
                // Reset all status indicators to "Checking..."
                document.querySelectorAll('.tool-status').forEach(el => {
                    el.className = 'tool-status status-checking';
                    el.textContent = 'Checking...';
                });
                
                // Clear all version and path info
                document.querySelectorAll('.tool-version, .tool-path').forEach(el => {
                    el.textContent = '';
                });
                
                // Remove the summary
                document.getElementById('summary').textContent = '';
                document.getElementById('summary').className = '';
                
                // Send message to request validation
                vscode.postMessage({ command: 'checkEnvironment' });
            });
            
            // Request initial validation when the page loads
            vscode.postMessage({ command: 'checkEnvironment' });
            
            // Handle messages from the extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'validationResult') {
                    const { tool, available, version, path, info } = message;
                    const toolElement = document.getElementById(tool);
                    
                    if (toolElement) {
                        const statusElement = toolElement.querySelector('.tool-status');
                        const versionElement = toolElement.querySelector('.tool-version');
                        const pathElement = toolElement.querySelector('.tool-path');
                        const infoElement = toolElement.querySelector('.tool-info');
                        
                        statusElement.className = 'tool-status ' + (available ? 'status-available' : 'status-missing');
                        statusElement.textContent = available ? 'Available' : 'Missing';
                        
                        if (version) {
                            versionElement.textContent = 'Version: ' + version;
                        }
                        
                        if (path) {
                            pathElement.textContent = 'Path: ' + path;
                        }
                        
                        if (info && infoElement) {
                            infoElement.innerHTML = info;
                        }
                    }
                } else if (message.command === 'validationSummary') {
                    const summaryElement = document.getElementById('summary');
                    summaryElement.textContent = message.message;
                    summaryElement.className = 'summary-' + message.status;
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

		// Check optional tools
		const jlinkCheck = ProgramUtils.findJLinkGDBServerCLExe().catch(() => ({ available: false }));
		const openocdCheck = ProgramUtils.findOpenOCD().catch(() => ({ available: false }));

		const [pythonResult, mavproxyResult, gccResult, gdbResult, ccacheResult, jlinkResult, openocdResult] = await Promise.all([
			pythonCheck.catch(error => ({ available: false, error })),
			mavproxyCheck.catch(error => ({ available: false, error })),
			gccCheck.catch(error => ({ available: false, error })),
			gdbCheck.catch(error => ({ available: false, error })),
			ccacheCheck.catch(error => ({ available: false, error })),
			jlinkCheck,
			openocdCheck
		]);

		// Report results to webview
		this._reportToolStatus('python', pythonResult);
		this._reportToolStatus('mavproxy', mavproxyResult);
		this._reportToolStatus('gcc', gccResult);
		this._reportToolStatus('gdb', gdbResult);
		this._reportToolStatus('ccache', ccacheResult);
		this._reportToolStatus('jlink', jlinkResult);
		this._reportToolStatus('openocd', openocdResult);

		// Generate summary - only include required tools in the summary
		this._generateSummary([pythonResult, mavproxyResult, gccResult, gdbResult, ccacheResult]);
	}

	private _reportToolStatus(tool: string, result: { available: boolean, version?: string, path?: string, info?: string }): void {
		this._panel.webview.postMessage({
			command: 'validationResult',
			tool,
			available: result.available,
			version: result.version,
			path: result.path,
			info: result.info
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

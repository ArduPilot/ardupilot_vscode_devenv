/*
   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <http://www.gnu.org/licenses/>.

   Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

import * as vscode from 'vscode';
import { apLog } from './apLog';
import * as fs from 'fs';
import { simpleGit, SimpleGitProgressEvent } from 'simple-git';
import * as child_process from 'child_process';

export class apWelcomeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
	}
}

class cloneArdupilot extends apWelcomeItem {
	static log = new apLog('cloneArdupilot');
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		vscode.commands.registerCommand('apClone', () => cloneArdupilot.run());
	}

	static run(): void {
		// clone the ardupilot repository
		this.log.log('cloneArdupilot called');
		// show open dialog box to select the directory
		const options: vscode.OpenDialogOptions = {
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Select Directory to Clone Ardupilot',
		};
		vscode.window.showOpenDialog(options).then((uri) => {
			if (uri) {
				let finalUri = uri[0];
				// ask the user to name the directory
				vscode.window.showInputBox({
					placeHolder: 'Enter the name of the directory to clone Ardupilot',
					prompt: 'Enter the name of the directory to clone Ardupilot'
				}).then((name) => {
					if (!name) {
						name = '';
					}
					finalUri = vscode.Uri.joinPath(uri[0], name);
					// create the directory if it does not exist
					if (!fs.existsSync(finalUri.fsPath)) {
						fs.mkdirSync(finalUri.fsPath);
					} else {
						// fail if the directory already exists
						vscode.window.showErrorMessage('Directory already exists');
					}

					const abortController = new AbortController();

					let progressReference: vscode.Progress<{ message?: string; increment?: number; }> | null = null;
					let progressFinishPromiseResolve: () => void;
					const progressFinishPromise: Promise<void> = new Promise<void>((resolve) => {
						progressFinishPromiseResolve = resolve;
					});
					// show progress bar
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Cloning Ardupilot',
						cancellable: true
					}, (prog, token) => {
						token.onCancellationRequested(() => {
							this.log.log('Clone cancelled by user');
							abortController.abort();
						});
						progressReference = prog;
						return progressFinishPromise;
					});
					let lastProgress = 0;
					// clone the repository using simple-git and pass the percent progress to vscode
					const progController = ({ method, stage, progress }: SimpleGitProgressEvent) => {
						this.log.log(`git.${method} ${stage} stage ${progress}% complete`);
						if (method === 'clone' && progressReference && progress != lastProgress) {
							progressReference.report({ message: `${stage}`, increment: progress - lastProgress });
							lastProgress = progress;
						}
					};
					const git = simpleGit({ baseDir: finalUri.fsPath, progress: progController, abort: abortController.signal });
					git.clone('https://www.github.com/ardupilot/ardupilot.git', finalUri.fsPath, ['--progress'])
						.then(() => {
							// close the progress bar
							progressFinishPromiseResolve();
							// add the cloned repository to the workspace
							vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: finalUri });
						}, () => {
							progressFinishPromiseResolve();
							if (!abortController.signal.aborted) {
								// show failed to clone
								vscode.window.showErrorMessage('Failed to clone ardupilot');
							}
						});

					return finalUri;
				});
			}
		});
	}

	// set logo for the tree item
	iconPath = new vscode.ThemeIcon('repo-clone');

	command = {
		command: 'apClone',
		title: 'Clone Ardupilot',
		arguments: [this.label]
	};

	contextValue = 'cloneArdupilot';
}

class validateEnvironment extends apWelcomeItem {
	static log = new apLog('validateEnvironment');

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		vscode.commands.registerCommand('apValidateEnv', () => validateEnvironment.run());
	}

	static run(): void {
		this.log.log('validateEnvironment called');
		// Create a webview panel to show the validation results
		validateEnvironmentPanel.createOrShow(vscode.window.activeTextEditor?.viewColumn);
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
export class validateEnvironmentPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: validateEnvironmentPanel | undefined;

	public static readonly viewType = 'validateEnvironmentPanel';
	private static log = new apLog('validateEnvironmentPanel');

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(column?: vscode.ViewColumn): void {
		const activeColumn = column || vscode.ViewColumn.One;

		// If we already have a panel, show it
		if (validateEnvironmentPanel.currentPanel) {
			validateEnvironmentPanel.currentPanel._panel.reveal(activeColumn);
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			validateEnvironmentPanel.viewType,
			'ArduPilot Environment Validation',
			activeColumn,
			{
				// Enable scripts in the webview
				enableScripts: true
			}
		);

		validateEnvironmentPanel.currentPanel = new validateEnvironmentPanel(panel);
	}

	private constructor(panel: vscode.WebviewPanel) {
		this._panel = panel;
		this._extensionUri = vscode.extensions.getExtension('cubepilot.ardupilot-devenv')?.extensionUri || vscode.Uri.file('');

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
		const pythonCheck = this._checkTool('python', ['--version']);
		const mavproxyCheck = this._checkTool('mavproxy.py', ['--version']);
		const gccCheck = this._checkTool('arm-none-eabi-gcc', ['--version']);
		const gdbCheck = this._checkTool('arm-none-eabi-gdb', ['--version']).catch(() => {
			// If arm-none-eabi-gdb fails, try gdb-multiarch
			return this._checkTool('gdb-multiarch', ['--version']);
		});
		const ccacheCheck = this._checkCCache();

		// Check optional tools
		const jlinkCheck = this._checkTool('JLinkGDBServerCLExe', ['--version']).catch(() => ({ available: false }));
		const openocdCheck = this._checkTool('openocd', ['--version']).catch(() => ({ available: false }));

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

	private _checkTool(command: string, args: string[]): Promise<{ available: boolean, version?: string, path?: string }> {
		return new Promise((resolve, reject) => {
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
						// Tool exists, now find its path
						child_process.exec(`which ${command}`, (error, stdout) => {
							const path = error ? 'Unknown' : stdout.trim();

							// Extract version from output
							const versionOutput = output || errorOutput;
							let version = 'Unknown';

							// Special handling for JLinkGDBServerCLExe which has a different version format
							if (command === 'JLinkGDBServerCLExe') {
								// Example: "SEGGER J-Link GDB Server V7.94e Command Line Version"
								const jlinkVersionMatch = versionOutput.match(/GDB Server V([\d.]+[a-z]?)/);
								if (jlinkVersionMatch) {
									version = jlinkVersionMatch[1];
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
						});
					} else {
						reject(new Error(`Tool exited with code ${code}`));
					}
				});

				process.on('error', () => {
					reject(new Error(`Failed to execute ${command}`));
				});
			} catch (error) {
				reject(error);
			}
		});
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
		// disabled eslint rule for async promise executor as we are
		// specifically catching errors for each check
		// and handling them in the promise chain
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
				// First check if ccache is installed
				const ccacheResult = await this._checkTool('ccache', ['-V']).catch(() => null);

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
		validateEnvironmentPanel.currentPanel = undefined;

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

export class apWelcomeProvider implements vscode.TreeDataProvider<apWelcomeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<apWelcomeItem | undefined> = new vscode.EventEmitter<apWelcomeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apWelcomeItem | undefined> = this._onDidChangeTreeData.event;
	private log = new apLog('apWelcomeProvider');

	constructor() {
		this.log.log('apWelcomeProvider constructor');
	}

	getTreeItem(element: apWelcomeItem): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(new apWelcomeItem('Welcome', vscode.TreeItemCollapsibleState.None));
	}

	getChildren(): Thenable<apWelcomeItem[]> {
		// Return both Clone Ardupilot and Validate Environment items
		return Promise.resolve([
			new cloneArdupilot('Clone Ardupilot', vscode.TreeItemCollapsibleState.None),
			new validateEnvironment('Validate Environment', vscode.TreeItemCollapsibleState.None)
		]);
	}
}

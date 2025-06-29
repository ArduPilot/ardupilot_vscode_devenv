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
import * as path from 'path';
import * as fs from 'fs';
import { apLog } from './apLog';
import { getFeaturesList, APTaskProvider } from './taskProvider';
import * as cp from 'child_process';
import { targetToBin } from './apBuildConfig';
import { ValidateEnvironmentPanel, ValidateEnvironment } from './apEnvironmentValidator';

export class UIHooks {
	_panel: vscode.WebviewPanel;
	_disposables: vscode.Disposable[] = [];
	listeners: { [event: string]: ((data: Record<string, unknown>) => void)[] } = {};
	private static log = new apLog('uiHooks').log;

	constructor(panel: vscode.WebviewPanel, private _extensionUri: vscode.Uri) {
		this._panel = panel;
		this._panel.webview.onDidReceiveMessage(
			message => {
				this._onMessage(message);
			},
			null,
			this._disposables);
	}

	dispose(): void {
		this._panel.dispose();
		this._disposables.forEach(d => d.dispose());
	}

	private _onMessage(message: Record<string, unknown>): void {
		// call the listeners matching message.command
		const command = message.command as string;
		if (this.listeners[command]) {
			this.listeners[command].forEach(listener => {
				listener(message);
			});
		}

		// Environment validation commands - redirect to ValidateEnvironmentPanel
		if (ValidateEnvironment.ENVIRONMENT_COMMANDS.includes(command)) {
			if (ValidateEnvironmentPanel.currentPanel) {
				ValidateEnvironmentPanel.currentPanel['_onReceiveMessage'](message as {command: string, toolId: string, toolName: string});
			}
			return;
		}

		switch (command) {
		case 'getTasksList':
			this.getTasksList();
			break;
		case 'build':
			// unhandled here
			break;
		case 'getFeaturesList':
			this.getFeaturesList();
			break;
		case 'extractFeatures':
			this.extractFeatures(message);
			break;
		case 'getConfigureOptions':
			this.getConfigureOptions();
			break;
		case 'getSITLOptions':
			this.getSITLOptions();
			break;
		case 'getBuildCommands':
			this.getBuildCommands(message);
			break;
		case 'close':
			this._panel.dispose();
			break;
		case 'error':
			UIHooks.log(`Error from webview: ${message.message} at ${message.location}`);
			UIHooks.log(`Stack: ${message.stack}`);
			break;
		default:
			// respond to unknown commands with undefined
			this._panel.webview.postMessage({ command: message.command, response: 'Bad Request' });
			break;
		}
	}

	private getTasksList(): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (workspaceRoot === undefined) {
			this._panel.webview.postMessage({ command: 'getTasksList', tasksList: undefined });
			return;
		}
		const taskslistfile = path.join(workspaceRoot, 'tasklist.json');
		if (!fs.existsSync(taskslistfile)) {
			this._panel.webview.postMessage({ command: 'getTasksList', tasksList: undefined });
			return;
		}
		try {
			const data = fs.readFileSync(taskslistfile, 'utf8');
			this._panel.webview.postMessage({ command: 'getTasksList', tasksList: data });
		} catch (error) {
			UIHooks.log(`Error reading tasklist.json: ${error}`);
			this._panel.webview.postMessage({ command: 'getTasksList', tasksList: undefined });
		}
	}

	public getFeaturesList(): void {
		this._panel.webview.postMessage({ command: 'getFeaturesList', featuresList: getFeaturesList(this._extensionUri) });
	}

	public extractFeatures(message: Record<string, unknown>): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			this._panel.webview.postMessage({ command: 'extractFeatures', features: [], error: 'No workspace folder found' });
			return;
		}

		const board = message.board as string;
		const target = message.target as string;

		if (!board || !target) {
			this._panel.webview.postMessage({ command: 'extractFeatures', features: [], error: 'Board and target are required' });
			return;
		}

		try {
			const targetDir = path.join(workspaceRoot, 'build', board);
			const binaryFile = this.findBinaryFile(targetDir, target);

			if (!binaryFile || !fs.existsSync(binaryFile)) {
				this._panel.webview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: `Binary file not found for ${board}-${target}. Please build the firmware first.`
				});
				return;
			}

			const extractFeaturesScript = path.join(workspaceRoot, 'Tools', 'scripts', 'extract_features.py');
			if (!fs.existsSync(extractFeaturesScript)) {
				this._panel.webview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: 'extract_features.py script not found'
				});
				return;
			}
			let nm = 'arm-none-eabi-nm';
			if (board.toLowerCase().includes('sitl')) {
				nm = 'nm'; // Use 'nm' for SITL targets
			}
			const result = cp.spawnSync('python3', [extractFeaturesScript, '--nm', nm, binaryFile]);
			if (result.status !== 0) {
				UIHooks.log(`extract_features.py failed: ${result.stderr?.toString()}`);
				this._panel.webview.postMessage({
					command: 'extractFeatures',
					features: [],
					error: `Failed to extract features: ${result.stderr?.toString() || 'Unknown error'}`
				});
				return;
			}

			const output = result.stdout?.toString() || '';
			const lines = output.split('\n').filter((line: string) => line.trim());
			const features = lines.map((line: string) => line.trim());

			this._panel.webview.postMessage({
				command: 'extractFeatures',
				features: features
			});

		} catch (error) {
			UIHooks.log(`Error extracting features: ${error}`);
			this._panel.webview.postMessage({
				command: 'extractFeatures',
				features: [],
				error: `Error extracting features: ${error}`
			});
		}
	}

	private findBinaryFile(targetDir: string, target: string): string | null {
		const target_output = targetToBin[target];
		const target_binary = `${targetDir}/${target_output}`;

		if (fs.existsSync(target_binary)) {
			return target_binary;
		}

		return null;
	}

	public on(event: string, listener: (data: Record<string, unknown>) => void): void {
		// add listener to the list
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(listener);
	}

	public getConfigureOptions(): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			this._panel.webview.postMessage({ command: 'getConfigureOptions', options: [], error: 'No workspace folder found' });
			return;
		}

		try {
			// Execute waf configure --help
			const wafPath = path.join(workspaceRoot, 'waf');
			const result = cp.spawnSync('python3', [wafPath, 'configure', '--help'], {
				cwd: workspaceRoot,
				encoding: 'utf8'
			});

			if (result.status !== 0) {
				UIHooks.log(`waf configure --help failed: ${result.stderr?.toString()}`);
				this._panel.webview.postMessage({
					command: 'getConfigureOptions',
					options: [],
					error: `Failed to get configure options: ${result.stderr?.toString() || 'Unknown error'}`
				});
				return;
			}

			const output = result.stdout?.toString() || '';
			const options = this.parseConfigureOptions(output);

			// Get feature list to filter out feature-specific options
			const featuresData = getFeaturesList(this._extensionUri);
			const featuresObject = (featuresData as Record<string, unknown>)?.features || {};
			const featureOptions = new Set<string>();

			// Convert feature labels to option format
			Object.values(featuresObject).forEach((feature: Record<string, unknown>) => {
				if (feature.label && typeof feature.label === 'string') {
					const optionName = feature.label.replace(/\s+/g, '-');
					featureOptions.add(`--enable-${optionName}`);
					featureOptions.add(`--disable-${optionName}`);
				}
			});

			// Filter out feature options and embed commands
			const filteredOptions = options.filter(opt => {
				// Filter out feature-specific options
				if (featureOptions.has(opt.name)) {
					return false;
				}

				// Filter out embed commands
				if (opt.name.includes('embed') || opt.description?.toLowerCase().includes('embed')) {
					return false;
				}

				// Filter out board selection (handled separately)
				if (opt.name === '--board') {
					return false;
				}

				return true;
			});

			this._panel.webview.postMessage({
				command: 'getConfigureOptions',
				options: filteredOptions
			});
			UIHooks.log(`Successfully retrieved configure options: ${filteredOptions.length} options found`);
		} catch (error) {
			UIHooks.log(`Error getting configure options: ${error}`);
			this._panel.webview.postMessage({
				command: 'getConfigureOptions',
				options: [],
				error: `Error getting configure options: ${error}`
			});
		}
	}

	public getSITLOptions(): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			this._panel.webview.postMessage({ command: 'getSITLOptions', options: [], error: 'No workspace folder found' });
			return;
		}

		try {
			// Execute sim_vehicle.py --help
			const simVehiclePath = path.join(workspaceRoot, 'Tools', 'autotest', 'sim_vehicle.py');
			const result = cp.spawnSync('python3', [simVehiclePath, '--help'], {
				cwd: workspaceRoot,
				encoding: 'utf8'
			});

			if (result.status !== 0) {
				UIHooks.log(`sim_vehicle.py --help failed: ${result.stderr?.toString()}`);
				this._panel.webview.postMessage({
					command: 'getSITLOptions',
					options: [],
					error: `Failed to get SITL options: ${result.stderr?.toString() || 'Unknown error'}`
				});
				return;
			}

			const output = result.stdout?.toString() || '';
			const options = this.parseSITLOptions(output);

			this._panel.webview.postMessage({
				command: 'getSITLOptions',
				options: options
			});
			UIHooks.log(`Successfully retrieved SITL options: ${options.length} options found`);
		} catch (error) {
			UIHooks.log(`Error getting SITL options: ${error}`);
			this._panel.webview.postMessage({
				command: 'getSITLOptions',
				options: [],
				error: `Error getting SITL options: ${error}`
			});
		}
	}

	private parseSITLOptions(helpText: string): { name: string; description: string }[] {
		const options: { name: string; description: string }[] = [];
		const lines = helpText.split('\n');

		// Look for option patterns throughout the help text
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match option patterns for sim_vehicle.py format:
			// "  -A SITL_INSTANCE_ARGS, --sitl-instance-args=SITL_INSTANCE_ARGS" (short + long)
			// "  -h, --help            show this help message and exit" (short + long)
			// "  --version             show program's version number and exit" (long only)
			// "    -N, --no-rebuild    don't rebuild before starting ardupilot" (indented)

			// Try to match lines with short options first (may have long options too)
			let optionMatch = line.match(/^\s*(-[A-Za-z](?:\s+\w+)?),?\s*(--[\w-]+(?:=[\w-]+)?)?(?:\s+(.*))?$/);
			let shortOption = '';
			let longOption = '';
			let description = '';

			if (optionMatch) {
				shortOption = optionMatch[1] || '';
				longOption = optionMatch[2] || '';
				description = optionMatch[3] || '';
			} else {
				// Try to match lines with long options only
				optionMatch = line.match(/^\s*(--[\w-]+(?:=[\w-]+)?)(?:\s+(.*))?$/);
				if (optionMatch) {
					longOption = optionMatch[1];
					description = optionMatch[2] || '';
				}
			}

			if (shortOption || longOption) {
				// Collect multi-line descriptions
				let j = i + 1;
				while (j < lines.length && lines[j].match(/^\s{20,}/)) {
					description += ' ' + lines[j].trim();
					j++;
				}

				// Clean up options (remove arguments and =VALUE)
				const cleanShortOption = shortOption ? shortOption.split(/\s+/)[0] : '';
				const cleanLongOption = longOption ? longOption.split('=')[0] : '';

				// Combine short and long options into a single entry
				let combinedName = '';
				if (cleanShortOption && cleanLongOption) {
					combinedName = `${cleanShortOption}, ${cleanLongOption}`;
				} else if (cleanShortOption) {
					combinedName = cleanShortOption;
				} else if (cleanLongOption) {
					combinedName = cleanLongOption;
				}

				if (combinedName) {
					options.push({
						name: combinedName,
						description: description.trim()
					});
				}
			}
		}

		return options;
	}

	private parseConfigureOptions(helpText: string): { name: string; description: string }[] {
		const options: { name: string; description: string }[] = [];
		const lines = helpText.split('\n');

		// Look for option patterns throughout the help text
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match option patterns for waf configure format:
			// "  -c COLORS, --color=COLORS" (short + long)
			// "  -g, --debug-symbols" (short + long)
			// "  --version             show program's version number and exit" (long only)
			// "    -o OUT, --out=OUT   build dir for the project" (indented)

			// Try to match lines with short options first (may have long options too)
			let optionMatch = line.match(/^\s*(-[A-Za-z](?:\s+\w+)?),?\s*(--[\w-]+(?:=[\w-]+)?)?(?:\s+(.*))?$/);
			let shortOption = '';
			let longOption = '';
			let description = '';

			if (optionMatch) {
				shortOption = optionMatch[1] || '';
				longOption = optionMatch[2] || '';
				description = optionMatch[3] || '';
			} else {
				// Try to match lines with long options only
				optionMatch = line.match(/^\s*(--[\w-]+(?:=[\w-]+)?)(?:\s+(.*))?$/);
				if (optionMatch) {
					longOption = optionMatch[1];
					description = optionMatch[2] || '';
				}
			}

			if (shortOption || longOption) {
				// Collect multi-line descriptions
				let j = i + 1;
				while (j < lines.length && lines[j].match(/^\s{20,}/)) {
					description += ' ' + lines[j].trim();
					j++;
				}

				// Clean up options (remove arguments and =VALUE)
				const cleanShortOption = shortOption ? shortOption.split(/\s+/)[0] : '';
				const cleanLongOption = longOption ? longOption.split('=')[0] : '';

				// Combine short and long options into a single entry
				let combinedName = '';
				if (cleanShortOption && cleanLongOption) {
					combinedName = `${cleanShortOption}, ${cleanLongOption}`;
				} else if (cleanShortOption) {
					combinedName = cleanShortOption;
				} else if (cleanLongOption) {
					combinedName = cleanLongOption;
				}

				// Ensure we have a valid option name
				if (combinedName && (cleanShortOption.startsWith('-') || cleanLongOption.startsWith('--'))) {
					options.push({
						name: combinedName,
						description: description.trim()
					});
				}
			}
		}

		return options;
	}

	public getBuildCommands(message: Record<string, unknown>): void {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			this._panel.webview.postMessage({
				command: 'getBuildCommands',
				configureCommand: '',
				buildCommand: '',
				error: 'No workspace folder found'
			});
			return;
		}

		const board = message.board as string;
		const target = message.target as string;
		const configureOptions = message.configureOptions as string || '';
		const buildOptions = message.buildOptions as string || '';

		if (!board || !target) {
			this._panel.webview.postMessage({
				command: 'getBuildCommands',
				configureCommand: '',
				buildCommand: ''
			});
			return;
		}

		try {
			// Use shared command generation method from APTaskProvider
			const commands = APTaskProvider.generateBuildCommands(
				board,
				target,
				configureOptions,
				buildOptions,
				workspaceRoot
			);

			this._panel.webview.postMessage({
				command: 'getBuildCommands',
				configureCommand: commands.configureCommand,
				buildCommand: commands.buildCommand
			});

		} catch (error) {
			UIHooks.log(`Error generating build commands: ${error}`);
			this._panel.webview.postMessage({
				command: 'getBuildCommands',
				configureCommand: '',
				buildCommand: '',
				error: `Error generating build commands: ${error}`
			});
		}
	}
}

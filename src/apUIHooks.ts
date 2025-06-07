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
import { getFeaturesList } from './taskProvider';
import * as cp from 'child_process';
import { targetToBin } from './apBuildConfig';

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
}

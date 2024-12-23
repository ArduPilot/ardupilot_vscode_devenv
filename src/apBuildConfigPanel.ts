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
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { ArdupilotTaskDefinition } from './taskProvider';
import { APTaskProvider } from './taskProvider';

/**
 * Manages Build Configuration webview panels
 */
export class apBuildConfigPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: apBuildConfigPanel | undefined;

	public static readonly viewType = 'apBuildConfigPanel';
	private static log = new apLog('apBuildConfigPanel');

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private _currentTask: vscode.Task | undefined;
	private _currentFeaturesList: string[] = [];

	private fileUri = (fp: string) => {
		const fragments = fp.split('/');

		return vscode.Uri.file(
			path.join(this._extensionUri.path, ...fragments)
		);
	};

	public static createOrShow(extensionUri: vscode.Uri, currentTask?: vscode.Task) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// dispose the current panel and create a fresh one
		if (currentTask !== undefined && apBuildConfigPanel.currentPanel) {
			apBuildConfigPanel.currentPanel.dispose();
			apBuildConfigPanel.currentPanel = undefined;
		}

		// If we already have a panel, show it.
		if (apBuildConfigPanel.currentPanel) {
			apBuildConfigPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel and enable js
		const panel = vscode.window.createWebviewPanel(
			apBuildConfigPanel.viewType,
			'Create a new build configuration',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
			}
		);

		apBuildConfigPanel.currentPanel = new apBuildConfigPanel(panel, extensionUri, currentTask);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, currentTask?: vscode.Task) {
		apBuildConfigPanel.currentPanel = new apBuildConfigPanel(panel, extensionUri, currentTask);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, currentTask?: vscode.Task) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._currentTask = currentTask;

		// load features.txt from build/<board> directory
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
		} else if (currentTask) {
			const featuresPath = path.join(workspaceRoot, 'build', currentTask.definition.configure, 'features.txt');
			if (fs.existsSync(featuresPath)) {
				const features = fs.readFileSync(featuresPath, 'utf8').split('\n');
				for (const feature of features) {
					// if feature starts with '! ', it is disabled
					if (!feature.startsWith('!')) {
						this._currentFeaturesList.push(feature);
					}
				}
			}
		}

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
		this._panel.title = 'New Build Configuration';
		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
		// on receiving a message from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'submit':
						// create a new build configuration
						apBuildConfigPanel.log.log(`Received message from webview: ${JSON.stringify(message)}`);
						this.createBuildConfig(message.board, message.target, message.configureOptions, message.features);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	private createBuildConfig(board: string, target: string, configureOptions: string, features: { [key: string]: string[] }) {
		// create a new task definition in tasks.json
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		apBuildConfigPanel.log.log(`Creating new build configuration for ${board} ${target} @ ${workspaceRoot}`);
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}
		const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			// create a new tasks.json file
			fs.writeFileSync(tasksPath, '{"version": "2.0", "tasks": []}', 'utf8');
		}
		const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		const taskName = `${board}-${target}`;
		apBuildConfigPanel.log.log(`Creating task ${JSON.stringify(tasks)}`);
		// check through the tasks.json file matching board and target
		let taskExists = false;
		let currentTaskDef:ArdupilotTaskDefinition | null = null;
		for (const task of tasks.tasks) {
			if (task.configure === board && task.target === target) {
				task.configureOptions = configureOptions;
				task.buildOptions = "";
				taskExists = true;
				currentTaskDef = task;
			}
		}
		if (!taskExists) {
			// create a new task definition with link to waf file in workspaceRoot/waf
			const taskDefinition: ArdupilotTaskDefinition = {
				type: 'ardupilot',
				configure: board,
				target: target,
				configureOptions: configureOptions,
				buildOptions: '',
			};
			currentTaskDef = taskDefinition;
			tasks.tasks.push(taskDefinition);
		}

		fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 4), 'utf8');
		apBuildConfigPanel.log.log(`Added task ${taskName} to ${tasksPath}`);
		// execute the task
		if (currentTaskDef) {
			const task = APTaskProvider.createTask(currentTaskDef);
			vscode.tasks.executeTask(task).then((execution) => {
				vscode.tasks.onDidEndTaskProcess((e) => {
					if (e.execution == execution) {
						apBuildConfigPanel.createOrShow(this._extensionUri, task);
					}
				});
			});
		}
	}

	public doRefactor() {
		// Send a message to the webview webview.
		// You can send any JSON serializable data.
		this._panel.webview.postMessage({ command: 'refactor' });
	}

	public dispose() {
		apBuildConfigPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {

		const assetUri = (fp: string) => {
			return this._panel.webview.asWebviewUri(this.fileUri(fp));
		};

		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
		}
		// read tasklist.json
		const taskListPath = path.join(workspaceRoot, 'tasklist.json');
		if (!fs.existsSync(taskListPath)) {
			throw new Error('tasklist.json not found');
		}
		const taskList = JSON.parse(fs.readFileSync(taskListPath, 'utf8'));
		// create a list of configurations
		const boards = taskList.map((task: any) => task.configure);
		// create a json list of boards
		const boardsList = JSON.stringify(boards);
		boards.sort((a: string, b: string) => {
			if (a.startsWith('Cube') && !b.startsWith('Cube')) {
				return -1;
			}
			if (!a.startsWith('Cube') && b.startsWith('Cube')) {
				return 1;
			}
			return a.localeCompare(b);
		});
		const boardTargets: { [key: string]: string[] } = {};
		// create target list for each board
		for (const task of taskList) {
			boardTargets[task.configure] = task.targets;
		}
		// create a json list of targets
		const targetList = JSON.stringify(boardTargets);
		const { cspSource } = this._panel.webview;
		const nonce1 = getNonce();
		const nonce2 = getNonce();
		// run resources/featureLoader.py on workspaceRoot/Tools/scripts/build_options.py
		const buildOptionsPath = path.join(workspaceRoot, 'Tools', 'scripts', 'build_options.py');
		if (!fs.existsSync(buildOptionsPath)) {
			throw new Error('build_options.py not found');
		}
		// run python script resources/featureLoader.py
		const featureLoaderPath = path.join(this._extensionUri.path, 'resources', 'featureLoader.py');
		const featureLoader = cp.spawnSync('python3', [featureLoaderPath, buildOptionsPath]);
		apBuildConfigPanel.log.log('Running featureLoader.py');
		if (featureLoader.status !== 0) {
			apBuildConfigPanel.log.log(featureLoader.stderr.toString());
			throw new Error('featureLoader.py failed with exit code ' + featureLoader.status);
		}
		apBuildConfigPanel.log.log(featureLoader.stdout.toString());
		const features = JSON.parse(featureLoader.stdout.toString());
		// group all the features by their category
		const featureCategories: { [key: string]: string[] } = {};
		for (const feature of features) {
			if (!featureCategories[feature.category]) {
				featureCategories[feature.category] = [];
			}
			featureCategories[feature.category].push(feature);
		}

		const indeterminateList: string[] = [];
		const selectedList: string[] = [];
		// if all features in a category are selected, set the category checkbox to checked
		// if some features are selected, set the category checkbox to indeterminate

		Object.keys(featureCategories).map((category: string) => {
			let selected = 0;
			featureCategories[category].forEach((feature: any) => {
				if (this._currentFeaturesList.includes(feature.define)) {
					selected++;
				}
			});
			if (selected === featureCategories[category].length) {
				// all features selected
				selectedList.push(category);
			} else if (selected > 0) {
				// some features selected
				indeterminateList.push(category);
			}
		});

		apBuildConfigPanel.log.log(`Feature categories: ${JSON.stringify(featureCategories)}`);
		apBuildConfigPanel.log.log(`Current features: ${this._currentFeaturesList}`);
		// create a block of html for each category with vscode-checkbox for categories and vscode-multi-select for features under each category
		const featureHtml = Object.keys(featureCategories).map((category: string) => `
			<vscode-form-group>
				<vscode-label for="${category}">${category}:</vscode-label>
				<vscode-checkbox ${selectedList.includes(category)?'checked':''}
				${indeterminateList.includes(category)?'indeterminate':''}
				id="${category}_cb" onChange="(function() {
					const featureList = document.getElementById('${category}');
					const checkbox = document.getElementById('${category}_cb');
					if (checkbox.checked) {
						featureList.focus();
					}
					if (!checkbox.checked) {
						// clear the selected features
						featureList.value = [];
					}
				})()"></vscode-checkbox>
				<vscode-multi-select id="${category}" ${this._currentFeaturesList.length?'':'disabled'}>
					${featureCategories[category].map((feature: any) => 
						`<vscode-option ${this._currentFeaturesList.includes(feature.define)?'selected':''}
						value="${feature.define}">
						${feature.label}
						</vscode-option>`).join('')}
				</vscode-multi-select>
			</vscode-form-group>
		`).join('');
		
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Document</title>
	<meta
		http-equiv="Content-Security-Policy"
		content="
			default-src 'none'; 
			img-src ${cspSource};
			script-src 'unsafe-inline' ${cspSource};
			style-src 'unsafe-inline' ${cspSource};
			style-src-elem 'unsafe-inline' ${cspSource};
			font-src ${cspSource};
		"
	/>
	<script src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}" type="module"></script>
	<script>
		function updateBuildTargets() {
			const buildTargets = document.getElementById('BuildTarget');
			const board = document.getElementById('Board');
			const targetList = ${targetList};
			// empty the targetList before adding new targets
			buildTargets.innerHTML = '';
			for (const target of targetList[board.value]) {
				const option = document.createElement('vscode-option');
				option.value = target;
				option.innerText = target;
				buildTargets.appendChild(option);
			}
		}
		function featureListSelection() {
		}
		function submitForm() {
			const vscode = acquireVsCodeApi();
			const board = document.getElementById('Board').value;
			const buildTarget = document.getElementById('BuildTarget').value;
			const configureOptions = document.getElementById('ConfigureOptions').value;
			const features = {};
			const featureCategories = ${JSON.stringify(featureCategories)};
			for (const category in featureCategories) {
				const featureList = document.getElementById(category);
				if (!featureList.disabled) {
					features[category] = featureList.value;
				}
			}
			const message = {
				command: 'submit',
				board: board,
				target: buildTarget,
				configureOptions: configureOptions,
				features: features
			};
			console.log(message);
			vscode.postMessage(message);
		}
    </script>
</head>
<body>
	<h1>Build Configuration</h1>
	<p id="BoardList">Select the board you want to build for</p>
	<vscode-divider></vscode-divider>
	<vscode-form-container id="buildConfig">
		<vscode-form>
			<vscode-form-group>
				<vscode-label for="BoardList">Select Board:</vscode-label>
				<vscode-single-select id="Board" onChange="updateBuildTargets()" combobox>
					${boards.map((board: string) => `<vscode-option value="${board}">${board}</vscode-option>`).join('')}
				</vscode-single-select>
			</vscode-form-group>
			<vscode-form-group>
				<vscode-label for="BuildTarget">Select Build Target:</vscode-label>
				<vscode-single-select id="BuildTarget" combobox>
				</vscode-single-select>
			</vscode-form-group>
			<vscode-form-group>
				<vscode-label for="ConfigureOptions">Configure Options:</vscode-label>
				<vscode-textfield id="ConfigureOptions" type="text"></vscode-textfield>
			</vscode-form-group>
			<vscode-divider></vscode-divider>
			<vscode-label for="Features">Features:</vscode-label>
			${featureHtml}
			<vscode-button onClick="submitForm()">Build</vscode-button>
			</vscode-form>
	</vscode-form-container>
</body>
</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { apLog } from './apLog';

export class UIHooks {
	_panel: vscode.WebviewPanel;
	_disposables: vscode.Disposable[] = [];
	listeners: { [event: string]: ((...args: any[]) => void)[] } = {};
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

	dispose() {
		this._panel.dispose();
		this._disposables.forEach(d => d.dispose());
	}

	private _onMessage(message: any) {
		// call the listeners matching message.command
		if (this.listeners[message.command]) {
			this.listeners[message.command].forEach(listener => {
				listener(message);
			});
		}
		switch (message.command) {
			case 'getTasksList':
				this.getTasksList();
				break;
			case 'build':
				// unhandled here
				break;
			case 'getFeaturesList':
				this.getFeaturesList();
				break;
			default:
				// respond to unknown commands with undefined
				this._panel.webview.postMessage({ command: message.command, response: 'Bad Request' });
				break;
		}
	}

	private getTasksList() {
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
		const data = fs.readFileSync(taskslistfile, 'utf8');
		this._panel.webview.postMessage({ command: 'getTasksList', tasksList: data });
	}

	public getFeaturesList() {
		// run resources/featureLoader.py on workspaceRoot/Tools/scripts/build_options.py
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (workspaceRoot === undefined) {
			this._panel.webview.postMessage({ command: 'getFeaturesList', features: undefined });
			return;
		}
		const buildOptionsPath = path.join(workspaceRoot, 'Tools', 'scripts', 'build_options.py');
		if (!fs.existsSync(buildOptionsPath)) {
			throw new Error('build_options.py not found');
		}
		// run python script resources/featureLoader.py
		const featureLoaderPath = path.join(this._extensionUri.path, 'resources', 'featureLoader.py');
		const featureLoader = cp.spawnSync('python3', [featureLoaderPath, buildOptionsPath]);
		UIHooks.log('Running featureLoader.py');
		if (featureLoader.status !== 0) {
			UIHooks.log(featureLoader.stderr.toString());
			throw new Error('featureLoader.py failed with exit code ' + featureLoader.status);
		}
		const features = JSON.parse(featureLoader.stdout.toString());
		this._panel.webview.postMessage({ command: 'getFeaturesList', featuresList: features });
	}

	public on(event: string, listener: (...args: any[]) => void) {
		// add listener to the list
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(listener);
	}
}
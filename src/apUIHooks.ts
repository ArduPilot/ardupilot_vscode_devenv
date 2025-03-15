import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { apLog } from './apLog';
import { getFeaturesList } from './taskProvider';

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
		const data = fs.readFileSync(taskslistfile, 'utf8');
		this._panel.webview.postMessage({ command: 'getTasksList', tasksList: data });
	}

	public getFeaturesList(): void {
		this._panel.webview.postMessage({ command: 'getFeaturesList', featuresList: getFeaturesList(this._extensionUri) });
	}

	public on(event: string, listener: (data: Record<string, unknown>) => void): void {
		// add listener to the list
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(listener);
	}
}

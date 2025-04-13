import * as vscode from 'vscode';
import { ValidateEnvironment } from './apEnvironmentValidator';
import { CloneArdupilot } from './apCloneArdupilot';
import { apLog } from './apLog';
import { apWelcomeItem } from './apWelcomeItem';

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
			new CloneArdupilot('Clone Ardupilot', vscode.TreeItemCollapsibleState.None),
			new ValidateEnvironment('Validate Environment', vscode.TreeItemCollapsibleState.None)
		]);
	}
}

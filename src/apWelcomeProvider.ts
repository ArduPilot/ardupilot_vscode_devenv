import * as vscode from 'vscode';
import { ValidateEnvironment } from './apEnvironmentValidator';
import { CloneArdupilot } from './apCloneArdupilot';
import { ForceUpdateSubmodules } from './apForceUpdateSubmodules';
import { apLog } from './apLog';
import { apWelcomeItem } from './apWelcomeItem';

export class apWelcomeProvider implements vscode.TreeDataProvider<apWelcomeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<apWelcomeItem | undefined> = new vscode.EventEmitter<apWelcomeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apWelcomeItem | undefined> = this._onDidChangeTreeData.event;
	private log = new apLog('apWelcomeProvider');
	private apWelcomeItems: apWelcomeItem[];

	constructor() {
		this.log.log('apWelcomeProvider constructor');
		this.apWelcomeItems = [
			new CloneArdupilot('Clone Ardupilot', vscode.TreeItemCollapsibleState.None),
			new ValidateEnvironment('Validate Environment', vscode.TreeItemCollapsibleState.None),
			new ForceUpdateSubmodules('Force Update Submodules', vscode.TreeItemCollapsibleState.None)
		];
	}

	getTreeItem(element: apWelcomeItem): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(new apWelcomeItem('Welcome', vscode.TreeItemCollapsibleState.None));
	}

	getChildren(): Thenable<apWelcomeItem[]> {
		// Return both Clone Ardupilot and Validate Environment items
		return Promise.resolve(this.apWelcomeItems);
	}

	/**
	 * Get the ForceUpdateSubmodules instance for command execution
	 */
	getForceUpdateSubmodules(): ForceUpdateSubmodules | undefined {
		return this.apWelcomeItems.find(item => item instanceof ForceUpdateSubmodules) as ForceUpdateSubmodules;
	}
}

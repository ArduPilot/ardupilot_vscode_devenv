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
import * as fs from 'fs';
import * as path from 'path';
import { apLog } from './apLog';

/**
 * Interface for tool path configurations
 */
export interface ToolPaths {
    [key: string]: string;
}

/**
 * Interface for tool configuration file
 */
interface ToolsConfigFile {
    toolPaths: ToolPaths;
}

/**
 * Class to manage tool configurations
 */
export class ToolsConfig {
	private static log = new apLog('ToolsConfig');
	private static readonly CONFIG_FILE = '.vscode/apenv.json';
	private static toolPaths: ToolPaths = {};
	private static configWatcher: vscode.FileSystemWatcher | undefined;
	private static onConfigChangedCallbacks: (() => void)[] = [];

	/**
     * Initializes the tools configuration
     * @param context VS Code extension context
     */
	public static initialize(context: vscode.ExtensionContext): void {
		this.loadConfig();
		this.setupConfigWatcher(context);
	}

	/**
     * Sets up a file watcher to monitor changes to the configuration file
     * @param context VS Code extension context
     */
	private static setupConfigWatcher(context: vscode.ExtensionContext): void {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}

		const workspaceRoot = workspaceFolders[0].uri;
		const configPattern = new vscode.RelativePattern(workspaceRoot, this.CONFIG_FILE);

		this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

		// Register event handlers for file changes
		this.configWatcher.onDidChange(() => {
			this.log.log('Configuration file changed, reloading...');
			this.loadConfig();
			this.notifyConfigChanged();
		});

		this.configWatcher.onDidCreate(() => {
			this.log.log('Configuration file created, loading...');
			this.loadConfig();
			this.notifyConfigChanged();
		});

		context.subscriptions.push(this.configWatcher);
	}

	/**
     * Registers a callback to be notified when the configuration changes
     * @param callback Function to call when configuration changes
     */
	public static onConfigChanged(callback: () => void): void {
		this.onConfigChangedCallbacks.push(callback);
	}

	/**
     * Notifies all registered callbacks about configuration changes
     */
	private static notifyConfigChanged(): void {
		for (const callback of this.onConfigChangedCallbacks) {
			callback();
		}
	}

	/**
     * Loads the tool configuration from the workspace
     */
	public static loadConfig(): void {
		const configPath = this.getConfigFilePath();
		if (!configPath) {
			this.log.log('No workspace folder found, using default configurations');
			return;
		}

		try {
			if (fs.existsSync(configPath)) {
				const configContent = fs.readFileSync(configPath, 'utf8');
				const config = JSON.parse(configContent) as ToolsConfigFile;
				this.toolPaths = config.toolPaths || {};
				this.log.log('Configuration loaded successfully');
			} else {
				this.log.log('Configuration file not found, using default configurations');
				this.toolPaths = {};
			}
		} catch (error) {
			this.log.log(`Error loading configuration: ${error}`);
			this.toolPaths = {};
		}
	}

	/**
     * Saves the current tool configuration to the workspace
     */
	public static saveConfig(): void {
		const configPath = this.getConfigFilePath();
		if (!configPath) {
			this.log.log('No workspace folder found, cannot save configuration');
			return;
		}

		try {
			// Ensure the .vscode directory exists
			const vscodeDir = path.dirname(configPath);
			if (!fs.existsSync(vscodeDir)) {
				fs.mkdirSync(vscodeDir, { recursive: true });
			}

			const config: ToolsConfigFile = {
				toolPaths: this.toolPaths
			};

			fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
			this.log.log('Configuration saved successfully');
		} catch (error) {
			this.log.log(`Error saving configuration: ${error}`);
			vscode.window.showErrorMessage(`Failed to save tool configuration: ${error}`);
		}
	}

	/**
     * Gets the path to the configuration file
     * @returns The absolute path to the configuration file, or undefined if no workspace is open
     */
	private static getConfigFilePath(): string | undefined {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined;
		}

		return path.join(workspaceFolders[0].uri.fsPath, this.CONFIG_FILE);
	}

	/**
     * Gets the configured path for a tool
     * @param toolId The ID of the tool
     * @returns The configured path for the tool, or undefined if not configured
     */
	public static getToolPath(toolId: string): string | undefined {
		return this.toolPaths[toolId];
	}

	/**
     * Sets the path for a tool
     * @param toolId The ID of the tool
     * @param path The path to the tool
     */
	public static setToolPath(toolId: string, path: string): void {
		this.toolPaths[toolId] = path;
		this.saveConfig();
	}

	/**
     * Removes the configured path for a tool
     * @param toolId The ID of the tool
     */
	public static removeToolPath(toolId: string): void {
		delete this.toolPaths[toolId];
		this.saveConfig();
	}

	/**
     * Gets all configured tool paths
     * @returns A copy of the tool paths object
     */
	public static getAllToolPaths(): ToolPaths {
		return { ...this.toolPaths };
	}
}

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
import { apLog } from './apLog';
import * as fs from 'fs';
import * as path from 'path';
import { apBuildConfigPanel } from './apBuildConfigPanel';
import { APTaskProvider, ArdupilotTaskDefinition } from './taskProvider';
import { activeConfiguration } from './apActions';

export const binToTarget : { [target: string]: string} = {
	'bin/arducopter': 'copter',
	'bin/arducopter-heli': 'heli',
	'bin/antennatracker': 'antennatracker',
	'bin/arduplane': 'plane',
	'bin/ardurover': 'rover',
	'bin/ardusub': 'sub',
	'bin/blimp': 'blimp',
	'bin/AP_Periph': 'AP_Periph',
};

export const targetToBin : { [target: string]: string} = {};
Object.keys(binToTarget).forEach(key => {
	targetToBin[binToTarget[key]] = key;
});

export class apBuildConfig extends vscode.TreeItem {
	private static log = new apLog('apBuildConfig').log;

	constructor(
		private _buildProvider: apBuildConfigProvider,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly task?: vscode.Task,
	) {
		super(label, collapsibleState);
		if (this.task && this.task.definition) {
			const taskDef = this.task.definition as ArdupilotTaskDefinition;

			// Set the description based on override status
			if (taskDef.overrideEnabled) {
				this.description = 'overridden';
			} else {
				this.description = taskDef.target;
			}

			// Check if this is the active configuration using configName
			if (activeConfiguration && taskDef.configName === activeConfiguration.definition.configName) {
				// Highlight active configuration with blue check circle
				this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('terminal.ansiBlue'));
				if (taskDef.overrideEnabled) {
					this.description = 'overridden (Active)';
				} else {
					this.description = `${taskDef.target} (Active)`;
				}
				this.contextValue = 'apBuildConfigActive';
			} else {
				this.contextValue = 'apBuildConfig';

				// Add command to activate configuration when clicked
				this.command = {
					title: 'Set as Active Configuration',
					command: 'apBuildConfig.activateOnSelect',
					arguments: [this]
				};
			}
		}
	}

	edit(): void {
		apBuildConfig.log(`edit ${this.label}`);
		if (this.task) {
			apBuildConfigPanel.createOrShow(this._buildProvider.context.extensionUri, this.task);
		}
	}

	// Set this configuration as the active configuration
	activate(): void {
		apBuildConfig.log(`Activating ${this.label} as current configuration`);
		if (!this.task || !this.task.definition) {
			return;
		}

		const taskDef = this.task.definition as ArdupilotTaskDefinition;

		// Check if workspace is available before trying to save settings
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			apBuildConfig.log('No workspace available to save active configuration');
			return;
		}

		// Save the selection to workspace settings using configName
		vscode.workspace.getConfiguration('ardupilot').update(
			'activeConfiguration',
			taskDef.configName,
			vscode.ConfigurationTarget.Workspace
		).then(() => {
			// Set as active configuration (this will trigger a refresh through the watcher)
			vscode.commands.executeCommand('apActions.setActiveConfiguration', this.task);
			vscode.window.showInformationMessage(`Activated ${taskDef.configName} configuration`);
		}, (error) => {
			apBuildConfig.log(`Error saving active configuration: ${error}`);
		});

		// Soft refresh the tree view to update UI without recreating tasks
		this._buildProvider.refreshSoft();
	}

	delete(): void {
		// delete the folder
		apBuildConfig.log(`delete ${this.label}`);
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		try {
			fs.rmSync(workspaceRoot + '/build/' + this.label, { recursive: true });
			// also remove c4che/{board}_cache.py
			fs.unlinkSync(workspaceRoot + '/build/c4che/' + this.label + '_cache.py');
		} catch (err) {
			apBuildConfig.log(`Error deleting build folder: ${err}`);
		}
		vscode.commands.executeCommand('apBuildConfig.refreshEntry');
		// also delete the task from tasks.json using configName
		if (this.task && this.task.definition) {
			const taskDef = this.task.definition as ArdupilotTaskDefinition;
			APTaskProvider.delete(taskDef.configName);
		}
	}
}

export class apBuildConfigProvider implements vscode.TreeDataProvider<apBuildConfig> {
	private _onDidChangeTreeData: vscode.EventEmitter<apBuildConfig | undefined> = new vscode.EventEmitter<apBuildConfig | undefined>();
	readonly onDidChangeTreeData: vscode.Event<apBuildConfig | undefined> = this._onDidChangeTreeData.event;
	static log = new apLog('buildConfig').log;
	static noCreate = false;
	private softRefreshFlag = false;
	private taskCache: Map<string, vscode.Task> = new Map();

	constructor(private workspaceRoot: string | undefined, public context: vscode.ExtensionContext) {
		apBuildConfigProvider.log('apBuildConfigProvider constructor');

		// Watch for changes to the active configuration
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ardupilot.activeConfiguration')) {
				this.refresh();
			}
		});

		// Refresh when apActions updates the active configuration
		context.subscriptions.push(
			vscode.commands.registerCommand('apActions.configChanged', () => {
				this.refreshSoft();
			})
		);

		// Watch for changes to tasks.json to auto-refresh build configurations
		if (this.workspaceRoot) {
			const tasksJsonPattern = new vscode.RelativePattern(this.workspaceRoot, '.vscode/tasks.json');
			const tasksJsonWatcher = vscode.workspace.createFileSystemWatcher(tasksJsonPattern);

			tasksJsonWatcher.onDidChange(() => {
				apBuildConfigProvider.log('tasks.json changed - refreshing build configurations');
				this.refresh();
			});

			tasksJsonWatcher.onDidCreate(() => {
				apBuildConfigProvider.log('tasks.json created - refreshing build configurations');
				this.refresh();
			});

			tasksJsonWatcher.onDidDelete(() => {
				apBuildConfigProvider.log('tasks.json deleted - refreshing build configurations');
				this.refresh();
			});

			context.subscriptions.push(tasksJsonWatcher);
		}
	}

	getTreeItem(element: apBuildConfig): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		apBuildConfigProvider.log('refresh');
		this._onDidChangeTreeData.fire(undefined);
	}

	// Soft refresh that reuses cached tasks without recreating them
	refreshSoft(): void {
		apBuildConfigProvider.log('refreshSoft');
		this.softRefreshFlag = true;
		this._onDidChangeTreeData.fire(undefined);
	}

	// add option
	add(): void {
		apBuildConfigProvider.log('addOption');
		apBuildConfigPanel.createOrShow(this.context.extensionUri);
	}

	async getChildren(): Promise<apBuildConfig[]> {
		apBuildConfigProvider.log('getChildren');
		if (!this.workspaceRoot) {
			return [];
		}

		// Capture and reset soft refresh flag for this run
		const useCacheOnly = this.softRefreshFlag;
		this.softRefreshFlag = false;

		// Get all configurations from tasks.json instead of scanning build folders
		let tasks: Array<ArdupilotTaskDefinition> = [];
		try {
			const taskConfiguration = vscode.workspace.workspaceFolders
				? vscode.workspace.getConfiguration('tasks', vscode.workspace.workspaceFolders[0].uri)
				: vscode.workspace.getConfiguration('tasks');
			tasks = taskConfiguration.get('tasks') as Array<ArdupilotTaskDefinition> || [];
		} catch {
			// Fallback for tests or environments where configuration isn't accessible
			tasks = [];
		}

		const buildConfigList: apBuildConfig[] = [];

		// Filter and process only ardupilot tasks (excluding upload tasks)
		const ardupilotTasks = tasks.filter(task =>
			task.type === 'ardupilot' && !task.configName.endsWith('-upload')
		);

		for (const taskDef of ardupilotTasks) {
			try {
				let task: vscode.Task | undefined;
				if (useCacheOnly) {
					// Reuse existing task if available
					task = this.taskCache.get(taskDef.configName);
					if (!task) {
						apBuildConfigProvider.log(`Soft refresh: no cached task for ${taskDef.configName}, skipping create.`);
					}
				} else {
					// Create a VS Code task from the task definition and cache it
					task = await APTaskProvider.createTask(taskDef);
					if (task) {
						this.taskCache.set(taskDef.configName, task);
					}
				}
				if (task) {
					// Use configName for display
					const displayName = taskDef.configName;
					buildConfigList.push(new apBuildConfig(this, displayName, vscode.TreeItemCollapsibleState.None, task));
					apBuildConfigProvider.log(`Added config: ${displayName}`);
				}
			} catch (err) {
				apBuildConfigProvider.log(`Error processing task ${taskDef.configName}: ${err}`);
			}
		}

		// Prune cache entries that no longer exist in tasks.json
		const currentConfigNames = new Set(ardupilotTasks.map(t => t.configName));
		for (const cachedName of Array.from(this.taskCache.keys())) {
			if (!currentConfigNames.has(cachedName)) {
				this.taskCache.delete(cachedName);
			}
		}

		apBuildConfigProvider.log(`Found ${buildConfigList.length} configurations in tasks.json`);
		return buildConfigList;
	}
}

export interface HwdefInfo {
	mcuTarget?: string;
	flashSizeKB?: number;
}

/**
 * Helper function to parse a hwdef file and extract MCU/flash info
 * @param filePath - Absolute path to the hwdef file to parse
 * @param result - HwdefInfo object to populate with found data
 * @param processedFiles - Set of already processed file paths to prevent infinite loops
 * @param workspaceRoot - Root of the workspace
 * @param logger - Logger instance
 * @returns Promise resolving to collected include paths for later processing
 */
async function parseHwdefFile(filePath: string, result: HwdefInfo, processedFiles: Set<string>, workspaceRoot: string, logger: apLog): Promise<string[]> {
	// Skip if already processed (circular include protection)
	if (processedFiles.has(filePath)) {
		logger.log(`INCLUDE_DEBUG: Skipping already processed file: ${filePath}`);
		return [];
	}

	processedFiles.add(filePath);
	logger.log(`INCLUDE_DEBUG: Processing hwdef file: ${filePath}`);

	if (!fs.existsSync(filePath)) {
		logger.log(`INCLUDE_DEBUG: File does not exist: ${filePath}`);
		return [];
	}

	try {
		const hwdefContent = fs.readFileSync(filePath, 'utf8');
		const lines = hwdefContent.split('\n');
		const includeStatements: string[] = [];

		for (const line of lines) {
			const trimmedLine = line.trim();

			// Skip empty lines and comments
			if (!trimmedLine || trimmedLine.startsWith('#')) {
				continue;
			}

			// Parse MCU line: "MCU STM32H7xx STM32H743xx" (only if not already found)
			if (!result.mcuTarget && trimmedLine.startsWith('MCU ')) {
				const parts = trimmedLine.split(/\s+/);
				logger.log(`INCLUDE_DEBUG: MCU line found: "${trimmedLine}", parts: [${parts.join(', ')}], length: ${parts.length}`);
				if (parts.length >= 3) {
					result.mcuTarget = parts[2]; // Third part is the specific MCU target
					logger.log(`INCLUDE_DEBUG: Found MCU target: ${result.mcuTarget}`);
				}
			}

			// Parse flash size line: "FLASH_SIZE_KB 2048" (only if not already found)
			if (!result.flashSizeKB && trimmedLine.startsWith('FLASH_SIZE_KB ')) {
				const parts = trimmedLine.split(/\s+/);
				if (parts.length >= 2) {
					const flashSize = parseInt(parts[1], 10);
					if (!isNaN(flashSize)) {
						result.flashSizeKB = flashSize;
						logger.log(`INCLUDE_DEBUG: Found flash size: ${result.flashSizeKB}KB`);
					}
				}
			}

			// Parse include statements: "include ../CubeOrange/hwdef.inc"
			if (trimmedLine.startsWith('include ')) {
				const parts = trimmedLine.split(/\s+/);
				if (parts.length >= 2) {
					const includePath = parts.slice(1).join(' ').trim(); // Handle paths with spaces
					logger.log(`INCLUDE_DEBUG: Found include statement: "${includePath}"`);
					includeStatements.push(includePath);
				}
			}
		}

		return includeStatements;

	} catch (error) {
		logger.log(`INCLUDE_DEBUG: Error reading file ${filePath}: ${error}`);
		return [];
	}
}

/**
 * Reads hwdef.dat file to extract MCU target and flash size information
 * Follows include statements to find missing information
 * @param boardName - The board name (e.g., "CubeOrange")
 * @returns Promise resolving to HwdefInfo with mcuTarget and flashSizeKB
 */
export async function readHwdefFile(boardName: string): Promise<HwdefInfo> {
	if (!boardName) {
		console.error('readHwdefFile: boardName is undefined or empty');
		return {};
	}

	const logger = new apLog('readHwdefFile');
	const result: HwdefInfo = {};
	const processedFiles = new Set<string>();

	try {
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
		if (!workspaceRoot) {
			logger.log('No workspace root available');
			return result;
		}

		// Construct path to main hwdef.dat file
		const hwdefPath = path.join(workspaceRoot, 'libraries', 'AP_HAL_ChibiOS', 'hwdef', boardName, 'hwdef.dat');
		logger.log(`INCLUDE_DEBUG: Starting hwdef parsing for board: ${boardName}`);
		logger.log(`INCLUDE_DEBUG: Main hwdef path: ${hwdefPath}`);

		if (!fs.existsSync(hwdefPath)) {
			logger.log(`hwdef.dat not found for board: ${boardName}`);
			return result;
		}

		// Parse the main hwdef.dat file
		const includeStatements = await parseHwdefFile(hwdefPath, result, processedFiles, workspaceRoot, logger);

		logger.log(`INCLUDE_DEBUG: After main file - mcuTarget: ${result.mcuTarget}, flashSizeKB: ${result.flashSizeKB}`);
		logger.log(`INCLUDE_DEBUG: Found ${includeStatements.length} include statements: [${includeStatements.join(', ')}]`);

		// If we still need information and have include statements, process them
		if ((!result.mcuTarget || !result.flashSizeKB) && includeStatements.length > 0) {
			logger.log('INCLUDE_DEBUG: Missing info, processing includes...');

			for (const includePath of includeStatements) {
				// If we have all the info we need, stop processing
				if (result.mcuTarget && result.flashSizeKB) {
					break;
				}

				// Resolve relative path to absolute path
				const hwdefDir = path.dirname(hwdefPath);
				const absoluteIncludePath = path.resolve(hwdefDir, includePath);
				logger.log(`INCLUDE_DEBUG: Resolving include "${includePath}" to: ${absoluteIncludePath}`);

				// Recursively parse the included file
				const nestedIncludes = await parseHwdefFile(absoluteIncludePath, result, processedFiles, workspaceRoot, logger);
				logger.log(`INCLUDE_DEBUG: After processing include ${includePath} - mcuTarget: ${result.mcuTarget}, flashSizeKB: ${result.flashSizeKB}`);

				// Recursively process nested includes if we still need information
				if ((!result.mcuTarget || !result.flashSizeKB) && nestedIncludes.length > 0) {
					logger.log(`INCLUDE_DEBUG: Processing ${nestedIncludes.length} nested includes: [${nestedIncludes.join(', ')}]`);

					for (const nestedIncludePath of nestedIncludes) {
						// If we have all the info we need, stop processing
						if (result.mcuTarget && result.flashSizeKB) {
							break;
						}

						// Resolve nested include path relative to the current include file
						const includeFileDir = path.dirname(absoluteIncludePath);
						const absoluteNestedIncludePath = path.resolve(includeFileDir, nestedIncludePath);
						logger.log(`INCLUDE_DEBUG: Resolving nested include "${nestedIncludePath}" to: ${absoluteNestedIncludePath}`);

						// Recursively parse the nested included file
						await parseHwdefFile(absoluteNestedIncludePath, result, processedFiles, workspaceRoot, logger);
						logger.log(`INCLUDE_DEBUG: After processing nested include ${nestedIncludePath} - mcuTarget: ${result.mcuTarget}, flashSizeKB: ${result.flashSizeKB}`);
					}
				}
			}
		}

		logger.log(`INCLUDE_DEBUG: Final result for ${boardName}: mcuTarget=${result.mcuTarget}, flashSizeKB=${result.flashSizeKB}`);
		return result;

	} catch (error) {
		logger.log(`Error reading hwdef.dat for ${boardName}: ${error}`);
		return result;
	}
}

export interface DebugConfig {
	openocdTarget?: string;
	jlinkDevice?: string;
	svdFile?: string;
	flashSizeKB?: number;
}

/**
 * Gets debug configuration from stm32DebugConfig based on MCU target and flash size
 * @param mcuTarget - MCU target from hwdef.dat (e.g., "STM32H743xx")
 * @param flashSizeKB - Flash size in KB from hwdef.dat
 * @returns DebugConfig with OpenOCD target, JLink device, and SVD file
 */
export function getDebugConfigFromMCU(mcuTarget: string, flashSizeKB: number | undefined, extensionUri: vscode.Uri): DebugConfig {
	const log = new apLog('getDebugConfigFromMCU').log;

	try {
		// Load stm32DebugConfig from JSON file using extension path
		const configPath = path.join(extensionUri.path, 'resources', 'stm32DebugConfig.json');
		log(`DEBUG_CONFIG: Loading debug config from: ${configPath}`);
		const configData = fs.readFileSync(configPath, 'utf8');
		const stm32DebugConfig: Record<string, {
			openocd?: { target?: string };
			jlink?: { device?: string; devices?: { device: string; flash: string }[] };
			svd?: string;
		}> = JSON.parse(configData);

		log(`DEBUG_CONFIG: Looking for MCU target: "${mcuTarget}"`);
		log(`DEBUG_CONFIG: Available targets: [${Object.keys(stm32DebugConfig).slice(0, 5).join(', ')}...]`);

		if (!stm32DebugConfig[mcuTarget]) {
			log(`No debug configuration found for MCU target: ${mcuTarget}`);
			return {};
		}

		log(`DEBUG_CONFIG: Found config for ${mcuTarget}`);
		const config = stm32DebugConfig[mcuTarget];
		log(`DEBUG_CONFIG: Config data: ${JSON.stringify(config, null, 2)}`);
		const result: DebugConfig = {
			openocdTarget: config.openocd?.target,
			svdFile: config.svd
		};

		// Handle JLink device selection based on flash size
		if (config.jlink) {
			log(`DEBUG_JLINK: Processing JLink config: ${JSON.stringify(config.jlink)}`);
			if (config.jlink.device) {
				// Single device variant
				result.jlinkDevice = config.jlink.device;
				log(`Single JLink device for ${mcuTarget}: ${result.jlinkDevice}`);
			} else if (config.jlink.devices && Array.isArray(config.jlink.devices)) {
				// Multi-device variant - match by flash size if available
				if (flashSizeKB !== undefined) {
					const flashSizeStr = `${flashSizeKB}KB`;
					result.flashSizeKB = flashSizeKB;
					log(`DEBUG_JLINK: Looking for flash size: ${flashSizeStr} in devices: ${JSON.stringify(config.jlink.devices)}`);
					const matchedDevice = config.jlink.devices.find((device: { device: string; flash: string }) => device.flash === flashSizeStr);

					if (matchedDevice) {
						result.jlinkDevice = matchedDevice.device;
						log(`Matched JLink device for ${mcuTarget} with ${flashSizeStr}: ${result.jlinkDevice}`);
					} else {
						// Fallback to first available device
						result.jlinkDevice = config.jlink.devices[0]?.device;
						log(`No flash size match for ${mcuTarget} ${flashSizeStr}, using fallback: ${result.jlinkDevice}`);
					}
				} else {
					// No flash size available, use first device
					result.jlinkDevice = config.jlink.devices[0]?.device;
					log(`No flash size available for ${mcuTarget}, using first device: ${result.jlinkDevice}`);
				}
			}
		} else {
			log(`DEBUG_JLINK: No JLink config found for ${mcuTarget}`);
		}

		log(`Debug config for ${mcuTarget}: OpenOCD=${result.openocdTarget}, JLink=${result.jlinkDevice}, SVD=${result.svdFile}`);
		return result;

	} catch (error) {
		log(`Error getting debug config for ${mcuTarget}: ${error}`);
		return {};
	}
}

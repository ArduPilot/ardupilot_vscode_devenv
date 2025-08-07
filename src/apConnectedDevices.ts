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
import * as cp from 'child_process';
import * as os from 'os';
import { apLog } from './apLog';
import { ProgramUtils } from './apProgramUtils';

// Device information interface
export interface DeviceInfo {
    path: string;
    vendorId: string;
    productId: string;
    manufacturer?: string;
    product?: string;
    serialNumber?: string;
    isArduPilot?: boolean;
    isMavproxyConnected?: boolean;
}

// USB device tree node interface for ioreg parsing
interface UsbDeviceNode {
    name: string;
    vendorId?: string;
    productId?: string;
    manufacturer?: string;
    product?: string;
    serialNumber?: string;
    locationId?: string;
    children: UsbDeviceNode[];
    parent?: UsbDeviceNode;
    properties: Map<string, unknown>;
}

// FileDecorationProvider implementation for decorating connected devices
export class ConnectedDeviceDecorationProvider implements vscode.FileDecorationProvider {
	private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> = this._onDidChangeFileDecorations.event;
	private log = new apLog('ConnectedDeviceDecorationProvider');

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		// Extract the device path from the URI
		// For tree items, the URI is typically a virtual representation
		// We'll extract the device information from the URI path
		if(uri.scheme !== 'connected-device') {
			return undefined; // Not a connected device
		}
		// Check if path contains information about connected state
		if (uri.query === 'connected') {
			return {
				badge: '●', // Dot character to indicate connected status
				color: new vscode.ThemeColor('focusBorder'),
				tooltip: 'Connected to MAVProxy'
			};
		}

		return undefined;
	}

	// Method to trigger decoration updates
	refresh(uri?: vscode.Uri): void {
		if (uri) {
			this._onDidChangeFileDecorations.fire(uri);
		} else {
			// Fire without URI to refresh all decorations
			this._onDidChangeFileDecorations.fire([]);
		}
	}
}

// Tree item to represent a connected device
export class ConnectedDeviceItem extends vscode.TreeItem {
	constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly device: DeviceInfo,
        public readonly isCommand: boolean = false,
        public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		// Set the device path as the ID
		this.id = isCommand ? `${device.path}_${label}` : device.path;

		// Create description with VID:PID for main items only
		if (!isCommand) {
			this.description = `${device.vendorId}:${device.productId}`;

			// Add tooltip with all device info
			this.tooltip = this.createTooltip();

			// Set icon based on device type (using built-in codicon)
			this.iconPath = new vscode.ThemeIcon(this.getIconForDevice());
		} else {
			// Use stop icon for disconnection commands, play icon for connection commands
			if (label.includes('Disconnect')) {
				this.iconPath = new vscode.ThemeIcon('stop', new vscode.ThemeColor('charts.red'));
				// Highlight if connected
				this.description = `${this.description} (Connected)`;
				this.resourceUri = vscode.Uri.parse(`connected-device:${device.path}/?connected`);
			} else {
				this.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
				this.resourceUri = vscode.Uri.parse(`connected-device:${device.path}/?disconnected`);
			}

			// If a command is provided, set it
			if (command) {
				this.command = command;
			}
		}
	}

	private createTooltip(): string {
		const lines = [
			`Device: ${this.label}`,
			`Path: ${this.device.path}`,
			`VID:PID: ${this.device.vendorId}:${this.device.productId}`
		];

		if (this.device.manufacturer) {
			lines.push(`Manufacturer: ${this.device.manufacturer}`);
		}

		if (this.device.product) {
			lines.push(`Product: ${this.device.product}`);
		}

		if (this.device.serialNumber) {
			lines.push(`Serial: ${this.device.serialNumber}`);
		}

		return lines.join('\n');
	}

	private getIconForDevice(): string {
		// Use different icons based on device type
		if (this.device.isArduPilot) {
			return 'circuit-board'; // ArduPilot boards
		} else if (this.device.path.includes('tty') || this.device.path.includes('COM')) {
			return 'plug'; // Serial devices
		} else {
			return 'device-desktop'; // Default USB device
		}
	}
}

// Provider for the tree view
export class apConnectedDevices implements vscode.TreeDataProvider<ConnectedDeviceItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ConnectedDeviceItem | undefined> = new vscode.EventEmitter<ConnectedDeviceItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<ConnectedDeviceItem | undefined> = this._onDidChangeTreeData.event;

	// Static list to maintain devices across instances
	private static connectedDevicesList: Map<string, DeviceInfo> = new Map();

	private log = new apLog('apConnectedDevices');
	private refreshTimer: NodeJS.Timeout | undefined;
	private isWSL = false;
	private activeConnections: Map<string, { process: cp.ChildProcess | null, terminal: vscode.Terminal | null }> = new Map();
	private loggedDevices: Set<string> = new Set(); // Track which devices have been logged

	public setIsWSL(isWSL: boolean): void {
		this.isWSL = isWSL;
	}

	constructor() {
		this.log.log('apConnectedDevices constructor');
		this.isWSL = this.checkIsWSL();

		// Auto-refresh every 5 seconds
		this.startAutoRefresh();
	}

	dispose(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
		}
	}

	private startAutoRefresh(): void {
		this.refreshTimer = setInterval(() => {
			const previousDevicePaths = new Set(apConnectedDevices.connectedDevicesList.keys());
			// get children and see if there's been a new device added or removed
			// compare with the static list if so trigger change event,
			// Triggering change event no matter what might seem more efficient,
			// but that leads to "Actual command not found, wanted to execute <command>" errors,
			// and probably slower performance, as UI will be refreshed more often
			this.getConnectedDevices().then(devices => {
			// Check if devices have changed
				const currentDevicePaths = new Set(devices.map(device => device.path));
				if (currentDevicePaths.size !== previousDevicePaths.size || ![...currentDevicePaths].every(path => previousDevicePaths.has(path))) {
					this.refresh();
				}
			}
			).catch(error => {
				this.log.log(`Error refreshing devices: ${error}`);
			});
		}, 1000);
	}

	private checkIsWSL(): boolean {
		return ProgramUtils.isWSL();
	}

	refresh(): void {
		this.log.log('Refreshing connected devices');
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: ConnectedDeviceItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ConnectedDeviceItem): Promise<ConnectedDeviceItem[]> {
		// If element is provided, we're getting children of a device
		if (element && !element.isCommand) {
			// Return command options for the device
			return this.getDeviceCommands(element.device);
		}

		// Otherwise, we're getting the root devices
		try {
			const devices = await this.getConnectedDevices();
			return devices.map(device => {
				// Create a display name that's more user-friendly
				const displayName = this.createDisplayName(device);
				return new ConnectedDeviceItem(displayName, vscode.TreeItemCollapsibleState.Collapsed, device);
			});
		} catch (error) {
			this.log.log(`Error getting devices: ${error}`);
			return [new ConnectedDeviceItem('Error detecting devices', vscode.TreeItemCollapsibleState.None, {
				path: 'error',
				vendorId: '',
				productId: '',
				manufacturer: String(error)
			})];
		}
	}

	private getDeviceCommands(device: DeviceInfo): ConnectedDeviceItem[] {
		const commands: ConnectedDeviceItem[] = [];

		// Add MAVProxy connect/disconnect command based on connection status
		if (device.isMavproxyConnected) {
			// Show disconnect option if already connected
			commands.push(new ConnectedDeviceItem(
				'Disconnect MAVProxy',
				vscode.TreeItemCollapsibleState.None,
				device,
				true,
				{
					command: 'connected-devices.disconnectMAVProxy',
					title: 'Disconnect MAVProxy',
					arguments: [device]
				}
			));
		} else {
			// Show connect option if not connected
			commands.push(new ConnectedDeviceItem(
				'Connect with MAVProxy',
				vscode.TreeItemCollapsibleState.None,
				device,
				true,
				{
					command: 'connected-devices.connectMAVProxy',
					title: 'Connect with MAVProxy',
					arguments: [device]
				}
			));
		}

		// Placeholder for future commands
		// commands.push(new ConnectedDeviceItem("Another Command", ...));

		return commands;
	}

	private createDisplayName(device: DeviceInfo): string {
		// Use the product name with path in brackets, similar to WSL format
		if (device.product) {
			return `${device.product} (${device.path})`;
		} else if (device.manufacturer) {
			return `${device.manufacturer} (${device.path})`;
		} else {
			// Just use the base device name from the path
			const pathParts = device.path.split('/');
			return pathParts[pathParts.length - 1];
		}
	}

	private async getConnectedDevices(): Promise<DeviceInfo[]> {
		// Get new devices based on platform
		let newDevices: DeviceInfo[] = [];

		if (this.isWSL) {
			newDevices = await this.getWSLDevices();
		} else if (os.platform() === 'darwin') {
			newDevices = await this.getDarwinDevices();
		} else {
			newDevices = await this.getLinuxDevices();
		}

		// Create a set of current device paths
		const currentDevicePaths = new Set(newDevices.map(device => device.path));

		// Handle devices that have been removed
		const devicesToRemove: string[] = [];
		apConnectedDevices.connectedDevicesList.forEach((device, path) => {
			if (!currentDevicePaths.has(path)) {
				// Device is no longer connected
				devicesToRemove.push(path);

				// If it was connected to MAVProxy, clean up
				if (device.isMavproxyConnected) {
					this.disconnectDevice(device);
				}
			}
		});

		// Remove disconnected devices from our static list
		devicesToRemove.forEach(path => {
			apConnectedDevices.connectedDevicesList.delete(path);
		});

		// Update our static device list with new/updated devices
		for (const device of newDevices) {
			const existingDevice = apConnectedDevices.connectedDevicesList.get(device.path);
			if (existingDevice) {
				// Preserve connection state from existing device
				device.isMavproxyConnected = existingDevice.isMavproxyConnected;
				// Update other properties as needed
			}
			// Update the static list
			apConnectedDevices.connectedDevicesList.set(device.path, device);
		}

		// Return the updated list
		return Array.from(apConnectedDevices.connectedDevicesList.values());
	}

	private async getLinuxDevices(): Promise<DeviceInfo[]> {
		// Check if lsusb is available first
		const lsusbInfo = await ProgramUtils.findLsusb();
		let lsusbCmd = 'lsusb'; // Default fallback for testing

		if (!lsusbInfo.available) {
			// Log the info but don't fail completely - this allows WSL to continue gracefully
			this.log.log(`lsusb not available: ${lsusbInfo.info || 'Please install usbutils package'}`);
			// Still try with default 'lsusb' command in case tests mock it
		} else {
			lsusbCmd = lsusbInfo.path || 'lsusb';
		}

		return new Promise((resolve, reject) => {
			// Use lsusb for USB devices
			cp.exec(lsusbCmd, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`Error executing lsusb: ${error.message} ${stderr}`));
					return;
				}

				// Parse lsusb output
				const devices: DeviceInfo[] = [];
				const lines = stdout.split('\n');
				const findPromises: Promise<void>[] = [];
				for (let i = 0; i < lines.length; i++) {
					if (!lines[i].trim()) continue;

					// Example: Bus 001 Device 002: ID 8087:0024 Intel Corp. Integrated Rate Matching Hub
					const match = lines[i].match(/ID\s+([0-9a-fA-F]+):([0-9a-fA-F]+)\s+(.*)/);
					if (match) {
						const [, vendorId, productId, description] = match;

						// Also get serial devices
						findPromises.push(this.findSerialDeviceForUsbDevice(vendorId, productId).then(serialPaths => {
							if (!serialPaths.length) {
								return;
							}
							// there can be multiple serial paths for a single USB device with different instance numbers
							for (const serialPath of serialPaths) {
								if (serialPath) {
									devices.push({
										path: serialPath || 'Unknown',
										vendorId,
										productId,
										manufacturer: description || 'Unknown',
										// Check if this is likely an ArduPilot board
										isArduPilot: this.isArduPilotDevice(vendorId, productId, description)
									});
								}
							}
						}));
					}
				}
				Promise.all(findPromises).then(() => {
					resolve(devices);
				}).catch(err => {
					reject(new Error(`Error finding serial devices: ${err.message}`));
				}
				);
			});
		});
	}

	private async getWindowsDevices(): Promise<DeviceInfo[]> {
		// On Windows, use PowerShell to get device information
		return new Promise((resolve) => {
			// Execute PowerShell from WSL using powershell.exe
			const psCommand = 'Get-PnpDevice -Class Ports | Where-Object { $_.Status -eq "OK" } | Format-List';
			const devices: DeviceInfo[] = [];

			cp.exec(`powershell.exe -Command '${psCommand}'`, (error, stdout) => {
				if (error) {
					this.log.log(`Error executing PowerShell from WSL: ${error.message}`);
					// Return an empty array rather than rejecting
					resolve(devices);
					return;
				}

				const sections = stdout.split('\r\n\r\n');

				for (const section of sections) {
					if (!section.trim()) continue;

					// Parse the device info from PowerShell output
					const deviceIdMatch = section.match(/DeviceID\s*:\s*(.*)/);
					const friendlyNameMatch = section.match(/FriendlyName\s*:\s*(.*)/);
					const manufacturerNameMatch = section.match(/Manufacturer\s*:\s*(.*)/);
					if (deviceIdMatch && friendlyNameMatch) {
						const deviceId = deviceIdMatch[1];
						const friendlyName = friendlyNameMatch[1];
						const manufacturerName = manufacturerNameMatch ? manufacturerNameMatch[1] : 'Unknown';

						// Try to extract VID/PID from the DeviceID
						const vidPidMatch = deviceId.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);

						if (vidPidMatch) {
							const [, vendorId, productId] = vidPidMatch;

							const comMatch = friendlyName.match(/\(COM(\d+)\)/);
							devices.push({
								path: comMatch && comMatch[1] ? `COM${comMatch[1]}` : friendlyName,
								vendorId,
								productId,
								product: `${friendlyName} (Windows)`,
								manufacturer: manufacturerName,
								isArduPilot: this.isArduPilotDevice(vendorId, productId, friendlyName)
							});
						}
					}
				}
				resolve(devices);
			});
		});
	}

	private async getWSLDevices(): Promise<DeviceInfo[]> {
		// For WSL, we need to:
		// 1. Check if WSL has access to serial devices
		// 2. Use a combined approach of checking both Windows and Linux devices
		const devices: DeviceInfo[] = [];

		// Try to get Linux devices first, but don't fail if this doesn't work
		try {
			const linuxDevices = await this.getLinuxDevices();
			devices.push(...linuxDevices);
		} catch (error) {
			this.log.log(`Error getting Linux devices in WSL: ${error}`);
		}

		// Try to get Windows devices, but don't fail if this doesn't work
		try {
			const windowsDevices = await this.getWindowsDevices();
			devices.push(...windowsDevices);
		} catch (error) {
			this.log.log(`Error getting Windows devices in WSL: ${error}`);
		}

		return devices;
	}

	private async getDarwinDevices(): Promise<DeviceInfo[]> {
		return new Promise((resolve) => {
			// Use ioreg to get USB device tree information
			cp.exec('ioreg -r -c IOUSBHostDevice -w0 -l', { maxBuffer: 1024 * 1024 * 5 }, async (ioregError, ioregStdout) => {
				if (ioregError) {
					this.log.log(`Error executing ioreg: ${ioregError.message}`);
					resolve([]);
					return;
				}

				try {
					// Parse the ioreg output to build USB device tree
					const usbTree = this.parseIoregUsbTree(ioregStdout);

					// Get serial ports
					const serialPorts = await this.getDarwinSerialPorts();

					// Find devices for each serial port
					const devices: DeviceInfo[] = [];
					for (const port of serialPorts) {
						const deviceInfo = await this.findDeviceInfoForSerialPort(port, usbTree);
						if (deviceInfo) {
							devices.push(deviceInfo);
						}
					}

					resolve(devices);
				} catch (parseError) {
					this.log.log(`Error parsing ioreg output: ${parseError}`);
					resolve([]);
				}
			});
		});
	}

	private parseIoregUsbTree(ioregOutput: string): UsbDeviceNode[] {
		const lines = ioregOutput.split('\n');
		const rootNodes: UsbDeviceNode[] = [];
		const nodeStack: UsbDeviceNode[] = [];

		for (const line of lines) {
			if (!line.trim()) continue;

			// Calculate depth by counting leading spaces and pipes
			const depth = this.calculateIoregDepth(line);

			// Handle device entry lines (contain "+-o" or "| +-o")
			if (line.includes('+-o ')) {
				const deviceName = this.extractDeviceName(line);

				const node: UsbDeviceNode = {
					name: deviceName,
					children: [],
					properties: new Map<string, unknown>()
				};

				// Set parent relationships
				while (nodeStack.length > depth) {
					nodeStack.pop();
				}

				if (nodeStack.length > 0) {
					const parent = nodeStack[nodeStack.length - 1];
					node.parent = parent;
					parent.children.push(node);
				} else {
					rootNodes.push(node);
				}

				nodeStack.push(node);
			}
			// Handle property lines
			else if (line.includes('=') && nodeStack.length > 0) {
				const currentNode = nodeStack[nodeStack.length - 1];
				this.parseIoregProperty(line, currentNode);
			}
		}

		// Extract USB properties for each node
		this.extractUsbProperties(rootNodes);

		return rootNodes;
	}

	private calculateIoregDepth(line: string): number {
		let depth = 0;
		for (let i = 0; i < line.length; i++) {
			if (line[i] === '|' || line[i] === ' ') {
				if (line.substring(i, i + 4) === '| +-' || line.substring(i, i + 3) === '+-o') {
					break;
				}
				if (line[i] === '|') depth++;
			} else {
				break;
			}
		}
		return depth;
	}

	private extractDeviceName(line: string): string {
		const match = line.match(/\+-o\s+([^<]+)/);
		return match ? match[1].trim() : 'Unknown Device';
	}

	private parseIoregProperty(line: string, node: UsbDeviceNode): void {
		const trimmed = line.trim();
		if (!trimmed.includes('=')) return;

		const [keyPart, ...valueParts] = trimmed.split('=');
		const value = valueParts.join('=').trim();

		// Extract the key from within quotes, filtering out the ioreg formatting
		const keyMatch = keyPart.match(/"([^"]+)"/);
		if (!keyMatch) return;

		const key = keyMatch[1];

		// Remove quotes if present from value
		const cleanValue = value.replace(/^"|"$/g, '');

		node.properties.set(key, cleanValue);
	}

	private extractUsbProperties(nodes: UsbDeviceNode[]): void {
		for (const node of nodes) {
			let hasUsbProperties = false;

			// Extract vendor ID (ioreg gives decimal values, not hex)
			const vendorId = node.properties.get('idVendor');
			if (vendorId && typeof vendorId === 'string') {
				const vendorIdNum = parseInt(vendorId, 10); // Parse as decimal, not hex
				if (!isNaN(vendorIdNum)) {
					node.vendorId = vendorIdNum.toString(16).toUpperCase().padStart(4, '0');
					hasUsbProperties = true;
				}
			}

			// Extract product ID (ioreg gives decimal values, not hex)
			const productId = node.properties.get('idProduct');
			if (productId && typeof productId === 'string') {
				const productIdNum = parseInt(productId, 10); // Parse as decimal, not hex
				if (!isNaN(productIdNum)) {
					node.productId = productIdNum.toString(16).toUpperCase().padStart(4, '0');
					hasUsbProperties = true;
				}
			}

			// Extract USB Vendor Name (ioreg gives string values)
			const usbVendorName = node.properties.get('USB Vendor Name');
			if (usbVendorName && typeof usbVendorName === 'string') {
				node.manufacturer = usbVendorName;
				hasUsbProperties = true;
			}

			// Extract USB Product Name (ioreg gives string values)
			const usbProductName = node.properties.get('USB Product Name');
			if (usbProductName && typeof usbProductName === 'string') {
				node.product = usbProductName;
				hasUsbProperties = true;
			}

			// Extract serial number
			const serialNumber = node.properties.get('USB Serial Number');
			if (serialNumber && typeof serialNumber === 'string') {
				node.serialNumber = serialNumber;
			}

			// Extract location ID
			const locationId = node.properties.get('locationID');
			if (locationId && typeof locationId === 'string') {
				node.locationId = locationId;
			}

			if (hasUsbProperties) {
				const deviceKey = `${node.name}-${node.vendorId}:${node.productId}`;
				if (!this.loggedDevices.has(deviceKey)) {
					this.log.log(`Found USB device: ${node.name} - ${node.vendorId}:${node.productId}`);
					this.loggedDevices.add(deviceKey);
				}
			}

			// Recursively process children
			this.extractUsbProperties(node.children);
		}
	}

	private async findDeviceInfoForSerialPort(port: string, usbTree: UsbDeviceNode[]): Promise<DeviceInfo | null> {
		// Extract the device identifier from the port path
		const portIdentifier = this.extractPortIdentifier(port);

		// Find the device node that corresponds to this serial port
		const deviceNode = this.findDeviceNodeForPort(portIdentifier, usbTree);

		if (deviceNode) {
			// Find the first parent with vendor ID and product ID
			const parentWithVidPid = this.findParentWithVidPid(deviceNode);

			if (parentWithVidPid && parentWithVidPid.vendorId && parentWithVidPid.productId) {
				return {
					path: port,
					vendorId: parentWithVidPid.vendorId,
					productId: parentWithVidPid.productId,
					manufacturer: parentWithVidPid.manufacturer,
					product: parentWithVidPid.product,
					serialNumber: parentWithVidPid.serialNumber,
					isArduPilot: this.isArduPilotDevice(parentWithVidPid.vendorId, parentWithVidPid.productId, parentWithVidPid.product)
				};
			}
		}

		return null;
	}

	private extractPortIdentifier(port: string): string {
		// Extract identifier from port names like /dev/cu.usbserial-A50285BI
		const match = port.match(/\/dev\/[^.]+\.(.+)/);
		return match ? match[1] : '';
	}

	private findDeviceNodeForPort(portIdentifier: string, nodes: UsbDeviceNode[]): UsbDeviceNode | null {
		for (const node of nodes) {
			// Check if any of the node's properties contain the port identifier
			for (const [, value] of node.properties.entries()) {
				if (typeof value === 'string' && value.includes(portIdentifier)) {
					return node;
				}
			}

			// Recursively search children
			const childResult = this.findDeviceNodeForPort(portIdentifier, node.children);
			if (childResult) {
				return childResult;
			}
		}

		return null;
	}

	private findParentWithVidPid(node: UsbDeviceNode): UsbDeviceNode | null {
		let current: UsbDeviceNode | undefined = node;

		while (current) {
			if (current.vendorId && current.productId) {
				// Prefer nodes that also have manufacturer and product info
				if (current.manufacturer && current.product) {
					return current;
				}
			}
			current = current.parent;
		}

		// Fallback: if no parent with product info found, try again but accept any parent with VID/PID
		current = node;
		while (current) {
			if (current.vendorId && current.productId) {
				return current;
			}
			current = current.parent;
		}

		return null;
	}

	private async getDarwinSerialPorts(): Promise<string[]> {
		return new Promise((resolve) => {
			// Look for both tty.* and cu.* devices (tty for incoming, cu for outgoing)
			cp.exec('ls /dev/tty.* /dev/cu.* 2>/dev/null | grep -E "(usbserial|usbmodem|SLAB_USBtoUART|Bluetooth-Incoming-Port)" | grep -v Bluetooth', (error, stdout) => {
				if (error) {
					// No serial ports found
					resolve([]);
					return;
				}

				const ports = stdout.split('\n').filter(port => port.trim());
				resolve(ports);
			});
		});
	}

	private async findSerialDeviceForUsbDevice(vendorId: string, productId: string): Promise<string[]> {
		return new Promise((resolve) => {
			// look through /dev/ttyUSB* and /dev/ttyACM*
			cp.exec('ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null', (_error, stdout) => {
				const devices: string[] = [];
				const raw_device_paths = stdout.split('\n').filter(device => device.trim());
				for (const device of raw_device_paths) {
					// Check if the device matches the vendorId and productId
					const result = cp.spawnSync('udevadm', ['info', '--query=property', '--name=' + device], { stdio: 'pipe' });
					const output = result.stdout.toString();
					if (output.includes(`ID_VENDOR_ID=${vendorId}`) && output.includes(`ID_MODEL_ID=${productId}`)) {
						devices.push(device);
					}
				}
				resolve(devices); // No matching device found
			});
		});
	}

	// Check if this is likely an ArduPilot board based on known VIDs/PIDs and names
	private isArduPilotDevice(vendorId: string, _productId: string, description?: string): boolean {
		// Common ArduPilot board manufacturer IDs
		const ardupilotVendorIds = [
			'2341', // Arduino
			'1209', // Hex/ProfiCNC
			'26AC', // 3DR
			'27AC', // HOLYBRO
			'2DAE'  // Cube
		];

		if (ardupilotVendorIds.includes(vendorId.toUpperCase())) {
			return true;
		}

		// Check description for common ArduPilot board names
		if (description) {
			const lcDescription = description.toLowerCase();
			const ardupilotKeywords = ['pixhawk', 'cube', 'ardupilot', 'px4', 'cube', 'navio', 'holybro'];

			for (const keyword of ardupilotKeywords) {
				if (lcDescription.includes(keyword)) {
					return true;
				}
			}
		}

		return false;
	}

	// Set the connection state for MAVProxy
	private setMavproxyConnection(devicePath: string, isConnected: boolean): void {
		const device = apConnectedDevices.connectedDevicesList.get(devicePath);
		if (device) {
			device.isMavproxyConnected = isConnected;
			apConnectedDevices.connectedDevicesList.set(devicePath, device);
		}
	}

	// Command handlers
	public async connectMAVProxy(device: DeviceInfo): Promise<void> {
		// If already connected, ask if user wants to disconnect
		if (this.activeConnections.has(device.path)) {
			const disconnect = await vscode.window.showInformationMessage(
				`Device ${device.path} is already connected to MAVProxy. Would you like to disconnect?`,
				'Disconnect',
				'Cancel'
			);

			if (disconnect === 'Disconnect') {
				await this.disconnectDevice(device);
				// trigger change event to refresh the tree view
				this._onDidChangeTreeData.fire(undefined);
				return;
			} else {
				return; // User canceled
			}
		}

		// Default baud rate for most ArduPilot devices
		const defaultBaudRate = 115200;

		// Ask user for baudrate
		const baudRateInput = await vscode.window.showInputBox({
			prompt: 'Enter baud rate for MAVProxy connection',
			value: defaultBaudRate.toString(),
			validateInput: (value) => {
				const num = parseInt(value);
				return isNaN(num) ? 'Please enter a valid number' : null;
			}
		});

		if (!baudRateInput) {
			return; // User cancelled
		}

		const baudRate = parseInt(baudRateInput);

		// Build the MAVProxy command
		const devicePath = device.path;
		let mavproxyCommand = '';

		// Use mavproxy.py on native Linux or Windows
		const mavproxy = await ProgramUtils.findMavproxy();

		if (!mavproxy.available) {
			vscode.window.showErrorMessage('MAVProxy not found. Please install it first.');
			return;
		}

		mavproxyCommand = `"${mavproxy.path}" --master=${devicePath} --baudrate=${baudRate} --console`;

		// Run MAVProxy in a terminal
		const terminal = vscode.window.createTerminal('MAVProxy Connection');
		terminal.sendText(mavproxyCommand);
		terminal.show();

		// Track the active connection
		this.activeConnections.set(device.path, {
			process: null, // When using terminal, we don't have direct process access
			terminal: terminal
		});

		// Update the device state and refresh the tree view
		this.setMavproxyConnection(device.path, true);
		this.refresh();

		// Set up listeners for terminal close
		const disposable = vscode.window.onDidCloseTerminal(closedTerminal => {
			if (closedTerminal === terminal) {
				this.handleTerminalClosed(device.path);
				disposable.dispose(); // Clean up the event listener
			}
		});

		this.log.log(`Started MAVProxy connection to ${devicePath} at ${baudRate} baud using ${this.isWSL ? 'mavproxy.exe (WSL)' : 'mavproxy.py'}`);
	}

	public async disconnectDevice(device: DeviceInfo): Promise<void> {
		const connection = this.activeConnections.get(device.path);
		if (!connection) {
			return;
		}

		// If we have a terminal, close it
		if (connection.terminal) {
			connection.terminal.dispose();
		}

		// If we have a process, kill it
		if (connection.process) {
			connection.process.kill();
		}

		// Remove from active connections
		this.activeConnections.delete(device.path);

		// Update device state and refresh
		this.setMavproxyConnection(device.path, false);
		this.refresh();

		this.log.log(`Disconnected device ${device.path}`);
	}

	private handleTerminalClosed(devicePath: string): void {
		const connection = this.activeConnections.get(devicePath);
		if (!connection) {
			return;
		}

		// Remove from active connections
		this.activeConnections.delete(devicePath);

		// Update device state and refresh
		this.getConnectedDevices().then(devices => {
			const device = devices.find(d => d.path === devicePath);
			if (device) {
				this.setMavproxyConnection(devicePath, false);
				this.refresh();
			}
		});

		this.log.log(`Terminal closed for device ${devicePath}`);
	}
}

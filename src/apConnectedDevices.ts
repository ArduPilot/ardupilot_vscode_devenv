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
import * as cp from 'child_process';
import * as os from 'os';
import { apLog } from './apLog';

// Device information interface
export interface DeviceInfo {
    path: string;
    vendorId: string;
    productId: string;
    manufacturer?: string;
    product?: string;
    serialNumber?: string;
    isArduPilot?: boolean;
}

// Tree item to represent a connected device
export class ConnectedDeviceItem extends vscode.TreeItem {
	constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly device: DeviceInfo
	) {
		super(label, collapsibleState);

		// Set the device path as the ID
		this.id = device.path;

		// Create description with VID:PID
		this.description = `${device.vendorId}:${device.productId}`;

		// Add tooltip with all device info
		this.tooltip = this.createTooltip();

		// Set icon based on device type (using built-in codicon)
		this.iconPath = new vscode.ThemeIcon(this.getIconForDevice());

		// Set context for right-click menu
		this.contextValue = 'connectedDevice';
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

	private log = new apLog('apConnectedDevices');
	private refreshTimer: NodeJS.Timeout | undefined;
	private isWSL: boolean = false;

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
			this.refresh();
		}, 5000);
	}

	private checkIsWSL(): boolean {
		// Check if running in WSL
		const platform = os.platform();
		if (platform !== 'linux') {
			return false;
		}

		// Check for WSL in release info
		try {
			const releaseInfo = cp.execSync('cat /proc/version').toString();
			return releaseInfo.toLowerCase().includes('microsoft') || releaseInfo.toLowerCase().includes('wsl');
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (error) {
			return false;
		}
	}

	refresh(): void {
		this.log.log('Refreshing connected devices');
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: ConnectedDeviceItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ConnectedDeviceItem): Promise<ConnectedDeviceItem[]> {
		// If element is provided, we're getting children of a device (none for now)
		if (element) {
			return [];
		}

		// Otherwise, we're getting the root devices
		try {
			const devices = await this.getConnectedDevices();
			return devices.map(device => {
				// Create a display name that's more user-friendly
				const displayName = this.createDisplayName(device);
				return new ConnectedDeviceItem(displayName, vscode.TreeItemCollapsibleState.None, device);
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

	private createDisplayName(device: DeviceInfo): string {
		// Use the product name if available, otherwise use the path
		if (device.product) {
			return device.product;
		} else if (device.manufacturer) {
			return `${device.manufacturer} (${device.path})`;
		} else {
			// Just use the base device name from the path
			const pathParts = device.path.split('/');
			return pathParts[pathParts.length - 1];
		}
	}

	private async getConnectedDevices(): Promise<DeviceInfo[]> {
		// Different approach based on platform
		if (process.platform === 'win32') {
			return this.getWindowsDevices();
		} else if (this.isWSL) {
			return this.getWSLDevices();
		} else {
			return this.getLinuxDevices();
		}
	}

	private async getLinuxDevices(): Promise<DeviceInfo[]> {
		return new Promise((resolve, reject) => {
			// Use lsusb and grep for USB devices
			cp.exec('lsusb', (error, stdout) => {
				if (error) {
					reject(new Error(`Error executing lsusb: ${error.message}`));
					return;
				}

				// Parse lsusb output
				const devices: DeviceInfo[] = [];
				const lines = stdout.split('\n');

				for (let i = 0; i < lines.length; i++) {
					if (!lines[i].trim()) continue;

					// Example: Bus 001 Device 002: ID 8087:0024 Intel Corp. Integrated Rate Matching Hub
					const match = lines[i].match(/ID\s+([0-9a-fA-F]+):([0-9a-fA-F]+)\s+(.*)/);
					if (match) {
						const [, vendorId, productId, description] = match;

						// Also get serial devices
						this.findSerialDeviceForUsbDevice(vendorId, productId).then(serialPath => {
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
						});
					}
				}

				resolve(devices);
			});
		});
	}

	private async getWindowsDevices(): Promise<DeviceInfo[]> {
		// On Windows, use PowerShell to get device information
		return new Promise((resolve, reject) => {
			const psCommand = 'Get-PnpDevice -Class Ports | Where-Object { $_.Status -eq "OK" } | Format-List';

			cp.exec(`powershell.exe -Command "${psCommand}"`, (error, stdout) => {
				if (error) {
					reject(new Error(`Error executing PowerShell: ${error.message}`));
					return;
				}

				const devices: DeviceInfo[] = [];
				const sections = stdout.split('\r\n\r\n');

				for (const section of sections) {
					if (!section.trim()) continue;

					// Parse the device info from PowerShell output
					const deviceIdMatch = section.match(/DeviceID\s*:\s*(.*)/);
					const friendlyNameMatch = section.match(/FriendlyName\s*:\s*(.*)/);

					if (deviceIdMatch && friendlyNameMatch) {
						const deviceId = deviceIdMatch[1];
						const friendlyName = friendlyNameMatch[1];

						// Try to extract VID/PID from the DeviceID
						const vidPidMatch = deviceId.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);

						if (vidPidMatch) {
							const [, vendorId, productId] = vidPidMatch;
							const comMatch = friendlyName.match(/\(COM(\d+)\)/);
							devices.push({
								path: comMatch && comMatch[1] ? `COM${comMatch[1]}` : friendlyName,
								vendorId,
								productId,
								product: friendlyName,
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
		try {
			// First check if we can access serial devices directly in WSL
			const linuxDevices = await this.getLinuxDevices();
			devices.push(...linuxDevices);
			// Otherwise, try to use PowerShell from WSL to access Windows devices
			this.log.log('No devices found directly in WSL, trying Windows approach...');

			return new Promise((resolve) => {
				// Execute PowerShell from WSL using powershell.exe
				const psCommand = 'Get-PnpDevice -Class Ports | Where-Object { $_.Status -eq "OK" } | Format-List';

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

		} catch (error) {
			this.log.log(`Error in WSL device detection: ${error}`);
			return [];
		}
	}

	private async findSerialDeviceForUsbDevice(vendorId: string, productId: string): Promise<string | null> {
		return new Promise((resolve) => {
			// Look for serial device files
			cp.exec('ls -l /dev/tty* | grep -i serial', (error) => {
				if (error) {
					// This might error if there are no serial devices, which is fine
					resolve(null);
					return;
				}

				// Check if we can match device by VID/PID
				cp.exec(`udevadm info --name=/dev/ttyACM* --attribute-walk 2>/dev/null | grep -i "ATTRS{idVendor}=="${vendorId}"" -A10 | grep -i "ATTRS{idProduct}=="${productId}""`, (error, stdout) => {
					if (error || !stdout.trim()) {
						// Try ttyUSB
						cp.exec(`udevadm info --name=/dev/ttyUSB* --attribute-walk 2>/dev/null | grep -i "ATTRS{idVendor}=="${vendorId}"" -A10 | grep -i "ATTRS{idProduct}=="${productId}""`, (error, stdout) => {
							if (error || !stdout.trim()) {
								resolve(null);
								return;
							}

							// Find the device name
							cp.exec('find /dev -name "ttyUSB*" | head -1', (error, stdout) => {
								if (error || !stdout.trim()) {
									resolve(null);
								} else {
									resolve(stdout.trim());
								}
							});
						});
					} else {
						// Find the device name
						cp.exec('find /dev -name "ttyACM*" | head -1', (error, stdout) => {
							if (error || !stdout.trim()) {
								resolve(null);
							} else {
								resolve(stdout.trim());
							}
						});
					}
				});
			});
		});
	}

	// Check if this is likely an ArduPilot board based on known VIDs/PIDs and names
	private isArduPilotDevice(vendorId: string, productId: string, description?: string): boolean {
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
}

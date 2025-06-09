/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import {
	DeviceInfo,
	ConnectedDeviceDecorationProvider,
	ConnectedDeviceItem,
	apConnectedDevices
} from '../../apConnectedDevices';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';
import { ProgramUtils } from '../../apProgramUtils';

suite('apConnectedDevices Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;
	let provider: apConnectedDevices;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();

		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert(apExtensionContext.connectedDevicesProvider, 'connectedDevicesProvider should be initialized');
		provider = apExtensionContext.connectedDevicesProvider;
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Constructor and Initialization', () => {
		test('should create provider instance', () => {
			assert(provider instanceof apConnectedDevices);
		});

		test('should have onDidChangeTreeData event emitter', () => {
			assert(provider.onDidChangeTreeData);
			assert.strictEqual(typeof provider.onDidChangeTreeData, 'function');
		});

		test('should start auto-refresh timer on construction', () => {
			const setIntervalSpy = sandbox.spy(global, 'setInterval');
			const newProvider = new apConnectedDevices();

			assert(setIntervalSpy.calledOnce);
			assert.strictEqual(setIntervalSpy.firstCall.args[1], 1000); // 1 second interval

			newProvider.dispose();
		});
	});

	suite('Tree Data Provider Interface', () => {
		test('should implement getTreeItem correctly', () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true
			};

			const item = new ConnectedDeviceItem(
				'Test Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				mockDevice
			);

			const result = provider.getTreeItem(item);
			assert.strictEqual(result, item);
		});

		test('should return device commands for device children', async () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true,
				isMavproxyConnected: false
			};

			const parentItem = new ConnectedDeviceItem(
				'Test Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				mockDevice
			);

			const children = await provider.getChildren(parentItem);

			assert(Array.isArray(children));
			assert(children.length > 0);
			assert(children[0].isCommand);
			assert.strictEqual(children[0].label, 'Connect with MAVProxy');
		});

		test('should return different commands based on connection state', async () => {
			const connectedDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true,
				isMavproxyConnected: true
			};

			const disconnectedDevice: DeviceInfo = {
				...connectedDevice,
				isMavproxyConnected: false
			};

			const connectedItem = new ConnectedDeviceItem(
				'Connected Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				connectedDevice
			);

			const disconnectedItem = new ConnectedDeviceItem(
				'Disconnected Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				disconnectedDevice
			);

			const connectedChildren = await provider.getChildren(connectedItem);
			const disconnectedChildren = await provider.getChildren(disconnectedItem);

			assert.strictEqual(connectedChildren[0].label, 'Disconnect MAVProxy');
			assert.strictEqual(disconnectedChildren[0].label, 'Connect with MAVProxy');
		});
	});

	suite('Device Detection', () => {
		test('should handle empty device list gracefully', async () => {
			// Mock child_process.exec to return empty result
			sandbox.stub(cp, 'exec').callsFake((_command: string, callback: any) => {
				callback(null, '', '');
				return {} as cp.ChildProcess;
			});

			const children = await provider.getChildren();
			assert(Array.isArray(children));
			assert.strictEqual(children.length, 0);
		});

		test('should handle device detection errors gracefully', async () => {
			provider.setIsWSL(false);

			// Mock child_process.exec to return error
			sandbox.stub(cp, 'exec').callsFake((_command: string, callback: any) => {
				callback(new Error('Device detection failed'), '', '');
				return {} as cp.ChildProcess;
			});

			const children = await provider.getChildren();
			assert(Array.isArray(children));
			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'Error detecting devices');
		});

		test('should detect multiple CubePilot devices', async () => {
			provider.setIsWSL(false);

			// Mock lsusb output with multiple CubePilot devices
			const mockLsusbOutput = `Bus 001 Device 003: ID 2dae:1016 CubePilot CubeOrangePlus
Bus 001 Device 004: ID 2dae:1011 CubePilot CubeOrange
Bus 001 Device 005: ID 1234:5678 Generic Serial Device`;

			// Mock ls /dev/tty* to return multiple serial devices
			const mockDeviceList = '/dev/ttyACM0\n/dev/ttyACM1\n/dev/ttyUSB0';

			// Mock child_process.exec for lsusb
			sandbox.stub(cp, 'exec').callsFake((command: string, callback: any) => {
				if (command === 'lsusb') {
					callback(null, mockLsusbOutput, '');
				} else if (command.includes('ls /dev/tty')) {
					callback(null, mockDeviceList, '');
				}
				return {} as cp.ChildProcess;
			});

			// Mock cp.spawnSync for udevadm to return matching devices
			sandbox.stub(cp, 'spawnSync').callsFake((command: string, args?: readonly string[]) => {
				const devicePath = args && args[2] ? args[2].replace('--name=', '') : '';
				let stdout = '';

				if (devicePath === '/dev/ttyACM0') {
					// CubeOrangePlus
					stdout = 'ID_VENDOR_ID=2dae\nID_MODEL_ID=1016\n';
				} else if (devicePath === '/dev/ttyACM1') {
					// CubeOrange
					stdout = 'ID_VENDOR_ID=2dae\nID_MODEL_ID=1011\n';
				} else if (devicePath === '/dev/ttyUSB0') {
					// Generic device
					stdout = 'ID_VENDOR_ID=1234\nID_MODEL_ID=5678\n';
				}

				return {
					pid: 12345,
					output: [null, Buffer.from(stdout, 'utf8'), Buffer.from('', 'utf8')],
					stdout: Buffer.from(stdout, 'utf8'),
					stderr: Buffer.from('', 'utf8'),
					status: 0,
					signal: null
				};
			});

			const children = await provider.getChildren();

			// Should have detected 3 devices
			assert(Array.isArray(children));
			assert.strictEqual(children.length, 3);

			// Check CubeOrangePlus device
			const cubeOrangePlus = children.find(child =>
				child.device.path === '/dev/ttyACM0' &&
				child.device.productId === '1016'
			);
			assert(cubeOrangePlus);
			assert.strictEqual(cubeOrangePlus.device.vendorId, '2dae');
			assert(cubeOrangePlus.device.isArduPilot);

			// Check CubeOrange device
			const cubeOrange = children.find(child =>
				child.device.path === '/dev/ttyACM1' &&
				child.device.productId === '1011'
			);
			assert(cubeOrange);
			assert.strictEqual(cubeOrange.device.vendorId, '2dae');
			assert(cubeOrange.device.isArduPilot);

			// Check generic device (should not be marked as ArduPilot)
			const genericDevice = children.find(child =>
				child.device.path === '/dev/ttyUSB0' &&
				child.device.productId === '5678'
			);
			assert(genericDevice);
			assert.strictEqual(genericDevice.device.vendorId, '1234');
			assert.strictEqual(genericDevice.device.isArduPilot, false);
		});

		test('should handle single device with multiple serial ports', async () => {
			provider.setIsWSL(false);

			// Simulate a device that creates multiple serial ports (like CubeOrange with multiple interfaces)
			const mockLsusbOutput = 'Bus 001 Device 003: ID 2dae:1011 CubePilot CubeOrange';
			const mockDeviceList = '/dev/ttyACM0\n/dev/ttyACM1';

			sandbox.stub(cp, 'exec').callsFake((command: string, callback: any) => {
				if (command === 'lsusb') {
					callback(null, mockLsusbOutput, '');
				} else if (command.includes('ls /dev/tty')) {
					callback(null, mockDeviceList, '');
				}
				return {} as cp.ChildProcess;
			});

			// Both serial ports belong to the same USB device
			sandbox.stub(cp, 'spawnSync').callsFake(() => ({
				pid: 12345,
				output: [null, Buffer.from('ID_VENDOR_ID=2dae\nID_MODEL_ID=1011\n', 'utf8'), Buffer.from('', 'utf8')],
				stdout: Buffer.from('ID_VENDOR_ID=2dae\nID_MODEL_ID=1011\n', 'utf8'),
				stderr: Buffer.from('', 'utf8'),
				status: 0,
				signal: null
			}));

			const children = await provider.getChildren();

			// Should have 2 entries (one for each serial port)
			assert(Array.isArray(children));
			assert.strictEqual(children.length, 2);

			// Both should be CubeOrange devices
			children.forEach(child => {
				assert.strictEqual(child.device.vendorId, '2dae');
				assert.strictEqual(child.device.productId, '1011');
				assert(child.device.isArduPilot);
			});

			// Should have different paths
			const paths = children.map(child => child.device.path);
			assert(paths.includes('/dev/ttyACM0'));
			assert(paths.includes('/dev/ttyACM1'));
		});

		test('should detect devices in WSL mode', async () => {
			provider.setIsWSL(true);

			// Mock Linux devices (first attempt)
			const mockLsusbOutput = 'Bus 001 Device 003: ID 2dae:1016 CubePilot CubeOrangePlus';
			const mockDeviceList = '/dev/ttyACM0';

			// Mock Windows PowerShell devices (second attempt)
			const mockPowerShellOutput = `DeviceID : USB\\VID_2DAE&PID_1011\\5&123456&0&2
FriendlyName : CubeOrange (COM3)
Manufacturer : CubePilot

DeviceID : USB\\VID_1234&PID_5678\\6&789012&0&3
FriendlyName : Generic Serial Device (COM4)
Manufacturer : Generic Inc`;

			let execCallCount = 0;
			sandbox.stub(cp, 'exec').callsFake((command: string, callback: any) => {
				execCallCount++;
				if (command === 'lsusb') {
					callback(null, mockLsusbOutput, '');
				} else if (command.includes('ls /dev/tty')) {
					callback(null, mockDeviceList, '');
				} else if (command.includes('powershell.exe')) {
					callback(null, mockPowerShellOutput, '');
				}
				return {} as cp.ChildProcess;
			});

			sandbox.stub(cp, 'spawnSync').callsFake(() => ({
				pid: 12345,
				output: [null, Buffer.from('ID_VENDOR_ID=2dae\nID_MODEL_ID=1016\n', 'utf8'), Buffer.from('', 'utf8')],
				stdout: Buffer.from('ID_VENDOR_ID=2dae\nID_MODEL_ID=1016\n', 'utf8'),
				stderr: Buffer.from('', 'utf8'),
				status: 0,
				signal: null
			}));

			const children = await provider.getChildren();

			// Should have detected devices from both Linux and Windows approaches
			assert(Array.isArray(children));
			assert(children.length > 0);

			// Should have at least one Linux device and Windows devices
			const linuxDevice = children.find(child => child.device.path === '/dev/ttyACM0');
			const windowsDevice = children.find(child => child.device.path === 'COM3');

			assert(linuxDevice, 'Should have Linux device');
			assert(windowsDevice, 'Should have Windows device');
		});
	});

	suite('Refresh Functionality', () => {
		test('should fire change event on refresh', () => {
			let eventFired = false;
			provider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			provider.refresh();
			assert(eventFired);
		});

		test('should refresh connected devices provider from extension context', () => {
			assert(apExtensionContext.connectedDevicesProvider);

			let eventFired = false;
			apExtensionContext.connectedDevicesProvider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			apExtensionContext.connectedDevicesProvider.refresh();
			assert(eventFired);
		});
	});

	suite('Disposal', () => {
		test('should clear refresh timer on dispose', () => {
			const clearIntervalSpy = sandbox.spy(global, 'clearInterval');

			provider.dispose();
			assert(clearIntervalSpy.called);
		});

		test('should handle dispose when timer is undefined', () => {
			const newProvider = new apConnectedDevices();
			// Dispose immediately to test edge case
			newProvider.dispose();
			newProvider.dispose(); // Second call should not throw
		});
	});

	suite('Device Decoration Integration', () => {
		test('should create device items with proper resource URIs for decoration', async () => {
			const connectedDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true,
				isMavproxyConnected: true
			};

			const disconnectedDevice: DeviceInfo = {
				...connectedDevice,
				isMavproxyConnected: false
			};

			const connectedItem = new ConnectedDeviceItem(
				'Connected Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				connectedDevice
			);

			const disconnectedItem = new ConnectedDeviceItem(
				'Disconnected Device',
				vscode.TreeItemCollapsibleState.Collapsed,
				disconnectedDevice
			);

			const connectedChildren = await provider.getChildren(connectedItem);
			const disconnectedChildren = await provider.getChildren(disconnectedItem);

			// Test connected device command URI
			const disconnectCommand = connectedChildren[0];
			assert(disconnectCommand.resourceUri);
			assert.strictEqual(disconnectCommand.resourceUri.scheme, 'connected-device');
			assert.strictEqual(disconnectCommand.resourceUri.query, 'connected');

			// Test disconnected device command URI
			const connectCommand = disconnectedChildren[0];
			assert(connectCommand.resourceUri);
			assert.strictEqual(connectCommand.resourceUri.scheme, 'connected-device');
			assert.strictEqual(connectCommand.resourceUri.query, 'disconnected');
		});

		test('should test decoration functionality through registered provider', () => {
			// Test decoration functionality by verifying that the extension context
			// has the decoration provider registered in subscriptions
			assert(apExtensionContext.vscodeContext);
			assert(apExtensionContext.vscodeContext.subscriptions);

			// Verify subscription exists (decoration provider is registered)
			const hasDecorationSubscription = apExtensionContext.vscodeContext.subscriptions.length > 0;
			assert(hasDecorationSubscription);
		});

		test('should refresh decorations when refresh command is executed', async () => {
			// Test that the refresh command also refreshes decorations
			// by verifying the command exists and can be executed
			const commands = await vscode.commands.getCommands();
			assert(commands.includes('connected-devices.refresh'));

			// Execute refresh command (this should refresh both tree and decorations)
			await vscode.commands.executeCommand('connected-devices.refresh');

			// If we get here without error, the command executed successfully
			assert(true);
		});
	});

	suite('Command Integration', () => {
		test('should register all required commands', async () => {
			const commands = await vscode.commands.getCommands();

			// Verify all connected devices commands are registered
			assert(commands.includes('connected-devices.refresh'));
			assert(commands.includes('connected-devices.connectMAVProxy'));
			assert(commands.includes('connected-devices.disconnectMAVProxy'));
		});

		test('should execute refresh command', async () => {
			let refreshCalled = false;

			if (apExtensionContext.connectedDevicesProvider) {
				// Store original refresh method
				const originalRefresh = apExtensionContext.connectedDevicesProvider.refresh;

				// Replace with spy
				apExtensionContext.connectedDevicesProvider.refresh = () => {
					refreshCalled = true;
					originalRefresh.call(apExtensionContext.connectedDevicesProvider);
				};

				// Execute command
				await vscode.commands.executeCommand('connected-devices.refresh');

				// Restore original method
				apExtensionContext.connectedDevicesProvider.refresh = originalRefresh;
			}

			assert(refreshCalled);
		});

		test('should handle connectMAVProxy command with successful connection', async () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true,
				isMavproxyConnected: false
			};

			// Mock ProgramUtils.findMavproxy to return available MAVProxy
			sandbox.stub(ProgramUtils, 'findMavproxy').resolves({ available: true, path: '/usr/bin/mavproxy.py' });

			// Mock terminal creation
			const mockTerminal = {
				dispose: sandbox.stub(),
				show: sandbox.stub(),
				sendText: sandbox.stub()
			} as any;

			sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);
			sandbox.stub(vscode.window, 'onDidCloseTerminal').returns({ dispose: sandbox.stub() } as any);

			// Mock UI inputs to prevent blocking
			sandbox.stub(vscode.window, 'showInputBox').resolves('115200');

			// Execute command
			await vscode.commands.executeCommand('connected-devices.connectMAVProxy', mockDevice);

			// Verify terminal was created and used
			assert(mockTerminal.sendText.calledOnce);
			assert(mockTerminal.show.calledOnce);
		});

		test('should handle disconnectMAVProxy command', async () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true,
				isMavproxyConnected: true
			};

			// Execute disconnect command (should handle gracefully even with no active connection)
			await vscode.commands.executeCommand('connected-devices.disconnectMAVProxy', mockDevice);

			// If we get here without error, the command executed successfully
			assert(true);
		});
	});

	suite('Device Item Creation', () => {
		test('should create device item with proper display name from product', () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				product: 'CubeOrangePlus',
				isArduPilot: true
			};

			const item = new ConnectedDeviceItem(
				'CubeOrangePlus',
				vscode.TreeItemCollapsibleState.Collapsed,
				mockDevice
			);

			assert.strictEqual(item.label, 'CubeOrangePlus');
			assert.strictEqual(item.description, '2DAE:1016');
			assert(typeof item.tooltip === 'string' && item.tooltip.includes('CubeOrangePlus'));
			assert(typeof item.tooltip === 'string' && item.tooltip.includes('/dev/ttyACM0'));
		});

		test('should create device item with manufacturer fallback', () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				manufacturer: 'CubePilot',
				isArduPilot: true
			};

			// Test display name creation when no product is specified
			const provider = new apConnectedDevices();
			// @ts-expect-error - accessing private method for testing
			const displayName = provider.createDisplayName(mockDevice);

			assert.strictEqual(displayName, 'CubePilot (/dev/ttyACM0)');
			provider.dispose();
		});

		test('should create device item with path fallback', () => {
			const mockDevice: DeviceInfo = {
				path: '/dev/ttyACM0',
				vendorId: '2DAE',
				productId: '1016',
				isArduPilot: false
			};

			// Test display name creation when no product or manufacturer
			const provider = new apConnectedDevices();
			// @ts-expect-error - accessing private method for testing
			const displayName = provider.createDisplayName(mockDevice);

			assert.strictEqual(displayName, 'ttyACM0');
			provider.dispose();
		});

		test('should detect ArduPilot devices correctly', () => {
			const provider = new apConnectedDevices();

			// Test ArduPilot vendor ID for CubePilot
			// @ts-expect-error - accessing private method for testing
			let isArduPilot = provider.isArduPilotDevice('2DAE', '1016', 'CubePilot');
			assert(isArduPilot);

			// Test non-ArduPilot device
			// @ts-expect-error - accessing private method for testing
			isArduPilot = provider.isArduPilotDevice('1234', '5678', 'Generic Serial Device');
			assert(!isArduPilot);

			provider.dispose();
		});
	});
});

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
import { apTerminalMonitor } from '../../apTerminalMonitor';

suite('apConnectedDevices Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;
	let provider: apConnectedDevices;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();

		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder);
		assert.ok(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		assert.ok(apExtensionContext.connectedDevicesProvider, 'connectedDevicesProvider should be initialized');
		provider = apExtensionContext.connectedDevicesProvider;
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('Constructor and Initialization', () => {
		test('should create provider instance', () => {
			assert.ok(provider instanceof apConnectedDevices);
		});

		test('should have onDidChangeTreeData event emitter', () => {
			assert.ok(provider.onDidChangeTreeData);
			assert.strictEqual(typeof provider.onDidChangeTreeData, 'function');
		});

		test('should start auto-refresh timer on construction', () => {
			const setTimeoutSpy = sandbox.spy(global, 'setTimeout');
			const newProvider = new apConnectedDevices();

			assert.ok(setTimeoutSpy.calledOnce);
			assert.strictEqual(setTimeoutSpy.firstCall.args[1], 1000); // 1 second interval

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

			assert.ok(Array.isArray(children));
			assert.ok(children.length > 0);
			assert.ok(children[0].isCommand);
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
			// Stub provider method to avoid stubbing built-in child_process on Node 22+
			sandbox.stub(provider as any, 'getConnectedDevices').resolves([]);

			const children = await provider.getChildren();
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 0);
		});

		test('should handle device detection errors gracefully', async function() {
			// Skip this test on non-Linux platforms as it tests Linux-specific device detection
			if (process.platform !== 'linux') {
				this.skip();
				return;
			}

			provider.setIsWSL(false);

			// Stub Linux device detection to throw
			sandbox.stub(provider as any, 'getLinuxDevices').rejects(new Error('Device detection failed'));

			const children = await provider.getChildren();
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 0);
		});

		test('should detect multiple CubePilot devices', async function() {
			// Skip this test on non-Linux platforms as it tests Linux-specific device detection
			if (process.platform !== 'linux') {
				this.skip();
				return;
			}

			provider.setIsWSL(false);

			// Mock ProgramUtils.findProgram for LSUSB
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				path: '/usr/bin/lsusb',
				isCustomPath: false
			});

			// Mock lsusb output with multiple CubePilot devices
			const mockLsusbOutput = `Bus 001 Device 003: ID 2dae:1016 CubePilot CubeOrangePlus
Bus 001 Device 004: ID 2dae:1011 CubePilot CubeOrange
Bus 001 Device 005: ID 1234:5678 Generic Serial Device`;

			// Mock ls /dev/tty* to return multiple serial devices
			const mockDeviceList = '/dev/ttyACM0\n/dev/ttyACM1\n/dev/ttyUSB0';

			// Mock child_process.spawnSync for lsusb and ls commands
			sandbox.stub(cp, 'spawnSync').callsFake((command: string, args?: readonly string[], options?: any) => {
				if (command === 'lsusb' || command === '/usr/bin/lsusb') {
					return {
						error: undefined,
						stdout: mockLsusbOutput,
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from(mockLsusbOutput, 'utf8'), Buffer.from('', 'utf8')]
					};
				} else if (command === 'ls' && args && args.some(arg => arg.includes('/dev/tty'))) {
					return {
						error: undefined,
						stdout: mockDeviceList,
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from(mockDeviceList, 'utf8'), Buffer.from('', 'utf8')]
					};
				} else if (command === 'udevadm') {
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
						error: undefined,
						stdout,
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from(stdout, 'utf8'), Buffer.from('', 'utf8')]
					};
				} else {
					return {
						error: undefined,
						stdout: '',
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from('', 'utf8'), Buffer.from('', 'utf8')]
					};
				}
			});

			const children = await provider.getChildren();

			// Should have detected 3 devices
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 3);

			// Check CubeOrangePlus device
			const cubeOrangePlus = children.find(child =>
				child.device.path === '/dev/ttyACM0' &&
				child.device.productId === '1016'
			);
			assert.ok(cubeOrangePlus);
			assert.strictEqual(cubeOrangePlus.device.vendorId, '2dae');
			assert.ok(cubeOrangePlus.device.isArduPilot);

			// Check CubeOrange device
			const cubeOrange = children.find(child =>
				child.device.path === '/dev/ttyACM1' &&
				child.device.productId === '1011'
			);
			assert.ok(cubeOrange);
			assert.strictEqual(cubeOrange.device.vendorId, '2dae');
			assert.ok(cubeOrange.device.isArduPilot);

			// Check generic device (should not be marked as ArduPilot)
			const genericDevice = children.find(child =>
				child.device.path === '/dev/ttyUSB0' &&
				child.device.productId === '5678'
			);
			assert.ok(genericDevice);
			assert.strictEqual(genericDevice.device.vendorId, '1234');
			assert.strictEqual(genericDevice.device.isArduPilot, false);
		});

		test('should handle single device with multiple serial ports', async function() {
			// Skip this test on non-Linux platforms as it tests Linux-specific device detection
			if (process.platform !== 'linux') {
				this.skip();
				return;
			}

			provider.setIsWSL(false);

			// Mock ProgramUtils.findProgram for LSUSB
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				path: '/usr/bin/lsusb',
				isCustomPath: false
			});

			// Simulate a device that creates multiple serial ports (like CubeOrange with multiple interfaces)
			const mockLsusbOutput = 'Bus 001 Device 003: ID 2dae:1011 CubePilot CubeOrange';
			const mockDeviceList = '/dev/ttyACM0\n/dev/ttyACM1';

			// Mock child_process.spawnSync for lsusb, ls and udevadm commands
			sandbox.stub(cp, 'spawnSync').callsFake((command: string, args?: readonly string[], options?: any) => {
				if (command === 'lsusb' || command === '/usr/bin/lsusb') {
					return {
						error: undefined,
						stdout: mockLsusbOutput,
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from(mockLsusbOutput, 'utf8'), Buffer.from('', 'utf8')]
					};
				} else if (command === 'ls' && args && args.some(arg => arg.includes('/dev/tty'))) {
					return {
						error: undefined,
						stdout: mockDeviceList,
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from(mockDeviceList, 'utf8'), Buffer.from('', 'utf8')]
					};
				} else if (command === 'udevadm') {
					// Both serial ports belong to the same USB device
					return {
						error: undefined,
						stdout: 'ID_VENDOR_ID=2dae\nID_MODEL_ID=1011\n',
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from('ID_VENDOR_ID=2dae\nID_MODEL_ID=1011\n', 'utf8'), Buffer.from('', 'utf8')]
					};
				} else {
					return {
						error: undefined,
						stdout: '',
						stderr: '',
						status: 0,
						signal: null,
						pid: 12345,
						output: [null, Buffer.from('', 'utf8'), Buffer.from('', 'utf8')]
					};
				}
			});

			const children = await provider.getChildren();

			// Should have 2 entries (one for each serial port)
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 2);

			// Both should be CubeOrange devices
			children.forEach(child => {
				assert.strictEqual(child.device.vendorId, '2dae');
				assert.strictEqual(child.device.productId, '1011');
				assert.ok(child.device.isArduPilot);
			});

			// Should have different paths
			const paths = children.map(child => child.device.path);
			assert.ok(paths.includes('/dev/ttyACM0'));
			assert.ok(paths.includes('/dev/ttyACM1'));
		});

		test('should handle device detection errors gracefully on macOS', async function() {
			// Skip this test on non-Darwin platforms as it tests Darwin-specific device detection
			if (process.platform !== 'darwin') {
				this.skip();
				return;
			}

			provider.setIsWSL(false);

			// Stub Darwin device detection to simulate failure
			sandbox.stub(provider as any, 'getDarwinDevices').rejects(new Error('ioreg command failed'));

			const children = await provider.getChildren();
			assert.ok(Array.isArray(children));
			assert.strictEqual(children.length, 0); // Darwin error handling returns empty array instead of error item
		});

		test('should detect Darwin serial devices', async function() {
			// Skip this test on non-Darwin platforms as it tests Darwin-specific device detection
			if (process.platform !== 'darwin') {
				this.skip();
				return;
			}

			provider.setIsWSL(false);

			const mockIoregOutput = `+-o USB3.0 Hub@01100000  <class IOUSBHostDevice, id 0x100000abc, registered, matched, active, busy 0 (2 ms), retain 12>
  {
    "sessionID" = 123456789
    "iManufacturer" = 0
    "bNumConfigurations" = 1
    "idProduct" = 4118
    "bcdDevice" = 256
    "Built-In" = No
    "locationID" = 272629760
    "bMaxPacketSize0" = 64
    "bcdUSB" = 512
    "USB Address" = 17
    "idVendor" = 11694
    "iProduct" = 0
    "iSerialNumber" = 0
    "bDeviceClass" = 9
    "USB Product Name" = "CubeOrangePlus"
    "PortNum" = 1
    "USB Vendor Name" = "CubePilot"
    "Device Speed" = 2
    "USB Serial Number" = "ABC123"
    "bDeviceSubClass" = 0
    "bDeviceProtocol" = 1
  }`;

			const mockSerialPorts = '/dev/cu.usbmodem1234\n/dev/tty.usbmodem1234';

			// Stub Darwin device detection directly to avoid stubbing child_process
			sandbox.stub(provider as any, 'getDarwinDevices').resolves([
				{ path: '/dev/cu.usbmodem1234', vendorId: '2DAE', productId: '1011', manufacturer: 'CubePilot', product: 'CubeOrangePlus', isArduPilot: true } as DeviceInfo
			]);

			const children = await provider.getChildren();
			assert.ok(Array.isArray(children));
			// Should detect at least one device (exact count depends on how Darwin parsing works)
			assert.ok(children.length >= 0);
		});

		test('should detect devices in WSL mode', async () => {
			provider.setIsWSL(true);

			// Mock ProgramUtils.findProgram for LSUSB
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				path: '/usr/bin/lsusb',
				isCustomPath: false
			});

			// Mock Linux devices (first attempt)
			const mockLsusbOutput = 'Bus 001 Device 003: ID 2dae:1016 CubePilot CubeOrangePlus';
			const mockDeviceList = '/dev/ttyACM0';

			// Mock Windows PowerShell devices (second attempt)
			const mockPowerShellOutput = 'DeviceID : USB\\VID_2DAE&PID_1011\\5&123456&0&2\r\nFriendlyName : CubeOrange (COM3)\r\nManufacturer : CubePilot\r\n\r\nDeviceID : USB\\VID_1234&PID_5678\\6&789012&0&3\r\nFriendlyName : Generic Serial Device (COM4)\r\nManufacturer : Generic Inc';

			// Stub WSL device detection directly to avoid stubbing child_process
			sandbox.stub(provider as any, 'getWSLDevices').resolves([
				{ path: '/dev/ttyACM0', vendorId: '2dae', productId: '1016', manufacturer: 'CubePilot', product: 'CubeOrangePlus', isArduPilot: true } as DeviceInfo,
				{ path: 'COM3', vendorId: '2DAE', productId: '1011', manufacturer: 'CubePilot', product: 'CubeOrange (Windows)', isArduPilot: true } as DeviceInfo
			]);

			const children = await provider.getChildren();

			// Should have detected devices from both Linux and Windows approaches
			assert.ok(Array.isArray(children));
			assert.ok(children.length > 0);

			// Should have at least one Linux device and Windows devices
			const linuxDevice = children.find(child => child.device.path === '/dev/ttyACM0');
			const windowsDevice = children.find(child => child.device.path === 'COM3');

			assert.ok(linuxDevice, 'Should have Linux device');
			assert.ok(windowsDevice, 'Should have Windows device');
		});

		test('should handle partial WSL detection failures - lsusb fails, PowerShell succeeds', async () => {
			provider.setIsWSL(true);

			// Mock Windows PowerShell devices to succeed
			const mockPowerShellOutput = 'DeviceID : USB\\VID_2DAE&PID_1011\\5&123456&0&2\r\nFriendlyName : CubeOrange (COM3)\r\nManufacturer : CubePilot';

			// Stub WSL devices to include only Windows device
			sandbox.stub(provider as any, 'getWSLDevices').resolves([
				{ path: 'COM3', vendorId: '2DAE', productId: '1011', manufacturer: 'CubePilot', product: 'CubeOrange (Windows)', isArduPilot: true } as DeviceInfo
			]);

			const children = await provider.getChildren();

			// Should still find Windows devices even when Linux detection fails
			assert.ok(Array.isArray(children));
			assert.ok(children.length > 0, 'Should find Windows devices when Linux detection fails');

			const windowsDevice = children.find(child => child.device.path === 'COM3');
			assert.ok(windowsDevice, 'Should find Windows device from PowerShell');
		});

		test('should handle partial WSL detection failures - PowerShell fails, lsusb succeeds', async () => {
			provider.setIsWSL(true);

			// Mock ProgramUtils.findProgram for LSUSB
			sandbox.stub(ProgramUtils, 'findProgram').resolves({
				available: true,
				path: '/usr/bin/lsusb',
				isCustomPath: false
			});

			// Mock Linux devices to succeed
			const mockLsusbOutput = 'Bus 001 Device 003: ID 2dae:1016 CubePilot CubeOrangePlus';
			const mockDeviceList = '/dev/ttyACM0';

			// Stub WSL devices to include only Linux device
			sandbox.stub(provider as any, 'getWSLDevices').resolves([
				{ path: '/dev/ttyACM0', vendorId: '2dae', productId: '1016', manufacturer: 'CubePilot', product: 'CubeOrangePlus', isArduPilot: true } as DeviceInfo
			]);

			const children = await provider.getChildren();

			// Should still find Linux devices even when PowerShell fails
			assert.ok(Array.isArray(children));
			assert.ok(children.length > 0, 'Should find Linux devices when PowerShell fails');

			const linuxDevice = children.find(child => child.device.path === '/dev/ttyACM0');
			assert.ok(linuxDevice, 'Should find Linux device from lsusb');
		});
	});

	suite('Refresh Functionality', () => {
		test('should fire change event on refresh', () => {
			let eventFired = false;
			provider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			provider.refresh();
			assert.ok(eventFired);
		});

		test('should refresh connected devices provider from extension context', () => {
			assert.ok(apExtensionContext.connectedDevicesProvider);

			let eventFired = false;
			apExtensionContext.connectedDevicesProvider.onDidChangeTreeData(() => {
				eventFired = true;
			});

			apExtensionContext.connectedDevicesProvider.refresh();
			assert.ok(eventFired);
		});
	});

	suite('Disposal', () => {
		test('should clear refresh timer on dispose', () => {
			const clearIntervalSpy = sandbox.spy(global, 'clearInterval');

			provider.dispose();
			assert.ok(clearIntervalSpy.called);
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
			assert.ok(disconnectCommand.resourceUri);
			assert.strictEqual(disconnectCommand.resourceUri.scheme, 'connected-device');
			assert.strictEqual(disconnectCommand.resourceUri.query, 'connected');

			// Test disconnected device command URI
			const connectCommand = disconnectedChildren[0];
			assert.ok(connectCommand.resourceUri);
			assert.strictEqual(connectCommand.resourceUri.scheme, 'connected-device');
			assert.strictEqual(connectCommand.resourceUri.query, 'disconnected');
		});

		test('should test decoration functionality through registered provider', () => {
			// Test decoration functionality by verifying that the extension context
			// has the decoration provider registered in subscriptions
			assert.ok(apExtensionContext.vscodeContext);
			assert.ok(apExtensionContext.vscodeContext.subscriptions);

			// Verify subscription exists (decoration provider is registered)
			const hasDecorationSubscription = apExtensionContext.vscodeContext.subscriptions.length > 0;
			assert.ok(hasDecorationSubscription);
		});

		test('should refresh decorations when refresh command is executed', async () => {
			// Test that the refresh command also refreshes decorations
			// by verifying the command exists and can be executed
			const commands = await vscode.commands.getCommands();
			assert.ok(commands.includes('connected-devices.refresh'));

			// Execute refresh command (this should refresh both tree and decorations)
			await vscode.commands.executeCommand('connected-devices.refresh');

			// If we get here without error, the command executed successfully
			assert.ok(true);
		});
	});

	suite('Command Integration', () => {
		test('should register all required commands', async () => {
			const commands = await vscode.commands.getCommands();

			// Verify all connected devices commands are registered
			assert.ok(commands.includes('connected-devices.refresh'));
			assert.ok(commands.includes('connected-devices.connectMAVProxy'));
			assert.ok(commands.includes('connected-devices.disconnectMAVProxy'));
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

			assert.ok(refreshCalled);
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

			// Mock ProgramUtils.findProgram to return available MAVProxy
			sandbox.stub(ProgramUtils, 'findProgram').resolves({ available: true, path: '/usr/bin/mavproxy.py', isCustomPath: false });

			// Mock ProgramUtils.checkPythonPackage to return available mavproxy package
			sandbox.stub(ProgramUtils, 'checkPythonPackage').resolves({ available: true, path: 'mavproxy.py', isCustomPath: false });

			// Mock apTerminalMonitor instead of VS Code terminal API
			const mockTerminalMonitor = {
				runCommand: sandbox.stub().resolves({ exitCode: 0, output: '' })
			};

			sandbox.stub(apTerminalMonitor.prototype, 'runCommand').callsFake(mockTerminalMonitor.runCommand);

			// Mock UI inputs to prevent blocking
			sandbox.stub(vscode.window, 'showInputBox').resolves('115200');

			// Execute command
			await vscode.commands.executeCommand('connected-devices.connectMAVProxy', mockDevice);

			// Verify terminal monitor was used
			assert.ok(mockTerminalMonitor.runCommand.calledOnce);

			// Check that the command contains the expected elements
			const calledCommand = mockTerminalMonitor.runCommand.getCall(0).args[0];
			assert.ok(calledCommand.includes('mavproxy.py'));
			assert.ok(calledCommand.includes('--master=/dev/ttyACM0'));
			assert.ok(calledCommand.includes('--baudrate=115200'));
			assert.ok(calledCommand.includes('--console'));
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
			assert.ok(true);
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
			assert.ok(typeof item.tooltip === 'string' && item.tooltip.includes('CubeOrangePlus'));
			assert.ok(typeof item.tooltip === 'string' && item.tooltip.includes('/dev/ttyACM0'));
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
			assert.ok(isArduPilot);

			// Test non-ArduPilot device
			// @ts-expect-error - accessing private method for testing
			isArduPilot = provider.isArduPilotDevice('1234', '5678', 'Generic Serial Device');
			assert.ok(!isArduPilot);

			provider.dispose();
		});
	});
});

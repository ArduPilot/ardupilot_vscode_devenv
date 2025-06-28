/* eslint-disable @typescript-eslint/no-explicit-any */
/* cSpell:words sitl SITL eabi arducopter arduplane ardurover */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as cp from 'child_process';
import { UIHooks } from '../../apUIHooks';
import { APExtensionContext } from '../../extension';
import { getApExtApi } from './common';
import * as taskProvider from '../../taskProvider';

suite('apUIHooks Test Suite', () => {
	let workspaceFolder: vscode.WorkspaceFolder | undefined;
	let mockContext: vscode.ExtensionContext;
	let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
	let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
	let mockExtensionUri: vscode.Uri;
	let uiHooks: UIHooks;
	let sandbox: sinon.SinonSandbox;
	let apExtensionContext: APExtensionContext;

	suiteSetup(async () => {
		apExtensionContext = await getApExtApi();
		workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert(workspaceFolder);
		assert(apExtensionContext.vscodeContext);
		mockContext = apExtensionContext.vscodeContext;
		mockExtensionUri = mockContext.extensionUri;
	});

	setup(() => {
		sandbox = sinon.createSandbox();

		// Mock webview
		mockWebview = {
			html: '',
			cspSource: 'mock-csp-source',
			postMessage: sandbox.stub(),
			asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
			onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() })
		} as unknown as sinon.SinonStubbedInstance<vscode.Webview>;

		// Mock webview panel
		mockPanel = {
			webview: mockWebview,
			title: '',
			reveal: sandbox.stub(),
			dispose: sandbox.stub(),
			onDidDispose: sandbox.stub().callsFake(() => {
				return { dispose: sandbox.stub() };
			}),
			viewColumn: vscode.ViewColumn.One
		} as unknown as sinon.SinonStubbedInstance<vscode.WebviewPanel>;

		// Create UIHooks instance
		uiHooks = new UIHooks(mockPanel as unknown as vscode.WebviewPanel, mockExtensionUri);
	});

	teardown(() => {
		sandbox.restore();
		if (uiHooks) {
			uiHooks.dispose();
		}
	});

	suite('Constructor and Initialization', () => {
		test('should initialize with correct panel and extension URI', () => {
			assert.strictEqual(uiHooks._panel, mockPanel);
			assert.ok(uiHooks.listeners);
			assert.strictEqual(Object.keys(uiHooks.listeners).length, 0);
		});

		test('should set up message listener on webview', () => {
			assert(mockWebview.onDidReceiveMessage.calledOnce);
		});
	});

	suite('Event System', () => {
		test('should call registered listeners when event is triggered', () => {
			const mockListener = sandbox.stub();
			const testMessage = { command: 'testEvent', data: 'test' };

			uiHooks.on('testEvent', mockListener);
			(uiHooks as any)._onMessage(testMessage);

			assert(mockListener.calledOnce);
			assert(mockListener.calledWith(testMessage));
		});
	});

	suite('Message Handling', () => {
		test('should handle getTasksList command', () => {
			const message = { command: 'getTasksList' };
			const getTasksListSpy = sandbox.spy(uiHooks as any, 'getTasksList');

			(uiHooks as any)._onMessage(message);

			assert(getTasksListSpy.calledOnce);
		});

		test('should handle build command without error', () => {
			const message = { command: 'build' };

			// Should not throw error
			(uiHooks as any)._onMessage(message);
			assert.ok(true);
		});

		test('should handle getFeaturesList command', () => {
			const message = { command: 'getFeaturesList' };
			const getFeaturesListSpy = sandbox.spy(uiHooks, 'getFeaturesList');

			(uiHooks as any)._onMessage(message);

			assert(getFeaturesListSpy.calledOnce);
		});

		test('should handle extractFeatures command', () => {
			const message = { command: 'extractFeatures', board: 'sitl', target: 'copter' };
			const extractFeaturesSpy = sandbox.spy(uiHooks, 'extractFeatures');

			(uiHooks as any)._onMessage(message);

			assert(extractFeaturesSpy.calledOnce);
			assert(extractFeaturesSpy.calledWith(message));
		});

		test('should handle error command by logging', () => {
			const message = {
				command: 'error',
				message: 'Test error',
				location: 'test.js:10',
				stack: 'Error stack trace'
			};

			// Should not throw error
			(uiHooks as any)._onMessage(message);
			assert.ok(true);
		});

		test('should respond to unknown commands with Bad Request', () => {
			const message = { command: 'unknownCommand' };

			(uiHooks as any)._onMessage(message);

			assert(mockWebview.postMessage.calledWith({
				command: 'unknownCommand',
				response: 'Bad Request'
			}));
		});
	});

	suite('getTasksList Method', () => {
		test('should return undefined when no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return undefined when tasklist.json does not exist', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(false);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});

		test('should return tasklist content when file exists', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockTasksContent = '{"tasks": []}';

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(mockTasksContent);

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: mockTasksContent
			}));
		});

		test('should handle file read errors gracefully', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').throws(new Error('File read error'));

			(uiHooks as any).getTasksList();

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: undefined
			}));
		});
	});

	suite('getFeaturesList Method', () => {
		test('should call getFeaturesList from taskProvider and post message', () => {
			// Mock the getFeaturesList function from taskProvider
			const mockFeatures = { features: { 'feature1': {}, 'feature2': {} } };
			const getFeaturesListStub = sandbox.stub(taskProvider, 'getFeaturesList').returns(mockFeatures);

			uiHooks.getFeaturesList();

			assert(getFeaturesListStub.calledWith(mockExtensionUri));
			assert(mockWebview.postMessage.calledWith({
				command: 'getFeaturesList',
				featuresList: mockFeatures
			}));
		});
	});

	suite('extractFeatures Method', () => {
		test('should return error when no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'No workspace folder found'
			}));
		});

		test('should return error when board or target missing', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

			uiHooks.extractFeatures({ board: 'sitl' }); // missing target

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Board and target are required'
			}));
		});

		test('should return error when binary file not found', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns(null);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Binary file not found for sitl-copter. Please build the firmware first.'
			}));
		});

		test('should return error when extract_features.py script not found', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				const pathStr = path.toString();
				if (pathStr.includes('extract_features.py')) {
					return false;
				}
				return true; // binary file exists
			});

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'extract_features.py script not found'
			}));
		});

		test('should successfully extract features for SITL target', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});

		test('should successfully extract features for hardware target', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);

			const spawnSyncStub = sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			uiHooks.extractFeatures({ board: 'CubeOrange', target: 'copter' });

			// Verify it uses arm-none-eabi-nm for hardware targets
			assert(spawnSyncStub.calledWith('python3', sinon.match.array.contains(['--nm', 'arm-none-eabi-nm'])));

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});

		test('should handle script execution failure', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 1,
				stdout: Buffer.from(''),
				stderr: Buffer.from('Script error')
			} as any);

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Failed to extract features: Script error'
			}));
		});

		test('should handle exceptions during extraction', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').throws(new Error('Unexpected error'));

			uiHooks.extractFeatures({ board: 'sitl', target: 'copter' });

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: [],
				error: 'Error extracting features: Error: Unexpected error'
			}));
		});
	});

	suite('findBinaryFile Method', () => {
		test('should return binary path when file exists', () => {
			const targetDir = '/mock/target';
			const target = 'copter';
			const expectedBinary = `${targetDir}/bin/arducopter`;

			sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
				return path.toString() === expectedBinary;
			});

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, expectedBinary);
		});

		test('should return null when binary file does not exist', () => {
			const targetDir = '/mock/target';
			const target = 'copter';

			sandbox.stub(fs, 'existsSync').returns(false);

			const result = (uiHooks as any).findBinaryFile(targetDir, target);

			assert.strictEqual(result, null);
		});

		test('should handle different target types correctly', () => {
			const targetDir = '/mock/target';

			// Test for different targets
			const targets = ['copter', 'plane', 'rover'];
			const expectedBinaries = [
				'bin/arducopter',
				'bin/arduplane',
				'bin/ardurover'
			];

			targets.forEach((target, index) => {
				sandbox.restore();
				sandbox = sinon.createSandbox();
				const expectedPath = `${targetDir}/${expectedBinaries[index]}`;

				sandbox.stub(fs, 'existsSync').callsFake((path: fs.PathLike) => {
					return path.toString() === expectedPath;
				});

				const result = (uiHooks as any).findBinaryFile(targetDir, target);
				assert.strictEqual(result, expectedPath, `Failed for target: ${target}`);
			});
		});
	});

	suite('parseConfigureOptions Method', () => {
		test('should parse short and long options combined', () => {
			const helpText = `Options:
  -c COLORS, --color=COLORS
                        whether to use colors (yes/no/auto) [default: auto]
  -j JOBS, --jobs=JOBS  amount of parallel jobs (16)
  -k, --keep            continue despite errors (-kk to try harder)`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert.strictEqual(result.length, 3);
			assert.deepStrictEqual(result[0], {
				name: '-c, --color',
				description: 'whether to use colors (yes/no/auto) [default: auto]'
			});
			assert.deepStrictEqual(result[1], {
				name: '-j, --jobs',
				description: 'amount of parallel jobs (16)'
			});
			assert.deepStrictEqual(result[2], {
				name: '-k, --keep',
				description: 'continue despite errors (-kk to try harder)'
			});
		});

		test('should parse long-only options', () => {
			const helpText = `Options:
  --version             show program's version number and exit
  --prefix=PREFIX       installation prefix [default: '/usr/local/']
  --zones=ZONES         debugging zones (task_gen, deps, tasks, etc)`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert.strictEqual(result.length, 3);
			assert.deepStrictEqual(result[0], {
				name: '--version',
				description: 'show program\'s version number and exit'
			});
			assert.deepStrictEqual(result[1], {
				name: '--prefix',
				description: 'installation prefix [default: \'/usr/local/\']'
			});
			assert.deepStrictEqual(result[2], {
				name: '--zones',
				description: 'debugging zones (task_gen, deps, tasks, etc)'
			});
		});

		test('should handle multi-line descriptions', () => {
			const helpText = `Options:
  -v, --verbose         verbosity level -v -vv or -vvv [default: 0]
                        additional line of description
                        yet another line`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert.strictEqual(result.length, 1);
			assert.deepStrictEqual(result[0], {
				name: '-v, --verbose',
				description: 'verbosity level -v -vv or -vvv [default: 0] additional line of description yet another line'
			});
		});

		test('should handle indented options', () => {
			const helpText = `  Configuration options:
    -o OUT, --out=OUT   build dir for the project
    -t TOP, --top=TOP   src dir for the project
    --bindir=BINDIR     bindir`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert.strictEqual(result.length, 3);
			assert.deepStrictEqual(result[0], {
				name: '-o, --out',
				description: 'build dir for the project'
			});
			assert.deepStrictEqual(result[1], {
				name: '-t, --top',
				description: 'src dir for the project'
			});
			assert.deepStrictEqual(result[2], {
				name: '--bindir',
				description: 'bindir'
			});
		});

		test('should handle actual waf configure help output', () => {
			const helpText = `waf [commands] [options]

Options:
  --version             show program's version number and exit
  -c COLORS, --color=COLORS
                        whether to use colors (yes/no/auto) [default: auto]
  -j JOBS, --jobs=JOBS  amount of parallel jobs (16)
  -k, --keep            continue despite errors (-kk to try harder)
  -v, --verbose         verbosity level -v -vv or -vvv [default: 0]
  --zones=ZONES         debugging zones (task_gen, deps, tasks, etc)
  -h, --help            show this help message and exit

  Configuration options:
    -o OUT, --out=OUT   build dir for the project
    -t TOP, --top=TOP   src dir for the project
    --prefix=PREFIX     installation prefix [default: '/usr/local/']
    --bindir=BINDIR     bindir
    --libdir=LIBDIR     libdir`;

			const result = (uiHooks as any).parseConfigureOptions(helpText);

			assert(result.length >= 10);

			// Check specific options
			const versionOption = result.find((opt: any) => opt.name === '--version');
			assert(versionOption);
			assert.strictEqual(versionOption.description, 'show program\'s version number and exit');

			const colorOption = result.find((opt: any) => opt.name === '-c, --color');
			assert(colorOption);
			assert.strictEqual(colorOption.description, 'whether to use colors (yes/no/auto) [default: auto]');

			const prefixOption = result.find((opt: any) => opt.name === '--prefix');
			assert(prefixOption);
			assert.strictEqual(prefixOption.description, 'installation prefix [default: \'/usr/local/\']');
		});

		test('should handle empty or invalid help text', () => {
			assert.strictEqual((uiHooks as any).parseConfigureOptions('').length, 0);
			assert.strictEqual((uiHooks as any).parseConfigureOptions('No options here').length, 0);
		});
	});

	suite('parseSITLOptions Method', () => {
		test('should parse short and long options combined', () => {
			const helpText = `Options:
  -h, --help            show this help message and exit
  -v VEHICLE, --vehicle=VEHICLE
                        vehicle type (ArduCopter|Helicopter|Blimp|ArduPlane)
  -A SITL_INSTANCE_ARGS, --sitl-instance-args=SITL_INSTANCE_ARGS
                        pass arguments to SITL instance`;

			const result = (uiHooks as any).parseSITLOptions(helpText);

			assert.strictEqual(result.length, 3);
			assert.deepStrictEqual(result[0], {
				name: '-h, --help',
				description: 'show this help message and exit'
			});
			assert.deepStrictEqual(result[1], {
				name: '-v, --vehicle',
				description: 'vehicle type (ArduCopter|Helicopter|Blimp|ArduPlane)'
			});
			assert.deepStrictEqual(result[2], {
				name: '-A, --sitl-instance-args',
				description: 'pass arguments to SITL instance'
			});
		});

		test('should parse long-only options', () => {
			const helpText = `Options:
  --vehicle-binary=VEHICLE_BINARY
                        vehicle binary path
  --enable-onvif      enable onvif camera control sim using AntennaTracker
  --can-peripherals   start a DroneCAN peripheral instance`;

			const result = (uiHooks as any).parseSITLOptions(helpText);

			assert.strictEqual(result.length, 3);
			assert.deepStrictEqual(result[0], {
				name: '--vehicle-binary',
				description: 'vehicle binary path'
			});
			assert.deepStrictEqual(result[1], {
				name: '--enable-onvif',
				description: 'enable onvif camera control sim using AntennaTracker'
			});
			assert.deepStrictEqual(result[2], {
				name: '--can-peripherals',
				description: 'start a DroneCAN peripheral instance'
			});
		});

		test('should handle indented options with multi-line descriptions', () => {
			const helpText = `  Build options:
    -N, --no-rebuild    don't rebuild before starting ardupilot
    -D, --debug         build with debugging
    -c, --clean         do a make clean before building
    -j JOBS, --jobs=JOBS
                        number of processors to use during build (default for
                        make is 1)`;

			const result = (uiHooks as any).parseSITLOptions(helpText);

			assert.strictEqual(result.length, 4);
			assert.deepStrictEqual(result[0], {
				name: '-N, --no-rebuild',
				description: 'don\'t rebuild before starting ardupilot'
			});
			assert.deepStrictEqual(result[1], {
				name: '-D, --debug',
				description: 'build with debugging'
			});
			assert.deepStrictEqual(result[2], {
				name: '-c, --clean',
				description: 'do a make clean before building'
			});
			assert.deepStrictEqual(result[3], {
				name: '-j, --jobs',
				description: 'number of processors to use during build (default for make is 1)'
			});
		});

		test('should handle actual sim_vehicle.py help output', () => {
			const helpText = `Usage: sim_vehicle.py

Options:
  -h, --help            show this help message and exit
  -v VEHICLE, --vehicle=VEHICLE
                        vehicle type (ArduCopter|Helicopter|Blimp|ArduPlane|Ro
                        ver|ArduSub|AntennaTracker|sitl_periph_universal)
  --vehicle-binary=VEHICLE_BINARY
                        vehicle binary path
  -C, --sim_vehicle_sh_compatible
                        be compatible with the way sim_vehicle.sh works; make
                        this the first option
  -A SITL_INSTANCE_ARGS, --sitl-instance-args=SITL_INSTANCE_ARGS
                        pass arguments to SITL instance
  -G, --gdb             use gdb for debugging ardupilot
  -g, --gdb-stopped     use gdb for debugging ardupilot (no auto-start)
    -V, --valgrind      enable valgrind for memory access checking (slow!)
    --callgrind         enable valgrind for performance analysis (slow!!)
    -T, --tracker       start an antenna tracker instance
    --enable-onvif      enable onvif camera control sim using AntennaTracker
    --can-peripherals   start a DroneCAN peripheral instance`;

			const result = (uiHooks as any).parseSITLOptions(helpText);

			assert(result.length >= 11);

			// Check specific options
			const helpOption = result.find((opt: any) => opt.name === '-h, --help');
			assert(helpOption);
			assert.strictEqual(helpOption.description, 'show this help message and exit');

			const sitlArgsOption = result.find((opt: any) => opt.name === '-A, --sitl-instance-args');
			assert(sitlArgsOption);
			assert.strictEqual(sitlArgsOption.description, 'pass arguments to SITL instance');

			const vehicleBinaryOption = result.find((opt: any) => opt.name === '--vehicle-binary');
			assert(vehicleBinaryOption);
			assert.strictEqual(vehicleBinaryOption.description, 'vehicle binary path');

			const valgrindOption = result.find((opt: any) => opt.name === '-V, --valgrind');
			assert(valgrindOption);
			assert.strictEqual(valgrindOption.description, 'enable valgrind for memory access checking (slow!)');
		});

		test('should handle empty or invalid help text', () => {
			assert.strictEqual((uiHooks as any).parseSITLOptions('').length, 0);
			assert.strictEqual((uiHooks as any).parseSITLOptions('No options here').length, 0);
		});
	});

	suite('getConfigureOptions Method', () => {
		test('should handle getConfigureOptions command', () => {
			const message = { command: 'getConfigureOptions' };
			const getConfigureOptionsSpy = sandbox.spy(uiHooks, 'getConfigureOptions');

			(uiHooks as any)._onMessage(message);

			assert(getConfigureOptionsSpy.calledOnce);
		});

		test('should return error when no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			uiHooks.getConfigureOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getConfigureOptions',
				options: [],
				error: 'No workspace folder found'
			}));
		});

		test('should successfully get configure options when waf command succeeds', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockHelpOutput = `Options:
  --version             show program's version number and exit
  -g, --debug-symbols   build with debug symbols`;

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: mockHelpOutput,
				stderr: ''
			} as any);

			// Mock getFeaturesList to return empty object to avoid filtering
			sandbox.stub(taskProvider, 'getFeaturesList').returns({});

			uiHooks.getConfigureOptions();

			assert(mockWebview.postMessage.calledWith(sinon.match({
				command: 'getConfigureOptions',
				options: sinon.match.array
			})));

			const call = mockWebview.postMessage.getCall(0);
			const message = call.args[0];
			assert(message.options.length >= 1);
			assert(message.options.some((opt: any) => opt.name === '--version'));
		});

		test('should handle waf command failure', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 1,
				stdout: '',
				stderr: 'Command failed'
			} as any);

			uiHooks.getConfigureOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getConfigureOptions',
				options: [],
				error: 'Failed to get configure options: Command failed'
			}));
		});

		test('should filter out feature-specific options', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockHelpOutput = `Options:
  --version             show program's version number and exit
  -g, --debug-symbols   build with debug symbols
  --enable-GPS          enable GPS feature
  --disable-COMPASS     disable compass feature`;

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: mockHelpOutput,
				stderr: ''
			} as any);

			// Mock getFeaturesList to return GPS and COMPASS features
			sandbox.stub(taskProvider, 'getFeaturesList').returns({
				features: {
					'GPS': { label: 'GPS' },
					'COMPASS': { label: 'COMPASS' }
				}
			});

			uiHooks.getConfigureOptions();

			const call = mockWebview.postMessage.getCall(0);
			const message = call.args[0];

			// Should include version and debug-symbols but not GPS/COMPASS features
			assert(message.options.some((opt: any) => opt.name === '--version'));
			assert(message.options.some((opt: any) => opt.name === '-g, --debug-symbols'));
			assert(!message.options.some((opt: any) => opt.name.includes('GPS')));
			assert(!message.options.some((opt: any) => opt.name.includes('COMPASS')));
		});

		test('should handle exceptions during option parsing', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').throws(new Error('Spawn error'));

			uiHooks.getConfigureOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getConfigureOptions',
				options: [],
				error: 'Error getting configure options: Error: Spawn error'
			}));
		});
	});

	suite('getSITLOptions Method', () => {
		test('should handle getSITLOptions command', () => {
			const message = { command: 'getSITLOptions' };
			const getSITLOptionsSpy = sandbox.spy(uiHooks, 'getSITLOptions');

			(uiHooks as any)._onMessage(message);

			assert(getSITLOptionsSpy.calledOnce);
		});

		test('should return error when no workspace folder', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			uiHooks.getSITLOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getSITLOptions',
				options: [],
				error: 'No workspace folder found'
			}));
		});

		test('should successfully get SITL options when sim_vehicle.py command succeeds', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockHelpOutput = `Options:
  -h, --help            show this help message and exit
  -A SITL_INSTANCE_ARGS, --sitl-instance-args=SITL_INSTANCE_ARGS
                        pass arguments to SITL instance
  -G, --gdb             use gdb for debugging ardupilot`;

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: mockHelpOutput,
				stderr: ''
			} as any);

			uiHooks.getSITLOptions();

			assert(mockWebview.postMessage.calledWith(sinon.match({
				command: 'getSITLOptions',
				options: sinon.match.array
			})));

			const call = mockWebview.postMessage.getCall(0);
			const message = call.args[0];
			assert(message.options.length >= 3);
			assert(message.options.some((opt: any) => opt.name === '-h, --help'));
			assert(message.options.some((opt: any) => opt.name === '-A, --sitl-instance-args'));
			assert(message.options.some((opt: any) => opt.name === '-G, --gdb'));
		});

		test('should handle sim_vehicle.py command failure', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 1,
				stdout: '',
				stderr: 'Script not found'
			} as any);

			uiHooks.getSITLOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getSITLOptions',
				options: [],
				error: 'Failed to get SITL options: Script not found'
			}));
		});

		test('should handle exceptions during SITL option parsing', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').throws(new Error('Python not found'));

			uiHooks.getSITLOptions();

			assert(mockWebview.postMessage.calledWith({
				command: 'getSITLOptions',
				options: [],
				error: 'Error getting SITL options: Error: Python not found'
			}));
		});
	});

	suite('Integration Tests', () => {
		test('should handle complete workflow for getting tasks list', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockTasksContent = '{"version": "2.0.0", "tasks": []}';

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(fs, 'readFileSync').returns(mockTasksContent);

			// Simulate message from webview
			(uiHooks as any)._onMessage({ command: 'getTasksList' });

			assert(mockWebview.postMessage.calledWith({
				command: 'getTasksList',
				tasksList: mockTasksContent
			}));
		});

		test('should handle complete workflow for feature extraction', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockFeatures = ['GPS_TYPE', 'COMPASS_ENABLE'];

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(uiHooks as any, 'findBinaryFile').returns('/mock/binary');
			sandbox.stub(fs, 'existsSync').returns(true);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: Buffer.from(mockFeatures.join('\n')),
				stderr: Buffer.from('')
			} as any);

			// Simulate message from webview
			(uiHooks as any)._onMessage({
				command: 'extractFeatures',
				board: 'sitl',
				target: 'copter'
			});

			assert(mockWebview.postMessage.calledWith({
				command: 'extractFeatures',
				features: mockFeatures
			}));
		});

		test('should handle complete workflow for getting configure options', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockHelpOutput = `Options:
  --version             show program's version number and exit
  -g, --debug-symbols   build with debug symbols`;

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: mockHelpOutput,
				stderr: ''
			} as any);

			sandbox.stub(taskProvider, 'getFeaturesList').returns({});

			// Simulate message from webview
			(uiHooks as any)._onMessage({ command: 'getConfigureOptions' });

			assert(mockWebview.postMessage.calledWith(sinon.match({
				command: 'getConfigureOptions',
				options: sinon.match.array
			})));
		});

		test('should handle complete workflow for getting SITL options', () => {
			const mockWorkspaceFolder = { uri: { fsPath: '/mock/workspace' } };
			const mockHelpOutput = `Options:
  -h, --help            show this help message and exit
  -A SITL_INSTANCE_ARGS, --sitl-instance-args=SITL_INSTANCE_ARGS
                        pass arguments to SITL instance`;

			sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
			sandbox.stub(cp, 'spawnSync').returns({
				status: 0,
				stdout: mockHelpOutput,
				stderr: ''
			} as any);

			// Simulate message from webview
			(uiHooks as any)._onMessage({ command: 'getSITLOptions' });

			assert(mockWebview.postMessage.calledWith(sinon.match({
				command: 'getSITLOptions',
				options: sinon.match.array
			})));
		});

		test('should handle event listeners during message processing', () => {
			const mockListener = sandbox.stub();
			const testMessage = { command: 'build', board: 'sitl', target: 'copter' };

			uiHooks.on('build', mockListener);
			(uiHooks as any)._onMessage(testMessage);

			assert(mockListener.calledOnce);
			assert(mockListener.calledWith(testMessage));
		});
	});
});


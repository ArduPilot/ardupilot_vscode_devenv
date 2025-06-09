import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { APExtensionContext } from '../../extension';

let apExtensionContext: APExtensionContext | undefined;

export async function getApExtApi(): Promise<APExtensionContext> {
	const extension: vscode.Extension<any> | undefined = vscode.extensions.getExtension('ardupilot-org.ardupilot-devenv');
	if (!extension) {
		throw new Error('ArduPilot extension is not active');
	}
	if (apExtensionContext === undefined) {
		apExtensionContext = await extension.activate();
		if (!apExtensionContext) {
			throw new Error('Failed to activate ArduPilot extension');
		}
		await apExtensionContext.active;
	}
	if (!apExtensionContext || !apExtensionContext.active) {
		throw new Error('ArduPilot extension is not active');
	}
	return apExtensionContext;
}

/**
 * Clean ArduPilot build directory using ./waf disclean
 * @param ardupilotPath Path to the ArduPilot directory
 */
export async function commandLineClean(ardupilotPath: string): Promise<void> {
	console.log('Cleaning existing builds...');

	await new Promise<void>((resolve) => {
		const cleanProcess = spawn('./waf', ['disclean'], {
			cwd: ardupilotPath,
			stdio: 'pipe'
		});

		cleanProcess.stdout?.on('data', (data) => {
			console.log(`[CLEAN STDOUT] ${data.toString()}`);
		});

		cleanProcess.stderr?.on('data', (data) => {
			console.log(`[CLEAN STDERR] ${data.toString()}`);
		});

		cleanProcess.on('close', (code: number | null) => {
			if (code === 0) {
				console.log('Build clean completed successfully');
				resolve();
			} else {
				console.log(`Build clean exited with code ${code} (this may be normal if no builds exist)`);
				resolve(); // Don't fail if clean fails - might be no builds to clean
			}
		});

		cleanProcess.on('error', (err: Error) => {
			console.log(`Clean error: ${err.message} (this may be normal if no builds exist)`);
			resolve(); // Don't fail if clean fails
		});
	});

	// Check build directory is cleaned or remove it if it exists
	const buildPath = path.join(ardupilotPath, 'build');
	if (fs.existsSync(buildPath)) {
		console.log('Build directory exists after clean, removing it manually...');
		fs.rmSync(buildPath, { recursive: true, force: true });
	}
}

/**
 * Build ArduPilot targets for specified board and vehicle combinations
 * @param ardupilotPath Path to the ArduPilot directory
 * @param targets Array of build targets, each containing board and vehicle
 */
export async function commandLineBuild(ardupilotPath: string, targets: { board: string; vehicle: string }[]): Promise<void> {
	for (const target of targets) {
		console.log(`Building ${target.board} target for ${target.vehicle}...`);

		// Configure the board
		await new Promise<void>((resolve, reject) => {
			const configProcess = spawn('./waf', ['configure', '--board', target.board], {
				cwd: ardupilotPath,
				stdio: 'pipe'
			});

			configProcess.stdout?.on('data', (data) => {
				console.log(`[${target.board.toUpperCase()} CONFIG STDOUT] ${data.toString()}`);
			});

			configProcess.stderr?.on('data', (data) => {
				console.log(`[${target.board.toUpperCase()} CONFIG STDERR] ${data.toString()}`);
			});

			configProcess.on('close', (code: number | null) => {
				if (code === 0) {
					console.log(`${target.board} configuration completed successfully`);
					resolve();
				} else {
					reject(new Error(`${target.board} configuration failed with code ${code}`));
				}
			});

			configProcess.on('error', (err: Error) => {
				reject(new Error(`${target.board} configuration error: ${err.message}`));
			});
		});

		// Build the vehicle
		await new Promise<void>((resolve, reject) => {
			const buildProcess = spawn('./waf', [target.vehicle], {
				cwd: ardupilotPath,
				stdio: 'pipe'
			});

			buildProcess.stdout?.on('data', (data) => {
				console.log(`[${target.board.toUpperCase()} BUILD STDOUT] ${data.toString()}`);
			});

			buildProcess.stderr?.on('data', (data) => {
				console.log(`[${target.board.toUpperCase()} BUILD STDERR] ${data.toString()}`);
			});

			buildProcess.on('close', (code: number | null) => {
				if (code === 0) {
					console.log(`${target.board} build completed successfully`);
					resolve();
				} else {
					reject(new Error(`${target.board} build failed with code ${code}`));
				}
			});

			buildProcess.on('error', (err: Error) => {
				reject(new Error(`${target.board} build error: ${err.message}`));
			});
		});
	}
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { APExtensionContext } from '../../extension';

let apExtensionContext: APExtensionContext | undefined;

export async function getApExtApi(): Promise<APExtensionContext> {
	const extension: vscode.Extension<APExtensionContext> | undefined = vscode.extensions.getExtension('ardupilot-org.ardupilot-devenv');
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

/**
 * DEBUG: Detects if running in WSL environment
 */
export function isWSL(): boolean {
	try {
		return fs.existsSync('/proc/version') &&
			fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
	} catch {
		return false;
	}
}

/**
 * DEBUG: Gets appropriate timeout for the current environment
 * WSL2 environments get longer timeouts due to performance characteristics
 */
export function getEnvironmentTimeout(baseTimeout: number): number {
	if (isWSL()) {
		console.log(`DEBUG: WSL detected, using extended timeout: ${baseTimeout * 2}ms`);
		return baseTimeout * 2;
	}
	console.log(`DEBUG: Standard environment, using base timeout: ${baseTimeout}ms`);
	return baseTimeout;
}

/**
 * DEBUG: Waits for a condition to be met with polling, instead of fixed timeout
 */
export async function waitForCondition(
	condition: () => boolean,
	description: string,
	maxWaitMs: number = 2000,
	pollIntervalMs: number = 100
): Promise<void> {
	const startTime = Date.now();
	console.log(`DEBUG: Waiting for condition: ${description}`);
	while (Date.now() - startTime < maxWaitMs) {
		if (condition()) {
			const elapsed = Date.now() - startTime;
			console.log(`DEBUG: Condition met after ${elapsed}ms: ${description}`);
			return;
		}
		await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
	}
	const elapsed = Date.now() - startTime;
	console.log(`DEBUG: Condition timeout after ${elapsed}ms: ${description}`);
	throw new Error(`Timeout waiting for condition: ${description}`);
}

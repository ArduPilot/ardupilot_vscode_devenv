/*
 * Common utilities for the ArduPilot VS Code extension
 *
 * This module provides shared functionality including error handling decorators
 * and other utility functions used throughout the extension.
 */

import * as vscode from 'vscode';
import { apLog } from './apLog';

/*
 * Configuration options for the FireAndForget decorator
 */
export interface FireAndForgetOptions {
    apLog: apLog;           // Logger instance for error reporting
    showErrorPopup?: boolean; // Whether to show VS Code error popup (default: true)
}

/*
 * Wrapper function that automatically catches and logs errors from async methods
 * and executes them in fire-and-forget mode (returns void)
 *
 * Features:
 * - Catches both synchronous and asynchronous errors
 * - Logs full error stack trace from the failed method
 * - Logs call site stack trace showing where the method was invoked
 * - Optionally shows VS Code error message popup
 * - Returns void to eliminate floating promise warnings
 *
 * @param methodName Name of the method for logging context
 * @param options Configuration object with apLog instance and popup settings
 * @param fn The async function to wrap with error handling
 * @returns Wrapped function that returns void
 */
export function withFireAndForget<T extends (...args: unknown[]) => Promise<unknown>>(
	methodName: string,
	options: FireAndForgetOptions,
	fn: T
): (...args: Parameters<T>) => void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return function (this: any, ...args: unknown[]): void {
		// Capture the call stack from where this method was invoked
		const callSiteError = new Error();
		const callSiteStack = callSiteError.stack || 'No call site stack available';

		// Execute the promise but don't return it (fire-and-forget)
		void fn.apply(this, args).catch((error: unknown) => {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : 'No error stack available';

			// Log full error details including both stacks
			const logMessage = `Error in ${methodName}(): ${errorMessage}\n` +
				`Error stack: ${errorStack}\n` +
				`Call site stack: ${callSiteStack}`;
			options.apLog.log(logMessage);

			// Show popup if enabled (default behavior)
			const shouldShowErrorPopup = options.showErrorPopup !== false;
			if (shouldShowErrorPopup) {
				const userMessage = `Error: ${errorMessage}`;
				void vscode.window.showErrorMessage(userMessage, 'View Logs').then(selection => {
					if (selection === 'View Logs') {
						apLog.channel.show();
					}
				});
			}
		});
	};
}

/*
 * TypeScript experimental decorator for fire-and-forget async method execution
 *
 * Uses TypeScript's experimental decorators for compatibility with existing codebase.
 * Requires experimentalDecorators: true in tsconfig.json
 *
 * This decorator transforms async methods to return void, eliminating floating promise
 * warnings while providing comprehensive error handling and logging including both
 * error stack trace and call site stack trace for better debugging.
 *
 * @param options Configuration object with apLog instance and popup settings
 * @returns Method decorator function
 */
export function FireAndForget(options: FireAndForgetOptions) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor | void {
		const originalMethod = descriptor.value;

		if (!originalMethod) {
			return;
		}

		descriptor.value = withFireAndForget(propertyKey, options, originalMethod);
		return descriptor;
	};
}

/*
 * Convenience function to execute an inline async function in fire-and-forget mode
 *
 * This allows you to wrap and immediately execute async code without decorators,
 * perfect for inline async operations.
 *
 * @param methodName Name for logging context
 * @param options Configuration object with apLog instance and popup settings
 * @param asyncFn The async function to execute immediately
 */
export function fireAndForget<T extends (...args: unknown[]) => Promise<unknown>>(
	methodName: string,
	options: FireAndForgetOptions,
	asyncFn: T
): (...args: Parameters<T>) => void {
	return withFireAndForget(methodName, options, asyncFn);
}

/*
 * Determines if a target is a vehicle target that requires upload functionality
 *
 * Vehicle targets are main ArduPilot vehicles that can be uploaded to hardware.
 * Non-vehicle targets like AP_Periph, bootloaders, and iofirmware do not need upload tasks.
 *
 * @param target The target name to check (e.g., 'copter', 'plane', 'AP_Periph')
 * @returns true if the target is a vehicle target that needs upload functionality
 */
export function isVehicleTarget(target: string): boolean {
	// Vehicle targets that need upload functionality
	const vehicleTargets = ['copter', 'plane', 'rover', 'sub', 'blimp', 'heli', 'antennatracker'];

	return vehicleTargets.includes(target);
}

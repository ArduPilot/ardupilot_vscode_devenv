import * as vscode from 'vscode';
import { APExtensionContext } from '../../extension';

export async function getApExtApi(): Promise<APExtensionContext> {
	const extension: vscode.Extension<any> | undefined = vscode.extensions.getExtension('ardupilot-org.ardupilot-devenv');
	if (!extension) {
		throw new Error('ArduPilot extension is not active');
	}
	const apExtensionContext = await extension.activate();
	await apExtensionContext.active;
	if (!apExtensionContext || !apExtensionContext.active) {
		throw new Error('ArduPilot extension is not active');
	}
	return apExtensionContext;
}

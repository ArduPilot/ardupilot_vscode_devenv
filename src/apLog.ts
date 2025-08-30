// create a logging stream using vscode output channel

import * as vscode from 'vscode';

export class apLog {
	private name: string;

	constructor(name: string) {
		this.name = name;
	}

	private static _channel: vscode.OutputChannel;
	public static get channel(): vscode.OutputChannel {
		if (!apLog._channel) {
			apLog._channel = vscode.window.createOutputChannel('ArduPilot');
		}
		return apLog._channel;
	}

	public log(message: string): void {
		apLog.channel.appendLine(`<${this?.name ?? 'unknown'}> ${message}`);
	}
}

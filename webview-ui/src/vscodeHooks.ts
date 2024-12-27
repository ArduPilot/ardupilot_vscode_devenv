import { cpuUsage } from 'process';

export class VSCodeHooks {
	private static _instance: VSCodeHooks;
	private _vscode: any;

	private constructor() {
		console.info('VSCodeHooks constructor');
		// get the vscode api
		this._vscode = acquireVsCodeApi();
	}

	public static getInstance(): VSCodeHooks {
		if (!VSCodeHooks._instance) {
			VSCodeHooks._instance = new VSCodeHooks();
		}
		return VSCodeHooks._instance;
	}

	// get tasks list
	public async request(command: string): Promise<any> {
		return new Promise((resolve, reject) => {
			this._vscode.postMessage({ command: command });
			window.addEventListener('message', (event) => {
				const message = event.data;
				if (message.command === command && message.response !== 'Failed') {
					resolve(message);
				} else if (message.command === command && message.response === 'Failed') {
					console.error(`Bad Request: ${command}`);
					reject(message);
				}
			});
		});
	}

	// post message to vscode
	public postMessage(command: string, data: any) {
		data.command = command;
		this._vscode.postMessage(data);
	}
}
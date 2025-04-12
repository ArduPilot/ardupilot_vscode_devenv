/*
	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

interface WebviewApi {
    postMessage: (message: unknown) => void;
}

interface VSCodeMessage {
    command: string;
    response?: string;
    [key: string]: unknown;
}

export class VSCodeHooks {
    private static _instance: VSCodeHooks;
    private _vscode: WebviewApi;

    private constructor() {
        console.info('VSCodeHooks constructor');
        this._vscode = acquireVsCodeApi();
    }

    public static getInstance(): VSCodeHooks {
        if (!VSCodeHooks._instance) {
            VSCodeHooks._instance = new VSCodeHooks();
        }
        return VSCodeHooks._instance;
    }

    public async request(command: string): Promise<VSCodeMessage> {
        return new Promise((resolve, reject) => {
            this._vscode.postMessage({ command });
            window.addEventListener('message', (event: MessageEvent<VSCodeMessage>) => {
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

    public postMessage(command: string, data: Record<string, unknown>): void {
        this._vscode.postMessage({ ...data, command });
    }
}
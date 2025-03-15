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
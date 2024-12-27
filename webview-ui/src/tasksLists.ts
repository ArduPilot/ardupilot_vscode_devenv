
export class TasksList {
    private static _instance: TasksList;
    private _tasklist: any;
    private _boards: any;
    private _boardTargets: { [board: string]: string[] } = {};

    private constructor(taskList: string) {
        console.info(`Loading tasklist`);
        this._tasklist = JSON.parse(taskList);
        this.loadTargets();
    }

    // load targets from the tasklist.json file
    public loadTargets() {
        // get list of boards
        this._boards = this._tasklist.map((task: any) => task.configure);
		// create a json list of boards
		const boardsList = JSON.stringify(this._boards);
		this._boards.sort((a: string, b: string) => {
			if (a.startsWith('Cube') && !b.startsWith('Cube')) {
				return -1;
			}
			if (!a.startsWith('Cube') && b.startsWith('Cube')) {
				return 1;
			}
			return a.localeCompare(b);
		});

        // get list of targets by board
        for (const task of this._tasklist) {
			this._boardTargets[task.configure] = task.targets;
		}
    }

    public getBoards(): string[] {
        return this._boards;
    }

    public getTargets(board: string): string[] {
        return this._boardTargets[board];
    }

    public static getInstance(tasksListRaw: string): TasksList {
        if (!TasksList._instance) {
            TasksList._instance = new TasksList(tasksListRaw);
        }
        return TasksList._instance;
    }
}
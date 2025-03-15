interface Task {
    configure: string;
    targets: string[];
}

export class TasksList {
    private static _instance: TasksList;
    private _tasklist: Task[];
    private _boards: string[];
    private _boardTargets: { [board: string]: string[] } = {};

    private constructor(taskList: string) {
        console.info(`Loading tasklist`);
        this._tasklist = JSON.parse(taskList);
        this.loadTargets();
    }

    public loadTargets() {
        this._boards = this._tasklist.map((task: Task) => task.configure);
        
        this._boards.sort((a: string, b: string) => {
            if (a.startsWith('Cube') && !b.startsWith('Cube')) {
                return -1;
            }
            if (!a.startsWith('Cube') && b.startsWith('Cube')) {
                return 1;
            }
            return a.localeCompare(b);
        });

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
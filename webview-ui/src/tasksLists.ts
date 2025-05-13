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

interface Task {
    configure: string;
    targets: string[];
}

interface RecentSelectionCache {
    boards: { [board: string]: number }; // board name to timestamp
    targets: { [target: string]: number }; // target name to timestamp
}

export class TasksList {
    private static _instance: TasksList;
    private _tasklist: Task[];
    private _boards: string[] = [];
    private _boardTargets: { [board: string]: string[] } = {};
    private _recentSelections: RecentSelectionCache = { boards: {}, targets: {} };

    private constructor(taskList: string) {
        console.info(`Loading tasklist`);
        if (taskList === undefined) {
            // throw error saying failed to load Ardupilot task list
            console.error('Failed to load Ardupilot task list');
            throw new Error(`Failed to load Ardupilot task list
    * Ensure ardupilot project is in the workspace
    * "./waf generate_tasklist" is executable
    * Validate Environment is clear`);
        } else {
            this._tasklist = JSON.parse(taskList);
        }
        this._loadRecentSelectionsCache();
        this.loadTargets();
    }

    private _loadRecentSelectionsCache(): void {
        try {
            const cachedData = localStorage.getItem('ardupilot-recent-selections');
            if (cachedData) {
                this._recentSelections = JSON.parse(cachedData);
            } else {
                this._recentSelections = { boards: {}, targets: {} };
            }
        } catch (e) {
            console.error('Failed to load cached selections', e);
            this._recentSelections = { boards: {}, targets: {} };
        }
    }

    private _saveRecentSelectionsCache(): void {
        try {
            localStorage.setItem('ardupilot-recent-selections', JSON.stringify(this._recentSelections));
        } catch (e) {
            console.error('Failed to save cached selections', e);
        }
    }

    public updateRecentBoard(board: string): void {
        this._recentSelections.boards[board] = Date.now();
        this._saveRecentSelectionsCache();
    }

    public updateRecentTarget(target: string): void {
        this._recentSelections.targets[target] = Date.now();
        this._saveRecentSelectionsCache();
    }

    public loadTargets() {
        this._boards = this._tasklist.map((task: Task) => task.configure);

        // Sort boards: recent selections first, then Cube boards, then alphabetical
        this._boards.sort((a: string, b: string) => {
            // First check if either is in recent selections
            const aRecent = this._recentSelections.boards[a] || 0;
            const bRecent = this._recentSelections.boards[b] || 0;

            // If both have recent timestamps, sort by most recent
            if (aRecent && bRecent) {
                return bRecent - aRecent; // More recent (higher timestamp) comes first
            }

            // If only one is recent, prioritize it
            if (aRecent) return -1;
            if (bRecent) return 1;

            // Fall back to the original sorting (Cube boards first, then alphabetical)
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
        // Check if the board exists in the boardTargets
        if (!this._boardTargets[board] || !Array.isArray(this._boardTargets[board])) {
            console.warn(`No targets found for board: ${board}`);
            return [];
        }

        const targets = [...this._boardTargets[board]];

        // Sort targets: recent selections first, then alphabetical
        targets.sort((a: string, b: string) => {
            // First check if either is in recent selections
            const aRecent = this._recentSelections.targets[a] || 0;
            const bRecent = this._recentSelections.targets[b] || 0;

            // If both have recent timestamps, sort by most recent
            if (aRecent && bRecent) {
                return bRecent - aRecent; // More recent (higher timestamp) comes first
            }

            // If only one is recent, prioritize it
            if (aRecent) return -1;
            if (bRecent) return 1;

            // Fall back to alphabetical sorting
            return a.localeCompare(b);
        });

        return targets;
    }

    public static getInstance(tasksListRaw: string): TasksList {
        if (!TasksList._instance) {
            TasksList._instance = new TasksList(tasksListRaw);
        }
        return TasksList._instance;
    }
}
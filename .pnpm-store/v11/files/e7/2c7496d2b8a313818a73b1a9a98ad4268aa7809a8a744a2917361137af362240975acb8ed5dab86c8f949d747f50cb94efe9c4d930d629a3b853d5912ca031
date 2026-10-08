"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedRunningTask = void 0;
class SharedRunningTask {
    constructor(runningTasksService, taskId) {
        this.runningTasksService = runningTasksService;
        this.exitCallbacks = [];
        this.detached = false;
        this.waitForTaskToFinish(taskId).then(() => {
            if (this.detached) {
                return;
            }
            // notify exit callbacks
            this.exitCallbacks.forEach((cb) => cb(0));
        });
    }
    async getResults() {
        throw new Error('Results cannot be retrieved from a shared task');
    }
    // Detaches from the shared task; the owning process keeps running it.
    kill() {
        if (this.detached) {
            return;
        }
        this.detached = true;
        this.exitCallbacks.forEach((cb) => cb(0));
        this.exitCallbacks = [];
    }
    onExit(cb) {
        this.exitCallbacks.push(cb);
    }
    async waitForTaskToFinish(taskId) {
        console.log(`Waiting for ${taskId} in another nx process`);
        // wait for the running task to finish
        do {
            await new Promise((resolve) => setTimeout(resolve, 100));
        } while (!this.detached &&
            this.runningTasksService.getRunningTasks([taskId]).length);
    }
}
exports.SharedRunningTask = SharedRunningTask;

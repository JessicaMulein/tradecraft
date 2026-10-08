import type { NxJsonConfiguration } from '../config/nx-json';
import { Task, TaskGraph } from '../config/task-graph';
import { LifeCycle, TaskResult } from './life-cycle';
import type { ProjectGraph } from '../config/project-graph';
import { RunningTask } from './running-tasks/running-task';
export declare function runDiscreteTasks(tasks: Task[], projectGraph: ProjectGraph, fullTaskGraph: TaskGraph, nxJson: NxJsonConfiguration, lifeCycle: LifeCycle): Promise<Array<Promise<TaskResult[]>>>;
export declare function runContinuousTasks(tasks: Task[], projectGraph: ProjectGraph, fullTaskGraph: TaskGraph, nxJson: NxJsonConfiguration, lifeCycle: LifeCycle): Promise<Record<string, Promise<RunningTask>>>;

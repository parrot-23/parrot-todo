// 任务类型（kind）：任务 / 习惯 / 目标作为任务的类型标签，数据仍存储在板块中。
import type { PrototypeTask, TaskKind } from '../datatypes/prototype-task';

/** 读取任务类型（旧任务无 kind 字段时视为普通任务） */
export function getTaskKind(task: PrototypeTask): TaskKind {
    return task.kind ?? 'task';
}

/** 按类型筛选任务，并保留祖先任务，确保任务树层级完整 */
export function filterTasksByKind(tasks: PrototypeTask[], kind: TaskKind): PrototypeTask[] {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const keep = new Set<string>();
    for (const task of tasks) {
        if (getTaskKind(task) !== kind) continue;
        let current: PrototypeTask | undefined = task;
        while (current && !keep.has(current.id)) {
            keep.add(current.id);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
    }
    return tasks.filter((task) => keep.has(task.id));
}

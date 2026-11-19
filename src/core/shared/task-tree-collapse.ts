// 任务树展开/折叠状态：按根任务分别记忆，仅保存在内存中，插件重启后恢复为全部展开。
const collapsedByRoot = new Map<string, Set<string>>();

/** 取根任务对应的折叠集合（无根任务时统一归入默认集合） */
function bucket(rootTaskId: string | undefined): Set<string> {
    const key = rootTaskId ?? '';
    let set = collapsedByRoot.get(key);
    if (!set) {
        set = new Set<string>();
        collapsedByRoot.set(key, set);
    }
    return set;
}

/** 任务在其所在根任务树中是否处于折叠状态 */
export function isTreeTaskCollapsed(rootTaskId: string | undefined, taskId: string): boolean {
    return bucket(rootTaskId).has(taskId);
}

/** 切换折叠状态，返回切换后是否为折叠 */
export function toggleTreeTaskCollapsed(rootTaskId: string | undefined, taskId: string): boolean {
    const set = bucket(rootTaskId);
    if (set.has(taskId)) {
        set.delete(taskId);
        return false;
    }
    set.add(taskId);
    return true;
}

/** 展开任务（新增子任务后保证新条目可见） */
export function expandTreeTask(rootTaskId: string | undefined, taskId: string): void {
    bucket(rootTaskId).delete(taskId);
}

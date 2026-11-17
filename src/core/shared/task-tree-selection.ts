// 任务树共享选中状态：任务详情面板与计划年度面板共用同一个选中任务，
// 切换功能面板二级菜单时两侧左侧任务树的选中条目保持一致。
import type { PrototypeTask } from '../datatypes/prototype-task';

/** 选中变化监听 */
type TreeSelectionListener = (taskId: string | undefined) => void;

let selectedTaskId: string | undefined;
const listeners = new Set<TreeSelectionListener>();

/** 当前共享选中的任务 id */
export function getTreeSelectedTaskId(): string | undefined {
    return selectedTaskId;
}

/** 更新共享选中的任务（值未变化时不分发，避免面板之间互相触发） */
export function setTreeSelectedTaskId(taskId: string | undefined): void {
    if (taskId === selectedTaskId) return;
    selectedTaskId = taskId;
    for (const listener of Array.from(listeners)) listener(taskId);
}

/** 订阅共享选中变化，返回取消订阅函数 */
export function onTreeSelectionChange(listener: TreeSelectionListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 任务所在的根任务 id（沿 parentId 向上查找，找不到时返回自身） */
export function findRootTaskId(tasks: PrototypeTask[], taskId: string): string | undefined {
    let current = tasks.find((task) => task.id === taskId);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        const parent = tasks.find((task) => task.id === current?.parentId);
        if (!parent) break;
        current = parent;
    }
    return current?.id;
}

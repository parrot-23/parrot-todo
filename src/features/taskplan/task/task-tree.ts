// 任务树公共组件：四个任务面板共用同一套行渲染、展开/折叠与点击选中逻辑，
// 差异（行末尾图标、点击行为、长按拖动、空态文案等）通过参数注入。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { isTreeTaskCollapsed, toggleTreeTaskCollapsed } from '../../../core/shared/task-tree-collapse';

/** 任务树每层缩进像素（与行 marginLeft 一致） */
export const TREE_DEPTH_INDENT = 14;

/** 任务树配置 */
export interface TaskTreeOptions {
    /** 任务数据源 */
    getTasks: () => PrototypeTask[];
    /** 当前根任务 id（同时作为展开/折叠状态的记忆维度） */
    getRootId: () => string | undefined;
    /** 是否渲染根任务自身，默认 true（任务选择面板只渲染后代） */
    showRoot?: boolean;
    /** 追加到任务行上的类名（如计划年度面板的行高样式） */
    rowClass?: string;
    /** 任务是否处于选中态 */
    isSelected?: (task: PrototypeTask) => boolean;
    /** 行末尾追加内容（目标数量 / 状态按钮 / 习惯图标等） */
    renderTrailing?: (row: HTMLElement, task: PrototypeTask) => void;
    /** 点击任务行 */
    onRowClick?: (task: PrototypeTask) => void;
    /** 行按下（用于长按拖动等） */
    onRowPointerDown?: (evt: MouseEvent, task: PrototypeTask, row: HTMLElement) => void;
    /** 展开/折叠后回调（如计划年度面板重绘泳道） */
    onToggle?: (task: PrototypeTask, collapsed: boolean) => void;
}

/** 任务树：渲染到调用方容器，滚动由容器自身负责 */
export class TaskTree {
    /** 任务树容器（调用方创建，组件只负责填充行） */
    readonly el: HTMLElement;

    constructor(el: HTMLElement, private readonly options: TaskTreeOptions) {
        this.el = el;
        el.addEventListener('click', this.handleClick);
    }

    /** 渲染整棵树（从根任务开始，含根任务自身） */
    render(): void {
        this.el.empty();
        const tasks = this.options.getTasks();
        const rootId = this.options.getRootId();
        const rootTask = rootId ? tasks.find((task) => task.id === rootId) : undefined;
        if (!rootTask) return;
        if (this.options.showRoot === false) {
            this.renderChildren(rootTask.id, 0, tasks);
            return;
        }
        this.renderRow(rootTask, 0, tasks);
        this.renderChildren(rootTask.id, 1, tasks);
    }

    /** 平铺渲染（搜索结果为扁平列表，不提供展开/折叠） */
    renderFlat(entries: Array<{ task: PrototypeTask; label: string }>): void {
        this.el.empty();
        const tasks = this.options.getTasks();
        for (const entry of entries) {
            this.renderRow(entry.task, 0, tasks, entry.label, true);
        }
    }

    /** 按当前选中状态刷新所有行的选中样式 */
    refreshSelection(): void {
        const tasks = this.options.getTasks();
        this.el.querySelectorAll<HTMLElement>('.task-detail-tree-row').forEach((row) => {
            const task = tasks.find((item) => item.id === row.dataset.taskId);
            row.toggleClass('is-selected', !!task && !!this.options.isSelected?.(task));
        });
    }

    /** 递归渲染某一层的子任务（父级折叠时整段跳过） */
    private renderChildren(parentId: string, depth: number, tasks: PrototypeTask[]): void {
        if (isTreeTaskCollapsed(this.options.getRootId(), parentId)) return;
        for (const child of tasks.filter((task) => task.parentId === parentId)) {
            this.renderRow(child, depth, tasks);
            this.renderChildren(child.id, depth + 1, tasks);
        }
    }

    /** 渲染单条任务行 */
    private renderRow(
        task: PrototypeTask,
        depth: number,
        tasks: PrototypeTask[],
        label?: string,
        flat = false,
    ): void {
        const base = this.options.rowClass
            ? `task-detail-tree-row ${this.options.rowClass}`
            : 'task-detail-tree-row';
        const row = this.el.createDiv({ cls: base });
        row.style.marginLeft = `${depth * TREE_DEPTH_INDENT}px`;
        row.dataset.taskId = task.id;
        row.dataset.depth = String(depth);
        row.toggleClass('is-selected', !!this.options.isSelected?.(task));
        const iconEl = row.createSpan({ cls: 'task-detail-tree-icon' });
        if (!flat) this.renderCollapseIcon(iconEl, task, tasks);
        row.createSpan({ cls: 'task-detail-tree-label', text: label ?? task.name });
        this.options.renderTrailing?.(row, task);
        if (this.options.onRowPointerDown) {
            row.addEventListener('mousedown', (evt) => this.options.onRowPointerDown?.(evt, task, row));
        }
    }

    /** 左侧图标：有子任务时可点击展开/折叠，无子任务时不显示（保留占位） */
    private renderCollapseIcon(iconEl: HTMLElement, task: PrototypeTask, tasks: PrototypeTask[]): void {
        const hasChildren = tasks.some((item) => item.parentId === task.id);
        if (!hasChildren) return;
        const collapsed = isTreeTaskCollapsed(this.options.getRootId(), task.id);
        setIcon(iconEl, collapsed ? 'chevron-right' : 'chevron-down');
        iconEl.addClass('is-toggle');
        // 阻止冒泡：避免触发行的长按拖动与选中
        iconEl.addEventListener('mousedown', (evt) => evt.stopPropagation());
        iconEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const next = toggleTreeTaskCollapsed(this.options.getRootId(), task.id);
            this.render();
            this.options.onToggle?.(task, next);
        });
    }

    /** 点击任务行（事件委托，重绘后无需重新绑定） */
    private readonly handleClick = (evt: MouseEvent): void => {
        const row = (evt.target as HTMLElement).closest<HTMLElement>('.task-detail-tree-row');
        const taskId = row?.dataset.taskId;
        if (!taskId) return;
        const task = this.options.getTasks().find((item) => item.id === taskId);
        if (task) this.options.onRowClick?.(task);
    };
}

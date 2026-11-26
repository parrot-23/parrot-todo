// 任务树公共组件：四个任务面板共用同一套行渲染、展开/折叠与点击选中逻辑，
// 差异（行末尾图标、点击行为、长按拖动、空态文案等）通过参数注入。
import { Notice, setIcon } from 'obsidian';

import type { TaskStatus } from '../../../core/datatypes/domain';
import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { t } from '../../../core/i18n';
import { getTaskKind } from '../../../core/shared/task-kind';
import { isTreeTaskCollapsed, toggleTreeTaskCollapsed } from '../../../core/shared/task-tree-collapse';
import { applyThemeColors, getCurrentThemeColors } from '../../../theme/theme-colors';

/** 任务树每层缩进像素（与行 marginLeft 一致） */
export const TREE_DEPTH_INDENT = 14;

/** 任务状态对应的图标 */
const STATUS_ICONS: Record<TaskStatus, string> = {
    notStarted: 'circle',
    inProgress: 'play',
    done: 'check-circle',
    paused: 'pause',
};

/** 状态下拉列表的选项（图标 + 文案） */
const STATUS_OPTIONS: {
    value: TaskStatus;
    icon: string;
    labelKey: 'taskPlan.statusNotStarted' | 'taskPlan.statusInProgress' | 'taskPlan.statusDone' | 'taskPlan.statusPaused';
}[] = [
    { value: 'notStarted', icon: 'circle', labelKey: 'taskPlan.statusNotStarted' },
    { value: 'inProgress', icon: 'play', labelKey: 'taskPlan.statusInProgress' },
    { value: 'done', icon: 'check-circle', labelKey: 'taskPlan.statusDone' },
    { value: 'paused', icon: 'pause', labelKey: 'taskPlan.statusPaused' },
];

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
    /** 是否使用内置任务状态控件（行尾状态图标 + 状态下拉菜单），开启后替代 renderTrailing */
    statusControl?: boolean;
    /** 状态变更后回调（由调用方保存数据并重绘） */
    onStatusChange?: (task: PrototypeTask) => void;
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
    /** 状态下拉菜单（挂在 body 上） */
    private statusMenuEl: HTMLElement | null = null;

    /** 点击下拉列表外关闭 */
    private readonly onStatusMenuOutside = (evt: MouseEvent): void => {
        const target = evt.target;
        if (!(target instanceof Element)) return;
        if (this.statusMenuEl?.contains(target)) return;
        // 点击状态图标自身不关闭，交由图标点击逻辑重新打开
        if (target.closest('.plan-annual-status-btn')) return;
        this.closeStatusMenu();
    };

    private readonly onStatusMenuKeyDown = (evt: KeyboardEvent): void => {
        if (evt.key === 'Escape') this.closeStatusMenu();
    };

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
        row.setCssStyles({ marginLeft: `${depth * TREE_DEPTH_INDENT}px` });
        row.dataset.taskId = task.id;
        row.dataset.depth = String(depth);
        row.toggleClass('is-selected', !!this.options.isSelected?.(task));
        const iconEl = row.createSpan({ cls: 'task-detail-tree-icon' });
        if (!flat) this.renderCollapseIcon(iconEl, task, tasks);
        row.createSpan({ cls: 'task-detail-tree-label', text: label ?? task.name });
        if (this.options.statusControl) this.renderStatus(row, task);
        else this.options.renderTrailing?.(row, task);
        if (this.options.onRowPointerDown) {
            row.addEventListener('mousedown', (evt) => this.options.onRowPointerDown?.(evt, task, row));
        }
    }

    /** 行末尾状态控件：目标 / 习惯显示类型图标，其余显示三态状态图标（点击弹菜单） */
    private renderStatus(row: HTMLElement, task: PrototypeTask): void {
        const kind = getTaskKind(task);
        const statusEl = row.createSpan({ cls: 'plan-tree-status-icon' });
        if (kind === 'goal' || kind === 'habit') {
            // 类型图标仅作标识：始终可见，点击不弹出状态下拉面板
            setIcon(statusEl, kind === 'goal' ? 'target' : 'repeat');
            return;
        }
        // 所有状态（含未开始）都绘制状态图标；未开始的图标仅在选中任务时显示
        const current = task.status ?? 'notStarted';
        statusEl.addClass('plan-annual-status-btn');
        statusEl.toggleClass('is-not-started', current === 'notStarted');
        setIcon(statusEl, STATUS_ICONS[current]);
        statusEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.openStatusMenu(statusEl, task);
        });
    }

    /** 打开状态下拉列表（挂在 body 上，贴在图标下方；选择后更新任务状态） */
    private openStatusMenu(anchorEl: HTMLElement, task: PrototypeTask): void {
        this.closeStatusMenu();
        const menu = document.body.createDiv({ cls: 'plan-annual-status-menu' });
        applyThemeColors(menu, getCurrentThemeColors());
        this.statusMenuEl = menu;
        const current = task.status ?? 'notStarted';
        for (const option of STATUS_OPTIONS) {
            const item = menu.createDiv({ cls: 'plan-annual-status-item' });
            item.toggleClass('is-active', option.value === current);
            setIcon(item.createSpan({ cls: 'plan-annual-status-item-icon' }), option.icon);
            item.createSpan({ cls: 'plan-annual-status-item-text', text: t(option.labelKey) });
            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                task.status = option.value;
                this.closeStatusMenu();
                // 标记为已完成时，若仍有未完成的子任务则提示（不阻止操作）
                if (option.value === 'done') this.notifyUnfinishedChildren(task);
                this.options.onStatusChange?.(task);
            });
        }
        // 贴在图标下方，右侧空间不足时向左收敛
        const rect = anchorEl.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const top = rect.bottom + height > window.innerHeight - 8
            ? Math.max(8, rect.top - height - 4)
            : rect.bottom + 4;
        menu.setCssStyles({ left: `${left}px`, top: `${top}px` });
        document.addEventListener('mousedown', this.onStatusMenuOutside, true);
        document.addEventListener('keydown', this.onStatusMenuKeyDown);
    }

    /** 标记为已完成时，统计未完成的子任务（含所有后代）并提示 */
    private notifyUnfinishedChildren(task: PrototypeTask): void {
        const tasks = this.options.getTasks();
        let count = 0;
        const walk = (parentId: string): void => {
            for (const child of tasks) {
                if (child.parentId !== parentId) continue;
                if ((child.status ?? 'notStarted') !== 'done') count += 1;
                walk(child.id);
            }
        };
        walk(task.id);
        if (count === 0) return;
        new Notice(t('taskPlan.statusDoneWithUnfinishedChildren', { name: task.name, count }));
    }

    /** 关闭状态下拉列表（宿主面板关闭时需调用） */    closeStatusMenu(): void {
        document.removeEventListener('mousedown', this.onStatusMenuOutside, true);
        document.removeEventListener('keydown', this.onStatusMenuKeyDown);
        this.statusMenuEl?.remove();
        this.statusMenuEl = null;
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

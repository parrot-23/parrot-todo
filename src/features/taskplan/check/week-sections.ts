// 「一周」视图的公共区块：习惯表格 + 时长去向。
// 检查面板（一周）与统计面板（习惯 / 时长去向）共用，避免两处重复实现。

import { setIcon } from 'obsidian';

import { renderDayTasks, type DayTaskState } from '../../../charts/primitives/day-tasks';
import { renderHBars } from '../../../charts/primitives/hbar';
import type { PrototypeTask, TaskHabit } from '../../../core/datatypes/prototype-task';
import { t, getWeekDays } from '../../../core/i18n';
import type { PlanAssignmentRepo } from '../../../core/repos/plan-assignment-repo';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
import { makeDayKeyFromWeek } from '../../../core/shared/plan-data';
import { getTaskHabit } from '../../../core/shared/task-sections';
import { findRootTaskId } from '../../../core/shared/task-tree-selection';

/** 「一周」视图区块的数据上下文 */
export interface WeekSectionContext {
    /** 当前查看的周键 */
    weekKey: string;
    /** 分类定义（颜色与名称） */
    categories: PlanCategoryData['categories'];
    /** 原型任务数据源 */
    getTasks: () => PrototypeTask[];
    /** 任务执行记录仓库 */
    taskExecutionRepo: TaskExecutionRepo;
    /** 点击任务行（习惯 / 当天任务表格）时的回调 */
    onTaskClick?: (taskId: string) => void;
}

/** 已删除任务的归并键（记录保留但任务已不存在） */
const DELETED_ROOT_TASK_ID = '__deleted_root_task__';

/** 当天任务表格的数据上下文（在 WeekSectionContext 上补充计划排布仓库） */
export interface DayTasksContext extends WeekSectionContext {
    /** 计划排布仓库（某天已排布任务的来源） */
    planAssignmentRepo: PlanAssignmentRepo;
}

/** 一周当天任务表格：行 = 本周出现过的任务，列 = 周一至周日 */
export function renderDayTasksTable(container: HTMLElement, ctx: DayTasksContext): void {
    const weekDays = getWeekDays();
    const tasksById = new Map(ctx.getTasks().map((task) => [task.id, task]));

    // 行顺序：任务在本周首次出现的顺序（周一到周日，按排布 / 额外任务顺序）
    const order: string[] = [];
    const plannedDays = new Map<string, Set<number>>();
    const extraIds = new Set<string>();
    for (let day = 1; day <= 7; day++) {
        const dayKey = makeDayKeyFromWeek(ctx.weekKey, day);
        const assigned = ctx.planAssignmentRepo.dayAssignments(ctx.weekKey, day).map((item) => item.taskId);
        const extras = ctx.taskExecutionRepo.extraTaskIds(dayKey);
        for (const id of assigned.concat(extras)) {
            if (!plannedDays.has(id)) {
                plannedDays.set(id, new Set());
                order.push(id);
            }
            plannedDays.get(id)!.add(day);
        }
        for (const id of extras) extraIds.add(id);
    }

    const rows = order.map((id) => {
        const planned = plannedDays.get(id) ?? new Set<number>();
        const days: DayTaskState[] = [];
        let doneCount = 0;
        for (let day = 1; day <= 7; day++) {
            // 当天没有安排该任务：占位，不计入完成情况
            if (!planned.has(day)) {
                days.push('off');
                continue;
            }
            const done = ctx.taskExecutionRepo.isTaskCompleted(makeDayKeyFromWeek(ctx.weekKey, day), id);
            if (done) doneCount++;
            days.push(done ? 'done' : 'pending');
        }
        return {
            id,
            label: tasksById.get(id)?.name ?? t('panel.checkRecordsUnknownTask'),
            // 完成天数 / 本周安排天数
            summary: `${doneCount} / ${planned.size}`,
            extra: extraIds.has(id),
            days,
        };
    });

    const dayLabels = weekDays.map((name, index) => {
        const dayKey = makeDayKeyFromWeek(ctx.weekKey, index + 1);
        return { name, sub: `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}` };
    });

    renderDayTasks(container, rows, {
        nameLabel: t('panel.weekDayTaskName'),
        summaryLabel: t('panel.weekDayTaskDone'),
        dayLabels,
        emptyText: t('panel.weekDayTaskEmpty'),
        extraLabel: t('panel.weekDayTaskExtraTag'),
        onRowClick: ctx.onTaskClick,
    });
}

/** 一周习惯表格：习惯名称 + 完成情况 + 周一至周日是否完成 */
export function renderHabitsTable(container: HTMLElement, ctx: WeekSectionContext): void {
    // 当前启用的习惯（按时间、名称排序，与习惯面板顺序一致）
    const habits = ctx.getTasks()
        .map((task) => ({ task, habit: getTaskHabit(task) }))
        .filter((item): item is { task: PrototypeTask; habit: TaskHabit } => item.habit?.enabled === true)
        .sort((a, b) => a.habit.time.localeCompare(b.habit.time)
            || a.task.name.localeCompare(b.task.name));

    const table = container.createDiv({ cls: 'check-habit-table' });
    // 表头：习惯名称 + 完成情况 + 周一至周日（带日期）
    const head = table.createDiv({ cls: 'check-habit-row is-head' });
    head.createDiv({ cls: 'check-habit-cell is-name', text: t('interface.habit') });
    head.createDiv({ cls: 'check-habit-cell is-total', text: t('panel.checkHabitDone') });
    const weekDays = getWeekDays();
    for (let day = 1; day <= 7; day++) {
        const dayKey = makeDayKeyFromWeek(ctx.weekKey, day);
        const cell = head.createDiv({ cls: 'check-habit-cell is-day' });
        cell.createSpan({ cls: 'check-habit-day-name', text: weekDays[day - 1] });
        cell.createSpan({
            cls: 'check-habit-day-date',
            text: `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`,
        });
    }

    if (habits.length === 0) {
        table.createDiv({ cls: 'check-habit-empty', text: t('panel.checkHabitsEmpty') });
        return;
    }

    for (const { task, habit } of habits) {
        const row = table.createDiv({ cls: 'check-habit-row' });
        if (ctx.onTaskClick) {
            row.addClass('is-clickable');
            row.addEventListener('click', () => ctx.onTaskClick?.(task.id));
        }
        row.createDiv({ cls: 'check-habit-cell is-name', text: task.name });
        let doneCount = 0;
        // 第二列：本周完成天数 / 7（先占位，遍历完七天后再填值）
        const totalEl = row.createDiv({ cls: 'check-habit-cell is-total' });
        for (let day = 1; day <= 7; day++) {
            const cell = row.createDiv({ cls: 'check-habit-cell is-day' });
            // 习惯未生效的星期：显示占位符，不参与完成状态
            if (!habit.weekdays.includes(day)) {
                cell.addClass('is-off');
                cell.setText('—');
                continue;
            }
            const dayKey = makeDayKeyFromWeek(ctx.weekKey, day);
            const done = ctx.taskExecutionRepo.isTaskCompleted(dayKey, task.id);
            if (done) doneCount++;
            const mark = cell.createSpan({ cls: 'check-habit-mark' });
            mark.toggleClass('is-done', done);
            setIcon(mark, done ? 'circle-check-big' : 'circle');
        }
        totalEl.setText(`${doneCount} / 7`);
    }
}

/** 时长去向：一周分类执行时长横条（可展开到根任务） */
export function renderDurationFlow(
    container: HTMLElement,
    ctx: WeekSectionContext,
    expanded: Set<string>,
    rerender: () => void,
): void {
    const minutesByCatRoot = execMinutesByRootTaskCategory(ctx);
    const minutesByCat = new Map<string, number>();
    minutesByCatRoot.forEach((taskMinutes, catId) => {
        let sum = 0;
        taskMinutes.forEach((minutes) => { sum += minutes; });
        minutesByCat.set(catId, sum);
    });

    const wrap = container.createDiv({ cls: 'check-cat-bars' });
    wrap.createDiv({ cls: 'check-cat-bars-title', text: t('panel.checkDurationFlowTitle') });

    // 分类顺序与分类列表一致；数据中出现但分类已删除的 id 追加到末尾并标注未分类
    const knownIds = new Set(ctx.categories.map((cat) => cat.id));
    const extraIds = Array.from(minutesByCat.keys()).filter((id) => !knownIds.has(id));
    const rows = [
        ...ctx.categories.map((cat) => ({
            id: cat.id,
            label: cat.label,
            color: cat.color,
            minutes: minutesByCat.get(cat.id) ?? 0,
        })),
        ...extraIds.map((id) => ({
            id,
            label: t('inbox.noCategory'),
            color: '#888888',
            minutes: minutesByCat.get(id) ?? 0,
        })),
    ];
    const maxMinutes = Math.max(0, ...rows.map((row) => row.minutes));

    const taskNames = new Map(ctx.getTasks().map((task) => [task.id, task.name]));

    // 分类行与展开子行共用同一比例尺，保证父子横条长度可直接比较
    const rowEls = renderHBars(
        wrap,
        rows.map((row) => ({ label: row.label, value: row.minutes, color: row.color })),
        { scale: maxMinutes, formatValue: formatHours, rowInteractive: true },
    );

    rowEls.forEach((rowEl, index) => {
        const row = rows[index];
        const isExpanded = expanded.has(row.id);
        rowEl.toggleClass('is-expanded', isExpanded);
        // 箭头属于视图装饰：图元只负责行的视觉结构
        const chevron = rowEl.createSpan({ cls: 'check-cat-bars-chevron' });
        setIcon(chevron, isExpanded ? 'chevron-down' : 'chevron-right');
        rowEl.prepend(chevron);
        rowEl.addEventListener('click', () => {
            if (expanded.has(row.id)) expanded.delete(row.id);
            else expanded.add(row.id);
            rerender();
        });

        if (!isExpanded) return;
        // 展开：该分类下本周有时长的根任务（子任务时长已归并到根任务），按时长降序
        const taskMinutes = Array.from(minutesByCatRoot.get(row.id)?.entries() ?? [])
            .filter(([, minutes]) => minutes > 0)
            .sort((a, b) => b[1] - a[1]);
        if (taskMinutes.length === 0) {
            const emptyEl = wrap.createDiv({ cls: 'check-cat-bars-sub-empty', text: t('panel.checkDurationFlowEmpty') });
            rowEl.after(emptyEl);
            return;
        }
        const subWrap = wrap.createDiv({ cls: 'check-cat-bars-sub' });
        renderHBars(
            subWrap,
            taskMinutes.map(([taskId, minutes]) => ({
                // 任务已删除时记录仍保留，统一归并为一条「已删除任务」
                label: taskNames.get(taskId) ?? t('panel.checkRecordsUnknownTask'),
                value: minutes,
                color: row.color,
            })),
            { scale: maxMinutes, formatValue: formatHours, variant: 'small' },
        );
        rowEl.after(subWrap);
    });
}

/** 执行时长按「分类 → 根任务」两级汇总：子任务时长归并到所属根任务（跨午夜裁剪到本周） */
function execMinutesByRootTaskCategory(ctx: WeekSectionContext): Map<string, Map<string, number>> {
    const tasks = ctx.getTasks();
    const result = new Map<string, Map<string, number>>();
    const firstDayKey = makeDayKeyFromWeek(ctx.weekKey, 1);
    const [fy, fm, fd] = firstDayKey.split('-').map(Number);
    const weekStart = new Date(fy, fm - 1, fd).getTime();
    const weekEnd = weekStart + 7 * 24 * 3600000;
    for (const record of ctx.taskExecutionRepo.records) {
        const startMs = Math.max(weekStart, record.startAt);
        const endMs = Math.min(weekEnd, record.endAt);
        if (endMs <= startMs) continue;
        // 事项按根任务统计：子任务的执行时长归并到所属根任务
        const rootId = findRootTaskId(tasks, record.taskId);
        // 任务已删除：记录保留并统一归并到「已删除任务」，无分类信息
        const key = rootId ?? DELETED_ROOT_TASK_ID;
        const catId = rootId
            ? (categoryIdOf(ctx, rootId) ?? UNCATEGORIZED_CATEGORY_ID)
            : UNCATEGORIZED_CATEGORY_ID;
        const byTask = result.get(catId) ?? new Map<string, number>();
        byTask.set(key, (byTask.get(key) ?? 0) + (endMs - startMs) / 60000);
        result.set(catId, byTask);
    }
    return result;
}

/** 原型任务的分类 id */
function categoryIdOf(ctx: WeekSectionContext, taskId: string): string | undefined {
    return ctx.getTasks().find((task) => task.id === taskId)?.categoryId;
}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${(minutes / 60).toFixed(1)}h`;
}

/** 一天的任务记录卡片（与统计面板「任务记录」完全一致），返回当天是否有记录 */
export function renderDayRecordCard(
    container: HTMLElement,
    ctx: WeekSectionContext,
    dayKey: string,
    options: {
        showEmptyCard?: boolean;
        /** 点击删除按钮：由调用方弹出确认浮层，anchor 为按钮元素 */
        onDeleteRecord?: (recordId: string, anchor: HTMLElement) => void;
    } = {},
): boolean {
    const [year, month, date] = dayKey.split('-').map(Number);
    const dayStart = new Date(year, month - 1, date).getTime();
    const dayEnd = dayStart + 24 * 3600000;
    // 按开始时间归入当天，跨天记录只在起始日出现一次
    const records = ctx.taskExecutionRepo.records
        .filter((record) => record.startAt >= dayStart && record.startAt < dayEnd)
        .sort((a, b) => a.startAt - b.startAt);

    const weekDayIndex = (new Date(year, month - 1, date).getDay() + 6) % 7;
    const title = `${getWeekDays()[weekDayIndex]} ${month}/${date}`;

    // 当天没有记录：统计面板跳过该天；一日视图传 showEmptyCard 时仍显示空卡片
    if (records.length === 0) {
        if (!options.showEmptyCard) return false;
        const emptyCard = container.createDiv({ cls: 'check-records-card' });
        const emptyHead = emptyCard.createDiv({ cls: 'check-records-card-head' });
        emptyHead.createDiv({ cls: 'check-records-card-title', text: title });
        emptyCard.createDiv({ cls: 'check-records-empty', text: t('panel.checkRecordsEmpty') });
        return true;
    }

    const card = container.createDiv({ cls: 'check-records-card' });
    const head = card.createDiv({ cls: 'check-records-card-head' });
    head.createDiv({ cls: 'check-records-card-title', text: title });
    const copyBtn = head.createEl('button', {
        cls: 'check-records-card-copy',
        attr: { type: 'button', 'aria-label': t('panel.checkRecordsCopy') },
    });
    setIcon(copyBtn, 'copy');

    const tasks = ctx.getTasks();
    const items = card.createDiv({ cls: 'check-records-items' });
    // 复制到剪贴板的文本：卡片标题 + 每条记录 + 分类汇总
    const lines: string[] = [title];
    // 当天各分类累计时长（秒），用于卡片底部的分类汇总行
    const secondsByCategory = new Map<string, number>();
    for (const record of records) {
        const task = tasks.find((item) => item.id === record.taskId);
        // 全天习惯不显示具体时间点，统一显示「全天」
        const time = task && getTaskHabit(task)?.allDay === true
            ? t('panel.habitAllDay')
            : `${formatTimestamp(record.startAt)}-${formatTimestamp(record.endAt)}`;
        const name = task?.name ?? t('panel.checkRecordsUnknownTask');
        const duration = formatDurationSeconds(record.durationSeconds);
        const typeLabel = task
            ? (task.type === 'main' ? t('panel.mainTaskBadge') : t('panel.sideTaskBadge'))
            : '';
        const row = items.createDiv({ cls: 'check-records-item' });
        row.createSpan({ cls: 'check-records-item-time', text: time });
        // 任务名称前的分类色点（与卡片底部汇总行的色点一致）
        const category = ctx.categories.find((item) => item.id === task?.categoryId);
        row.createSpan({ cls: 'check-records-item-dot' }).setCssStyles({ background: category?.color ?? '#888888' });
        row.createSpan({ cls: 'check-records-item-name', text: name });
        row.createSpan({ cls: 'check-records-item-duration', text: duration });
        if (task) {
            row.createSpan({
                cls: `check-records-item-badge ${task.type === 'main' ? 'is-main' : 'is-side'}`,
                text: typeLabel,
            });
        }
        // 可删除模式：行尾删除按钮（悬浮时显示）
        if (options.onDeleteRecord) {
            const deleteBtn = row.createEl('button', {
                cls: 'check-records-item-delete',
                attr: { type: 'button', 'aria-label': t('panel.checkRecordsDelete') },
            });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                options.onDeleteRecord?.(record.id, deleteBtn);
            });
        }
        lines.push([time, name, duration, typeLabel].filter(Boolean).join(' '));
        const categoryId = task?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
        secondsByCategory.set(categoryId, (secondsByCategory.get(categoryId) ?? 0) + record.durationSeconds);
    }
    renderRecordCategorySummary(card, ctx, secondsByCategory, lines);
    copyBtn.addEventListener('click', () => void copyRecordCardText(copyBtn, lines));
    return true;
}

/** 卡片底部分类汇总行：分类标题 + 每个分类当天的累计时长（只列出有记录的分类） */
function renderRecordCategorySummary(
    card: HTMLElement,
    ctx: WeekSectionContext,
    secondsByCategory: Map<string, number>,
    lines: string[],
): void {
    const categories = ctx.categories;
    const knownIds = new Set(categories.map((category) => category.id));
    // 分类已删除 / 未设置分类的记录统一归入「未分类」
    const totals = new Map<string, number>();
    for (const [categoryId, seconds] of Array.from(secondsByCategory.entries())) {
        const targetId = knownIds.has(categoryId) ? categoryId : UNCATEGORIZED_CATEGORY_ID;
        totals.set(targetId, (totals.get(targetId) ?? 0) + seconds);
    }

    const summary = card.createDiv({ cls: 'check-records-summary' });
    summary.createSpan({ cls: 'check-records-summary-title', text: t('panel.checkRecordsCategory') });
    const itemsEl = summary.createDiv({ cls: 'check-records-summary-items' });
    // 与界面展示一致的文字，供右上角复制按钮使用
    const parts: string[] = [];

    // 按分类列表顺序输出，「未分类」排在最后
    for (const category of categories) {
        const seconds = totals.get(category.id) ?? 0;
        totals.delete(category.id);
        if (seconds > 0) {
            renderRecordCategoryItem(itemsEl, category.label, category.color ?? '#888888', seconds);
            parts.push(`${category.label} ${formatDurationSeconds(seconds)}`);
        }
    }
    const restSeconds = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    if (restSeconds > 0) {
        renderRecordCategoryItem(itemsEl, t('inbox.noCategory'), '#888888', restSeconds);
        parts.push(`${t('inbox.noCategory')} ${formatDurationSeconds(restSeconds)}`);
    }
    if (parts.length > 0) {
        lines.push(`${t('panel.checkRecordsCategory')}: ${parts.join('  ')}`);
    }
}

/** 分类汇总中的单项：色点 + 分类名 + 累计时长 */
function renderRecordCategoryItem(parentEl: HTMLElement, label: string, color: string, seconds: number): void {
    const item = parentEl.createDiv({ cls: 'check-records-summary-item' });
    item.createSpan({ cls: 'check-records-summary-dot' }).setCssStyles({ background: color });
    item.createSpan({ cls: 'check-records-summary-label', text: label });
    item.createSpan({ cls: 'check-records-summary-duration', text: formatDurationSeconds(seconds) });
}

/** 复制卡片内容到剪贴板（图标短暂切换为对勾作为反馈） */
async function copyRecordCardText(button: HTMLElement, lines: string[]): Promise<void> {
    try {
        await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
        return;
    }
    button.empty();
    setIcon(button, 'check');
    window.setTimeout(() => {
        if (!button.isConnected) return;
        button.empty();
        setIcon(button, 'copy');
    }, 1200);
}

/** 时间戳 → HH:MM */
function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 记录时长（秒）→「x分」/「x小时」/「x小时y分」 */
function formatDurationSeconds(seconds: number): string {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return t('interface.durationMinutes', { minutes: String(minutes) });
    if (minutes === 0) return t('interface.durationHours', { hours: String(hours) });
    return t('interface.durationHoursMinutes', { hours: String(hours), minutes: String(minutes) });
}

// 检查面板：基于 FloatingPanel，用于配置检查。
// 结构：顶部选项卡（时长去向 / 具体任务分析）；「统计」「任务记录」「计划vs对比」「习惯」已拆为独立面板（stats-panel.ts）。
// 时长去向：本周各分类时长（可展开到根任务），横向条共用同一比例尺。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import type { TaskExecutionRecord } from '../../../core/datatypes/task-execution';
import type { BarDatum } from '../../../charts/primitives/types';
import { renderBar } from '../../../charts/primitives/bar';
import { renderHBars } from '../../../charts/primitives/hbar';
import { t } from '../../../core/i18n';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_COLOR, UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
import { findRootTaskId } from '../../../core/shared/task-tree-selection';
import {
    getCurrentWeekKey,
    getISOWeek,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
    shiftWeekKey,
} from '../../../core/shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';

/** 检查面板配置 */
export interface CheckPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「检查」 */
    title?: string;
    /** 分类数据（颜色来源，与图例一致） */
    categoryData: PlanCategoryData;
    /** 任务执行记录仓库（时长去向的数据来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 原型任务数据源（用于按任务取分类颜色） */
    getTasks: () => PrototypeTask[];
}

/** 区间视图选项卡（一日 / 一周 / 一月 / 一季）：先占位，内容待实现 */
type CheckRangeTab = 'day' | 'week' | 'month' | 'quarter';

/** 区间视图选项卡的展示顺序 */
const RANGE_TAB_KEYS: CheckRangeTab[] = ['day', 'week', 'month', 'quarter'];

/** 顶部选项卡 */
type CheckTab = CheckRangeTab | 'durationFlow' | 'taskAnalysis';

/** 「时长去向」中已删除任务的归并键（记录保留但任务已不存在） */
const DELETED_ROOT_TASK_ID = '__deleted_root_task__';

/** 检查面板 */
export class CheckPanel extends FloatingPanel {
    private rangeTabEls!: Record<CheckRangeTab, HTMLElement>;
    private durationFlowTabEl!: HTMLElement;
    private taskAnalysisTabEl!: HTMLElement;
    /** 内容区容器 */
    private paneEl!: HTMLElement;
    /** 当前选项卡 */
    private tab: CheckTab = 'durationFlow';
    /** 时长去向当前查看的周键 */
    private weekKey: string = getCurrentWeekKey();
    /** 具体任务分析选中的任务 id（跨选项卡 / 重开保留） */
    private analyzedTaskId: string | undefined;

    /** 「时长去向」中已展开的分类（跨重渲染保持） */
    private durationFlowExpanded = new Set<string>();

    constructor(private readonly panelOptions: CheckPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.checkPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('check-panel');
        this.renderLayout();
    }

    private renderLayout(): void {
        const tabs = this.body.createDiv({ cls: 'plan-tabs' });
        // 区间视图（一日 / 一周 / 一月 / 一季）：先占位，页面内容暂为空
        const rangeTabs: { key: CheckRangeTab; label: string }[] = [
            { key: 'day', label: t('panel.checkRangeDay') },
            { key: 'week', label: t('panel.checkRangeWeek') },
            { key: 'month', label: t('panel.checkRangeMonth') },
            { key: 'quarter', label: t('panel.checkRangeQuarter') },
        ];
        this.rangeTabEls = {} as Record<CheckRangeTab, HTMLElement>;
        for (const item of rangeTabs) {
            const el = tabs.createDiv({ cls: 'plan-tab', text: item.label });
            el.addEventListener('click', () => this.switchTab(item.key));
            this.rangeTabEls[item.key] = el;
        }
        this.durationFlowTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkDurationFlow') });
        this.taskAnalysisTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkTaskAnalysis') });
        this.durationFlowTabEl.addEventListener('click', () => this.switchTab('durationFlow'));
        this.taskAnalysisTabEl.addEventListener('click', () => this.switchTab('taskAnalysis'));

        this.paneEl = this.body.createDiv({ cls: 'plan-pane' });
        this.switchTab(this.tab);
    }

    private switchTab(tab: CheckTab): void {
        this.tab = tab;
        for (const key of RANGE_TAB_KEYS) {
            this.rangeTabEls[key].toggleClass('is-active', tab === key);
        }
        this.durationFlowTabEl.toggleClass('is-active', tab === 'durationFlow');
        this.taskAnalysisTabEl.toggleClass('is-active', tab === 'taskAnalysis');
        this.renderPane();
    }

    private renderPane(): void {
        this.paneEl.empty();
        // 一日 / 一周 / 一月 / 一季：占位选项卡，页面内容暂为空
        if (this.tab === 'durationFlow') this.renderDurationFlow();
        if (this.tab === 'taskAnalysis') this.renderTaskAnalysis();
    }

    // ===== 时长去向：周数切换 + 一周分类执行时长横条（含各事项展开） =====
    private renderDurationFlow(): void {
        this.renderWeekNav();

        const minutesByCatRoot = this.execMinutesByRootTaskCategory();
        const minutesByCat = new Map<string, number>();
        minutesByCatRoot.forEach((taskMinutes, catId) => {
            let sum = 0;
            taskMinutes.forEach((minutes) => { sum += minutes; });
            minutesByCat.set(catId, sum);
        });

        const wrap = this.paneEl.createDiv({ cls: 'check-cat-bars' });
        wrap.createDiv({ cls: 'check-cat-bars-title', text: t('panel.checkDurationFlowTitle') });

        const cats = this.panelOptions.categoryData.categories;
        const knownIds = new Set(cats.map((cat) => cat.id));
        const extraIds = Array.from(minutesByCat.keys()).filter((id) => !knownIds.has(id));
        const rows = [
            ...cats.map((cat) => ({
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

        const taskNames = new Map(this.panelOptions.getTasks().map((task) => [task.id, task.name]));

        // 分类行与展开子行共用同一比例尺，保证父子横条长度可直接比较
        const rowEls = renderHBars(
            wrap,
            rows.map((row) => ({ label: row.label, value: row.minutes, color: row.color })),
            { scale: maxMinutes, formatValue: formatHours, rowInteractive: true },
        );

        rowEls.forEach((rowEl, index) => {
            const row = rows[index];
            const expanded = this.durationFlowExpanded.has(row.id);
            rowEl.toggleClass('is-expanded', expanded);
            // 箭头属于视图装饰：图元只负责行的视觉结构
            const chevron = rowEl.createSpan({ cls: 'check-cat-bars-chevron' });
            setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');
            rowEl.prepend(chevron);
            rowEl.addEventListener('click', () => {
                if (this.durationFlowExpanded.has(row.id)) this.durationFlowExpanded.delete(row.id);
                else this.durationFlowExpanded.add(row.id);
                this.renderPane();
            });

            if (!expanded) return;
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

    // ===== 习惯：周数切换 + 9 列表格（习惯名称 + 完成情况 + 周一至周日是否完成） =====
    // ===== 具体任务分析：任务搜索 + 项目活跃度柱状图（含整棵子树） =====
    private renderTaskAnalysis(): void {
        const wrap = this.paneEl.createDiv({ cls: 'check-task-analysis' });

        // 第一行：任务搜索框（输入关键字，点击结果确认选择）
        const searchRow = wrap.createDiv({ cls: 'check-task-analysis-search' });
        const input = searchRow.createEl('input', { cls: 'check-task-analysis-input' });
        input.type = 'text';
        input.placeholder = t('panel.taskAnalysisPlaceholder');
        const selected = this.panelOptions.getTasks().find((task) => task.id === this.analyzedTaskId);
        if (selected) input.value = selected.name;

        const resultList = wrap.createDiv({ cls: 'check-task-analysis-results' });
        const showResults = (): void => this.renderTaskAnalysisResults(resultList, input);
        input.addEventListener('input', showResults);
        input.addEventListener('focus', showResults);

        // 第二行：柱形图（与任务视图的「项目活跃度」同一套渲染管线）
        const chart = wrap.createDiv({ cls: 'check-task-analysis-chart' });
        if (!selected) {
            chart.createDiv({ cls: 'check-task-analysis-empty', text: t('panel.taskAnalysisEmpty') });
            return;
        }
        this.renderTaskAnalysisChart(chart, selected.id);
    }

    /** 搜索结果列表：按名称模糊匹配任务，点击结果确认选择并刷新图表 */
    private renderTaskAnalysisResults(list: HTMLElement, input: HTMLInputElement): void {
        list.empty();
        const keyword = input.value.trim().toLowerCase();
        const tasks = this.panelOptions.getTasks()
            .filter((task) => !keyword || task.name.toLowerCase().includes(keyword))
            .slice(0, 8);
        if (tasks.length === 0) {
            list.createDiv({ cls: 'check-task-analysis-no-result', text: t('panel.taskAnalysisNoResult') });
            return;
        }
        for (const task of tasks) {
            const row = list.createDiv({
                cls: 'check-task-analysis-result',
                text: task.name,
            });
            row.addEventListener('click', () => {
                this.analyzedTaskId = task.id;
                this.renderPane();
            });
        }
    }

    /** 具体任务分析柱状图：按周聚合整棵子树的执行时长，周数随容器宽度自适应 */
    private renderTaskAnalysisChart(container: HTMLElement, rootId: string): void {
        const tasks = this.panelOptions.getTasks();
        const ids = new Set<string>([rootId]);
        const collect = (id: string): void => {
            for (const task of tasks) {
                if (task.parentId === id) {
                    ids.add(task.id);
                    collect(task.id);
                }
            }
        };
        collect(rootId);

        // 任务 id → 名称 / 分类颜色（一次构建，避免逐条查找）
        const categoryColor = new Map(this.panelOptions.categoryData.categories.map((cat) => [cat.id, cat.color]));
        const taskTitle = new Map(tasks.map((task) => [task.id, task.name]));
        const taskColor = new Map(tasks.map((task) => [
            task.id,
            (task.categoryId ? categoryColor.get(task.categoryId) : undefined) ?? UNCATEGORIZED_CATEGORY_COLOR,
        ]));

        const executions = this.panelOptions.taskExecutionRepo.records
            .filter((record) => ids.has(record.taskId));

        const render = (width: number): void => {
            const plotWidth = Math.max(32, width - 34 - 8);
            const windowWeeks = Math.max(1, Math.min(104, Math.floor(plotWidth / 64) + 1));
            const { data, monthLabels } = this.weeklyDurationData(executions, windowWeeks, taskTitle, taskColor);
            renderBar(container, data, {
                width,
                showAxes: true,
                yAxisUnit: 'hours',
                monthLabels,
            });
        };

        if (container.clientWidth > 0) {
            render(container.clientWidth);
        } else {
            window.requestAnimationFrame(() => render(container.clientWidth || this.paneEl.clientWidth || 620));
        }
    }

    /**
     * 按周聚合执行时长：最近 N 周连续占位（无数据周为 0），每周内按任务堆叠。
     * 同时给出月份标签数组（与数据等长，进入新月份的位置才有值）。
     */
    private weeklyDurationData(
        records: TaskExecutionRecord[],
        windowWeeks: number,
        taskTitle: Map<string, string>,
        taskColor: Map<string, string>,
    ): { data: BarDatum[]; monthLabels: (string | undefined)[] } {
        // 周键 → 总时长；周键 → (任务 id → 时长)
        const totals = new Map<string, number>();
        const byTask = new Map<string, Map<string, number>>();
        for (const record of records) {
            const start = new Date(record.startAt);
            const weekKey = makeWeekKey(start.getFullYear(), getISOWeek(start));
            const minutes = Math.max(0, (record.endAt - record.startAt) / 60000);
            totals.set(weekKey, (totals.get(weekKey) ?? 0) + minutes);
            let taskMap = byTask.get(weekKey);
            if (!taskMap) {
                taskMap = new Map<string, number>();
                byTask.set(weekKey, taskMap);
            }
            taskMap.set(record.taskId, (taskMap.get(record.taskId) ?? 0) + minutes);
        }

        // 最近 N 周连续占位
        const weekKeys: string[] = [];
        let cursor = getCurrentWeekKey();
        for (let i = 0; i < windowWeeks; i++) {
            weekKeys.unshift(cursor);
            cursor = shiftWeekKey(cursor, -1);
        }

        const data: BarDatum[] = weekKeys.map((weekKey) => {
            const { week } = parseWeekKey(weekKey);
            const taskMap = byTask.get(weekKey);
            return {
                label: `W${String(week).padStart(2, '0')}`,
                value: Math.round(totals.get(weekKey) ?? 0),
                weekKey,
                segments: taskMap
                    ? Array.from(taskMap.entries())
                        .map(([taskId, minutes]) => ({
                            label: taskTitle.get(taskId) ?? taskId,
                            value: Math.round(minutes),
                            color: taskColor.get(taskId),
                        }))
                        .sort((a, b) => b.value - a.value)
                    : undefined,
            };
        });

        // 月份标签：进入新月份的位置显示月份名
        const monthLabels: (string | undefined)[] = [];
        let prevMonth = -1;
        for (const weekKey of weekKeys) {
            const month = Number(makeDayKeyFromWeek(weekKey, 1).slice(5, 7));
            monthLabels.push(month !== prevMonth ? `${month}月` : undefined);
            prevMonth = month;
        }

        return { data, monthLabels };
    }

    // ===== 任务记录：已迁移到统计面板 =====

    /** 周数切换：‹ 第 N 周 › */
    private renderWeekNav(): void {
        const { week } = parseWeekKey(this.weekKey);
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        const prev = nav.createEl('button', { cls: 'plan-nav-btn', text: '←' });
        prev.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planWeekLabel', { week: String(week) }) });
        const next = nav.createEl('button', { cls: 'plan-nav-btn', text: '→' });
        next.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.renderPane();
        });

        // 周数切换右侧：相对当前周的偏移（本周 / x 周前 / x 周后），点击回到当前周
        const currentWeekKey = getCurrentWeekKey();
        const offset = this.weekOffsetFrom(currentWeekKey);
        const jump = nav.createEl('button', {
            cls: 'plan-nav-btn check-week-jump',
            text: offset === 0
                ? t('panel.weekNavCurrent')
                : offset < 0
                    ? t('panel.weekNavBefore', { weeks: String(-offset) })
                    : t('panel.weekNavAfter', { weeks: String(offset) }),
            attr: { type: 'button' },
        });
        jump.toggleClass('is-current', offset === 0);
        jump.disabled = offset === 0;
        jump.addEventListener('click', () => {
            if (this.weekKey === currentWeekKey) return;
            this.weekKey = currentWeekKey;
            this.renderPane();
        });
    }

    /** 当前查看周相对指定周（默认即当前周）的周数差：负数表示更早，正数表示更晚 */
    private weekOffsetFrom(baseWeekKey: string): number {
        const mondayOf = (weekKey: string): number => {
            const dayKey = makeDayKeyFromWeek(weekKey, 1);
            const [year, month, date] = dayKey.split('-').map(Number);
            return new Date(year, month - 1, date).getTime();
        };
        return Math.round((mondayOf(this.weekKey) - mondayOf(baseWeekKey)) / (7 * 24 * 3600000));
    }

    /** 原型任务的分类 id */
    private categoryIdOf(taskId: string): string | undefined {
        return this.panelOptions.getTasks().find((task) => task.id === taskId)?.categoryId;
    }

    /** 执行时长按「分类 → 根任务」两级汇总：子任务时长归并到所属根任务（跨午夜裁剪到本周） */
    private execMinutesByRootTaskCategory(): Map<string, Map<string, number>> {
        const tasks = this.panelOptions.getTasks();
        const records = this.panelOptions.taskExecutionRepo.records;
        const result = new Map<string, Map<string, number>>();
        const firstDayKey = makeDayKeyFromWeek(this.weekKey, 1);
        const [fy, fm, fd] = firstDayKey.split('-').map(Number);
        const weekStart = new Date(fy, fm - 1, fd).getTime();
        const weekEnd = weekStart + 7 * 24 * 3600000;
        for (const record of records) {
            const startMs = Math.max(weekStart, record.startAt);
            const endMs = Math.min(weekEnd, record.endAt);
            if (endMs <= startMs) continue;
            // 事项按根任务统计：子任务的执行时长归并到所属根任务
            const rootId = findRootTaskId(tasks, record.taskId);
            // 任务已删除：记录保留并统一归并到「已删除任务」，无分类信息
            const key = rootId ?? DELETED_ROOT_TASK_ID;
            const catId = rootId
                ? (this.categoryIdOf(rootId) ?? UNCATEGORIZED_CATEGORY_ID)
                : UNCATEGORIZED_CATEGORY_ID;
            const byTask = result.get(catId) ?? new Map<string, number>();
            byTask.set(key, (byTask.get(key) ?? 0) + (endMs - startMs) / 60000);
            result.set(catId, byTask);
        }
        return result;
    }

}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${Number((minutes / 60).toFixed(1))}h`;
}


// 检查面板：基于 FloatingPanel，用于配置检查。
// 结构：顶部选项卡（一日 / 一周 / 一月 / 一季占位 + 具体任务分析）；其余视图已拆为独立面板（stats-panel.ts）。
import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import type { TaskExecutionRecord } from '../../../core/datatypes/task-execution';
import type { BarDatum } from '../../../charts/primitives/types';
import { renderBar } from '../../../charts/primitives/bar';
import { t, getWeekDays } from '../../../core/i18n';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { PlanAssignmentRepo } from '../../../core/repos/plan-assignment-repo';
import type { ChecklistCategory } from '../../../core/datatypes/domain';
import { appendChecklist } from '../../../core/shared/task-sections';
import { TaskPickerPanel } from '../task/task-picker-panel';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_COLOR } from '../../../core/shared/plan-category-manager';
import {
    getCurrentWeekKey,
    getISOWeek,
    makeDayKey,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
    shiftWeekKey,
} from '../../../core/shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';
import { applyThemeColors, getCurrentThemeColors } from '../../../theme/theme-colors';
import {
    renderDayRecordCard,
    renderDayTasksTable,
    renderHabitsTable,
    type DayTasksContext,
    type WeekSectionContext,
} from './week-sections';

/** 检查面板配置 */
export interface CheckPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「检查」 */
    title?: string;
    /** 分类数据（颜色来源，与图例一致） */
    categoryData: PlanCategoryData;
    /** 任务执行记录仓库（具体任务分析的执行记录来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 计划排布仓库（当天任务的排布来源） */
    planAssignmentRepo: PlanAssignmentRepo;
    /** 任务数据保存（清单写入后调用） */
    saveTasks: () => void;
    /** 原型任务数据源（用于按任务取分类颜色） */
    getTasks: () => PrototypeTask[];
}

/** 区间视图选项卡（一日 / 一周 / 一月 / 一季）：先占位，内容待实现 */
type CheckRangeTab = 'day' | 'week' | 'month' | 'quarter';

/** 区间视图选项卡的展示顺序 */
const RANGE_TAB_KEYS: CheckRangeTab[] = ['day', 'week', 'month', 'quarter'];

/** 顶部选项卡 */
type CheckTab = CheckRangeTab | 'taskAnalysis';

/** 检查面板 */
export class CheckPanel extends FloatingPanel {
    private rangeTabEls!: Record<CheckRangeTab, HTMLElement>;
    private taskAnalysisTabEl!: HTMLElement;
    /** 内容区容器 */
    private paneEl!: HTMLElement;
    /** 当前选项卡 */
    private tab: CheckTab = 'day';
    /** 一周视图当前查看的周键 */
    private weekKey: string = getCurrentWeekKey();
    /** 一日视图当前查看的日期键（默认今天） */
    private dayKey: string = makeDayKey(new Date());
    /** 记录删除确认浮层（挂在 body 上） */
    private deleteConfirmEl: HTMLElement | null = null;
    private deleteConfirmOutsideHandler?: (evt: MouseEvent) => void;
    private deleteConfirmEscapeHandler?: (evt: KeyboardEvent) => void;
    /** 待确认删除的记录 id */
    private pendingDeleteRecordId?: string;
    /** 「清单」悬浮面板（存在即打开） */
    private checklistPopoverEl: HTMLElement | undefined;
    /** 周导航末尾的「清单」按钮 */
    private checklistBtnEl!: HTMLElement;
    /** 「清单」面板中选中的任务 id */
    private checklistTaskId: string | undefined;
    /** 具体任务分析选中的任务 id（跨选项卡 / 重开保留） */
    private analyzedTaskId: string | undefined;

    constructor(private readonly panelOptions: CheckPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.checkPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('check-panel');
        this.renderLayout();
    }

    /** 关闭面板时一并清理确认浮层 */
    override close(): void {
        this.closeDeleteRecordConfirm();
        super.close();
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
        this.taskAnalysisTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkTaskDetail') });
        this.taskAnalysisTabEl.addEventListener('click', () => this.switchTab('taskAnalysis'));

        this.paneEl = this.body.createDiv({ cls: 'plan-pane' });
        this.switchTab(this.tab);
    }

    private switchTab(tab: CheckTab): void {
        this.tab = tab;
        for (const key of RANGE_TAB_KEYS) {
            this.rangeTabEls[key].toggleClass('is-active', tab === key);
        }
        this.taskAnalysisTabEl.toggleClass('is-active', tab === 'taskAnalysis');
        this.renderPane();
    }

    private renderPane(): void {
        this.closeDeleteRecordConfirm();
        this.paneEl.empty();
        // 面板元素随内容区一起销毁，重置引用
        this.checklistPopoverEl = undefined;
        // 一月 / 一季：占位选项卡，页面内容显示「功能正在完善中」
        if (this.tab === 'day') this.renderDayView();
        if (this.tab === 'week') this.renderWeekView();
        if (this.tab === 'month' || this.tab === 'quarter') {
            this.paneEl.createDiv({ cls: 'interface-function-hint', text: t('panel.checkRangeWip') });
        }
        if (this.tab === 'taskAnalysis') this.renderTaskAnalysis();
    }

    // ===== 一日：日期切换 + 当天任务记录卡片 =====
    private renderDayView(): void {
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        const prev = nav.createEl('button', { cls: 'plan-nav-btn', text: '←' });
        prev.setAttribute('aria-label', t('panel.checkDayPrev'));
        prev.addEventListener('click', () => {
            this.dayKey = this.shiftDayKey(-1);
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: this.dayLabel() });
        const next = nav.createEl('button', { cls: 'plan-nav-btn', text: '→' });
        next.setAttribute('aria-label', t('panel.checkDayNext'));
        next.addEventListener('click', () => {
            this.dayKey = this.shiftDayKey(1);
            this.renderPane();
        });

        const list = this.paneEl.createDiv({ cls: 'check-records-list' });
        // 始终显示方框：当天没有记录时卡片内显示空提示
        renderDayRecordCard(list, this.weekSectionContext(), this.dayKey, {
            showEmptyCard: true,
            onDeleteRecord: (recordId, anchor) => this.openDeleteRecordConfirm(anchor, recordId),
        });
    }

    /** 删除一条任务记录并保存 */
    private deleteRecord(recordId: string): void {
        this.panelOptions.taskExecutionRepo.remove(recordId);
        this.panelOptions.saveTasks();
        this.renderPane();
    }

    /** 在删除按钮上方打开删除确认浮层（与任务详情面板的删除确认一致） */
    private openDeleteRecordConfirm(anchor: HTMLElement, recordId: string): void {
        this.closeDeleteRecordConfirm();
        this.pendingDeleteRecordId = recordId;
        const tip = document.body.createDiv({ cls: 'task-detail-delete-confirm' });
        // 浮层挂在 body 上，需手动应用当前主题变量，否则会回退成默认配色
        applyThemeColors(tip, getCurrentThemeColors());
        this.deleteConfirmEl = tip;
        tip.createDiv({ cls: 'task-detail-delete-confirm-text', text: t('panel.checkRecordsDeleteConfirm') });
        const actions = tip.createDiv({ cls: 'task-detail-delete-confirm-actions' });
        const cancelBtn = actions.createEl('button', {
            text: t('settings.cancel'),
            attr: { type: 'button' },
        });
        cancelBtn.addEventListener('click', () => this.closeDeleteRecordConfirm());
        const confirmBtn = actions.createEl('button', {
            cls: 'mod-warning',
            text: t('settings.confirm'),
            attr: { type: 'button' },
        });
        confirmBtn.addEventListener('click', () => {
            const id = this.pendingDeleteRecordId;
            this.closeDeleteRecordConfirm();
            if (id) this.deleteRecord(id);
        });

        // 先渲染出浮层再测量尺寸，保证首次定位正确
        this.positionDeleteConfirm(anchor);
        this.deleteConfirmOutsideHandler = (evt: MouseEvent) => {
            const target = evt.target as Node | null;
            if (target && (tip.contains(target) || anchor.contains(target))) return;
            this.closeDeleteRecordConfirm();
        };
        this.deleteConfirmEscapeHandler = (evt: KeyboardEvent) => {
            if (evt.key !== 'Escape') return;
            // 先关闭浮层，避免同时关闭整个面板
            evt.preventDefault();
            evt.stopPropagation();
            this.closeDeleteRecordConfirm();
        };
        document.addEventListener('mousedown', this.deleteConfirmOutsideHandler, true);
        document.addEventListener('keydown', this.deleteConfirmEscapeHandler, true);
    }

    /** 定位删除确认浮层：优先显示在按钮上方，空间不足时翻到下方 */
    private positionDeleteConfirm(anchor: HTMLElement): void {
        const tip = this.deleteConfirmEl;
        if (!tip) return;
        const rect = anchor.getBoundingClientRect();
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
        let top = rect.top - height - 6;
        if (top < 8) top = rect.bottom + 6;
        tip.setCssStyles({ left: `${left}px`, top: `${top}px` });
    }

    /** 关闭删除确认浮层（移除元素与 document 监听） */
    private closeDeleteRecordConfirm(): void {
        if (this.deleteConfirmOutsideHandler) {
            document.removeEventListener('mousedown', this.deleteConfirmOutsideHandler, true);
            this.deleteConfirmOutsideHandler = undefined;
        }
        if (this.deleteConfirmEscapeHandler) {
            document.removeEventListener('keydown', this.deleteConfirmEscapeHandler, true);
            this.deleteConfirmEscapeHandler = undefined;
        }
        this.deleteConfirmEl?.remove();
        this.deleteConfirmEl = null;
        this.pendingDeleteRecordId = undefined;
    }

    /** 日期键偏移若干天 */
    private shiftDayKey(offset: number): string {
        const [year, month, date] = this.dayKey.split('-').map(Number);
        return makeDayKey(new Date(year, month - 1, date + offset));
    }

    /** 一日导航中的日期文案（如 11月26日 周三） */
    private dayLabel(): string {
        const [year, month, date] = this.dayKey.split('-').map(Number);
        const weekDayIndex = (new Date(year, month - 1, date).getDay() + 6) % 7;
        return `${t('panel.weekRangeDay', { month: String(month), date: String(date) })} ${getWeekDays()[weekDayIndex]}`;
    }

    // ===== 一周：周导航 + 习惯表格 + 时长去向 =====
    private renderWeekView(): void {
        this.renderWeekNav();
        const ctx = this.weekSectionContext();
        renderHabitsTable(this.paneEl, ctx);
        renderDayTasksTable(this.paneEl, this.dayTasksContext());
    }

    /** 周数切换：← 第 N 周 → + 本周（相对偏移）按钮 */
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

        // 右侧：相对当前周的偏移（本周 / x 周前 / x 周后），点击回到当前周
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

        // 本周按钮后显示该周的起止日期
        nav.createSpan({ cls: 'plan-nav-range', text: this.weekRangeLabel() });

        // 行末尾：「清单」按钮，点击在按钮下方展开 / 收起悬浮面板
        nav.addClass('is-relative');
        this.checklistBtnEl = nav.createEl('button', {
            cls: 'plan-nav-btn check-checklist-btn',
            text: t('panel.checkChecklist'),
            attr: { type: 'button', 'aria-expanded': 'false' },
        });
        this.checklistBtnEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.toggleChecklistPopover(nav);
        });
    }

    /** 打开 / 关闭「清单」悬浮面板（仅通过清单按钮关闭） */
    private toggleChecklistPopover(nav: HTMLElement): void {
        if (this.checklistPopoverEl) {
            this.closeChecklistPopover();
            return;
        }

        const pop = nav.createDiv({ cls: 'check-checklist-popover' });
        this.checklistPopoverEl = pop;
        this.checklistBtnEl.addClass('is-active');
        this.checklistBtnEl.setAttribute('aria-expanded', 'true');

        // 第一行：已选任务（只读，点击打开任务选择面板）
        const taskInput = pop.createEl('input', {
            cls: 'check-checklist-input',
            attr: { type: 'text', readonly: 'true', placeholder: t('panel.checkChecklistTask') },
        });
        taskInput.value = this.taskNameOf(this.checklistTaskId);
        taskInput.addEventListener('click', () => {
            new TaskPickerPanel({
                getTasks: () => this.panelOptions.getTasks(),
                initialSelectedIds: this.checklistTaskId ? [this.checklistTaskId] : [],
                onSelect: (taskIds) => {
                    if (!taskIds[0]) return;
                    this.checklistTaskId = taskIds[0];
                    taskInput.value = this.taskNameOf(taskIds[0]);
                },
            }).open();
        });

        // 第二行：清单分类
        const categorySelect = pop.createEl('select', { cls: 'check-checklist-select' });
        categorySelect.createEl('option', { value: 'improve', text: t('panel.checklistCategoryImprove') });
        categorySelect.createEl('option', { value: 'step', text: t('panel.checklistCategoryStep') });

        // 第三行：清单内容 + 添加
        const contentRow = pop.createDiv({ cls: 'check-checklist-content-row' });
        const contentInput = contentRow.createEl('input', {
            cls: 'check-checklist-input',
            attr: { type: 'text', placeholder: t('panel.checkChecklistContent') },
        });
        const submit = (): void => {
            const text = contentInput.value.trim();
            const task = this.panelOptions.getTasks().find((item) => item.id === this.checklistTaskId);
            if (!text || !task) return;
            appendChecklist(task, {
                id: `checklist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text,
                createdAt: Date.now(),
                category: categorySelect.value as ChecklistCategory,
            });
            this.panelOptions.saveTasks();
            this.closeChecklistPopover();
        };
        const addBtn = contentRow.createEl('button', {
            cls: 'check-checklist-add',
            text: t('common.add'),
            attr: { type: 'button' },
        });
        addBtn.addEventListener('click', submit);
        contentInput.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') submit();
        });
        contentInput.focus();
    }

    /** 关闭「清单」悬浮面板 */
    private closeChecklistPopover(): void {
        this.checklistPopoverEl?.remove();
        this.checklistPopoverEl = undefined;
        this.checklistBtnEl.removeClass('is-active');
        this.checklistBtnEl.setAttribute('aria-expanded', 'false');
    }

    /** 点击习惯 / 当天任务表格中的行：填入清单面板并自动打开 */
    private selectChecklistTask(taskId: string): void {
        this.checklistTaskId = taskId;
        if (!this.checklistPopoverEl) {
            this.toggleChecklistPopover(this.checklistBtnEl?.parentElement ?? this.paneEl);
        }
        const input = this.checklistPopoverEl?.querySelector<HTMLInputElement>('.check-checklist-input');
        if (input) input.value = this.taskNameOf(taskId);
    }

    /** 任务 id 对应的任务名（找不到时为空） */
    private taskNameOf(taskId: string | undefined): string {
        return this.panelOptions.getTasks().find((task) => task.id === taskId)?.name ?? '';
    }

    /** 当前查看周相对指定周的周数差：负数表示更早，正数表示更晚 */
    private weekOffsetFrom(baseWeekKey: string): number {
        const mondayOf = (weekKey: string): number => {
            const dayKey = makeDayKeyFromWeek(weekKey, 1);
            const [year, month, date] = dayKey.split('-').map(Number);
            return new Date(year, month - 1, date).getTime();
        };
        return Math.round((mondayOf(this.weekKey) - mondayOf(baseWeekKey)) / (7 * 24 * 3600000));
    }

    /** 当前周的起止日期（如 9月1日 - 9月7日） */
    private weekRangeLabel(): string {
        const format = (dayKey: string): string => {
            const [, month, date] = dayKey.split('-').map(Number);
            return t('panel.weekRangeDay', { month: String(month), date: String(date) });
        };
        return t('panel.weekRange', {
            start: format(makeDayKeyFromWeek(this.weekKey, 1)),
            end: format(makeDayKeyFromWeek(this.weekKey, 7)),
        });
    }

    /** 「一周」视图区块的数据上下文 */
    private weekSectionContext(): WeekSectionContext {
        return {
            weekKey: this.weekKey,
            categories: this.panelOptions.categoryData.categories,
            getTasks: () => this.panelOptions.getTasks(),
            taskExecutionRepo: this.panelOptions.taskExecutionRepo,
            onTaskClick: (taskId) => this.selectChecklistTask(taskId),
        };
    }

    /** 当天任务表格的数据上下文 */
    private dayTasksContext(): DayTasksContext {
        return { ...this.weekSectionContext(), planAssignmentRepo: this.panelOptions.planAssignmentRepo };
    }

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

}


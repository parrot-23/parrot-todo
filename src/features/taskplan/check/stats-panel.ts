// 统计面板：基于 FloatingPanel，独立的「统计」视图（功能面板一级菜单「统计」）。
// 结构：顶部选项卡（统计 / 任务记录）+ 周数切换。
// 统计：本周七天，每天两个方框（分类已执行时长 / 任务占比）；
// 任务记录：每天一张卡片（只显示有记录的日期），视觉复用检查面板的记录卡片样式。
import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { renderHBars } from '../../../charts/primitives/hbar';
import { renderPie } from '../../../charts/primitives/pie';
import { renderTimeGrid } from '../../../charts/primitives/time-grid';
import { t, getWeekDays } from '../../../core/i18n';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { TimeBoxRepo } from '../../../core/repos/timebox-repo';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
import { getCurrentWeekKey, makeDayKeyFromWeek, parseWeekKey, shiftWeekKey } from '../../../core/shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';
import {
    renderDayRecordCard,
    renderDurationFlow as renderDurationFlowSection,
    renderHabitsTable,
    type WeekSectionContext,
} from './week-sections';

/** 统计面板配置 */
export interface StatsPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「统计」 */
    title?: string;
    /** 分类数据（颜色来源，与图例一致） */
    categoryData: PlanCategoryData;
    /** 时间盒仓库（计划分布的数据来源） */
    timeBoxRepo: TimeBoxRepo;
    /** 任务执行记录仓库（统计的数据来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 原型任务数据源（用于按任务取分类颜色与名称） */
    getTasks: () => PrototypeTask[];
    /** 点击右上角「数据」按钮的回调 */
    onOpenData?: () => void;
}

/** 一天的连续时间块（分钟数，从当天 00:00 起） */
interface ChartBlock {
    start: number;
    end: number;
    categoryId?: string;
}

/** 顶部选项卡 */
type StatsTab = 'stats' | 'records' | 'planVsActual' | 'habits' | 'durationFlow';

/** 统计面板 */
export class StatsPanel extends FloatingPanel {
    private statsTabEl!: HTMLElement;
    private recordsTabEl!: HTMLElement;
    private planVsActualTabEl!: HTMLElement;
    private habitsTabEl!: HTMLElement;
    private durationFlowTabEl!: HTMLElement;
    /** 「时长去向」中已展开的分类（跨重渲染保持） */
    private durationFlowExpanded = new Set<string>();
    /** 内容区容器 */
    private paneEl!: HTMLElement;
    /** 当前选项卡 */
    private tab: StatsTab = 'stats';
    /** 当前查看的周键 */
    private weekKey: string = getCurrentWeekKey();

    constructor(private readonly panelOptions: StatsPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.checkStats'),
            ...panelOptions,
        });
        this.body.addClass('check-panel');
        this.body.addClass('stats-panel');
        this.renderLayout();
    }

    /** 顶部选项卡行 + 内容区（与检查面板一致的形式） */
    private renderLayout(): void {
        // 选项卡行 + 「数据」按钮；按钮绝对定位，不参与行高，保证与检查面板选项卡间距一致
        const tabs = this.body.createDiv({ cls: 'plan-tabs has-action' });
        this.statsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkStatsCategory') });
        this.recordsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkRecords') });
        this.planVsActualTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkPlanVsActual') });
        this.habitsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('interface.habit') });
        this.durationFlowTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkDurationFlow') });
        this.statsTabEl.addEventListener('click', () => this.switchTab('stats'));
        this.recordsTabEl.addEventListener('click', () => this.switchTab('records'));
        this.planVsActualTabEl.addEventListener('click', () => this.switchTab('planVsActual'));
        this.habitsTabEl.addEventListener('click', () => this.switchTab('habits'));
        this.durationFlowTabEl.addEventListener('click', () => this.switchTab('durationFlow'));

        // 选项卡行最右侧的「数据」按钮：打开数据面板
        const dataButton = tabs.createEl('button', {
            cls: 'check-data-button',
            text: t('panel.checkData'),
            attr: { type: 'button' },
        });
        dataButton.addEventListener('click', () => this.panelOptions.onOpenData?.());

        this.paneEl = this.body.createDiv({ cls: 'plan-pane' });
        this.switchTab(this.tab);
    }

    private switchTab(tab: StatsTab): void {
        this.tab = tab;
        this.statsTabEl.toggleClass('is-active', tab === 'stats');
        this.recordsTabEl.toggleClass('is-active', tab === 'records');
        this.planVsActualTabEl.toggleClass('is-active', tab === 'planVsActual');
        this.habitsTabEl.toggleClass('is-active', tab === 'habits');
        this.durationFlowTabEl.toggleClass('is-active', tab === 'durationFlow');
        this.renderPane();
    }

    /** 重绘内容区：周数切换 + 当前选项卡内容 */
    private renderPane(): void {
        this.paneEl.empty();
        this.renderWeekNav();
        if (this.tab === 'stats') this.renderStatsDays();
        if (this.tab === 'records') this.renderRecords();
        if (this.tab === 'planVsActual') this.renderPlanVsActual();
        if (this.tab === 'habits') this.renderHabits();
        if (this.tab === 'durationFlow') this.renderDurationFlow();
    }

    /** 统计：本周七天，每天两个方框（分类已执行时长 / 任务占比） */
    private renderStatsDays(): void {
        const days = this.paneEl.createDiv({ cls: 'check-stats-days' });
        const weekDays = getWeekDays();
        for (let day = 1; day <= 7; day++) {
            const row = days.createDiv({ cls: 'today-stats-row check-stats-day-row' });
            row.createDiv({ cls: 'check-stats-day-label', text: weekDays[day - 1] });
            this.renderCategoryDurationBox(row, day);
            this.renderTaskShareBox(row, day);
        }
    }

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

    /** 指定星期的执行记录：按任务聚合分钟数（跨午夜按天裁剪） */
    private minutesByTaskForDay(day: number): Map<string, number> {
        const dayKey = makeDayKeyFromWeek(this.weekKey, day);
        const [year, month, date] = dayKey.split('-').map(Number);
        const dayStart = new Date(year, month - 1, date).getTime();
        const dayEnd = dayStart + 24 * 3600000;

        const minutesByTask = new Map<string, number>();
        for (const record of this.panelOptions.taskExecutionRepo.records) {
            const startMs = Math.max(dayStart, record.startAt);
            const endMs = Math.min(dayEnd, record.endAt);
            if (endMs <= startMs) continue;
            const minutes = (endMs - startMs) / 60000;
            minutesByTask.set(record.taskId, (minutesByTask.get(record.taskId) ?? 0) + minutes);
        }
        return minutesByTask;
    }

    /** 当天各分类已执行时长（样式与二级视图（日执行）的今日情况一致） */
    private renderCategoryDurationBox(panel: HTMLElement, day: number): void {
        const minutesByTask = this.minutesByTaskForDay(day);

        const minutesByCat = new Map<string, number>();
        for (const [taskId, minutes] of Array.from(minutesByTask.entries())) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const catId = task?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
            minutesByCat.set(catId, (minutesByCat.get(catId) ?? 0) + minutes);
        }

        const box = panel.createDiv({ cls: 'today-cat-duration-box' });
        box.createDiv({ cls: 'today-cat-duration-title', text: t('today.categoryDurationTitle') });

        if (minutesByCat.size === 0) {
            box.createDiv({ cls: 'today-cat-duration-empty', text: t('today.categoryDurationEmpty') });
            return;
        }

        const rows = this.panelOptions.categoryData.categories
            .map((cat) => ({ cat, minutes: minutesByCat.get(cat.id) ?? 0 }))
            .filter((row) => row.minutes > 0);

        const chart = box.createDiv({ cls: 'today-cat-duration-chart' });
        for (const { cat, minutes } of rows) {
            const row = chart.createDiv({ cls: 'today-cat-duration-row' });
            row.createDiv({ cls: 'today-cat-duration-label', text: cat.label });
            const blocks = row.createDiv({ cls: 'today-cat-duration-blocks' });
            const fullHours = Math.floor(minutes / 60);
            const remainder = minutes % 60;
            const blockCount = fullHours + (remainder > 0 ? 1 : 0);
            for (let i = 0; i < blockCount; i++) {
                const block = blocks.createDiv({ cls: 'today-cat-duration-block' });
                block.setCssProps({ '--block-color': cat.color ?? '#888888' });
                const isPartial = remainder > 0 && i === blockCount - 1;
                const fillPercent = isPartial ? Math.round((remainder / 60) * 100) : 100;
                const fill = block.createDiv({ cls: 'today-cat-duration-block-fill' });
                fill.setCssProps({ '--fill-width': `${fillPercent}%` });
            }
            row.createDiv({ cls: 'today-cat-duration-value', text: formatHours(minutes) });
        }
    }

    /** 当天任务占比（样式与二级视图（日执行）的今日情况一致） */
    private renderTaskShareBox(panel: HTMLElement, day: number): void {
        const minutesByTask = this.minutesByTaskForDay(day);
        const totalMinutes = Array.from(minutesByTask.values()).reduce((sum, value) => sum + value, 0);

        const box = panel.createDiv({ cls: 'today-task-share-box' });
        box.createDiv({ cls: 'today-cat-duration-title', text: t('today.taskShareTitle') });

        if (minutesByTask.size === 0 || totalMinutes <= 0) {
            box.createDiv({ cls: 'today-cat-duration-empty', text: t('today.taskShareEmpty') });
            return;
        }

        const content = box.createDiv({ cls: 'today-task-share-content' });

        // 任务 id → 任务 / 分类色（一次构建，避免逐条查找）
        const taskById = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const categoryColor = new Map(this.panelOptions.categoryData.categories.map((cat) => [cat.id, cat.color]));
        const colorOf = (taskId: string): string => {
            const task = taskById.get(taskId);
            return (task?.categoryId ? categoryColor.get(task.categoryId) : undefined) ?? '#888888';
        };
        const nameOf = (taskId: string): string => taskById.get(taskId)?.name ?? t('inbox.noCategory');

        const entries = Array.from(minutesByTask.entries());
        renderPie(
            content,
            entries.map(([taskId, minutes]) => ({
                label: nameOf(taskId),
                value: minutes,
                color: colorOf(taskId),
            })),
            { size: 160, sliceLabels: true, minLabelRatio: 0.06 },
        );

        // 右侧列表：按时长降序
        const list = content.createDiv({ cls: 'today-task-share-list' });
        for (const [taskId, minutes] of entries.slice().sort((a, b) => b[1] - a[1])) {
            const row = list.createDiv({ cls: 'today-task-share-row' });
            row.createSpan({ cls: 'today-task-share-dot' }).setCssProps({ '--dot-color': colorOf(taskId) });
            row.createSpan({ cls: 'today-task-share-name', text: nameOf(taskId) });
            row.createSpan({ cls: 'today-task-share-value', text: formatHours(minutes) });
        }
    }
    // ===== 计划vs对比：计划 / 执行分布（24 小时 × 7 列） =====
    private renderPlanVsActual(): void {
        const chartsRow = this.paneEl.createDiv({ cls: 'check-charts-row' });
        this.renderDistributionChart(
            chartsRow,
            t('check.detailPlanChartTitle'),
            this.planBlocksByDay(),
            { title: t('check.detailPlanCategoryTitle'), minutesByCat: this.planMinutesByCategory() },
        );
        this.renderDistributionChart(
            chartsRow,
            t('check.detailExecChartTitle'),
            this.executionBlocksByDay(),
            {
                title: t('check.detailExecCategoryTitle'),
                minutesByCat: this.execMinutesByCategory(),
                planMinutesByCat: this.planMinutesByCategory(),
            },
        );
    }

    /** 习惯：复用「一周」视图的习惯表格 */
    private renderHabits(): void {
        renderHabitsTable(this.paneEl, this.weekSectionContext());
    }

    /** 计划分布：时间盒数据，相邻同分类的小时格合并为一块 */
    private planBlocksByDay(): Map<number, ChartBlock[]> {
        const cells = [...this.panelOptions.timeBoxRepo.weekCells(this.weekKey)]
            .sort((a, b) => a.hour - b.hour);
        const blocksByDay = new Map<number, ChartBlock[]>();
        for (let day = 1; day <= 7; day++) {
            const dayBlocks: ChartBlock[] = [];
            for (const cell of cells.filter((item) => item.weekday === day)) {
                const start = cell.hour * 60;
                const end = start + 60;
                const last = dayBlocks[dayBlocks.length - 1];
                if (last && last.end === start && last.categoryId === cell.categoryId) {
                    last.end = end;
                } else {
                    dayBlocks.push({ start, end, categoryId: cell.categoryId });
                }
            }
            blocksByDay.set(day, dayBlocks);
        }
        return blocksByDay;
    }

    /** 执行分布：任务执行记录，跨午夜按天裁剪 */
    private executionBlocksByDay(): Map<number, ChartBlock[]> {
        const records = this.panelOptions.taskExecutionRepo.records;
        const blocksByDay = new Map<number, ChartBlock[]>();
        for (let day = 1; day <= 7; day++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, day);
            const [year, month, date] = dayKey.split('-').map(Number);
            const dayStart = new Date(year, month - 1, date).getTime();
            const dayEnd = dayStart + 24 * 3600000;
            const dayBlocks: ChartBlock[] = [];
            for (const record of records) {
                const startMs = Math.max(dayStart, record.startAt);
                const endMs = Math.min(dayEnd, record.endAt);
                if (endMs <= startMs) continue;
                dayBlocks.push({
                    start: (startMs - dayStart) / 60000,
                    end: (endMs - dayStart) / 60000,
                    categoryId: this.categoryIdOf(record.taskId),
                });
            }
            dayBlocks.sort((a, b) => a.start - b.start);
            blocksByDay.set(day, dayBlocks);
        }
        return blocksByDay;
    }

    /** 原型任务的分类 id */
    private categoryIdOf(taskId: string): string | undefined {
        return this.panelOptions.getTasks().find((task) => task.id === taskId)?.categoryId;
    }

    /** 渲染分布图（计划 / 执行共用，样式与二级视图（检查）一致） */
    private renderDistributionChart(
        body: HTMLElement,
        title: string,
        blocksByDay: Map<number, ChartBlock[]>,
        categorySummary?: {
            title: string;
            minutesByCat: Map<string, number>;
            planMinutesByCat?: Map<string, number>;
        },
    ): void {
        const section = body.createDiv({ cls: 'check-daily-section' });
        section.createDiv({ cls: 'check-daily-section-title', text: title });

        const weekDays = getWeekDays();
        const blocks = [];
        for (let day = 1; day <= 7; day++) {
            for (const block of blocksByDay.get(day) ?? []) {
                const category = block.categoryId
                    ? this.panelOptions.categoryData.categories.find((item) => item.id === block.categoryId)
                    : undefined;
                blocks.push({
                    column: String(day),
                    start: block.start,
                    end: block.end,
                    color: category?.color ?? '#888888',
                    title: `${category?.label ?? t('inbox.noCategory')} ${formatMinutes(block.start)}-${formatMinutes(block.end)}`,
                });
            }
        }
        renderTimeGrid(section, {
            columns: weekDays.map((label, index) => ({ key: String(index + 1), label })),
            blocks,
        });

        if (categorySummary) {
            this.renderCategoryBars(
                section,
                categorySummary.title,
                categorySummary.minutesByCat,
                categorySummary.planMinutesByCat,
            );
        }
    }

    /** 计划各分类时长：当前周时间盒格子按分类累加（每格 1 小时），未涂色计入未分类 */
    private planMinutesByCategory(): Map<string, number> {
        const ids = new Set(this.panelOptions.categoryData.categories.map((cat) => cat.id));
        return this.panelOptions.timeBoxRepo.weekMinutesByCategory(this.weekKey, ids);
    }

    /** 执行各分类时长：当前周执行记录按任务分类累加（跨午夜裁剪到本周） */
    private execMinutesByCategory(): Map<string, number> {
        const records = this.panelOptions.taskExecutionRepo.records;
        const minutesByCat = new Map<string, number>();
        const firstDayKey = makeDayKeyFromWeek(this.weekKey, 1);
        const [fy, fm, fd] = firstDayKey.split('-').map(Number);
        const weekStart = new Date(fy, fm - 1, fd).getTime();
        const weekEnd = weekStart + 7 * 24 * 3600000;
        for (const record of records) {
            const startMs = Math.max(weekStart, record.startAt);
            const endMs = Math.min(weekEnd, record.endAt);
            if (endMs <= startMs) continue;
            const catId = this.categoryIdOf(record.taskId) ?? UNCATEGORIZED_CATEGORY_ID;
            minutesByCat.set(catId, (minutesByCat.get(catId) ?? 0) + (endMs - startMs) / 60000);
        }
        return minutesByCat;
    }

    /** 各分类时长横向柱形图：图内共用同一时长刻度；传入计划数据时每类绘制计划 / 执行两条柱 */
    private renderCategoryBars(
        body: HTMLElement,
        title: string,
        minutesByCat: Map<string, number>,
        planMinutesByCat?: Map<string, number>,
    ): void {
        const wrap = body.createDiv({ cls: 'check-cat-bars' });
        wrap.createDiv({ cls: 'check-cat-bars-title', text: title });

        const cats = this.panelOptions.categoryData.categories;
        const knownIds = new Set(cats.map((cat) => cat.id));
        // 兜底：数据里出现但分类列表中不存在的分类
        const extraIds = Array.from(minutesByCat.keys())
            .concat(Array.from(planMinutesByCat?.keys() ?? []))
            .filter((id, index, list) => list.indexOf(id) === index)
            .filter((id) => !knownIds.has(id));
        const rows = [
            ...cats.map((cat) => ({
                id: cat.id,
                label: cat.label,
                color: cat.color,
                actual: minutesByCat.get(cat.id) ?? 0,
                plan: planMinutesByCat?.get(cat.id) ?? 0,
            })),
            ...extraIds.map((id) => ({
                id,
                label: t('inbox.noCategory'),
                color: '#888888',
                actual: minutesByCat.get(id) ?? 0,
                plan: planMinutesByCat?.get(id) ?? 0,
            })),
        ];
        const maxMinutes = Math.max(0, ...rows.map((row) => Math.max(row.actual, row.plan)));
        renderHBars(
            wrap,
            rows.map((row) => ({
                label: row.label,
                value: row.actual,
                color: row.color,
                // 有对比数据时该行渲染为「计划 / 执行」双条
                compare: planMinutesByCat ? row.plan : undefined,
            })),
            { scale: maxMinutes, formatValue: formatHours },
        );
    }

    /** 时长去向：复用「一周」视图的时长去向区块 */
    private renderDurationFlow(): void {
        renderDurationFlowSection(this.paneEl, this.weekSectionContext(), this.durationFlowExpanded, () => this.renderPane());
    }

    /** 「一周」视图区块的数据上下文 */
    private weekSectionContext(): WeekSectionContext {
        return {
            weekKey: this.weekKey,
            categories: this.panelOptions.categoryData.categories,
            getTasks: () => this.panelOptions.getTasks(),
            taskExecutionRepo: this.panelOptions.taskExecutionRepo,
        };
    }

    // ===== 任务记录：每天一张卡片（只显示有记录的日期） =====
    private renderRecords(): void {
        const list = this.paneEl.createDiv({ cls: 'check-records-list' });
        const ctx: WeekSectionContext = {
            weekKey: this.weekKey,
            categories: this.panelOptions.categoryData.categories,
            getTasks: () => this.panelOptions.getTasks(),
            taskExecutionRepo: this.panelOptions.taskExecutionRepo,
        };
        let total = 0;
        for (let day = 1; day <= 7; day++) {
            if (renderDayRecordCard(list, ctx, makeDayKeyFromWeek(this.weekKey, day))) total++;
        }
        if (total === 0) {
            list.createDiv({ cls: 'check-records-empty', text: t('panel.checkRecordsEmpty') });
        }
    }
}

/** 分钟数 → HH:MM */
function formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${Number((minutes / 60).toFixed(1))}h`;
}

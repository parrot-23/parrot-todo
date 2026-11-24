// 检查面板：基于 FloatingPanel，用于配置检查。
// 结构：顶部选项卡（计划vs对比 / 具体任务分析）；「统计」「任务记录」已拆为独立面板（stats-panel.ts）。
// 计划vs对比：周数切换 + 计划分布（时间盒数据）/ 执行分布（任务执行记录），
// 视觉复用二级视图（检查）的分布图样式（24 小时、2 小时一格、7 列）。
import type { App } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import type { CardInstance } from '../../../core/datatypes/card';
import type { CardTemplate } from '../../../core/datatypes/form';
import type { ExecutionRecord, InboxItem } from '../../../core/datatypes/domain';
import { renderCardContent } from '../../../charts/render-card';
import { createDataProvider } from '../../../charts/engine/provider';
import { t, getWeekDays } from '../../../core/i18n';
import type { TimeBoxRepo } from '../../../core/repos/timebox-repo';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
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
    /** 时间盒仓库（计划分布的数据来源） */
    timeBoxRepo: TimeBoxRepo;
    /** 任务执行记录仓库（执行分布的数据来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 原型任务数据源（用于按任务取分类颜色） */
    getTasks: () => PrototypeTask[];
    /** 点击右上角「数据」按钮的回调 */
    onOpenData?: () => void;
    /** Obsidian App（具体任务分析的图表渲染需要） */
    app: App;
}

/** 顶部选项卡 */
type CheckTab = 'planVsActual' | 'taskAnalysis';

/** 分布图中的一个时间块（分钟） */
interface ChartBlock {
    start: number;
    end: number;
    categoryId?: string;
}

/** 检查面板 */
export class CheckPanel extends FloatingPanel {
    private planVsActualTabEl!: HTMLElement;
    private taskAnalysisTabEl!: HTMLElement;
    /** 内容区容器 */
    private paneEl!: HTMLElement;
    /** 当前选项卡 */
    private tab: CheckTab = 'planVsActual';
    /** 计划vs对比当前查看的周键 */
    private weekKey: string = getCurrentWeekKey();
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

    private renderLayout(): void {
        const tabs = this.body.createDiv({ cls: 'plan-tabs' });
        this.planVsActualTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkPlanVsActual') });
        this.taskAnalysisTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkTaskAnalysis') });
        this.planVsActualTabEl.addEventListener('click', () => this.switchTab('planVsActual'));
        this.taskAnalysisTabEl.addEventListener('click', () => this.switchTab('taskAnalysis'));

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

    private switchTab(tab: CheckTab): void {
        this.tab = tab;
        this.planVsActualTabEl.toggleClass('is-active', tab === 'planVsActual');
        this.taskAnalysisTabEl.toggleClass('is-active', tab === 'taskAnalysis');
        this.renderPane();
    }

    private renderPane(): void {
        this.paneEl.empty();
        if (this.tab === 'planVsActual') this.renderPlanVsActual();
        if (this.tab === 'taskAnalysis') this.renderTaskAnalysis();
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

        const provider = createDataProvider(
            () => [],
            () => this.analysisExecutions(ids),
            () => this.analysisItems(),
            () => this.panelOptions.categoryData.categories,
        );

        const render = (width: number): void => {
            const plotWidth = Math.max(32, width - 34 - 8);
            const windowWeeks = Math.max(1, Math.min(104, Math.floor(plotWidth / 64) + 1));
            const template: CardTemplate = {
                id: 'task-analysis-chart',
                name: t('panel.checkTaskAnalysis'),
                mode: 'chart',
                renderer: 'stats',
                source: {
                    dataSource: 'executions',
                    aggregation: 'by-week',
                    chart: 'bar',
                    params: {
                        metric: 'duration',
                        windowWeeks,
                        shortLabel: true,
                        showAxes: true,
                        yUnit: 'hours',
                        width,
                        stackedByTask: true,
                    },
                },
            };
            const instance: CardInstance = {
                id: `task_analysis_${rootId}`,
                templateId: 'task-analysis-chart',
                mode: 'chart',
            };
            renderCardContent(container, instance, template, {
                app: this.panelOptions.app,
                save: async () => { /* 只读图表，无需保存 */ },
                refresh: () => this.renderPane(),
                provider,
            });
        };

        if (container.clientWidth > 0) {
            render(container.clientWidth);
        } else {
            window.requestAnimationFrame(() => render(container.clientWidth || this.paneEl.clientWidth || 620));
        }
    }

    /** 执行记录 → 图表数据（限定任务子树，补齐周键与当天分钟数） */
    private analysisExecutions(ids: Set<string>): ExecutionRecord[] {
        return this.panelOptions.taskExecutionRepo.records
            .filter((record) => ids.has(record.taskId))
            .map((record) => {
                const start = new Date(record.startAt);
                const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
                return {
                    id: record.id,
                    inboxId: record.taskId,
                    day: 0,
                    start: (record.startAt - dayStart) / 60000,
                    end: (record.endAt - dayStart) / 60000,
                    weekKey: makeWeekKey(start.getFullYear(), getISOWeek(start)),
                };
            });
    }

    /** 原型任务 → 图表任务列表（用于柱内按任务堆叠与取分类颜色） */
    private analysisItems(): InboxItem[] {
        return this.panelOptions.getTasks().map((task) => ({
            id: task.id,
            title: task.name,
            description: task.description ?? '',
            categoryId: task.categoryId,
            parentId: task.parentId,
            createdAt: task.createdAt,
            status: task.status,
        }));
    }

    // ===== 任务记录：已迁移到统计面板 =====

    // ===== 计划vs对比：周数切换 + 计划 / 执行分布 =====
    private renderPlanVsActual(): void {
        this.renderWeekNav();

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

        const chart = section.createDiv({ cls: 'check-plan-chart' });

        // 左侧时间刻度（每 2 小时一格，共 12 格）
        const axis = chart.createDiv({ cls: 'check-plan-chart-axis' });
        for (let hour = 0; hour < 24; hour += 2) {
            axis.createDiv({ cls: 'check-plan-chart-axis-cell' })
                .setText(`${String(hour).padStart(2, '0')}:00`);
        }

        const cols = chart.createDiv({ cls: 'check-plan-chart-cols' });
        const weekDays = getWeekDays();
        for (let day = 1; day <= 7; day++) {
            const col = cols.createDiv({ cls: 'check-plan-chart-col' });
            col.createDiv({ cls: 'check-plan-chart-col-title', text: weekDays[day - 1] });

            const track = col.createDiv({ cls: 'check-plan-chart-track' });
            for (const block of blocksByDay.get(day) ?? []) {
                const category = block.categoryId
                    ? this.panelOptions.categoryData.categories.find((item) => item.id === block.categoryId)
                    : undefined;
                const blockEl = track.createDiv({ cls: 'check-plan-chart-block' });
                blockEl.setCssProps({
                    '--block-color': category?.color ?? '#888888',
                    '--block-top': `${(block.start / 1440) * 100}%`,
                    '--block-height': `${(Math.max(0, block.end - block.start) / 1440) * 100}%`,
                });
                blockEl.setAttribute('title', `${category?.label ?? t('inbox.noCategory')} ${formatMinutes(block.start)}-${formatMinutes(block.end)}`);
            }
        }

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
        const widthOf = (minutes: number): string =>
            `${maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0}%`;

        for (const row of rows) {
            const rowEl = wrap.createDiv({ cls: 'check-cat-bars-row' });
            rowEl.createSpan({ cls: 'check-cat-bars-dot' }).setCssStyles({ background: row.color ?? '#888888' });
            rowEl.createSpan({ cls: 'check-cat-bars-label', text: row.label });
            if (planMinutesByCat) {
                // 每类两条：上方灰色为计划时长，下方分类色为执行时长
                const bars = rowEl.createDiv({ cls: 'check-cat-bars-dual' });
                bars.createDiv({ cls: 'check-cat-bars-dual-line is-plan' })
                    .createDiv({ cls: 'check-cat-bars-dual-fill' })
                    .setCssProps({ '--fill-width': widthOf(row.plan) });
                bars.createDiv({ cls: 'check-cat-bars-dual-line' })
                    .createDiv({ cls: 'check-cat-bars-dual-fill' })
                    .setCssProps({
                        '--fill-color': row.color ?? '#888888',
                        '--fill-width': widthOf(row.actual),
                    });
                rowEl.createSpan({
                    cls: 'check-cat-bars-value is-dual',
                    text: `${formatHours(row.actual)} / ${formatHours(row.plan)}`,
                });
            } else {
                const track = rowEl.createDiv({ cls: 'check-cat-bars-track is-plain' });
                track.createDiv({ cls: 'check-cat-bars-fill' }).setCssProps({
                    '--fill-color': row.color ?? '#888888',
                    '--fill-width': widthOf(row.actual),
                });
                rowEl.createSpan({ cls: 'check-cat-bars-value', text: formatHours(row.actual) });
            }
        }
    }
}

/** 分钟数 → HH:MM */
function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${Number((minutes / 60).toFixed(1))}h`;
}


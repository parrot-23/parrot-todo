// 计划一周面板：左右结构。
// 左侧：周信息摘要（周数 / 日期范围 / 任务数）+ 本周已整周排布的任务列表，
//       点击任务条目选中它，作为右侧日目标的绑定任务（再次点击取消选中）；
//       列表底部：选中任务时显示本周描述输入框，未选中时显示本周各分类计划时长柱形图。
// 右侧：顶部周切换（上一周 / 周数 + 日期范围 / 下一周），
//       下方为周一到周日 7 个方框，编辑选中任务在该周的日目标
//       （数据与任务详情「一周目标」选项卡共享任务板块）。
import { setIcon } from 'obsidian';

import type { TaskStatus } from '../../../core/datatypes/domain';
import type { PrototypeTask, TaskDayGoalEntry } from '../../../core/datatypes/prototype-task';
import { t } from '../../../core/i18n';
import type { PlanAssignmentRepo } from '../../../core/repos/plan-assignment-repo';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { TimeBoxRepo } from '../../../core/repos/timebox-repo';
import type { PlanCategory } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
import {
    getCurrentWeekKey,
    makeDayKeyFromWeek,
    parseWeekKey,
    shiftWeekKey,
} from '../../../core/shared/plan-data';
import { getDayEstimate, getDayGoalEntries, getWeekNote, setDayEstimate, setDayGoalEntries, setWeekNote } from '../../../core/shared/task-sections';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';

/** 计划一周面板配置 */
export interface PlanWeekPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「计划一周」 */
    title?: string;
    /** 任务数据源（每次打开时重新读取，保证与其他视图一致） */
    getTasks: () => PrototypeTask[];
    /** 计划排布数据仓库（读取本周已排布任务、读写周描述） */
    planAssignmentRepo: PlanAssignmentRepo;
    /** 任务执行仓库（读取 / 切换当天完成状态，与今日任务卡片同步） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 时间盒仓库（未选中任务时统计本周各分类计划时长） */
    timeBoxRepo: TimeBoxRepo;
    /** 分类数据源（任务名称前的分类颜色圆点） */
    getCategories: () => PlanCategory[];
    /** 数据保存回调 */
    save: () => Promise<void>;
    /** 是否展开显示所有任务的本周描述（随主数据持久化） */
    getShowAllNotes: () => boolean;
    /** 保存「展开显示所有任务的本周描述」开关 */
    setShowAllNotes: (value: boolean) => Promise<void>;
    /** 数据变更回调（界面视图其他卡片据此刷新） */
    onChanged?: () => void;
}

/** 任务状态对应的图标（与习惯面板任务树保持一致） */
const STATUS_ICONS: Record<TaskStatus, string> = {
    notStarted: 'circle',
    inProgress: 'play',
    done: 'check-circle',
    paused: 'pause',
};

/** 星期文案（周一 … 周日） */
const WEEKDAY_LABEL_KEYS: Parameters<typeof t>[0][] = [
    'week.monday',
    'week.tuesday',
    'week.wednesday',
    'week.thursday',
    'week.friday',
    'week.saturday',
    'week.sunday',
];

/** 计划一周面板 */
export class PlanWeekPanel extends FloatingPanel {
    private summaryEl!: HTMLElement;
    private taskListEl!: HTMLElement;
    private navEl!: HTMLElement;
    /** 左侧任务列表底部区域：本周各分类计划时长柱形图 */
    private bottomEl!: HTMLElement;
    /** 已选任务名称（周切换行内右侧） */
    private selectedEl!: HTMLElement;
    /** 右侧七列网格：选中左侧任务后点击某天排布 */
    private dayGridEl!: HTMLElement;
    /** 日目标悬浮预览浮层（悬浮某天卡片区域时展示该天已填写的日目标） */
    private dayGoalTipEl!: HTMLElement;
    /** 悬浮预览当前对应的「任务 + 星期」键，未变化时不重建内容 */
    private dayGoalTipKey: string | undefined;
    /** 日目标编辑浮层（点击卡片某天时在卡片旁弹出，支持新增 / 勾选 / 删除） */
    private dayGoalEditorEl: HTMLElement | undefined;
    /** 编辑浮层当前对应的「任务 id:星期」键 */
    private dayGoalEditorKey: string | undefined;
    /** 编辑浮层锚点（卡片矩形 + 天在卡片中的序号与跨度），用于重绘后重新定位 */
    private dayGoalEditorAnchor: { rect: DOMRect; index: number; span: number } | undefined;
    /** 编辑浮层的新增输入框（新增后保持焦点） */
    private dayGoalEditorInputEl: HTMLInputElement | undefined;
    /** 点击浮层外部关闭的回调（打开时绑定到 document） */
    private dayGoalEditorOutsideHandler: ((evt: MouseEvent) => void) | undefined;
    /** Esc 关闭浮层的回调（打开时绑定到 document） */
    private dayGoalEditorEscapeHandler: ((evt: KeyboardEvent) => void) | undefined;
    /** 当前显示的周键 */
    private weekKey: string;
    /** 左侧选中的任务 id（右侧日目标的绑定任务） */
    private selectedTaskId: string | undefined;
    /** 是否展开显示所有任务卡片的本周描述（由摘要卡片行末图标按钮切换，激活状态持久化） */
    private showAllNotes: boolean;

    constructor(private readonly panelOptions: PlanWeekPanelOptions) {
        super({
            width: 1000,
            title: panelOptions.title ?? t('panel.planWeekTitle'),
            ...panelOptions,
            // 默认展示计划一周的操作帮助，可通过 helpText 覆盖
            helpText: panelOptions.helpText ?? t('panel.planWeekHelp'),
        });
        this.body.addClass('plan-week-panel');
        this.weekKey = getCurrentWeekKey();
        this.showAllNotes = panelOptions.getShowAllNotes();
        this.renderLayout();
    }

    /** 每次打开时重绘，保证任务排布与任务数据都是最新的 */
    override open(): void {
        this.renderAll();
        super.open();
    }

    /** 关闭面板时一并关闭日目标编辑浮层（移除其 document 监听） */
    override close(): void {
        this.closeDayGoalEditor();
        super.close();
    }

    private renderLayout(): void {
        // 左侧：周信息摘要 + 本周已排布任务列表 + 底栏（本周描述 / 分类时长）
        const left = this.body.createDiv({ cls: 'plan-week-left' });
        this.summaryEl = left.createDiv({ cls: 'plan-week-summary' });
        this.taskListEl = left.createDiv({ cls: 'plan-week-task-list' });
        // 底栏：选中任务时是本周描述输入框，未选中时是本周各分类计划时长柱形图
        this.bottomEl = left.createDiv({ cls: 'plan-week-bottom' });

        // 右侧：周切换行（左侧周切换 + 右侧已选任务名称）+ 七列网格
        const right = this.body.createDiv({ cls: 'plan-week-right' });
        const navRow = right.createDiv({ cls: 'plan-week-nav-row' });
        this.navEl = navRow.createDiv({ cls: 'task-week-goal-nav' });
        // 已选任务名称：与周切换按钮同一行，靠右显示
        this.selectedEl = navRow.createDiv({ cls: 'plan-week-selected' });
        this.dayGridEl = right.createDiv({ cls: 'plan-week-day-grid' });

        // 日目标悬浮预览：挂在面板根节点上（不放在滚动网格内，避免被列区域裁剪）
        this.dayGoalTipEl = this.element.createDiv({ cls: 'plan-week-daygoal-tip' });

        this.renderAll();
    }

    /** 重绘全部区域（周切换后调用） */
    private renderAll(): void {
        // 切换周后浮层对应的日期已失效，先关闭
        this.closeDayGoalEditor();
        this.renderNav();
        this.renderSummary();
        this.renderTasks();
        this.renderBottom();
        this.renderDayGrid();
    }

    /** 顶部周切换：上一周 / 周数 + 日期范围 / 下一周 */
    private renderNav(): void {
        this.navEl.empty();
        const prevBtn = this.navEl.createEl('button', {
            cls: 'task-week-goal-nav-btn',
            attr: { type: 'button', 'aria-label': t('panel.weekGoalPrevWeek') },
        });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.renderAll();
        });

        const { week } = parseWeekKey(this.weekKey);
        const label = this.navEl.createDiv({ cls: 'task-week-goal-nav-label' });
        label.createSpan({ cls: 'task-week-goal-nav-week', text: `W${String(week).padStart(2, '0')}` });
        label.createSpan({ cls: 'task-week-goal-nav-range', text: this.formatWeekRange() });
        if (this.weekKey === getCurrentWeekKey()) label.addClass('is-current');

        const nextBtn = this.navEl.createEl('button', {
            cls: 'task-week-goal-nav-btn',
            attr: { type: 'button', 'aria-label': t('panel.weekGoalNextWeek') },
        });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.renderAll();
        });
    }

    /** 左侧周信息摘要：周数 + 日期范围 + 已排布任务数 */
    private renderSummary(): void {
        this.summaryEl.empty();
        const { week } = parseWeekKey(this.weekKey);
        const head = this.summaryEl.createDiv({ cls: 'plan-week-summary-head' });
        if (this.weekKey === getCurrentWeekKey()) head.addClass('is-current');
        head.createSpan({ cls: 'plan-week-summary-week', text: `W${String(week).padStart(2, '0')}` });
        head.createSpan({ cls: 'plan-week-summary-range', text: this.formatWeekRange() });
        // 第二行：任务数 + 行末「本周描述」开关（激活后展开所有任务卡片的本周描述）
        const countRow = this.summaryEl.createDiv({ cls: 'plan-week-summary-count-row' });
        countRow.createSpan({
            cls: 'plan-week-summary-count',
            text: t('panel.planWeekTaskCount', { count: `${this.plannedTasks().length}` }),
        });
        const notesToggle = countRow.createEl('button', {
            cls: 'plan-week-summary-notes-toggle',
            attr: { type: 'button', 'aria-label': t('panel.planWeekDescription') },
        });
        notesToggle.toggleClass('is-active', this.showAllNotes);
        setIcon(notesToggle, 'file-text');
        notesToggle.addEventListener('click', () => {
            this.showAllNotes = !this.showAllNotes;
            notesToggle.toggleClass('is-active', this.showAllNotes);
            void this.panelOptions.setShowAllNotes(this.showAllNotes);
            this.renderTasks();
        });
    }

    /** 左侧任务列表：本周已整周排布的任务（点击选中 / 再次点击取消选中） */
    private renderTasks(): void {
        this.renderSelectedTask();
        this.taskListEl.empty();
        const tasks = this.plannedTasks();
        if (tasks.length === 0) {
            this.taskListEl.createDiv({ cls: 'plan-week-task-empty', text: t('panel.planWeekNoPlannedTask') });
            return;
        }
        for (const task of tasks) {
            const row = this.taskListEl.createDiv({ cls: 'plan-week-task-row' });
            row.toggleClass('is-selected', task.id === this.selectedTaskId);
            row.title = task.name;
            // 第一行：父级任务路径（无父级时显示「根任务」）
            row.createDiv({
                cls: 'plan-week-task-path',
                text: this.taskPath(task) || t('panel.planWeekRootTask'),
            });
            // 第二行：分类颜色圆点 + 任务名称 + 行末状态图标
            const main = row.createDiv({ cls: 'plan-week-task-main' });
            const category = this.panelOptions.getCategories().find((item) => item.id === task.categoryId);
            const dot = main.createSpan({ cls: 'plan-week-task-dot' });
            dot.style.background = category?.color ?? 'var(--text-faint)';
            main.createSpan({ cls: 'plan-week-task-name', text: task.name });
            setIcon(main.createSpan({ cls: 'plan-week-task-status' }), STATUS_ICONS[task.status ?? 'notStarted']);
            row.addEventListener('click', () => {
                this.selectedTaskId = this.selectedTaskId === task.id ? undefined : task.id;
                this.renderTasks();
                this.renderDayGrid();
            });
            // 选中条目或开启「本周描述」开关时，在条目下方缩进展开本周描述
            if (task.id === this.selectedTaskId || this.showAllNotes) this.renderInlineDescription(row, task);
        }
    }

    /** 条目内缩进展示本周描述：默认只读，点击后切换为输入框，失焦保存 */
    private renderInlineDescription(row: HTMLElement, task: PrototypeTask): void {
        this.migrateLegacyWeekNote(task);
        const note = getWeekNote(task, this.weekKey);
        const wrap = row.createDiv({ cls: 'plan-week-task-desc' });
        const textEl = wrap.createDiv({
            cls: 'plan-week-task-desc-text',
            text: note || t('panel.planWeekDescriptionPlaceholder'),
        });
        textEl.toggleClass('is-placeholder', !note);
        wrap.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.editInlineDescription(wrap, task);
        });
    }

    /** 把只读描述切换为输入框；失焦保存并恢复只读显示，Esc 放弃修改 */
    private editInlineDescription(wrap: HTMLElement, task: PrototypeTask): void {
        if (wrap.querySelector('.plan-week-task-desc-input')) return;
        wrap.empty();
        const input = wrap.createEl('textarea', {
            cls: 'plan-week-task-desc-input',
            attr: { placeholder: t('panel.planWeekDescriptionPlaceholder') },
        });
        input.value = getWeekNote(task, this.weekKey);
        // 输入框内的点击不冒泡到条目，避免取消选中
        for (const type of ['click', 'mousedown', 'dblclick']) {
            input.addEventListener(type, (evt) => evt.stopPropagation());
        }
        input.addEventListener('blur', () => {
            const next = input.value.trim();
            if (next !== getWeekNote(task, this.weekKey)) {
                setWeekNote(task, this.weekKey, next);
                void this.panelOptions.save();
                this.panelOptions.onChanged?.();
            }
            // 延后重绘：避免在失焦瞬间点击其他条目时被提前移除而丢失点击
            window.setTimeout(() => this.renderTasks(), 0);
        });
        input.addEventListener('keydown', (evt) => {
            if (evt.key !== 'Escape') return;
            evt.stopPropagation();
            this.renderTasks();
        });
        input.focus();
    }

    /** 父级任务路径：从根到直接父级的名称，用 / 连接（无父级时返回空串） */
    private taskPath(task: PrototypeTask): string {
        const tasks = this.panelOptions.getTasks();
        const names: string[] = [];
        const seen = new Set<string>();
        let parentId = task.parentId;
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = tasks.find((item) => item.id === parentId);
            if (!parent) break;
            names.unshift(parent.name);
            parentId = parent.parentId;
        }
        return names.join(' / ');
    }

    /** 已选任务名称：显示在周切换行下方、本周描述方框上方；未选中时整行隐藏 */
    private renderSelectedTask(): void {
        this.selectedEl.empty();
        const task = this.selectedTask();
        this.selectedEl.toggleClass('is-hidden', !task);
        if (!task) return;
        this.selectedEl.createSpan({ cls: 'plan-week-selected-label', text: t('panel.planWeekSelectedTask') });
        this.selectedEl.createSpan({ cls: 'plan-week-selected-name', text: task.name });
    }

    /** 日键（YYYY-MM-DD）格式化为 M/D */
    private formatDayLabel(dayKey: string): string {
        return `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`;
    }


    /** 七列网格：表头 7 格（星期 + 日期），表体按天显示已排布的任务卡片 */
    private renderDayGrid(): void {
        this.hideDayGoalTip();
        this.dayGridEl.empty();
        const grid = this.dayGridEl.createDiv({ cls: 'plan-week-grid' });
        const headerRow = grid.createDiv({ cls: 'plan-week-header' });
        const columnsRow = grid.createDiv({ cls: 'plan-week-columns' });
        const segments = this.buildDaySegments();
        const laneCount = segments.reduce((max, item) => Math.max(max, item.lane + 1), 0);
        columnsRow.style.gridTemplateRows = laneCount > 0
            ? `repeat(${laneCount}, min-content) 1fr`
            : '1fr';
        for (let col = 0; col < 7; col += 1) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, col + 1);
            const header = headerRow.createDiv({ cls: 'plan-week-header-cell' });
            // 当天进入新的月份时，在左上角标注月份
            const month = Number(dayKey.slice(5, 7));
            if (month !== this.getPreviousDayMonth(dayKey)) {
                header.createSpan({
                    cls: 'plan-week-header-month',
                    text: t('panel.planWeekMonthLabel', { month: String(month) }),
                });
            }
            header.createSpan({ cls: 'plan-week-header-name', text: t(WEEKDAY_LABEL_KEYS[col]) });
            header.createSpan({
                cls: 'plan-week-header-date',
                text: `${month}/${Number(dayKey.slice(8, 10))}`,
            });
            // 日列作为背景层跨满所有行：已选中任务时点击某列即排布到该天
            const column = columnsRow.createDiv({ cls: 'plan-week-column' });
            column.style.gridColumn = String(col + 1);
            column.style.gridRow = '1 / -1';
            column.toggleClass('is-assignable', this.selectedTaskId !== undefined);
            column.addEventListener('click', () => this.assignSelectedTaskToDay(col + 1));
        }
        for (const segment of segments) this.renderDaySegment(columnsRow, segment);
        this.renderDayCategorySummary();
    }

    /** 右侧底部：每天各分类的时间盒时长（每格 1 小时），固定在七列网格下方与列对齐 */
    private renderDayCategorySummary(): void {
        const wrap = this.dayGridEl.createDiv({ cls: 'plan-week-daily-summary' });
        const cats = this.panelOptions.getCategories();
        const knownIds = new Set(cats.map((cat) => cat.id));
        const minutesByDay = new Map<number, Map<string, number>>();
        const paintedCountByDay = new Map<number, number>();
        for (const cell of this.panelOptions.timeBoxRepo.weekCells(this.weekKey)) {
            if (cell.weekday < 1 || cell.weekday > 7) continue;
            const catId = cell.categoryId && knownIds.has(cell.categoryId)
                ? cell.categoryId
                : UNCATEGORIZED_CATEGORY_ID;
            const byCat = minutesByDay.get(cell.weekday) ?? new Map<string, number>();
            byCat.set(catId, (byCat.get(catId) ?? 0) + 60);
            minutesByDay.set(cell.weekday, byCat);
            paintedCountByDay.set(cell.weekday, (paintedCountByDay.get(cell.weekday) ?? 0) + 1);
        }
        // 未涂色的小时格视为未分类：按天补齐 24 小时
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            const unpainted = Math.max(0, 24 - (paintedCountByDay.get(weekday) ?? 0));
            if (unpainted === 0) continue;
            const byCat = minutesByDay.get(weekday) ?? new Map<string, number>();
            byCat.set(
                UNCATEGORIZED_CATEGORY_ID,
                (byCat.get(UNCATEGORIZED_CATEGORY_ID) ?? 0) + unpainted * 60,
            );
            minutesByDay.set(weekday, byCat);
        }
        // 汇总每天已排布任务的预估时长（按任务分类归属）
        const estimateByDay = this.buildDayEstimateByCategory(knownIds);
        // 汇总每天任务的执行时长（按任务分类归属）
        const executedByDay = this.buildDayExecutedSecondsByCategory(knownIds);
        // 按分类表顺序排列，未分类统一放在最后
        const ordered = [
            ...cats.filter((cat) => cat.id !== UNCATEGORIZED_CATEGORY_ID),
            ...cats.filter((cat) => cat.id === UNCATEGORIZED_CATEGORY_ID),
        ];
        // 表头图例仅在左侧显示一次
        wrap.createDiv({
            cls: 'plan-week-daily-legend',
            text: [
                t('panel.planWeekDailyAvailable'),
                t('panel.planWeekDailyEstimate'),
                t('panel.planWeekDailyExecuted'),
            ].join(' | '),
        });
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            const colEl = wrap.createDiv({ cls: 'plan-week-daily-col' });
            const byCat = minutesByDay.get(weekday);
            if (!byCat) continue;
            const estimateByCat = estimateByDay.get(weekday);
            const executedByCat = executedByDay.get(weekday);
            const executedMinutes = (catId: string): number =>
                Math.round((executedByCat?.get(catId) ?? 0) / 60);
            const rows = ordered
                .map((cat) => ({
                    label: cat.label,
                    color: cat.color,
                    minutes: byCat.get(cat.id) ?? 0,
                    estimate: estimateByCat?.get(cat.id) ?? 0,
                    executed: executedMinutes(cat.id),
                }))
                .filter((row) => row.minutes > 0 || row.estimate > 0 || row.executed > 0);
            // 分类表缺少内置未分类时补一行，避免时长丢失
            if (!knownIds.has(UNCATEGORIZED_CATEGORY_ID)) {
                const minutes = byCat.get(UNCATEGORIZED_CATEGORY_ID) ?? 0;
                const estimate = estimateByCat?.get(UNCATEGORIZED_CATEGORY_ID) ?? 0;
                const executed = executedMinutes(UNCATEGORIZED_CATEGORY_ID);
                if (minutes > 0 || estimate > 0 || executed > 0) {
                    rows.push({
                        label: t('defaultCategory.uncategorized'),
                        color: '#888888',
                        minutes,
                        estimate,
                        executed,
                    });
                }
            }
            for (const row of rows) {
                const rowEl = colEl.createDiv({ cls: 'plan-week-daily-row' });
                rowEl.title = [
                    row.label,
                    `${t('panel.planWeekDailyAvailable')} ${this.formatMinutesLong(row.minutes)}`,
                    `${t('panel.planWeekDailyEstimate')} ${this.formatMinutesLong(row.estimate)}`,
                    `${t('panel.planWeekDailyExecuted')} ${this.formatMinutesLong(row.executed)}`,
                ].join(' | ');
                rowEl.createSpan({ cls: 'plan-week-daily-dot' }).style.background = row.color ?? '#888888';
                rowEl.createSpan({ cls: 'plan-week-daily-value', text: this.formatMinutesLong(row.minutes) });
                rowEl.createSpan({ cls: 'plan-week-daily-sep', text: '|' });
                rowEl.createSpan({ cls: 'plan-week-daily-estimate', text: this.formatMinutesLong(row.estimate) });
                rowEl.createSpan({ cls: 'plan-week-daily-sep', text: '|' });
                rowEl.createSpan({ cls: 'plan-week-daily-executed', text: this.formatMinutesLong(row.executed) });
            }
        }
    }

    /** 汇总每天各分类已排布任务的预估时长（分钟），无效分类归入未分类 */
    private buildDayEstimateByCategory(knownIds: Set<string>): Map<number, Map<string, number>> {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const result = new Map<number, Map<string, number>>();
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, weekday);
            for (const assignment of this.panelOptions.planAssignmentRepo.dayAssignments(this.weekKey, weekday)) {
                const task = tasks.get(assignment.taskId);
                if (!task) continue;
                const minutes = getDayEstimate(task, dayKey);
                if (!minutes) continue;
                const catId = task.categoryId && knownIds.has(task.categoryId)
                    ? task.categoryId
                    : UNCATEGORIZED_CATEGORY_ID;
                const byCat = result.get(weekday) ?? new Map<string, number>();
                byCat.set(catId, (byCat.get(catId) ?? 0) + minutes);
                result.set(weekday, byCat);
            }
        }
        return result;
    }

    /** 汇总每天各分类任务的执行时长（秒），按执行记录 startAt 归属到当天与任务分类，无效分类归入未分类 */
    private buildDayExecutedSecondsByCategory(knownIds: Set<string>): Map<number, Map<string, number>> {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const dayStarts: number[] = [];
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            dayStarts.push(new Date(`${makeDayKeyFromWeek(this.weekKey, weekday)}T00:00:00`).getTime());
        }
        const result = new Map<number, Map<string, number>>();
        for (const record of this.panelOptions.taskExecutionRepo.records) {
            const task = tasks.get(record.taskId);
            if (!task) continue;
            let weekday = 0;
            for (let index = 0; index < dayStarts.length; index += 1) {
                const dayStart = dayStarts[index];
                if (record.startAt >= dayStart && record.startAt < dayStart + 24 * 60 * 60 * 1000) {
                    weekday = index + 1;
                    break;
                }
            }
            if (!weekday) continue;
            const catId = task.categoryId && knownIds.has(task.categoryId)
                ? task.categoryId
                : UNCATEGORIZED_CATEGORY_ID;
            const byCat = result.get(weekday) ?? new Map<string, number>();
            byCat.set(catId, (byCat.get(catId) ?? 0) + record.durationSeconds);
            result.set(weekday, byCat);
        }
        return result;
    }

    /** 取指定日期前一天的月份（用于判断当天是否跨入新月份） */
    private getPreviousDayMonth(dayKey: string): number {
        const date = new Date(`${dayKey}T00:00:00`);
        date.setDate(date.getDate() - 1);
        return date.getMonth() + 1;
    }

    /** 本周按天排布的任务段：同一任务连续的天合并为一段；每行泳道与左侧任务列表从上到下的顺序一一对应 */
    private buildDaySegments(): { task: PrototypeTask; start: number; end: number; lane: number }[] {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const weekdaysByTask = new Map<string, number[]>();
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            for (const assignment of this.panelOptions.planAssignmentRepo.dayAssignments(this.weekKey, weekday)) {
                if (!tasks.has(assignment.taskId)) continue;
                const days = weekdaysByTask.get(assignment.taskId) ?? [];
                days.push(weekday);
                weekdaysByTask.set(assignment.taskId, days);
            }
        }
        // 泳道行号 = 任务在左侧列表中的位置；保证右侧卡片上下次序与左侧任务列表一致
        const planned = this.plannedTasks();
        const laneByTask = new Map<string, number>();
        planned.forEach((task, index) => laneByTask.set(task.id, index));
        const treeOrder = this.taskTreeOrder();
        Array.from(weekdaysByTask.keys())
            .filter((taskId) => !laneByTask.has(taskId))
            .sort((a, b) => (treeOrder.get(a) ?? Number.MAX_SAFE_INTEGER)
                - (treeOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
                || a.localeCompare(b))
            .forEach((taskId, index) => laneByTask.set(taskId, planned.length + index));
        const segments: { task: PrototypeTask; start: number; end: number; lane: number }[] = [];
        weekdaysByTask.forEach((days, taskId) => {
            const task = tasks.get(taskId);
            if (!task) return;
            const lane = laneByTask.get(taskId) ?? 0;
            const sorted = days.slice().sort((a, b) => a - b)
                .filter((day, index, list) => index === 0 || day !== list[index - 1]);
            let start = sorted[0];
            let prev = sorted[0];
            for (let index = 1; index < sorted.length; index += 1) {
                const day = sorted[index];
                if (day === prev + 1) {
                    prev = day;
                    continue;
                }
                segments.push({ task, start, end: prev, lane });
                start = day;
                prev = day;
            }
            segments.push({ task, start, end: prev, lane });
        });
        segments.sort((a, b) => a.lane - b.lane || a.start - b.start);
        return segments;
    }

    /** 渲染一段跨列任务卡片（第一行任务名称，第二行按天展示预估时长 / 已执行时长 / 完成状态） */
    private renderDaySegment(
        parentEl: HTMLElement,
        segment: { task: PrototypeTask; start: number; end: number; lane: number },
    ): void {
        const { task, start, end, lane } = segment;
        const span = end - start + 1;
        const chip = parentEl.createDiv({ cls: 'plan-week-task-chip plan-week-span-chip' });
        chip.style.gridColumn = `${start} / span ${span}`;
        chip.style.gridRow = String(lane + 1);
        const parentPath = this.taskPath(task);
        chip.title = parentPath ? `${parentPath} > ${task.name}` : task.name;
        const nameRow = chip.createDiv({ cls: 'plan-week-task-chip-name', text: task.name });
        // 第二行：与卡片覆盖的天数同列数，每列展示该天的预估时长、已执行时长与完成状态
        const metaRow = chip.createDiv({ cls: 'plan-week-task-chip-meta' });
        metaRow.style.gridTemplateColumns = `repeat(${span}, minmax(0, 1fr))`;
        for (let offset = 0; offset < span; offset += 1) {
            const weekday = start + offset;
            const dayKey = makeDayKeyFromWeek(this.weekKey, weekday);
            const cell = metaRow.createDiv({ cls: 'plan-week-day-meta' });
            // 第二行开头：完成状态（勾选 / 未完成）
            const completed = this.isDayCompleted(task, dayKey);
            const statusItem = cell.createSpan({
                cls: 'plan-week-day-meta-item plan-week-day-meta-status',
                attr: { 'aria-label': t('panel.dayCompletionToggle') },
            });
            statusItem.title = t('panel.dayCompletionToggle');
            statusItem.toggleClass('is-done', completed);
            setIcon(statusItem, completed ? 'check-circle' : 'circle');
            statusItem.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.hideDayGoalTip();
                void this.toggleDayCompletion(task, dayKey);
            });
            const estimate = this.dayEstimate(task, weekday);
            // 预估时长：未设置时留空占位，不显示内容；有值时从与任务名称对齐的位置开始
            // 靠右排列：与行首完成状态之间留出空白
            const estimateItem = cell.createSpan({ cls: 'plan-week-day-meta-item is-tail' });
            if (estimate) {
                estimateItem.title = `${t('panel.weekGoalEstimateLabel')} ${this.formatMinutesShort(estimate)}`;
                setIcon(estimateItem.createSpan({ cls: 'plan-week-day-meta-icon' }), 'clock');
                estimateItem.createSpan({ cls: 'plan-week-day-meta-text', text: this.formatMinutesShort(estimate) });
            } else {
                estimateItem.addClass('is-empty');
            }
            const executed = this.dayExecutedMinutes(task, dayKey);
            const executedItem = cell.createSpan({ cls: 'plan-week-day-meta-item' });
            executedItem.title = `${t('panel.dayExecutedLabel')} ${this.formatMinutesShort(executed)}`;
            setIcon(executedItem.createSpan({ cls: 'plan-week-day-meta-icon' }), 'play');
            executedItem.createSpan({ cls: 'plan-week-day-meta-text', text: this.formatMinutesShort(executed) });
            // 该天已填写日描述：白点位于任务名称行内，纵向居中于文字，横向与该天列开头完成状态图标中心对齐
            const hasDescription = getDayGoalEntries(task, dayKey).length > 0;
            if (hasDescription) {
                nameRow.addClass('has-desc-dot');
                const dot = nameRow.createSpan({ cls: 'plan-week-day-desc-dot' });
                // 状态图标宽 11px，中心距列左边缘 5.5px；白点宽 4px，左偏移 3.5px 即中心对齐
                dot.style.left = `calc(${(offset * 100) / span}% + 3.5px)`;
            }
        }
        // 左键：同步选中该任务，并在点击的这一天旁打开日描述编辑浮层（阻止冒泡，避免触发列的排布）
        chip.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const rect = chip.getBoundingClientRect();
            const columnWidth = rect.width / span;
            const index = Math.max(0, Math.min(span - 1, Math.floor((evt.clientX - rect.left) / columnWidth)));
            this.selectedTaskId = task.id;
            this.renderTasks();
            this.renderDayGrid();
            this.openDayGoalEditor(task.id, start + index, rect, index, span);
        });
        // 鼠标位于卡片内某一列区域时，该天有日目标则展示悬浮预览（编辑浮层打开时不显示，避免叠加）
        chip.addEventListener('mousemove', (evt) => {
            if (this.dayGoalEditorEl) return;
            const rect = chip.getBoundingClientRect();
            const columnWidth = rect.width / span;
            const index = Math.max(0, Math.min(span - 1, Math.floor((evt.clientX - rect.left) / columnWidth)));
            const weekday = start + index;
            const entries = this.dayGoalEntries(task, weekday);
            if (entries.length === 0) this.hideDayGoalTip();
            else this.showDayGoalTip(task, entries, weekday, rect, index, span);
        });
        chip.addEventListener('mouseleave', () => this.hideDayGoalTip());
        // 右键：阻止浏览器默认菜单，移除右键所在那一天的排布（卡片其余天保留），并自动选中对应任务
        chip.addEventListener('contextmenu', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const rect = chip.getBoundingClientRect();
            const columnWidth = rect.width / span;
            const index = Math.max(0, Math.min(span - 1, Math.floor((evt.clientX - rect.left) / columnWidth)));
            this.panelOptions.planAssignmentRepo.remove(this.weekKey, start + index, task.id);
            this.selectedTaskId = task.id;
            // 该天卡片已被移除，编辑浮层不再对应有效排布，一并关闭
            this.closeDayGoalEditor();
            void this.panelOptions.save();
            this.panelOptions.onChanged?.();
            this.renderDayGrid();
            this.renderTasks();
        });
    }

    /** 选中任务在某一天已填写的日目标（星期 1=周一 … 7=周日） */
    private dayGoalEntries(task: PrototypeTask, weekday: number): TaskDayGoalEntry[] {
        return getDayGoalEntries(task, makeDayKeyFromWeek(this.weekKey, weekday));
    }

    /** 选中任务在某一天的预估时长（分钟，未填写返回 undefined） */
    private dayEstimate(task: PrototypeTask, weekday: number): number | undefined {
        return getDayEstimate(task, makeDayKeyFromWeek(this.weekKey, weekday));
    }

    /** 悬浮预览：在该天卡片区域展示该天已填写的日目标 */
    private showDayGoalTip(
        task: PrototypeTask,
        entries: TaskDayGoalEntry[],
        weekday: number,
        chipRect: DOMRect,
        index: number,
        span: number,
    ): void {
        const tip = this.dayGoalTipEl;
        const key = `${task.id}:${weekday}`;
        if (this.dayGoalTipKey !== key) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, weekday);
            tip.empty();
            tip.createDiv({
                cls: 'plan-week-daygoal-tip-head',
                text: `${this.formatDayLabel(dayKey)} ${t(WEEKDAY_LABEL_KEYS[weekday - 1])}`,
            });
            // 日描述：每天只有一条，悬浮展示内容，不做勾选
            const description = entries[0];
            if (description) {
                const row = tip.createDiv({ cls: 'plan-week-daygoal-tip-item' });
                row.createSpan({ cls: 'plan-week-daygoal-tip-text', text: description.text });
            }
            this.dayGoalTipKey = key;
        }
        tip.style.display = 'flex';
        // 面板根节点为定位参照：横向对齐悬浮所在天，纵向优先显示在卡片下方，空间不足时翻到上方
        const rootRect = this.element.getBoundingClientRect();
        const columnWidth = chipRect.width / span;
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        const rawLeft = chipRect.left - rootRect.left + columnWidth * index;
        const maxLeft = Math.max(8, rootRect.width - width - 8);
        let top = chipRect.bottom - rootRect.top + 6;
        if (top + height > rootRect.height - 8) top = chipRect.top - rootRect.top - height - 6;
        tip.style.left = `${Math.min(Math.max(rawLeft, 8), maxLeft)}px`;
        tip.style.top = `${Math.max(8, top)}px`;
    }

    /** 隐藏日目标悬浮预览，同时清空内容键以便下次重新渲染 */
    private hideDayGoalTip(): void {
        this.dayGoalTipEl.style.display = 'none';
        this.dayGoalTipKey = undefined;
    }

    /** 点击卡片某天：在卡片旁打开该天该任务的日目标编辑浮层（点击外部 / Esc 关闭） */
    private openDayGoalEditor(
        taskId: string,
        weekday: number,
        chipRect: DOMRect,
        index: number,
        span: number,
    ): void {
        this.closeDayGoalEditor();
        this.hideDayGoalTip();
        const editor = this.element.createDiv({ cls: 'plan-week-daygoal-tip plan-week-daygoal-editor' });
        this.dayGoalEditorEl = editor;
        this.dayGoalEditorKey = `${taskId}:${weekday}`;
        this.dayGoalEditorAnchor = { rect: chipRect, index, span };
        this.dayGoalEditorOutsideHandler = (evt: MouseEvent) => {
            if (!editor.contains(evt.target as Node)) this.closeDayGoalEditor();
        };
        this.dayGoalEditorEscapeHandler = (evt: KeyboardEvent) => {
            if (evt.key !== 'Escape') return;
            // 先关闭浮层，避免同时关闭整个面板
            evt.preventDefault();
            evt.stopPropagation();
            this.closeDayGoalEditor();
        };
        document.addEventListener('mousedown', this.dayGoalEditorOutsideHandler, true);
        document.addEventListener('keydown', this.dayGoalEditorEscapeHandler, true);
        this.renderDayGoalEditor();
    }

    /** 关闭日目标编辑浮层（移除元素与 document 监听） */
    private closeDayGoalEditor(): void {
        if (this.dayGoalEditorOutsideHandler) {
            document.removeEventListener('mousedown', this.dayGoalEditorOutsideHandler, true);
            this.dayGoalEditorOutsideHandler = undefined;
        }
        if (this.dayGoalEditorEscapeHandler) {
            document.removeEventListener('keydown', this.dayGoalEditorEscapeHandler, true);
            this.dayGoalEditorEscapeHandler = undefined;
        }
        this.dayGoalEditorEl?.remove();
        this.dayGoalEditorEl = undefined;
        this.dayGoalEditorKey = undefined;
        this.dayGoalEditorAnchor = undefined;
        this.dayGoalEditorInputEl = undefined;
    }

    /** 重绘编辑浮层（日期行 + 新增输入行 + 日目标列表），并按锚点定位 */
    private renderDayGoalEditor(): void {
        const editor = this.dayGoalEditorEl;
        const key = this.dayGoalEditorKey;
        if (!editor || !key) return;
        const [taskId, weekdayText] = key.split(':');
        const weekday = Number(weekdayText);
        const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
        if (!task) {
            this.closeDayGoalEditor();
            return;
        }
        const dayKey = makeDayKeyFromWeek(this.weekKey, weekday);
        editor.empty();
        editor.createDiv({
            cls: 'plan-week-daygoal-tip-head',
            text: `${this.formatDayLabel(dayKey)} ${t(WEEKDAY_LABEL_KEYS[weekday - 1])}`,
        });
        // 日期行下方独立一行：填写该天的预估时长（分钟）
        const estimateRow = editor.createDiv({ cls: 'plan-week-daygoal-estimate' });
        estimateRow.createSpan({ cls: 'plan-week-daygoal-estimate-label', text: t('panel.weekGoalEstimateLabel') });
        const estimateInput = estimateRow.createEl('input', {
            cls: 'plan-week-daygoal-estimate-input',
            attr: { type: 'number', min: '0', step: '5', placeholder: '0' },
        });
        const estimate = getDayEstimate(task, dayKey);
        estimateInput.value = estimate === undefined ? '' : String(estimate);
        const commitEstimate = () => {
            const raw = Number(estimateInput.value);
            const minutes = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
            if (minutes === getDayEstimate(task, dayKey)) return;
            setDayEstimate(task, dayKey, minutes);
            void this.panelOptions.save();
            this.panelOptions.onChanged?.();
            this.renderDayGrid();
        };
        estimateInput.addEventListener('change', commitEstimate);
        estimateInput.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                estimateInput.blur();
            }
        });
        estimateRow.createSpan({ cls: 'plan-week-daygoal-estimate-unit', text: t('panel.weekGoalEstimateUnit') });
        // 日描述：每天只填写一条，回车或失焦保存，清空视为删除
        const descRow = editor.createDiv({ cls: 'task-week-goal-add-row' });
        const descInput = descRow.createEl('input', {
            cls: 'task-week-goal-add-input',
            attr: { type: 'text', placeholder: t('panel.weekGoalAddPlaceholder') },
        });
        this.dayGoalEditorInputEl = descInput;
        const existingDescription = getDayGoalEntries(task, dayKey)[0]?.text ?? '';
        descInput.value = existingDescription;
        const commitDescription = () => {
            const text = descInput.value.trim();
            if (text === existingDescription) return;
            void this.setDayDescription(task, dayKey, text);
        };
        descInput.addEventListener('change', commitDescription);
        descInput.addEventListener('keydown', (evt) => {
            if (evt.key !== 'Enter') return;
            evt.preventDefault();
            descInput.blur();
        });
        this.positionDayGoalEditor();
    }

    /** 按卡片锚点定位编辑浮层：横向对齐所在天，纵向优先显示在卡片下方，空间不足时翻到上方 */
    private positionDayGoalEditor(): void {
        const editor = this.dayGoalEditorEl;
        const anchor = this.dayGoalEditorAnchor;
        if (!editor || !anchor) return;
        const rootRect = this.element.getBoundingClientRect();
        const columnWidth = anchor.rect.width / anchor.span;
        const width = editor.offsetWidth;
        const height = editor.offsetHeight;
        const rawLeft = anchor.rect.left - rootRect.left + columnWidth * anchor.index;
        const maxLeft = Math.max(8, rootRect.width - width - 8);
        let top = anchor.rect.bottom - rootRect.top + 6;
        if (top + height > rootRect.height - 8) top = anchor.rect.top - rootRect.top - height - 6;
        editor.style.left = `${Math.min(Math.max(rawLeft, 8), maxLeft)}px`;
        editor.style.top = `${Math.max(8, top)}px`;
    }

    /** 把左侧选中的任务排布到某一天（同时补入本周整周排布） */
    private assignSelectedTaskToDay(weekday: number): void {
        if (!this.selectedTaskId) return;
        this.panelOptions.planAssignmentRepo.add(this.weekKey, weekday, this.selectedTaskId);
        this.panelOptions.planAssignmentRepo.addWeek(this.weekKey, this.selectedTaskId);
        void this.panelOptions.save();
        this.panelOptions.onChanged?.();
        this.renderDayGrid();
        this.renderSummary();
        this.renderTasks();
    }

    /** 本周已整周排布的任务：去重后按任务树从上到下的位置排序（跳过已删除 / 已归档任务） */
    private plannedTasks(): PrototypeTask[] {
        const tasks = this.panelOptions.getTasks();
        const seen = new Set<string>();
        const result: PrototypeTask[] = [];
        for (const assignment of this.panelOptions.planAssignmentRepo.weekAssignments(this.weekKey)) {
            if (seen.has(assignment.taskId)) continue;
            seen.add(assignment.taskId);
            const task = tasks.find((item) => item.id === assignment.taskId);
            if (task) result.push(task);
        }
        const order = this.taskTreeOrder();
        result.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER)
            - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
        return result;
    }

    /** 任务树从上到下的位置索引：根任务按数组顺序，子任务递归展开 */
    private taskTreeOrder(): Map<string, number> {
        const tasks = this.panelOptions.getTasks();
        const knownIds = new Set(tasks.map((task) => task.id));
        const childrenByParent = new Map<string | undefined, PrototypeTask[]>();
        for (const task of tasks) {
            const parentKey = task.parentId && knownIds.has(task.parentId) ? task.parentId : undefined;
            const list = childrenByParent.get(parentKey) ?? [];
            list.push(task);
            childrenByParent.set(parentKey, list);
        }
        const order = new Map<string, number>();
        let index = 0;
        const visit = (parentId: string | undefined): void => {
            for (const task of childrenByParent.get(parentId) ?? []) {
                if (order.has(task.id)) continue;
                order.set(task.id, index);
                index += 1;
                visit(task.id);
            }
        };
        visit(undefined);
        return order;
    }

    /** 左侧底栏：始终显示本周各分类计划时长 */
    private renderBottom(): void {
        this.bottomEl.empty();
        this.renderWeekCategoryBars();
    }

    /** 本周各分类计划时长：时间盒格子按分类累加（每格 1 小时），未涂色/未匹配归入未分类 */
    private renderWeekCategoryBars(): void {
        const wrap = this.bottomEl.createDiv({ cls: 'plan-week-cat-bars check-cat-bars' });
        wrap.createDiv({ cls: 'check-cat-bars-title', text: t('panel.planWeekCategoryTitle') });

        const cats = this.panelOptions.getCategories();
        const knownIds = new Set(cats.map((cat) => cat.id));
        const minutesByCat = this.panelOptions.timeBoxRepo.weekMinutesByCategory(this.weekKey, knownIds);
        const rows = [
            ...cats.map((cat) => ({
                id: cat.id,
                label: cat.label,
                color: cat.color,
                minutes: minutesByCat.get(cat.id) ?? 0,
            })),
            // 分类表中已包含内置「未分类」时不再追加，避免重复显示
            ...(minutesByCat.has(UNCATEGORIZED_CATEGORY_ID) && !knownIds.has(UNCATEGORIZED_CATEGORY_ID)
                ? [{
                    id: UNCATEGORIZED_CATEGORY_ID,
                    label: t('defaultCategory.uncategorized'),
                    color: '#888888',
                    minutes: minutesByCat.get(UNCATEGORIZED_CATEGORY_ID) ?? 0,
                }]
                : []),
        ];
        const maxMinutes = Math.max(0, ...rows.map((row) => row.minutes));

        for (const row of rows) {
            const rowEl = wrap.createDiv({ cls: 'check-cat-bars-row' });
            rowEl.createSpan({ cls: 'check-cat-bars-dot' }).style.background = row.color ?? '#888888';
            rowEl.createSpan({ cls: 'check-cat-bars-label', text: row.label });
            const track = rowEl.createDiv({ cls: 'check-cat-bars-track is-plain' });
            track.createDiv({ cls: 'check-cat-bars-fill' }).setCssProps({
                '--fill-color': row.color ?? '#888888',
                '--fill-width': `${maxMinutes > 0 ? (row.minutes / maxMinutes) * 100 : 0}%`,
            });
            rowEl.createSpan({ cls: 'check-cat-bars-value', text: this.formatMinutesShort(row.minutes) });
        }
    }

    /** 分钟数格式化为「Xh」/「Xm」（与检查面板分类时长一致） */
    private formatMinutesShort(minutes: number): string {
        if (minutes >= 60) return `${Number((minutes / 60).toFixed(1))}h`;
        return `${Math.round(minutes)}m`;
    }

    /** 分钟数格式化为「1h30m」/「2h」/「30m」（右侧每日分类时长） */
    private formatMinutesLong(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const rest = Math.round(minutes % 60);
        if (hours > 0 && rest > 0) return `${hours}h${rest}m`;
        if (hours > 0) return `${hours}h`;
        return `${rest}m`;
    }

    /**
     * 旧数据迁移：该周此前按周保存的「本周描述」，
     * 在首次选中任务时转入该任务的本周目标，随后清除旧的周级描述。
     */
    private migrateLegacyWeekNote(task: PrototypeTask): void {
        const repo = this.panelOptions.planAssignmentRepo;
        const legacy = repo.weekNote(this.weekKey);
        if (!legacy) return;
        if (!getWeekNote(task, this.weekKey)) {
            setWeekNote(task, this.weekKey, legacy);
        }
        repo.setWeekNote(this.weekKey, '');
        void this.panelOptions.save();
        this.panelOptions.onChanged?.();
    }

    /** 保存某天的日描述：每天只保留一条，清空视为删除（旧的多条仅在保存时清理为一条） */
    private async setDayDescription(task: PrototypeTask, dayKey: string, text: string): Promise<void> {
        if (!text) {
            setDayGoalEntries(task, dayKey, []);
        } else {
            const existing = getDayGoalEntries(task, dayKey)[0];
            const entry: TaskDayGoalEntry = existing
                ? { ...existing, text }
                : {
                    id: `dgoal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    text,
                    createdAt: Date.now(),
                };
            setDayGoalEntries(task, dayKey, [entry]);
        }
        await this.panelOptions.save();
        this.panelOptions.onChanged?.();
        this.afterDayGoalChanged();
    }

    /** 某任务在某天已执行的分钟数（按执行记录 startAt 落在该天累加） */
    private dayExecutedMinutes(task: PrototypeTask, dayKey: string): number {
        const dayStart = new Date(`${dayKey}T00:00:00`).getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        let seconds = 0;
        for (const record of this.panelOptions.taskExecutionRepo.records) {
            if (record.taskId !== task.id) continue;
            if (record.startAt < dayStart || record.startAt >= dayEnd) continue;
            seconds += record.durationSeconds;
        }
        return Math.round(seconds / 60);
    }

    /** 某任务在某天是否已在今日任务卡片中勾选完成 */
    private isDayCompleted(task: PrototypeTask, dayKey: string): boolean {
        return this.panelOptions.taskExecutionRepo.isTaskCompleted(dayKey, task.id);
    }

    /** 切换某天的完成状态（写入今日任务卡片的当日完成标记） */
    private async toggleDayCompletion(task: PrototypeTask, dayKey: string): Promise<void> {
        const repo = this.panelOptions.taskExecutionRepo;
        repo.setTaskCompleted(dayKey, task.id, !repo.isTaskCompleted(dayKey, task.id));
        await this.panelOptions.save();
        this.panelOptions.onChanged?.();
        this.renderDayGrid();
    }

    /** 日目标变更后刷新相关区域：七列卡片标识 + 编辑浮层内容 */
    private afterDayGoalChanged(): void {
        this.renderDayGrid();
        if (this.dayGoalEditorEl) this.renderDayGoalEditor();
    }

    /** 当前选中并绑定日目标的任务 */
    private selectedTask(): PrototypeTask | undefined {
        if (!this.selectedTaskId) return undefined;
        return this.panelOptions.getTasks().find((task) => task.id === this.selectedTaskId);
    }

    /** 当前周的日期范围文案（如 11/03 - 11/09） */
    private formatWeekRange(): string {
        const monday = makeDayKeyFromWeek(this.weekKey, 1);
        const sunday = makeDayKeyFromWeek(this.weekKey, 7);
        const format = (dayKey: string): string =>
            `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`;
        return `${format(monday)} - ${format(sunday)}`;
    }
}

// 目标面板：左侧为根任务下拉与目标列表（该根任务下的目标类型任务，点击定位其截止周），
// 右侧为年-周泳道图（按季度翻页，仅展示根任务一行，读取计划整周排布）。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { t } from '../../../core/i18n';
import type { PlanAssignmentRepo } from '../../../core/repos/plan-assignment-repo';
import type { PlanCategory } from '../../../core/shared/plan-category-manager';
import {
    getCurrentWeekKey,
    getISOWeek,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
    shiftWeekKey,
} from '../../../core/shared/plan-data';
import { getTaskGoalConfig } from '../../../core/shared/task-sections';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';

/** 季度内的一周 */
interface QuarterWeek {
    /** 周键（ISO 周，如 2026-W45） */
    weekKey: string;
    /** 周号（1-53） */
    week: number;
    /** 周一日期键（YYYY-MM-DD） */
    mondayKey: string;
}

/** 泳道行内的排布区间（列下标为季度内周列下标） */
interface BarRange {
    /** 起始列下标（含） */
    startIndex: number;
    /** 结束列下标（含） */
    endIndex: number;
}

/** 目标面板配置 */
export interface GoalBoardPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「目标」 */
    title?: string;
    /** 任务数据源（每次打开时重新读取） */
    getTasks: () => PrototypeTask[];
    /** 分类数据源（色块使用分类颜色） */
    getCategories: () => PlanCategory[];
    /** 计划排布数据仓库（与计划面板共享，只读） */
    planAssignmentRepo: PlanAssignmentRepo;
}

/** 目标面板 */
export class GoalBoardPanel extends FloatingPanel {
    private rootSelectEl!: HTMLSelectElement;
    /** 左侧目标列表容器 */
    private goalListEl!: HTMLElement;
    private navEl!: HTMLElement;
    private weekHeaderEl!: HTMLElement;
    private laneEl!: HTMLElement;

    /** 当前年份 */
    private year: number;
    /** 当前季度（1-4） */
    private quarter: number;
    /** 下拉选中的根任务 id */
    private rootTaskId: string | undefined;
    /** 当前季度内的周列表 */
    private quarterWeeks: QuarterWeek[] = [];
    /** 当前季度内的周键 → 周格子（左侧列表点击定位用） */
    private weekCellMap = new Map<string, HTMLElement>();

    constructor(private readonly panelOptions: GoalBoardPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.goalBoardTitle'),
            ...panelOptions,
        });
        this.body.addClass('goal-board-panel');
        const current = parseWeekKey(getCurrentWeekKey());
        this.year = current.year;
        this.quarter = this.getQuarterOfMonth(new Date().getMonth() + 1);
        this.renderLayout();
    }

    /** 每次打开时刷新根任务下拉，避免任务面板新增后下拉不更新 */
    override open(): void {
        this.refreshRootSelect();
        super.open();
    }

    /** 月份对应的季度（1-4） */
    private getQuarterOfMonth(month: number): number {
        return Math.floor((month - 1) / 3) + 1;
    }

    private renderLayout(): void {
        // 左侧：任务配置面板（根任务下拉在上，目标通用配置在下）
        const left = this.body.createDiv({ cls: 'goal-board-left' });
        const config = left.createDiv({ cls: 'goal-board-config' });

        config.createDiv({ cls: 'goal-board-config-title', text: t('panel.planWeekRootTask') });
        this.rootSelectEl = config.createEl('select', { cls: 'dropdown goal-board-root-select' });
        this.rootSelectEl.addEventListener('change', () => {
            this.rootTaskId = this.rootSelectEl.value || undefined;
            this.renderQuarter();
        });

        config.createDiv({ cls: 'goal-board-config-divider' });
        config.createDiv({ cls: 'goal-board-config-title', text: t('panel.planAnnualGoal') });
        this.goalListEl = config.createDiv({ cls: 'goal-board-goal-list' });

        // 右侧：季度导航 + 周表头 + 泳道
        const right = this.body.createDiv({ cls: 'plan-annual-right goal-board-right' });
        this.navEl = right.createDiv({ cls: 'plan-annual-nav' });
        this.weekHeaderEl = right.createDiv({ cls: 'plan-annual-header' });
        this.laneEl = right.createDiv({ cls: 'plan-annual-lanes' });

        this.refreshRootSelect();
    }

    /** 重建根任务下拉（默认第一个根任务），并重绘右侧 */
    private refreshRootSelect(): void {
        const roots = this.panelOptions.getTasks().filter((task) => !task.parentId);
        if (!roots.some((task) => task.id === this.rootTaskId)) {
            this.rootTaskId = roots[0]?.id;
        }
        this.rootSelectEl.empty();
        if (roots.length === 0) {
            const option = this.rootSelectEl.createEl('option', { text: t('panel.planNoTask') });
            option.value = '';
            this.rootTaskId = undefined;
        } else {
            for (const task of roots) {
                const option = this.rootSelectEl.createEl('option', { text: task.name });
                option.value = task.id;
            }
            this.rootSelectEl.value = this.rootTaskId ?? '';
        }
        this.renderGoalList();
        this.renderQuarter();
    }

    /** 左侧目标列表：列出该根任务下全部「目标」类型任务，点击定位其截止周 */
    private renderGoalList(): void {
        if (!this.goalListEl) return;
        this.goalListEl.empty();
        const task = this.rootTaskId
            ? this.panelOptions.getTasks().find((item) => item.id === this.rootTaskId)
            : undefined;
        if (!task) {
            this.goalListEl.createDiv({ cls: 'goal-board-goal-empty', text: t('panel.goalBoardGoalsEmpty') });
            return;
        }
        const goals = this.collectDescendantTasks(task.id).filter((item) => item.kind === 'goal');
        if (goals.length === 0) {
            this.goalListEl.createDiv({ cls: 'goal-board-goal-empty', text: t('panel.goalBoardGoalsEmpty') });
            return;
        }
        for (const goal of goals) {
            const row = this.goalListEl.createDiv({ cls: 'goal-board-goal-item' });
            row.createSpan({ cls: 'goal-board-goal-text', text: goal.name, attr: { title: goal.name } });
            const deadlineWeek = getTaskGoalConfig(goal).deadlineWeek;
            if (!deadlineWeek) continue;
            row.createSpan({ cls: 'goal-board-goal-week', text: this.shortWeekLabel(deadlineWeek) });
            // 仅在设置了截止周时允许点击定位，避免无目标地跳转
            row.addClass('is-clickable');
            row.addEventListener('click', () => this.locateWeek(deadlineWeek));
        }
    }

    /** 周键的短标签（如 W45） */
    private shortWeekLabel(weekKey: string): string {
        const matched = weekKey.match(/^(\d{4})-W(\d{2})$/);
        return matched ? `W${matched[2]}` : weekKey;
    }

    /** 定位到某周：必要时切换季度，滚动到周格并短暂高亮 */
    private locateWeek(weekKey: string): void {
        const mondayKey = makeDayKeyFromWeek(weekKey, 1);
        const year = Number(mondayKey.slice(0, 4));
        const quarter = this.getQuarterOfMonth(Number(mondayKey.slice(5, 7)));
        if (year !== this.year || quarter !== this.quarter) {
            this.year = year;
            this.quarter = quarter;
            this.renderQuarter();
        }
        const cell = this.weekCellMap.get(weekKey);
        if (!cell) return;
        const cellRect = cell.getBoundingClientRect();
        const laneRect = this.laneEl.getBoundingClientRect();
        this.laneEl.scrollTop += cellRect.top - laneRect.top - laneRect.height / 2 + cellRect.height / 2;
        cell.addClass('is-located');
        window.setTimeout(() => cell.removeClass('is-located'), 1600);
    }

    /** 重绘季度导航、周表头与泳道 */
    private renderQuarter(): void {
        this.quarterWeeks = this.buildQuarterWeeks(this.year, this.quarter);
        this.renderNav();
        this.renderHeader();
        this.renderLanes();
    }

    private renderNav(): void {
        this.navEl.empty();
        const prev = this.navEl.createEl('button', { cls: 'plan-nav-btn', text: '←', attr: { type: 'button' } });
        prev.addEventListener('click', () => this.shiftQuarter(-1));
        this.navEl.createSpan({
            cls: 'plan-nav-label',
            text: t('panel.planAnnualQuarter', { year: String(this.year), quarter: String(this.quarter) }),
        });
        const next = this.navEl.createEl('button', { cls: 'plan-nav-btn', text: '→', attr: { type: 'button' } });
        next.addEventListener('click', () => this.shiftQuarter(1));
    }

    /** 季度翻页：Q4 向后进入下一年 Q1，Q1 向前回到上一年 Q4 */
    private shiftQuarter(delta: number): void {
        let quarter = this.quarter + delta;
        let year = this.year;
        if (quarter < 1) {
            quarter = 4;
            year -= 1;
        } else if (quarter > 4) {
            quarter = 1;
            year += 1;
        }
        this.year = year;
        this.quarter = quarter;
        this.renderQuarter();
    }

    /** 周列表头：每列 W45 + 周一日期，跨入新月份时左上角标注月份 */
    private renderHeader(): void {
        this.weekHeaderEl.empty();
        const currentWeekKey = getCurrentWeekKey();
        for (const item of this.quarterWeeks) {
            const cell = this.weekHeaderEl.createDiv({ cls: 'plan-annual-header-cell' });
            if (item.weekKey === currentWeekKey) cell.addClass('is-current');
            const month = Number(item.mondayKey.slice(5, 7));
            const prevMonday = makeDayKeyFromWeek(shiftWeekKey(item.weekKey, -1), 1);
            if (month !== Number(prevMonday.slice(5, 7))) {
                cell.createSpan({ cls: 'plan-annual-header-month', text: `${month}月` });
            }
            cell.createSpan({ cls: 'plan-annual-header-week', text: `W${String(item.week).padStart(2, '0')}` });
            cell.createSpan({
                cls: 'plan-annual-header-date',
                text: `${month}/${Number(item.mondayKey.slice(8, 10))}`,
            });
        }
    }

    /** 泳道行：仅根任务一行，绘制整周排布区间色块 */
    private renderLanes(): void {
        this.laneEl.empty();
        this.weekCellMap.clear();
        const task = this.rootTaskId
            ? this.panelOptions.getTasks().find((item) => item.id === this.rootTaskId)
            : undefined;
        if (!task) {
            this.laneEl.createDiv({ cls: 'interface-today-empty', text: t('panel.planNoTask') });
            return;
        }

        const row = this.laneEl.createDiv({ cls: 'plan-annual-lane-row' });
        row.dataset.taskId = task.id;

        // 背景层：每列一个元素，负责竖向分隔线与当前周标识
        const columnsEl = row.createDiv({ cls: 'plan-annual-lane-columns' });
        const currentWeekKey = getCurrentWeekKey();
        for (const item of this.quarterWeeks) {
            const column = columnsEl.createDiv({ cls: 'plan-annual-lane-column' });
            column.toggleClass('is-current', item.weekKey === currentWeekKey);
        }

        const range = this.buildBarRange(task);
        if (range) {
            const color = this.panelOptions.getCategories().find((category) => category.id === task.categoryId)?.color
                ?? '#888888';
            const barEl = row.createDiv({ cls: 'plan-annual-bar' });
            barEl.style.left = `${(range.startIndex / this.quarterWeeks.length) * 100}%`;
            barEl.style.width = `${((range.endIndex - range.startIndex + 1) / this.quarterWeeks.length) * 100}%`;
            barEl.style.setProperty('--plan-bar-color', color);
            const status = task.status ?? 'notStarted';
            barEl.toggleClass('is-in-progress', status === 'inProgress');
            barEl.toggleClass('is-done', status === 'done');
            barEl.toggleClass('is-paused', status === 'paused');
            barEl.toggleClass('is-not-started', status === 'notStarted');
        }

        // 周格层：每个目标独占一行，行按周从左到右、周内按任务树顺序依次分配
        const goalsByWeek = this.collectGoalTasksByWeek(task.id);
        const weekLayer = row.createDiv({ cls: 'plan-annual-week-hit-layer' });
        const cells = this.quarterWeeks.map((item) => {
            const cell = weekLayer.createDiv({ cls: 'plan-annual-week-hit' });
            this.weekCellMap.set(item.weekKey, cell);
            return cell;
        });
        const placements: Array<{ goal: PrototypeTask; cell: HTMLElement }> = [];
        this.quarterWeeks.forEach((item, index) => {
            for (const goal of goalsByWeek.get(item.weekKey) ?? []) {
                placements.push({ goal, cell: cells[index] });
            }
        });
        const rowHeight = 13;
        const layerHeight = Math.max(26, placements.length * rowHeight + 4);
        weekLayer.style.height = `${layerHeight}px`;
        const topOffset = (layerHeight - placements.length * rowHeight) / 2;
        placements.forEach(({ goal, cell }, index) => {
            const goalItem = cell.createDiv({ cls: 'goal-board-weekgoal-item' });
            goalItem.style.top = `${topOffset + index * rowHeight}px`;
            goalItem.toggleClass('is-done', goal.status === 'done');
            goalItem.setAttribute('title', goal.name);
            setIcon(goalItem.createSpan({ cls: 'goal-board-weekgoal-icon' }), 'target');
            goalItem.createSpan({ cls: 'goal-board-weekgoal-name', text: goal.name });
        });
    }

    /** 根任务的全部后代子任务（按任务树顺序） */
    private collectDescendantTasks(rootId: string): PrototypeTask[] {
        const tasks = this.panelOptions.getTasks();
        const result: PrototypeTask[] = [];
        const collect = (parentId: string): void => {
            for (const child of tasks.filter((task) => task.parentId === parentId)) {
                result.push(child);
                collect(child.id);
            }
        };
        collect(rootId);
        return result;
    }

    /** 按截止周分组的目标类型任务（仅包含已设置截止周的目标） */
    private collectGoalTasksByWeek(rootId: string): Map<string, PrototypeTask[]> {
        const result = new Map<string, PrototypeTask[]>();
        for (const goal of this.collectDescendantTasks(rootId)) {
            if (goal.kind !== 'goal') continue;
            const weekKey = getTaskGoalConfig(goal).deadlineWeek;
            if (!weekKey) continue;
            const list = result.get(weekKey) ?? [];
            list.push(goal);
            result.set(weekKey, list);
        }
        return result;
    }

    /** 任务整周排布在当前季度内的区间（无交集时返回 null） */
    private buildBarRange(task: PrototypeTask): BarRange | null {
        const weekKeys = this.panelOptions.planAssignmentRepo
            .taskWeekAssignments(task.id)
            .map((assignment) => assignment.weekKey)
            .sort((a, b) => this.weekTime(a) - this.weekTime(b));
        if (weekKeys.length === 0) return null;
        const startTime = this.weekTime(weekKeys[0]);
        const endTime = this.weekTime(weekKeys[weekKeys.length - 1]);
        const first = this.quarterWeeks[0];
        const last = this.quarterWeeks[this.quarterWeeks.length - 1];
        if (!first || !last) return null;
        const quarterStart = this.weekTime(first.weekKey);
        const quarterEnd = this.weekTime(last.weekKey);
        // 区间与当前季度无交集时不显示
        if (endTime < quarterStart || startTime > quarterEnd) return null;
        const startIndex = Math.max(0, this.quarterWeeks.findIndex((item) => this.weekTime(item.weekKey) >= startTime));
        let endIndex = this.quarterWeeks.length - 1;
        for (let i = this.quarterWeeks.length - 1; i >= 0; i -= 1) {
            if (this.weekTime(this.quarterWeeks[i].weekKey) <= endTime) {
                endIndex = i;
                break;
            }
        }
        return { startIndex, endIndex };
    }

    /** 周键对应周一的时间戳（用于跨年周的正确比较） */
    private weekTime(weekKey: string): number {
        return new Date(`${makeDayKeyFromWeek(weekKey, 1)}T00:00:00`).getTime();
    }

    /** 季度内的周列表（周一为基准） */
    private buildQuarterWeeks(year: number, quarter: number): QuarterWeek[] {
        const result: QuarterWeek[] = [];
        const date = new Date(year, 0, 1);
        // 定位到 1 月 1 日之后的第一个周一
        date.setDate(date.getDate() + ((8 - (date.getDay() || 7)) % 7));
        while (date.getFullYear() === year) {
            if (this.getQuarterOfMonth(date.getMonth() + 1) === quarter) {
                const week = getISOWeek(date);
                result.push({
                    weekKey: makeWeekKey(date.getFullYear(), week),
                    week,
                    mondayKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
                });
            }
            date.setDate(date.getDate() + 7);
        }
        return result;
    }
}

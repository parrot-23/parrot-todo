// 统计面板：基于 FloatingPanel，独立的「统计」视图（功能面板一级菜单「统计」）。
// 结构：顶部选项卡（统计 / 任务记录）+ 周数切换。
// 统计：本周七天，每天两个方框（分类已执行时长 / 任务占比）；
// 任务记录：每天一张卡片（只显示有记录的日期），视觉复用检查面板的记录卡片样式。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { renderPie } from '../../../charts/primitives/pie';
import { t, getWeekDays } from '../../../core/i18n';
import type { TaskExecutionRepo } from '../../../core/repos/task-execution-repo';
import type { PlanCategoryData } from '../../../core/shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../../../core/shared/plan-category-manager';
import { getCurrentWeekKey, makeDayKeyFromWeek, parseWeekKey, shiftWeekKey } from '../../../core/shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';

/** 统计面板配置 */
export interface StatsPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「统计」 */
    title?: string;
    /** 分类数据（颜色来源，与图例一致） */
    categoryData: PlanCategoryData;
    /** 任务执行记录仓库（统计的数据来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 原型任务数据源（用于按任务取分类颜色与名称） */
    getTasks: () => PrototypeTask[];
    /** 点击右上角「数据」按钮的回调 */
    onOpenData?: () => void;
}

/** 顶部选项卡 */
type StatsTab = 'stats' | 'records';

/** 统计面板 */
export class StatsPanel extends FloatingPanel {
    private statsTabEl!: HTMLElement;
    private recordsTabEl!: HTMLElement;
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
        this.statsTabEl.addEventListener('click', () => this.switchTab('stats'));
        this.recordsTabEl.addEventListener('click', () => this.switchTab('records'));

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
        this.renderPane();
    }

    /** 重绘内容区：周数切换 + 当前选项卡内容 */
    private renderPane(): void {
        this.paneEl.empty();
        this.renderWeekNav();
        if (this.tab === 'stats') this.renderStatsDays();
        if (this.tab === 'records') this.renderRecords();
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
    // ===== 任务记录：每天一张卡片（只显示有记录的日期） =====
    private renderRecords(): void {
        const list = this.paneEl.createDiv({ cls: 'check-records-list' });
        const weekDays = getWeekDays();
        const tasks = this.panelOptions.getTasks();
        let total = 0;

        for (let day = 1; day <= 7; day++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, day);
            const [year, month, date] = dayKey.split('-').map(Number);
            const dayStart = new Date(year, month - 1, date).getTime();
            const dayEnd = dayStart + 24 * 3600000;
            // 按开始时间归入当天，跨天记录只在起始日出现一次
            const records = this.panelOptions.taskExecutionRepo.records
                .filter((record) => record.startAt >= dayStart && record.startAt < dayEnd)
                .sort((a, b) => a.startAt - b.startAt);
            if (records.length === 0) continue;
            total += records.length;

            const card = list.createDiv({ cls: 'check-records-card' });
            const title = `${weekDays[day - 1]} ${month}/${date}`;
            const head = card.createDiv({ cls: 'check-records-card-head' });
            head.createDiv({ cls: 'check-records-card-title', text: title });
            const copyBtn = head.createEl('button', {
                cls: 'check-records-card-copy',
                attr: { type: 'button', 'aria-label': t('panel.checkRecordsCopy') },
            });
            setIcon(copyBtn, 'copy');

            const items = card.createDiv({ cls: 'check-records-items' });
            // 复制到剪贴板的文本：卡片标题 + 每条记录 + 分类汇总
            const lines: string[] = [title];
            // 当天各分类累计时长（秒），用于卡片底部的分类汇总行
            const secondsByCategory = new Map<string, number>();
            for (const record of records) {
                const task = tasks.find((item) => item.id === record.taskId);
                const time = `${formatTimestamp(record.startAt)}-${formatTimestamp(record.endAt)}`;
                const name = task?.name ?? t('panel.checkRecordsUnknownTask');
                const duration = formatDurationSeconds(record.durationSeconds);
                const typeLabel = task
                    ? (task.type === 'main' ? t('panel.mainTaskBadge') : t('panel.sideTaskBadge'))
                    : '';
                const row = items.createDiv({ cls: 'check-records-item' });
                row.createSpan({ cls: 'check-records-item-time', text: time });
                // 任务名称前的分类色点（与卡片底部汇总行的色点一致）
                const category = this.panelOptions.categoryData.categories
                    .find((item) => item.id === task?.categoryId);
                row.createSpan({ cls: 'check-records-item-dot' }).setCssStyles({ background: category?.color ?? '#888888' });
                row.createSpan({ cls: 'check-records-item-name', text: name });
                row.createSpan({ cls: 'check-records-item-duration', text: duration });
                if (task) {
                    row.createSpan({
                        cls: `check-records-item-badge ${task.type === 'main' ? 'is-main' : 'is-side'}`,
                        text: typeLabel,
                    });
                }
                lines.push([time, name, duration, typeLabel].filter(Boolean).join(' '));
                const categoryId = task?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
                secondsByCategory.set(categoryId, (secondsByCategory.get(categoryId) ?? 0) + record.durationSeconds);
            }
            this.renderRecordCategorySummary(card, secondsByCategory, lines);
            copyBtn.addEventListener('click', () => void this.copyRecordCardText(copyBtn, lines));
        }

        if (total === 0) {
            list.createDiv({ cls: 'check-records-empty', text: t('panel.checkRecordsEmpty') });
        }
    }

    /** 卡片底部分类汇总行：分类标题 + 每个分类当天的累计时长（只列出有记录的分类） */
    private renderRecordCategorySummary(
        card: HTMLElement,
        secondsByCategory: Map<string, number>,
        lines: string[],
    ): void {
        const categories = this.panelOptions.categoryData.categories;
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
                this.renderRecordCategoryItem(itemsEl, category.label, category.color ?? '#888888', seconds);
                parts.push(`${category.label} ${formatDurationSeconds(seconds)}`);
            }
        }
        const restSeconds = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
        if (restSeconds > 0) {
            this.renderRecordCategoryItem(itemsEl, t('inbox.noCategory'), '#888888', restSeconds);
            parts.push(`${t('inbox.noCategory')} ${formatDurationSeconds(restSeconds)}`);
        }
        if (parts.length > 0) {
            lines.push(`${t('panel.checkRecordsCategory')}: ${parts.join('  ')}`);
        }
    }

    /** 分类汇总中的单项：色点 + 分类名 + 累计时长 */
    private renderRecordCategoryItem(parentEl: HTMLElement, label: string, color: string, seconds: number): void {
        const item = parentEl.createDiv({ cls: 'check-records-summary-item' });
        item.createSpan({ cls: 'check-records-summary-dot' }).setCssStyles({ background: color });
        item.createSpan({ cls: 'check-records-summary-label', text: label });
        item.createSpan({ cls: 'check-records-summary-duration', text: formatDurationSeconds(seconds) });
    }

    /** 复制当天卡片的内容文字到剪贴板（图标短暂切换为对勾作为反馈） */
    private async copyRecordCardText(button: HTMLElement, lines: string[]): Promise<void> {
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
}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${Number((minutes / 60).toFixed(1))}h`;
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

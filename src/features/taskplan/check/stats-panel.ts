// 统计面板：基于 FloatingPanel，独立的「统计」视图（功能面板一级菜单「统计」）。
// 结构：顶部选项卡（统计 / 任务记录）+ 周数切换。
// 统计：本周七天，每天两个方框（分类已执行时长 / 任务占比）；
// 任务记录：每天一张卡片（只显示有记录的日期），视觉复用检查面板的记录卡片样式。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
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
        const tabs = this.body.createDiv({ cls: 'plan-tabs' });
        this.statsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkStatsCategory') });
        this.recordsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkRecords') });
        this.statsTabEl.addEventListener('click', () => this.switchTab('stats'));
        this.recordsTabEl.addEventListener('click', () => this.switchTab('records'));

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

        const pie = content.createDiv({ cls: 'today-task-share-pie' });
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'today-task-share-svg');
        pie.appendChild(svg);

        const cx = 50;
        const cy = 50;
        const r = 50;
        const dividerWidth = 2;
        const slices: { label: string; midDeg: number; ratio: number }[] = [];
        let acc = 0;
        for (const [taskId, minutes] of Array.from(minutesByTask.entries())) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const cat = task?.categoryId
                ? this.panelOptions.categoryData.categories.find((item) => item.id === task.categoryId)
                : undefined;
            const color = cat?.color ?? '#888888';
            const startDeg = (acc / totalMinutes) * 360;
            acc += minutes;
            const endDeg = (acc / totalMinutes) * 360;

            const path = document.createElementNS(svgNs, 'path');
            path.setAttribute('d', describePieSlice(cx, cy, r, startDeg, endDeg));
            path.setAttribute('fill', color);
            svg.appendChild(path);

            slices.push({
                label: task?.name ?? t('inbox.noCategory'),
                midDeg: (startDeg + endDeg) / 2,
                ratio: minutes / totalMinutes,
            });
        }

        if (minutesByTask.size > 1) {
            let boundaryDeg = 0;
            for (const minutes of Array.from(minutesByTask.values())) {
                const rad = ((boundaryDeg - 90) * Math.PI) / 180;
                const line = document.createElementNS(svgNs, 'line');
                line.setAttribute('x1', String(cx));
                line.setAttribute('y1', String(cy));
                line.setAttribute('x2', String(cx + r * Math.cos(rad)));
                line.setAttribute('y2', String(cy + r * Math.sin(rad)));
                line.setAttribute('stroke', '#ffffff');
                line.setAttribute('stroke-width', String(dividerWidth));
                svg.appendChild(line);
                boundaryDeg += (minutes / totalMinutes) * 360;
            }
        }

        for (const slice of slices) {
            if (slice.ratio < 0.06) continue;
            const label = pie.createDiv({ cls: 'today-task-share-slice-label', text: slice.label });
            label.setCssProps({ '--slice-angle': `${slice.midDeg}deg` });
        }

        const list = content.createDiv({ cls: 'today-task-share-list' });
        const sortedEntries = Array.from(minutesByTask.entries()).sort((a, b) => b[1] - a[1]);
        for (const [taskId, minutes] of sortedEntries) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const cat = task?.categoryId
                ? this.panelOptions.categoryData.categories.find((item) => item.id === task.categoryId)
                : undefined;
            const color = cat?.color ?? '#888888';
            const label = task?.name ?? t('inbox.noCategory');

            const row = list.createDiv({ cls: 'today-task-share-row' });
            const dot = row.createSpan({ cls: 'today-task-share-dot' });
            dot.setCssProps({ '--dot-color': color });
            row.createSpan({ cls: 'today-task-share-name', text: label });
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

/** 生成 SVG 饼图扇区路径（从 12 点方向顺时针计算角度） */
function describePieSlice(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
    const span = endDeg - startDeg;
    if (span >= 359.999) {
        return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
    }
    const toPoint = (deg: number) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    };
    const p0 = toPoint(startDeg);
    const p1 = toPoint(endDeg);
    const largeArc = span > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y} Z`;
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

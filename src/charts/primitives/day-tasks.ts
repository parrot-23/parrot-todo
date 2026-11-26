// 当天任务表格图元：与「习惯」表格同构的 9 列结构。
// 列：任务名称 | 完成情况 | 周一 … 周日；格子只区分「已完成 / 未完成」，未安排显示占位符。
// 纯 DOM 绘制，数据与文案由调用方准备。

/** 单元格状态：未安排 / 已安排未完成 / 已完成 */
export type DayTaskState = 'off' | 'pending' | 'done';

/** 表格的一行（一个任务） */
export interface DayTaskRow {
    /** 任务 id（提供时该行可点击） */
    id?: string;
    /** 任务名称 */
    label: string;
    /** 完成情况，如「3 / 5」 */
    summary: string;
    /** 是否为额外任务 */
    extra?: boolean;
    /** 周一至周日 7 天的状态 */
    days: DayTaskState[];
}

export interface DayTasksOptions {
    /** 第一列表头（任务） */
    nameLabel: string;
    /** 第二列表头（完成情况） */
    summaryLabel: string;
    /** 周一至周日表头（名称 + 可选日期） */
    dayLabels: { name: string; sub?: string }[];
    /** 没有任务时的占位文案 */
    emptyText?: string;
    /** 额外任务标签文案 */
    extraLabel?: string;
    /** 点击行时回传任务 id */
    onRowClick?: (id: string) => void;
}

/** 当天任务表格：9 列，行 = 本周出现过的任务 */
export function renderDayTasks(
    container: HTMLElement,
    rows: DayTaskRow[],
    options: DayTasksOptions,
): void {
    const table = container.createDiv({ cls: 'wb-day-tasks' });

    const head = table.createDiv({ cls: 'wb-day-tasks-row is-head' });
    head.createDiv({ cls: 'wb-day-tasks-cell is-name', text: options.nameLabel });
    head.createDiv({ cls: 'wb-day-tasks-cell is-total', text: options.summaryLabel });
    for (const label of options.dayLabels) {
        const cell = head.createDiv({ cls: 'wb-day-tasks-cell is-day' });
        cell.createSpan({ cls: 'wb-day-tasks-day-name', text: label.name });
        if (label.sub) cell.createSpan({ cls: 'wb-day-tasks-day-date', text: label.sub });
    }

    if (rows.length === 0) {
        table.createDiv({ cls: 'wb-day-tasks-empty', text: options.emptyText ?? '' });
        return;
    }

    for (const row of rows) {
        const rowEl = table.createDiv({ cls: 'wb-day-tasks-row' });
        const rowId = row.id;
        if (rowId && options.onRowClick) {
            rowEl.addClass('is-clickable');
            rowEl.addEventListener('click', () => options.onRowClick?.(rowId));
        }

        const nameCell = rowEl.createDiv({ cls: 'wb-day-tasks-cell is-name' });
        nameCell.createSpan({ cls: 'wb-day-tasks-name', text: row.label });
        if (row.extra && options.extraLabel) {
            nameCell.createSpan({ cls: 'wb-day-tasks-extra-tag', text: options.extraLabel });
        }

        rowEl.createDiv({ cls: 'wb-day-tasks-cell is-total', text: row.summary });

        for (const state of row.days) {
            const cell = rowEl.createDiv({ cls: 'wb-day-tasks-cell is-day' });
            cell.toggleClass('is-off', state === 'off');
            cell.toggleClass('is-pending', state === 'pending');
            cell.toggleClass('is-done', state === 'done');
            cell.setText(state === 'done' ? '✓' : state === 'pending' ? '○' : '—');
        }
    }
}

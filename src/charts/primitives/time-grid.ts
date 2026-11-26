// 图元：时间轴轨道（24 小时 × N 列）。
// 列标题、区块颜色与提示文案均由调用方准备；图元只负责按分钟定位色块。
import type { TimeGridOptions } from './types';

/** 默认刻度文案：分钟数 → HH:MM */
function defaultTickLabel(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 渲染时间轴轨道 */
export function renderTimeGrid(container: HTMLElement, options: TimeGridOptions): void {
    const dayMinutes = options.dayMinutes ?? 1440;
    const tickMinutes = options.tickMinutes ?? 120;
    const formatTick = options.formatTick ?? defaultTickLabel;
    const width = options.width ?? 320;
    const height = options.height ?? 320;

    const grid = container.createDiv({ cls: 'wb-timegrid' });
    grid.setCssStyles({
        width: `${width}px`,
        height: `${height}px`,
        flex: `0 0 ${width}px`,
    });

    // 左侧时间刻度
    const axis = grid.createDiv({ cls: 'wb-timegrid-axis' });
    for (let minutes = 0; minutes < dayMinutes; minutes += tickMinutes) {
        axis.createDiv({ cls: 'wb-timegrid-axis-cell', text: formatTick(minutes) });
    }

    // 列 × 背景轨道 × 时间区块
    const cols = grid.createDiv({ cls: 'wb-timegrid-cols' });
    for (const column of options.columns) {
        const col = cols.createDiv({ cls: 'wb-timegrid-col' });
        col.createDiv({ cls: 'wb-timegrid-col-title', text: column.label });
        const track = col.createDiv({ cls: 'wb-timegrid-track' });

        for (const block of options.blocks) {
            if (block.column !== column.key) continue;
            const span = Math.max(0, block.end - block.start);
            if (span <= 0) continue;
            const blockEl = track.createDiv({ cls: 'wb-timegrid-block' });
            blockEl.setCssProps({
                '--block-color': block.color ?? '#888888',
                '--block-top': `${(block.start / dayMinutes) * 100}%`,
                '--block-height': `${(span / dayMinutes) * 100}%`,
            });
            if (block.title) blockEl.setAttribute('title', block.title);
        }
    }
}

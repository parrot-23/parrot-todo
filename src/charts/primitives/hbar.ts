// 图元：横向条（单条 / 双条对比 / 共用比例尺 / 子行）。
// 只往传入容器里追加行元素，容器与标题、排序、交互由调用方负责。
import type { HBarItem, HBarOptions } from './types';

/** 默认条色（无分类颜色时） */
const DEFAULT_FILL = '#888888';

/**
 * 渲染一组横向条。
 * @returns 每行的根元素，供调用方追加装饰（图标、事件、展开内容）
 */
export function renderHBars(container: HTMLElement, items: HBarItem[], options: HBarOptions = {}): HTMLElement[] {
    const formatValue = options.formatValue ?? ((value: number) => String(Math.round(value)));

    if (items.length === 0) {
        if (options.emptyText) container.createDiv({ cls: 'wb-hbar-empty', text: options.emptyText });
        return [];
    }

    const variant = options.variant ?? 'default';
    const scale = options.scale ?? Math.max(0, ...items.map((item) => Math.max(item.value, item.compare ?? 0)));
    const widthOf = (value: number): string => `${scale > 0 ? (value / scale) * 100 : 0}%`;

    const rows: HTMLElement[] = [];
    for (const item of items) {
        const row = container.createDiv({
            cls: 'wb-hbar-row'
                + (variant === 'small' ? ' is-small' : '')
                + (options.rowInteractive ? ' is-clickable' : ''),
        });

        if (variant !== 'small') {
            row.createSpan({ cls: 'wb-hbar-dot' }).setCssStyles({ background: item.color ?? DEFAULT_FILL });
        }
        row.createSpan({
            cls: `wb-hbar-label${variant === 'small' ? ' is-small' : ''}`,
            text: item.label,
            attr: { title: item.label },
        });

        if (item.compare !== undefined) {
            // 双条：上灰（对比值）/ 下分类色（主值）
            const dual = row.createDiv({ cls: 'wb-hbar-dual' });
            dual.createDiv({ cls: 'wb-hbar-dual-line is-plan' })
                .createDiv({ cls: 'wb-hbar-dual-fill' })
                .setCssProps({ '--fill-width': widthOf(item.compare) });
            dual.createDiv({ cls: 'wb-hbar-dual-line' })
                .createDiv({ cls: 'wb-hbar-dual-fill' })
                .setCssProps({
                    '--fill-color': item.color ?? DEFAULT_FILL,
                    '--fill-width': widthOf(item.value),
                });
            row.createSpan({
                cls: 'wb-hbar-value is-dual',
                text: `${formatValue(item.value)} / ${formatValue(item.compare)}`,
            });
        } else {
            const track = row.createDiv({
                cls: `wb-hbar-track is-plain${variant === 'small' ? ' is-small' : ''}`,
            });
            track.createDiv({ cls: 'wb-hbar-fill' }).setCssProps({
                '--fill-color': item.color ?? DEFAULT_FILL,
                '--fill-width': widthOf(item.value),
            });
            row.createSpan({
                cls: `wb-hbar-value${variant === 'small' ? ' is-small' : ''}`,
                text: formatValue(item.value),
            });
        }

        rows.push(row);
    }
    return rows;
}

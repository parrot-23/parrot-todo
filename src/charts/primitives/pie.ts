// 图元：饼图 / 环形图。
// 只画图形与可选的扇区标签；图例列表、空态文案由调用方决定。
import type { PieItem, PieOptions } from './types';
import { svgEl } from './svg-base';

/** 内置调色板（与既有饼图配色一致） */
const PIE_COLORS = ['#4c8dff', '#43b581', '#f2a65a', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#98c379'];

/**
 * 渲染饼图 / 环形图。
 * @returns 图元根元素；数据为空时返回 undefined
 */
export function renderPie(container: HTMLElement, items: PieItem[], options: PieOptions = {}): HTMLElement | undefined {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (items.length === 0 || total <= 0) {
        if (options.emptyText) container.createDiv({ cls: 'wb-pie-empty', text: options.emptyText });
        return undefined;
    }

    const size = options.size ?? 160;
    const root = container.createDiv({ cls: 'wb-pie' });
    root.setCssStyles({ width: `${size}px`, height: `${size}px` });

    const svg = root.createSvg('svg', {
        cls: 'wb-pie-svg',
        attr: { viewBox: '0 0 100 100' },
    });

    const cx = 50;
    const cy = 50;
    const outerR = 50;
    const innerR = options.donut ? 27.5 : 0;

    let angle = -Math.PI / 2;
    const labels: { label: string; angle: number; ratio: number }[] = [];

    items.forEach((item, index) => {
        const frac = item.value / total;
        const endAngle = angle + frac * Math.PI * 2;
        const path = svgEl('path', { d: pieSlice(cx, cy, outerR, innerR, angle, endAngle) });
        path.setAttribute('class', 'wb-pie-slice');
        path.setAttribute('fill', item.color ?? PIE_COLORS[index % PIE_COLORS.length]);
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('data-value', String(item.value));
        svg.appendChild(path);
        labels.push({ label: item.label, angle: (angle + endAngle) / 2, ratio: frac });
        angle = endAngle;
    });

    // 扇区之间的白色分隔线（多片、非环形）
    if (!options.donut && items.length > 1) {
        let boundary = -Math.PI / 2;
        for (const item of items) {
            const line = svgEl('line', {
                x1: String(cx),
                y1: String(cy),
                x2: String(cx + outerR * Math.cos(boundary)),
                y2: String(cy + outerR * Math.sin(boundary)),
            });
            line.setAttribute('class', 'wb-pie-divider');
            svg.appendChild(line);
            boundary += (item.value / total) * Math.PI * 2;
        }
    }

    // 扇区内标签：按扇区中心角度旋转定位到半径中部
    if (options.sliceLabels) {
        const minRatio = options.minLabelRatio ?? 0.06;
        for (const label of labels) {
            if (label.ratio < minRatio) continue;
            const el = root.createDiv({ cls: 'wb-pie-slice-label', text: label.label });
            el.setCssProps({
                '--slice-angle': `${(label.angle * 180) / Math.PI}deg`,
                // 标签距圆心的距离（160px 直径时约为 58px）
                '--slice-radius': `${size * 0.3625}px`,
            });
        }
    }

    return root;
}

/** 生成饼图 / 环形图扇区路径（整圆时用两段半圆避免起止点重合） */
function pieSlice(cx: number, cy: number, outerR: number, innerR: number, start: number, end: number): string {
    const span = end - start;

    if (span >= Math.PI * 2 - 0.0001) {
        const outer = `M ${cx} ${cy - outerR} A ${outerR} ${outerR} 0 1 1 ${cx} ${cy + outerR} `
            + `A ${outerR} ${outerR} 0 1 1 ${cx} ${cy - outerR} Z`;
        if (innerR <= 0) return outer;
        const inner = `M ${cx} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy + innerR} `
            + `A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR} Z`;
        return `${outer} ${inner}`;
    }

    const largeArc = span > Math.PI ? 1 : 0;
    const x1 = cx + outerR * Math.cos(start);
    const y1 = cy + outerR * Math.sin(start);
    const x2 = cx + outerR * Math.cos(end);
    const y2 = cy + outerR * Math.sin(end);

    if (innerR <= 0) {
        return `M ${cx} ${cy} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }
    const x3 = cx + innerR * Math.cos(end);
    const y3 = cy + innerR * Math.sin(end);
    const x4 = cx + innerR * Math.cos(start);
    const y4 = cy + innerR * Math.sin(start);
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} `
        + `L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

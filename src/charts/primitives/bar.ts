// 图元：竖向柱状图（单柱 / 堆叠 / 坐标轴 / 悬浮面板）。
// 只负责绘制；空态、月份文案与容器尺寸由调用方决定。
import type { BarDatum, BarOptions, BarSegment } from './types';
import { createChartSvg, svgEl, truncate } from './svg-base';

/** 渲染柱状图 */
export function renderBar(container: HTMLElement, data: BarDatum[], options: BarOptions = {}): void {
    if (data.length === 0) return;

    const width = options.width ?? 260;
    const height = options.height ?? 140;
    const showAxes = !!options.showAxes;
    // 绘制坐标轴时左侧预留刻度与数值区域，否则沿用紧凑布局
    const padLeft = showAxes ? 34 : 8;
    const padRight = 8;
    // 堆叠柱：柱顶需额外预留显示总时长的空间
    const stacked = data.some((d) => !!d.segments && d.segments.length > 0);
    const padTop = stacked ? 22 : 8;
    // 含月份行时底部预留月份标签空间
    const monthLabels = options.monthLabels;
    const hasMonthRow = !!monthLabels && monthLabels.some((label) => !!label);
    const padBottom = hasMonthRow ? 44 : 20;
    const chartH = height - padTop - padBottom;

    let max = Math.max(...data.map((d) => d.value), 1);
    // hours 单位：纵轴按 10h 一个刻度，将最大值向上取整到 10h 的整数倍，保证柱体与刻度对齐
    if (options.yAxisUnit === 'hours') {
        max = Math.ceil(max / 600) * 600 || 600;
    }

    // 柱宽与间隔相等：plotWidth = n*barW + (n-1)*barW = (2n-1)*barW
    const plotWidth = width - padLeft - padRight;
    const barW = Math.max(2, plotWidth / (data.length * 2 - 1));
    const step = barW;

    const svg = createChartSvg(container, width, height);

    if (showAxes) {
        drawBarAxes(svg, width, padLeft, padTop, chartH, max, options.yAxisUnit);
    }

    // 悬浮面板：鼠标移到柱子上时显示各任务时长
    container.setCssProps({ position: 'relative' });
    const tooltip = container.createDiv({ cls: 'wb-chart-tooltip' });

    for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = padLeft + i * (barW + step);

        if (stacked && d.segments && d.segments.length > 0) {
            const group = drawStackedBar(svg, d, x, barW, padTop, chartH, max, options.yAxisUnit);
            // 整根柱子（含分段）绑定悬浮：面板锚定在柱子左侧或右侧
            const barCenterY = padTop + chartH / 2;
            group.addEventListener('mouseenter', () => {
                showTooltip(tooltip, d, options.yAxisUnit);
                positionTooltip(tooltip, container, x, barW, barCenterY);
            });
            group.addEventListener('mouseleave', () => {
                tooltip.setCssStyles({ display: 'none' });
            });
        } else {
            const h = (d.value / max) * chartH;
            const y = padTop + (chartH - h);
            const rect = svgEl('rect', {
                x: String(x),
                y: String(y),
                width: String(barW),
                height: String(Math.max(1, h)),
                rx: '2',
            });
            rect.setAttribute('class', 'wb-chart-bar');
            rect.setAttribute('data-value', String(d.value));
            svg.appendChild(rect);

            // 时长为 0 的柱：柱顶显示 0
            if (stacked) {
                const total = svgEl('text', {
                    x: String(x + barW / 2),
                    y: String(y - 4),
                    'text-anchor': 'middle',
                });
                total.setAttribute('class', 'wb-chart-seg-total');
                total.textContent = '0';
                svg.appendChild(total);
            }
        }

        // 底部标签（周号，截断过长文本）
        const label = svgEl('text', {
            x: String(x + barW / 2),
            y: String(height - (hasMonthRow ? 26 : 6)),
            'text-anchor': 'middle',
        });
        label.setAttribute('class', 'wb-chart-label');
        label.textContent = truncate(d.label, 6);
        svg.appendChild(label);
    }

    // 底部月份行：按调用方给出的标签绘制
    if (hasMonthRow) {
        for (let i = 0; i < data.length; i++) {
            const monthLabel = monthLabels![i];
            if (!monthLabel) continue;
            const x = padLeft + i * (barW + step) + barW / 2;
            const monthEl = svgEl('text', {
                x: String(x),
                y: String(height - 4),
                'text-anchor': 'middle',
            });
            monthEl.setAttribute('class', 'wb-chart-month-label');
            monthEl.textContent = monthLabel;
            svg.appendChild(monthEl);
        }
    }
}

/** 绘制单根堆叠柱：按分段从底部向上堆叠（白线分隔），柱顶显示总时长；返回包含全部段的分组元素 */
function drawStackedBar(
    svg: SVGSVGElement,
    d: BarDatum,
    x: number,
    barW: number,
    padTop: number,
    chartH: number,
    max: number,
    unit: 'minutes' | 'hours' | undefined,
): SVGGElement {
    const baseY = padTop + chartH;
    let cursorY = baseY;

    const group = svgEl('g', {});
    group.setAttribute('class', 'wb-chart-bar-group');

    for (const seg of d.segments ?? []) {
        const h = (seg.value / max) * chartH;
        const segTop = cursorY - h;
        const y = Math.max(padTop, segTop);

        const rect = svgEl('rect', {
            x: String(x),
            y: String(y),
            width: String(barW),
            height: String(Math.max(1, h)),
        });
        rect.setAttribute('class', 'wb-chart-bar wb-chart-seg');
        if (seg.color) rect.setCssProps({ fill: seg.color });
        rect.setAttribute('data-value', String(seg.value));
        rect.setAttribute('data-label', seg.label);
        group.appendChild(rect);

        // 白线分隔（段与段之间，最底部不画）
        if (cursorY < baseY) {
            const divider = svgEl('line', {
                x1: String(x),
                y1: String(y),
                x2: String(x + barW),
                y2: String(y),
            });
            divider.setAttribute('class', 'wb-chart-seg-divider');
            group.appendChild(divider);
        }

        cursorY = segTop;
    }

    // 柱顶总时长：紧贴该柱的实际顶边（cursorY 为堆叠后的柱顶）
    const barTop = Math.max(padTop, cursorY);
    const total = svgEl('text', {
        x: String(x + barW / 2),
        y: String(barTop - 4),
        'text-anchor': 'middle',
    });
    total.setAttribute('class', 'wb-chart-seg-total');
    total.textContent = formatAxisValue(d.value, unit);
    svg.appendChild(total);

    svg.appendChild(group);
    return group;
}

/** 填充并显示悬浮面板：列出该柱每个任务的时长 */
function showTooltip(tooltip: HTMLElement, d: BarDatum, unit: 'minutes' | 'hours' | undefined): void {
    tooltip.empty();
    const segs: BarSegment[] = d.segments ?? [];
    // 逆序遍历：柱体从上到下（drawStackedBar 中数组首元素在底部、末元素在顶部）
    for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i];
        const row = tooltip.createDiv({ cls: 'wb-chart-tooltip-row' });
        const dot = row.createSpan({ cls: 'wb-chart-tooltip-dot' });
        if (seg.color) dot.setCssStyles({ background: seg.color });
        row.createSpan({ cls: 'wb-chart-tooltip-name', text: seg.label });
        row.createSpan({ cls: 'wb-chart-tooltip-val', text: formatAxisValue(seg.value, unit) });
    }
    tooltip.setCssStyles({ display: 'block' });
}

/** 定位悬浮面板：优先在柱子右侧显示，右侧空间不足则放左侧；宽度保证单行文字完整显示 */
function positionTooltip(
    tooltip: HTMLElement,
    container: HTMLElement,
    x: number,
    barW: number,
    barCenterY: number,
): void {
    // 先显示以测量面板尺寸
    tooltip.setCssStyles({ visibility: 'hidden', display: 'block' });
    const panelW = tooltip.offsetWidth;
    const panelH = tooltip.offsetHeight;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const margin = 8;

    // 根据柱子左右两侧可用空间决定面板放置侧
    const spaceRight = containerW - (x + barW) - margin;
    const spaceLeft = x - margin;
    let left: number;
    if (spaceRight >= panelW || spaceRight >= spaceLeft) {
        left = x + barW + margin; // 右侧
    } else {
        left = x - panelW - margin; // 左侧
    }
    // 兜底收束到容器内（极长单行可能略溢出）
    if (left + panelW > containerW) left = containerW - panelW;
    if (left < 0) left = 0;

    let top = barCenterY - panelH / 2;
    top = Math.max(0, Math.min(top, containerH - panelH));

    tooltip.setCssStyles({ left: `${left}px`, top: `${top}px`, visibility: 'visible' });
}

/** 绘制柱状图坐标轴：X 底部轴线 + Y 轴左侧轴线 + 均分刻度线与数值标签 */
function drawBarAxes(
    svg: SVGSVGElement,
    width: number,
    padLeft: number,
    padTop: number,
    chartH: number,
    max: number,
    unit: 'minutes' | 'hours' | undefined,
): void {
    const baseY = padTop + chartH;

    // X 轴底部轴线
    const xAxis = svgEl('line', {
        x1: String(padLeft),
        y1: String(baseY),
        x2: String(width - 8),
        y2: String(baseY),
    });
    xAxis.setAttribute('class', 'wb-chart-axis');
    svg.appendChild(xAxis);

    // Y 轴左侧轴线
    const yAxis = svgEl('line', {
        x1: String(padLeft),
        y1: String(padTop),
        x2: String(padLeft),
        y2: String(baseY),
    });
    yAxis.setAttribute('class', 'wb-chart-axis');
    svg.appendChild(yAxis);

    // Y 轴刻度：hours 单位按 10h 一个刻度，否则均分 4 段（0 / 1/3 / 2/3 / max）
    const tickValues: number[] = [];
    if (unit === 'hours') {
        const stepMinutes = 600; // 10 小时
        const count = Math.max(1, Math.ceil(max / stepMinutes));
        for (let i = 0; i <= count; i++) {
            tickValues.push(stepMinutes * i);
        }
    } else {
        const ticks = 4;
        for (let i = 0; i < ticks; i++) {
            tickValues.push((max / (ticks - 1)) * i);
        }
    }

    for (const value of tickValues) {
        const y = baseY - (value / max) * chartH;

        const tick = svgEl('line', {
            x1: String(padLeft),
            y1: String(y),
            x2: String(padLeft - 3),
            y2: String(y),
        });
        tick.setAttribute('class', 'wb-chart-tick');
        svg.appendChild(tick);

        const label = svgEl('text', {
            x: String(padLeft - 5),
            y: String(y + 3),
            'text-anchor': 'end',
        });
        label.setAttribute('class', 'wb-chart-axis-label');
        label.textContent = formatAxisValue(value, unit);
        svg.appendChild(label);
    }
}

/** 坐标轴数值格式化：hours 时换算为小时（保留 1 位小数） */
function formatAxisValue(value: number, unit?: 'minutes' | 'hours'): string {
    if (unit === 'hours') {
        const hours = Math.round(value / 6) / 10;
        return `${Number(hours.toFixed(1))}h`;
    }
    return String(Math.round(value));
}

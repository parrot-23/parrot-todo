// 图元 SVG 底座：创建 SVG 根节点、SVG 元素与文本截断等通用工具。

/** 创建 SVG 根节点 */
export function createChartSvg(container: HTMLElement, width: number, height: number): SVGSVGElement {
    return container.createSvg('svg', {
        cls: 'wb-chart-svg',
        attr: {
            width: String(width),
            height: String(height),
            viewBox: `0 0 ${width} ${height}`,
        },
    });
}

/** 创建 SVG 元素 */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
    return createSvg(tag, { attr: attrs });
}

/** 截断过长文本 */
export function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

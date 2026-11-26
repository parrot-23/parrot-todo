// 图元视觉模型契约：只描述「画什么形状」，不承载业务语义。
// 图元只接受已排版好的数据（标签、数值、颜色、文案），
// 不做聚合、不做 i18n、不绑定交互；聚合与交互留在调用方。

/** 横向条中的一个条目 */
export interface HBarItem {
    /** 行标签（已格式化，图元不再加工） */
    label: string;
    /** 主数值 */
    value: number;
    /** 主条颜色（省略时使用中性灰） */
    color?: string;
    /** 对比值（如计划时长）；存在时该行渲染为上下双条 */
    compare?: number;
}

/** 横向条渲染选项 */
export interface HBarOptions {
    /** 统一比例尺（所有行共用的最大值）；省略时取条目中的最大值 */
    scale?: number;
    /** 数值格式化（右侧数值列），默认四舍五入取整 */
    formatValue?: (value: number) => string;
    /** 行尺寸：default（分类行）/ small（子行） */
    variant?: 'default' | 'small';
    /** 行是否可点击（仅视觉反馈；事件由调用方绑定） */
    rowInteractive?: boolean;
    /** 条目为空时的占位文案；省略则不渲染任何内容 */
    emptyText?: string;
}

/** 时间轴轨道中的一列（如周一） */
export interface TimeGridColumn {
    /** 列标识 */
    key: string;
    /** 列标题（如「周一」） */
    label: string;
}

/** 时间轴轨道中的一个区块 */
export interface TimeGridBlock {
    /** 所属列 key */
    column: string;
    /** 起始分钟数（从当天 00:00 起） */
    start: number;
    /** 结束分钟数 */
    end: number;
    /** 区块颜色 */
    color?: string;
    /** 悬浮提示文本 */
    title?: string;
}

/** 时间轴轨道渲染选项 */
export interface TimeGridOptions {
    /** 列定义 */
    columns: TimeGridColumn[];
    /** 全部区块 */
    blocks: TimeGridBlock[];
    /** 一天的总分钟数，默认 1440 */
    dayMinutes?: number;
    /** 时间刻度间隔（分钟），默认 120 */
    tickMinutes?: number;
    /** 刻度文案格式化，默认 HH:MM */
    formatTick?: (minutes: number) => string;
    /** 宽度（px），默认 320 */
    width?: number;
    /** 高度（px），默认 320 */
    height?: number;
}

/** 饼图条目 */
export interface PieItem {
    /** 扇区名称 */
    label: string;
    /** 数值 */
    value: number;
    /** 扇区颜色（省略时按内置调色板依次取色） */
    color?: string;
}

/** 饼图渲染选项 */
export interface PieOptions {
    /** 直径（px），默认 160 */
    size?: number;
    /** 环形图 */
    donut?: boolean;
    /** 是否在扇区内绘制标签 */
    sliceLabels?: boolean;
    /** 扇区内标签的最小占比，默认 0.06 */
    minLabelRatio?: number;
    /** 数据为空时的占位文案 */
    emptyText?: string;
}

/** 柱状图分段 */
export interface BarSegment {
    label: string;
    value: number;
    color?: string;
}

/** 柱状图数据点 */
export interface BarDatum {
    label: string;
    value: number;
    /** 堆叠分段（存在时该柱按分段堆叠绘制） */
    segments?: BarSegment[];
    /** 原始周键，供调用方推导月份标签 */
    weekKey?: string;
}

/** 柱状图渲染选项 */
export interface BarOptions {
    width?: number;
    height?: number;
    /** 是否绘制坐标轴 */
    showAxes?: boolean;
    /** 纵轴单位：minutes（分钟）/ hours（小时换算） */
    yAxisUnit?: 'minutes' | 'hours';
    /** 底部月份行：与 data 等长，非空项在该位置绘制月份标签 */
    monthLabels?: (string | undefined)[];
}

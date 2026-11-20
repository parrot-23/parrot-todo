// 雪原主题：以浅灰白 #F6F6F6 为主的高调（High-key）雪原视觉，中性冷灰阴影 + 极少量冷蓝点缀。
// 代码绘制层：Canvas 上绘制画面中心的锥形帐篷庇护所（门内透出暖光）+ 缓慢飘落的雪花；不使用图片素材。
//
// 配色思路（专业配色，围绕主色 #F6F6F6 展开）：
// - 主色：浅灰白 #F6F6F6，作为雪面与视图底色，贴近 Obsidian 默认浅色底，干净通透。
// - 卡片色：比主色更亮一档的 #FBFBFC，让卡片从雪面上「浮」起来，形成层次而不靠重边框。
// - 阴影色：中性冷灰（#EDEFF2 / #E3E7EC），模拟雪地受天光反射后的柔和阴影，避免灰黑导致脏感。
// - 文字色：中性深灰 #2F3439（主）/ #6B7280（次），在浅灰白上对比度充足且不刺眼。
// - 点缀色：冷蓝 #7FA8C9 与极淡雪青 #EEF3F8，仅用于悬停与高光，整体保持中性统一。
//
// 背景花纹（见 styles.css 中 .interface-view.is-theme-snowfield）：
// - 底层：以 #F6F6F6 为基准的极淡冷灰渐变（#F6F6F6 → #F2F4F6 → #ECEFF3）。
// - 雪丘：3 团极淡的中性冷灰椭圆晕染（透明度 0.10~0.14），模拟雪面起伏与背光阴影。
// - 雪粒：稀疏的白色高光点，配合 canvas 飘雪形成层次。
import type { ThemeDefinition } from '../theme-definition';
import { createSnowfall } from './snow-canvas';

export const snowfieldTheme: ThemeDefinition = {
    id: 'snowfield',
    nameKey: 'theme.snowfield',
    assets: [],
    previewColor: '#f6f6f6',
    colors: {
        cardBackground: 'rgba(251, 251, 252, 0.86)',
        cardBorder: 'rgba(160, 174, 190, 0.3)',
        textPrimary: '#2f3439',
        textSecondary: '#6b7280',
        hoverBackground: 'rgba(127, 168, 201, 0.14)',
        interactiveBackground: 'rgba(237, 239, 242, 0.92)',
        interactiveHover: 'rgba(127, 168, 201, 0.24)',
        controlBackground: 'rgba(251, 251, 252, 0.96)',
    },
    // 可调变量：雪花数量 / 帐篷数量（主题管理面板中可拖动调节）
    variables: [
        { key: 'snowCount', labelKey: 'theme.varSnowCount', min: 0, max: 999, step: 1, defaultValue: 120 },
        { key: 'tentCount', labelKey: 'theme.varTentCount', min: 0, max: 999, step: 1, defaultValue: 3 },
    ],
    mount(container, ctx) {
        // 场景层：承载飘雪画布，位于内容之下且不拦截交互
        const scene = container.createDiv({ cls: 'interface-theme-scene' });
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' });
        // 数量取自主题变量，未设置时回退默认值
        const snowCount = ctx.variables.snowCount ?? 120;
        const tentCount = ctx.variables.tentCount ?? 3;
        return createSnowfall(canvasEl, scene, snowCount, tentCount);
    },
};

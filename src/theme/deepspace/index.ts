// 深空主题：纯黑星空 + 代码绘制的星点（缓慢迎面移动），不使用图片素材。
import type { ThemeDefinition } from '../theme-definition';
import { createStarfield } from './star-canvas';

export const deepspaceTheme: ThemeDefinition = {
    id: 'deepspace',
    nameKey: 'theme.nameDeepSpace',
    assets: [],
    previewColor: '#000000',
    colors: {
        cardBackground: 'rgba(22, 26, 40, 0.55)',
        cardBorder: 'rgba(255, 255, 255, 0.14)',
        textPrimary: '#e8ecf5',
        textSecondary: '#a6aec4',
        hoverBackground: 'rgba(255, 255, 255, 0.08)',
        interactiveBackground: 'rgba(255, 255, 255, 0.06)',
        interactiveHover: 'rgba(255, 255, 255, 0.12)',
        controlBackground: 'rgba(22, 26, 40, 0.9)',
    },
    // 可调变量：星点数量（主题管理面板中可拖动调节）
    variables: [
        { key: 'starCount', labelKey: 'theme.varStarCount', min: 0, max: 999, step: 1, defaultValue: 160 },
    ],
    mount(container, ctx) {
        // 场景层：承载星点画布，位于内容之下且不拦截交互
        const scene = container.createDiv({ cls: 'interface-theme-scene' });
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' });
        // 星点数量取自主题变量，未设置时回退默认值
        const starCount = ctx.variables.starCount ?? 160;
        return createStarfield(canvasEl, scene, starCount);
    },
};

// 田园主题：乡野青草清新的暖青色调（青绿主色 + 暖黄点缀），营造自然、清新的田园氛围。
// 代码绘制层：Canvas 上简笔风格的猫狗在田园中跑动；不使用图片素材。
//
// 背景花纹（见 styles.css 中 .interface-view.is-theme-pastoral）：
// - 底层：青草清新的暖青渐变（#eef6e4 → #dcecd0 → #c9e0bd）。
// - 草地色块：3 团极淡的青绿椭圆晕染（透明度 0.12~0.16），模拟草地明暗起伏，无规则边界。
// - 稀疏小花：5 个错位分布的暖黄 / 淡白小圆点，自然点缀。
// - 刻意不使用 repeating-linear-gradient 斜纹，避免大面积重复图案破坏和谐感。
import type { ThemeDefinition } from '../theme-definition';
import { createPastoralScene } from './animal-canvas';

export const pastoralTheme: ThemeDefinition = {
    id: 'pastoral',
    nameKey: 'theme.namePastoral',
    assets: [],
    previewColor: '#e3efd8',
    colors: {
        cardBackground: 'rgba(240, 248, 232, 0.78)',
        cardBorder: 'rgba(122, 168, 116, 0.34)',
        textPrimary: '#3d5240',
        textSecondary: '#6f8a6a',
        hoverBackground: 'rgba(150, 196, 138, 0.2)',
        interactiveBackground: 'rgba(226, 240, 214, 0.88)',
        interactiveHover: 'rgba(168, 206, 148, 0.34)',
        controlBackground: 'rgba(240, 248, 232, 0.95)',
    },
    mount(container) {
        // 场景层：承载猫狗画布，位于内容之下且不拦截交互
        const scene = container.createDiv({ cls: 'interface-theme-scene' });
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' });
        return createPastoralScene(canvasEl, scene);
    },
};

// 田园主题：暖色调（暖青 / 暖橙），营造温暖、自然的氛围。
// 不使用代码绘制层与图片素材，仅通过暖色背景与配色令牌呈现。
import type { ThemeDefinition } from '../theme-definition';

export const pastoralTheme: ThemeDefinition = {
    id: 'pastoral',
    nameKey: 'theme.namePastoral',
    assets: [],
    colors: {
        cardBackground: 'rgba(255, 244, 224, 0.72)',
        cardBorder: 'rgba(214, 158, 92, 0.32)',
        textPrimary: '#5c4632',
        textSecondary: '#9a7b5c',
        hoverBackground: 'rgba(230, 178, 110, 0.18)',
        interactiveBackground: 'rgba(255, 236, 205, 0.85)',
        interactiveHover: 'rgba(240, 196, 130, 0.32)',
        controlBackground: 'rgba(255, 244, 224, 0.95)',
    },
    // 不绘制代码层，因此无需返回清理函数
    mount: () => undefined,
};

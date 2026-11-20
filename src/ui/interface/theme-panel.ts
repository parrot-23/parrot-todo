// 主题管理面板：界面视图编辑模式下从「主题」按钮打开。
// 顶部居中两个选项卡：「当前主题」展示当前主题名称与关键配色；「更多主题」展示官方主题预览卡片。
// 预览卡片的数据来自 src/themes 下由代码定义的主题（代码绘制层 + 图片素材）。
import type { App } from 'obsidian';

import { t } from '../../core/i18n';
import { THEME_DEFINITIONS, getThemeDefinition } from '../../theme/registry';
import type { ThemeColors } from '../../theme/theme-definition';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 选项卡标识 */
type ThemeTabKey = 'current' | 'more';

/** 选项卡定义：key + 文案 key */
const TABS: { key: ThemeTabKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'current', labelKey: 'theme.tabCurrent' },
    { key: 'more', labelKey: 'theme.tabMore' },
];

/** 关键配色项：颜色令牌字段 + 文案 key */
const COLOR_ITEMS: { key: keyof ThemeColors; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'cardBackground', labelKey: 'theme.colorCardBg' },
    { key: 'cardBorder', labelKey: 'theme.colorCardBorder' },
    { key: 'textPrimary', labelKey: 'theme.colorTextPrimary' },
    { key: 'textSecondary', labelKey: 'theme.colorTextSecondary' },
    { key: 'hoverBackground', labelKey: 'theme.colorHover' },
    { key: 'interactiveBackground', labelKey: 'theme.colorInteractive' },
    { key: 'controlBackground', labelKey: 'theme.colorControl' },
];

/** 主题管理面板配置 */
export interface ThemePanelOptions extends Pick<FloatingPanelOptions, 'container'> {
    /** Obsidian App（读取主题素材资源路径） */
    app: App;
    /** 插件目录（vault 相对路径） */
    pluginDir: string;
    /** 读取当前应用的主题 id */
    getCurrentThemeId: () => string;
    /** 应用主题 */
    onApply: (themeId: string) => void;
    /** 读取某主题已保存的变量值 */
    getThemeVariables: (themeId: string) => Record<string, number>;
    /** 变量值变化（拖动滑块时触发） */
    onVariableChange: (themeId: string, key: string, value: number) => void;
}

export class ThemePanel extends FloatingPanel {
    private readonly panelOptions: ThemePanelOptions;
    /** 当前选中的选项卡 */
    private activeTab: ThemeTabKey = 'current';
    /** 选项卡按钮容器 */
    private tabsEl: HTMLElement | null = null;
    /** 内容容器 */
    private contentEl: HTMLElement | null = null;

    constructor(options: ThemePanelOptions) {
        super({
            title: t('theme.panelTitle'),
            width: 640,
            container: options.container,
        });
        this.panelOptions = options;

        this.setContent((body) => {
            body.addClass('theme-panel');

            // 顶部居中的选项卡
            this.tabsEl = body.createDiv({ cls: 'theme-panel-tabs' });
            for (const { key, labelKey } of TABS) {
                const tab = this.tabsEl.createDiv({ cls: 'theme-panel-tab' });
                tab.setText(t(labelKey));
                tab.toggleClass('is-active', key === this.activeTab);
                tab.addEventListener('click', () => this.selectTab(key));
            }

            // 内容区
            this.contentEl = body.createDiv({ cls: 'theme-panel-content' });
            this.renderContent();
        });
    }

    /** 重新渲染内容（外部主题变化后同步选中态） */
    refresh(): void {
        this.renderContent();
    }

    /** 切换选项卡 */
    private selectTab(key: ThemeTabKey): void {
        if (this.activeTab === key) return;
        this.activeTab = key;
        this.tabsEl?.querySelectorAll('.theme-panel-tab').forEach((el, index) => {
            el.toggleClass('is-active', TABS[index].key === key);
        });
        this.renderContent();
    }

    /** 按当前选项卡渲染内容 */
    private renderContent(): void {
        const contentEl = this.contentEl;
        if (!contentEl) return;
        contentEl.empty();
        contentEl.toggleClass('is-current', this.activeTab === 'current');
        if (this.activeTab === 'current') this.renderCurrentTheme(contentEl);
        else this.renderThemeCards(contentEl);
    }

    /** 「当前主题」选项卡：展示主题名称、关键配色与关键变量 */
    private renderCurrentTheme(contentEl: HTMLElement): void {
        const theme = getThemeDefinition(this.panelOptions.getCurrentThemeId());
        const name = theme ? t(theme.nameKey) : t('theme.snowfield');

        // 主题名称
        const nameSection = contentEl.createDiv({ cls: 'theme-current-section' });
        nameSection.createDiv({ cls: 'theme-current-label', text: t('theme.currentName') });
        nameSection.createDiv({ cls: 'theme-current-name', text: name });

        // 关键配色
        const colorSection = contentEl.createDiv({ cls: 'theme-current-section' });
        colorSection.createDiv({ cls: 'theme-current-label', text: t('theme.currentColors') });
        const colors = theme?.colors;
        if (!colors) {
            colorSection.createDiv({ cls: 'theme-current-empty', text: t('theme.noColors') });
        } else {
            const grid = colorSection.createDiv({ cls: 'theme-color-grid' });
            for (const { key, labelKey } of COLOR_ITEMS) {
                const value = colors[key];
                if (!value) continue;
                const item = grid.createDiv({ cls: 'theme-color-item' });
                const swatch = item.createDiv({ cls: 'theme-color-swatch' });
                swatch.setCssStyles({ backgroundColor: value });
                const meta = item.createDiv({ cls: 'theme-color-meta' });
                meta.createDiv({ cls: 'theme-color-label', text: t(labelKey) });
                meta.createDiv({ cls: 'theme-color-value', text: value });
            }
        }

        // 关键变量：可拖动滑块调节
        const variables = theme?.variables ?? [];
        if (variables.length === 0) return;
        const varSection = contentEl.createDiv({ cls: 'theme-current-section' });
        varSection.createDiv({ cls: 'theme-current-label', text: t('theme.currentVariables') });
        const saved = theme ? this.panelOptions.getThemeVariables(theme.id) : {};
        const list = varSection.createDiv({ cls: 'theme-var-list' });
        for (const variable of variables) {
            const current = saved[variable.key] ?? variable.defaultValue;
            const row = list.createDiv({ cls: 'theme-var-item' });
            const head = row.createDiv({ cls: 'theme-var-head' });
            head.createSpan({ cls: 'theme-var-label', text: t(variable.labelKey) });
            // 数值输入框：与滑块双向联动
            const valueInput = head.createEl('input', {
                cls: 'theme-var-value',
                attr: {
                    type: 'number',
                    min: String(variable.min),
                    max: String(variable.max),
                    step: String(variable.step),
                    value: String(current),
                },
            });

            const slider = row.createEl('input', {
                cls: 'theme-var-slider',
                attr: {
                    type: 'range',
                    min: String(variable.min),
                    max: String(variable.max),
                    step: String(variable.step),
                    value: String(current),
                },
            });

            /** 夹取到合法范围并按步长取整 */
            const clamp = (raw: number): number => {
                const stepped = Math.round(raw / variable.step) * variable.step;
                return Math.max(variable.min, Math.min(variable.max, stepped));
            };

            // 拖动滑块：同步输入框并应用
            slider.addEventListener('input', () => {
                const value = Number(slider.value);
                valueInput.value = String(value);
                if (!theme) return;
                this.panelOptions.onVariableChange(theme.id, variable.key, value);
            });

            // 输入框修改：失焦或回车时夹取、同步滑块并应用
            const commitInput = (): void => {
                const raw = Number(valueInput.value);
                const value = Number.isFinite(raw) ? clamp(raw) : current;
                valueInput.value = String(value);
                slider.value = String(value);
                if (!theme) return;
                this.panelOptions.onVariableChange(theme.id, variable.key, value);
            };
            valueInput.addEventListener('change', commitInput);
            valueInput.addEventListener('blur', commitInput);
        }
    }

    /** 「更多主题」选项卡：渲染官方主题预览卡片 */
    private renderThemeCards(contentEl: HTMLElement): void {
        const currentThemeId = this.panelOptions.getCurrentThemeId();
        for (const theme of THEME_DEFINITIONS) {
            const isActive = theme.id === currentThemeId;
            const card = contentEl.createDiv({ cls: 'theme-preview-card' });
            card.toggleClass('is-active', isActive);

            // 缩略图：使用主题的图片素材；无素材的主题显示占位（空白主题为「不使用任何主题」）
            const thumb = card.createDiv({ cls: 'theme-preview-thumb' });
            const assetPath = theme.assets[0]?.path;
            if (assetPath) {
                const url = this.panelOptions.app.vault.adapter.getResourcePath(
                    `${this.panelOptions.pluginDir}/${assetPath}`,
                );
                thumb.setCssStyles({ backgroundImage: `url("${url}")` });
            } else if (theme.noteKey) {
                thumb.addClass('is-blank');
                thumb.createSpan({ cls: 'theme-preview-thumb-note', text: t(theme.noteKey) });
            } else {
                thumb.addClass('is-plain');
                // 封面底色跟随主题配色（如田园主题的暖色），未设置时回退默认黑色
                if (theme.previewColor) thumb.setCssStyles({ backgroundColor: theme.previewColor });
            }

            const info = card.createDiv({ cls: 'theme-preview-info' });
            info.createSpan({ cls: 'theme-preview-name', text: t(theme.nameKey) });
            const applyBtn = info.createEl('button', {
                cls: 'theme-preview-apply',
                attr: { type: 'button' },
            });
            applyBtn.setText(isActive ? t('theme.inUse') : t('theme.apply'));
            applyBtn.disabled = isActive;
            applyBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.applyTheme(theme.id);
            });
            card.addEventListener('click', () => this.applyTheme(theme.id));
        }
    }

    /** 应用主题并刷新预览卡片选中态 */
    private applyTheme(themeId: string): void {
        if (themeId === this.panelOptions.getCurrentThemeId()) return;
        this.panelOptions.onApply(themeId);
        this.renderContent();
    }
}

// 剧本面板：顶部工具栏「剧本」按钮打开，基于 FloatingPanel。
// 当前仅实现 UI：左侧垂直菜单（历史 / 官方 / 本地）+ 左下角「配置」按钮；
// 配置激活时右侧展示配置项；历史页为「垂直历史卡片 + 预览窗口」，官方 / 本地页为列表占位。
import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import { FloatingPanel, type FloatingPanelOptions } from '../../ui/basic/floating-panel';

/** 剧本菜单标识 */
type StoryMenuId = 'history' | 'official' | 'local';

/** 历史卡片占位数量 */
const HISTORY_PLACEHOLDER_COUNT = 3;
/** 官方 / 本地列表占位数量 */
const LIST_PLACEHOLDER_COUNT = 4;

/** 剧本面板 */
export class StoryPanel extends FloatingPanel {
    /** 当前激活的菜单（配置未激活时生效） */
    private activeMenu: StoryMenuId = 'history';
    /** 左下角「配置」是否激活 */
    private configActive = false;
    /** 官方剧本目录（默认插件目录下的 story 子目录） */
    private readonly officialDir: string;

    constructor(options: Omit<FloatingPanelOptions, 'title'> & { officialDir?: string } = {}) {
        super({
            width: 900,
            title: t('story.title'),
            closeOnBlur: true,
            ...options,
        });
        this.officialDir = options.officialDir ?? '';
        this.body.addClass('story-panel');
        this.renderContent();
    }

    /** 渲染面板内容：左侧菜单栏 + 右侧内容区 */
    private renderContent(): void {
        this.body.empty();

        const layout = this.body.createDiv({ cls: 'story-panel-layout' });
        this.renderSidebar(layout.createDiv({ cls: 'story-panel-sidebar' }));

        const content = layout.createDiv({ cls: 'story-panel-content' });
        if (this.configActive) {
            this.renderConfig(content);
        } else if (this.activeMenu === 'history') {
            this.renderHistory(content);
        } else {
            this.renderList(content, this.activeMenu);
        }
    }

    /** 左侧垂直菜单栏：历史 / 官方 / 本地，底部为配置按钮 */
    private renderSidebar(sidebar: HTMLElement): void {
        const menus: { id: StoryMenuId; icon: string; label: string }[] = [
            { id: 'history', icon: 'history', label: t('story.menuHistory') },
            { id: 'official', icon: 'badge-check', label: t('story.menuOfficial') },
            { id: 'local', icon: 'folder-open', label: t('story.menuLocal') },
        ];
        for (const menu of menus) {
            const btn = sidebar.createEl('button', {
                cls: 'story-panel-menu-item',
                attr: { type: 'button', 'aria-label': menu.label },
            });
            btn.toggleClass('is-active', !this.configActive && this.activeMenu === menu.id);
            setIcon(btn.createSpan({ cls: 'story-panel-menu-icon' }), menu.icon);
            btn.createSpan({ cls: 'story-panel-menu-label', text: menu.label });
            btn.addEventListener('click', () => {
                if (!this.configActive && this.activeMenu === menu.id) return;
                this.configActive = false;
                this.activeMenu = menu.id;
                this.renderContent();
            });
        }

        // 菜单与配置按钮之间弹性留白，把配置按钮压在左下角
        sidebar.createDiv({ cls: 'story-panel-sidebar-spacer' });

        const configBtn = sidebar.createEl('button', {
            cls: 'story-panel-menu-item',
            attr: { type: 'button', 'aria-label': t('story.configTitle') },
        });
        configBtn.toggleClass('is-active', this.configActive);
        setIcon(configBtn.createSpan({ cls: 'story-panel-menu-icon' }), 'settings');
        configBtn.createSpan({ cls: 'story-panel-menu-label', text: t('story.configTitle') });
        configBtn.addEventListener('click', () => {
            this.configActive = !this.configActive;
            this.renderContent();
        });
    }

    /** 历史页：左侧垂直历史卡片 + 右侧预览窗口（当前为占位内容） */
    private renderHistory(content: HTMLElement): void {
        const wrap = content.createDiv({ cls: 'story-panel-history' });

        const list = wrap.createDiv({ cls: 'story-panel-history-list' });
        for (let index = 0; index < HISTORY_PLACEHOLDER_COUNT; index += 1) {
            const card = list.createDiv({ cls: 'story-panel-history-card', attr: { role: 'button' } });
            card.toggleClass('is-active', index === 0);
            card.createDiv({ cls: 'story-panel-history-card-title', text: t('story.historyCardTitle') });
            card.createDiv({ cls: 'story-panel-history-card-meta', text: t('story.historyCardMeta') });
        }

        const preview = wrap.createDiv({ cls: 'story-panel-preview' });
        preview.createDiv({ cls: 'story-panel-preview-title', text: t('story.previewTitle') });
        preview.createDiv({ cls: 'story-panel-preview-body', text: t('story.previewPlaceholder') });
    }

    /** 官方 / 本地页：仅展示剧本列表（当前为占位内容） */
    private renderList(content: HTMLElement, menu: Exclude<StoryMenuId, 'history'>): void {
        const list = content.createDiv({ cls: 'story-panel-list' });
        for (let index = 0; index < LIST_PLACEHOLDER_COUNT; index += 1) {
            const item = list.createDiv({ cls: 'story-panel-list-item' });
            item.createDiv({ cls: 'story-panel-list-item-title', text: t('story.listItemTitle') });
            item.createDiv({
                cls: 'story-panel-list-item-desc',
                text: menu === 'official' ? t('story.officialPlaceholder') : t('story.localPlaceholder'),
            });
        }
    }

    /** 配置页：官方剧本目录 / 本地剧本目录 / 联动当天任务（当前为占位说明） */
    private renderConfig(content: HTMLElement): void {
        const config = content.createDiv({ cls: 'story-panel-config' });
        const rows: { label: string; value: string; openable?: boolean }[] = [
            { label: t('story.configOfficialDir'), value: this.officialDir || t('story.configUnset'), openable: true },
            { label: t('story.configLocalDir'), value: t('story.configUnset') },
            { label: t('story.configLinkTasks'), value: t('story.configLinkTasksDesc') },
        ];
        for (const row of rows) {
            const rowEl = config.createDiv({ cls: 'story-panel-config-row' });
            rowEl.createSpan({ cls: 'story-panel-config-label', text: row.label });
            rowEl.createSpan({ cls: 'story-panel-config-value', text: row.value });
            if (row.openable && this.officialDir) {
                const btn = rowEl.createEl('button', {
                    cls: 'story-panel-config-folder-btn',
                    attr: { type: 'button', 'aria-label': t('story.openFolder') },
                });
                setIcon(btn, 'folder');
                btn.addEventListener('click', () => this.openOfficialDir());
            }
        }
    }

    /** 在系统资源管理器中打开官方剧本目录（不存在时先创建） */
    private openOfficialDir(): void {
        if (!this.officialDir) return;
        const req = (window as unknown as { require?: (module: string) => unknown }).require;
        if (!req) return;
        try {
            const fs = req('fs') as { mkdirSync: (p: string, o: { recursive: boolean }) => void };
            fs.mkdirSync(this.officialDir, { recursive: true });
            const electron = req('electron') as { shell: { openPath: (p: string) => Promise<string> } };
            void electron.shell.openPath(this.officialDir);
        } catch (err) {
            console.error('打开官方剧本目录失败', err);
        }
    }
}

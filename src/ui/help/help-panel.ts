// 帮助面板：顶部工具栏「帮助」按钮与首次打开插件时自动打开，基于 FloatingPanel。
// 内容：多页功能说明（概览 / 任务 / 计划 / 检查 / 数据），底部提供「不再提示」勾选。
import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 帮助页签名 */
type HelpPageId = 'overview' | 'tasks' | 'plans' | 'check' | 'data';

/** 帮助面板配置 */
export interface HelpPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 读取「不再提示」勾选状态 */
    getDismissed: () => boolean;
    /** 保存「不再提示」勾选状态 */
    saveDismissed: (dismissed: boolean) => Promise<void>;
}

/** 单个帮助页签定义 */
interface HelpPage {
    id: HelpPageId;
    /** 页签图标 */
    icon: string;
    /** 页签文案 */
    label: string;
    /** 页面导语 */
    intro: string;
    /** 页面要点 */
    items: string[];
}

/** 帮助面板 */
export class HelpPanel extends FloatingPanel {
    private readonly panelOptions: HelpPanelOptions;
    /** 当前激活的页签 */
    private activePage: HelpPageId = 'overview';
    private tabsEl!: HTMLElement;
    private pageEl!: HTMLElement;

    constructor(options: HelpPanelOptions) {
        super({
            width: 720,
            title: t('help.title'),
            closeOnBlur: true,
            ...options,
        });
        this.panelOptions = options;
        this.body.addClass('help-panel');
        this.renderContent();
    }

    /** 每次打开时重新渲染，保证「不再提示」勾选状态为最新值 */
    override open(): void {
        this.renderContent();
        super.open();
    }

    /** 帮助页签配置（文案随语言变化，渲染时生成） */
    private pages(): HelpPage[] {
        return [
            {
                id: 'overview',
                icon: 'info',
                label: t('help.tabOverview'),
                intro: t('help.todayIntro'),
                items: [t('help.overviewItem1'), t('help.overviewItem2'), t('help.overviewItem3')],
            },
            {
                id: 'tasks',
                icon: 'list-checks',
                label: t('help.tabTasks'),
                intro: t('help.tasksIntro'),
                items: [t('help.tasksItem1'), t('help.tasksItem2'), t('help.tasksItem3'), t('help.tasksItem4')],
            },
            {
                id: 'plans',
                icon: 'calendar-days',
                label: t('help.tabPlans'),
                intro: t('help.plansIntro'),
                items: [t('help.plansItem1'), t('help.plansItem2'), t('help.plansItem3'), t('help.plansItem4')],
            },
            {
                id: 'check',
                icon: 'clipboard-check',
                label: t('help.tabCheck'),
                intro: t('help.checkIntro'),
                items: [t('help.checkItem1'), t('help.checkItem2'), t('help.checkItem3')],
            },
            {
                id: 'data',
                icon: 'database',
                label: t('help.tabData'),
                intro: t('help.dataIntro'),
                items: [t('help.dataItem1'), t('help.dataItem2'), t('help.dataItem3')],
            },
        ];
    }

    /** 渲染面板内容：页签栏 + 当前页内容 + 底部「不再提示」 */
    private renderContent(): void {
        this.body.empty();

        const pages = this.pages();
        this.tabsEl = this.body.createDiv({ cls: 'help-panel-tabs' });
        for (const page of pages) {
            const tab = this.tabsEl.createDiv({
                cls: 'help-panel-tab',
                attr: { role: 'button', 'aria-label': page.label },
            });
            tab.toggleClass('is-active', page.id === this.activePage);
            setIcon(tab.createSpan({ cls: 'help-panel-tab-icon' }), page.icon);
            tab.createSpan({ cls: 'help-panel-tab-label', text: page.label });
            tab.addEventListener('click', () => {
                if (this.activePage === page.id) return;
                this.activePage = page.id;
                this.renderContent();
            });
        }

        this.pageEl = this.body.createDiv({ cls: 'help-panel-page' });
        const current = pages.find((page) => page.id === this.activePage) ?? pages[0];

        this.pageEl.createDiv({ cls: 'help-panel-intro', text: current.intro });
        const list = this.pageEl.createEl('ul', { cls: 'help-panel-list' });
        for (const item of current.items) {
            list.createEl('li', { text: item });
        }

        // 底部：「不再提示」勾选，勾选后再次打开插件不再自动弹出帮助
        const footer = this.body.createDiv({ cls: 'help-panel-footer' });
        const label = footer.createEl('label', { cls: 'help-panel-dismiss' });
        const checkbox = label.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.panelOptions.getDismissed();
        label.createSpan({ text: t('help.dontShowAgain') });
        checkbox.addEventListener('change', () => {
            void this.panelOptions.saveDismissed(checkbox.checked);
        });
    }
}

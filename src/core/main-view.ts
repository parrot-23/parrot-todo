import { FileSystemAdapter, ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';

import type { PlanCategoryData } from './shared/plan-category-manager';
import type { InboxData } from './datatypes/domain';
import type { EventBlock, ExecutionRecord } from './datatypes/domain';
import { InterfaceView } from './interface-view';
import { TopBar } from '../ui/topbar/top-bar';
import { SettingsPanel } from '../ui/interface/settings-panel';
import { HelpPanel } from '../ui/help/help-panel';
import { StoryPanel } from '../features/story/story-panel';
import type { PdcaRepo } from './repos/pdca-repo';
import type { InboxRepo } from './repos/inbox-repo';
import type { CategoryRepo } from './repos/category-repo';
import type { PlanSchemeRepo } from './repos/plan-scheme-repo';
import type { PrototypeTaskRepo } from './repos/prototype-task-repo';
import { t } from './i18n';
import { log } from './shared/logger';
import {
    applyThemeColors,
    registerThemeColorsConsumer,
    unregisterThemeColorsConsumer,
} from '../theme/theme-colors';
import type { ThemeColorsConsumer } from '../theme/theme-colors';
import type { ThemeColors } from '../theme/theme-definition';

export const VIEW_TYPE_MAIN = 'parrot-plan-main-view';

/**
 * 主视图：插件唯一视图，顶部工具栏 + 界面内容。
 */
export class MainView extends ItemView implements ThemeColorsConsumer {
    plugin: Plugin;
    /** 计划事件数据（从插件数据层读取，供界面视图卡片共用） */
    private events: EventBlock[];
    /** 执行记录数据 */
    private executions: ExecutionRecord[];
    /** 收集盒数据 */
    private inboxData: InboxData;
    /** 分类数据 */
    private planCategoryData: PlanCategoryData;
    /** 已制定周计划的周键列表 */
    private plannedWeeks: string[];
    private interfaceView: InterfaceView;
    private contentRoot!: HTMLElement;
    /** 顶部工具栏右侧的「进行中任务」卡片容器 */
    private runningCardEl?: HTMLElement;
    /** 进行中任务卡片已用时长的刷新定时器（每分钟更新） */
    private runningCardTimer?: number;
    /** 顶部工具栏（日期切换 + 周历按钮，右侧操作区） */
    private topBar: TopBar;
    /** 顶部工具栏下方居中的扩展工具栏（编辑布局时显示：添加 / 主题 / 退出） */
    private interfaceToolBarEl?: HTMLElement;
    /** 「添加卡片」按钮（仅编辑模式显示） */
    private addCardToolBtn?: HTMLButtonElement;
    /** 「主题」按钮（仅编辑模式显示） */
    private themeToolBtn?: HTMLButtonElement;
    /** 「退出」按钮（仅编辑模式显示，结束编辑布局） */
    private exitToolBtn?: HTMLButtonElement;
    /** 「布局」按钮（切换编辑模式） */
    private layoutToolBtn?: HTMLButtonElement;
    /** 设置面板（顶部工具栏「设置」按钮打开，复用同一实例） */
    private settingsPanel: SettingsPanel | null = null;
    /** 帮助面板（顶部工具栏「帮助」按钮 / 首次打开插件时自动打开，复用同一实例） */
    private helpPanel: HelpPanel | null = null;
    /** 剧本面板（顶部工具栏「剧本」按钮打开，复用同一实例） */
    private storyPanel: StoryPanel | null = null;
    /** 主视图根节点：主题颜色令牌注入到这里，供顶部工具栏与内容区统一继承 */
    private rootEl?: HTMLElement;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: Plugin,
        categoryData: PlanCategoryData,
        events: EventBlock[],
        executions: ExecutionRecord[],
        inboxData: InboxData,
        plannedWeeks: string[],
    ) {
        super(leaf);
        this.plugin = plugin;
        log('MainView 构造', {
            events: events.length,
            executions: executions.length,
        });
        this.events = events;
        this.executions = executions;
        this.inboxData = inboxData;
        this.planCategoryData = categoryData;
        this.plannedWeeks = plannedWeeks;
        this.topBar = new TopBar({
            onDateChange: (date) => this.interfaceView.setSelectedDate(date),
            onOpenCalendar: (date) => this.interfaceView.openDatePanel(date),
            onOpenFunctionPanel: () => this.interfaceView.openFunctionPanel(),
            onOpenCollectPanel: () => this.interfaceView.openCollectHubPanel(),
            onOpenSettings: () => this.openSettingsPanel(),
            onOpenStory: () => this.openStoryPanel(),
            onOpenHelp: () => this.openHelpPanel(),
        });
        this.interfaceView = new InterfaceView(this.app, this.plugin, this.planCategoryData, {
            getSelectedDate: () => this.topBar.getSelectedDate(),
            onSelectedDateChange: (date) => this.topBar.setSelectedDate(date),
        });
    }

    /** 从插件实例获取 PDCA 领域仓库 */
    private pdcaRepo(): PdcaRepo {
        return (this.plugin as Plugin & { pdcaRepo: PdcaRepo }).pdcaRepo;
    }

    /** 从插件实例获取原型任务仓库（界面视图进行中任务用） */
    private prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    /** 从插件实例获取收集盒领域仓库 */
    private inboxRepo(): InboxRepo {
        return (this.plugin as Plugin & { inboxRepo: InboxRepo }).inboxRepo;
    }

    /** 从插件实例获取分类领域仓库 */
    private categoryRepo(): CategoryRepo {
        return (this.plugin as Plugin & { categoryRepo: CategoryRepo }).categoryRepo;
    }

    /** 从插件实例获取时间计划方案领域仓库 */
    private planSchemeRepo(): PlanSchemeRepo {
        return (this.plugin as Plugin & { planSchemeRepo: PlanSchemeRepo }).planSchemeRepo;
    }

    getViewType(): string {
        return VIEW_TYPE_MAIN;
    }

    getDisplayText(): string {
        return t('view.title');
    }

    /** 保存数据（统一委托给插件层 saveAll） */
    async save() {
        await (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    /** 外部数据变更后重新渲染当前视图（如 vault 文件移动导致路径更新） */
    async refresh() {
        await this.renderContent();
    }

    /** 清空数据后重置视图与默认分类 / 方案 */
    async resetData() {
        this.categoryRepo().replaceAll([
            { id: 'uncategorized', label: t('defaultCategory.uncategorized'), color: '#888888' },
            { id: 'work', label: t('defaultCategory.work'), color: '#4c8dff' },
            { id: 'rest', label: t('defaultCategory.rest'), color: '#43b581' },
            { id: 'play', label: t('defaultCategory.play'), color: '#f2a65a' },
        ]);
        this.planSchemeRepo().resetToDefault(t('planScheme.defaultName'));
        this.pdcaRepo().clearEvents();
        this.pdcaRepo().clearExecutions();
        this.inboxRepo().clear();
        await this.renderContent();
    }

    /** 打开设置面板（懒创建，复用同一实例） */
    private openSettingsPanel(): void {
        if (!this.settingsPanel) {
            const plugin = this.plugin as Plugin & {
                taskLibraryRoot: string;
                saveTaskLibraryRoot: (path: string) => Promise<void>;
            };
            this.settingsPanel = new SettingsPanel({
                app: this.app,
                getTaskLibraryRoot: () => plugin.taskLibraryRoot,
                saveTaskLibraryRoot: (path) => plugin.saveTaskLibraryRoot(path),
            });
        }
        this.settingsPanel.open();
    }

    /** 打开帮助面板（顶部工具栏「帮助」按钮；首次打开插件时也由此自动弹出） */
    openHelpPanel(): void {
        if (!this.helpPanel) {
            const plugin = this.plugin as Plugin & {
                helpDismissed?: boolean;
                saveHelpDismissed?: (dismissed: boolean) => Promise<void>;
            };
            this.helpPanel = new HelpPanel({
                getDismissed: () => plugin.helpDismissed === true,
                saveDismissed: (dismissed) => plugin.saveHelpDismissed?.(dismissed) ?? Promise.resolve(),
            });
        }
        this.helpPanel.open();
    }

    /** 打开剧本面板（懒创建，复用同一实例） */
    private openStoryPanel(): void {
        if (!this.storyPanel) {
            const adapter = this.app.vault.adapter;
            const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
            const pluginDir = basePath
                ? `${basePath}/${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`
                : '';
            const plugin = this.plugin as Plugin & {
                storyLocalDir: { mode: 'vault' | 'local'; path: string };
                saveStoryLocalDir: (mode: 'vault' | 'local', path: string) => Promise<void>;
            };
            this.storyPanel = new StoryPanel({
                officialDir: pluginDir ? `${pluginDir}/story` : '',
                vaultBasePath: basePath,
                getLocalDir: () => plugin.storyLocalDir,
                saveLocalDir: (mode, path) => plugin.saveStoryLocalDir(mode, path),
            });
        }
        this.storyPanel.open();
    }

    /** 渲染顶部工具栏左侧的「布局 / 主题」按钮，以及位于顶部工具栏下方居中的扩展工具栏（添加 / 退出） */
    private renderInterfaceTools(container: HTMLElement, nav: HTMLElement): void {
        const group = container.createDiv({ cls: 'interface-tool-group' });

        // 布局按钮：点击切换编辑模式，激活态时在工具栏下方展开扩展工具栏
        const layoutBtn = group.createEl('button', { cls: 'interface-tool-btn interface-layout-btn', attr: { type: 'button' } });
        setIcon(layoutBtn, 'layout-panel-top');
        layoutBtn.onclick = () => {
            this.interfaceView.toggleEditMode();
            this.updateInterfaceTools();
        };

        // 主题按钮：常驻顶部工具栏，位于布局按钮右侧（无需进入布局模式即可打开主题管理）
        const themeBtn = group.createEl('button', { cls: 'interface-tool-btn', attr: { type: 'button' } });
        setIcon(themeBtn, 'palette');
        themeBtn.onclick = () => this.interfaceView.openThemePanel();

        // 扩展工具栏：绝对定位在顶部工具栏下方居中，作为浮层覆盖内容区，不挤压页面布局
        const toolbar = nav.createDiv({ cls: 'interface-tool-bar' });

        const addBtn = toolbar.createEl('button', { cls: 'interface-tool-btn', attr: { type: 'button' } });
        setIcon(addBtn, 'plus');
        addBtn.onclick = () => this.interfaceView.openCardPicker();

        toolbar.createDiv({ cls: 'interface-tool-divider' });

        const exitBtn = toolbar.createEl('button', { cls: 'interface-tool-btn', attr: { type: 'button' } });
        setIcon(exitBtn, 'x');
        exitBtn.onclick = () => {
            this.interfaceView.toggleEditMode();
            this.updateInterfaceTools();
        };

        this.interfaceToolBarEl = toolbar;
        this.addCardToolBtn = addBtn;
        this.themeToolBtn = themeBtn;
        this.exitToolBtn = exitBtn;
        this.layoutToolBtn = layoutBtn;
        this.updateInterfaceTools();
    }

    /** 同步布局按钮的激活态、扩展工具栏显隐与各按钮提示文案 */
    private updateInterfaceTools(): void {
        const editMode = this.interfaceView.isEditMode;
        this.interfaceToolBarEl?.toggleClass('is-visible', editMode);
        this.layoutToolBtn?.toggleClass('is-active', editMode);

        const addLabel = t('interface.addCard');
        if (this.addCardToolBtn) {
            this.addCardToolBtn.title = addLabel;
            this.addCardToolBtn.setAttribute('aria-label', addLabel);
        }
        const themeLabel = t('interface.theme');
        if (this.themeToolBtn) {
            this.themeToolBtn.title = themeLabel;
            this.themeToolBtn.setAttribute('aria-label', themeLabel);
        }
        const exitLabel = t('interface.exitEditMode');
        if (this.exitToolBtn) {
            this.exitToolBtn.title = exitLabel;
            this.exitToolBtn.setAttribute('aria-label', exitLabel);
        }
        const layoutLabel = editMode ? t('interface.editModeDone') : t('interface.editMode');
        if (this.layoutToolBtn) {
            this.layoutToolBtn.title = layoutLabel;
            this.layoutToolBtn.setAttribute('aria-label', layoutLabel);
        }
    }

    async onOpen() {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('parrot-plan-main');
        this.rootEl = root;
        // 注册主题颜色消费者：主题切换时把令牌同步到根节点，顶部工具栏与内容区共用
        registerThemeColorsConsumer(this);

        // 顶部工具栏：独占一行，左侧为界面功能按钮组，日期与周历居中，进行中任务靠右
        const nav = root.createDiv({ cls: 'parrot-plan-nav' });
        const { left, actions } = this.topBar.render(nav);

        // 左侧：布局按钮；扩展工具栏（添加 / 主题 / 退出）浮在工具栏下方居中
        this.renderInterfaceTools(left, nav);

        // 进行中任务卡片（右侧操作区，无进行中任务时隐藏）
        this.runningCardEl = actions.createDiv({ cls: 'parrot-plan-running-card-wrap' });
        this.renderRunningTaskCard();

        // 内容区
        this.contentRoot = root.createDiv({ cls: 'parrot-plan-content' });
        await this.renderContent();

        // 插件视图为活动标签时隐藏底部状态栏，切换标签时同步
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncStatusBar()));
        this.syncStatusBar();
    }

    /** 主题颜色变更：令牌注入主视图根节点（顶部工具栏与内容区统一继承） */
    applyThemeColors(colors?: ThemeColors): void {
        if (this.rootEl) applyThemeColors(this.rootEl, colors);
    }

    /** 当前活动标签是本视图时隐藏 Obsidian 底部状态栏，否则恢复 */
    private syncStatusBar(): void {
        const isActive = this.app.workspace.activeLeaf?.view === this;
        document.body.toggleClass('is-parrot-plan-active', isActive === true);
    }

    /**
     * 渲染顶部工具栏右侧的「进行中任务」卡片。
     * 无进行中任务时清空并隐藏；有则显示任务名与已用时长。
     * 同时启动每分钟刷新已用时长的定时器。
     */
    renderRunningTaskCard(): void {
        const wrap = this.runningCardEl;
        if (!wrap) return;
        wrap.empty();

        // 清理上一次的定时器，避免累积
        if (this.runningCardTimer !== undefined) {
            window.clearInterval(this.runningCardTimer);
            this.runningCardTimer = undefined;
        }

        const running = this.pdcaRepo().runningTask;
        if (!running) {
            wrap.addClass('is-hidden');
            this.renderStatusBarRunningTask();
            return;
        }
        // 界面视图写入的是原型任务，日执行视图写入的是收集盒任务
        const name = running.source === 'prototype'
            ? this.prototypeTaskRepo().tasks.find(task => task.id === running.inboxId)?.name
            : this.inboxData.items.find(i => i.id === running.inboxId && !i.removed)?.title;
        if (!name) {
            wrap.addClass('is-hidden');
            this.renderStatusBarRunningTask();
            return;
        }
        wrap.removeClass('is-hidden');

        const card = wrap.createDiv({ cls: 'parrot-plan-running-card' });
        card.createSpan({ cls: 'parrot-plan-running-card-label', text: t('nav.runningLabel') });
        card.createSpan({ cls: 'parrot-plan-running-card-name', text: name });
        const timeEl = card.createSpan({ cls: 'parrot-plan-running-card-time' });

        const updateTime = () => {
            const elapsed = typeof running.startedAt === 'number'
                ? Math.max(0, Math.floor((Date.now() - running.startedAt) / 60000))
                : Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - running.start);
            timeEl.setText(t('nav.runningElapsed', { minutes: String(elapsed) }));
            // 状态栏与卡片同步刷新已用时长
            this.renderStatusBarRunningTask();
        };
        updateTime();
        this.runningCardTimer = window.setInterval(updateTime, 60 * 1000);
    }

    /**
     * 渲染状态栏中的「进行中任务」：显示「任务名称：时长」。
     * 状态栏元素由插件创建（插件加载即存在，不依赖本视图是否打开），这里只触发插件刷新。
     */
    private renderStatusBarRunningTask(): void {
        (this.plugin as Plugin & { renderStatusBarRunningTask?: () => void })
            .renderStatusBarRunningTask?.();
    }

    /** 渲染内容区：插件只有一个界面视图 */
    private async renderContent() {
        log('MainView.renderContent', {
            events: this.events.length,
            executions: this.executions.length,
        });
        this.contentRoot.empty();
        // 清除上一次视图残留在共享容器上的视图类，避免多个视图样式叠加导致布局错乱
        this.contentRoot.removeClass('interface-view');
        await this.interfaceView.renderInto(this.contentRoot);
    }

    async onClose() {
        unregisterThemeColorsConsumer(this);
        this.rootEl = undefined;
        // 清理进行中任务卡片的刷新定时器
        if (this.runningCardTimer !== undefined) {
            window.clearInterval(this.runningCardTimer);
            this.runningCardTimer = undefined;
        }
        // 状态栏元素由插件持有（关闭视图不销毁），无需在此处理
        document.body.removeClass('is-parrot-plan-active');
        this.containerEl.empty();
    }
}

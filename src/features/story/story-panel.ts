// 剧本面板：顶部工具栏「剧本」按钮打开，基于 FloatingPanel。
// 左侧垂直菜单（历史 / 官方 / 本地）+ 左下角「配置」；
// 官方页扫描官方剧本目录下的剧本项目，点击「预览」把剧本加入历史并跳转到历史页；
// 历史页左侧历史卡片、右侧预览窗口，底部「播放」通过 story-engine 加载项目并开始播放。
//
// 舞台渲染严格对齐《story-engine 调用规范》§7：
//   - 累积状态模型（bg / sprites / bubble / item），enter 事件清空全部；
//   - 立绘只有 left / center / right 三槽位，缺省按 left → center → right 让位；
//   - 未绑定真实图片的立绘不进舞台（不占槽位、不渲染、不震动）；
//   - 说话反馈改为立绘上跳震动（bump-0 / bump-1 交替），不再高亮 / 淡化；
//   - 气泡抬头按角色散列配色（我=白、旁白=蓝）；
//   - 播放节奏一律取引擎 DEFAULT_PLAYBACK_TIMING（§4.5），连续立绘合并为一组。
import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import {
    backgroundFadeSeconds,
    createPlayer,
    DEFAULT_PLAYBACK_TIMING,
    stepDelaySeconds,
    type ChoiceMenu,
    type PlayEvent,
    type StageCue,
    type StoryPlayer,
} from '../../libs/story-engine/dist/api.js';
import { FloatingPanel, type FloatingPanelOptions } from '../../ui/basic/floating-panel';
import {
    isExistingDirectory,
    isStoryDiskAvailable,
    loadStoryProject,
    resolveAssetUrl,
    scanStoryProjects,
    type StoryEntry,
} from './story-catalog';

/** 本地剧本目录类型：vault 目录（vault 相对路径）/ 本地目录（绝对路径） */
type StoryLocalDirMode = 'vault' | 'local';

/** 剧本面板配置 */
export interface StoryPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 官方剧本目录（绝对路径） */
    officialDir?: string;
    /** vault 根目录绝对路径（解析 vault 相对路径用） */
    vaultBasePath?: string;
    /** 读取本地剧本目录配置 */
    getLocalDir?: () => { mode: StoryLocalDirMode; path: string };
    /** 保存本地剧本目录配置 */
    saveLocalDir?: (mode: StoryLocalDirMode, path: string) => Promise<void>;
}

/** Obsidian 渲染进程里的 require（桌面端才有） */
function getNodeRequire(): ((module: string) => unknown) | null {
    const win = window as unknown as { require?: (module: string) => unknown };
    if (typeof win.require === 'function') return win.require;
    const globalReq = (globalThis as { require?: (module: string) => unknown }).require;
    return typeof globalReq === 'function' ? globalReq : null;
}

/** 是否为绝对路径（Windows 盘符 / 以斜杠开头） */
function isAbsolutePath(path: string): boolean {
    return /^([a-zA-Z]:[\\/]|\/)/.test(path);
}

/** 剧本菜单标识 */
type StoryMenuId = 'history' | 'official' | 'local';

/** 历史条目：预览过的剧本 */
interface StoryHistoryItem {
    dir: string;
    name: string;
    labelCount: number;
}

/** 播放状态（idle = 尚未开始） */
type StoryPlayState = 'idle' | 'playing' | 'menu' | 'finished' | 'error';

/** 立绘槽位（规范 §7.4.1：只有三个） */
type SpriteSlot = 'left' | 'center' | 'right';

/** 在场立绘（规范 §7.1 的 StageModel.sprites） */
interface StorySprite {
    /** 素材 id，同一角色只保留一个 */
    assetId: string;
    name: string;
    path: string;
    position: SpriteSlot;
    pose?: string;
    /** 说话计数：每次被 say / inner / act 命中 +1，渲染时按 % 2 交替挂 bump 类名 */
    talkCount: number;
}

/** 对话框内容（规范 §7.5：任何时刻最多一个） */
interface StoryBubble {
    /** 抬头文案（含「（心声）」「（动作）」后缀） */
    title: string;
    text: string;
    /** actor = 角色侧（say / inner / act），narrator = 旁白（vo） */
    tone: 'actor' | 'narrator';
    /** 原始角色名（旁白为 null），抬头配色按它取 */
    speaker: string | null;
}

/** 舞台画面状态（规范 §7.1：累积状态 + 声明式重绘） */
interface StoryStageView {
    labelName: string;
    bg: { path: string; fadeSeconds: number } | null;
    sprites: StorySprite[];
    bubble: StoryBubble | null;
    item: { path: string; name: string; seq: number } | null;
}

/** 舞台各层容器（只创建一次，后续增量更新） */
interface StoryStageEls {
    host: HTMLElement;
    bg: HTMLElement;
    chip: HTMLElement;
    spriteLayer: HTMLElement;
    item: HTMLElement;
    dialog: HTMLElement;
    menu: HTMLElement;
    end: HTMLElement;
    error: HTMLElement;
    hint: HTMLElement;
}

const SPRITE_SLOTS: SpriteSlot[] = ['left', 'center', 'right'];

/** 位置别名 → 槽位（规范 §7.4.1） */
const SLOT_ALIASES: Record<string, SpriteSlot> = {
    left: 'left', l: 'left', left_side: 'left', leftside: 'left', 'left-side': 'left',
    左: 'left', 左边: 'left', 左侧: 'left',
    center: 'center', centre: 'center', middle: 'center', mid: 'center', c: 'center',
    中: 'center', 中间: 'center', 中央: 'center',
    right: 'right', r: 'right', right_side: 'right', rightside: 'right', 'right-side': 'right',
    右: 'right', 右边: 'right', 右侧: 'right',
};

/** 归一化站位；null = 没写或写了不认识的值 */
function normalizeSlot(raw: string | undefined): SpriteSlot | null {
    const value = (raw ?? '').trim().toLowerCase();
    return value ? SLOT_ALIASES[value] ?? null : null;
}

/** 期望槽位空着就用它，否则按 left → center → right 找第一个空位，全满回落到期望值 */
function pickSlot(desired: SpriteSlot | null, occupied: SpriteSlot[]): SpriteSlot {
    if (desired && !occupied.includes(desired)) return desired;
    return SPRITE_SLOTS.find((slot) => !occupied.includes(slot)) ?? desired ?? 'left';
}

/** 立绘是否绑定了真实图片（规范 §7.4：空串或占位路径不进舞台） */
function hasRealSpriteImage(path: string | undefined): boolean {
    return /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(path ?? '');
}

/** 抬头配色调色板（规范 §7.5） */
const SPEAKER_PALETTE = ['#ffd479', '#8be0a4', '#f49ac2', '#8fd3ff', '#c9a7ff', '#ffb37a', '#7fe6dc', '#e8e07f'];
/** 第一人称主角固定白色 */
const SELF_SPEAKERS = ['我', '自己', '本人'];
/** 旁白蓝 */
const NARRATOR_COLOR = '#9dc0ff';

/** 按角色名散列到调色板（同名永远同色） */
function speakerColor(name: string | null): string {
    if (!name) return NARRATOR_COLOR;
    if (SELF_SPEAKERS.includes(name.trim())) return '#ffffff';
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

/** 剧本面板 */
export class StoryPanel extends FloatingPanel {
    /** 面板配置 */
    private readonly panelOptions: StoryPanelOptions;
    /** 当前激活的菜单（配置未激活时生效） */
    private activeMenu: StoryMenuId = 'history';
    /** 左下角「配置」是否激活 */
    private configActive = false;
    /** 官方剧本目录（默认插件目录下的 story 子目录） */
    private readonly officialDir: string;
    /** vault 根目录绝对路径 */
    private readonly vaultBasePath: string;
    /** 本地剧本目录类型 */
    private localDirMode: StoryLocalDirMode = 'vault';
    /** 本地剧本目录路径（空表示未配置） */
    private localDirPath = '';
    /** 本地剧本目录配置浮层 */
    private localDirConfigPanel: FloatingPanel | null = null;

    /** 历史列表（本次会话内有效，最近预览的排在最前） */
    private history: StoryHistoryItem[] = [];
    /** 当前选中的历史条目目录 */
    private activeDir: string | null = null;

    /** 当前播放器 */
    private player: StoryPlayer | null = null;
    /** 播放器事件退订函数 */
    private offPlayer: (() => void) | null = null;
    /** 当前等待选择的菜单 */
    private menu: ChoiceMenu | null = null;
    private playState: StoryPlayState = 'idle';
    private errorMessage = '';

    /** 舞台画面（累积状态模型） */
    private stage: StoryStageView = this.emptyStage();
    /** 物品浮出的自动淡出定时器 */
    private itemTimer: number | null = null;
    private itemSeq = 0;
    /** 自动播放定时器 */
    private tickTimer: number | null = null;
    /** 是否自动播放（false = 手动「下一步」） */
    private autoPlay = true;

    /** 舞台各层容器（增量更新用，切换剧本 / 重绘时重建） */
    private stageEls: StoryStageEls | null = null;
    /** 立绘节点缓存：assetId → 元素 */
    private spriteEls = new Map<string, HTMLElement>();
    /** 对话框节点缓存 */
    private dialogEls: { box: HTMLElement; speaker: HTMLElement; text: HTMLElement } | null = null;
    /** 当前背景键（path|fade），用于判断是否需要替换背景图 */
    private bgKey = '';
    /** 已渲染的物品序号 */
    private itemSeqRendered = 0;
    /** 当前菜单键，用于判断是否需要重建按钮 */
    private menuKey = '';

    constructor(options: StoryPanelOptions = {}) {
        super({
            width: 900,
            title: t('story.title'),
            closeOnBlur: true,
            ...options,
        });
        this.panelOptions = options;
        this.officialDir = options.officialDir ?? '';
        this.vaultBasePath = options.vaultBasePath ?? '';
        const localDir = options.getLocalDir?.();
        if (localDir) {
            this.localDirMode = localDir.mode;
            this.localDirPath = localDir.path;
        }
        this.body.addClass('story-panel');
        this.renderContent();
    }

    /** 重新打开时重扫目录（剧本文件可能在外部被增删） */
    open(): void {
        const wasOpen = this.isOpen;
        super.open();
        if (!wasOpen) this.renderContent();
    }

    /** 关闭面板时释放播放器订阅与定时器 */
    close(): void {
        this.localDirConfigPanel?.close();
        this.disposePlayer();
        this.clearItemTimer();
        this.clearTickTimer();
        super.close();
    }

    /** 渲染面板内容：左侧菜单栏 + 右侧内容区 */
    private renderContent(): void {
        // 播放中只做增量更新：不重建面板骨架，避免背景图反复销毁重建导致闪烁
        if (this.canUpdateInPlace()) {
            this.updatePlaybackView();
            return;
        }

        this.body.empty();
        this.resetStageEls();

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

    /** 当前 DOM 是否可以直接增量更新（历史页 + 已选中剧本 + 舞台骨架已建立） */
    private canUpdateInPlace(): boolean {
        if (this.configActive || this.activeMenu !== 'history') return false;
        if (!this.activeDir || !this.stageEls) return false;
        return this.stageEls.host.isConnected;
    }

    /** 播放中的增量更新：只刷新舞台各层与底部状态栏 */
    private updatePlaybackView(): void {
        const els = this.stageEls;
        if (!els) return;
        this.renderStage(els.host, this.activeDir ?? '');
        this.updateFooter();
    }

    /** 底部状态栏增量更新：只改状态文案与按钮 */
    private updateFooter(): void {
        const footer = this.body.querySelector('.story-panel-preview-footer');
        if (!footer) return;
        const status = footer.querySelector('.story-panel-preview-status');
        if (status) status.textContent = this.statusText();
        const actions = footer.querySelector('.story-panel-preview-actions');
        if (actions) {
            actions.replaceChildren();
            this.renderFooterActions(actions as HTMLElement);
        }
    }

    /** 清空舞台节点缓存（面板骨架重建时调用） */
    private resetStageEls(): void {
        this.stageEls = null;
        this.spriteEls.clear();
        this.dialogEls = null;
        this.bgKey = '';
        this.itemSeqRendered = 0;
        this.menuKey = '';
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

    /** 历史页：左侧垂直历史卡片 + 右侧预览窗口 */
    private renderHistory(content: HTMLElement): void {
        const wrap = content.createDiv({ cls: 'story-panel-history' });

        const list = wrap.createDiv({ cls: 'story-panel-history-list' });
        if (this.history.length === 0) {
            list.createDiv({ cls: 'story-panel-empty', text: t('story.historyEmpty') });
        }
        for (const item of this.history) {
            const card = list.createDiv({ cls: 'story-panel-history-card', attr: { role: 'button' } });
            card.toggleClass('is-active', item.dir === this.activeDir);
            card.createDiv({ cls: 'story-panel-history-card-title', text: item.name });
            card.createDiv({
                cls: 'story-panel-history-card-meta',
                text: t('story.cardLabels', { count: item.labelCount }),
            });
            card.addEventListener('click', () => {
                if (item.dir === this.activeDir) return;
                this.activeDir = item.dir;
                this.resetPlayback();
                this.renderContent();
            });
        }

        this.renderPreview(wrap.createDiv({ cls: 'story-panel-preview' }));
    }

    /** 预览窗口：标题栏（含自动播放开关）+ 舞台 + 底部播放栏 */
    private renderPreview(preview: HTMLElement): void {
        const active = this.history.find((item) => item.dir === this.activeDir) ?? null;

        const header = preview.createDiv({ cls: 'story-panel-preview-header' });
        header.createDiv({
            cls: 'story-panel-preview-title',
            text: active ? active.name : t('story.previewTitle'),
        });
        if (active) this.renderAutoPlayToggle(header);

        const body = preview.createDiv({ cls: 'story-panel-preview-body' });
        if (!active) {
            body.addClass('is-idle');
            body.setText(t('story.previewPlaceholder'));
            return;
        }

        this.renderStage(body, active.dir);
        this.renderFooter(preview);
    }

    /** 右上角自动播放开关：自动播放 / 手动「下一步」 */
    private renderAutoPlayToggle(header: HTMLElement): void {
        const btn = header.createEl('button', {
            cls: 'story-panel-autoplay-btn',
            attr: { type: 'button' },
        });
        this.applyAutoPlayButtonState(btn);
        btn.addEventListener('click', () => this.toggleAutoPlay());
    }

    /** 按当前 autoPlay 状态刷新开关按钮的图标、文案与高亮 */
    private applyAutoPlayButtonState(btn: HTMLElement): void {
        const label = this.autoPlay ? t('story.autoPlayOn') : t('story.autoPlayOff');
        btn.toggleClass('is-on', this.autoPlay);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.replaceChildren();
        setIcon(btn.createSpan({ cls: 'story-panel-autoplay-icon' }), this.autoPlay ? 'pause' : 'play');
        btn.createSpan({ cls: 'story-panel-autoplay-label', text: label });
    }

    /** 切换自动播放：关闭时停掉定时器，开启时从当前进度继续推进 */
    private toggleAutoPlay(): void {
        this.autoPlay = !this.autoPlay;
        this.clearTickTimer();
        // 播放中走增量更新，标题栏不会重建，需就地刷新开关按钮
        const btn = this.body.querySelector('.story-panel-autoplay-btn');
        if (btn) this.applyAutoPlayButtonState(btn as HTMLElement);
        this.renderContent();
        if (this.autoPlay && this.playState === 'playing') {
            this.tickTimer = window.setTimeout(() => {
                this.tickTimer = null;
                this.advance();
            }, 0);
        }
    }

    /** 舞台：背景 → 立绘 → 物品 → 对话框 → 菜单（对齐规范 §7.2 的层序） */
    private renderStage(host: HTMLElement, projectDir: string): void {
        // 舞台骨架只建一次；后续推进只更新变化的层，避免整块重建导致闪烁（规范 §7.1 幂等重绘）
        if (this.stageEls?.host !== host) {
            this.stageEls = this.buildStageSkeleton(host);
        }
        const els = this.stageEls;
        const stage = this.stage;

        // 1 背景层：仅在背景变化时替换 <img>，避免每步重新解码图片
        const bgKey = stage.bg ? `${stage.bg.path}|${stage.bg.fadeSeconds}` : '';
        if (bgKey !== this.bgKey) {
            this.bgKey = bgKey;
            els.bg.replaceChildren();
            if (stage.bg) {
                const bg = els.bg.createEl('img', {
                    cls: 'story-stage-bg',
                    attr: { src: resolveAssetUrl(projectDir, stage.bg.path), alt: '' },
                });
                bg.style.setProperty('--story-bg-fade', `${stage.bg.fadeSeconds}s`);
            } else if (this.playState !== 'idle') {
                els.bg.createDiv({ cls: 'story-stage-bg-empty', text: t('story.bgUnbound') });
            }
        }

        // 片段名
        if (els.chip.getText() !== stage.labelName) els.chip.setText(stage.labelName);
        els.chip.toggleClass('is-hidden', !stage.labelName);

        // 2 立绘层：按 assetId 复用节点，只更新位置 / 表情 / 震动类名
        this.syncSprites(els.spriteLayer, projectDir);

        // 3 关键物品层：按 seq 判断是否需要重建
        if (stage.item) {
            if (this.itemSeqRendered !== stage.item.seq) {
                this.itemSeqRendered = stage.item.seq;
                els.item.replaceChildren();
                const box = els.item.createDiv({ cls: 'story-item' });
                box.createEl('img', { attr: { src: resolveAssetUrl(projectDir, stage.item.path), alt: '' } });
                box.createDiv({ cls: 'story-item-name', text: stage.item.name });
            }
        } else if (this.itemSeqRendered !== 0) {
            this.itemSeqRendered = 0;
            els.item.replaceChildren();
        }

        // 5 对话框层：只改文字与色调，不重建框体
        this.syncDialog(els.dialog, projectDir);

        // 6 菜单层（z-index 高于物品层，避免被物品卡片压住）
        this.syncMenu(els.menu);

        // 结束 / 错误提示
        els.end.toggleClass('is-hidden', this.playState !== 'finished');
        const errorText = this.playState === 'error' ? this.errorMessage : '';
        if (els.error.getText() !== errorText) els.error.setText(errorText);
        els.error.toggleClass('is-hidden', !errorText);
    }

    /** 建立舞台骨架：各层容器只创建一次，后续复用 */
    private buildStageSkeleton(host: HTMLElement): StoryStageEls {
        const bg = host.createDiv({ cls: 'story-stage-bg-layer' });
        const chip = host.createDiv({ cls: 'story-stage-chip is-hidden' });
        const spriteLayer = host.createDiv({ cls: 'story-sprite-layer' });
        const item = host.createDiv({ cls: 'story-item-layer' });
        const hint = host.createDiv({ cls: 'story-stage-hint' });
        hint.createDiv({ text: t('story.stageIdle') });
        hint.createDiv({ cls: 'story-stage-hint-path', text: this.activeDir ?? '' });
        const dialog = host.createDiv({ cls: 'story-dialog-layer is-hidden' });
        const menu = host.createDiv({ cls: 'story-stage-menu is-hidden' });
        const end = host.createDiv({ cls: 'story-stage-end is-hidden', text: t('story.endHint') });
        const error = host.createDiv({ cls: 'story-stage-error is-hidden' });
        return { host, bg, chip, spriteLayer, item, dialog, menu, end, error, hint };
    }

    /** 立绘层增量同步：按 assetId 复用节点 */
    private syncSprites(layer: HTMLElement, projectDir: string): void {
        const sprites = this.stage.sprites;
        const alive = new Set<string>();

        for (const sprite of sprites) {
            alive.add(sprite.assetId);
            let el = this.spriteEls.get(sprite.assetId);
            const isNew = !el;
            if (!el) {
                el = layer.createDiv({ cls: 'story-sprite' });
                const img = el.createEl('img', {
                    cls: 'story-sprite-image',
                    attr: { src: resolveAssetUrl(projectDir, sprite.path), alt: sprite.name },
                });
                // 已绑定但读图失败：换成虚线占位（规范 §7.4）
                img.addEventListener('error', () => {
                    img.remove();
                    if (!el?.querySelector('.story-sprite-empty')) {
                        el?.createDiv({ cls: 'story-sprite-empty', text: sprite.name });
                    }
                });
                el.createDiv({ cls: 'story-sprite-name' });
                this.spriteEls.set(sprite.assetId, el);
            }

            // 位置（className 会重置类名，登场 / 震动类名需在其后追加）
            el.className = `story-sprite pos-${sprite.position}`;
            // 登场动画：时长取引擎 spriteEnter（§4.5 / §7.4）
            if (isNew) {
                el.addClass('is-entering');
                el.style.setProperty('--sprite-enter', `${DEFAULT_PLAYBACK_TIMING.spriteEnter}s`);
            }
            // 说话震动：按 talkCount % 2 交替挂类名，切换类名让 CSS 动画重播
            if (sprite.talkCount > 0) el.addClass(`bump-${sprite.talkCount % 2}`);
            // 名牌
            const nameEl = el.querySelector('.story-sprite-name');
            const nameText = sprite.pose ? `${sprite.name} · ${sprite.pose}` : sprite.name;
            if (nameEl && nameEl.textContent !== nameText) nameEl.textContent = nameText;
        }

        // 移除已下台的立绘
        this.spriteEls.forEach((el, assetId) => {
            if (!alive.has(assetId)) {
                el.remove();
                this.spriteEls.delete(assetId);
            }
        });
    }

    /** 对话框增量同步：只改文字与色调 */
    private syncDialog(layer: HTMLElement, _projectDir: string): void {
        const bubble = this.stage.bubble;
        const show = this.playState !== 'idle' && !!bubble;
        layer.toggleClass('is-hidden', !show);
        this.stageEls?.hint.toggleClass('is-hidden', this.playState !== 'idle');
        if (!show || !bubble) return;

        if (!this.dialogEls) {
            const box = layer.createDiv({ cls: 'story-dialog-box' });
            const speaker = box.createDiv({ cls: 'story-dialog-speaker' });
            const text = box.createDiv({ cls: 'story-dialog-text' });
            this.dialogEls = { box, speaker, text };
        }
        const { box, speaker, text } = this.dialogEls;
        box.className = `story-dialog-box tone-${bubble.tone}`;
        if (speaker.textContent !== bubble.title) speaker.textContent = bubble.title;
        speaker.style.setProperty('color', speakerColor(bubble.speaker));
        if (text.textContent !== bubble.text) text.textContent = bubble.text;
    }

    /** 菜单增量同步：菜单内容变化时才重建按钮 */
    private syncMenu(layer: HTMLElement): void {
        const menu = this.menu;
        layer.toggleClass('is-hidden', !menu);
        if (!menu) {
            this.menuKey = '';
            layer.replaceChildren();
            return;
        }
        const key = `${menu.menuId}|${menu.title}|${menu.jump}|${menu.options.map((o) => o.resultId).join(',')}`;
        if (key === this.menuKey) return;
        this.menuKey = key;

        layer.replaceChildren();
        if (menu.title) layer.createDiv({ cls: 'story-stage-menu-title', text: menu.title });
        if (menu.jump === 'back') {
            layer.createDiv({ cls: 'story-stage-menu-hint', text: t('story.menuBackHint') });
        }
        for (const option of menu.options) {
            const btn = layer.createEl('button', {
                cls: 'story-stage-menu-option',
                attr: { type: 'button' },
                text: option.text,
            });
            btn.addEventListener('click', () => this.choose(option.resultId));
        }
    }

    /** 预览窗口底部：播放状态 + 播放 / 下一步 / 重播按钮 */
    private renderFooter(preview: HTMLElement): void {
        const footer = preview.createDiv({ cls: 'story-panel-preview-footer' });
        footer.createSpan({ cls: 'story-panel-preview-status', text: this.statusText() });
        this.renderFooterActions(footer.createDiv({ cls: 'story-panel-preview-actions' }));
    }

    /** 底部按钮：按播放状态渲染（增量更新时也复用） */
    private renderFooterActions(actions: HTMLElement): void {
        if (this.playState === 'idle' || this.playState === 'finished' || this.playState === 'error') {
            const btn = actions.createEl('button', {
                cls: 'story-panel-play-btn is-primary',
                attr: { type: 'button' },
                text: this.playState === 'idle' ? t('story.playBtn') : t('story.replayBtn'),
            });
            setIcon(btn.createSpan({ cls: 'story-panel-card-btn-icon' }), 'play');
            btn.addEventListener('click', () => this.startPlayback());
            return;
        }

        // 手动模式才显示「下一步」；自动播放由右上角开关控制
        if (this.playState === 'playing' && !this.autoPlay) {
            const btn = actions.createEl('button', {
                cls: 'story-panel-play-btn',
                attr: { type: 'button' },
                text: t('story.nextBtn'),
            });
            setIcon(btn.createSpan({ cls: 'story-panel-card-btn-icon' }), 'chevron-right');
            btn.addEventListener('click', () => this.advance());
        }
    }

    /** 底部状态文案 */
    private statusText(): string {
        if (this.playState === 'playing') return t('story.statusPlaying');
        if (this.playState === 'menu') return t('story.statusWaiting');
        if (this.playState === 'finished') return t('story.statusFinished');
        if (this.playState === 'error') return t('story.statusError');
        return '';
    }

    /** 官方 / 本地页：扫描对应目录下的剧本项目 */
    private renderList(content: HTMLElement, menu: Exclude<StoryMenuId, 'history'>): void {
        const list = content.createDiv({ cls: 'story-panel-list' });
        if (!isStoryDiskAvailable()) {
            list.createDiv({ cls: 'story-panel-empty', text: t('story.scanUnsupported') });
            return;
        }

        const root = menu === 'official' ? this.officialDir : this.resolveLocalDirAbs();
        if (!root) {
            list.createDiv({
                cls: 'story-panel-empty',
                text: menu === 'official' ? t('story.officialEmpty') : t('story.localNotConfigured'),
            });
            return;
        }

        let entries: StoryEntry[] = [];
        try {
            entries = scanStoryProjects(root);
        } catch (err) {
            console.error('扫描剧本目录失败', root, err);
        }

        if (entries.length === 0) {
            list.createDiv({
                cls: 'story-panel-empty',
                text: menu === 'official' ? t('story.officialEmpty') : t('story.localEmpty'),
            });
            list.createDiv({ cls: 'story-panel-empty-path', text: root });
            return;
        }

        for (const entry of entries) {
            const card = list.createDiv({ cls: 'story-panel-list-item' });
            const main = card.createDiv({ cls: 'story-panel-list-item-main' });
            main.createDiv({ cls: 'story-panel-list-item-title', text: entry.name });
            main.createDiv({ cls: 'story-panel-list-item-desc', text: this.entryMeta(entry) });

            const btn = card.createEl('button', {
                cls: 'story-panel-card-btn',
                attr: { type: 'button', 'aria-label': t('story.previewBtn') },
                text: t('story.previewBtn'),
            });
            setIcon(btn.createSpan({ cls: 'story-panel-card-btn-icon' }), 'eye');
            btn.addEventListener('click', () => this.addToHistory(entry));
        }
    }

    /** 卡片副标题：片段数 + 错误 / 警告数 */
    private entryMeta(entry: StoryEntry): string {
        const parts = [t('story.cardLabels', { count: entry.labelCount })];
        if (entry.errorCount > 0) parts.push(t('story.cardErrors', { count: entry.errorCount }));
        if (entry.warningCount > 0) parts.push(t('story.cardWarnings', { count: entry.warningCount }));
        return parts.join(' · ');
    }

    /** 配置页：官方剧本目录 / 本地剧本目录（可配置）/ 联动当天任务（当前为占位说明） */
    private renderConfig(content: HTMLElement): void {
        const config = content.createDiv({ cls: 'story-panel-config' });

        const officialRow = config.createDiv({ cls: 'story-panel-config-row' });
        officialRow.createSpan({ cls: 'story-panel-config-label', text: t('story.configOfficialDir') });
        officialRow.createSpan({
            cls: 'story-panel-config-value',
            text: this.officialDir || t('story.configUnset'),
        });
        if (this.officialDir) {
            this.createConfigAction(officialRow, 'folder', t('story.openFolder'), () => this.openDir(this.officialDir));
        }

        // 本地剧本目录：路径 + 文件夹（配置后显示）+ 配置按钮
        const localRow = config.createDiv({ cls: 'story-panel-config-row' });
        localRow.createSpan({ cls: 'story-panel-config-label', text: t('story.configLocalDir') });
        localRow.createSpan({
            cls: 'story-panel-config-value',
            text: this.localDirPath || t('story.configUnset'),
        });
        const localAbs = this.resolveLocalDirAbs();
        if (this.localDirPath && localAbs) {
            this.createConfigAction(localRow, 'folder', t('story.openFolder'), () => this.openDir(localAbs));
        }
        this.createConfigAction(localRow, 'settings', t('story.configTitle'), () => this.openLocalDirConfig());

        const linkRow = config.createDiv({ cls: 'story-panel-config-row' });
        linkRow.createSpan({ cls: 'story-panel-config-label', text: t('story.configLinkTasks') });
        linkRow.createSpan({ cls: 'story-panel-config-value', text: t('story.configLinkTasksDesc') });
    }

    /** 配置行末尾的图标按钮 */
    private createConfigAction(row: HTMLElement, icon: string, label: string, onClick: () => void): void {
        const btn = row.createEl('button', {
            cls: 'story-panel-config-folder-btn',
            attr: { type: 'button', 'aria-label': label, title: label },
        });
        setIcon(btn, icon);
        btn.addEventListener('click', onClick);
    }

    /** 在系统资源管理器中打开目录（不存在时先创建） */
    private openDir(dir: string): void {
        if (!dir) return;
        const req = getNodeRequire();
        if (!req) return;
        try {
            const fs = req('fs') as { mkdirSync: (p: string, o: { recursive: boolean }) => void };
            fs.mkdirSync(dir, { recursive: true });
            const electron = req('electron') as { shell: { openPath: (p: string) => Promise<string> } };
            void electron.shell.openPath(dir);
        } catch (err) {
            console.error('打开剧本目录失败', err);
        }
    }

    /* ==================== 本地剧本目录配置 ==================== */

    /** 打开本地剧本目录配置浮层 */
    private openLocalDirConfig(): void {
        if (!this.localDirConfigPanel) {
            this.localDirConfigPanel = new FloatingPanel({
                width: 440,
                title: t('story.localDirConfigTitle'),
                closeOnBlur: true,
            });
            this.localDirConfigPanel.body.addClass('story-local-dir-config');
            // 配置浮层内的点击不触发剧本面板的失焦关闭
            this.addIgnoreElement(this.localDirConfigPanel.element);
        }
        this.renderLocalDirConfigContent(this.localDirConfigPanel);
        this.localDirConfigPanel.open();
    }

    /** 渲染配置浮层内容：目录类型下拉 + 路径输入 + 浏览 + 取消 / 确定 */
    private renderLocalDirConfigContent(panel: FloatingPanel): void {
        const body = panel.body;
        body.empty();
        let mode: StoryLocalDirMode = this.localDirMode;
        let path = this.localDirPath;

        // 目录类型：vault 目录 / 本地目录
        const typeRow = body.createDiv({ cls: 'story-local-dir-config-row' });
        typeRow.createSpan({ cls: 'story-local-dir-config-label', text: t('story.configDirType') });
        const select = typeRow.createEl('select', { cls: 'dropdown story-local-dir-config-select' });
        const typeOptions: { value: StoryLocalDirMode; label: string }[] = [
            { value: 'vault', label: t('story.configDirTypeVault') },
            { value: 'local', label: t('story.configDirTypeLocal') },
        ];
        for (const item of typeOptions) {
            const optionEl = select.createEl('option', { text: item.label, attr: { value: item.value } });
            optionEl.selected = item.value === mode;
        }

        // 具体路径：输入框 + 系统浏览按钮
        const pathRow = body.createDiv({ cls: 'story-local-dir-config-row' });
        pathRow.createSpan({ cls: 'story-local-dir-config-label', text: t('story.configDirPath') });
        const input = pathRow.createEl('input', {
            cls: 'story-local-dir-config-input',
            attr: { type: 'text', placeholder: t('story.configDirPathPlaceholder') },
        });
        input.value = path;
        const browseBtn = pathRow.createEl('button', {
            cls: 'story-local-dir-config-browse',
            attr: { type: 'button' },
            text: t('story.configBrowse'),
        });

        const errorEl = body.createDiv({ cls: 'story-local-dir-config-error' });
        select.addEventListener('change', () => {
            mode = select.value === 'local' ? 'local' : 'vault';
            errorEl.setText('');
        });
        input.addEventListener('input', () => errorEl.setText(''));
        browseBtn.addEventListener('click', () => {
            const picked = this.pickDirectory();
            if (!picked) return;
            if (mode === 'vault') {
                const rel = this.toVaultRelative(picked);
                if (rel === null) {
                    errorEl.setText(t('story.configErrOutsideVault'));
                    return;
                }
                if (rel === '') {
                    errorEl.setText(t('story.configErrVaultRoot'));
                    return;
                }
                path = rel;
            } else {
                path = picked;
            }
            input.value = path;
            errorEl.setText('');
        });

        const footer = body.createDiv({ cls: 'story-local-dir-config-footer' });
        const cancelBtn = footer.createEl('button', {
            cls: 'story-local-dir-config-btn',
            attr: { type: 'button' },
            text: t('common.cancel'),
        });
        cancelBtn.addEventListener('click', () => panel.close());
        const confirmBtn = footer.createEl('button', {
            cls: 'story-local-dir-config-btn mod-cta',
            attr: { type: 'button' },
            text: t('common.confirm'),
        });
        confirmBtn.addEventListener('click', () => {
            void this.confirmLocalDirConfig(mode, input.value, errorEl, panel);
        });
    }

    /** 校验并保存本地剧本目录配置 */
    private async confirmLocalDirConfig(
        mode: StoryLocalDirMode,
        rawPath: string,
        errorEl: HTMLElement,
        panel: FloatingPanel,
    ): Promise<void> {
        let path = rawPath.trim();
        if (mode === 'vault') {
            if (isAbsolutePath(path)) {
                const rel = this.toVaultRelative(path);
                if (rel === null) {
                    errorEl.setText(t('story.configErrOutsideVault'));
                    return;
                }
                if (rel === '') {
                    errorEl.setText(t('story.configErrVaultRoot'));
                    return;
                }
                path = rel;
            } else {
                path = this.normalizeSlashes(path).replace(/^\/+|\/+$/g, '');
            }
        }
        const error = this.validateLocalDir(mode, path);
        if (error) {
            errorEl.setText(error);
            return;
        }

        const savedPath = mode === 'vault'
            ? this.toVaultRelative(this.resolveDirAbs(mode, path)) ?? path
            : path;
        this.localDirMode = mode;
        this.localDirPath = savedPath;
        try {
            await this.panelOptions.saveLocalDir?.(mode, savedPath);
        } catch (err) {
            console.error('保存本地剧本目录配置失败', err);
            errorEl.setText(t('story.configErrSave'));
            return;
        }
        panel.close();
        this.renderContent();
    }

    /** 校验目录配置；返回空字符串表示通过 */
    private validateLocalDir(mode: StoryLocalDirMode, path: string): string {
        if (!path) return t('story.configErrRequired');
        if (mode === 'local') {
            if (!isAbsolutePath(path)) return t('story.configErrAbsolute');
            return isExistingDirectory(path) ? '' : t('story.configErrNotFound');
        }
        const abs = this.resolveDirAbs(mode, path);
        if (!abs) return t('story.configErrVaultUnavailable');
        const rel = this.toVaultRelative(abs);
        if (rel === null) return t('story.configErrOutsideVault');
        if (rel === '') return t('story.configErrVaultRoot');
        return isExistingDirectory(abs) ? '' : t('story.configErrNotFound');
    }

    /** 把路径统一成正斜杠 */
    private normalizeSlashes(path: string): string {
        return path.replace(/\\/g, '/');
    }

    /** 把配置路径解析成绝对路径（vault 目录以 vault 根目录为基准） */
    private resolveDirAbs(mode: StoryLocalDirMode, path: string): string {
        if (!path) return '';
        if (mode === 'local') return path;
        if (!this.vaultBasePath) return '';
        const clean = this.normalizeSlashes(path).replace(/^\/+|\/+$/g, '');
        if (!clean) return '';
        const req = getNodeRequire();
        try {
            const nodePath = req?.('path') as { join: (...parts: string[]) => string } | undefined;
            if (nodePath) return nodePath.join(this.vaultBasePath, ...clean.split('/'));
        } catch {
            // 忽略，走下面的字符串拼接兜底
        }
        return `${this.vaultBasePath.replace(/[\\/]+$/, '')}/${clean}`;
    }

    /** 当前配置的本地剧本目录绝对路径（未配置 / 无法解析时为空） */
    private resolveLocalDirAbs(): string {
        if (!this.localDirPath) return '';
        return this.resolveDirAbs(this.localDirMode, this.localDirPath);
    }

    /** 绝对路径转 vault 相对路径：null = 不在 vault 内，'' = vault 根目录 */
    private toVaultRelative(abs: string): string | null {
        if (!this.vaultBasePath || !abs) return null;
        let rel = '';
        const req = getNodeRequire();
        try {
            const nodePath = req?.('path') as { relative: (from: string, to: string) => string } | undefined;
            if (nodePath) rel = nodePath.relative(this.vaultBasePath, abs);
        } catch {
            // 忽略，走下面的字符串兜底
        }
        if (!rel) {
            const base = this.normalizeSlashes(this.vaultBasePath).replace(/\/+$/, '');
            const target = this.normalizeSlashes(abs);
            if (target.toLowerCase() === base.toLowerCase()) return '';
            if (target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
                rel = target.slice(base.length + 1);
            } else {
                return null;
            }
        }
        rel = this.normalizeSlashes(rel).replace(/^\/+|\/+$/g, '');
        if (rel === '' || rel === '.') return '';
        if (rel === '..' || rel.startsWith('../')) return null;
        return rel;
    }

    /** 调用系统目录选择框，取消 / 不可用时返回 null */
    private pickDirectory(): string | null {
        const req = getNodeRequire();
        if (!req) return null;
        try {
            const electron = req('electron') as {
                remote?: { dialog?: { showOpenDialogSync?: (options: unknown) => string[] | undefined } };
                dialog?: { showOpenDialogSync?: (options: unknown) => string[] | undefined };
            };
            const dialog = electron.remote?.dialog ?? electron.dialog;
            const picked = dialog?.showOpenDialogSync?.({
                properties: ['openDirectory', 'createDirectory'],
            });
            return picked && picked.length > 0 ? picked[0] : null;
        } catch (err) {
            console.error('打开系统目录选择框失败', err);
            return null;
        }
    }

    /* ==================== 播放 ==================== */

    /** 点击「预览」：加入历史（去重置顶）并切到历史页 */
    private addToHistory(entry: StoryEntry): void {
        this.history = [
            { dir: entry.dir, name: entry.name, labelCount: entry.labelCount },
            ...this.history.filter((item) => item.dir !== entry.dir),
        ];
        this.activeDir = entry.dir;
        this.activeMenu = 'history';
        this.configActive = false;
        this.resetPlayback();
        this.renderContent();
    }

    /** 从入口片段开始播放 */
    private startPlayback(): void {
        if (!this.activeDir) return;
        this.resetPlayback();

        const project = loadStoryProject(this.activeDir);
        if (!project) {
            this.playState = 'error';
            this.errorMessage = t('story.loadFailed', { message: this.activeDir });
            this.renderContent();
            return;
        }

        const errors = project.diagnostics.filter((issue) => issue.severity === 'error');
        if (errors.length > 0) {
            this.playState = 'error';
            this.errorMessage = errors
                .slice(0, 5)
                .map((issue) => (issue.file ? `${issue.file}: ${issue.message}` : issue.message))
                .join('\n');
            this.renderContent();
            return;
        }

        try {
            this.player = createPlayer(project);
            this.offPlayer = this.player.on((event) => this.handlePlayEvent(event));
            this.playState = 'playing';
            this.player.start();
        } catch (err) {
            this.playState = 'error';
            this.errorMessage = t('story.loadFailed', {
                message: err instanceof Error ? err.message : String(err),
            });
            this.renderContent();
            return;
        }

        this.advance();
    }

    /**
     * 推进到下一条演出。
     * 自动播放时按引擎节奏参数（§4.5）安排下一次推进；连续立绘合并为一组。
     */
    private advance(): void {
        if (!this.player) return;
        this.clearTickTimer();

        let delaySeconds = 0;
        try {
            const result = this.player.advance();
            if (result.result === 'menu') {
                this.menu = this.player.snapshot().menu;
                this.playState = 'menu';
            } else if (result.result === 'finished' || result.result === 'idle') {
                this.playState = 'finished';
            } else if (result.result === 'error') {
                this.playState = 'error';
                this.errorMessage = this.player.snapshot().error?.message ?? '';
            } else {
                this.playState = 'playing';
                const step = result.cue?.raw ?? null;
                // 连续立绘合并：下一条仍是 sprite 时不等待，整组只消耗一次 sprite 时长
                const queued = step?.type === 'sprite' && this.player.peekStepType() === 'sprite';
                delaySeconds = queued ? 0 : stepDelaySeconds(step, DEFAULT_PLAYBACK_TIMING);
            }
        } catch (err) {
            this.playState = 'error';
            this.errorMessage = err instanceof Error ? err.message : String(err);
        }

        this.renderContent();

        if (this.autoPlay && this.playState === 'playing') {
            this.tickTimer = window.setTimeout(() => {
                this.tickTimer = null;
                this.advance();
            }, Math.max(0, delaySeconds) * 1000);
        }
    }

    /** 选择菜单选项后继续 */
    private choose(resultId: string): void {
        if (!this.player) return;
        this.menu = null;
        this.playState = 'playing';
        try {
            this.player.choose(resultId);
        } catch (err) {
            this.playState = 'error';
            this.errorMessage = err instanceof Error ? err.message : String(err);
            this.renderContent();
            return;
        }
        this.advance();
    }

    /** 播放器事件：进入片段清场 / 按 cue 更新舞台 / 运行期错误 */
    private handlePlayEvent(event: PlayEvent): void {
        if (event.type === 'enter') {
            this.resetStage(event.labelName || event.labelId);
        } else if (event.type === 'cue') {
            this.applyCue(event.cue);
        } else if (event.type === 'error') {
            this.playState = 'error';
            this.errorMessage = event.message;
        }
    }

    /** 按规范 §7.1 把一条 cue 应用到累积状态模型 */
    private applyCue(cue: StageCue): void {
        switch (cue.kind) {
            case 'bg':
                this.stage.bg = {
                    path: cue.assetPath ?? '',
                    fadeSeconds: this.bgFadeSeconds(cue),
                };
                break;
            case 'sprite':
                this.applySprite(cue);
                break;
            case 'say':
            case 'inner': {
                const name = cue.speaker || cue.assetName || '';
                this.stage.bubble = {
                    title: cue.kind === 'inner' ? `${name}${t('story.innerSuffix')}` : name,
                    text: cue.kind === 'say' ? `“${cue.text ?? ''}”` : cue.text ?? '',
                    tone: 'actor',
                    speaker: name || null,
                };
                this.bumpSpeaker(name || null);
                break;
            }
            case 'act':
                this.stage.bubble = {
                    title: `${cue.speaker || t('story.narrator')}${t('story.actSuffix')}`,
                    text: cue.text ?? '',
                    tone: 'actor',
                    speaker: cue.speaker || null,
                };
                this.bumpSpeaker(cue.speaker || null);
                break;
            case 'vo':
                this.stage.bubble = {
                    title: t('story.narrator'),
                    text: cue.text ?? '',
                    tone: 'narrator',
                    speaker: null,
                };
                break;
            case 'item':
                this.showItem(cue);
                break;
            default:
                // bgm / sfx / fx / state / task 不改变舞台四层
                break;
        }
    }

    /** 背景淡入秒数：直接用引擎函数，剧本写了 fade_in_Ns 时优先（§4.5） */
    private bgFadeSeconds(cue: StageCue): number {
        return backgroundFadeSeconds(cue.raw ?? null, DEFAULT_PLAYBACK_TIMING);
    }

    /**
     * 立绘上台 / 更新（规范 §7.4.2）：
     * 按 assetId 唯一；未绑定真实图片的不进舞台、不占槽位。
     */
    private applySprite(cue: StageCue): void {
        if (!hasRealSpriteImage(cue.assetPath)) return;

        const assetId = cue.assetId || cue.assetName || cue.assetPath || '';
        const desired = normalizeSlot(cue.position);
        const existing = this.stage.sprites.find((sprite) => sprite.assetId === assetId);

        if (existing) {
            if (cue.assetPath) existing.path = cue.assetPath;
            if (cue.assetName) existing.name = cue.assetName;
            if (cue.pose) existing.pose = cue.pose;
            // 已上台且本次写了位置、且该槽位没被其他角色占 → 移动
            if (desired) {
                const others = this.stage.sprites
                    .filter((sprite) => sprite !== existing)
                    .map((sprite) => sprite.position);
                if (!others.includes(desired)) existing.position = desired;
            }
        } else {
            this.stage.sprites.push({
                assetId,
                name: cue.assetName || assetId,
                path: cue.assetPath ?? '',
                position: pickSlot(desired, this.stage.sprites.map((sprite) => sprite.position)),
                pose: cue.pose,
                talkCount: 0,
            });
        }
    }

    /** 说话反馈：按名字匹配在场立绘，计数 +1 触发一次上跳（规范 §7.4.3） */
    private bumpSpeaker(name: string | null): void {
        if (!name) return;
        const sprite = this.stage.sprites.find((item) => item.name === name);
        if (sprite) sprite.talkCount += 1;
    }

    /** 关键物品：画面中心浮出，按引擎参数计时后自动淡出（规范 §7.6） */
    private showItem(cue: StageCue): void {
        this.clearItemTimer();
        this.itemSeq += 1;
        const seq = this.itemSeq;
        this.stage.item = {
            path: cue.assetPath ?? '',
            name: cue.assetName || cue.assetId || '',
            seq,
        };
        this.itemTimer = window.setTimeout(() => {
            this.itemTimer = null;
            if (this.stage.item && this.stage.item.seq === seq) {
                this.stage.item = null;
                this.renderContent();
            }
        }, DEFAULT_PLAYBACK_TIMING.item * 1000);
    }

    private clearItemTimer(): void {
        if (this.itemTimer !== null) {
            window.clearTimeout(this.itemTimer);
            this.itemTimer = null;
        }
    }

    private clearTickTimer(): void {
        if (this.tickTimer !== null) {
            window.clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }
    }

    /** 空舞台（新片段进入时调用，清空背景 / 立绘 / 气泡 / 物品） */
    private emptyStage(labelName = ''): StoryStageView {
        return {
            labelName,
            bg: null,
            sprites: [],
            bubble: null,
            item: null,
        };
    }

    private resetStage(labelName = ''): void {
        this.clearItemTimer();
        this.stage = this.emptyStage(labelName);
    }

    /** 清空播放状态与订阅 */
    private resetPlayback(): void {
        this.disposePlayer();
        this.resetStage();
        this.menu = null;
        this.playState = 'idle';
        this.errorMessage = '';
    }

    private disposePlayer(): void {
        this.clearTickTimer();
        if (this.offPlayer) {
            try {
                this.offPlayer();
            } catch {
                // 忽略退订异常
            }
            this.offPlayer = null;
        }
        this.player = null;
    }
}

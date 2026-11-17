// 剧本面板：顶部工具栏「剧本」按钮打开，基于 FloatingPanel。
// 左侧垂直菜单（历史 / 官方 / 本地）+ 左下角「配置」；
// 官方页扫描官方剧本目录下的剧本项目，点击「预览」把剧本加入历史并跳转到历史页；
// 历史页左侧历史卡片、右侧预览窗口，底部「播放」通过 story-engine 加载项目并开始播放。
// 预览按规范 §7 绘制舞台：背景 → 立绘 → 物品 → 对话框 → 菜单。
import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import {
    createPlayer,
    type ChoiceMenu,
    type PlayEvent,
    type StageCue,
    type StoryPlayer,
} from '../../libs/story-engine/dist/api.js';
import { FloatingPanel, type FloatingPanelOptions } from '../../ui/basic/floating-panel';
import {
    isStoryDiskAvailable,
    loadStoryProject,
    resolveAssetUrl,
    scanStoryProjects,
    type StoryEntry,
} from './story-catalog';

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

/** 立绘槽位 */
type SpritePosition = 'left' | 'center' | 'right';

/** 在场立绘 */
interface StorySprite {
    /** 归一化后的角色键（assetId / assetName / assetPath），同一角色只保留一个 */
    key: string;
    name: string;
    path: string;
    position: SpritePosition;
}

/** 对话框内容 */
interface StoryBubble {
    title: string;
    text: string;
    /** actor = 角色侧（say / inner / act），narrator = 旁白（vo） */
    tone: 'actor' | 'narrator';
}

/** 舞台画面状态（一份快照，重绘时直接读它） */
interface StoryStageView {
    labelName: string;
    bgPath: string;
    bgFade: boolean;
    sprites: StorySprite[];
    bubble: StoryBubble | null;
    item: { path: string; name: string; seq: number } | null;
    /** 当前施动角色（用于立绘高亮） */
    active: string | null;
    /** 是否正在做动作（立绘浮动） */
    acting: boolean;
}

const SPRITE_SLOTS: SpritePosition[] = ['left', 'center', 'right'];

/** 把作者写的位置归一化成三个槽位之一（兼容左/中/右、l/c/r 等别名） */
function normalizeSpritePosition(raw: string | undefined): SpritePosition | null {
    const value = (raw ?? '').trim().toLowerCase();
    if (!value) return null;
    if (['左', 'l', 'left', 'left_side', 'leftside', 'left-side'].includes(value)) return 'left';
    if (['右', 'r', 'right', 'right_side', 'rightside', 'right-side'].includes(value)) return 'right';
    if (['中', 'c', 'center', 'centre', 'mid', 'middle'].includes(value)) return 'center';
    return null;
}

/** 剧本面板 */
export class StoryPanel extends FloatingPanel {
    /** 当前激活的菜单（配置未激活时生效） */
    private activeMenu: StoryMenuId = 'history';
    /** 左下角「配置」是否激活 */
    private configActive = false;
    /** 官方剧本目录（默认插件目录下的 story 子目录） */
    private readonly officialDir: string;

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

    /** 舞台画面 */
    private stage: StoryStageView = this.emptyStage();
    /** 物品浮出的自动淡出定时器 */
    private itemTimer: number | null = null;
    private itemSeq = 0;

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

    /** 重新打开时重扫目录（剧本文件可能在外部被增删） */
    open(): void {
        const wasOpen = this.isOpen;
        super.open();
        if (!wasOpen) this.renderContent();
    }

    /** 关闭面板时释放播放器订阅与定时器 */
    close(): void {
        this.disposePlayer();
        this.clearItemTimer();
        super.close();
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

    /** 预览窗口：标题 + 舞台 + 底部播放栏 */
    private renderPreview(preview: HTMLElement): void {
        const active = this.history.find((item) => item.dir === this.activeDir) ?? null;
        preview.createDiv({
            cls: 'story-panel-preview-title',
            text: active ? active.name : t('story.previewTitle'),
        });

        const body = preview.createDiv({ cls: 'story-panel-preview-body' });
        if (!active) {
            body.addClass('is-idle');
            body.setText(t('story.previewPlaceholder'));
            return;
        }

        this.renderStage(body, active.dir);
        this.renderFooter(preview);
    }

    /** 舞台：背景 → 立绘 → 物品 → 对话框 → 菜单（对齐规范 §7 的层序） */
    private renderStage(host: HTMLElement, projectDir: string): void {
        const stage = this.stage;

        if (stage.bgPath) {
            const bg = host.createEl('img', {
                cls: 'story-stage-bg',
                attr: { src: resolveAssetUrl(projectDir, stage.bgPath), alt: '' },
            });
            if (stage.bgFade) bg.addClass('is-fade');
        } else if (this.playState !== 'idle') {
            host.createDiv({ cls: 'story-stage-bg-empty', text: t('story.bgUnbound') });
        }

        if (stage.labelName) {
            host.createDiv({ cls: 'story-stage-chip', text: stage.labelName });
        }

        for (const sprite of stage.sprites) {
            const el = host.createDiv({ cls: `story-sprite pos-${sprite.position}` });
            el.toggleClass('is-active', !!stage.active && stage.active === sprite.name);
            el.toggleClass('is-dim', !!stage.active && stage.active !== sprite.name);
            el.toggleClass('is-animating', stage.acting && stage.active === sprite.name);
            el.createEl('img', { attr: { src: resolveAssetUrl(projectDir, sprite.path), alt: sprite.name } });
        }

        if (stage.item) {
            const box = host.createDiv({ cls: 'story-item' });
            box.createEl('img', { attr: { src: resolveAssetUrl(projectDir, stage.item.path), alt: '' } });
            box.createDiv({ cls: 'story-item-name', text: stage.item.name });
        }

        if (this.playState === 'idle') {
            const hint = host.createDiv({ cls: 'story-stage-hint' });
            hint.createDiv({ text: t('story.stageIdle') });
            hint.createDiv({ cls: 'story-stage-hint-path', text: projectDir });
        } else {
            this.renderDialog(host);
        }

        if (this.menu) {
            const menuBox = host.createDiv({ cls: 'story-stage-menu' });
            if (this.menu.title) {
                menuBox.createDiv({ cls: 'story-stage-menu-title', text: this.menu.title });
            }
            for (const option of this.menu.options) {
                const btn = menuBox.createEl('button', {
                    cls: 'story-stage-menu-option',
                    attr: { type: 'button' },
                    text: option.text,
                });
                btn.addEventListener('click', () => this.choose(option.resultId));
            }
        }

        if (this.playState === 'finished') {
            host.createDiv({ cls: 'story-stage-end', text: t('story.endHint') });
        }

        if (this.playState === 'error' && this.errorMessage) {
            host.createDiv({ cls: 'story-stage-error', text: this.errorMessage });
        }
    }

    /** 对话框：actor / narrator 两种色调，同一时刻只显示一个气泡 */
    private renderDialog(host: HTMLElement): void {
        if (!this.stage.bubble) return;
        const layer = host.createDiv({ cls: 'story-dialog-layer' });
        const box = layer.createDiv({ cls: `story-dialog-box tone-${this.stage.bubble.tone}` });
        box.createDiv({ cls: 'story-dialog-speaker', text: this.stage.bubble.title });
        box.createDiv({ cls: 'story-dialog-text', text: this.stage.bubble.text });
    }

    /** 预览窗口底部：播放状态 + 播放 / 下一步 / 重播按钮 */
    private renderFooter(preview: HTMLElement): void {
        const footer = preview.createDiv({ cls: 'story-panel-preview-footer' });
        footer.createSpan({ cls: 'story-panel-preview-status', text: this.statusText() });

        const actions = footer.createDiv({ cls: 'story-panel-preview-actions' });
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

        if (this.playState === 'playing') {
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

    /** 官方 / 本地页：官方页扫描官方剧本目录，本地页暂为占位 */
    private renderList(content: HTMLElement, menu: Exclude<StoryMenuId, 'history'>): void {
        const list = content.createDiv({ cls: 'story-panel-list' });
        if (menu === 'local') {
            list.createDiv({ cls: 'story-panel-empty', text: t('story.localPlaceholder') });
            return;
        }

        if (!isStoryDiskAvailable()) {
            list.createDiv({ cls: 'story-panel-empty', text: t('story.scanUnsupported') });
            return;
        }

        let entries: StoryEntry[] = [];
        try {
            entries = scanStoryProjects(this.officialDir);
        } catch (err) {
            console.error('扫描官方剧本目录失败', err);
        }

        if (entries.length === 0) {
            list.createDiv({ cls: 'story-panel-empty', text: t('story.officialEmpty') });
            list.createDiv({ cls: 'story-panel-empty-path', text: this.officialDir });
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

    /** 推进到下一条演出 */
    private advance(): void {
        if (!this.player) return;
        try {
            const step = this.player.next();
            if (step === 'menu') {
                this.menu = this.player.snapshot().menu;
                this.playState = 'menu';
            } else if (step === 'finished' || step === 'idle') {
                this.playState = 'finished';
            } else if (step === 'error') {
                this.playState = 'error';
                this.errorMessage = this.player.snapshot().error?.message ?? '';
            }
        } catch (err) {
            this.playState = 'error';
            this.errorMessage = err instanceof Error ? err.message : String(err);
        }
        this.renderContent();
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

    /** 按规范 §7.6 把一条 cue 应用到画面 */
    private applyCue(cue: StageCue): void {
        switch (cue.kind) {
            case 'bg':
                this.stage.bgPath = cue.assetPath ?? '';
                this.stage.bgFade = !!cue.transition && cue.transition.indexOf('fade') === 0;
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
                };
                this.stage.active = name || null;
                this.stage.acting = false;
                break;
            }
            case 'act':
                this.stage.bubble = {
                    title: `${cue.speaker || t('story.narrator')}${t('story.actSuffix')}`,
                    text: cue.text ?? '',
                    tone: 'actor',
                };
                this.stage.active = cue.speaker || null;
                this.stage.acting = true;
                break;
            case 'vo':
                this.stage.bubble = { title: t('story.narrator'), text: cue.text ?? '', tone: 'narrator' };
                this.stage.active = null;
                this.stage.acting = false;
                break;
            case 'item':
                this.showItem(cue);
                break;
            default:
                // bgm / sfx / fx / state / task 不改变三层画面
                break;
        }
    }

    /** 立绘上台 / 更新：同一角色只保留一个，缺省位置按 left → center → right 让位 */
    private applySprite(cue: StageCue): void {
        const key = cue.assetId || cue.assetName || cue.assetPath || `sprite-${this.stage.sprites.length}`;
        const desired = normalizeSpritePosition(cue.position);
        const existing = this.stage.sprites.find((sprite) => sprite.key === key);

        if (existing) {
            if (cue.assetPath) existing.path = cue.assetPath;
            if (cue.assetName) existing.name = cue.assetName;
            if (desired && !this.stage.sprites.some((sprite) => sprite !== existing && sprite.position === desired)) {
                existing.position = desired;
            }
        } else {
            this.stage.sprites.push({
                key,
                name: cue.assetName || key,
                path: cue.assetPath ?? '',
                position: this.firstFreeSlot(desired),
            });
        }

        this.stage.active = cue.assetName || existing?.name || null;
        this.stage.acting = false;
    }

    /** 找第一个空槽位；作者指定且空着就用指定值，全满时回落到期望值 */
    private firstFreeSlot(desired: SpritePosition | null): SpritePosition {
        const used = (slot: SpritePosition): boolean =>
            this.stage.sprites.some((sprite) => sprite.position === slot);
        if (desired && !used(desired)) return desired;
        for (const slot of SPRITE_SLOTS) {
            if (!used(slot)) return slot;
        }
        return desired ?? 'center';
    }

    /** 关键物品：画面中心浮出，2.8s 后自动淡出 */
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
        }, 2800);
    }

    private clearItemTimer(): void {
        if (this.itemTimer !== null) {
            window.clearTimeout(this.itemTimer);
            this.itemTimer = null;
        }
    }

    /** 空舞台（新片段进入时调用，清空背景 / 立绘 / 气泡 / 物品） */
    private emptyStage(labelName = ''): StoryStageView {
        return {
            labelName,
            bgPath: '',
            bgFade: false,
            sprites: [],
            bubble: null,
            item: null,
            active: null,
            acting: false,
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

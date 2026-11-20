// 任务板块宿主：任务详情面板与任务板块面板共用。
// 渲染规则：
//  1. 选项卡栏只展示内容板块（按「配置」里的显示设置过滤），右上角齿轮按钮打开配置页；
//  2. 「开启」始终显示该类型选项卡，「自动」仅在板块存在内容时显示，「关闭」始终隐藏（数据保留）；
//  3. 没有可显示的板块时，配置页作为兜底视图；
//  4. 内容读写统一走 shared/task-sections 访问器，首次写入内容时自动创建板块。
import { Notice, TFolder, setIcon, type App, type TFile } from 'obsidian';

import type { ChecklistItem } from '../../core/datatypes/domain';
import type { PrototypeTask, TaskDayGoalEntry, TaskGoalConfig, TaskHabit, TaskKind } from '../../core/datatypes/prototype-task';
import type { SectionDisplayMode, SectionType } from '../../core/datatypes/task-section';
import { getLang, t } from '../../core/i18n';
import { SECTION_REGISTRY } from '../../core/shared/section-registry';
import { getTaskKind } from '../../core/shared/task-kind';
import {
    getCurrentDayKey,
    getCurrentWeekKey,
    makeDayKeyFromWeek,
    parseWeekKey,
    shiftWeekKey,
} from '../../core/shared/plan-data';
import { buildTaskFileName, listTaskFiles, relativeToDir, type TaskFileSortMode } from '../../core/shared/task-file';
import {
    appendChecklist,
    getChecklist,
    getDayGoalEntries,
    getSection,
    getSectionDisplay,
    getTaskFileDir,
    getTaskFileTimestamp,
    getTaskGoalConfig,
    getTaskGoals,
    getTaskHabit,
    hasSection,
    setChecklist,
    setDayGoalEntries,
    setSectionDisplay,
    setTaskFileTimestamp,
    setTaskGoalConfig,
    setTaskGoals,
    setTaskHabit,
    setWeekNote,
    getWeekNote,
} from '../../core/shared/task-sections';
import { ensureTaskFileDir, revealFolderInExplorer } from '../../core/shared/task-library';
import { FileEditorPanel } from '../../ui/basic/file-editor-panel';
import { FloatingPanel } from '../../ui/basic/floating-panel';
import { HabitEditor } from '../../ui/basic/habit-editor';
import { GoalEditor } from '../../ui/basic/goal-editor';

/** 标签 key */
type LabelKey = Parameters<typeof t>[0];

/** 周一到周日的 i18n key（每日描述按周几排序与选择使用） */
const WEEKDAY_LABEL_KEYS: LabelKey[] = [
    'week.monday',
    'week.tuesday',
    'week.wednesday',
    'week.thursday',
    'week.friday',
    'week.saturday',
    'week.sunday',
];

/** 任务类型三选一的选项（任务类型不显示图标） */
const KIND_OPTIONS: { value: TaskKind; icon?: string; labelKey: LabelKey }[] = [
    { value: 'task', labelKey: 'panel.taskKindTask' },
    { value: 'habit', icon: 'repeat', labelKey: 'panel.taskKindHabit' },
    { value: 'goal', icon: 'target', labelKey: 'panel.taskKindGoal' },
];

/** 板块宿主配置 */
/** 不在选项卡中展示的板块类型：目标 / 习惯已通过任务类型入口展示；阶段目标为旧版周目标体系，仅保留数据不再展示 */
const HIDDEN_SECTION_TYPES: SectionType[] = ['goals', 'habit'];

/** 配置页允许调整显示设置的板块类型；其余类型固定按「自动」（有内容才显示）处理 */
const CONFIGURABLE_SECTION_TYPES: SectionType[] = ['checklist', 'description', 'files'];

export interface SectionHostOptions {
    /** Obsidian App */
    app: App;
    /** 当前任务（每次渲染时调用，返回仓库中的最新对象） */
    getTask: () => PrototypeTask | undefined;
    /** 全量任务（任务文件目录按任务树绑定） */
    getTasks?: () => PrototypeTask[];
    /** 项目库根目录（空表示未配置） */
    getTaskLibraryRoot?: () => string;
    /** 持久化出口 */
    save: () => Promise<void>;
    /** 浮层容器（文件编辑面板 / 文件模板面板使用） */
    container?: HTMLElement;
    /** 把子面板元素注册为父面板的忽略区域，避免父面板因失焦关闭 */
    registerIgnoreElement?: (el: HTMLElement) => void;
    /** 板块变化后的回调（用于刷新面板中的数量等） */
    onChanged?: () => void;
    /** 只展示这些板块类型（默认全部） */
    types?: SectionType[];
    /** 是否在选项卡栏最左侧固定显示「任务类型」选项卡（任务详情面板使用） */
    showKindTab?: boolean;
}

/** 任务板块宿主 */
export class SectionHost {
    private readonly options: SectionHostOptions;
    /** 渲染容器（重绘时复用） */
    private hostEl: HTMLElement | null = null;
    /** 当前选中的内容板块选项卡 */
    private activeType: SectionType | null = null;
    /** 是否正在显示「任务类型」选项卡 */
    private activeKind = false;
    /** 是否正在显示配置页（齿轮按钮） */
    private showConfig = false;
    /** 日目标板块当前查看的周键 */
    private weekKey = getCurrentWeekKey();
    /** 清单排序方式 */
    private checklistSort: 'created' | 'due' = 'created';
    /** 清单中选中的条目 id（用于设置截止时间） */
    private selectedChecklistId: string | null = null;
    /** 任务文件是否处于新建输入状态 */
    private fileCreateMode = false;
    /** 任务文件排序方式（面板内保持，切换任务不重置） */
    private fileSortMode: TaskFileSortMode = 'mtime-desc';
    /** 文件编辑面板 */
    private fileEditorPanel: FileEditorPanel | null = null;
    /** 文件模板面板 */
    private fileTemplatePanel: FloatingPanel | null = null;

    constructor(options: SectionHostOptions) {
        this.options = options;
    }

    /** 切换任务时重置临时状态（首次渲染落在第一个可见板块） */
    reset(): void {
        this.activeType = null;
        this.activeKind = false;
        this.showConfig = false;
        this.weekKey = getCurrentWeekKey();
        this.checklistSort = 'created';
        this.selectedChecklistId = null;
        this.fileCreateMode = false;
        this.fileTemplatePanel?.close();
    }

    /** 销毁（关闭文件编辑 / 文件模板面板） */
    destroy(): void {
        this.fileEditorPanel?.destroy();
        this.fileEditorPanel = null;
        this.fileTemplatePanel?.destroy();
        this.fileTemplatePanel = null;
    }

    /** 渲染宿主；传入 container 时以其为新容器，否则复用上次容器 */
    render(container?: HTMLElement): void {
        if (container) this.hostEl = container;
        const host = this.hostEl;
        if (!host) return;
        host.empty();
        host.addClass('task-section-host');

        const task = this.options.getTask();
        if (!task) return;

        const types = this.visibleTypes(task);
        // 当前选项卡因显示设置或内容变化被隐藏时回到默认视图
        if (this.activeType && !types.includes(this.activeType)) this.activeType = null;
        // 任务类型选项卡固定存在时，默认落在该选项卡
        if (!this.showConfig && !this.activeType && !this.activeKind) {
            if (this.options.showKindTab) this.activeKind = true;
            else this.activeType = types[0] ?? null;
        }
        // 没有可显示的板块时，配置页作为兜底视图
        if (!this.activeType && !this.activeKind) this.showConfig = true;

        this.renderTabs(host, task, types);
        const body = host.createDiv({ cls: 'task-section-tab-body' });
        if (this.showConfig || (!this.activeType && !this.activeKind)) this.renderConfig(body, task);
        else if (this.activeKind) this.renderKind(body, task);
        else this.renderBody(body, task, this.activeType);
    }

    /** 本面板展示的板块类型（目标 / 习惯不作为板块选项卡展示） */
    private availableTypes(): SectionType[] {
        const all = (Object.keys(SECTION_REGISTRY) as SectionType[])
            .filter((type) => !HIDDEN_SECTION_TYPES.includes(type));
        const allowed = this.options.types;
        return allowed ? all.filter((type) => allowed.includes(type)) : all;
    }

    /** 可见的板块类型：先按 task.sections 顺序，再补未创建但设为「开启」的类型 */
    private visibleTypes(task: PrototypeTask): SectionType[] {
        const available = this.availableTypes();
        const ordered = [...(task.sections ?? []).map((section) => section.type), ...available];
        const seen = new Set<SectionType>();
        const types: SectionType[] = [];
        for (const type of ordered) {
            if (!available.includes(type) || seen.has(type)) continue;
            seen.add(type);
            if (this.isVisible(task, type)) types.push(type);
        }
        return types;
    }

    /** 是否显示该类型选项卡：开启始终显示，自动仅在存在内容时显示；不可配置的类型固定按自动处理 */
    private isVisible(task: PrototypeTask, type: SectionType): boolean {
        const mode = CONFIGURABLE_SECTION_TYPES.includes(type) ? getSectionDisplay(task, type) : 'auto';
        if (mode === 'on') return true;
        if (mode === 'off') return false;
        const section = getSection(task, type);
        return !!section && !SECTION_REGISTRY[type].isEmpty(section.payload);
    }

    /* ---------------- 选项卡 ---------------- */

    /** 选项卡栏：内容板块（单行横向滚动）+ 右侧齿轮按钮打开配置页 */
    private renderTabs(parent: HTMLElement, task: PrototypeTask, types: SectionType[]): void {
        const bar = parent.createDiv({ cls: 'task-section-tabs-bar' });
        const tabs = bar.createDiv({ cls: 'task-section-tabs' });
        // 任务类型选项卡：固定在第一位，不参与板块显示设置
        if (this.options.showKindTab) {
            const kindTab = tabs.createEl('button', { cls: 'task-section-tab', attr: { type: 'button' } });
            kindTab.toggleClass('is-active', !this.showConfig && this.activeKind);
            setIcon(kindTab.createSpan({ cls: 'task-section-tab-icon' }), 'shapes');
            kindTab.createSpan({ cls: 'task-section-tab-label', text: t('panel.sectionKindTab') });
            kindTab.addEventListener('click', () => this.activateKindTab());
        }
        for (const type of types) {
            const def = SECTION_REGISTRY[type];
            const tab = tabs.createEl('button', { cls: 'task-section-tab', attr: { type: 'button' } });
            tab.toggleClass('is-active', !this.showConfig && this.activeType === type);
            setIcon(tab.createSpan({ cls: 'task-section-tab-icon' }), def.icon);
            tab.createSpan({ cls: 'task-section-tab-label', text: t(def.labelKey as LabelKey) });
            const count = this.sectionCountText(task, type);
            if (count) tab.createSpan({ cls: 'task-section-tab-count', text: count });
            tab.addEventListener('click', () => this.activateTab(type));
        }

        // 齿轮：打开 / 关闭配置页
        const configBtn = bar.createEl('button', {
            cls: 'task-section-tabs-config',
            attr: { type: 'button', 'aria-label': t('panel.sectionConfig') },
        });
        configBtn.title = t('panel.sectionConfig');
        configBtn.toggleClass('is-active', this.showConfig);
        setIcon(configBtn, 'settings-2');
        configBtn.addEventListener('click', () => this.activateConfig());
    }

    /** 切换内容板块选项卡 */
    private activateTab(type: SectionType): void {
        if (!this.showConfig && this.activeType === type) return;
        this.showConfig = false;
        this.activeKind = false;
        this.activeType = type;
        this.render();
    }

    /** 切换到「任务类型」选项卡 */
    private activateKindTab(): void {
        if (!this.showConfig && this.activeKind) return;
        this.showConfig = false;
        this.activeType = null;
        this.activeKind = true;
        this.render();
    }

    /** 任务类型选项卡内容：第一行设置任务类型（任务 / 习惯 / 目标 三选一） */
    private renderKind(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-section-kind' });
        const row = wrap.createDiv({ cls: 'task-section-kind-row' });
        row.createSpan({ cls: 'task-section-kind-label', text: t('panel.sectionKindLabel') });
        const group = row.createDiv({ cls: 'task-section-kind-options' });
        const current = getTaskKind(task);
        for (const option of KIND_OPTIONS) {
            const btn = group.createEl('button', {
                cls: 'task-section-kind-btn',
                attr: { type: 'button' },
            });
            btn.toggleClass('is-active', current === option.value);
            if (option.icon) setIcon(btn.createSpan({ cls: 'task-section-kind-btn-icon' }), option.icon);
            btn.createSpan({ cls: 'task-section-kind-btn-label', text: t(option.labelKey) });
            btn.addEventListener('click', () => {
                if (getTaskKind(task) === option.value) return;
                task.kind = option.value;
                // 首次切换为目标类型时默认不启用目标，勾选后才参与目标面板
                if (option.value === 'goal' && !hasSection(task, 'goals')) {
                    setTaskGoalConfig(task, { enabled: false });
                }
                void this.options.save();
                this.options.onChanged?.();
                this.render();
            });
        }
        // 习惯类型：下方内嵌习惯设置（与「习惯」面板共用同一份数据）
        if (current === 'habit') this.renderHabitKindSettings(wrap, task);
        // 目标类型：下方勾选启用目标 + 截止周数 / 截止日期
        else if (current === 'goal') this.renderGoalKindSettings(wrap, task);
        // 任务类型：下方填写预估总时长
        else this.renderTaskKindSettings(wrap, task);
    }

    /** 任务设置：预估总时长（分钟，留空表示不预估） */
    private renderTaskKindSettings(parentEl: HTMLElement, task: PrototypeTask): void {
        const card = parentEl.createDiv({ cls: 'kind-settings' });
        const body = card.createDiv({ cls: 'kind-settings-body' });
        const row = body.createDiv({ cls: 'kind-settings-row' });
        row.createSpan({ cls: 'kind-settings-label', text: t('panel.taskEstimate') });
        const control = row.createDiv({ cls: 'kind-settings-control' });
        const numberWrap = control.createDiv({ cls: 'kind-settings-number' });
        const input = numberWrap.createEl('input', {
            cls: 'kind-settings-input kind-settings-number-input',
            attr: { type: 'number', min: '0', 'aria-label': t('panel.taskEstimate') },
        });
        input.placeholder = '—';
        input.value = task.estimatedMinutes === undefined ? '' : String(task.estimatedMinutes);
        numberWrap.createSpan({ cls: 'kind-settings-unit', text: t('panel.habitDurationUnit') });

        const commit = (): void => {
            const raw = input.value.trim();
            const value = Number(raw);
            if (!raw || !Number.isFinite(value) || value <= 0) {
                input.value = '';
                delete task.estimatedMinutes;
            } else {
                task.estimatedMinutes = Math.round(value);
            }
            void this.options.save();
            this.options.onChanged?.();
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (evt) => {
            if (evt.key !== 'Enter') return;
            evt.preventDefault();
            input.blur();
        });
    }

    /** 习惯设置：启用 / 全天或时间点 + 预估时长 / 生效星期（不受启用状态限制，始终可编辑） */
    private renderHabitKindSettings(parentEl: HTMLElement, task: PrototypeTask): void {
        new HabitEditor(parentEl, {
            getHabit: () => this.readHabit(task),
            onChange: (patch) => this.saveHabit(task, patch),
            showAllDay: true,
            showDuration: true,
        });
    }

    /** 读取习惯设置（未创建时返回默认值：未启用、09:00、周一到周日全选） */
    private readHabit(task: PrototypeTask): TaskHabit {
        return getTaskHabit(task) ?? {
            enabled: false,
            time: '09:00',
            weekdays: [1, 2, 3, 4, 5, 6, 7],
        };
    }

    /** 保存习惯设置（编辑器自行同步界面，不重绘以避免打断选择与失焦） */
    private saveHabit(task: PrototypeTask, patch: Partial<TaskHabit>): void {
        setTaskHabit(task, { ...this.readHabit(task), ...patch });
        void this.options.save();
        this.options.onChanged?.();
    }

    /** 目标设置：启用目标 + 截止周数（年份 / 周数）或截止日期 */
    private renderGoalKindSettings(parentEl: HTMLElement, task: PrototypeTask): void {
        new GoalEditor(parentEl, {
            getConfig: () => getTaskGoalConfig(task),
            onChange: (patch) => this.saveGoalConfig(task, patch),
        });
    }

    /** 保存目标配置（不重绘，避免输入过程中失焦被重建） */
    private saveGoalConfig(task: PrototypeTask, patch: Partial<TaskGoalConfig>): void {
        setTaskGoalConfig(task, patch);
        void this.options.save();
        this.options.onChanged?.();
    }

    /** 打开配置页 */
    private activateConfig(): void {
        if (this.showConfig) return;
        this.showConfig = true;
        this.render();
    }

    /* ---------------- 配置（显示设置） ---------------- */

    /** 配置页：仅清单 / 描述 / 任务文件可设置「自动 / 开启 / 关闭」，其余类型固定按自动展示 */
    private renderConfig(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-section-config' });
        wrap.createDiv({ cls: 'task-section-config-hint', text: t('panel.sectionConfigHint') });

        const modes: { value: SectionDisplayMode; labelKey: LabelKey }[] = [
            { value: 'auto', labelKey: 'panel.sectionDisplayAuto' },
            { value: 'on', labelKey: 'panel.sectionDisplayOn' },
            { value: 'off', labelKey: 'panel.sectionDisplayOff' },
        ];
        const configurable = this.availableTypes().filter((type) => CONFIGURABLE_SECTION_TYPES.includes(type));
        for (const type of configurable) {
            const def = SECTION_REGISTRY[type];
            const row = wrap.createDiv({ cls: 'task-section-config-row' });
            setIcon(row.createSpan({ cls: 'task-section-config-icon' }), def.icon);
            row.createSpan({ cls: 'task-section-config-label', text: t(def.labelKey as LabelKey) });

            const segment = row.createDiv({ cls: 'task-section-config-segment' });
            const current = getSectionDisplay(task, type);
            for (const mode of modes) {
                const btn = segment.createEl('button', {
                    cls: 'task-section-config-segment-btn',
                    text: t(mode.labelKey),
                    attr: { type: 'button' },
                });
                btn.toggleClass('is-active', current === mode.value);
                btn.addEventListener('click', () => {
                    if (getSectionDisplay(task, type) === mode.value) return;
                    setSectionDisplay(task, type, mode.value);
                    void this.commit(task);
                });
            }
        }
    }

    /** 板块标题后的数量（清单为未完成数，任务文件为文件数） */
    private sectionCountText(task: PrototypeTask, type: SectionType): string {
        if (!hasSection(task, type)) return '';
        if (type === 'checklist') {
            return `(${getChecklist(task).filter((item) => !item.done).length})`;
        }
        if (type === 'files') {
            return `(${listTaskFiles(this.options.app, getTaskFileDir(task)).length})`;
        }
        return '';
    }

    /** 按类型渲染板块内容 */
    private renderBody(body: HTMLElement, task: PrototypeTask, type: SectionType): void {
        switch (type) {
            case 'checklist':
                this.renderChecklist(body, task);
                return;
            case 'description':
                this.renderDescription(body, task);
                return;
            case 'goals':
                this.renderGoals(body, task);
                return;
            case 'files':
                this.renderFiles(body, task);
                return;
            case 'habit':
                this.renderHabit(body, task);
        }
    }

    /** 保存并重绘（首次写入非空内容时访问器已创建板块，这里落库） */
    private async commit(task: PrototypeTask): Promise<void> {
        await this.options.save();
        this.options.onChanged?.();
        this.render();
    }

    /* ---------------- 清单 ---------------- */

    private renderChecklist(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-section-checklist' });

        // 工具行：排序方式 / 设置截止时间（需先选中条目）
        const toolbar = wrap.createDiv({ cls: 'task-section-toolbar' });
        const sortBtn = toolbar.createEl('button', {
            cls: 'task-section-tool-btn',
            text: this.checklistSort === 'due' ? t('panel.checklistSortDue') : t('panel.checklistSortCreated'),
            attr: { type: 'button' },
        });
        sortBtn.addEventListener('click', () => {
            this.checklistSort = this.checklistSort === 'due' ? 'created' : 'due';
            this.render();
        });
        const dueBtn = toolbar.createEl('button', {
            cls: 'task-section-tool-btn',
            text: t('panel.checklistSetDue'),
            attr: { type: 'button' },
        });
        dueBtn.disabled = !this.selectedChecklistId;
        dueBtn.addEventListener('click', () => this.openDueEditor(wrap, task));

        // 输入行
        const inputRow = wrap.createDiv({ cls: 'task-section-input-row' });
        const input = inputRow.createEl('input', {
            cls: 'task-section-input',
            attr: { type: 'text', placeholder: t('panel.checklistAddPlaceholder') },
        });
        const addBtn = inputRow.createEl('button', {
            cls: 'task-section-add-btn',
            text: t('common.add'),
            attr: { type: 'button' },
        });
        const submit = (): void => {
            const text = input.value.trim();
            if (!text) return;
            const entry: ChecklistItem = {
                id: `checklist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text,
                createdAt: Date.now(),
            };
            appendChecklist(task, entry);
            input.value = '';
            void this.commit(task);
        };
        addBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                submit();
            }
        });

        const entries = getChecklist(task);
        if (entries.length === 0) {
            wrap.createDiv({ cls: 'task-section-empty', text: t('panel.checklistEmpty') });
            return;
        }

        // 未完成在前、已完成沉底；未完成可按截止时间排序（无截止时间排最后）
        const pending = entries.filter((entry) => !entry.done);
        if (this.checklistSort === 'due') {
            pending.sort((a, b) => {
                const aDue = a.dueDate ? new Date(`${a.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
                const bDue = b.dueDate ? new Date(`${b.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
                if (aDue !== bDue) return aDue - bDue;
                return a.createdAt - b.createdAt;
            });
        }

        const list = wrap.createDiv({ cls: 'task-section-list' });
        for (const entry of [...pending, ...entries.filter((item) => item.done)]) {
            const row = list.createDiv({ cls: 'task-section-item' });
            row.toggleClass('is-done', entry.done === true);
            row.toggleClass('is-selected', this.selectedChecklistId === entry.id);
            row.addEventListener('click', () => {
                this.selectedChecklistId = this.selectedChecklistId === entry.id ? null : entry.id;
                this.render();
            });

            const checkbox = row.createEl('input', { cls: 'task-section-check', attr: { type: 'checkbox' } });
            checkbox.checked = entry.done === true;
            checkbox.addEventListener('click', (evt) => evt.stopPropagation());
            checkbox.addEventListener('change', () => {
                entry.done = checkbox.checked;
                if (checkbox.checked) entry.completedAt = Date.now();
                else delete entry.completedAt;
                void this.commit(task);
            });

            const main = row.createDiv({ cls: 'task-section-item-main' });
            main.createSpan({ cls: 'task-section-item-text', text: entry.text });
            const meta = main.createDiv({ cls: 'task-section-item-meta' });
            meta.createSpan({ text: t(entry.done ? 'panel.checklistDone' : 'panel.checklistPending') });
            if (entry.done && entry.completedAt) {
                meta.createSpan({ text: t('panel.checklistCompletedAt', { time: formatCompletedTime(entry.completedAt) }) });
            }
            if (entry.dueDate) this.appendDueTags(meta, entry.dueDate);

            const delBtn = row.createEl('button', {
                cls: 'task-section-item-delete',
                text: '×',
                attr: { type: 'button', 'aria-label': t('common.delete') },
            });
            delBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                setChecklist(task, getChecklist(task).filter((item) => item.id !== entry.id));
                if (this.selectedChecklistId === entry.id) this.selectedChecklistId = null;
                void this.commit(task);
            });
        }
    }

    /** 在状态后追加截止日期 / 剩余天数 / 已过期标签 */
    private appendDueTags(meta: HTMLElement, dueDate: string): void {
        const due = new Date(`${dueDate}T00:00:00`);
        if (Number.isNaN(due.getTime())) return;
        const label = getLang() === 'zh'
            ? `${due.getMonth() + 1}月${due.getDate()}日`
            : `${due.getMonth() + 1}/${due.getDate()}`;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.round((due.getTime() - today.getTime()) / 86400000);
        if (days < 0) {
            meta.createSpan({ cls: 'is-overdue', text: t('panel.checklistOverdue') });
        } else {
            meta.createSpan({
                text: days === 0 ? t('panel.checklistDueToday') : t('panel.checklistDueInDays', { days }),
            });
        }
        meta.createSpan({ text: t('panel.checklistDueDateTag', { date: label }) });
    }

    /** 选中条目的截止日期编辑行：日期输入框 + 确定 / 清除 / 取消 */
    private openDueEditor(wrap: HTMLElement, task: PrototypeTask): void {
        const entry = getChecklist(task).find((item) => item.id === this.selectedChecklistId);
        if (!entry) return;
        wrap.querySelector('.task-section-due-row')?.remove();
        const editor = wrap.createDiv({ cls: 'task-section-due-row' });
        const input = editor.createEl('input', { cls: 'task-section-due-input', attr: { type: 'date' } });
        input.value = entry.dueDate ?? '';
        const saveEntry = (): void => {
            if (input.value) entry.dueDate = input.value;
            else delete entry.dueDate;
            void this.commit(task);
        };
        editor.createEl('button', {
            cls: 'task-section-tool-btn',
            text: t('panel.checklistDueSave'),
            attr: { type: 'button' },
        }).addEventListener('click', saveEntry);
        editor.createEl('button', {
            cls: 'task-section-tool-btn',
            text: t('panel.checklistDueClear'),
            attr: { type: 'button' },
        }).addEventListener('click', () => {
            input.value = '';
            saveEntry();
        });
        editor.createEl('button', {
            cls: 'task-section-tool-btn',
            text: t('panel.checklistDueCancel'),
            attr: { type: 'button' },
        }).addEventListener('click', () => editor.remove());
        wrap.insertBefore(editor, wrap.querySelector('.task-section-input-row'));
        input.focus();
    }

    /* ---------------- 描述（本周描述 + 日描述） ---------------- */

    /**
     * 「描述」：顶部统一周切换；下一行为本周描述；再往下是当前周存在的日描述。
     * 周切换同时作用于本周描述与日描述。
     */
    private renderDescription(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-week-goal' });

        // 第一行：周切换按钮（上一周 / 周数 + 日期范围 / 下一周），右上角为新增按钮
        const nav = wrap.createDiv({ cls: 'task-week-goal-nav' });
        const prevBtn = nav.createEl('button', {
            cls: 'task-week-goal-nav-btn',
            attr: { type: 'button', 'aria-label': t('panel.weekGoalPrevWeek') },
        });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.render();
        });

        const { week } = parseWeekKey(this.weekKey);
        const label = nav.createDiv({ cls: 'task-week-goal-nav-label' });
        label.createSpan({ cls: 'task-week-goal-nav-week', text: `W${String(week).padStart(2, '0')}` });
        const mondayKey = makeDayKeyFromWeek(this.weekKey, 1);
        const sundayKey = makeDayKeyFromWeek(this.weekKey, 7);
        label.createSpan({
            cls: 'task-week-goal-nav-range',
            text: `${Number(mondayKey.slice(5, 7))}/${Number(mondayKey.slice(8, 10))} - ${Number(sundayKey.slice(5, 7))}/${Number(sundayKey.slice(8, 10))}`,
        });
        if (this.weekKey === getCurrentWeekKey()) label.addClass('is-current');

        const nextBtn = nav.createEl('button', {
            cls: 'task-week-goal-nav-btn',
            attr: { type: 'button', 'aria-label': t('panel.weekGoalNextWeek') },
        });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.render();
        });

        // 右上角：新增一条日描述（选择周几 + 填写内容）
        const addBtn = nav.createEl('button', {
            cls: 'task-week-goal-nav-add',
            attr: { type: 'button', 'aria-label': t('common.add') },
        });
        setIcon(addBtn, 'plus');
        addBtn.addEventListener('click', () => this.startAddDayGoal(wrap, task));

        // 第二行：本周描述（随当前周切换）
        const noteWrap = wrap.createDiv({ cls: 'task-section-weeknote task-week-goal-note' });
        const textarea = noteWrap.createEl('textarea', {
            cls: 'task-section-weeknote-textarea',
            attr: { placeholder: t('panel.planWeekDescriptionPlaceholder') },
        });
        textarea.value = getWeekNote(task, this.weekKey);
        textarea.addEventListener('change', () => {
            const next = textarea.value.trim();
            if (next === getWeekNote(task, this.weekKey)) return;
            setWeekNote(task, this.weekKey, textarea.value);
            void this.commit(task);
        });

        // 第三行：日描述（仅渲染当前周有内容的日期，按周一到周日排序）
        const list = wrap.createDiv({ cls: 'task-week-goal-list' });
        let count = 0;
        for (let day = 1; day <= 7; day += 1) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, day);
            for (const entry of getDayGoalEntries(task, dayKey)) {
                this.renderDayGoalRow(list, task, dayKey, t(WEEKDAY_LABEL_KEYS[day - 1]), entry);
                count += 1;
            }
        }
        if (count === 0) list.createDiv({ cls: 'task-week-goal-day-empty', text: t('panel.weekGoalEmpty') });
    }

    /** 单条每日描述：星期标签 + 完成勾选 + 内容（点击编辑）+ 悬停删除 */
    private renderDayGoalRow(
        parentEl: HTMLElement,
        task: PrototypeTask,
        dayKey: string,
        weekdayLabel: string,
        entry: TaskDayGoalEntry,
    ): void {
        const row = parentEl.createDiv({ cls: 'task-week-goal-item' });
        row.toggleClass('is-done', entry.done === true);
        row.toggleClass('is-today', dayKey === getCurrentDayKey());
        row.createSpan({ cls: 'task-week-goal-item-day', text: weekdayLabel });
        const checkbox = row.createEl('input', { cls: 'task-week-goal-item-check', attr: { type: 'checkbox' } });
        checkbox.checked = entry.done === true;
        checkbox.addEventListener('change', () => {
            entry.done = checkbox.checked;
            if (!checkbox.checked) delete entry.done;
            void this.commit(task);
        });
        const textEl = row.createSpan({ cls: 'task-week-goal-item-text', text: entry.text });
        textEl.addEventListener('click', () => this.startEditDayGoal(textEl, task, dayKey, entry));
        const delBtn = row.createEl('button', {
            cls: 'task-week-goal-item-delete',
            attr: { type: 'button', 'aria-label': t('common.delete') },
        });
        setIcon(delBtn, 'x');
        delBtn.addEventListener('click', () => {
            setDayGoalEntries(task, dayKey, getDayGoalEntries(task, dayKey).filter((item) => item.id !== entry.id));
            void this.commit(task);
        });
    }

    /** 点击条目内容切换为内联输入框：回车 / 失焦保存，Esc 放弃修改 */
    private startEditDayGoal(
        textEl: HTMLElement,
        task: PrototypeTask,
        dayKey: string,
        entry: TaskDayGoalEntry,
    ): void {
        if (textEl.parentElement?.querySelector('.task-week-goal-item-input')) return;
        const input = textEl.parentElement.createEl('input', {
            cls: 'task-week-goal-item-input',
            type: 'text',
            value: entry.text,
        });
        textEl.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            const next = input.value.trim();
            if (!commit || !next || next === entry.text) {
                this.render();
                return;
            }
            setDayGoalEntries(
                task,
                dayKey,
                getDayGoalEntries(task, dayKey).map((item) =>
                    item.id === entry.id ? { ...item, text: next } : item,
                ),
            );
            void this.commit(task);
        };
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                finish(true);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', () => finish(true));
    }

    /** 在列表末尾插入新增行：选择周几 + 填写内容，回车 / 确认保存，Esc 取消 */
    private startAddDayGoal(wrap: HTMLElement, task: PrototypeTask): void {
        const existing = wrap.querySelector<HTMLInputElement>('.task-week-goal-add-input');
        if (existing) {
            existing.focus();
            return;
        }
        const list = wrap.querySelector<HTMLElement>('.task-week-goal-list');
        if (!list) return;
        list.querySelector('.task-week-goal-day-empty')?.remove();

        const inputRow = list.createDiv({ cls: 'task-week-goal-add-row' });
        const daySelect = inputRow.createEl('select', { cls: 'task-week-goal-add-day' });
        for (let day = 1; day <= 7; day += 1) {
            const option = daySelect.createEl('option', { text: t(WEEKDAY_LABEL_KEYS[day - 1]) });
            option.value = makeDayKeyFromWeek(this.weekKey, day);
        }
        // 默认选中今天（当前周），查看其它周时默认周一
        const todayKey = getCurrentDayKey();
        daySelect.value = Array.from(daySelect.options).some((option) => option.value === todayKey)
            ? todayKey
            : makeDayKeyFromWeek(this.weekKey, 1);

        const input = inputRow.createEl('input', {
            cls: 'task-week-goal-add-input',
            attr: { type: 'text', placeholder: t('panel.weekGoalAddPlaceholder') },
        });
        const confirmBtn = inputRow.createEl('button', {
            cls: 'task-week-goal-add-confirm',
            text: t('common.confirm'),
            attr: { type: 'button' },
        });
        input.focus();

        let finished = false;
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            const text = input.value.trim();
            const dayKey = daySelect.value;
            if (!commit || !text || !dayKey) {
                this.render();
                return;
            }
            setDayGoalEntries(task, dayKey, [
                ...getDayGoalEntries(task, dayKey),
                { id: `dgoal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, createdAt: Date.now() },
            ]);
            void this.commit(task);
        };
        confirmBtn.addEventListener('click', () => finish(true));
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                finish(true);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                finish(false);
            }
        });
    }

    /* ---------------- 目标 ---------------- */

    private renderGoals(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-section-goals' });
        const goals = getTaskGoals(task);

        const inputRow = wrap.createDiv({ cls: 'task-section-input-row' });
        const input = inputRow.createEl('input', {
            cls: 'task-section-input',
            attr: { type: 'text', placeholder: t('panel.planAnnualAddGoal') },
        });
        const addBtn = inputRow.createEl('button', {
            cls: 'task-section-add-btn',
            text: t('common.add'),
            attr: { type: 'button' },
        });
        const submit = (): void => {
            const text = input.value.trim();
            if (!text) return;
            setTaskGoals(task, [
                ...getTaskGoals(task),
                { id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, createdAt: Date.now() },
            ]);
            input.value = '';
            void this.commit(task);
        };
        addBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                submit();
            }
        });

        if (goals.length === 0) {
            wrap.createDiv({ cls: 'task-section-empty', text: t('panel.planAnnualNoGoal') });
            return;
        }
        const list = wrap.createDiv({ cls: 'task-section-list' });
        for (const goal of goals) {
            const row = list.createDiv({ cls: 'task-section-item' });
            row.toggleClass('is-done', goal.done === true);
            const checkbox = row.createEl('input', { cls: 'task-section-check', attr: { type: 'checkbox' } });
            checkbox.checked = goal.done === true;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) goal.done = true;
                else delete goal.done;
                void this.commit(task);
            });
            const main = row.createDiv({ cls: 'task-section-item-main' });
            main.createSpan({ cls: 'task-section-item-text', text: goal.text });
            const delBtn = row.createEl('button', {
                cls: 'task-section-item-delete',
                text: '×',
                attr: { type: 'button', 'aria-label': t('common.delete') },
            });
            delBtn.addEventListener('click', () => {
                setTaskGoals(task, getTaskGoals(task).filter((item) => item.id !== goal.id));
                void this.commit(task);
            });
        }
    }

    /* ---------------- 任务文件 ---------------- */

    private renderFiles(body: HTMLElement, task: PrototypeTask): void {
        const wrap = body.createDiv({ cls: 'task-detail-files' });
        const card = wrap.createDiv({ cls: 'task-detail-files-card' });
        const toolbar = card.createDiv({ cls: 'task-detail-files-toolbar' });
        const dir = getTaskFileDir(task);

        // 排序方式：字母正序/反序、创建时间、修改时间（行首）
        const sortSelect = toolbar.createEl('select', {
            cls: 'dropdown task-detail-files-sort',
            attr: { 'aria-label': t('panel.fileSort') },
        });
        const sortOptions: { value: TaskFileSortMode; labelKey: LabelKey }[] = [
            { value: 'name-asc', labelKey: 'panel.fileSortNameAsc' },
            { value: 'name-desc', labelKey: 'panel.fileSortNameDesc' },
            { value: 'ctime-desc', labelKey: 'panel.fileSortCtimeDesc' },
            { value: 'ctime-asc', labelKey: 'panel.fileSortCtimeAsc' },
            { value: 'mtime-desc', labelKey: 'panel.fileSortMtimeDesc' },
            { value: 'mtime-asc', labelKey: 'panel.fileSortMtimeAsc' },
        ];
        for (const option of sortOptions) {
            const optionEl = sortSelect.createEl('option', { text: t(option.labelKey), attr: { value: option.value } });
            optionEl.selected = option.value === this.fileSortMode;
        }

        // 文件夹：目录由任务树自动绑定，点击在 Obsidian 文件浏览器中定位
        const dirBtn = toolbar.createEl('button', { cls: 'task-detail-files-btn', attr: { type: 'button' } });
        setIcon(dirBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'folder');
        dirBtn.createSpan({ cls: 'task-detail-files-btn-text', text: t('panel.fileFolder') });
        if (dir) dirBtn.title = dir;
        dirBtn.addEventListener('click', () => void this.openTaskFolder(task));

        // 模板（文件夹按钮右侧）：打开文件模板配置面板
        const templateBtn = toolbar.createEl('button', {
            cls: 'task-detail-files-btn',
            attr: { type: 'button', 'aria-label': t('panel.fileTemplate') },
        });
        setIcon(templateBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'layout-template');
        templateBtn.createSpan({ cls: 'task-detail-files-btn-text', text: t('panel.fileTemplate') });
        templateBtn.addEventListener('click', () => this.openFileTemplatePanel(task));

        // 新建文件（行尾）
        const addBtn = toolbar.createEl('button', {
            cls: 'task-detail-files-btn task-detail-files-btn-end',
            attr: { type: 'button' },
        });
        setIcon(addBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'plus');
        addBtn.createSpan({ cls: 'task-detail-files-btn-text', text: t('panel.fileAdd') });
        addBtn.addEventListener('click', () => void this.startCreateFile(task));

        if (this.fileCreateMode) this.renderFileCreateRow(card, task);

        // 文件列表
        const listCard = wrap.createDiv({ cls: 'task-detail-files-card task-detail-files-list-card' });
        sortSelect.addEventListener('change', () => {
            this.fileSortMode = sortSelect.value as TaskFileSortMode;
            this.renderFileRows(listCard, dir);
        });
        this.renderFileRows(listCard, dir);
    }

    /** 渲染绑定目录下的文件列表（按当前排序方式） */
    private renderFileRows(listCard: HTMLElement, dir: string | undefined): void {
        listCard.empty();
        if (!dir) {
            listCard.createDiv({ cls: 'task-section-empty', text: t('panel.taskLibraryRequired') });
            return;
        }
        const files = listTaskFiles(this.options.app, dir, this.fileSortMode);
        if (files.length === 0) {
            listCard.createDiv({ cls: 'task-section-empty', text: t('panel.fileEmpty') });
            return;
        }
        for (const file of files) {
            const row = listCard.createDiv({ cls: 'task-detail-file-row' });
            setIcon(row.createSpan({ cls: 'task-detail-file-icon' }), 'file-text');
            const nameEl = row.createSpan({ cls: 'task-detail-file-name', text: relativeToDir(file.path, dir) });
            nameEl.title = file.path;
            row.createSpan({ cls: 'task-detail-file-time', text: formatDateTime(file.stat.mtime) });
            row.addEventListener('click', () => this.openTaskFile(file));
        }
    }

    /** 打开文件模板面板（第一行为「启用时间戳」开关） */
    private openFileTemplatePanel(task: PrototypeTask): void {
        if (!this.fileTemplatePanel) {
            const panel = new FloatingPanel({
                width: 280,
                title: t('panel.fileTemplate'),
                closeOnBlur: true,
                container: this.options.container,
            });
            // 子面板内的点击不触发父面板的失焦关闭
            this.options.registerIgnoreElement?.(panel.element);
            this.fileTemplatePanel = panel;
        }
        const panel = this.fileTemplatePanel;
        panel.setContent((body) => {
            body.addClass('task-file-template-panel');
            const switchWrap = body.createDiv({ cls: 'task-detail-files-switch' });
            const checkbox = switchWrap.createEl('input', {
                cls: 'task-detail-files-checkbox',
                attr: { type: 'checkbox' },
            });
            checkbox.checked = getTaskFileTimestamp(task);
            checkbox.disabled = !getTaskFileDir(task);
            checkbox.addEventListener('change', () => {
                setTaskFileTimestamp(task, checkbox.checked);
                void this.commit(task);
            });
            switchWrap.createSpan({ cls: 'task-detail-files-switch-label', text: t('panel.fileTimestamp') });
        });
        panel.open();
    }

    /** 新建文件输入行（先确保目录存在） */
    private renderFileCreateRow(card: HTMLElement, task: PrototypeTask): void {
        const createRow = card.createDiv({ cls: 'task-detail-files-create' });
        const nameInput = createRow.createEl('input', {
            cls: 'task-detail-files-create-input',
            attr: { type: 'text', placeholder: t('panel.fileCreatePlaceholder') },
        });
        const confirmBtn = createRow.createEl('button', { text: t('panel.fileCreate'), attr: { type: 'button' } });
        const cancelBtn = createRow.createEl('button', { text: t('common.cancel'), attr: { type: 'button' } });
        const submit = (): void => {
            const name = nameInput.value.trim();
            if (!name) return;
            void this.createTaskFile(task, name);
        };
        confirmBtn.addEventListener('click', submit);
        nameInput.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') submit();
            if (evt.key === 'Escape') {
                this.fileCreateMode = false;
                this.render();
            }
        });
        cancelBtn.addEventListener('click', () => {
            this.fileCreateMode = false;
            this.render();
        });
        nameInput.focus();
    }

    /** 按项目库根目录 + 任务树确保任务文件目录（未配置项目库时返回 null） */
    private async ensureFilesDir(task: PrototypeTask): Promise<string | null> {
        const root = this.options.getTaskLibraryRoot?.() ?? '';
        if (!root) {
            new Notice(t('panel.taskLibraryRequired'));
            return null;
        }
        const tasks = this.options.getTasks?.() ?? [task];
        const result = await ensureTaskFileDir(this.options.app, root, tasks, task);
        if (result.changed) await this.options.save();
        return result.dir;
    }

    /** 点击「文件夹」：确保目录存在并在 Obsidian 文件浏览器中定位 */
    private async openTaskFolder(task: PrototypeTask): Promise<void> {
        const dir = await this.ensureFilesDir(task);
        if (!dir) return;
        const folder = this.options.app.vault.getAbstractFileByPath(dir);
        if (folder instanceof TFolder) revealFolderInExplorer(this.options.app, folder);
        this.render();
    }

    /** 点击「添加」：确保目录存在后展开新建输入行 */
    private async startCreateFile(task: PrototypeTask): Promise<void> {
        const dir = await this.ensureFilesDir(task);
        if (!dir) return;
        this.fileCreateMode = true;
        this.render();
    }

    /** 在任务文件目录下新建 Markdown 文件（启用时间戳时加前缀），并打开内置编辑面板 */
    private async createTaskFile(task: PrototypeTask, name: string): Promise<void> {
        const dir = await this.ensureFilesDir(task);
        if (!dir) return;
        const fileName = buildTaskFileName(name, getTaskFileTimestamp(task));
        if (!fileName) return;
        try {
            const file = await this.options.app.vault.create(`${dir}/${fileName}`, '');
            this.fileCreateMode = false;
            this.render();
            this.openTaskFile(file);
        } catch {
            new Notice(t('panel.fileCreateFailed'));
        }
    }

    /** 打开任务文件：仅普通 .md（文件名不含其他点）使用内置编辑面板，其余类型（如 xxx.universe.md）交给 Obsidian 新标签页打开 */
    private openTaskFile(file: TFile): void {
        const isPlainMarkdown = file.extension === 'md' && !file.basename.includes('.');
        if (!isPlainMarkdown) {
            void this.options.app.workspace.getLeaf('tab').openFile(file);
            return;
        }
        this.fileEditorPanel?.destroy();
        this.fileEditorPanel = new FileEditorPanel({
            app: this.options.app,
            file,
            container: this.options.container,
            onClose: () => {
                if (this.hostEl?.isConnected) this.render();
            },
        });
        this.fileEditorPanel.open();
    }

    /* ---------------- 习惯 ---------------- */

    private renderHabit(body: HTMLElement, task: PrototypeTask): void {
        new HabitEditor(body.createDiv({ cls: 'task-section-habit' }), {
            getHabit: () => this.readHabit(task),
            onChange: (patch) => {
                setTaskHabit(task, { ...this.readHabit(task), ...patch });
                void this.commit(task);
            },
            disableWhenInactive: true,
        });
    }
}

/** 完成时间格式化为 MM-DD HH:MM */
function formatCompletedTime(ts: number): string {
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mo}-${da} ${h}:${mi}`;
}

/** 时间戳格式化为 YYYY-MM-DD HH:MM */
function formatDateTime(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${h}:${mi}`;
}

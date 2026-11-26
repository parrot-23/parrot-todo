// 清单面板：顶部「清单类型」下拉（步骤清单 / 改进清单），下方按所选类型展示所有任务中非空的清单卡片。
// 卡片内容与任务板块面板「清单」板块保持一致（标题行 + 条目列表），条目可直接勾选 / 编辑 / 删除。
import { setIcon } from 'obsidian';

import type { ChecklistCategory, ChecklistItem } from '../../../core/datatypes/domain';
import type { PrototypeTask } from '../../../core/datatypes/prototype-task';
import { t } from '../../../core/i18n';
import type { PlanCategory } from '../../../core/shared/plan-category-manager';
import { getChecklist, setChecklist } from '../../../core/shared/task-sections';
import { FloatingPanel, type FloatingPanelOptions } from '../../../ui/basic/floating-panel';

/** 清单面板配置 */
export interface ChecklistPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「清单」 */
    title?: string;
    /** 任务数据源（每次打开时重新读取） */
    getTasks: () => PrototypeTask[];
    /** 分类数据源（卡片头部显示分类名称与颜色） */
    getCategories: () => PlanCategory[];
    /** 数据保存回调 */
    save: () => Promise<void>;
    /** 清单变更回调（界面视图据此刷新） */
    onChanged?: () => void;
    /** 点击卡片头部：在任务详情面板中打开该任务 */
    onOpenTaskDetail?: (taskId: string) => void;
}

/** 清单面板 */
export class ChecklistPanel extends FloatingPanel {
    /** 当前选中的清单类型 */
    private category: ChecklistCategory = 'step';
    private listEl!: HTMLElement;

    constructor(private readonly panelOptions: ChecklistPanelOptions) {
        super({
            width: 720,
            title: panelOptions.title ?? t('panel.targetChecklist'),
            ...panelOptions,
        });
        this.body.addClass('checklist-panel-body');
        this.renderLayout();
    }

    /** 每次打开时重新渲染，保证任务与清单数据最新 */
    override open(): void {
        this.renderList();
        super.open();
    }

    private renderLayout(): void {
        // 第一行：清单类型 + 下拉列表
        const head = this.body.createDiv({ cls: 'checklist-panel-head' });
        head.createSpan({ cls: 'checklist-panel-label', text: t('panel.checklistTypeLabel') });
        const select = head.createEl('select', { cls: 'dropdown checklist-panel-select' });
        const options: { value: ChecklistCategory; labelKey: 'panel.checklistCategoryStep' | 'panel.checklistCategoryImprove' }[] = [
            { value: 'step', labelKey: 'panel.checklistCategoryStep' },
            { value: 'improve', labelKey: 'panel.checklistCategoryImprove' },
        ];
        for (const option of options) {
            const el = select.createEl('option', { text: t(option.labelKey) });
            el.value = option.value;
        }
        select.value = this.category;
        select.addEventListener('change', () => {
            this.category = select.value === 'improve' ? 'improve' : 'step';
            this.renderList();
        });

        this.listEl = this.body.createDiv({ cls: 'checklist-panel-list' });
        this.renderList();
    }

    /** 当前类型下所有任务的非空清单条目 */
    private entriesOf(task: PrototypeTask): ChecklistItem[] {
        return getChecklist(task).filter((entry) => (entry.category ?? 'step') === this.category);
    }

    /** 渲染卡片列表：每个有该类型清单的任务一张卡片 */
    private renderList(): void {
        this.listEl.empty();
        const cards = this.panelOptions.getTasks()
            .map((task) => ({ task, entries: this.entriesOf(task) }))
            .filter((item) => item.entries.length > 0);
        if (cards.length === 0) {
            this.listEl.createDiv({ cls: 'task-section-empty', text: t('panel.checklistEmpty') });
            return;
        }
        for (const { task, entries } of cards) this.renderCard(task, entries);
    }

    /** 单张清单卡片：任务头部 + 条目列表 */
    private renderCard(task: PrototypeTask, entries: ChecklistItem[]): void {
        const card = this.listEl.createDiv({ cls: 'checklist-panel-card' });
        const head = card.createDiv({ cls: 'checklist-panel-card-head' });
        const category = this.panelOptions.getCategories().find((item) => item.id === task.categoryId);
        head.createSpan({ cls: 'plan-info-dot' }).setCssStyles({ background: category?.color ?? '#888888' });
        const nameEl = head.createSpan({ cls: 'checklist-panel-card-name', text: task.name });
        nameEl.title = task.name;
        if (this.panelOptions.onOpenTaskDetail) {
            nameEl.addClass('is-link');
            nameEl.addEventListener('click', () => this.panelOptions.onOpenTaskDetail?.(task.id));
        }

        const list = card.createDiv({ cls: 'task-section-list' });
        // 未完成在前、已完成沉底
        const ordered = [...entries.filter((entry) => !entry.done), ...entries.filter((entry) => entry.done)];
        for (const entry of ordered) this.renderEntry(list, task, entry);
    }

    /** 单条清单条目：勾选 + 文本（点击编辑）+ 悬浮删除 */
    private renderEntry(list: HTMLElement, task: PrototypeTask, entry: ChecklistItem): void {
        const row = list.createDiv({ cls: 'task-section-item' });
        row.toggleClass('is-done', entry.done === true);

        const checkbox = row.createEl('input', { cls: 'task-section-check', attr: { type: 'checkbox' } });
        checkbox.checked = entry.done === true;
        checkbox.addEventListener('change', () => {
            entry.done = checkbox.checked;
            if (checkbox.checked) entry.completedAt = Date.now();
            else delete entry.completedAt;
            this.commit(task);
        });

        const textEl = row.createSpan({ cls: 'task-section-item-text', text: entry.text });
        textEl.addEventListener('click', () => {
            if (row.querySelector('input.task-section-item-edit')) return;
            const editor = row.createEl('input', {
                cls: 'task-section-input task-section-item-edit',
                attr: { type: 'text' },
            });
            editor.value = entry.text;
            textEl.addClass('is-hidden');
            row.addClass('is-editing');
            let finished = false;
            const finish = (save: boolean): void => {
                if (finished) return;
                finished = true;
                const next = editor.value.trim();
                editor.remove();
                textEl.removeClass('is-hidden');
                row.removeClass('is-editing');
                if (!save || !next || next === entry.text) return;
                entry.text = next;
                this.commit(task);
            };
            editor.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    finish(true);
                }
                if (evt.key === 'Escape') finish(false);
            });
            editor.addEventListener('blur', () => finish(true));
            editor.focus();
            editor.select();
        });

        const delBtn = row.createEl('button', {
            cls: 'task-section-item-delete',
            attr: { type: 'button', 'aria-label': t('common.delete') },
        });
        setIcon(delBtn, 'x');
        delBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            setChecklist(task, getChecklist(task).filter((item) => item.id !== entry.id));
            this.commit(task);
        });
    }

    /** 保存并重绘（条目删除后卡片可能变空） */
    private commit(task: PrototypeTask): void {
        void this.panelOptions.save();
        this.panelOptions.onChanged?.();
        this.renderList();
    }
}

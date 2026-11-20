// 公共日期选择控件：按钮触发器 + 月历面板，支持今天 / 清除。
import { setIcon } from 'obsidian';

import { getWeekDays, t } from '../../core/i18n';
import { PickerPopover } from './picker-popover';

/** 日期选择器配置 */
export interface DatePickerOptions {
    /** 当前日期（YYYY-MM-DD） */
    value?: string;
    /** 空值占位符 */
    placeholder?: string;
    /** 追加到根节点的类名 */
    cls?: string;
    /** 是否禁用 */
    disabled?: boolean;
    /** 是否允许清空 */
    clearable?: boolean;
    /** 触发器无障碍标签 */
    ariaLabel?: string;
    /** 选择变化回调，清空时传 undefined */
    onChange: (value?: string) => void;
}

/** 日期选择控件：触发器 + 月历网格 */
export class DatePicker {
    /** 组件根节点 */
    readonly el: HTMLElement;
    private readonly triggerEl: HTMLButtonElement;
    private readonly valueEl: HTMLElement;
    private readonly popover: PickerPopover;
    private value?: string;
    private disabled: boolean;
    private viewYear = 0;
    private viewMonth = 0;
    private titleEl: HTMLElement | null = null;
    private gridEl: HTMLElement | null = null;

    constructor(parentEl: HTMLElement, private readonly options: DatePickerOptions) {
        this.value = normalizeDate(options.value);
        this.disabled = options.disabled === true;
        const base = this.value ? parseDate(this.value) : new Date();
        this.viewYear = base.getFullYear();
        this.viewMonth = base.getMonth();

        this.el = parentEl.createDiv({ cls: `date-picker ${options.cls ?? ''}`.trim() });
        this.triggerEl = this.el.createEl('button', {
            cls: 'picker-trigger date-picker-trigger',
            attr: {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false',
                ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
            },
        });
        setIcon(this.triggerEl.createSpan({ cls: 'date-picker-icon' }), 'calendar-days');
        this.valueEl = this.triggerEl.createSpan({ cls: 'date-picker-value' });
        setIcon(this.triggerEl.createSpan({ cls: 'date-picker-caret' }), 'chevrons-up-down');
        this.triggerEl.addEventListener('click', () => {
            if (this.popover.isOpen) this.close();
            else this.open();
        });

        this.popover = new PickerPopover(this.triggerEl, {
            cls: 'date-picker-popover',
            onClose: () => this.resetPopoverState(),
        });

        this.setDisabled(this.disabled);
        this.renderTrigger();
    }

    /** 静默更新值（不触发回调） */
    setValue(value?: string): void {
        this.value = normalizeDate(value);
        this.renderTrigger();
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.el.toggleClass('is-disabled', disabled);
        this.triggerEl.disabled = disabled;
        if (disabled) this.close();
    }

    /** 触发器展示日期或占位符 */
    private renderTrigger(): void {
        const hasValue = this.value !== undefined;
        this.valueEl.setText(hasValue ? this.value! : (this.options.placeholder ?? '—'));
        this.valueEl.toggleClass('is-placeholder', !hasValue);
    }

    private open(): void {
        if (this.disabled || this.popover.isOpen) return;
        // 每次打开回到当前值（或今天）所在月份
        const base = this.value ? parseDate(this.value) : new Date();
        this.viewYear = base.getFullYear();
        this.viewMonth = base.getMonth();
        this.triggerEl.setAttr('aria-expanded', 'true');
        this.triggerEl.addClass('is-open');
        this.popover.open((el) => this.buildContent(el));
    }

    /** 面板结构：月份导航 + 星期表头 + 日期网格 + 清除 / 今天 */
    private buildContent(popover: HTMLElement): void {
        const head = popover.createDiv({ cls: 'date-picker-head' });
        const prevBtn = this.createIconButton(head, 'chevron-left', () => this.shiftMonth(-1));
        prevBtn.setAttr('aria-label', t('datePicker.prevMonth'));
        this.titleEl = head.createSpan({ cls: 'date-picker-title' });
        const nextBtn = this.createIconButton(head, 'chevron-right', () => this.shiftMonth(1));
        nextBtn.setAttr('aria-label', t('datePicker.nextMonth'));

        const weekRow = popover.createDiv({ cls: 'date-picker-weekdays' });
        for (const label of getWeekDays()) {
            weekRow.createSpan({ cls: 'date-picker-weekday', text: label });
        }
        this.gridEl = popover.createDiv({ cls: 'date-picker-grid' });

        const foot = popover.createDiv({ cls: 'picker-foot date-picker-foot' });
        if (this.options.clearable === true && this.value !== undefined) {
            const clearBtn = foot.createEl('button', {
                cls: 'picker-btn',
                text: t('datePicker.clear'),
                attr: { type: 'button' },
            });
            clearBtn.addEventListener('click', () => this.commit(undefined));
        }
        const todayBtn = foot.createEl('button', {
            cls: 'picker-btn',
            text: t('datePicker.today'),
            attr: { type: 'button' },
        });
        todayBtn.addEventListener('click', () => this.commit(toIso(new Date())));

        this.renderCalendar();
    }

    /** 月份切换 */
    private shiftMonth(delta: number): void {
        const target = new Date(this.viewYear, this.viewMonth + delta, 1);
        this.viewYear = target.getFullYear();
        this.viewMonth = target.getMonth();
        this.renderCalendar();
    }

    /** 渲染 6×7 日期网格（周一开头，含相邻月份补位） */
    private renderCalendar(): void {
        if (!this.titleEl || !this.gridEl) return;
        this.titleEl.setText(t('datePicker.monthTitle', { year: this.viewYear, month: this.viewMonth + 1 }));
        this.gridEl.empty();

        const first = new Date(this.viewYear, this.viewMonth, 1);
        const offset = (first.getDay() + 6) % 7;
        const todayIso = toIso(new Date());

        for (let index = 0; index < 42; index += 1) {
            const date = new Date(this.viewYear, this.viewMonth, 1 - offset + index);
            const iso = toIso(date);
            const button = this.gridEl.createEl('button', {
                cls: 'date-picker-day',
                text: String(date.getDate()),
                attr: { type: 'button' },
            });
            button.toggleClass('is-outside', date.getMonth() !== this.viewMonth);
            button.toggleClass('is-today', iso === todayIso);
            button.toggleClass('is-selected', iso === this.value);
            button.addEventListener('click', () => this.commit(iso));
        }
    }

    /** 月份导航按钮 */
    private createIconButton(parentEl: HTMLElement, icon: string, onClick: () => void): HTMLElement {
        const button = parentEl.createEl('button', { cls: 'picker-icon-btn', attr: { type: 'button' } });
        setIcon(button, icon);
        button.addEventListener('click', onClick);
        return button;
    }

    private commit(value?: string): void {
        const changed = value !== this.value;
        this.popover.close();
        if (!changed) return;
        this.value = value;
        this.renderTrigger();
        this.options.onChange(value);
    }

    private close(): void {
        this.popover.close();
    }

    /** 弹层关闭后清理引用与触发器状态 */
    private resetPopoverState(): void {
        this.titleEl = null;
        this.gridEl = null;
        this.triggerEl.setAttr('aria-expanded', 'false');
        this.triggerEl.removeClass('is-open');
    }
}

/** 补零 */
function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** Date → YYYY-MM-DD（本地时区） */
function toIso(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 解析 YYYY-MM-DD，非法值回退到今天 */
function parseDate(value: string): Date {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!match) return new Date();
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** 规范化为 YYYY-MM-DD，非法值返回 undefined */
function normalizeDate(value?: string): string | undefined {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!match) return undefined;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return undefined;
    return toIso(date);
}

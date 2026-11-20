// 公共时间选择控件：替代原生 <input type="time">。
// 触发器展示 HH:mm，点击弹出「时 / 分」两列选择面板（同主流时间选择器），确定后生效。
import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import { PickerPopover } from './picker-popover';

/** 时间选择器配置 */
export interface TimePickerOptions {
    /** 初始时间（HH:mm） */
    value: string;
    /** 确认选择后回调（HH:mm） */
    onChange: (value: string) => void;
    /** 是否禁用 */
    disabled?: boolean;
    /** 触发器无障碍标签 */
    ariaLabel?: string;
}

/** 选项高度 + 间距，用于滚动定位 */
const OPTION_STEP = 30;

/** 时间选择控件：按钮触发器 + 时 / 分两列面板 */
export class TimePicker {
    /** 组件根节点（用于外部控制显隐） */
    readonly el: HTMLElement;
    private readonly triggerEl: HTMLButtonElement;
    private readonly valueEl: HTMLElement;
    private readonly popover: PickerPopover;
    private value: string;
    private disabled: boolean;
    private hour: number;
    private minute: number;
    /** 面板内暂存的选择，确定后才写回 */
    private draftHour = 0;
    private draftMinute = 0;
    private readoutEl: HTMLElement | null = null;
    private hourListEl: HTMLElement | null = null;
    private minuteListEl: HTMLElement | null = null;
    private hourButtons: HTMLButtonElement[] = [];
    private minuteButtons: HTMLButtonElement[] = [];

    constructor(parentEl: HTMLElement, private readonly options: TimePickerOptions) {
        this.value = normalizeTime(options.value);
        this.disabled = options.disabled === true;
        ({ hour: this.hour, minute: this.minute } = parseTime(this.value));

        this.el = parentEl.createDiv({ cls: 'time-picker' });
        this.triggerEl = this.el.createEl('button', {
            cls: 'picker-trigger time-picker-trigger',
            attr: {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false',
                ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
            },
        });
        setIcon(this.triggerEl.createSpan({ cls: 'time-picker-icon' }), 'clock');
        this.valueEl = this.triggerEl.createSpan({ cls: 'time-picker-value', text: this.value });
        setIcon(this.triggerEl.createSpan({ cls: 'time-picker-caret' }), 'chevrons-up-down');
        this.triggerEl.addEventListener('click', () => {
            if (this.popover.isOpen) this.close();
            else this.open();
        });

        this.popover = new PickerPopover(this.triggerEl, {
            cls: 'time-picker-popover',
            onClose: () => this.resetPopoverState(),
        });

        this.setDisabled(this.disabled);
    }

    /** 静默更新显示值 */
    setValue(value: string): void {
        this.value = normalizeTime(value);
        ({ hour: this.hour, minute: this.minute } = parseTime(this.value));
        this.valueEl.setText(this.value);
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.el.toggleClass('is-disabled', disabled);
        this.triggerEl.disabled = disabled;
        if (disabled) this.close();
    }

    /** 打开面板：以当前值为草稿，并把两列滚动到选中项 */
    private open(): void {
        if (this.disabled || this.popover.isOpen) return;
        this.draftHour = this.hour;
        this.draftMinute = this.minute;
        this.triggerEl.setAttr('aria-expanded', 'true');
        this.triggerEl.addClass('is-open');

        this.popover.open((el) => this.buildContent(el));

        // 面板渲染完成后把选中项居中
        this.centerSelected(this.hourListEl, this.draftHour);
        this.centerSelected(this.minuteListEl, this.draftMinute);
    }

    /** 面板结构：读数 + 现在 / 时、分两列 / 取消、确定 */
    private buildContent(popover: HTMLElement): void {
        const head = popover.createDiv({ cls: 'time-picker-head' });
        this.readoutEl = head.createSpan({ cls: 'time-picker-readout', text: formatTime(this.draftHour, this.draftMinute) });
        const nowBtn = head.createEl('button', {
            cls: 'time-picker-now',
            text: t('timePicker.now'),
            attr: { type: 'button' },
        });
        nowBtn.addEventListener('click', () => {
            const now = new Date();
            this.draftHour = now.getHours();
            this.draftMinute = now.getMinutes();
            this.confirm();
        });

        const columns = popover.createDiv({ cls: 'time-picker-columns' });

        // 时
        const hourColumn = columns.createDiv({ cls: 'time-picker-column' });
        hourColumn.createDiv({ cls: 'time-picker-column-label', text: t('timePicker.hour') });
        this.hourListEl = hourColumn.createDiv({ cls: 'picker-list' });
        this.hourButtons = [];
        for (let hour = 0; hour < 24; hour += 1) {
            const button = this.hourListEl.createEl('button', {
                cls: 'picker-option',
                text: pad(hour),
                attr: { type: 'button' },
            });
            button.toggleClass('is-active', hour === this.draftHour);
            button.addEventListener('click', () => this.setDraft(hour, this.draftMinute));
            button.addEventListener('dblclick', () => this.confirm());
            this.hourButtons.push(button);
        }

        // 分
        const minuteColumn = columns.createDiv({ cls: 'time-picker-column' });
        minuteColumn.createDiv({ cls: 'time-picker-column-label', text: t('timePicker.minute') });
        this.minuteListEl = minuteColumn.createDiv({ cls: 'picker-list' });
        this.minuteButtons = [];
        for (let minute = 0; minute < 60; minute += 1) {
            const button = this.minuteListEl.createEl('button', {
                cls: 'picker-option',
                text: pad(minute),
                attr: { type: 'button' },
            });
            button.toggleClass('is-active', minute === this.draftMinute);
            button.addEventListener('click', () => this.setDraft(this.draftHour, minute));
            button.addEventListener('dblclick', () => this.confirm());
            this.minuteButtons.push(button);
        }

        const foot = popover.createDiv({ cls: 'picker-foot' });
        const cancelBtn = foot.createEl('button', {
            cls: 'picker-btn',
            text: t('timePicker.cancel'),
            attr: { type: 'button' },
        });
        cancelBtn.addEventListener('click', () => this.close());
        const confirmBtn = foot.createEl('button', {
            cls: 'picker-btn is-primary',
            text: t('timePicker.confirm'),
            attr: { type: 'button' },
        });
        confirmBtn.addEventListener('click', () => this.confirm());
    }

    /** 面板内选择（不提交） */
    private setDraft(hour: number, minute: number): void {
        this.draftHour = hour;
        this.draftMinute = minute;
        this.hourButtons.forEach((button, index) => button.toggleClass('is-active', index === hour));
        this.minuteButtons.forEach((button, index) => button.toggleClass('is-active', index === minute));
        this.readoutEl?.setText(formatTime(hour, minute));
    }

    /** 确定：先收起面板，再写回并通知调用方 */
    private confirm(): void {
        const hour = this.draftHour;
        const minute = this.draftMinute;
        this.close();
        this.hour = hour;
        this.minute = minute;
        this.value = formatTime(hour, minute);
        this.valueEl.setText(this.value);
        this.options.onChange(this.value);
    }

    /** 把选中项滚动到列表中间 */
    private centerSelected(list: HTMLElement | null, index: number): void {
        if (!list) return;
        const target = index * OPTION_STEP - (list.clientHeight - OPTION_STEP) / 2;
        list.scrollTop = Math.max(0, target);
    }

    private close(): void {
        this.popover.close();
    }

    /** 弹层关闭后清理引用与触发器状态 */
    private resetPopoverState(): void {
        this.readoutEl = null;
        this.hourListEl = null;
        this.minuteListEl = null;
        this.hourButtons = [];
        this.minuteButtons = [];
        this.triggerEl.setAttr('aria-expanded', 'false');
        this.triggerEl.removeClass('is-open');
    }
}

/** 补零 */
function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** 解析 HH:mm，非法值回退到 09:00 */
function parseTime(value: string): { hour: number; minute: number } {
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(value);
    if (!match) return { hour: 9, minute: 0 };
    return {
        hour: Math.min(23, Math.max(0, Number(match[1]))),
        minute: Math.min(59, Math.max(0, Number(match[2]))),
    };
}

/** 格式化 HH:mm */
function formatTime(hour: number, minute: number): string {
    return `${pad(hour)}:${pad(minute)}`;
}

/** 规范化为 HH:mm */
function normalizeTime(value: string): string {
    const { hour, minute } = parseTime(value);
    return formatTime(hour, minute);
}

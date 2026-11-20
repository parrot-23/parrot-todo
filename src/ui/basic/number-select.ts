// 公共数值下拉控件：按钮触发器 + 单列选项面板，年份 / 周次等场景复用。
import { setIcon } from 'obsidian';

import { PickerPopover } from './picker-popover';

/** 数值下拉配置 */
export interface NumberSelectOptions {
    /** 当前值，为空时展示占位符 */
    value?: number;
    /** 可选值列表 */
    options: number[];
    /** 显示在数值后的单位（如 年 / 周） */
    unit?: string;
    /** 空值占位符 */
    placeholder?: string;
    /** 选项文本格式化，默认直接显示数值 */
    formatOption?: (value: number) => string;
    /** 弹层追加类名（加宽等） */
    popoverCls?: string;
    /** 追加到根节点的类名 */
    cls?: string;
    /** 是否禁用 */
    disabled?: boolean;
    /** 是否允许清空（悬停触发器时显示 ×） */
    clearable?: boolean;
    /** 触发器无障碍标签 */
    ariaLabel?: string;
    /** 选择变化回调，清空时传 undefined */
    onChange: (value?: number) => void;
}

/** 选项高度 + 间距，用于滚动定位 */
const OPTION_STEP = 30;

/** 数值下拉控件：触发器 + 单列滚动选项 */
export class NumberSelect {
    /** 组件根节点 */
    readonly el: HTMLElement;
    private readonly triggerEl: HTMLButtonElement;
    private readonly valueEl: HTMLElement;
    private readonly clearEl: HTMLElement;
    private readonly popover: PickerPopover;
    private value?: number;
    private disabled: boolean;
    private values: number[];

    constructor(parentEl: HTMLElement, private readonly options: NumberSelectOptions) {
        this.value = options.value;
        this.disabled = options.disabled === true;
        this.values = [...options.options];

        this.el = parentEl.createDiv({ cls: `number-select ${options.cls ?? ''}`.trim() });
        this.el.toggleClass('is-clearable', options.clearable === true);
        this.triggerEl = this.el.createEl('button', {
            cls: 'picker-trigger number-select-trigger',
            attr: {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false',
                ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
            },
        });
        this.valueEl = this.triggerEl.createSpan({ cls: 'number-select-value' });
        if (options.unit) this.triggerEl.createSpan({ cls: 'number-select-unit', text: options.unit });
        this.clearEl = this.triggerEl.createSpan({ cls: 'number-select-clear', attr: { 'aria-hidden': 'true' } });
        setIcon(this.clearEl, 'x');
        setIcon(this.triggerEl.createSpan({ cls: 'number-select-caret' }), 'chevrons-up-down');

        // 清空按钮不触发下拉
        this.clearEl.addEventListener('mousedown', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
        });
        this.clearEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
            if (this.disabled) return;
            this.commit(undefined);
        });
        this.triggerEl.addEventListener('click', () => {
            if (this.popover.isOpen) this.close();
            else this.open();
        });

        this.popover = new PickerPopover(this.triggerEl, {
            cls: `number-select-popover ${options.popoverCls ?? ''}`.trim(),
            onClose: () => this.resetPopoverState(),
        });

        this.setDisabled(this.disabled);
        this.renderTrigger();
    }

    /** 静默更新值（不触发回调） */
    setValue(value?: number): void {
        this.value = value;
        this.renderTrigger();
    }

    /** 更新可选值列表（如年份变化后重算周次范围） */
    setOptions(values: number[]): void {
        this.values = [...values];
        if (this.popover.isOpen) this.close();
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.el.toggleClass('is-disabled', disabled);
        this.triggerEl.disabled = disabled;
        if (disabled) this.close();
    }

    /** 触发器展示：值 + 单位 / 占位符 */
    private renderTrigger(): void {
        const hasValue = this.value !== undefined;
        this.el.toggleClass('has-value', hasValue);
        this.valueEl.setText(hasValue ? String(this.value) : (this.options.placeholder ?? '—'));
        this.valueEl.toggleClass('is-placeholder', !hasValue);
    }

    private open(): void {
        if (this.disabled || this.popover.isOpen) return;
        this.triggerEl.setAttr('aria-expanded', 'true');
        this.triggerEl.addClass('is-open');
        this.popover.open((el) => this.buildContent(el));
    }

    private buildContent(popover: HTMLElement): void {
        const list = popover.createDiv({ cls: 'picker-list number-select-list' });
        for (const value of this.values) {
            const button = list.createEl('button', {
                cls: 'picker-option',
                text: this.options.formatOption ? this.options.formatOption(value) : String(value),
                attr: { type: 'button' },
            });
            button.toggleClass('is-active', value === this.value);
            button.addEventListener('click', () => this.commit(value));
        }

        // 选中项滚动到列表中间
        const index = this.value === undefined ? -1 : this.values.indexOf(this.value);
        if (index >= 0) {
            list.scrollTop = Math.max(0, index * OPTION_STEP - (list.clientHeight - OPTION_STEP) / 2);
        }
    }

    private commit(value?: number): void {
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
        this.triggerEl.setAttr('aria-expanded', 'false');
        this.triggerEl.removeClass('is-open');
    }
}

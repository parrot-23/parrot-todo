// 习惯设置公共组件：任务详情面板「任务类型」选项卡、习惯面板与习惯板块共用。
// 交互后组件自身同步更新界面，持久化与跨视图刷新交由调用方的 onChange 处理。
import { ToggleComponent, setIcon } from 'obsidian';

import type { TaskHabit } from '../../core/datatypes/prototype-task';
import { getWeekDays, t } from '../../core/i18n';
import { TimePicker } from './time-picker';

/** 习惯设置组件配置 */
export interface HabitEditorOptions {
    /** 读取当前习惯设置（渲染时读取一次，调用方负责补默认值） */
    getHabit: () => TaskHabit;
    /** 设置变化回调：调用方负责持久化与联动刷新 */
    onChange: (patch: Partial<TaskHabit>) => void;
    /** 展示「全天」开关（任务类型选项卡使用） */
    showAllDay?: boolean;
    /** 展示「预估时长」（任务类型选项卡使用） */
    showDuration?: boolean;
    /** 未启用习惯时禁用下方配置项（习惯面板使用） */
    disableWhenInactive?: boolean;
}

/** 习惯设置：启用开关 + 时间 / 全天 / 预估时长 / 生效星期 */
export class HabitEditor {
    private readonly el: HTMLElement;
    private habit: TaskHabit;
    private bodyEl: HTMLElement | null = null;
    private allDayToggle: ToggleComponent | null = null;
    private timeSlotEl: HTMLElement | null = null;
    private timePicker: TimePicker | null = null;
    private durationInputEl: HTMLInputElement | null = null;
    private readonly dayButtons: HTMLButtonElement[] = [];

    constructor(parentEl: HTMLElement, private readonly options: HabitEditorOptions) {
        this.habit = { ...options.getHabit() };
        this.el = parentEl.createDiv({ cls: 'kind-settings' });
        this.render();
    }

    /** 构建界面（数据变化后由组件内部就地更新，不整体重建） */
    private render(): void {
        this.el.empty();

        // 头部：图标 + 标题 + 启用开关
        const head = this.el.createDiv({ cls: 'kind-settings-head' });
        setIcon(head.createSpan({ cls: 'kind-settings-mark' }), 'repeat');
        head.createSpan({ cls: 'kind-settings-title', text: t('panel.habitEnable') });
        new ToggleComponent(head.createDiv({ cls: 'kind-settings-switch' }))
            .setValue(this.habit.enabled)
            .onChange((value) => this.update({ enabled: value }));

        const body = this.el.createDiv({ cls: 'kind-settings-body' });
        this.bodyEl = body;

        // 时间：具体时间点 +（可选）全天开关
        const timeRow = body.createDiv({ cls: 'kind-settings-row' });
        timeRow.createSpan({ cls: 'kind-settings-label', text: t('panel.habitTime') });
        const timeControl = timeRow.createDiv({ cls: 'kind-settings-control' });
        const timeSlot = timeControl.createDiv({ cls: 'kind-settings-time' });
        this.timeSlotEl = timeSlot;
        this.timePicker = new TimePicker(timeSlot, {
            value: this.habit.time,
            ariaLabel: t('panel.habitTime'),
            onChange: (value) => this.update({ time: value }),
        });
        if (this.options.showAllDay) {
            const allDay = timeControl.createEl('label', { cls: 'kind-settings-allday' });
            this.allDayToggle = new ToggleComponent(allDay.createDiv({ cls: 'kind-settings-switch' }))
                .setValue(this.habit.allDay === true)
                .onChange((value) => this.update({ allDay: value }));
            allDay.createSpan({ cls: 'kind-settings-allday-label', text: t('panel.habitAllDay') });
        }

        // 预估时长（分钟）
        if (this.options.showDuration) {
            const durationRow = body.createDiv({ cls: 'kind-settings-row' });
            durationRow.createSpan({ cls: 'kind-settings-label', text: t('panel.habitDuration') });
            const durationControl = durationRow.createDiv({ cls: 'kind-settings-control' });
            const numberWrap = durationControl.createDiv({ cls: 'kind-settings-number' });
            const durationInput = numberWrap.createEl('input', {
                cls: 'kind-settings-input kind-settings-number-input',
                attr: { type: 'number', min: '0', 'aria-label': t('panel.habitDuration') },
            });
            this.durationInputEl = durationInput;
            durationInput.value = String(this.habit.duration ?? 30);
            numberWrap.createSpan({ cls: 'kind-settings-unit', text: t('panel.habitDurationUnit') });
            durationInput.addEventListener('change', () => {
                const value = Number(durationInput.value);
                const next = Number.isFinite(value) && value >= 0 ? Math.round(value) : 30;
                durationInput.value = String(next);
                this.update({ duration: next });
            });
        }

        // 生效星期：一周七格，点击切换
        const daysRow = body.createDiv({ cls: 'kind-settings-row' });
        daysRow.createSpan({ cls: 'kind-settings-label', text: t('panel.habitWeekdays') });
        const days = daysRow.createDiv({ cls: 'habit-settings-days' });
        const weekdayLabels = getWeekDays();
        this.dayButtons.length = 0;
        for (let day = 1; day <= 7; day += 1) {
            const button = days.createEl('button', {
                cls: 'habit-settings-day',
                text: weekdayLabels[day - 1],
                attr: { type: 'button', 'aria-label': weekdayLabels[day - 1] },
            });
            button.toggleClass('is-active', this.habit.weekdays.includes(day));
            button.setAttr('aria-pressed', String(this.habit.weekdays.includes(day)));
            button.addEventListener('click', () => {
                const weekdays = this.habit.weekdays.includes(day)
                    ? this.habit.weekdays.filter((item) => item !== day)
                    : [...this.habit.weekdays, day].sort((a, b) => a - b);
                this.update({ weekdays });
            });
            this.dayButtons.push(button);
        }

        this.syncState();
    }

    /** 更新本地数据并同步界面，再通知调用方持久化 */
    private update(patch: Partial<TaskHabit>): void {
        this.habit = { ...this.habit, ...patch };
        this.syncState();
        this.options.onChange(patch);
    }

    /** 同步禁用态与选中态（不重建 DOM，避免输入框失焦） */
    private syncState(): void {
        const inactive = this.options.disableWhenInactive === true && !this.habit.enabled;
        this.bodyEl?.toggleClass('is-disabled', inactive);

        if (this.timeSlotEl) {
            // 仅展示全天开关的视图才隐藏具体时间点
            const hideTime = this.options.showAllDay === true && this.habit.allDay === true;
            this.timeSlotEl.toggleClass('is-hidden', hideTime);
        }
        this.timePicker?.setDisabled(inactive);
        this.allDayToggle?.setDisabled(inactive);
        if (this.durationInputEl) this.durationInputEl.disabled = inactive;

        const selected = this.habit.weekdays;
        this.dayButtons.forEach((button, index) => {
            const active = selected.includes(index + 1);
            button.toggleClass('is-active', active);
            button.setAttr('aria-pressed', String(active));
            button.disabled = inactive;
        });
    }
}

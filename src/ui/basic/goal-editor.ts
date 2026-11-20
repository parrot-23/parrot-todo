// 目标设置公共组件：任务详情面板「任务类型」选项卡使用。
// 启用目标 + 截止时间（年份 / 周次 / 日期联动，周次默认取该周周日）；交互后就地同步界面。
import { ToggleComponent, setIcon } from 'obsidian';

import type { TaskGoalConfig } from '../../core/datatypes/prototype-task';
import { t } from '../../core/i18n';
import {
    getISOWeek,
    getWeeksInYear,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
} from '../../core/shared/plan-data';
import { DatePicker } from './date-picker';
import { NumberSelect } from './number-select';

/** 目标设置组件配置 */
export interface GoalEditorOptions {
    /** 读取当前目标配置（渲染时读取一次） */
    getConfig: () => TaskGoalConfig;
    /** 配置变化回调：调用方负责持久化与联动刷新 */
    onChange: (patch: Partial<TaskGoalConfig>) => void;
}

/** 目标设置：启用开关 + 截止时间（年 / 周 / 日期） */
export class GoalEditor {
    private readonly el: HTMLElement;
    private config: TaskGoalConfig;
    private yearSelect: NumberSelect | null = null;
    private weekSelect: NumberSelect | null = null;
    private datePicker: DatePicker | null = null;
    private deadlineHintEl: HTMLElement | null = null;
    private currentYear?: number;
    private currentWeek?: number;

    constructor(parentEl: HTMLElement, private readonly options: GoalEditorOptions) {
        this.config = { ...options.getConfig() };
        this.el = parentEl.createDiv({ cls: 'kind-settings goal-settings' });
        this.render();
    }

    /** 构建界面（数据变化后由组件内部就地更新，不整体重建） */
    private render(): void {
        this.el.empty();

        // 头部：目标图标 + 启用目标 + 开关
        const head = this.el.createDiv({ cls: 'kind-settings-head' });
        setIcon(head.createSpan({ cls: 'kind-settings-mark' }), 'target');
        head.createSpan({ cls: 'kind-settings-title', text: t('panel.goalEnable') });
        new ToggleComponent(head.createDiv({ cls: 'kind-settings-switch' }))
            .setValue(this.config.enabled)
            .onChange((value) => this.update({ enabled: value }));

        const body = this.el.createDiv({ cls: 'kind-settings-body' });

        // 截止时间：年份 / 周次 / 日期同一行，三者联动
        const row = body.createDiv({ cls: 'kind-settings-row' });
        row.createSpan({ cls: 'kind-settings-label', text: t('panel.goalDeadline') });
        const control = row.createDiv({ cls: 'kind-settings-control goal-settings-line' });

        const parsedWeek = this.config.deadlineWeek ? parseWeekKey(this.config.deadlineWeek) : null;
        this.currentYear = parsedWeek?.year;
        this.currentWeek = parsedWeek?.week;

        const thisYear = new Date().getFullYear();
        const years: number[] = [];
        for (let year = thisYear - 5; year <= thisYear + 15; year += 1) years.push(year);

        this.yearSelect = new NumberSelect(control, {
            value: parsedWeek?.year,
            options: years,
            unit: t('panel.goalDeadlineYearUnit'),
            placeholder: '—',
            clearable: true,
            ariaLabel: t('panel.goalDeadlineYearUnit'),
            cls: 'goal-settings-year',
            onChange: (year) => this.handleYearChange(year),
        });
        this.weekSelect = new NumberSelect(control, {
            value: parsedWeek?.week,
            options: this.weekOptions(),
            unit: t('panel.goalDeadlineWeekUnit'),
            placeholder: '—',
            clearable: true,
            ariaLabel: t('panel.goalDeadlineWeekUnit'),
            cls: 'goal-settings-week-select',
            popoverCls: 'goal-week-popover',
            formatOption: (week) => this.formatWeekOption(week),
            onChange: (week) => this.handleWeekChange(week),
        });
        this.datePicker = new DatePicker(control, {
            value: this.config.deadlineDate,
            placeholder: t('datePicker.placeholder'),
            clearable: true,
            ariaLabel: t('panel.goalDeadlineDate'),
            cls: 'goal-settings-date',
            onChange: (value) => this.handleDateChange(value),
        });

        // 截止时间下方：根据截止日期与今天自动计算距离到期天数
        this.deadlineHintEl = body.createDiv({ cls: 'goal-deadline-hint' });
        this.updateDeadlineHint();
    }

    /** 选择年份：已有周次时把日期同步到该年该周的周日；尚未选周次则只记录年份 */
    private handleYearChange(year?: number): void {
        if (year === undefined) {
            this.clearDeadline();
            return;
        }
        const week = this.currentWeek;
        if (week === undefined) {
            this.currentYear = year;
            this.weekSelect?.setOptions(this.weekOptions());
            this.update({ deadlineWeek: undefined, deadlineDate: undefined });
            return;
        }
        this.setDeadline(year, week);
    }

    /** 选择周次：年份缺失时取当前年，日期同步到该周周日 */
    private handleWeekChange(week?: number): void {
        if (week === undefined) {
            this.clearDeadline();
            return;
        }
        this.setDeadline(this.currentYear ?? new Date().getFullYear(), week);
    }

    /** 选择日期：反向推算年份与周次 */
    private handleDateChange(value?: string): void {
        if (!value) {
            this.clearDeadline();
            return;
        }
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return;
        const year = date.getFullYear();
        const week = getISOWeek(date);
        this.currentYear = year;
        this.currentWeek = week;
        this.yearSelect?.setValue(year);
        this.weekSelect?.setOptions(this.weekOptions());
        this.weekSelect?.setValue(week);
        this.update({ deadlineWeek: makeWeekKey(year, week), deadlineDate: value });
    }

    /** 写回截止周并把日期定位到该周周日 */
    private setDeadline(year: number, week: number): void {
        const clamped = Math.min(week, getWeeksInYear(year));
        const weekKey = makeWeekKey(year, clamped);
        const sunday = makeDayKeyFromWeek(weekKey, 7);
        this.currentYear = year;
        this.currentWeek = clamped;
        this.yearSelect?.setValue(year);
        this.weekSelect?.setOptions(this.weekOptions());
        this.weekSelect?.setValue(clamped);
        this.datePicker?.setValue(sunday);
        this.update({ deadlineWeek: weekKey, deadlineDate: sunday });
    }

    /** 清空整个截止时间 */
    private clearDeadline(): void {
        this.currentYear = undefined;
        this.currentWeek = undefined;
        this.yearSelect?.setValue(undefined);
        this.weekSelect?.setOptions(this.weekOptions());
        this.weekSelect?.setValue(undefined);
        this.datePicker?.setValue(undefined);
        this.update({ deadlineWeek: undefined, deadlineDate: undefined });
    }

    /** 周次候选：随当前年份变化（52/53 周） */
    private weekOptions(): number[] {
        const total = getWeeksInYear(this.currentYear ?? new Date().getFullYear());
        const weeks: number[] = [];
        for (let week = 1; week <= total; week += 1) weeks.push(week);
        return weeks;
    }

    /** 周次下拉项：显示该周对应的周日日期 */
    private formatWeekOption(week: number): string {
        const year = this.currentYear ?? new Date().getFullYear();
        const sunday = makeDayKeyFromWeek(makeWeekKey(year, week), 7);
        const [, month, day] = sunday.split('-');
        return t('panel.goalWeekOption', { week, month, day, weekday: t('week.sunday') });
    }

    /** 截止时间提示：按截止日期与今天计算剩余天数，未设置时隐藏 */
    private updateDeadlineHint(): void {
        if (!this.deadlineHintEl) return;
        const target = this.config.deadlineDate;
        const due = target ? new Date(`${target}T00:00:00`) : null;
        if (!due || Number.isNaN(due.getTime())) {
            this.deadlineHintEl.setText('');
            this.deadlineHintEl.addClass('is-hidden');
            this.deadlineHintEl.removeClass('is-today');
            this.deadlineHintEl.removeClass('is-overdue');
            return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.round((due.getTime() - today.getTime()) / 86400000);
        this.deadlineHintEl.removeClass('is-hidden');
        this.deadlineHintEl.toggleClass('is-today', days === 0);
        this.deadlineHintEl.toggleClass('is-overdue', days < 0);
        if (days > 0) {
            this.deadlineHintEl.setText(t('panel.goalDaysLeft', { days }));
        } else if (days === 0) {
            this.deadlineHintEl.setText(t('panel.goalDueToday'));
        } else {
            this.deadlineHintEl.setText(t('panel.goalOverdue', { days: Math.abs(days) }));
        }
    }

    /** 更新本地配置后通知调用方持久化 */
    private update(patch: Partial<TaskGoalConfig>): void {
        this.config = { ...this.config, ...patch };
        this.updateDeadlineHint();
        this.options.onChange(patch);
    }
}

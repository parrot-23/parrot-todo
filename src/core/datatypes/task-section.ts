// 任务板块（section）：挂在原型任务上的统一板块模型。
// 所有任务附属数据（清单 / 描述 / 目标 / 文件 / 习惯）都以板块形式存放在 task.sections 中，
// 数组顺序即展示顺序；缺省表示该任务没有任何板块。

import type { ChecklistItem } from './domain';
import type { TaskDayGoalEntry, TaskGoalEntry, TaskHabit } from './prototype-task';

/** 各板块类型对应的载荷结构 */
export interface TaskSectionPayloadMap {
    /** 清单 */
    checklist: { items: ChecklistItem[] };
    /** 描述：本周描述（周键 YYYY-Www）+ 日描述（日期 YYYY-MM-DD）+ 每天预估时长（分钟） */
    description: {
        notes: Record<string, string>;
        entries: Record<string, TaskDayGoalEntry[]>;
        estimates?: Record<string, number>;
    };
    /** 目标清单（含目标类型配置：启用 / 截止周 / 截止日期） */
    goals: {
        items: TaskGoalEntry[];
        /** 是否启用目标（仅目标类型任务使用；缺省视为启用，兼容旧数据） */
        enabled?: boolean;
        /** 截止周（周键 YYYY-Www） */
        deadlineWeek?: string;
        /** 截止日期（YYYY-MM-DD） */
        deadlineDate?: string;
    };
    /** 任务文件 */
    files: { fileDir?: string; fileTimestamp?: boolean };
    /** 习惯 */
    habit: TaskHabit;
}

/** 板块类型 */
export type SectionType = keyof TaskSectionPayloadMap;

/**
 * 板块显示设置（仅影响展示，不删除数据）：
 *  auto 有内容才显示；on 始终显示；off 始终隐藏。
 */
export type SectionDisplayMode = 'auto' | 'on' | 'off';

/** 任务的板块显示设置（未配置的类型按 auto 处理） */
export type TaskSectionDisplayMap = Partial<Record<SectionType, SectionDisplayMode>>;

/** 板块公共字段 */
export interface TaskSectionCommon {
    /** 板块实例 id */
    id: string;
    /** 是否折叠（仅影响展示） */
    collapsed?: boolean;
    /** 创建时间戳 */
    createdAt: number;
    /** 最近更新时间戳 */
    updatedAt?: number;
}

/** 板块：按 type 可辨识的联合类型 */
export type TaskSection = {
    [K in SectionType]: TaskSectionCommon & {
        type: K;
        payload: TaskSectionPayloadMap[K];
    };
}[SectionType];

/** 指定类型的板块 */
export type TaskSectionOf<K extends SectionType> = Extract<TaskSection, { type: K }>;

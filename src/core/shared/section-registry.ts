// 任务板块注册表：每种板块的类型元信息与载荷解析规则。
// 渲染函数在后续阶段补充，本阶段只提供类型 / 名称 / 图标 / 是否单例 / 空判定 / 载荷解析。

import type { ChecklistItem } from '../datatypes/domain';
import type { TaskDayGoalEntry, TaskGoalEntry, TaskHabit } from '../datatypes/prototype-task';
import type { SectionType, TaskSectionPayloadMap } from '../datatypes/task-section';

/** 板块定义 */
export interface SectionDefinition {
    /** 板块类型 */
    type: SectionType;
    /** 名称 i18n key */
    labelKey: string;
    /** 图标（lucide 名称） */
    icon: string;
    /** 是否单例（同一任务只能有一个） */
    singleton: boolean;
    /** 载荷是否为空（空板块在界面中折叠展示） */
    isEmpty: (payload: unknown) => boolean;
    /** 解析持久化载荷（结构非法时返回 null；空载荷同样返回对象，由 isEmpty 判定） */
    parsePayload: (raw: unknown) => unknown | null;
}

/** 解析任务清单条目 */
function parseChecklistPayload(raw: unknown): TaskSectionPayloadMap['checklist'] | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const listRaw = (raw as Record<string, unknown>).items;
    if (!Array.isArray(listRaw)) return null;
    const items: ChecklistItem[] = [];
    for (const entry of listRaw) {
        if (!entry || typeof entry !== 'object') continue;
        const r = entry as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.text !== 'string') continue;
        items.push({
            id: r.id,
            text: r.text,
            ...(r.done === true ? { done: true } : {}),
            ...(typeof r.completedAt === 'number' ? { completedAt: r.completedAt } : {}),
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
            ...(typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? { dueDate: r.dueDate } : {}),
        });
    }
    return { items };
}

/** 解析描述板块载荷：本周描述 + 日描述 + 日预估时长 */
function parseDescriptionPayload(raw: unknown): TaskSectionPayloadMap['description'] | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!('notes' in record) && !('entries' in record)) return null;

    const notes: Record<string, string> = {};
    if (record.notes && typeof record.notes === 'object' && !Array.isArray(record.notes)) {
        for (const [weekKey, value] of Object.entries(record.notes as Record<string, unknown>)) {
            if (!/^\d{4}-W\d{2}$/.test(weekKey) || typeof value !== 'string') continue;
            const trimmed = value.trim();
            if (trimmed) notes[weekKey] = trimmed;
        }
    }

    const entries: Record<string, TaskDayGoalEntry[]> = {};
    if (record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)) {
        for (const [dayKey, value] of Object.entries(record.entries as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !Array.isArray(value)) continue;
            const list: TaskDayGoalEntry[] = [];
            for (const entry of value) {
                if (!entry || typeof entry !== 'object') continue;
                const r = entry as Record<string, unknown>;
                if (typeof r.id !== 'string' || typeof r.text !== 'string') continue;
                list.push({
                    id: r.id,
                    text: r.text,
                    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
                    ...(r.done === true ? { done: true } : {}),
                });
            }
            if (list.length > 0) entries[dayKey] = list;
        }
    }

    const estimates: Record<string, number> = {};
    if (record.estimates && typeof record.estimates === 'object' && !Array.isArray(record.estimates)) {
        for (const [dayKey, value] of Object.entries(record.estimates as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
            estimates[dayKey] = Math.round(value);
        }
    }

    return Object.keys(estimates).length > 0 ? { notes, entries, estimates } : { notes, entries };
}

/** 解析目标清单 */
function parseGoalsPayload(raw: unknown): TaskSectionPayloadMap['goals'] | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const listRaw = record.items;
    if (!Array.isArray(listRaw)) return null;
    const items: TaskGoalEntry[] = [];
    for (const entry of listRaw) {
        if (!entry || typeof entry !== 'object') continue;
        const r = entry as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.text !== 'string') continue;
        const subtaskIds = Array.isArray(r.subtaskIds)
            ? r.subtaskIds.filter((id): id is string => typeof id === 'string' && !!id)
            : [];
        items.push({
            id: r.id,
            text: r.text,
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
            ...(typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? { dueDate: r.dueDate } : {}),
            ...(subtaskIds.length > 0 ? { subtaskIds } : {}),
            ...(r.done === true ? { done: true } : {}),
            ...(typeof r.startWeek === 'string' && /^\d{4}-W\d{2}$/.test(r.startWeek) ? { startWeek: r.startWeek } : {}),
            ...(typeof r.endWeek === 'string' && /^\d{4}-W\d{2}$/.test(r.endWeek) ? { endWeek: r.endWeek } : {}),
        });
    }
    return {
        items,
        ...(record.enabled === false ? { enabled: false } : record.enabled === true ? { enabled: true } : {}),
        ...(typeof record.deadlineWeek === 'string' && /^\d{4}-W\d{2}$/.test(record.deadlineWeek)
            ? { deadlineWeek: record.deadlineWeek }
            : {}),
        ...(typeof record.deadlineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.deadlineDate)
            ? { deadlineDate: record.deadlineDate }
            : {}),
    };
}

/** 解析任务文件配置（无有效配置时返回空载荷，交由 isEmpty 判定） */
function parseFilesPayload(raw: unknown): TaskSectionPayloadMap['files'] | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    return {
        ...(typeof r.fileDir === 'string' && r.fileDir ? { fileDir: r.fileDir } : {}),
        ...(r.fileTimestamp === true ? { fileTimestamp: true } : {}),
    };
}

/** 解析习惯设置（非法数据返回 null） */
function parseHabitPayload(raw: unknown): TaskHabit | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled !== 'boolean') return null;
    const time = typeof r.time === 'string' && /^\d{2}:\d{2}$/.test(r.time) ? r.time : '09:00';
    const weekdays = Array.isArray(r.weekdays)
        ? r.weekdays.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7)
        : [];
    return {
        enabled: r.enabled,
        time,
        weekdays,
        allDay: r.allDay === true,
        duration: typeof r.duration === 'number' && r.duration >= 0 ? Math.round(r.duration) : undefined,
    };
}

/** 板块注册表（顺序即界面中未创建板块的平铺顺序） */
export const SECTION_REGISTRY: Record<SectionType, SectionDefinition> = {
    checklist: {
        type: 'checklist',
        labelKey: 'panel.targetChecklist',
        icon: 'list-checks',
        singleton: true,
        isEmpty: (payload) => !payload || (payload as TaskSectionPayloadMap['checklist']).items.length === 0,
        parsePayload: (raw) => parseChecklistPayload(raw),
    },
    description: {
        type: 'description',
        labelKey: 'panel.sectionDescription',
        icon: 'file-text',
        singleton: true,
        isEmpty: (payload) => {
            const data = payload as TaskSectionPayloadMap['description'] | undefined;
            if (!data) return true;
            return Object.keys(data.notes).length === 0
                && Object.keys(data.entries).length === 0
                && Object.keys(data.estimates ?? {}).length === 0;
        },
        parsePayload: (raw) => parseDescriptionPayload(raw),
    },
    goals: {
        type: 'goals',
        labelKey: 'panel.planAnnualGoal',
        icon: 'target',
        singleton: true,
        isEmpty: (payload) => !payload || (payload as TaskSectionPayloadMap['goals']).items.length === 0,
        parsePayload: (raw) => parseGoalsPayload(raw),
    },
    files: {
        type: 'files',
        labelKey: 'panel.targetFile',
        icon: 'folder',
        singleton: true,
        isEmpty: (payload) => !payload || !(payload as TaskSectionPayloadMap['files']).fileDir,
        parsePayload: (raw) => parseFilesPayload(raw),
    },
    habit: {
        type: 'habit',
        labelKey: 'interface.habit',
        icon: 'repeat',
        singleton: true,
        isEmpty: (payload) => !payload || !(payload as TaskHabit).enabled,
        parsePayload: (raw) => parseHabitPayload(raw),
    },
};

// 基础数据仓库：持有插件全量数据，作为唯一数据源与唯一持久化出口。
// 各领域 repo（gtd / pdca / workbench）通过 get data() 拿到数据对象引用，
// 视图读引用、写走领域 repo 方法，底层仍是同一个对象引用，保证跨视图同步不破坏。
import type { Plugin } from 'obsidian';

import type { PlanSchemeData } from '../shared/plan-data';
import { ensureDefaultScheme } from '../shared/plan-data';
import type { PlanCategoryData } from '../shared/plan-category-manager';
import { ensureUncategorizedCategory } from '../shared/plan-category-manager';
import type { DayTemplateData, EventBlock, ExecutionRecord, InboxData, RunningTask, OkrRecordEntry } from '../datatypes/domain';
import { DEFAULT_INBOX_DATA } from '../datatypes/domain';
import type { WorkbenchData } from '../datatypes/card';
import { defaultWorkbenchData } from '../datatypes/card';
import type { GtdData } from '../datatypes/gtd';
import { defaultGtdData } from '../datatypes/gtd';
import type { PlanAssignmentData } from '../datatypes/plan-assignment';
import type { InterfaceLayoutData } from '../datatypes/interface-layout';
import type { PrototypeTask } from '../datatypes/prototype-task';
import type { TaskExecutionData } from '../datatypes/task-execution';
import type { TimeBoxData } from '../datatypes/timebox-data';
import type { ThemeData, Theme } from '../datatypes/theme';
import { DEFAULT_THEME_ID } from '../datatypes/theme';
import { parseSectionDisplay, parseTaskSections } from '../shared/task-sections';
import { log } from '../shared/logger';
import { t } from '../i18n';

/** 插件持有的全量数据（唯一数据源） */
export interface PluginData {
    templateData: DayTemplateData;
    categoryData: PlanCategoryData;
    events: EventBlock[];
    executions: ExecutionRecord[];
    inboxData: InboxData;
    schemeData: PlanSchemeData;
    /** 已标记为「已制定周计划」的周键列表（如 ["2026-W41"]） */
    plannedWeeks: string[];
    /** 工作台卡片数据 */
    workbench: WorkbenchData;
    /** GTD 数据（收集箱等） */
    gtdData: GtdData;
    /** 原型任务（界面视图任务面板新建的主线 / 支线任务） */
    prototypeTasks: PrototypeTask[];
    /** 时间盒数据（界面视图时间盒面板的格子涂色） */
    timeBoxData: TimeBoxData;
    /** 计划排布数据（界面视图计划一周面板的任务到天列排布） */
    planAssignmentData: PlanAssignmentData;
    /** 界面视图卡片布局（编辑模式下被移除的卡片） */
    interfaceLayoutData: InterfaceLayoutData;
    /** 任务执行记录（界面视图「今天任务」计时产生） */
    taskExecutionData: TaskExecutionData;
    /** 界面主题数据（官方 / 本地主题列表） */
    themeData: ThemeData;
    /** OKR 记录卡片的填写结果（顶层独立存储，不挂在任务上，避免任务对象膨胀） */
    recordEntries: OkrRecordEntry[];
    /** 当前进行中的任务（界面视图「今天任务」计时，随主数据一起持久化） */
    runningTask?: RunningTask;
}

/**
 * 基础数据仓库：持有全量数据 + 唯一保存出口 + 加载/迁移/清空逻辑。
 * 从 main.ts 迁入，不新增业务逻辑，仅做职责归位。
 */
export class BaseRepo {
    private plugin: Plugin;

    /** 插件持有的唯一数据源（视图重建时从这里读取最新数据） */
    data: PluginData | null = null;

    /** 是否已勾选「不再提示」帮助弹窗（随主数据一起持久化） */
    helpDismissed = false;

    /** 是否启用剧本模式（随主数据一起持久化，默认关闭） */
    scriptModeEnabled = false;

    /** 任务库根目录（vault 相对路径，空表示未绑定，随主数据一起持久化） */
    taskLibraryRoot = '';

    /** 计划一周面板是否展开显示所有任务的本周描述（随主数据一起持久化，默认关闭） */
    planWeekNotesExpanded = false;

    /** 本地剧本目录类型：vault 目录（vault 相对路径）/ 本地目录（绝对路径） */
    storyLocalDirMode: 'vault' | 'local' = 'vault';

    /** 本地剧本目录路径（空表示未配置） */
    storyLocalDirPath = '';

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * 唯一的数据保存出口：把插件持有的全部数据一次性写回。
     * 所有视图与设置项都通过此方法保存，避免「全量覆盖」与「合并写回」两套逻辑并存
     * 导致字段互相覆盖。
     */
    async saveAll(): Promise<void> {
        const d = this.data;
        if (!d) return;
        await this.plugin.saveData({
            version: 1,
            dayTemplateData: d.templateData,
            timeBlockCategoryData: d.categoryData,
            schemeData: d.schemeData,
            events: d.events,
            executions: d.executions,
            inboxData: d.inboxData,
            plannedWeeks: d.plannedWeeks,
            workbench: d.workbench,
            gtdData: d.gtdData,
            prototypeTasks: d.prototypeTasks,
            timeBoxData: d.timeBoxData,
            planAssignmentData: d.planAssignmentData,
            interfaceLayoutData: d.interfaceLayoutData,
            taskExecutionData: d.taskExecutionData,
            themeData: d.themeData,
            recordEntries: d.recordEntries,
            runningTask: d.runningTask,
            helpDismissed: this.helpDismissed,
            scriptModeEnabled: this.scriptModeEnabled,
            taskLibraryRoot: this.taskLibraryRoot,
            planWeekNotesExpanded: this.planWeekNotesExpanded,
            storyLocalDirMode: this.storyLocalDirMode,
            storyLocalDirPath: this.storyLocalDirPath,
        });
    }

    /** 保存「不再提示」帮助弹窗标记 */
    async saveHelpDismissed(dismissed: boolean): Promise<void> {
        this.helpDismissed = dismissed;
        await this.saveAll();
    }

    /** 保存是否启用剧本模式 */
    async saveScriptModeEnabled(enabled: boolean): Promise<void> {
        this.scriptModeEnabled = enabled;
        await this.saveAll();
    }

    /** 保存任务库根目录 */
    async saveTaskLibraryRoot(path: string): Promise<void> {
        this.taskLibraryRoot = path;
        await this.saveAll();
    }

    /** 保存本地剧本目录配置（类型 + 路径） */
    async saveStoryLocalDir(mode: 'vault' | 'local', path: string): Promise<void> {
        this.storyLocalDirMode = mode;
        this.storyLocalDirPath = path;
        await this.saveAll();
    }

    /** 保存计划一周面板「展开显示所有任务的本周描述」开关 */
    async savePlanWeekNotesExpanded(enabled: boolean): Promise<void> {
        this.planWeekNotesExpanded = enabled;
        await this.saveAll();
    }

    /**
     * 加载数据：读取 + 解析，最终写入 this.data。
     * 从 main.ts 的 onload 迁入。
     */
    async load(): Promise<void> {
        const rawData: unknown = await this.plugin.loadData();
        let savedData: Record<string, unknown> =
            rawData && typeof rawData === 'object' ? rawData as Record<string, unknown> : {};

        // 读取「不再提示」帮助弹窗标记（兼容旧数据：默认未勾选）
        this.helpDismissed = typeof savedData.helpDismissed === 'boolean'
            ? savedData.helpDismissed
            : false;

        // 读取是否启用剧本模式（兼容旧数据：默认关闭）
        this.scriptModeEnabled = typeof savedData.scriptModeEnabled === 'boolean'
            ? savedData.scriptModeEnabled
            : false;

        // 读取任务库根目录（兼容旧数据：默认未绑定）
        this.taskLibraryRoot = typeof savedData.taskLibraryRoot === 'string'
            ? savedData.taskLibraryRoot
            : '';

        // 读取计划一周面板「展开显示所有任务的本周描述」开关（兼容旧数据：默认关闭）
        this.planWeekNotesExpanded = typeof savedData.planWeekNotesExpanded === 'boolean'
            ? savedData.planWeekNotesExpanded
            : false;

        // 读取本地剧本目录配置（兼容旧数据：默认 vault 目录、未配置）
        this.storyLocalDirMode = savedData.storyLocalDirMode === 'local' ? 'local' : 'vault';
        this.storyLocalDirPath = typeof savedData.storyLocalDirPath === 'string'
            ? savedData.storyLocalDirPath
            : '';

        const defaultCategories: PlanCategoryData = {
            categories: [
                { id: 'uncategorized', label: t('defaultCategory.uncategorized'), color: '#888888' },
                { id: 'work', label: t('defaultCategory.work'), color: '#4c8dff' },
                { id: 'rest', label: t('defaultCategory.rest'), color: '#43b581' },
                { id: 'play', label: t('defaultCategory.play'), color: '#f2a65a' },
            ],
        };

        if (savedData.version !== 1) {
            savedData = {
                version: 1,
                dayTemplateData: { dayTemplates: [], dayProperties: [] },
                timeBlockCategoryData: defaultCategories,
                inboxData: DEFAULT_INBOX_DATA,
                schemeData: { schemes: [] },
                events: [],
                executions: [],
            };
        }

        const initialTemplateData = (savedData.dayTemplateData ?? { dayTemplates: [], dayProperties: [] }) as DayTemplateData;
        const initialCategoryData = (savedData.timeBlockCategoryData ?? defaultCategories) as PlanCategoryData;
        // 兼容旧数据：确保「未分类」始终存在且位于首位
        ensureUncategorizedCategory(initialCategoryData);
        const initialInboxData = (savedData.inboxData ?? DEFAULT_INBOX_DATA) as InboxData;
        // 兼容旧数据：确保关注任务列表字段始终存在
        if (!Array.isArray(initialInboxData.focusTaskIds)) initialInboxData.focusTaskIds = [];
        const initialPlanSchemeData = (savedData.schemeData ?? { schemes: [] }) as PlanSchemeData;
        // 兼容旧数据：确保默认方案始终存在且位于首位
        ensureDefaultScheme(initialPlanSchemeData, t('planScheme.defaultName'));
        // 已制定周计划的周键列表（兼容旧数据：默认空数组）
        const initialPlannedWeeks = Array.isArray(savedData.plannedWeeks)
            ? savedData.plannedWeeks as string[]
            : [];
        // 工作台卡片数据（兼容旧数据：默认空）
        const initialWorkbench = (savedData.workbench && typeof savedData.workbench === 'object')
            ? savedData.workbench as WorkbenchData
            : defaultWorkbenchData();
        // GTD 数据（兼容旧数据：默认空）
        const initialGtdData = (savedData.gtdData && typeof savedData.gtdData === 'object')
            ? savedData.gtdData as GtdData
            : defaultGtdData();
        // 兼容旧数据：确保 items / sources 字段存在
        if (!Array.isArray(initialGtdData.items)) initialGtdData.items = [];
        if (!Array.isArray(initialGtdData.sources)) initialGtdData.sources = [];
        // 原型任务（兼容旧数据：默认空数组）
        const initialPrototypeTasks = parsePrototypeTasks(savedData.prototypeTasks);
        // 时间盒数据（兼容旧数据：默认空）
        const initialTimeBoxData = parseTimeBoxData(savedData.timeBoxData);
        // 计划排布数据（兼容旧数据：默认空）
        const initialPlanAssignmentData = parsePlanAssignmentData(savedData.planAssignmentData);
        // 界面视图卡片布局（兼容旧数据：默认全部显示）
        const initialInterfaceLayoutData = parseInterfaceLayoutData(savedData.interfaceLayoutData);
        // 任务执行记录（兼容旧数据：默认空）
        const initialTaskExecutionData = parseTaskExecutionData(savedData.taskExecutionData);
        // 界面主题数据（兼容旧数据：默认空列表）
        const initialThemeData = parseThemeData(savedData.themeData);
        // OKR 记录卡片填写结果（顶层独立存储，兼容旧数据：默认空）
        const initialOkrEntries = Array.isArray(savedData.recordEntries)
            ? savedData.recordEntries as PluginData['recordEntries']
            : [];
        // 当前进行中的任务（兼容旧数据：默认无）
        const initialRunningTask = parseRunningTask(savedData.runningTask);

        // 存入仓库实例，作为唯一数据源（视图重建时从这里读取最新数据）
        this.data = {
            templateData: initialTemplateData,
            categoryData: initialCategoryData,
            events: (savedData.events ?? []) as EventBlock[],
            executions: (savedData.executions ?? []) as ExecutionRecord[],
            inboxData: initialInboxData,
            schemeData: initialPlanSchemeData,
            plannedWeeks: initialPlannedWeeks,
            workbench: initialWorkbench,
            gtdData: initialGtdData,
            prototypeTasks: initialPrototypeTasks,
            timeBoxData: initialTimeBoxData,
            planAssignmentData: initialPlanAssignmentData,
            interfaceLayoutData: initialInterfaceLayoutData,
            taskExecutionData: initialTaskExecutionData,
            themeData: initialThemeData,
            recordEntries: initialOkrEntries,
            runningTask: initialRunningTask,
        };

        // 持久化自检：记录加载到的板块条目数，便于排查重启后数据丢失
        log('持久化自检', countSectionStats(initialPrototypeTasks));
    }

    /** 清空全部插件数据并重置为默认值 */
    async clearAll(): Promise<void> {
        await this.plugin.saveData({});
    }
}

/** 统计板块条目数（排查板块内容持久化问题用） */
function countSectionStats(tasks: PrototypeTask[]): { tasks: number; checklist: number } {
    let checklist = 0;
    for (const task of tasks) {
        for (const section of task.sections ?? []) {
            if (section.type === 'checklist') {
                checklist += section.payload.items.length;
            }
        }
    }
    return { tasks: tasks.length, checklist };
}

/** 解析持久化的原型任务（非法数据：返回空数组） */
function parsePrototypeTasks(raw: unknown): PrototypeTask[] {
    if (!Array.isArray(raw)) return [];
    const tasks: PrototypeTask[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
        const type = r.type === 'side' ? 'side' : 'main';
        // 板块：只读新结构
        const sections = parseTaskSections(r.sections);
        const sectionDisplay = parseSectionDisplay(r.sectionDisplay);
        tasks.push({
            id: r.id,
            name: r.name,
            type,
            ...(typeof r.parentId === 'string' ? { parentId: r.parentId } : {}),
            ...(typeof r.description === 'string' ? { description: r.description } : {}),
            ...(typeof r.categoryId === 'string' ? { categoryId: r.categoryId } : {}),
            ...(typeof r.estimatedMinutes === 'number' && Number.isFinite(r.estimatedMinutes)
                ? { estimatedMinutes: Math.max(0, Math.round(r.estimatedMinutes)) }
                : {}),
            ...(r.status === 'notStarted' || r.status === 'inProgress' || r.status === 'done' || r.status === 'paused'
                ? { status: r.status }
                : {}),
            ...(sections ? { sections } : {}),
            ...(sectionDisplay ? { sectionDisplay } : {}),
            ...(r.archived === true ? { archived: true } : {}),
            ...(r.kind === 'task' || r.kind === 'habit' || r.kind === 'goal' ? { kind: r.kind } : {}),
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
        });
    }
    return tasks;
}

/** 解析持久化的时间盒数据（兼容旧数据 / 非法数据：返回空） */
function parseTimeBoxData(raw: unknown): TimeBoxData {
    const cells: TimeBoxData['cells'] = [];
    if (!raw || typeof raw !== 'object') return { cells };
    const rawCells = (raw as { cells?: unknown }).cells;
    if (!Array.isArray(rawCells)) return { cells };
    for (const item of rawCells) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (typeof r.weekKey !== 'string' || typeof r.categoryId !== 'string') continue;
        const weekday = typeof r.weekday === 'number' ? r.weekday : 0;
        const hour = typeof r.hour === 'number' ? r.hour : -1;
        if (weekday < 1 || weekday > 7 || hour < 0 || hour > 23) continue;
        cells.push({ weekKey: r.weekKey, weekday, hour, categoryId: r.categoryId });
    }
    return { cells };
}

/** 解析持久化的计划排布数据（兼容旧数据 / 非法数据：返回空） */
function parsePlanAssignmentData(raw: unknown): PlanAssignmentData {
    const assignments: PlanAssignmentData['assignments'] = [];
    const weekAssignments: PlanAssignmentData['weekAssignments'] = [];
    if (!raw || typeof raw !== 'object') return { assignments, weekAssignments };
    const rawAssignments = (raw as { assignments?: unknown }).assignments;
    if (!Array.isArray(rawAssignments)) return { assignments, weekAssignments };
    for (const item of rawAssignments) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (typeof r.weekKey !== 'string' || typeof r.taskId !== 'string') continue;
        const weekday = typeof r.weekday === 'number' ? r.weekday : 0;
        if (weekday < 1 || weekday > 7) continue;
        assignments.push({
            weekKey: r.weekKey,
            weekday,
            taskId: r.taskId,
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
        });
    }
    const rawWeekAssignments = (raw as { weekAssignments?: unknown }).weekAssignments;
    if (Array.isArray(rawWeekAssignments)) {
        for (const item of rawWeekAssignments) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            if (typeof r.weekKey !== 'string' || typeof r.taskId !== 'string') continue;
            weekAssignments.push({
                weekKey: r.weekKey,
                taskId: r.taskId,
                createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
            });
        }
    }
    return { assignments, weekAssignments };
}

/** 解析界面视图卡片布局（兼容旧数据 / 非法数据：默认全部显示、无保存位置） */
function parseInterfaceLayoutData(raw: unknown): InterfaceLayoutData {
    const hiddenCards: string[] = [];
    const cardPositions: InterfaceLayoutData['cardPositions'] = {};
    const addedCards: string[] = [];
    if (!raw || typeof raw !== 'object') return { hiddenCards, cardPositions, addedCards };
    const rawHidden = (raw as { hiddenCards?: unknown }).hiddenCards;
    if (Array.isArray(rawHidden)) {
        for (const id of rawHidden) {
            if (typeof id === 'string' && !hiddenCards.includes(id)) hiddenCards.push(id);
        }
    }
    const rawAdded = (raw as { addedCards?: unknown }).addedCards;
    if (Array.isArray(rawAdded)) {
        for (const id of rawAdded) {
            if (typeof id === 'string' && !addedCards.includes(id)) addedCards.push(id);
        }
    }
    const rawPositions = (raw as { cardPositions?: unknown }).cardPositions;
    if (rawPositions && typeof rawPositions === 'object') {
        for (const [id, value] of Object.entries(rawPositions)) {
            if (!value || typeof value !== 'object') continue;
            const position = value as Record<string, unknown>;
            if (typeof position.left !== 'number' || typeof position.top !== 'number') continue;
            cardPositions[id] = { left: position.left, top: position.top };
        }
    }
    return { hiddenCards, cardPositions, addedCards };
}

/** 解析持久化的任务执行记录（兼容旧数据 / 非法数据：返回空） */
function parseTaskExecutionData(raw: unknown): TaskExecutionData {
    const records: TaskExecutionData['records'] = [];
    const extraTasksByDay: TaskExecutionData['extraTasksByDay'] = {};
    const completedTasksByDay: TaskExecutionData['completedTasksByDay'] = {};
    const skippedHabitsByDay: TaskExecutionData['skippedHabitsByDay'] = {};
    if (!raw || typeof raw !== 'object') return { records, extraTasksByDay, completedTasksByDay, skippedHabitsByDay };
    const rawRecords = (raw as { records?: unknown }).records;
    if (!Array.isArray(rawRecords)) return { records, extraTasksByDay, completedTasksByDay, skippedHabitsByDay };
    for (const item of rawRecords) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.taskId !== 'string') continue;
        if (typeof r.startAt !== 'number' || typeof r.endAt !== 'number') continue;
        if (typeof r.durationSeconds !== 'number') continue;
        records.push({
            id: r.id,
            taskId: r.taskId,
            startAt: r.startAt,
            endAt: r.endAt,
            durationSeconds: r.durationSeconds,
        });
    }
    // 当日额外任务（兼容旧数据：默认空）
    const rawExtra = (raw as { extraTasksByDay?: unknown }).extraTasksByDay;
    if (rawExtra && typeof rawExtra === 'object') {
        for (const [dayKey, ids] of Object.entries(rawExtra as Record<string, unknown>)) {
            if (!Array.isArray(ids)) continue;
            const validIds = ids.filter((id): id is string => typeof id === 'string');
            if (validIds.length > 0) extraTasksByDay[dayKey] = validIds;
        }
    }
    // 当日已完成任务（兼容旧数据：默认空）
    const rawCompleted = (raw as { completedTasksByDay?: unknown }).completedTasksByDay;
    if (rawCompleted && typeof rawCompleted === 'object') {
        for (const [dayKey, ids] of Object.entries(rawCompleted as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !Array.isArray(ids)) continue;
            const validIds = ids.filter((id): id is string => typeof id === 'string');
            if (validIds.length > 0) completedTasksByDay[dayKey] = validIds;
        }
    }
    // 当日跳过习惯（兼容旧数据：默认空）
    const rawSkippedHabits = (raw as { skippedHabitsByDay?: unknown }).skippedHabitsByDay;
    if (rawSkippedHabits && typeof rawSkippedHabits === 'object') {
        for (const [dayKey, ids] of Object.entries(rawSkippedHabits as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !Array.isArray(ids)) continue;
            const validIds = ids.filter((id): id is string => typeof id === 'string');
            if (validIds.length > 0) skippedHabitsByDay[dayKey] = validIds;
        }
    }
    return { records, extraTasksByDay, completedTasksByDay, skippedHabitsByDay };
}

/** 解析持久化的进行中任务（兼容旧数据 / 非法数据：返回 undefined） */
function parseRunningTask(raw: unknown): RunningTask | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    if (typeof r.inboxId !== 'string' || typeof r.start !== 'number' || typeof r.dayKey !== 'string') {
        return undefined;
    }
    const task: RunningTask = { inboxId: r.inboxId, start: r.start, dayKey: r.dayKey };
    // 计时来源（界面视图写入 prototype；省略时按收集盒任务处理）
    if (r.source === 'prototype' || r.source === 'inbox') task.source = r.source;
    // 实际开始时刻（Unix 毫秒时间戳，用于精确计算已用时长；旧数据无此字段）
    if (typeof r.startedAt === 'number') task.startedAt = r.startedAt;
    // 兼容旧数据：end 为可选字段
    if (typeof r.end === 'number') task.end = r.end;
    // 兼容旧数据：endDayOffset 为可选字段（跨天记录）
    if (typeof r.endDayOffset === 'number') task.endDayOffset = r.endDayOffset;
    return task;
}

/** 解析持久化的界面主题数据（兼容旧数据 / 非法数据：返回默认主题 + 空列表） */
function parseThemeData(raw: unknown): ThemeData {
    const officialThemes: ThemeData['officialThemes'] = [];
    const localThemes: ThemeData['localThemes'] = [];
    const currentThemeId = raw && typeof raw === 'object'
        && typeof (raw as { currentThemeId?: unknown }).currentThemeId === 'string'
        ? (raw as { currentThemeId: string }).currentThemeId
        : DEFAULT_THEME_ID;
    if (!raw || typeof raw !== 'object') return { currentThemeId, officialThemes, localThemes };
    const rawOfficial = (raw as { officialThemes?: unknown }).officialThemes;
    if (Array.isArray(rawOfficial)) {
        for (const item of rawOfficial) {
            const theme = parseTheme(item);
            if (theme) officialThemes.push(theme);
        }
    }
    const rawLocal = (raw as { localThemes?: unknown }).localThemes;
    if (Array.isArray(rawLocal)) {
        for (const item of rawLocal) {
            const theme = parseTheme(item);
            if (theme) localThemes.push(theme);
        }
    }
    return { currentThemeId, officialThemes, localThemes };
}

/** 解析单个主题（非法数据返回 null） */
function parseTheme(raw: unknown): Theme | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
    const source = r.source === 'local' ? 'local' : 'official';
    return { id: r.id, name: r.name, source };
}

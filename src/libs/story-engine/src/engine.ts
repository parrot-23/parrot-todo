/**
 * 加载解释器 —— 按序播放骨架包
 *
 * 职责：
 *  - 加载骨架包（校验 + 建立索引）
 *  - 按 幕→章→场景→步骤 顺序播放
 *  - 维护 flags（用于多结局汇合 + 条件分支）
 *  - 维护任务槽位（task 步骤写入，供任务剧情使用）
 *  - 处理 choices（结局定义器）的选项跳转 / 卡关重来
 *
 * 本文件是纯逻辑引擎，不依赖 DOM / 渲染层。
 * 渲染层通过 subscribe() 监听事件流，自行决定如何呈现。
 */

import type {
  Skeleton,
  Step,
  Choice,
  Node,
} from "./types.ts";

/* ------------------------- 运行时状态 ------------------------- */

export interface TaskSlot {
  taskId: string;
  description?: string;
  status: "active" | "completed" | "failed";
  setAtScene: string;
}

export interface EngineState {
  /** 当前场景 id */
  sceneId: string;
  /** 当前场景内步骤游标 */
  stepIndex: number;
  /** 玩家走过的 flag 记录 */
  flags: Record<string, unknown>;
  /** 当前任务槽位（任务槽位提供器） */
  task: TaskSlot | null;
  /** 是否已结束（到达结局） */
  finished: boolean;
  /** 播放历史（用于回溯 / 调试） */
  history: string[];
  /** 当前场景剩余待播的步骤 id 队列（分步播放用） */
  pendingStepIds: string[];
  /** 是否已呈现当前场景的选项（分步播放时避免重复呈现） */
  choicesPresented: boolean;
}

/** 引擎对外事件（渲染层订阅） */
export type EngineEvent =
  | { type: "scene:enter"; sceneId: string; title: string }
  | { type: "step"; step: Step; sceneId: string; stepIndex: number }
  | { type: "choice:present"; choices: Choice[] }
  | { type: "task:set"; task: TaskSlot }
  | { type: "end"; reason: "no_more_steps" | "no_choices" | "explicit" };

type Listener = (e: EngineEvent) => void;

/* ------------------------- 条件表达式求值 ------------------------- */

/**
 * 极简条件表达式求值器。
 * 支持：`flag('x')` 读取 flag，比较运算 ===, !==, >=, <=, >, <，以及 true/false 字面量。
 * 示例：flag('通过') === true  |  flag('好感度') >= 5
 * 出于安全，不使用 eval，仅做受控解析。
 */
export function evalCondition(expr: string, flags: Record<string, unknown>): boolean {
  const trimmed = expr.trim();
  // 直接布尔
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // 匹配  flag('key')  op  value
  const m = trimmed.match(/^flag\(\s*['"]([^'"]+)['"]\s*\)\s*(===|!==|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    throw new Error(`无法解析条件表达式: "${expr}"`);
  }
  const [, key, op, rawValue] = m;
  const actual = flags[key];
  // 解析右侧值
  let expected: unknown = rawValue.trim();
  if (expected === "true") expected = true;
  else if (expected === "false") expected = false;
  else if (/^-?\d+(\.\d+)?$/.test(expected as string)) expected = Number(expected);
  else expected = (expected as string).replace(/^['"]|['"]$/g, "");

  switch (op) {
    case "===": return actual === expected;
    case "!==": return actual !== expected;
    case ">": return (actual as number) > (expected as number);
    case "<": return (actual as number) < (expected as number);
    case ">=": return (actual as number) >= (expected as number);
    case "<=": return (actual as number) <= (expected as number);
  }
  return false;
}

/* ------------------------- 引擎 ------------------------- */

export class StoryEngine {
  private skeleton: Skeleton;
  /** 场景 id → 该场景的步骤 id 顺序列表（预解析，加速播放） */
  private sceneSteps: Map<string, string[]> = new Map();
  private listeners = new Set<Listener>();

  state: EngineState;

  constructor(skeleton: Skeleton) {
    this.skeleton = skeleton;
    this.state = {
      sceneId: "",
      stepIndex: 0,
      flags: {},
      task: null,
      finished: false,
      history: [],
      pendingStepIds: [],
      choicesPresented: false,
    };
    this.indexScenes();
  }

  /** 校验 + 建立场景→步骤索引 */
  private indexScenes() {
    const { nodes, steps } = this.skeleton;
    for (const node of Object.values(nodes)) {
      if (node.type !== "scene") continue;
      const ids = node.children;
      // 校验步骤引用存在
      for (const sid of ids) {
        if (!steps[sid]) {
          throw new Error(`场景 "${node.id}" 引用了不存在的步骤 "${sid}"`);
        }
      }
      this.sceneSteps.set(node.id, ids);
    }
    if (!this.skeleton.nodes[this.skeleton.entry]) {
      throw new Error(`入口场景 "${this.skeleton.entry}" 不存在`);
    }
  }

  /** 订阅事件 */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent) {
    for (const fn of this.listeners) fn(e);
  }

  /** 启动：进入入口场景 */
  start() {
    this.enterScene(this.skeleton.entry);
  }

  /** 解析场景引用：优先精确 id，回退到按标题匹配 */
  private resolveSceneId(ref: string): string | null {
    const { nodes } = this.skeleton;
    if (nodes[ref]) return ref;
    for (const n of Object.values(nodes)) {
      if (n.type === "scene" && (n.title === ref || n.title.includes(ref) || ref.includes(n.title))) {
        return n.id;
      }
    }
    return null;
  }

  /** 进入指定场景。
   * @param sceneId 场景 id 或标题
   * @param startStepIndex 从该场景第几个步骤开始（编辑器"点击某步骤"跳转）
   * @param autoPlay true = 同步一次性播完该场景（默认，兼容旧行为）；false = 仅进入场景，
   *                 由调用方通过 nextStep() 逐步推进（顺序播放用）
   */
  enterScene(sceneId: string, startStepIndex = 0, autoPlay = true) {
    const resolved = this.resolveSceneId(sceneId);
    if (!resolved) {
      throw new Error(`场景 "${sceneId}" 不存在或不是 scene`);
    }
    const node = this.skeleton.nodes[resolved];
    if (!node || node.type !== "scene") {
      throw new Error(`场景 "${sceneId}" 不存在或不是 scene`);
    }
    this.state.sceneId = resolved;
    this.state.stepIndex = startStepIndex;
    this.state.history.push(resolved);
    this.state.choicesPresented = false;
    // 待播步骤队列（从 startStepIndex 开始）
    this.state.pendingStepIds = (this.sceneSteps.get(resolved) ?? []).slice(startStepIndex);
    this.emit({ type: "scene:enter", sceneId: resolved, title: node.title });

    if (!autoPlay) return;

    // 顺序一次性播放该场景所有步骤
    while (this.nextStep() === "step") {
      // 继续，直到本场景播完（返回 choices/end）
    }
  }

  /**
   * 播放下一步（分步播放核心）。
   * @returns "step" = 已播一步、可能还有后续；"choices" = 本场景步骤播完、已呈现选项；
   *          "end" = 已结束；"none" = 无更多可播（已结束或已呈现选项）
   */
  nextStep(): "step" | "choices" | "end" | "none" {
    if (this.state.finished) return "none";

    // 当前场景没有剩余步骤 → 呈现选项（若尚未呈现）
    if (this.state.pendingStepIds.length === 0) {
      if (!this.state.choicesPresented) {
        this.presentChoices(this.state.sceneId);
      }
      return this.state.finished ? "end" : "choices";
    }

    const sid = this.state.pendingStepIds.shift()!;
    const step = this.skeleton.steps[sid];
    const sceneBefore = this.state.sceneId;
    this.state.stepIndex += 1;
    this.emit({ type: "step", step, sceneId: this.state.sceneId, stepIndex: this.state.stepIndex - 1 });
    this.applyStep(step);

    // 若步骤触发了跳转（branch），pendingStepIds 已被新场景的 enterScene 重置
    if (this.state.sceneId !== sceneBefore) {
      // 新场景若还有步骤，继续播；否则呈现其选项
      if (this.state.pendingStepIds.length > 0) return "step";
      if (!this.state.choicesPresented) this.presentChoices(this.state.sceneId);
      return this.state.finished ? "end" : "choices";
    }

    // 本场景步骤播完 → 立即呈现选项
    if (this.state.pendingStepIds.length === 0) {
      if (!this.state.choicesPresented) this.presentChoices(this.state.sceneId);
      return this.state.finished ? "end" : "choices";
    }

    return "step";
  }

  /** 应用一个步骤的副作用（flag/task/branch） */
  private applyStep(step: Step) {
    switch (step.type) {
      case "flag": {
        this.state.flags[step.key] = step.value;
        break;
      }
      case "task": {
        const task: TaskSlot = {
          taskId: step.taskId,
          description: step.description,
          status: step.status ?? "active",
          setAtScene: this.state.sceneId,
        };
        this.state.task = task;
        this.emit({ type: "task:set", task });
        break;
      }
      case "branch": {
        const ok = evalCondition(step.condition, this.state.flags);
        const target = ok ? step.gotoIfTrue : step.gotoIfFalse;
        if (target) {
          this.enterScene(target);
        }
        // 若目标为空，则停留当前场景（可配合 choices 做卡关重来）
        break;
      }
      default:
        break; // 其余步骤仅做展示，无状态副作用
    }
  }

  /** 呈现当前场景的选项（结局定义器） */
  private presentChoices(sceneId: string) {
    this.state.choicesPresented = true;
    const choices = this.skeleton.choices[sceneId];
    if (!choices || choices.length === 0) {
      this.finish("no_choices");
      return;
    }

    // 过滤：require 条件满足才可用的选项
    const available = choices.filter((c) => {
      if (!c.require) return true;
      try {
        return evalCondition(c.require, this.state.flags);
      } catch {
        return false;
      }
    });

    if (available.length === 0) {
      // 没有可用选项 —— 卡关（可重来的场景会由上层决定 retry）
      this.finish("no_choices");
      return;
    }

    this.emit({ type: "choice:present", choices: available });
  }

  /** 玩家做出选择 */
  choose(choice: Choice, autoPlay = true) {
    // 写入选项带来的 flag
    if (choice.setFlags) {
      Object.assign(this.state.flags, choice.setFlags);
    }
    // 跳转
    if (choice.goto) {
      this.enterScene(choice.goto, 0, autoPlay);
    } else if (choice.retry) {
      // 卡关重来：回到当前场景
      this.enterScene(this.state.sceneId, 0, autoPlay);
    } else {
      this.finish("no_choices");
    }
  }

  private finish(reason: "no_more_steps" | "no_choices" | "explicit") {
    this.state.finished = true;
    this.emit({ type: "end", reason });
  }

  /** 获取某场景的全部选项（编辑器可视化用） */
  getChoices(sceneId: string): Choice[] {
    return this.skeleton.choices[sceneId] ?? [];
  }

  /** 获取骨架包（只读访问） */
  getSkeleton(): Skeleton {
    return this.skeleton;
  }

  /** 获取所有场景节点（编辑器可视化用） */
  getSceneNodes(): Node[] {
    return Object.values(this.skeleton.nodes).filter((n) => n.type === "scene");
  }

  /** 获取某场景的步骤 id 顺序列表（编辑器右侧步骤面板用） */
  getSceneStepIds(sceneId: string): string[] {
    return this.sceneSteps.get(sceneId) ?? [];
  }
}

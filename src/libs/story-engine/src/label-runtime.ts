/**
 * label 运行时 —— 按编排连接播放剧本片段
 *
 * 语义（与需求文档一致）：
 *  - 从明确入口 label 开始，按源码顺序播放步骤。
 *  - 菜单挂在片段上，按 `index`（播放完前 index 步之后）触发；缺省为片段末尾。
 *  - 跳出（jump=out）：结算后按 orchestration 连接决定下一片段，找不到连接即报错。
 *  - 回归（jump=back）：结算后回到本片段，从菜单位置之后继续播放，不查连接。
 *  - 无菜单片段播完：条件自动出口 / 显式结束优先，否则按卡片顺序进入下一个片段
 *    （"下一个" = 文件顺序 + 源码行号）；顺序末尾退回无条件连线，仍无出口即报错。
 *  - 可跳过支线（`plotlines[].optional`）：本局未进入过、或起点选择放弃后，
 *    顺序出口跳过归属它的片段。
 *  - 有意循环允许，累计「重复进入已访问片段」超过阈值视为死循环并终止。
 *
 * 本文件是纯逻辑，不依赖 DOM；编辑器通过 subscribe 渲染。
 */

import type { Step } from "./types.ts";
import type {
  Diagnostic,
  MenuDefinition,
  MenuResult,
  OrchestrationLink,
  ProjectDoc,
  ScriptLabel,
  StateDefinition,
  StateEffect,
} from "./project-types.ts";

import { DIAG } from "./project-diagnostics.ts";
import {
  evalFlagCondition,
  menuResults,
  nextEnterableLabel,
  plotlineNameOfLabel,
  plotlineOfLabel,
} from "./orchestration.ts";

export type RuntimeStatus = "idle" | "playing" | "awaiting-menu" | "finished" | "error";

/** 暂停中的菜单上下文（含按条件过滤后的可用结果） */
export interface RuntimeMenu {
  menuId: string;
  labelId: string;
  title: string;
  type: MenuDefinition["type"];
  /** 跳出 / 回归 */
  jump: MenuDefinition["jump"];
  results: MenuResult[];
}

export type LabelEvent =
  | { type: "label:enter"; labelId: string; name: string; file: string }
  | { type: "step"; step: Step; labelId: string; index: number }
  | { type: "menu:open"; menu: RuntimeMenu }
  | { type: "menu:resolved"; menuId: string; resultId: string }
  | { type: "state:change"; stateId: string; value: unknown; previous: unknown }
  | { type: "path"; from: string; to: string; reason: string }
  | { type: "end"; reason: "explicit" | "no-exit" | "error" }
  | { type: "error"; diagnostic: Diagnostic };

type Listener = (e: LabelEvent) => void;

export interface RuntimeState {
  labelId: string;
  stepIndex: number;
  flags: Record<string, unknown>;
  status: RuntimeStatus;
  /** 暂停中的菜单 */
  menu: RuntimeMenu | null;
  /** 走过的 label 顺序 */
  path: string[];
  /** 人类可读日志（UI 侧栏） */
  log: string[];
  /** 已发生的片段转移次数（路径诊断用；循环保护另计重复进入次数） */
  transitions: number;
  error: Diagnostic | null;
}

export interface RuntimeOptions {
  /** 起始片段；缺省用编排入口 */
  startLabel?: string;
  /**
   * 循环保护阈值：累计「重复进入已访问片段」的次数上限。
   * 只统计回头路，长线性流程不会被误判为死循环。
   */
  maxRepeats?: number;
  /** 兼容旧调用：等价于 maxRepeats */
  maxTransitions?: number;
}

export class LabelRuntime {
  private readonly project: ProjectDoc;
  private readonly listeners = new Set<Listener>();
  private readonly stateById: Map<string, StateDefinition>;
  private readonly maxRepeats: number;
  private readonly legacyFlags: boolean;
  /** 每个片段被进入的次数（判断是否走回头路） */
  private readonly visits = new Map<string, number>();
  /** 累计重复进入次数（循环保护） */
  private repeatCount = 0;
  /** 本次进入片段后已处理过的菜单（任务/已选择），避免重复触发 */
  private readonly consumedMenus = new Set<string>();
  /** 本局已关闭的可跳过支线（支线片段里的选项离开本线时关闭） */
  private readonly closedPlotlines = new Set<string>();

  state: RuntimeState;

  constructor(project: ProjectDoc, options: RuntimeOptions = {}) {
    this.project = project;
    this.maxRepeats = options.maxRepeats ?? options.maxTransitions ?? 200;
    this.stateById = new Map(project.states.states.map((s) => [s.id, s]));
    this.legacyFlags = project.states.states.length === 0;
    this.state = {
      labelId: options.startLabel ?? project.orchestration.entry ?? "",
      stepIndex: 0,
      flags: this.initialFlags(),
      status: "idle",
      menu: null,
      path: [],
      log: [],
      transitions: 0,
      error: null,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: LabelEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private initialFlags(): Record<string, unknown> {
    const flags: Record<string, unknown> = {};
    for (const def of this.project.states.states) flags[def.id] = def.initial;
    return flags;
  }

  /** 重开：清空状态与路径，回到入口/指定片段 */
  reset(startLabel?: string): boolean {
    this.visits.clear();
    this.repeatCount = 0;
    this.consumedMenus.clear();
    this.closedPlotlines.clear();
    this.state = {
      labelId: startLabel ?? this.project.orchestration.entry ?? "",
      stepIndex: 0,
      flags: this.initialFlags(),
      status: "idle",
      menu: null,
      path: [],
      log: [],
      transitions: 0,
      error: null,
    };
    return this.enter(this.state.labelId);
  }

  /** 从入口（或指定片段）开始 */
  start(startLabel?: string): boolean {
    return this.reset(startLabel);
  }

  private get label(): ScriptLabel | undefined {
    return this.project.labels[this.state.labelId];
  }

  private enter(labelId: string): boolean {
    const label = this.project.labels[labelId];
    if (!label) {
      this.fail(DIAG.RUNTIME_NO_LINK, `片段 "${labelId}" 不存在`);
      return false;
    }
    const seen = this.visits.get(labelId) ?? 0;
    this.visits.set(labelId, seen + 1);
    if (this.state.labelId !== labelId || this.state.path.length > 0) {
      this.state.transitions += 1;
    }
    // 只有「回头路」计入循环保护：首次前进再多也不该被判定死循环
    if (seen > 0) {
      this.repeatCount += 1;
      if (this.repeatCount > this.maxRepeats) {
        this.fail(
          DIAG.RUNTIME_LOOP_PROTECTION,
          `片段「${label.name}」重复进入超过 ${this.maxRepeats} 次，疑似死循环`,
          { labelId, repeats: this.repeatCount },
        );
        return false;
      }
    }
    this.state.labelId = labelId;
    this.state.stepIndex = 0;
    this.state.menu = null;
    this.consumedMenus.clear();
    this.state.status = "playing";
    this.state.error = null;
    this.state.path.push(labelId);
    this.state.log.push(`▶ ${label.name}（${label.file}:${label.line}）`);
    this.emit({ type: "label:enter", labelId, name: label.name, file: label.file });
    return true;
  }

  private fail(code: string, message: string, data?: Record<string, unknown>) {
    const diagnostic: Diagnostic = { code, severity: "error", message, ...(data ? { data } : {}) };
    this.state.error = diagnostic;
    this.state.status = "error";
    this.state.log.push(`✗ ${message}`);
    this.emit({ type: "error", diagnostic });
    this.emit({ type: "end", reason: "error" });
  }

  /**
   * 推进一帧：
   *  - "step" 播放了一步
   *  - "pause" 遇到菜单，等待 choose
   *  - "finished" 流程结束
   *  - "idle" 未开始或已结束
   */
  stepOnce(): "step" | "pause" | "finished" | "idle" {
    if (this.state.status === "idle") return "idle";
    if (this.state.status === "awaiting-menu") return "pause";
    if (this.state.status === "finished") return "finished";
    if (this.state.status === "error") return "idle";

    const label = this.label;
    if (!label) {
      this.fail(DIAG.RUNTIME_NO_LINK, `当前片段 "${this.state.labelId}" 不存在`);
      return "idle";
    }

    // 1. 当前步数位置上到期的菜单（按项目菜单定义顺序，逐个结算）
    for (const menu of this.menusForLabel(label.id)) {
      if (this.consumedMenus.has(menu.id)) continue;
      if (this.menuPosition(menu, label) !== this.state.stepIndex) continue;
      this.consumedMenus.add(menu.id);
      return this.openMenu(menu, label) ? "pause" : "idle";
    }

    // 2. 播放一步
    const step = label.steps[this.state.stepIndex];
    if (step) {
      const index = this.state.stepIndex;
      this.state.stepIndex += 1;
      this.emit({ type: "step", step, labelId: label.id, index });
      this.applyStep(step);
      return "step";
    }

    // 3. 片段播完：走自动出口或结束
    return this.exitLabel(label);
  }

  /**
   * 无菜单片段播完后的出口，优先级：
   *  1. 带条件的自动出口（作者显式配置的分支）
   *  2. 显式结束（end: true）
   *  3. 默认出口：按卡片顺序进入下一个片段
   *  4. 顺序末尾时，退回无条件连线（回环 / 跳转收尾）
   */
  private exitLabel(label: ScriptLabel): "step" | "pause" | "finished" | "idle" {
    const links = this.project.orchestration.links.filter((l) => l.fromLabel === label.id);

    const conditional = this.pickLink(links.filter((l) => l.when));
    if (conditional) return this.followLink(conditional, `片段「${label.name}」条件出口`);

    const end = this.pickLink(links.filter((l) => l.end));
    if (end) return this.followLink(end, `片段「${label.name}」自动结束`);

    // 默认出口：卡片顺序上的下一个片段（无条件连线不再抢先，避免跳过相邻卡片）；
    // 可跳过支线里「未进入 / 已关闭」的片段不参与默认出口。
    const { next, skipped } = nextEnterableLabel(this.project, label.id, (id) =>
      this.isEnterableBySequence(id),
    );
    if (skipped.length) {
      const names = skipped.map((id) => `「${this.project.labels[id]?.name ?? id}」`).join("、");
      this.state.log.push(`⤼ 跳过支线片段（未进入或已关闭）：${names}`);
    }
    if (next) {
      this.emit({ type: "path", from: label.id, to: next, reason: `片段「${label.name}」默认出口` });
      return this.enter(next) ? "step" : "idle";
    }

    const fallback = this.pickLink(links.filter((l) => !l.when && l.to));
    if (fallback) return this.followLink(fallback, `片段「${label.name}」自动出口`);

    this.fail(
      DIAG.RUNTIME_NO_EXIT,
      `片段「${label.name}」是最后一个片段，没有可用出口，请在「剧情编排」中设置结束`,
      { labelId: label.id },
    );
    return "idle";
  }

  /** 某条线的片段 ID：`labelIds` 由加载器同步，缺失时按剧本归属现场推导 */
  private labelIdsOfPlotline(owner: { name: string; labelIds?: string[] }): string[] {
    if (owner.labelIds?.length) return owner.labelIds;
    return Object.values(this.project.labels)
      .filter((l) => plotlineNameOfLabel(l) === owner.name)
      .map((l) => l.id);
  }

  /**
   * 能否由「顺序出口」进入该片段。
   * 可跳过支线（`optional`）只有本局进入过它、且没被关闭时才继续；
   * 核心支线、主线、线索线不受影响。
   */
  private isEnterableBySequence(labelId: string): boolean {
    const owner = plotlineOfLabel(this.project, labelId);
    if (!owner || owner.kind !== "branch" || !owner.optional) return true;
    if (this.closedPlotlines.has(owner.id)) return false;
    // 本局还没进过这条支线：顺序出口不自行进入
    return this.labelIdsOfPlotline(owner).some((id) => (this.visits.get(id) ?? 0) > 0);
  }

  /**
   * 支线片段里的剧情选项离开本线时关闭整条线。
   * 判据：当前片段属于可跳过支线，跳出菜单的结果连线指向本线之外（或结束）。
   * 只处理「选项结算」这条路径；片段播完后的自动出口走 `exitLabel`，
   * 因此「正常回主线」不会误关（同一支线在主线多处插入时仍可再次进入）。
   */
  private closePlotlineIfDeclined(fromLabelId: string, link: { to?: string; end?: boolean }): void {
    const owner = plotlineOfLabel(this.project, fromLabelId);
    if (!owner || owner.kind !== "branch" || !owner.optional) return;
    if (this.closedPlotlines.has(owner.id)) return;

    const targetOwner = link.end || !link.to ? undefined : plotlineOfLabel(this.project, link.to);
    if (link.end || !link.to || targetOwner?.id !== owner.id) {
      this.closedPlotlines.add(owner.id);
      this.state.log.push(`⤼ 支线「${owner.name}」已关闭（选项离开本线），后续片段将跳过`);
    }
  }

  private pickLink(links: OrchestrationLink[]): OrchestrationLink | undefined {
    const usable = links.filter((l) => {
      if (!l.when) return true;
      try {
        return evalFlagCondition(l.when, this.state.flags);
      } catch {
        return false;
      }
    });
    // 有条件的分支优先，无条件连线作为兜底
    return usable.find((l) => l.when) ?? usable[0];
  }

  private followLink(
    link: { id: string; to?: string; end?: boolean },
    reason: string,
  ): "step" | "pause" | "finished" | "idle" {
    if (link.end) {
      this.state.status = "finished";
      this.state.log.push("◆ 流程结束");
      this.emit({ type: "end", reason: "explicit" });
      return "finished";
    }
    if (!link.to) {
      this.fail(DIAG.RUNTIME_NO_LINK, `连线 "${link.id}" 没有目标片段`);
      return "idle";
    }
    const from = this.state.labelId;
    this.emit({ type: "path", from, to: link.to, reason });
    return this.enter(link.to) ? "step" : "idle";
  }

  /** 片段上挂载的玩家菜单（按项目菜单定义顺序；条件出口不是菜单，不参与） */
  private menusForLabel(labelId: string): MenuDefinition[] {
    return Object.values(this.project.menus.menus).filter(
      (m) => m.labelId === labelId && m.type === "choice",
    );
  }

  /** 菜单在片段内的触发位置：播放完前 index 步之后；缺省/越界按末尾处理 */
  private menuPosition(menu: MenuDefinition, label: ScriptLabel): number {
    const raw = menu.index ?? label.steps.length;
    return Math.max(0, Math.min(raw, label.steps.length));
  }

  /** 打开菜单（按条件过滤可用结果），返回是否成功暂停等待选择 */
  private openMenu(menu: MenuDefinition, label: ScriptLabel): boolean {
    this.consumedMenus.add(menu.id);
    const results = menuResults(menu).filter((r) => {
      if (!r.require) return true;
      try {
        return evalFlagCondition(r.require, this.state.flags);
      } catch {
        return false;
      }
    });

    const runtimeMenu: RuntimeMenu = {
      menuId: menu.id,
      labelId: label.id,
      title: menu.title,
      type: menu.type,
      jump: menu.jump,
      results,
    };

    if (results.length === 0) {
      this.fail(
        DIAG.RUNTIME_RESULT_INVALID,
        `菜单「${menu.title}」当前没有可用结果（条件都不满足或未配置）`,
        { menuId: menu.id, labelId: label.id },
      );
      return false;
    }

    this.state.menu = runtimeMenu;
    this.state.status = "awaiting-menu";
    this.state.log.push(`◈ 菜单：${menu.title}（${results.map((r) => r.text).join(" / ")}）`);
    this.emit({ type: "menu:open", menu: runtimeMenu });
    return true;
  }

  /** 选择剧情选项 / 模拟交互结果 */
  choose(resultId: string): boolean {
    if (this.state.status !== "awaiting-menu" || !this.state.menu) return false;
    const menu = this.state.menu;
    const result = menu.results.find((r) => r.resultId === resultId);
    if (!result) {
      this.fail(DIAG.RUNTIME_RESULT_INVALID, `结果 "${resultId}" 不在菜单「${menu.title}」中`, {
        menuId: menu.menuId,
        resultId,
      });
      return false;
    }

    this.applyEffects(result.effects);
    this.emit({ type: "menu:resolved", menuId: menu.menuId, resultId });
    this.state.log.push(`◇ ${menu.title} → ${result.text}`);

    // 回归菜单：不查连线，结算后从菜单所在位置之后继续播放本片段
    if (menu.jump === "back") {
      this.state.menu = null;
      this.state.status = "playing";
      this.state.log.push(`↩ 回到片段「${this.label?.name ?? menu.labelId}」继续`);
      return true;
    }

    const links = this.project.orchestration.links.filter(
      (l) => l.fromMenu === menu.menuId && l.resultId === resultId,
    );
    const link = this.pickLink(links);
    this.state.menu = null;
    this.state.status = "playing";

    if (!link) {
      this.fail(
        DIAG.RUNTIME_NO_LINK,
        `结果「${result.text}」还没有连接目标片段，请在「剧情编排」中连线`,
        { menuId: menu.menuId, resultId, labelId: menu.labelId },
      );
      return false;
    }
    // 可跳过支线的起点：这一步的选择决定整条线是否继续
    this.closePlotlineIfDeclined(menu.labelId, link);

    const r = this.followLink(link, `菜单「${menu.title}」结果 ${result.text}`);
    return r !== "idle";
  }

  /** 应用一组状态效果（类型校验 + 数值收敛） */
  private applyEffects(effects?: StateEffect[]) {
    if (!effects || effects.length === 0) return;
    for (const effect of effects) {
      const def = this.stateById.get(effect.stateId);
      if (!def) {
        if (this.legacyFlags) {
          this.setFlag(effect.stateId, effect.value);
          continue;
        }
        this.fail(DIAG.RUNTIME_STATE_ERROR, `状态 "${effect.stateId}" 未定义`, {
          stateId: effect.stateId,
        });
        return;
      }

      const current = this.state.flags[effect.stateId];
      let next: unknown;
      if (effect.op === "add" || effect.op === "sub") {
        if (def.type !== "number") {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `状态「${def.name}」不是数值类型，不能用加减`, {
            stateId: def.id,
          });
          return;
        }
        const delta = Number(effect.value);
        if (!Number.isFinite(delta)) {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `状态「${def.name}」的加减值不是数字`, {
            stateId: def.id,
          });
          return;
        }
        next = (Number(current) || 0) + (effect.op === "add" ? delta : -delta);
      } else {
        next = effect.value;
      }

      if (def.type === "number" && typeof next === "number") {
        const value = next;
        next = Math.min(Math.max(value, def.min ?? -Infinity), def.max ?? Infinity);
      }
      if (def.type === "boolean" && typeof next !== "boolean") {
        this.fail(DIAG.RUNTIME_STATE_ERROR, `状态「${def.name}」需要布尔值`, { stateId: def.id });
        return;
      }
      if (def.type === "string" && typeof next !== "string") {
        this.fail(DIAG.RUNTIME_STATE_ERROR, `状态「${def.name}」需要字符串`, { stateId: def.id });
        return;
      }
      if (def.type === "enum") {
        const options = def.options ?? [];
        if (typeof next !== "string" || !options.includes(next)) {
          this.fail(
            DIAG.RUNTIME_STATE_ERROR,
            `状态「${def.name}」只能取下拉列表中的值：${options.join(" / ")}`,
            { stateId: def.id },
          );
          return;
        }
      }
      this.setFlag(def.id, next);
    }
  }

  private setFlag(stateId: string, value: unknown) {
    const previous = this.state.flags[stateId];
    this.state.flags[stateId] = value;
    const name = this.stateById.get(stateId)?.name ?? stateId;
    this.state.log.push(`⚙ ${name} = ${JSON.stringify(value)}`);
    this.emit({ type: "state:change", stateId, value, previous });
  }

  /** 步骤副作用：@flag / @task 槽位（其它步骤仅供展示） */
  private applyStep(step: Step) {
    if (step.type === "flag") {
      const op = step.op ?? "set";
      if (op === "set") {
        if (!this.stateById.has(step.key) && !this.legacyFlags) {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `状态 "${step.key}" 未定义`, { stateId: step.key });
          return;
        }
        this.applyEffects([{ stateId: step.key, op: "set", value: step.value }]);
        return;
      }
      this.applyEffects([{ stateId: step.key, op, value: step.value }]);
      return;
    }
    if (step.type === "task") {
      this.state.log.push(`⚑ 任务：${step.description ?? step.taskId}`);
    }
  }

}

/**
 * 文本通道（channel）——把步骤按「谁、以什么方式发出文本」分类的公共工具。
 *
 * 唯一来源：`@actor <角色名> #say|#inner|#act|#sprite`、`@narr #bg|#vo|#bgm|#sfx|#fx|#item`。
 * 通道由作者显式标注，解析后写进 `step.channel`（必填，无缺省值）。
 *
 * 运行时与渲染层只应通过本模块取通道，不要自己 switch 步骤类型。
 */

import type { ActorChannel, NarrChannel, Step, StepChannel } from "./types.ts";

/** 角色侧通道（`@actor` 专用） */
export const ACTOR_CHANNELS = ["say", "inner", "act", "sprite"] as const;

/** 旁白侧通道（`@narr` 专用） */
export const NARR_CHANNELS = ["bg", "vo", "bgm", "sfx", "fx", "item"] as const;

/** 通道的中文名（诊断、UI 展示共用） */
export const CHANNEL_LABEL: Record<StepChannel, string> = {
  say: "台词",
  inner: "心声",
  act: "动作",
  sprite: "立绘",
  bg: "背景",
  vo: "旁白",
  bgm: "音乐",
  sfx: "音效",
  fx: "特效",
  item: "物品",
};

export function isActorChannel(value: string): value is ActorChannel {
  return (ACTOR_CHANNELS as readonly string[]).includes(value);
}

export function isNarrChannel(value: string): value is NarrChannel {
  return (NARR_CHANNELS as readonly string[]).includes(value);
}

/**
 * 取步骤的文本通道。
 * `@flag` / 分支等非展示步骤没有 `channel` 字段，返回 null。
 */
export function stepChannel(step: Step): StepChannel | null {
  return "channel" in step ? step.channel : null;
}

/** 该步骤是否承载「文本」（台词 / 心声 / 动作 / 旁白），用于统计与过滤 */
export function isTextStep(step: Step): boolean {
  if (step.type === "dialog" || step.type === "narration") return true;
  return false;
}

/**
 * 该步骤是否属于角色侧（由某个角色发出，而非镜头旁白）。
 * 立绘也算角色侧：它描述的是角色形象。
 */
export function isActorStep(step: Step): boolean {
  const channel = stepChannel(step);
  return channel !== null && isActorChannel(channel);
}

/**
 * 文本步骤的标题（播放器气泡抬头）：
 *  - 台词 → 角色名
 *  - 心声 → `角色名（心声）`
 *  - 动作 → 角色名（无角色名时退回「旁白」）
 *  - 旁白 → 「旁白」
 *  - 其它步骤 → null（不产生气泡）
 */
export function stepTitle(step: Step): string | null {
  const channel = stepChannel(step);
  if (step.type === "dialog") {
    return channel === "inner" ? `${step.speaker}（心声）` : step.speaker;
  }
  if (step.type === "narration") {
    if (channel === "act") return step.speaker ?? "旁白";
    return "旁白";
  }
  return null;
}

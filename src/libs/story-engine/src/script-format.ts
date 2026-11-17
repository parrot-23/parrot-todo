/**
 * 剧本语法生成（写侧）
 *
 * 与 `label-parser.ts` 的读侧同源：本文件产出的每一行都必须能被解析器原样读回。
 * 编辑器 / 导入器 / AI 生成器一律通过这些函数拼指令，不要自己写模板字符串，
 * 否则语法一改就会单边漂移。
 *
 * 语法速查（详见 STORY_FORMAT.md）：
 *   @plot <id> <名称> #<情节线> $<位置>
 *   @actor <角色名> #say|#inner|#act <文本>
 *   @actor <角色名> #sprite <表情>/<位置>
 *   @narr #vo <文本>
 *   @narr #bg|#bgm|#sfx|#item <资源名>(<参数>)
 *   @narr #fx <特效名>
 *   @flag <键>=<值> | <键>+=<数字> | <键>-=<数字>
 */

import type { ActorChannel, NarrChannel, Step } from "./types.ts";

/** `@plot` 行参数 */
export interface LabelHeaderSpec {
  id: string;
  /** 显示名称（可含空格；不能含 " #" / " $"） */
  name?: string;
  /** 情节线名（主线固定「主线」） */
  plotline?: string;
  /** 位置标签：起点 / 铺垫 / 高潮 / 转折 / 结局，也可自定 */
  position?: string;
}

/** 允许包裹角色名的引号对（与解析器一致） */
const QUOTE_PAIRS: Array<[string, string]> = [
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
  ['"', '"'],
  ["'", "'"],
];

/** 单行化：换行会破坏“一行一条指令”的约定 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

/**
 * 角色名：含空白时必须用引号包裹，否则解析器只会取第一个空白前的片段。
 * 名字里已经带了某对引号时自动换下一对；全都撞上则原样返回（由校验提示）。
 */
export function quoteSpeaker(name: string): string {
  const n = oneLine(name).replace(/^#+/, "");
  if (!n) return n;
  if (!/\s/.test(n)) return n;
  for (const [open, close] of QUOTE_PAIRS) {
    if (!n.includes(open) && !n.includes(close)) return `${open}${n}${close}`;
  }
  return n;
}

/**
 * `@plot <id> <名称> #<情节线> $<位置>`
 *
 * 名称里的 ` #` / ` $` 会被空格替换——解析器把「空白 + #/$」当成标记起点，
 * 不清掉会被误判成情节线/位置。
 */
export function formatLabelHeader(spec: LabelHeaderSpec): string {
  const parts = [`@plot ${oneLine(spec.id)}`];
  const name = oneLine(spec.name ?? "").replace(/\s+[#$]/g, " ");
  if (name) parts.push(name);
  const plotline = oneLine(spec.plotline ?? "");
  if (plotline) parts.push(`#${plotline}`);
  const position = oneLine(spec.position ?? "");
  if (position) parts.push(`$${position}`);
  return parts.join(" ");
}

/** `@actor <角色名> #say|#inner|#act <文本>` */
export function formatActorLine(speaker: string, channel: ActorChannel, text: string): string {
  if (channel === "sprite") return formatSpriteLine(speaker);
  return `@actor ${quoteSpeaker(speaker)} #${channel} ${oneLine(text)}`;
}

/**
 * `@actor <角色名> #sprite <表情>/<位置>`
 * 两段都可省略；只有位置时写成 `/右`。表情与位置都不能含空白。
 */
export function formatSpriteLine(speaker: string, pose?: string, position?: string): string {
  const p = oneLine(pose ?? "").replace(/[\s/]/g, "");
  const pos = oneLine(position ?? "").replace(/[\s/]/g, "");
  const body = p && pos ? `${p}/${pos}` : p ? p : pos ? `/${pos}` : "";
  const head = `@actor ${quoteSpeaker(speaker)} #sprite`;
  return body ? `${head} ${body}` : head;
}

/** `@narr #vo <文本>` / `@narr #fx <特效名>` */
export function formatNarrLine(channel: NarrChannel, body: string): string {
  return `@narr #${channel} ${oneLine(body)}`;
}

/**
 * `@narr #bg|#bgm|#sfx|#item <资源名>(<参数>)`
 * - bg 的参数来自 `transition`（形如 `fade_in_2s`），写成 `(2秒)`
 * - bgm 的参数来自 `fade`（秒）
 * - sfx / item 无参数
 */
export function formatAssetLine(
  channel: "bg" | "bgm" | "sfx" | "item",
  assetName: string,
  params: { fade?: number; transition?: string } = {},
): string {
  const name = oneLine(assetName);
  let suffix = "";
  if (channel === "bg") {
    const m = params.transition?.match(/(\d+(?:\.\d+)?)/);
    if (m) suffix = `(${m[1]}秒)`;
  } else if (channel === "bgm" && params.fade != null) {
    suffix = `(${params.fade}秒)`;
  }
  return `@narr #${channel} ${name}${suffix}`;
}

/**
 * `@flag <键>=<值>` / `+=` / `-=`
 *
 * `rawValue` 是作者输入/生成好的字面量文本，本函数只做单行化与空白收尾，
 * 不改类型：`"3"` 仍写成 `3`（解析为数字），`"'3'"` 才会解析成字符串。
 */
export function formatFlagLine(
  key: string,
  op: "=" | "+=" | "-=" | "set" | "add" | "sub",
  rawValue: string,
): string {
  const symbol = op === "add" || op === "+=" ? "+=" : op === "sub" || op === "-=" ? "-=" : "=";
  return `@flag ${oneLine(key)}${symbol}${oneLine(rawValue)}`;
}

/** 值 → 字面量文本（会被误判成布尔/数字的字符串自动加引号） */
export function formatLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = value == null ? "" : String(value);
  const ambiguous = text === "true" || text === "false" || /^-?\d+(\.\d+)?$/.test(text);
  if (ambiguous) return text.includes("'") ? `"${text}"` : `'${text}'`;
  if (!text.trim()) return "''";
  return text;
}

/**
 * 步骤 → 一行剧本（`flag` / 旧 `task` 等不可表示时返回空串，由调用方跳过）。
 *
 * @param resolveAssetName 素材 id → 素材名（通常传 `(id) => doc.assets.items[id]?.name ?? id`）
 */
export function formatStep(step: Step, resolveAssetName: (assetId: string) => string): string {
  switch (step.type) {
    case "bg":
      return formatAssetLine(
        "bg",
        resolveAssetName(step.asset),
        step.transition ? { transition: step.transition } : {},
      );
    case "bgm":
      return formatAssetLine(
        "bgm",
        resolveAssetName(step.asset),
        step.fade != null ? { fade: step.fade } : {},
      );
    case "sfx":
      return formatAssetLine("sfx", resolveAssetName(step.asset));
    case "item":
      return formatAssetLine("item", resolveAssetName(step.asset));
    case "sprite":
      return formatSpriteLine(resolveAssetName(step.asset), step.pose, step.position);
    case "dialog":
      return formatActorLine(step.speaker, step.channel, step.text);
    case "narration":
      return step.channel === "act" && step.speaker
        ? formatActorLine(step.speaker, "act", step.text)
        : formatNarrLine("vo", step.text);
    case "effect":
      return formatNarrLine("fx", step.effect);
    case "flag":
      return formatFlagLine(step.key, step.op ?? "set", formatLiteral(step.value));
    default:
      // task / branch：新剧本不再支持
      return "";
  }
}

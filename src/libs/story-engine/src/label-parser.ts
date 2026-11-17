/**
 * 剧本文件解析（纯叙事 + @plot 模型）
 *
 * 语法：
 *   @plot <稳定ID> <显示名称>                          ← 剧情节点片段起点（默认归「主线」）
 *   @plot <稳定ID> <显示名称> #<情节线名>               ← 同时声明所属情节线（主线固定叫「主线」，其余为支线）
 *   @plot <稳定ID> <显示名称> #<情节线名> $<位置>       ← 位置：起点 / 铺垫 / 高潮 / 转折 / 结局，也可自定
 *
 * 其余指令与旧格式保持兼容：
 *   @bg / @bgm / @sfx / @sprite / @effect / @flag / @vo
 *   说话人：对白
 *
 * 剧本保持纯净：选择/交互/任务都不写在剧本里，而是项目文件里挂在片段上的菜单。
 * `@menu` / `@task` 已废弃，命中时给出迁移提示（在「剧情编排」中给片段添加菜单）。
 *
 * 解析原则：
 *  - 恢复式解析：单行错误产出诊断并跳过该行，不中断整个文件。
 *  - 首个 @plot 之前的内容不静默丢弃：记为 unowned 并报 warning，提示作者归属。
 *  - 旧 `@label` / `@node` 锚点与旧步骤指令均已移除，命中即报错，不再解析。
 *  - `#`/`##`/`###` 标题只作为文档文本，不再创建任何流程节点。
 */

import type { Step } from "./types.ts";
import {
  ACTOR_CHANNELS,
  NARR_CHANNELS,
  CHANNEL_LABEL,
  isActorChannel,
  isNarrChannel,
} from "./channels.ts";
import {
  createLibrary,
  resolveAsset,
  type AssetLibrary,
} from "./library.ts";
import type {
  Diagnostic,
  ScriptFileDoc,
  ScriptLabel,
  StateDefinition,
  StateModule,
} from "./project-types.ts";
import { DIAG, DiagnosticBag } from "./project-diagnostics.ts";

export interface ParseScriptOptions {
  /** 文件名（相对项目根），用于诊断定位 */
  file: string;
  /** 素材库（同名归并，跨文件复用同一素材 id） */
  library?: AssetLibrary;
  /** 状态定义（提供时校验 @flag 引用的状态） */
  states?: StateModule;
}

/** 把标题/名称清理成可用 id 片段（保留中英文数字） */
export function slugify(text: string): string {
  return text
    .replace(/[^\w\u4e00-\u9fa5-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 24);
}

/** 由显示名称生成 label ID（创建时用；之后改名不再改变） */
export function makeLabelId(name: string, used: Set<string>): string {
  const base = `lb_${slugify(name) || "label"}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** 由显示名称生成菜单 ID */
export function makeMenuId(name: string, used: Set<string>): string {
  const base = `m_${slugify(name) || "menu"}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** 由结果文案生成结果 ID（菜单编辑器用） */
export function makeResultId(text: string, used: Set<string>): string {
  const base = slugify(text).toLowerCase() || "result";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** 生成状态值稳定 ID（系统生成、作者不可见；创建后不再变化） */
export function makeStateId(used: Set<string>): string {
  let n = 1;
  while (used.has(`state_${n}`)) n++;
  return `state_${n}`;
}

/* ------------------------- 指令解析 ------------------------- */

function parseFade(params: string): number {
  const m = params.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 2;
}

/** 允许包裹角色名的引号对（`@actor "方源" #say …`） */
const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  "“": "”",
  "‘": "’",
  "「": "」",
  "『": "』",
};

/**
 * 拆出 `@actor` 行的角色名与剩余内容。
 * 角色名可用引号包裹（名字含空格时必需），也可以用零符号写法取第一个空白前的片段。
 * 引号未闭合时返回 null，由调用方报错。
 */
function splitActorHead(rest: string): { name: string; rest: string } | null {
  const text = rest.trim();
  if (!text) return null;
  const close = QUOTE_PAIRS[text[0]];
  if (close) {
    const end = text.indexOf(close, 1);
    if (end < 0) return null;
    return { name: text.slice(1, end).trim(), rest: text.slice(end + 1).trim() };
  }
  const m = text.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  return { name: m[1], rest: m[2].trim() };
}

/** 拆出通道标记 `#say` 与通道之后的正文；没有通道标记时返回 null */
function splitChannel(rest: string): { channel: string; body: string } | null {
  const m = rest.match(/^#\s*([A-Za-z][\w-]*)\s*([\s\S]*)$/);
  if (!m) return null;
  return { channel: m[1].toLowerCase(), body: m[2].trim() };
}

/** 解析文字值：true/false → 布尔，纯数字 → 数字，引号包裹或其余 → 字符串 */
export function parseLiteral(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const quoted = v.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  return v;
}

function matchesType(type: StateDefinition["type"], value: unknown): boolean {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string";
}

/** `@plot` 行的标记起点：空白后的 `#`（情节线）或 `$`（位置） */
const LABEL_MARK = /(?:^|\s)[#$]/;

/** 推荐的位置标签：也允许作者自定（`$自定义`） */
export const LABEL_POSITIONS = ["起点", "铺垫", "高潮", "转折", "结局"] as const;

/**
 * 拆出 @plot 行的显示名称、情节线名与位置标签。
 * 只写 `@plot <id> <名称>` 时两者都没有（情节线由调用方按「主线」处理）。
 *
 * 标记区从「空白 + `#`/`$`」开始，可任意顺序、可缺省：
 *   @plot lb_x 名称 #主线 $高潮
 *   @plot lb_x 名称 $转折 #未自爆结局
 * `#` 前面必须是空白，所以显示名称里的 `第#1章` 不会被误判；
 * 标记值允许带空格（如 `#未自爆 结局`），但不能再用 `#` / `$`。
 */
function splitLabelLine(
  rest: string,
  bag: DiagnosticBag,
  loc: { file: string; line: number; column: number },
): { name: string; plotline: string; position: string } {
  const text = rest.trim();
  const found = LABEL_MARK.exec(text);
  if (!found) return { name: text, plotline: "", position: "" };

  const name = text.slice(0, found.index).trim();
  let plotline = "";
  let position = "";
  let sawPlotline = false;
  let sawPosition = false;

  const marks = /([#$])\s*([^#$]*)/g;
  const tail = text.slice(found.index);
  let m: RegExpExecArray | null;
  while ((m = marks.exec(tail)) !== null) {
    const value = m[2].trim();
    if (m[1] === "#") {
      sawPlotline = true;
      plotline = value;
    } else {
      sawPosition = true;
      position = value;
    }
  }

  if (sawPlotline && !plotline) {
    bag.warn(
      DIAG.LABEL_PLOTLINE_EMPTY,
      "@plot 的情节线标记 `#` 后面没有写名称，该片段按主线处理",
      loc,
    );
  }
  if (sawPosition && !position) {
    bag.warn(
      DIAG.LABEL_POSITION_EMPTY,
      "@plot 的位置标记 `$` 后面没有写名称，该片段不标位置",
      loc,
    );
  }
  return { name, plotline, position };
}

interface StepParseContext {
  file: string;
  line: number;
  column: number;
  bag: DiagnosticBag;
  library: AssetLibrary;
  stateById: Map<string, StateDefinition>;
}

/**
 * `@actor <角色名> #<通道> <内容>` —— 角色侧文本。
 *
 *   @actor 方源 #say 你终于来了
 *   @actor "方源" #inner 这一局，我赢定了
 *   @actor 方源 #act 转身，群雄齐齐后退
 *   @actor 方源 #sprite 血袍/center
 *
 * 通道省略时按 #say 处理并给出提示（台词是最常见的角色行）。
 */
function parseActorDirective(args: string, ctx: StepParseContext): Step | null {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const head = splitActorHead(args);
  // 名字以 `#` 开头说明作者漏了角色名（把通道当成了名字）
  if (!head || !head.name || head.name.startsWith("#")) {
    ctx.bag.error(
      DIAG.STEP_ACTOR_MISSING,
      `@actor 缺少角色名：应为 "@actor <角色名> #say <台词>"（名字含空格时用引号包裹）`,
      loc,
    );
    return null;
  }

  const parsed = splitChannel(head.rest);
  if (!parsed) {
    ctx.bag.error(
      DIAG.STEP_CHANNEL_MISSING,
      `@actor 缺少通道标记：应写成 @actor ${head.name} #${ACTOR_CHANNELS.join(" / #")} <内容>`,
      loc,
    );
    return null;
  }
  const { channel, body } = parsed;

  if (!isActorChannel(channel)) {
    if (isNarrChannel(channel)) {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_MISPLACED,
        `@actor 不支持旁白通道 "#${channel}"，旁白请写成 @narr #${channel} …`,
        loc,
      );
    } else {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_UNKNOWN,
        `未知通道 "#${channel}"：@actor 支持 #${ACTOR_CHANNELS.join(" / #")}`,
        loc,
      );
    }
    return null;
  }

  switch (channel) {
    case "say":
    case "inner":
      if (!body) {
        ctx.bag.error(
          DIAG.STEP_DIRECTIVE_ERROR,
          `@actor #${channel} 缺少${channel === "inner" ? "心声" : "台词"}内容`,
          loc,
        );
        return null;
      }
      return { type: "dialog", channel, speaker: head.name, text: body };

    case "act":
      if (!body) {
        ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, "@actor #act 缺少动作描述", loc);
        return null;
      }
      return { type: "narration", channel: "act", speaker: head.name, text: body };

    default: {
      // #sprite：`表情/位置`，两段都可省略
      if (/\s/.test(body)) {
        ctx.bag.error(
          DIAG.STEP_DIRECTIVE_ERROR,
          `@actor #sprite 只接受「表情/位置」，不能含空格：${body}`,
          loc,
        );
        return null;
      }
      const [pose, position] = body.split("/");
      return {
        type: "sprite",
        channel: "sprite",
        asset: resolveAsset(ctx.library, head.name, "sprite"),
        ...(pose ? { pose } : {}),
        ...(position ? { position } : {}),
        enter: true,
      };
    }
  }
}

/**
 * `@narr #<通道> <内容>` —— 旁白侧文本（镜头语言）。
 *
 *   @narr #vo 雾从海面漫上来。
 *   @narr #bg 雾港码头(渐入2秒)
 *   @narr #bgm 主题曲(渐入2秒)
 *   @narr #sfx 敲门声
 *   @narr #fx flash
 *
 * 旁白侧通道无法从内容推断，必须显式标注。
 */
function parseNarrDirective(args: string, ctx: StepParseContext): Step | null {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const parsed = splitChannel(args);
  if (!parsed) {
    ctx.bag.error(
      DIAG.STEP_CHANNEL_MISSING,
      `@narr 必须带通道标记：#${NARR_CHANNELS.join(" / #")}`,
      loc,
    );
    return null;
  }
  const { channel, body } = parsed;

  if (!isNarrChannel(channel)) {
    if (isActorChannel(channel)) {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_MISPLACED,
        `@narr 不支持角色通道 "#${channel}"，角色内容请写成 @actor <角色名> #${channel} …`,
        loc,
      );
    } else {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_UNKNOWN,
        `未知通道 "#${channel}"：@narr 支持 #${NARR_CHANNELS.join(" / #")}`,
        loc,
      );
    }
    return null;
  }

  if (!body) {
    ctx.bag.error(
      DIAG.STEP_DIRECTIVE_ERROR,
      `@narr #${channel} 缺少${CHANNEL_LABEL[channel]}内容`,
      loc,
    );
    return null;
  }

  switch (channel) {
    case "vo":
      return { type: "narration", channel: "vo", text: body };
    case "fx":
      return { type: "effect", channel: "fx", effect: body };
    default:
      // bg / bgm / sfx / item：括号参数与素材登记规则同 3 §4
      return parseAssetDirective(channel, body, ctx);
  }
}

/**
 * 演出步骤的公共解析：`<资源名>` 或 `<资源名>(参数)`。
 * 只由 `@narr #bg|#bgm|#sfx|#item` 与 `@actor … #sprite` 调用。
 */
function parseAssetDirective(
  channel: "bg" | "bgm" | "sfx" | "item",
  args: string,
  ctx: StepParseContext,
): Step | null {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const rm = args.match(/^(.+?)(?:\(([^)]*)\))?$/);
  if (!rm || !rm[1].trim()) {
    ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `@narr #${channel} 缺少资源名`, loc);
    return null;
  }
  const assetName = rm[1].trim();
  const params = rm[2];
  const assetId = resolveAsset(
    ctx.library,
    assetName,
    channel === "bg" || channel === "item" ? "image" : "audio",
  );

  if (channel === "item") {
    // 关键物品：复用 image 素材，在画面中心展示（4 §3.5）
    return { type: "item", channel: "item", asset: assetId };
  }
  if (channel === "bgm") {
    return { type: "bgm", channel: "bgm", asset: assetId, ...(params ? { fade: parseFade(params) } : {}) };
  }
  if (channel === "sfx") {
    return { type: "sfx", channel: "sfx", asset: assetId };
  }
  return {
    type: "bg",
    channel: "bg",
    asset: assetId,
    ...(params ? { transition: `fade_in_${parseFade(params)}s` } : {}),
  };
}

/** 旧指令 → 新写法提示（移除兼容后，命中即报错） */
const LEGACY_HINTS: Record<string, string> = {
  vo: "@narr #vo <文本>",
  bg: "@narr #bg <背景名>",
  bgm: "@narr #bgm <音乐名>",
  sfx: "@narr #sfx <音效名>",
  effect: "@narr #fx <特效名>",
  sprite: "@actor <角色名> #sprite <表情/位置>",
};

/** 旧指令的替代写法；`@task` 没有替代（功能已移除），返回空串 */
function legacyHint(name: string): string {
  return LEGACY_HINTS[name] ?? "";
}

/** 解析一行 @指令（不含 @plot / @menu） */
function parseStepDirective(body: string, ctx: StepParseContext): Step | null {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const m = body.match(/^@(\w+)(?:\s+(.*))?$/);
  if (!m) {
    ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `无法解析指令（应为 "@name 参数"）：${body}`, loc);
    return null;
  }
  const name = m[1];
  const args = (m[2] ?? "").trim();

  switch (name) {
    // 通道式指令：角色侧 / 旁白侧
    case "actor":
      return parseActorDirective(args, ctx);

    case "narr":
      return parseNarrDirective(args, ctx);

    // 旧指令已移除：不再兼容，直接报错并给出新写法
    case "vo":
    case "bg":
    case "bgm":
    case "sfx":
    case "sprite":
    case "effect":
    case "task":
      ctx.bag.error(
        DIAG.STEP_DIRECTIVE_LEGACY,
        legacyHint(name)
          ? `@${name} 已移除，请改用 ${legacyHint(name)}`
          : `@${name} 已移除：剧本里不再支持任务指令`,
        loc,
      );
      return null;

    case "flag": {
      const fm = args.match(/^([\w\u4e00-\u9fa5-]+)\s*(\+=|-=|=)\s*(.+)$/);
      if (!fm) {
        ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `@flag 格式应为 键=值 / 键+=数值 / 键-=数值：${body}`, loc);
        return null;
      }
      const [, key, opRaw, rawValue] = fm;
      const value = parseLiteral(rawValue);
      const def = ctx.stateById.get(key);
      if (ctx.stateById.size > 0) {
        if (!def) {
          ctx.bag.error(
            DIAG.STATE_UNDECLARED,
            `状态 "${key}" 未在状态值中定义，请先在「状态值」页创建`,
            loc,
            { stateId: key },
          );
          return null;
        }
        if (!matchesType(def.type, value)) {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `状态 "${def.name}" 是 ${def.type} 类型，不能赋值为 ${JSON.stringify(value)}`,
            loc,
            { stateId: key },
          );
          return null;
        }
        if (def.type === "enum" && !(def.options ?? []).includes(String(value))) {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `状态 "${def.name}" 是下拉列表类型，${JSON.stringify(value)} 不在可选项里`,
            loc,
            { stateId: key },
          );
          return null;
        }
        if (opRaw !== "=" && def.type !== "number") {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `状态 "${def.name}" 不是数值类型，不能用 += / -=`,
            loc,
            { stateId: key },
          );
          return null;
        }
      }
      if (opRaw === "+=") return { type: "flag", key, value, op: "add" } as Step;
      if (opRaw === "-=") return { type: "flag", key, value, op: "sub" } as Step;
      return { type: "flag", key, value };
    }

    default:
      ctx.bag.warn(DIAG.STEP_UNRECOGNIZED, `未知指令 "@${name}"（已忽略）`, loc);
      return null;
  }
}

/* ------------------------- 文件解析 ------------------------- */

/**
 * 解析一个剧本文件。
 * 返回 label 列表（含步骤与菜单锚点）与诊断；不抛异常。
 */
export function parseScript(source: string, options: ParseScriptOptions): ScriptFileDoc {
  const bag = new DiagnosticBag();
  const file = options.file;
  const library = options.library ?? createLibrary();
  const states = options.states?.states ?? [];
  const stateById = new Map(states.map((s) => [s.id, s]));

  const labels: ScriptLabel[] = [];
  const byId = new Map<string, ScriptLabel>();
  let current: ScriptLabel | null = null;
  const unowned: number[] = [];

  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    const lineNo = i + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;
    const loc = { file, line: lineNo, column };

    // ---- @plot ----
    const labelMatch = line.match(/^@plot\s+(\S+)(?:\s+(.+))?$/);
    if (labelMatch) {
      const [, id, rawRest] = labelMatch;
      const { name, plotline, position } = splitLabelLine(rawRest ?? "", bag, loc);
      if (!name) {
        bag.warn(DIAG.LABEL_MISSING_NAME, `label "${id}" 缺少显示名称，暂用 ID 代替`, loc, { labelId: id });
      }
      if (byId.has(id)) {
        bag.error(DIAG.LABEL_DUPLICATE_ID, `label ID "${id}" 在本文件中重复`, loc, { labelId: id });
        current = byId.get(id)!;
        continue;
      }
      const label: ScriptLabel = {
        id,
        name: name || id,
        ...(plotline ? { plotline } : {}),
        ...(position ? { position } : {}),
        file,
        line: lineNo,
        endLine: lines.length,
        steps: [],
        menus: [],
      };
      labels.push(label);
      byId.set(id, label);
      if (current) current.endLine = lineNo - 1;
      current = label;
      continue;
    }

    // ---- @label / @node（旧片段锚点，已移除）----
    // 不再解析：命中时给出明确报错，避免片段被悄悄丢掉
    if (/^@(label|node)\b/.test(line)) {
      const legacyName = line.slice(1).split(/\s+/)[0];
      bag.error(
        DIAG.LABEL_LEGACY_ANCHOR,
        `@${legacyName} 已移除，请改用 @plot <id> <显示名称>`,
        loc,
      );
      continue;
    }

    // ---- @menu（已废弃）----
    // 菜单不再写在剧本里：由项目文件里的菜单定义按 labelId 挂到片段上
    if (/^@menu\b/.test(line)) {
      bag.error(
        DIAG.STEP_DIRECTIVE_ERROR,
        "@menu 已废弃：菜单不写在剧本里，请在「剧情编排」中选中片段后添加菜单",
        loc,
      );
      continue;
    }

    // ---- 指令 ----
    if (line.startsWith("@")) {
      const step = parseStepDirective(line, { ...loc, bag, library, stateById });
      if (!step) continue;
      if (!current) {
        unowned.push(lineNo);
        continue;
      }
      current.steps.push(step);
      continue;
    }

    // ---- 文档文本（旧标题等）----
    if (line.startsWith("#")) continue;

    // ---- 零符号对白已移除：`角色：台词` / `角色（心声）：台词` 一律报错 ----
    const dialog = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (dialog) {
      const who = dialog[1].trim();
      const inner = /[（(]\s*心声\s*[)）]$/.test(who);
      const speaker = who.replace(/\s*[（(]\s*心声\s*[)）]$/, "");
      bag.error(
        DIAG.STEP_DIALOG_LEGACY,
        `零符号对白已移除，请改用 @actor ${speaker} #${inner ? "inner" : "say"} ${dialog[2].trim()}`,
        { file, line: lineNo, column: 1 },
      );
      continue;
    }

    if (!current) {
      unowned.push(lineNo);
      continue;
    }
    bag.warn(DIAG.STEP_UNRECOGNIZED, `无法识别的行（已忽略）：${line.slice(0, 40)}`, loc);
  }

  // 空文件 / 无 label
  if (labels.length === 0) {
    bag.warn(
      DIAG.FILE_EMPTY,
      `${file} 中没有 @plot 片段；该文件内容不会进入编排`,
      { file, line: 1, column: 1 },
    );
  }
  if (unowned.length > 0) {
    bag.warn(
      DIAG.LABEL_UNOWNED_CONTENT,
      `文件开头有 ${unowned.length} 行内容不属于任何 @plot（行 ${unowned.slice(0, 5).join(", ")}${unowned.length > 5 ? " …" : ""}），请在「剧情编排」中指定归属或补充 @plot`,
      { file, line: unowned[0], column: 1 },
      { lines: unowned },
    );
  }

  // 空片段提示
  for (const label of labels) {
    if (label.steps.length === 0 && label.menus.length === 0) {
      bag.warn(
        DIAG.LABEL_EMPTY,
        `片段「${label.name}」没有任何内容或菜单`,
        { file, line: label.line, column: 1 },
        { labelId: label.id },
      );
    }
  }

  return { file, labels, diagnostics: bag.list };
}

/** 收集文件里引用的菜单 ID（编排校验用） */
export function collectMenuRefs(doc: ScriptFileDoc): { menuId: string; file: string; line: number; labelId: string }[] {
  const out: { menuId: string; file: string; line: number; labelId: string }[] = [];
  for (const label of doc.labels) {
    for (const m of label.menus) out.push({ menuId: m.menuId, file: doc.file, line: m.line, labelId: label.id });
  }
  return out;
}

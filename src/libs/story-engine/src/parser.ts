/**
 * DSL 文本解析器 —— 把作者手写的剧本编译为标准骨架包
 *
 * 支持的剧本语法（作者友好）：
 *
 *   # 幕一 · 序章              → act 节点
 *   ## 章1 · 不速之客           → chapter 节点
 *   ### 场景：深夜大厅          → scene 节点（冒号后是标题）
 *
 *   @bg 大厅(渐入2秒)          → 背景 bg 步骤
 *   @bgm 主题曲(渐入2秒)       → BGM 步骤
 *   @sfx 敲门声               → 音效 sfx 步骤
 *   @sprite A 微笑/左         → 立绘 sprite 步骤（表情/位置用 / 分隔，可省略）
 *   @effect flash             → 画面特效 effect 步骤
 *   @flag 勇气=true           → 状态变更 flag 步骤
 *   @task 与来客交谈           → 任务槽位 task 步骤
 *   @vo 你环顾四周，空无一人     → 旁白 narration 步骤
 *
 *   A：你终于来了，等你好久。              → dialog 对话步骤（零符号）
 *
 *   - 回应A → 跳转 章1·场景2               → 选项（结局定义器）
 *   - 沉默   → 跳转 章1·场景3
 *
 * 设计约定：除对话外，所有步骤统一用 @name 指令形式（英文名，@ 后直接跟指令名）。
 * 旁白用 @vo 指令。不再支持 branch 分支指令。
 *
 * 素材 id 化：
 *  - 素材（bg/bgm/sfx/sprite）解析时按 (kind, 名字) 同名归并，复用同一素材 id。
 *  - 素材 id 由系统生成（见 library.ts），对作者隐式；名字可改名、id 引用不断裂。
 *  - 对话 speaker 是显示用名字，不绑定素材（人物形象由 @sprite 立绘素材决定）。
 *
 * 解析结果：id 自动生成（act_1 / ch_1 / sc_标题slug / res_0001 ...），
 * 场景标题用于 choices 中跳转的匹配（也支持直接写场景 id）。
 */

import type {
  Skeleton,
  Node,
  Step,
  Choice,
  Asset,
} from "./types.ts";
import {
  createLibrary,
  resolveAsset,
  type AssetLibrary,
} from "./library.ts";

/* ------------------------- id 生成 ------------------------- */

class IdGen {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}

/** 把中文标题里的数字/符号清理成安全 id 片段 */
function slug(s: string): string {
  return s
    .replace(/[^\w\u4e00-\u9fa5]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 12);
}

/* ------------------------- 指令解析 ------------------------- */

/**
 * 解析 @name 指令（资源类 + 逻辑类统一入口），格式如：
 *   @bg 大厅(渐入2秒)
 *   @bgm 主题曲(2)
 *   @sfx 敲门声
 *   @sprite A 微笑/左
 *   @effect flash
 *   @flag 勇气=true
 *   @task 与来客交谈
 *
 * 约定：指令名统一英文，@ 后直接跟指令名，参数用空格分隔。
 * 资源 id 自动生成，path 先用资源名占位（后续编辑器绑定真实文件）。
 */
interface AssetDirective {
  step: Step;
}

const ASSET_KIND_MAP: Record<string, { kind: Asset["kind"]; stepType: "bg" | "bgm" | "sfx" | "sprite" }> = {
  "bg": { kind: "image", stepType: "bg" },
  "bgm": { kind: "audio", stepType: "bgm" },
  "sfx": { kind: "audio", stepType: "sfx" },
  "sprite": { kind: "sprite", stepType: "sprite" },
};

/** 解析 @name 指令为一步（资源类会顺带产出资源条目） */
function parseDirective(
  body: string,
  idGen: IdGen,
  lib: AssetLibrary,
): AssetDirective {
  // 去掉前导 @，指令名为其后到空白或行尾的部分
  const m0 = body.match(/^@(\w+)(?:\s+(.*))?$/);
  if (!m0) {
    throw new Error(`无法解析指令（应为 @name 参数 形式）: "${body}"`);
  }
  const name = m0[1];
  const args = (m0[2] ?? "").trim();

  switch (name) {
    // ---- 立绘：@sprite A 微笑/左 ----
    case "sprite": {
      const spriteM = args.match(/^(\S+)(?:\s+([^()\s]+(?:\/[^()\s]+)*))?$/);
      if (!spriteM) {
        throw new Error(`无法解析 sprite 指令: "${body}"`);
      }
      const [, charName, optsRaw] = spriteM;
      const [pose, position] = optsRaw ? optsRaw.split("/") : [undefined, undefined];
      // 立绘素材：按 (sprite, 人物名) 归并，同名复用同一素材 id
      const assetId = resolveAsset(lib, charName, "sprite");
      return {
        step: {
          type: "sprite",
          channel: "sprite",
          asset: assetId,
          pose: pose?.trim() || undefined,
          position: position?.trim() || undefined,
          enter: true,
        },
      };
    }

    // ---- 特效：@effect flash ----
    case "effect": {
      if (!args) throw new Error(`effect 指令缺少特效名: "${body}"`);
      return { step: { type: "effect", channel: "fx", effect: args } };
    }

    // ---- flag：@flag 勇气=true ----
    case "flag": {
      const flagM = args.match(/^([\w\u4e00-\u9fa5]+)\s*=\s*(.+)$/);
      if (!flagM) {
        throw new Error(`无法解析 flag 指令（应为 键=值）: "${body}"`);
      }
      const [, key, rawVal] = flagM;
      let value: unknown = rawVal.trim();
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^-?\d+(\.\d+)?$/.test(value as string)) value = Number(value);
      return { step: { type: "flag", key, value } };
    }

    // ---- task：@task 与来客交谈 ----
    case "task": {
      if (!args) throw new Error(`task 指令缺少任务描述: "${body}"`);
      return { step: { type: "task", taskId: slug(args), description: args, status: "active" } };
    }

    // ---- 旁白：@vo 你环顾四周 ----
    case "vo": {
      if (!args) throw new Error(`vo 指令缺少旁白内容: "${body}"`);
      return { step: { type: "narration", channel: "vo", text: args } };
    }

    // ---- 资源类：bg / bgm / sfx ----
    default: {
      const map = ASSET_KIND_MAP[name];
      if (!map) {
        throw new Error(`未知指令类型: "@${name}"`);
      }
      // 匹配 资源名 + 可选 (参数)
      const resM = args.match(/^(.+?)(?:\(([^)]*)\))?$/);
      if (!resM || !resM[1].trim()) {
        throw new Error(`无法解析资源指令: "${body}"`);
      }
      const assetName = resM[1].trim();
      const paramsRaw = resM[2];

      // 素材：按 (kind, 名字) 归并，同名复用同一素材 id
      const assetId = resolveAsset(lib, assetName, map.kind);

      let step: Step;
      if (map.stepType === "bgm") {
        const fade = paramsRaw ? parseFade(paramsRaw) : undefined;
        step = { type: "bgm", channel: "bgm", asset: assetId, fade };
      } else if (map.stepType === "sfx") {
        step = { type: "sfx", channel: "sfx", asset: assetId };
      } else {
        const transition = paramsRaw ? `fade_in_${parseFade(paramsRaw)}s` : undefined;
        step = { type: "bg", channel: "bg", asset: assetId, transition };
      }

      return { step };
    }
  }
}

function parseFade(params: string): number {
  const m = params.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 2;
}

/* ------------------------- 主解析器 ------------------------- */

/**
 * 解析 DSL 文本 → 骨架包。
 *
 * @param source  DSL 文本
 * @param meta    骨架包元数据（标题等）
 * @param library 可选：已有素材库（实现同名归并跨会话稳定）。传入时复用其中的素材 id；
 *                不传则新建空库（素材 id 仅本次解析内稳定）。
 *
 * 返回的 Skeleton.assets 是本次解析「用到的素材」快照（与 library 共享 id）。
 */
export function parseDSL(
  source: string,
  meta?: Partial<Skeleton["meta"]>,
  library?: AssetLibrary,
): Skeleton {
  const idGen = new IdGen();
  const lines = source.split(/\r?\n/);

  const nodes: Record<string, Node> = {};
  const steps: Record<string, Step> = {};
  const choices: Record<string, Choice[]> = {};

  /** 素材库：优先用传入的（跨会话归并），否则新建 */
  const lib: AssetLibrary = library ?? createLibrary();

  let currentAct: Node | null = null;
  let currentChapter: Node | null = null;
  let currentScene: Node | null = null;

  /** 标题→场景 id 的映射（供选项跳转匹配） */
  const sceneByTitle = new Map<string, string>();

  const flushScene = () => {
    currentScene = null;
  };

  /* 第一遍：预扫描，建立「场景标题 → 场景 id」映射。
   * 这样选项可以引用后文才定义的场景（前向引用）。
   * 场景 id 用标题的 slug 确定性生成，保证预扫描与正式解析一致。 */
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("### ")) {
      const title = line.slice(4).trim();
      sceneByTitle.set(title, sceneIdOf(title));
    }
  }

  /** 场景 id 由标题确定性生成（保证前向引用一致） */
  function sceneIdOf(title: string): string {
    return `sc_${slug(title)}`;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ---- 幕 ----
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flushScene();
      const title = line.slice(2).trim();
      const act: Node = {
        id: `act_${idGen.next("act")}`,
        type: "act",
        title,
        children: [],
      };
      nodes[act.id] = act;
      currentAct = act;
      currentChapter = null;
      continue;
    }

    // ---- 章 ----
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flushScene();
      const title = line.slice(3).trim();
      const chapter: Node = {
        id: `ch_${idGen.next("ch")}`,
        type: "chapter",
        title,
        children: [],
      };
      nodes[chapter.id] = chapter;
      if (currentAct) currentAct.children.push(chapter.id);
      currentChapter = chapter;
      continue;
    }

    // ---- 场景 ----
    if (line.startsWith("### ")) {
      flushScene();
      const title = line.slice(4).trim();
      const scene: Node = {
        id: sceneIdOf(title),
        type: "scene",
        title,
        children: [],
      };
      nodes[scene.id] = scene;
      if (currentChapter) currentChapter.children.push(scene.id);
      currentScene = scene;
      continue;
    }

    // ---- 选项（结局定义器）----
    if (line.startsWith("- ")) {
      if (!currentScene) {
        throw new Error(`选项必须在场景内定义: "${line}"`);
      }
      const body = line.slice(2).trim();
      const choice = parseChoice(body, sceneByTitle, nodes);
      if (!choices[currentScene.id]) choices[currentScene.id] = [];
      choices[currentScene.id].push(choice);
      continue;
    }

    // ---- 指令 @name（资源类 + 逻辑类统一） ----
    if (line.startsWith("@")) {
      if (!currentScene) {
        throw new Error(`指令必须在场景内定义: "${line}"`);
      }
      const { step } = parseDirective(line, idGen, lib);
      const sid = `st_${idGen.next("st")}`;
      steps[sid] = step;
      currentScene.children.push(sid);
      continue;
    }

    // ---- 对话   A：你终于来了 ----
    const dialogMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (dialogMatch && currentScene) {
      const [, speaker, text] = dialogMatch;
      const sid = `st_${idGen.next("st")}`;
      steps[sid] = { type: "dialog", channel: "say", speaker: speaker.trim(), text: text.trim() };
      currentScene.children.push(sid);
      continue;
    }

    // 未识别的行，忽略（宽松解析）
  }

  // 确定入口：第一个场景
  const firstScene = Object.values(nodes).find((n) => n.type === "scene");
  if (!firstScene) {
    throw new Error("剧本中没有定义任何场景");
  }

  return {
    meta: { title: "未命名剧本", version: 1, ...(meta ?? {}) },
    nodes,
    steps,
    assets: lib.data.items,
    choices,
    entry: firstScene.id,
  };
}

/* ------------------------- 选项解析 ------------------------- */

/**
 * 解析选项行，如：
 *   - 回应A → 跳转 章1·场景2
 *   - 沉默   → 跳转 sc_1_1_3
 *   - 拒绝   → 跳转 结局·bad  (条件: flag('好感')<3)
 */
function parseChoice(
  body: string,
  sceneByTitle: Map<string, string>,
  nodes: Record<string, Node>,
): Choice {
  // 可选条件：  (... 条件: xxx)
  const condMatch = body.match(/\((.+?)[:：]\s*(.+?)\)$/);
  let require: string | undefined;
  let main = body;
  if (condMatch) {
    require = condMatch[2].trim();
    main = body.slice(0, condMatch.index).trim();
  }

  // 拆 文本 → 跳转目标
  const m = main.match(/^(.+?)\s*→\s*(?:跳转\s*)?(.+)$/);
  if (!m) {
    throw new Error(`选项格式错误（需含 "→ 跳转 目标"）: "${body}"`);
  }
  const text = m[1].trim();
  const targetRaw = m[2].trim();

  // 目标可能是场景标题，也可能是场景 id
  let goto: string;
  if (nodes[targetRaw]) {
    goto = targetRaw;
  } else if (sceneByTitle.has(targetRaw)) {
    goto = sceneByTitle.get(targetRaw)!;
  } else {
    // 尝试模糊匹配标题（含「章1·场景2」这类带层级前缀的）
    goto = resolveTarget(targetRaw, sceneByTitle, nodes);
  }

  return { text, goto, require };
}

/** 模糊匹配跳转目标：支持纯场景标题、"章·场景"复合引用、场景 id */
function resolveTarget(
  raw: string,
  sceneByTitle: Map<string, string>,
  nodes: Record<string, Node>,
): string {
  // 1. 精确匹配场景 id
  if (nodes[raw]) return raw;

  // 2. 精确匹配场景标题
  if (sceneByTitle.has(raw)) return sceneByTitle.get(raw)!;

  // 3. "章标题·场景标题" 复合引用：取「·」后最后一段
  const segs = raw.split(/[·.、:：]/).map((s) => s.trim()).filter(Boolean);
  if (segs.length > 1) {
    const last = segs[segs.length - 1];
    if (sceneByTitle.has(last)) return sceneByTitle.get(last)!;
    // 也尝试匹配「章N·场景M」中的场景M（去掉"场景"前缀）
    const sceneNo = last.replace(/^场景/, "");
    for (const [title, id] of sceneByTitle) {
      if (title === sceneNo || title.replace(/^场景/, "") === sceneNo) return id;
    }
  }

  // 4. 包含匹配
  for (const [title, id] of sceneByTitle) {
    if (title.includes(raw) || raw.includes(title)) return id;
  }

  throw new Error(`无法解析跳转目标: "${raw}"（场景标题或 id 不存在）`);
}

/* ------------------------- 行内步骤解析 ------------------------- */

// 注意：所有步骤指令（bg/bgm/sfx/sprite/effect/flag/task/vo）已统一为 @name 形式，
// 统一在 parseDirective 中解析。对话为零符号写法，见主循环。


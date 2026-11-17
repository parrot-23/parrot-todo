/**
 * story-engine 统一出口
 *
 * 引擎内部（解析器 / 编排 / 运行时 / 素材库 / 诊断码）全部是黑盒，
 * 调用方只需要 import 本文件，不需要知道 Step、ProjectDoc、ProjectIO、LabelRuntime 的实现细节。
 *
 * 分区：
 *   §A 打开 / 保存 / 校验 / 派生   —— 项目级能力
 *   §B 查询（只读，给 UI 用）      —— 顺序出口、菜单结果、通道
 *   §C ID 生成                     —— 编辑器新增实体时用
 *   §D 播放                        —— createPlayer
 *   §E 素材                        —— 清单 + 素材库
 *   §F 旧骨架包（兼容）            —— parseDSL / StoryEngine
 *   §G 常量与类型                  —— 编辑器与调用方共用
 *
 * Node 环境请配合 `api-node.ts` 的 `openProjectFromDisk(root)`（那里引了 node:fs）。
 *
 * 约定：
 *  - 所有打开/校验函数不抛异常，问题一律进 diagnostics / error 事件。
 *  - `StoryProject.doc` 与 `StageCue.raw` 是编辑器专用逃逸口，普通接入不要用。
 */

import type { AssetKind, Step } from "./types.ts";
import type {
  Diagnostic,
  DiagnosticSource,
  MenuDefinition,
  MenuResult,
  Plotline,
  ProjectDoc,
  ScriptLabel,
  StateType,
} from "./project-types.ts";
import { isLocalDiagnostic } from "./project-diagnostics.ts";
import { loadProject, type LoadProjectOptions, type ProjectIO } from "./project-loader.ts";
import { LabelRuntime, type LabelEvent, type RuntimeMenu, type RuntimeOptions } from "./label-runtime.ts";
import { stepChannel } from "./channels.ts";
import {
  deriveConditionLinks,
  emptyMenuBook,
  emptyOrchestration,
  emptyPlotlineBook,
  emptyStateModule,
  hasMenuExit as docHasMenuExit,
  labelPlayOrder,
  menuResults,
  nextLabelId,
  plotlineOfLabel as docPlotlineOfLabel,
  syncPlotlinesFromLabels,
  validateProject,
} from "./orchestration.ts";
import { serializeProjectBundle } from "./project-bundle.ts";
import { serializeLibrary } from "./library.ts";
import { collectAssetNeeds } from "./project-loader.ts";
import { PROJECT_FILE_NAME } from "./project-layout.ts";

/* ========================================================================== *
 * 一、只读视图（调用方看到的数据形状）
 * ========================================================================== */

/** 诊断（比内部 Diagnostic 更扁，去掉 data 等内部字段） */
export interface StoryIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** 来源域：script / state / menu / orchestration / plotline / asset / project / runtime */
  source?: DiagnosticSource;
  file?: string;
  line?: number;
}

/** 片段概要 */
export interface StoryLabelInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  /** 所属情节线名称；未声明时为「主线」 */
  plotline: string;
  /** 位置标签（起点 / 铺垫 / 高潮 / 转折 / 结局，或作者自定） */
  position?: string;
  /** 片段内步骤数 */
  stepCount: number;
}

/** 状态值定义 */
export interface StoryStateInfo {
  id: string;
  name: string;
  type: "boolean" | "number" | "string" | "enum";
  initial: unknown;
  min?: number;
  max?: number;
  options?: string[];
}

/** 情节线 */
export interface StoryPlotlineInfo {
  id: string;
  name: string;
  kind: "main" | "branch" | "thread";
  type?: string;
  optional?: boolean;
}

/** 菜单概要 */
export interface StoryMenuInfo {
  id: string;
  title: string;
  labelId: string;
  labelName: string;
  /** 在片段内触发的位置（播完前 N 步之后；等于 stepCount 表示末尾） */
  index: number;
  /** out = 选择后按编排跳转；back = 选择后回到本片段继续 */
  jump: "out" | "back";
  options: MenuResult[];
}

/** 素材条目 */
export interface StoryAssetInfo {
  id: string;
  name: string;
  kind: "image" | "audio" | "video" | "sprite" | "font";
  /** 绑定文件路径（相对项目根或绝对路径）；未绑定时为占位 */
  path: string;
}

/** 打开后的项目（调用方唯一持有的对象） */
export interface StoryProject {
  /** 项目根目录（原样回传） */
  root: string;
  /** 入口片段 id；未配置时为 null */
  entry: string | null;
  /** 是否可以播放（= 没有 error 级诊断） */
  ok: boolean;
  /** 剧本文件（相对项目根，已排序） */
  files: string[];
  /** 全部片段（按播放顺序：文件顺序 + 源码行号） */
  labels: StoryLabelInfo[];
  states: StoryStateInfo[];
  plotlines: StoryPlotlineInfo[];
  menus: StoryMenuInfo[];
  assets: StoryAssetInfo[];
  diagnostics: StoryIssue[];
  /**
   * 编辑器逃逸口：需要就地编辑项目结构（菜单 / 编排 / 状态）时才用。
   * 播放器接入不需要碰它。
   */
  readonly doc: ProjectDoc;
}

/** 编辑器 / 工具链也可以直接传 ProjectDoc，所有项目级方法都接受这两种形态 */
export type ProjectLike = StoryProject | ProjectDoc;

/* ========================================================================== *
 * §A 打开 / 保存 / 校验 / 派生
 * ========================================================================== */

/**
 * 从任意文件系统抽象打开项目。
 *
 * `io` 只要求 4 个同步方法：readText / exists / listFiles / listDirs。
 * - Node / CLI / Electron 主进程：用 `api-node.ts` 的 `openProjectFromDisk(root)`。
 * - 浏览器 / 渲染进程：用 `openProjectFromSnapshot(root, snapshot)`。
 * - 其它（内存、远程）：自行实现这 4 个方法，或用 `snapshotIO`。
 */
export function openProject(
  root: string,
  io: ProjectIO,
  options: LoadProjectOptions = {},
): StoryProject {
  return toStoryProject(loadProject(root, io, options));
}

/** 浏览器 / Electron 渲染进程用：先拿整棵文件树快照，再同步加载 */
export interface ProjectSnapshot {
  /** 相对项目根的全部文件路径（"/" 分隔） */
  files: string[];
  /** 相对项目根的全部目录路径 */
  dirs: string[];
  /** 文件路径 → 文本内容（只需剧本 / json） */
  text: Record<string, string>;
}

export function openProjectFromSnapshot(root: string, snapshot: ProjectSnapshot): StoryProject {
  return openProject(root, snapshotIO(snapshot));
}

/** 把项目快照转成 ProjectIO */
export function snapshotIO(snapshot: ProjectSnapshot): ProjectIO {
  const norm = (rel: string) => rel.replace(/^[\\/]+|[\\/]+$/g, "").replace(/\\/g, "/");
  return {
    readText(rel) {
      const key = norm(rel);
      return Object.prototype.hasOwnProperty.call(snapshot.text, key) ? snapshot.text[key] : null;
    },
    exists(rel) {
      const key = norm(rel);
      return snapshot.files.includes(key) || snapshot.dirs.includes(key);
    },
    listFiles(relDir) {
      const dir = norm(relDir);
      const prefix = dir ? `${dir}/` : "";
      return snapshot.files
        .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
        .map((f) => f.slice(prefix.length))
        .sort();
    },
    listDirs(relDir) {
      const dir = norm(relDir);
      const prefix = dir ? `${dir}/` : "";
      return snapshot.dirs
        .filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/"))
        .map((d) => d.slice(prefix.length))
        .sort();
    },
  };
}

/**
 * 把项目序列化回磁盘内容。
 * 返回两个文件的文本，写入位置由调用方决定：
 *   projectJson → story.project.json
 *   assetsJson  → assets.json
 */
export function saveProject(target: ProjectLike): { projectJson: string; assetsJson: string } {
  const doc = asDoc(target);
  return {
    projectJson: serializeProjectBundle(doc),
    assetsJson: serializeLibrary({ data: doc.assets, nameIndex: new Map() }),
  };
}

/** 就地校验：重算「菜单 / 编排 / 情节线」类诊断，保留脚本解析与素材诊断基线 */
export function revalidate(target: ProjectLike): StoryIssue[] {
  const doc = asDoc(target);
  const merged = [...baseIssuesOf(doc), ...validateProject(doc)];
  return writeIssues(target, doc, merged);
}

/**
 * 重新读盘后校验：用磁盘上的最新内容刷新「脚本解析 / 素材」基线，
 * 再就地重算菜单与编排诊断（不替换调用方持有的项目对象）。
 */
export function refreshIssues(target: ProjectLike, io: ProjectIO): StoryIssue[] {
  const doc = asDoc(target);
  const fresh = loadProject(doc.root || "", io);
  const merged = [...baseIssuesOf(fresh), ...validateProject(doc)];
  return writeIssues(target, doc, merged);
}

/**
 * 重算条件出口派生连线。
 * `menus` 是条件出口的唯一真相；每次编辑菜单/编排后调用，落盘时会自动剔除派生项。
 */
export function resyncLinks(target: ProjectLike): void {
  const doc = asDoc(target);
  doc.orchestration.links = deriveConditionLinks(doc.menus, doc.orchestration).links;
}

/* ========================================================================== *
 * §B 查询（只读）
 * ========================================================================== */

/** 顺序出口上的下一个片段（"下一个" = 文件顺序 + 源码行号） */
export function nextLabelOf(target: ProjectLike, labelId: string): string | null {
  return nextLabelId(asDoc(target), labelId);
}

/** 片段是否自带跳出型剧情选项菜单（有则不需要默认顺序出口） */
export function hasMenuExit(target: ProjectLike, labelId: string): boolean {
  return docHasMenuExit(asDoc(target), labelId);
}

/** 菜单的全部可能结果（文案 / 结果 ID / 条件 / 状态效果） */
export function menuOptions(menu: MenuDefinition | undefined): MenuResult[] {
  return menuResults(menu);
}

/** 片段列表（按播放顺序） */
export function labelsOf(target: ProjectLike): StoryLabelInfo[] {
  const doc = asDoc(target);
  return labelPlayOrder(doc).map(toLabelInfo);
}

/** label 表 → 片段数组（编辑器左栏 / 归属列表用，排序同播放顺序） */
export { labelList } from "./orchestration.ts";

/** 片段归属的情节线（未归属返回 null） */
export function plotlineOfLabel(target: ProjectLike, labelId: string): Plotline | null {
  return docPlotlineOfLabel(asDoc(target), labelId) ?? null;
}

/**
 * 就地同步情节线归属：以剧本 `@plot ... #情节线` 为唯一真相，
 * 重建主线 / 支线段落与 labelIds，并清理失效引用（线索线只清理不重建）。
 */
export function syncPlotlines(target: ProjectLike): void {
  const doc = asDoc(target);
  doc.plotlines = syncPlotlinesFromLabels(doc.labels, doc.plotlines);
}

/**
 * 生成一条状态条件表达式（编辑器"状态 + 运算符 + 值"面板用）。
 * 统一由引擎产出语法，避免编辑器手拼 `flag('x') === y` 造成漂移。
 */
export function buildFlagCondition(
  stateId: string,
  op: string,
  rawValue: string,
  type?: StateType,
): string {
  const raw = rawValue.trim();
  if (type === "number" || type === "boolean") {
    const value = raw || (type === "boolean" ? "true" : "0");
    return `flag('${stateId}') ${op} ${value}`;
  }
  return `flag('${stateId}') ${op} '${raw.replace(/'/g, "\\'")}'`;
}

/**
 * 新建空项目的磁盘内容（脚手架用）。
 * 返回的文本直接写 `story.project.json` / `assets.json`，schema 由引擎维护。
 */
export function createEmptyProject(options: { entry?: string } = {}): {
  projectJson: string;
  assetsJson: string;
} {
  const doc: ProjectDoc = {
    root: "",
    files: [],
    scripts: [],
    labels: {},
    states: emptyStateModule(),
    menus: emptyMenuBook(),
    // 空项目也带上主线，情节线页才有东西可看（与载入后的规范化结果一致）
    plotlines: syncPlotlinesFromLabels({}, emptyPlotlineBook()),
    orchestration: { ...emptyOrchestration(), entry: options.entry ?? "" },
    assets: { nextId: 1, items: {} },
    diagnostics: [],
  };
  return {
    projectJson: serializeProjectBundle(doc),
    assetsJson: serializeLibrary({ data: doc.assets, nameIndex: new Map() }),
  };
}

/* ========================================================================== *
 * §C ID 生成（编辑器新增实体时用）
 * ========================================================================== */

export { makeLabelId, makeMenuId, makeResultId, makeStateId } from "./label-parser.ts";
export { makePlotlineId } from "./orchestration.ts";

/* ========================================================================== *
 * §D 播放
 * ========================================================================== */

/**
 * 一条演出指令（cue）——渲染层的全部输入。
 *
 * `kind` 已经替调用方做完「谁以什么方式发出」的判断，直接 switch 即可：
 *   say 台词 / inner 心声 / act 动作 / vo 旁白 / sprite 立绘 /
 *   bg 背景 / bgm 音乐 / sfx 音效 / fx 特效 / item 物品 /
 *   state 状态变更（无需渲染）/ task 任务（旧项目才会出现）
 */
export type CueKind =
  | "say"
  | "inner"
  | "act"
  | "vo"
  | "sprite"
  | "bg"
  | "bgm"
  | "sfx"
  | "fx"
  | "item"
  | "state"
  | "task";

export interface StageCue {
  kind: CueKind;
  /** 出自哪个片段 */
  labelId: string;
  /** 片段内第几步（0 基） */
  index: number;
  /** 说话人 / 施动角色（say / inner / act） */
  speaker?: string;
  /** 文本（say / inner / act / vo / task） */
  text?: string;
  /** 素材（bg / sprite / bgm / sfx / item） */
  assetId?: string;
  assetName?: string;
  assetPath?: string;
  /** 立绘表情与站位（站位缺省为 left） */
  pose?: string;
  position?: string;
  enter?: boolean;
  /** 音乐渐入秒数（bgm） */
  fade?: number;
  /** 背景转场（bg，如 fade_in_2s） */
  transition?: string;
  /** 特效名（fx） */
  effect?: string;
  /** 特效参数（fx） */
  params?: Record<string, unknown>;
  /** 状态键与新值（state） */
  stateKey?: string;
  stateValue?: unknown;
  /** 任务 id（task） */
  taskId?: string;
  /**
   * 编辑器逃逸口：产生这条 cue 的原始步骤。
   * 外部接入请忽略（渲染只需要上面的字段）。
   */
  raw?: Step;
}

/** 弹给玩家的菜单 */
export interface ChoiceMenu {
  menuId: string;
  labelId: string;
  title: string;
  /** 跳出 / 回归 */
  jump: "out" | "back";
  options: MenuResult[];
}

/** 播放器状态 */
export type PlaybackStatus = "idle" | "playing" | "awaiting-menu" | "finished" | "error";

/** next() 的推进结果 */
export type PlaybackStep = "cue" | "menu" | "finished" | "error" | "idle";

/** advance() 的结果：比 next() 多带一条 cue 本体 */
export interface AdvanceResult {
  result: PlaybackStep;
  cue?: StageCue;
}

/** 播放事件 */
export type PlayEvent =
  | { type: "enter"; labelId: string; labelName: string }
  | { type: "cue"; cue: StageCue }
  | { type: "menu"; menu: ChoiceMenu }
  | { type: "state"; id: string; name: string; value: unknown; previous: unknown }
  | { type: "path"; from: string; to: string; reason: string }
  | { type: "end"; reason: "explicit" | "no-exit" | "error" }
  | { type: "error"; code: string; message: string };

/** 任意时刻的播放快照（存档直接存这个） */
export interface PlaybackSnapshot {
  status: PlaybackStatus;
  labelId: string;
  labelName: string;
  stepIndex: number;
  flags: Record<string, unknown>;
  menu: ChoiceMenu | null;
  /** 走过的片段顺序 */
  path: string[];
  /** 人读日志 */
  log: string[];
  error: { code: string; message: string } | null;
}

/** 播放器：调用方只需要这 6 个方法 */
export interface StoryPlayer {
  /** 订阅事件，返回退订函数 */
  on(listener: (e: PlayEvent) => void): () => void;
  /** 开始播放（不传 labelId 则从项目入口开始）；返回是否成功 */
  start(labelId?: string): boolean;
  /** 重开：清空状态回到入口 / 指定片段 */
  restart(labelId?: string): boolean;
  /** 推进一帧，见 PlaybackStep */
  next(): PlaybackStep;
  /** 推进一帧并返回本条 cue（编辑器逐条播放用） */
  advance(): AdvanceResult;
  /** 在当前菜单里选一项（传 resultId），返回是否成功 */
  choose(resultId: string): boolean;
  /** 当前状态快照 */
  snapshot(): PlaybackSnapshot;
}

export interface PlayerOptions {
  /** 起始片段；缺省用项目入口 */
  startLabel?: string;
  /** 循环保护：累计重复进入已访问片段的次数上限，默认 200 */
  maxRepeats?: number;
}

/**
 * 创建播放器。
 *
 * ```ts
 * const player = createPlayer(project);
 * player.on((e) => { if (e.type === "cue") render(e.cue); });
 * player.start();
 * player.next();                        // 一直调，直到返回 "menu" / "finished"
 * player.choose(player.snapshot().menu!.options[0].resultId);
 * ```
 */
export function createPlayer(target: ProjectLike, options: PlayerOptions = {}): StoryPlayer {
  const doc = asDoc(target);
  const runtimeOptions: RuntimeOptions = {
    ...(options.startLabel ? { startLabel: options.startLabel } : {}),
    ...(options.maxRepeats != null ? { maxRepeats: options.maxRepeats } : {}),
  };
  const runtime = new LabelRuntime(doc, runtimeOptions);
  const listeners = new Set<(e: PlayEvent) => void>();
  const stateNames = new Map(doc.states.states.map((s) => [s.id, s.name]));
  /** 最近一条 cue：advance() 用它返回本体，事件派发不受影响 */
  let lastCue: StageCue | null = null;

  const emit = (e: PlayEvent) => {
    for (const fn of listeners) fn(e);
  };

  const toMenu = (menu: RuntimeMenu): ChoiceMenu => ({
    menuId: menu.menuId,
    labelId: menu.labelId,
    title: menu.title,
    jump: menu.jump,
    options: menu.results.map((r) => ({ ...r })),
  });

  runtime.subscribe((e: LabelEvent) => {
    switch (e.type) {
      case "label:enter":
        emit({ type: "enter", labelId: e.labelId, labelName: e.name });
        break;
      case "step": {
        const cue = buildCue(doc, e.step, e.labelId, e.index);
        lastCue = cue;
        emit({ type: "cue", cue });
        break;
      }
      case "menu:open":
        emit({ type: "menu", menu: toMenu(e.menu) });
        break;
      case "state:change":
        emit({
          type: "state",
          id: e.stateId,
          name: stateNames.get(e.stateId) ?? e.stateId,
          value: e.value,
          previous: e.previous,
        });
        break;
      case "path":
        emit({ type: "path", from: e.from, to: e.to, reason: e.reason });
        break;
      case "end":
        emit({ type: "end", reason: e.reason });
        break;
      case "error":
        emit({ type: "error", code: e.diagnostic.code, message: e.diagnostic.message });
        break;
      default:
        // menu:resolved 属于内部追踪，不对外派发
        break;
    }
  });

  const next = (): PlaybackStep => {
    const result = runtime.stepOnce();
    if (result === "step") return "cue";
    if (result === "pause") return "menu";
    if (result === "finished") return "finished";
    return runtime.state.status === "error" ? "error" : "idle";
  };

  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(labelId) {
      return runtime.start(labelId);
    },

    restart(labelId) {
      return runtime.reset(labelId);
    },

    next,

    advance(): AdvanceResult {
      const result = next();
      const cue = lastCue ?? undefined;
      lastCue = null;
      return cue ? { result, cue } : { result };
    },

    choose(resultId) {
      return runtime.choose(resultId);
    },

    snapshot(): PlaybackSnapshot {
      const s = runtime.state;
      return {
        status: s.status,
        labelId: s.labelId,
        labelName: doc.labels[s.labelId]?.name ?? s.labelId,
        stepIndex: s.stepIndex,
        flags: { ...s.flags },
        menu: s.menu ? toMenu(s.menu) : null,
        path: [...s.path],
        log: [...s.log],
        error: s.error ? { code: s.error.code, message: s.error.message } : null,
      };
    },
  };
}

/** 把一条内部步骤翻译成调用方可直接渲染的 cue（高级用法） */
export function describeStep(
  target: ProjectLike,
  step: Step,
  labelId = "",
  index = -1,
): StageCue {
  return buildCue(asDoc(target), step, labelId, index);
}

/* ========================================================================== *
 * §E 素材
 * ========================================================================== */

/** 剧本需要的素材（素材管理 / 资源导入用） */
export interface StoryAssetNeed {
  kind: "sprite" | "image" | "audio";
  name: string;
  assetId: string;
  /** 已绑定路径（未绑定时为占位或空串） */
  path: string;
  /** 由哪条指令产生 */
  from: "bg" | "sprite" | "bgm" | "sfx" | "item";
  labelId: string;
}

/**
 * 收集剧本真正用到的素材（同名同类型只出现一次）。
 * @param file 只统计某个剧本文件（相对项目根，或裸文件名）
 */
export function collectAssets(target: ProjectLike, file?: string): StoryAssetNeed[] {
  const doc = asDoc(target);
  return collectAssetNeeds(doc, file).map((n) => ({
    ...n,
    path: doc.assets.items[n.assetId]?.path ?? "",
  }));
}

/**
 * 素材清单（按 id 排序）。`project.doc.assets` 是素材的唯一权威，
 * 素材页读写都走这里，不要另外维护一份素材库副本。
 */
export function assetsOf(target: ProjectLike): StoryAssetInfo[] {
  return Object.values(asDoc(target).assets.items)
    .filter((a) => Boolean(a && a.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, path: a.path }));
}

/** 按 id 取素材（不存在返回 null） */
export function assetOf(target: ProjectLike, assetId: string): StoryAssetInfo | null {
  const a = asDoc(target).assets.items[assetId];
  return a ? { id: a.id, name: a.name, kind: a.kind, path: a.path } : null;
}

/**
 * 按 (kind, name) 归并查询/创建素材，返回素材 id。
 * 未命中时新建，占位路径默认 `assets/<image|sprite|audio>/<name>`，可由调用方覆盖。
 */
export function ensureAsset(
  target: ProjectLike,
  name: string,
  kind: AssetKind,
  path?: string,
): string {
  const doc = asDoc(target);
  for (const [id, a] of Object.entries(doc.assets.items)) {
    if (a && a.kind === kind && a.name === name) return id;
  }
  const id = `res_${String(doc.assets.nextId).padStart(4, "0")}`;
  doc.assets.nextId += 1;
  const dir = kind === "sprite" ? "characters" : kind === "audio" ? "audio" : "scenes";
  doc.assets.items[id] = {
    id,
    kind,
    name,
    path: path ?? `assets/${dir}/${name}`,
  };
  return id;
}

/** 绑定/改回占位：设置素材的真实文件路径 */
export function setAssetPath(target: ProjectLike, assetId: string, path: string): boolean {
  const item = asDoc(target).assets.items[assetId];
  if (!item) return false;
  item.path = path;
  return true;
}

/** 素材改名（id 不变，引用不断；不做同名合并） */
export function setAssetName(target: ProjectLike, assetId: string, name: string): boolean {
  const item = asDoc(target).assets.items[assetId];
  if (!item) return false;
  item.name = name;
  return true;
}

/* ========================================================================== *
 * §F 旧骨架包（兼容层）
 * ========================================================================== */

export { parseDSL } from "./parser.ts";
export { StoryEngine } from "./engine.ts";

/* ========================================================================== *
 * §G 常量 / 素材库工具 / 通道工具
 * ========================================================================== */

export { PROJECT_FILE_NAME };
export { STORY_DIR, LEGACY_PROJECT_FILES } from "./project-layout.ts";
export { SCRIPT_EXTENSIONS } from "./project-loader.ts";
export { LABEL_POSITIONS } from "./label-parser.ts";
export { PLOTLINE_TYPES, PLOTLINE_TIER_NAME } from "./orchestration.ts";

/** 素材库（编辑器素材页用） */
export {
  createLibrary,
  loadLibrary,
  serializeLibrary,
  rebuildIndex,
  resolveAsset,
  renameAsset,
  bindAssetPath,
  assetDisplayName,
} from "./library.ts";

/** 文本通道工具（渲染层判断用） */
export { isActorChannel, isNarrChannel, stepChannel, stepTitle } from "./channels.ts";

/**
 * 剧本语法生成（写侧）：与解析器同源。
 * 新增片段 / 插入指令一律用这些函数拼文本，不要自己写 `@actor …` 模板。
 */
export {
  formatLabelHeader,
  formatActorLine,
  formatSpriteLine,
  formatNarrLine,
  formatAssetLine,
  formatFlagLine,
  formatLiteral,
  formatStep,
  quoteSpeaker,
} from "./script-format.ts";
export type { LabelHeaderSpec } from "./script-format.ts";

/** 诊断来源归一：`source` 由 code 前缀统一推导，调用方不用记前缀规则 */
export { diagnosticSource, isLocalDiagnostic } from "./project-diagnostics.ts";

/* ========================================================================== *
 * §H 类型再导出（编辑器与调用方共用）
 * ========================================================================== */

export type {
  Skeleton,
  Step,
  Choice,
  Asset,
  AssetKind,
  Node as StoryNode,
  NodeType,
  ActorChannel,
  NarrChannel,
  StepChannel,
  BgStep,
  SpriteStep,
  BgmStep,
  SfxStep,
  DialogStep,
  NarrationStep,
  EffectStep,
  ItemStep,
  FlagStep,
  TaskStep,
  BranchStep,
} from "./types.ts";

export type {
  ProjectDoc,
  ScriptLabel,
  ScriptFileDoc,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticSource,
  MenuDefinition,
  MenuChoiceItem,
  MenuResult,
  MenuType,
  MenuJump,
  StateDefinition,
  StateModule,
  StateEffect,
  StateType,
  Plotline,
  PlotlineBook,
  PlotlineKind,
  PlotlineType,
  Orchestration,
  OrchestrationLink,
} from "./project-types.ts";

export type { AssetLibrary, AssetLibraryData } from "./library.ts";
export type { ProjectIO, LoadProjectOptions } from "./project-loader.ts";

/* ========================================================================== *
 * 内部实现（不对外承诺）
 * ========================================================================== */

function isStoryProject(v: ProjectLike): v is StoryProject {
  return typeof (v as StoryProject).ok === "boolean" && !!(v as StoryProject).doc;
}

function asDoc(target: ProjectLike): ProjectDoc {
  return isStoryProject(target) ? target.doc : target;
}

/** 菜单/编排/情节线诊断由本地数据重算，其余（脚本解析、状态、素材）作为基线保留 */
function baseIssuesOf(doc: ProjectDoc): Diagnostic[] {
  return doc.diagnostics.filter((d) => !isLocalDiagnostic(d.code));
}

function writeIssues(target: ProjectLike, doc: ProjectDoc, merged: Diagnostic[]): StoryIssue[] {
  doc.diagnostics = merged;
  const issues = merged.map(toIssue);
  if (isStoryProject(target)) target.diagnostics = issues;
  return issues;
}

function toStoryProject(doc: ProjectDoc): StoryProject {
  const ordered = labelPlayOrder(doc);
  const labelName = (id: string) => doc.labels[id]?.name ?? id;

  return {
    root: doc.root,
    entry: doc.orchestration.entry || null,
    ok: !doc.diagnostics.some((d) => d.severity === "error"),
    files: [...doc.files],
    labels: ordered.map(toLabelInfo),
    states: doc.states.states.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      initial: s.initial,
      ...(s.min != null ? { min: s.min } : {}),
      ...(s.max != null ? { max: s.max } : {}),
      ...(s.options ? { options: [...s.options] } : {}),
    })),
    plotlines: (doc.plotlines.plotlines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      ...(p.type ? { type: p.type } : {}),
      ...(p.optional ? { optional: true } : {}),
    })),
    menus: Object.values(doc.menus.menus)
      .filter((m) => m.type === "choice")
      .map((m) => ({
        id: m.id,
        title: m.title,
        labelId: m.labelId,
        labelName: labelName(m.labelId),
        index: m.index ?? doc.labels[m.labelId]?.steps.length ?? 0,
        jump: m.jump,
        options: menuResults(m),
      })),
    assets: Object.entries(doc.assets.items).map(([id, a]) => ({
      id,
      name: a.name,
      kind: a.kind,
      path: a.path,
    })),
    diagnostics: doc.diagnostics.map(toIssue),
    doc,
  };
}

function toLabelInfo(label: ScriptLabel): StoryLabelInfo {
  return {
    id: label.id,
    name: label.name,
    file: label.file,
    line: label.line,
    plotline: (label.plotline ?? "").trim() || "主线",
    ...(label.position ? { position: label.position } : {}),
    stepCount: label.steps.length,
  };
}

function toIssue(d: Diagnostic): StoryIssue {
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.source ? { source: d.source } : {}),
    ...(d.file ? { file: d.file } : {}),
    ...(d.line != null ? { line: d.line } : {}),
  };
}

function buildCue(doc: ProjectDoc, step: Step, labelId: string, index: number): StageCue {
  const base = { labelId, index, raw: step };
  const assetId = "asset" in step ? step.asset : undefined;
  const asset = assetId ? doc.assets.items[assetId] : undefined;
  const assetFields = asset
    ? { assetId: asset.id, assetName: asset.name, assetPath: asset.path }
    : assetId
      ? { assetId, assetName: assetId, assetPath: "" }
      : {};

  if (step.type === "flag") {
    return {
      ...base,
      kind: "state",
      stateKey: step.key,
      stateValue: step.value,
    };
  }

  if (step.type === "task") {
    return {
      ...base,
      kind: "task",
      taskId: step.taskId,
      text: step.description ?? step.taskId,
    };
  }

  switch (step.type) {
    case "bg":
      return {
        ...base,
        kind: "bg",
        ...assetFields,
        ...(step.transition ? { transition: step.transition } : {}),
      };
    case "sprite":
      return {
        ...base,
        kind: "sprite",
        ...assetFields,
        ...(step.pose ? { pose: step.pose } : {}),
        position: step.position ?? "left",
        ...(step.enter != null ? { enter: step.enter } : {}),
      };
    case "bgm":
      return {
        ...base,
        kind: "bgm",
        ...assetFields,
        ...(step.fade != null ? { fade: step.fade } : {}),
      };
    case "sfx":
      return { ...base, kind: "sfx", ...assetFields };
    case "item":
      return { ...base, kind: "item", ...assetFields };
    case "effect":
      return {
        ...base,
        kind: "fx",
        effect: step.effect,
        ...(step.params ? { params: step.params } : {}),
      };
    case "dialog":
      return {
        ...base,
        kind: stepChannel(step) === "inner" ? "inner" : "say",
        speaker: step.speaker,
        text: step.text,
      };
    case "narration":
      return {
        ...base,
        kind: stepChannel(step) === "act" ? "act" : "vo",
        ...(step.speaker ? { speaker: step.speaker } : {}),
        text: step.text,
      };
    default:
      return { ...base, kind: "vo", text: "" };
  }
}

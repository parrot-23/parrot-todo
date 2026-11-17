/**
 * 项目级数据：状态定义 / 菜单定义 / 编排连接
 *
 * 这三段现在统一存放在 `story.project.json`（见 project-bundle.ts），本文件只负责各段自身的
 * 解析与校验：
 *  - `states`：{ schemaVersion, states[] }，状态值定义，项目级。
 *  - `menus`：{ schemaVersion, menus{ id: MenuDefinition } }，目前只有剧情选项。
 *    菜单按 labelId + index 挂到片段上，剧本源码里不含任何菜单痕迹。
 *  - `orchestration`：{ schemaVersion, entry, links[] }，label 之间的执行关系。
 *
 * 全部校验返回诊断，不抛异常；结构合法的旧分散文件也可直接读取。
 */

import type {
  Diagnostic,
  MenuBook,
  MenuDefinition,
  MenuResult,
  MenuType,
  Orchestration,
  OrchestrationLink,
  Plotline,
  PlotlineBook,
  PlotlineType,
  ProjectDoc,
  ScriptLabel,
  StateDefinition,
  StateModule,
  StateType,
} from "./project-types.ts";
import { DIAG, DiagnosticBag } from "./project-diagnostics.ts";
import { PROJECT_FILE_NAME } from "./project-layout.ts";

export const PROJECT_SCHEMA_VERSION = 1;

/** 主线固定名称：整份数据只有一条主线，且必须叫这个名字 */
export const MAIN_PLOTLINE_NAME = "主线";

export function emptyStateModule(): StateModule {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, states: [] };
}

export function emptyMenuBook(): MenuBook {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, menus: {} };
}

export function emptyPlotlineBook(): PlotlineBook {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, plotlines: [] };
}

export function emptyOrchestration(): Orchestration {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, entry: "", links: [] };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readJsonObject(
  text: string,
  file: string,
  bag: DiagnosticBag,
): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 不是合法 JSON：${(e as Error).message}`, {
      file,
      line: 1,
      column: 1,
    });
    return null;
  }
  if (!isObject(raw)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 顶层必须是对象`, { file, line: 1, column: 1 });
    return null;
  }
  const version = Number(raw.schemaVersion ?? PROJECT_SCHEMA_VERSION);
  if (version !== PROJECT_SCHEMA_VERSION) {
    bag.error(
      DIAG.PROJECT_VERSION_UNSUPPORTED,
      `${file} 的 schemaVersion=${version} 不受支持（当前 ${PROJECT_SCHEMA_VERSION}）`,
      { file, line: 1, column: 1 },
    );
    return null;
  }
  return raw;
}

function matchesType(type: StateType, value: unknown): boolean {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string";
}

/* ------------------------- states 段 ------------------------- */

export function parseStatesJson(text: string | null, file = "states.json"): {
  module: StateModule;
  diagnostics: Diagnostic[];
} {
  const bag = new DiagnosticBag();
  const mod = emptyStateModule();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `未找到 ${file}，按空状态定义处理`, { file, line: 1, column: 1 });
    return { module: mod, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { module: mod, diagnostics: bag.list };
  if (!Array.isArray(raw.states)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 缺少 states 数组`, { file, line: 1, column: 1 });
    return { module: mod, diagnostics: bag.list };
  }

  const seen = new Set<string>();
  raw.states.forEach((item, index) => {
    const loc = { file, line: index + 1, column: 1 };
    if (!isObject(item)) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `states[${index}] 不是对象`, loc);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `states[${index}] 缺少稳定 ID`, loc);
      return;
    }
    if (seen.has(id)) {
      bag.error(DIAG.STATE_DUPLICATE_ID, `状态 ID "${id}" 重复`, loc);
      return;
    }
    seen.add(id);
    const type = item.type as StateType;
    if (type !== "boolean" && type !== "number" && type !== "string" && type !== "enum") {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `状态 "${id}" 的类型非法`, loc);
      return;
    }
    if (!("initial" in item) || !matchesType(type, item.initial)) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `状态 "${id}" 的初始值与类型不匹配`, loc);
      return;
    }
    const def: StateDefinition = {
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name : id,
      type,
      initial: item.initial,
    };
    if (typeof item.icon === "string") def.icon = item.icon;
    if (typeof item.description === "string") def.description = item.description;
    if (type === "number") {
      if (typeof item.min === "number") def.min = item.min;
      if (typeof item.max === "number") def.max = item.max;
    }
    if (type === "string" && Array.isArray(item.values)) {
      def.values = item.values.filter((v): v is string => typeof v === "string");
    }
    if (type === "enum") {
      const options = Array.isArray(item.options)
        ? [...new Set(item.options.filter((v): v is string => typeof v === "string").map((v) => v.trim()))]
        : [];
      const cleaned = options.filter(Boolean);
      if (cleaned.length === 0) {
        bag.error(
          DIAG.STATE_INVALID_DEFINITION,
          `下拉列表状态 "${id}" 缺少 options（至少需要一个可选项）`,
          loc,
        );
        return;
      }
      def.options = cleaned;
      if (!cleaned.includes(String(item.initial))) {
        bag.error(
          DIAG.STATE_INVALID_DEFINITION,
          `下拉列表状态 "${id}" 的初始值 ${JSON.stringify(item.initial)} 不在可选项里`,
          loc,
        );
        return;
      }
    }
    mod.states.push(def);
  });

  return { module: mod, diagnostics: bag.list };
}

/* ------------------------- menus 段 ------------------------- */

export function parseMenusJson(text: string | null, file = "menus.json"): {
  book: MenuBook;
  diagnostics: Diagnostic[];
} {
  const bag = new DiagnosticBag();
  const book = emptyMenuBook();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `未找到 ${file}，按空菜单处理`, { file, line: 1, column: 1 });
    return { book, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { book, diagnostics: bag.list };
  if (!isObject(raw.menus)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 缺少 menus 对象`, { file, line: 1, column: 1 });
    return { book, diagnostics: bag.list };
  }

  for (const [id, value] of Object.entries(raw.menus)) {
    const loc = { file, line: 1, column: 1 };
    if (!isObject(value)) {
      bag.error(DIAG.PROJECT_JSON_INVALID, `菜单 "${id}" 不是对象`, loc);
      continue;
    }
    // 支持剧情选项（choice）与条件出口（condition）；其它历史类型直接丢弃
    if (value.type !== "choice" && value.type !== "condition") continue;
    const type: MenuType = value.type === "condition" ? "condition" : "choice";
    const labelId = typeof value.labelId === "string" ? value.labelId : "";
    if (!labelId) {
      bag.error(DIAG.MENU_LABEL_MISSING, `菜单 "${id}" 缺少所属片段 labelId`, loc, { menuId: id });
    }
    const menu: MenuDefinition = {
      id,
      labelId,
      type,
      jump: type === "condition" ? "out" : value.jump === "back" ? "back" : "out",
      title:
        typeof value.title === "string" && value.title
          ? value.title
          : type === "condition"
            ? "条件出口"
            : id,
    };
    if (type === "condition") {
      // 条件出口：缺省 when 视为恒真；to / end 二选一，编辑中允许暂时悬空
      menu.when = typeof value.when === "string" && value.when.trim() ? value.when.trim() : "true";
      if (typeof value.to === "string" && value.to) menu.to = value.to;
      if (value.end === true) menu.end = true;
      book.menus[id] = menu;
      continue;
    }
    // 片段内插入位置：缺省（或非法）表示片段末尾
    if (typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0) {
      menu.index = value.index;
    }
    const items = Array.isArray(value.items) ? value.items : [];
    menu.items = items
      .filter((it): it is Record<string, unknown> => isObject(it))
      .map((it, i) => ({
        id: typeof it.id === "string" && it.id ? it.id : `item_${i + 1}`,
        resultId: typeof it.resultId === "string" && it.resultId ? it.resultId : `result_${i + 1}`,
        text: typeof it.text === "string" ? it.text : `选项 ${i + 1}`,
        ...(Array.isArray(it.effects) ? { effects: it.effects as never } : {}),
        ...(typeof it.require === "string" && it.require ? { require: it.require } : {}),
      }));
    // 空菜单在文件解析阶段就报错，不必等到项目校验
    if (menu.items.length === 0) {
      bag.error(DIAG.MENU_EMPTY, `菜单「${menu.title}」没有任何剧情选项`, loc, { menuId: id });
    }
    book.menus[id] = menu;
  }

  return { book, diagnostics: bag.list };
}

/* ------------------------- orchestration 段 ------------------------- */

export function parseOrchestrationJson(text: string | null, file = "orchestration.json"): {
  orchestration: Orchestration;
  diagnostics: Diagnostic[];
} {
  const bag = new DiagnosticBag();
  const orch = emptyOrchestration();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `未找到 ${file}，按未编排处理`, { file, line: 1, column: 1 });
    return { orchestration: orch, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { orchestration: orch, diagnostics: bag.list };

  orch.entry = typeof raw.entry === "string" ? raw.entry : "";
  if (Array.isArray(raw.links)) {
    raw.links.forEach((link, index) => {
      if (!isObject(link)) return;
      const normalized: OrchestrationLink = {
        id: typeof link.id === "string" && link.id ? link.id : `link_${index + 1}`,
      };
      if (typeof link.fromMenu === "string") normalized.fromMenu = link.fromMenu;
      if (typeof link.fromLabel === "string") normalized.fromLabel = link.fromLabel;
      if (typeof link.resultId === "string") normalized.resultId = link.resultId;
      if (typeof link.to === "string") normalized.to = link.to;
      if (link.end === true) normalized.end = true;
      if (typeof link.when === "string" && link.when) normalized.when = link.when;
      orch.links.push(normalized);
    });
  } else {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 缺少 links 数组`, { file, line: 1, column: 1 });
  }
  return { orchestration: orch, diagnostics: bag.list };
}

/* ------------------------- 菜单结果 ------------------------- */

/** 取剧情选项菜单的全部可能结果 */
export function menuResults(menu: MenuDefinition | undefined): MenuResult[] {
  if (!menu) return [];
  return (menu.items ?? []).map((it) => ({
    resultId: it.resultId,
    text: it.text,
    ...(it.require ? { require: it.require } : {}),
    ...(it.effects ? { effects: it.effects } : {}),
  }));
}

/* ------------------------- 条件表达式 ------------------------- */

/**
 * 受控条件求值（不使用 eval）。
 * 支持 `flag('id')`、`=== !== == != >= <= > <`、`&& || !`（and/or/not）与括号。
 */
export function evalFlagCondition(expr: string, flags: Record<string, unknown>): boolean {
  const parser = new ConditionParser(expr, flags);
  const value = parser.parse();
  if (!parser.done) throw new Error(`条件表达式有多余内容：${expr}`);
  return !!value;
}

class ConditionParser {
  private pos = 0;
  private readonly src: string;
  private readonly flags: Record<string, unknown>;

  constructor(src: string, flags: Record<string, unknown>) {
    this.src = src;
    this.flags = flags;
  }

  get done(): boolean {
    this.skip();
    return this.pos >= this.src.length;
  }

  private skip() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private matchAny(...alts: string[]): boolean {
    this.skip();
    for (const alt of alts) {
      if (/^[a-z]+$/i.test(alt)) {
        const m = this.src.slice(this.pos).match(new RegExp(`^${alt}\\b`, "i"));
        if (m) {
          this.pos += m[0].length;
          return true;
        }
      } else if (this.src.startsWith(alt, this.pos)) {
        this.pos += alt.length;
        return true;
      }
    }
    return false;
  }

  parse(): unknown {
    return this.parseOr();
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.matchAny("||", "or")) {
      const right = this.parseAnd();
      left = !!left || !!right;
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseUnary();
    while (this.matchAny("&&", "and")) {
      const right = this.parseUnary();
      left = !!left && !!right;
    }
    return left;
  }

  private parseUnary(): unknown {
    this.skip();
    if (this.matchAny("!", "not")) return !this.parseUnary();
    if (this.src[this.pos] === "(") {
      this.pos++;
      const v = this.parseOr();
      this.skip();
      if (this.src[this.pos] !== ")") throw new Error(`条件表达式缺少右括号：${this.src}`);
      this.pos++;
      return v;
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const op = this.readOperator();
    if (!op) return left;
    const right = this.parsePrimary();
    switch (op) {
      case "===":
      case "==":
        return left === right;
      case "!==":
      case "!=":
        return left !== right;
      case ">":
        return (left as number) > (right as number);
      case "<":
        return (left as number) < (right as number);
      case ">=":
        return (left as number) >= (right as number);
      case "<=":
        return (left as number) <= (right as number);
      default:
        return false;
    }
  }

  private readOperator(): string | null {
    this.skip();
    const m = this.src.slice(this.pos).match(/^(===|!==|==|!=|>=|<=|>|<)/);
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  private parsePrimary(): unknown {
    this.skip();
    const rest = this.src.slice(this.pos);
    const flagMatch = rest.match(/^flag\(\s*(['"])([^'"]+)\1\s*\)/);
    if (flagMatch) {
      this.pos += flagMatch[0].length;
      return this.flags[flagMatch[2]];
    }
    const str = rest.match(/^(['"])(.*?)\1/);
    if (str) {
      this.pos += str[0].length;
      return str[2];
    }
    const num = rest.match(/^-?\d+(?:\.\d+)?/);
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    const bool = rest.match(/^(true|false)\b/i);
    if (bool) {
      this.pos += bool[0].length;
      return bool[0].toLowerCase() === "true";
    }
    throw new Error(`无法解析条件表达式：${this.src}`);
  }
}

/* ------------------------- 默认（顺序）出口 ------------------------- */

/** 片段在项目中的播放顺序：文件顺序 → 源码行号 */
export function labelPlayOrder(doc: ProjectDoc): ScriptLabel[] {
  const fileOrder = new Map<string, number>();
  doc.files.forEach((f, i) => fileOrder.set(f, i));
  return Object.values(doc.labels).sort((a, b) => {
    const fa = fileOrder.get(a.file) ?? Number.MAX_SAFE_INTEGER;
    const fb = fileOrder.get(b.file) ?? Number.MAX_SAFE_INTEGER;
    return fa === fb ? a.line - b.line : fa - fb;
  });
}

/** 顺序上的下一个片段（没有则为 null） */
export function nextLabelId(doc: ProjectDoc, labelId: string): string | null {
  const order = labelPlayOrder(doc);
  const i = order.findIndex((l) => l.id === labelId);
  return i >= 0 && i + 1 < order.length ? order[i + 1].id : null;
}

/** 片段归属的情节线（按名称匹配；未写 `| 名称` 视为主线） */
export function plotlineOfLabel(doc: ProjectDoc, labelId: string): Plotline | undefined {
  const label = doc.labels[labelId];
  if (!label) return undefined;
  const name = plotlineNameOfLabel(label);
  return (doc.plotlines?.plotlines ?? []).find((p) => p.name === name);
}

/**
 * 顺序出口：沿「文件顺序 + 源码行号」找下一个可进入的片段。
 * `isEnterable` 返回 false 的片段被跳过（未开启的可跳过支线），
 * 跳过结果同时返回，便于运行时写路径日志。
 */
export function nextEnterableLabel(
  doc: ProjectDoc,
  labelId: string,
  isEnterable: (id: string) => boolean,
): { next: string | null; skipped: string[] } {
  const order = labelPlayOrder(doc);
  const i = order.findIndex((l) => l.id === labelId);
  const skipped: string[] = [];
  if (i < 0) return { next: null, skipped };
  for (let j = i + 1; j < order.length; j++) {
    const id = order[j].id;
    if (isEnterable(id)) return { next: id, skipped };
    skipped.push(id);
  }
  return { next: null, skipped };
}

/**
 * 片段是否自带菜单出口（跳出型选项菜单）：有菜单出口的片段不需要默认出口。
 * 条件出口不是玩家菜单，它的连线仍按 `fromLabel + when` 走片段出口。
 */
export function hasMenuExit(doc: ProjectDoc, labelId: string): boolean {
  return Object.values(doc.menus.menus).some(
    (m) => m.labelId === labelId && m.type === "choice" && m.jump === "out",
  );
}

/**
 * 把菜单定义挂到所属片段的锚点上。
 *
 * 剧本里不写 `@menu`，菜单的插入位置只由 `menus` 段的 `labelId` + `index` 决定；
 * 读项目时把锚点回填到 `label.menus`，供编排图、诊断定位复用。
 * 越界按末尾处理（与运行时 menuPosition 一致），同一片段的锚点按位置排序。
 */
export function attachMenuAnchors(labels: Record<string, ScriptLabel>, book: MenuBook): void {
  for (const label of Object.values(labels)) label.menus = [];
  for (const menu of Object.values(book.menus)) {
    // 条件出口不是片段内暂停点，不生成锚点
    if (menu.type === "condition") continue;
    const label = labels[menu.labelId];
    if (!label) continue;
    const index = Math.max(0, Math.min(menu.index ?? label.steps.length, label.steps.length));
    label.menus.push({ menuId: menu.id, index, line: label.line });
  }
  for (const label of Object.values(labels)) {
    label.menus.sort((a, b) => a.index - b.index);
  }
}

/**
 * 从 `menus` 派生条件出口连线。
 *
 * `menus` 是条件出口的唯一真相（type = condition，存 when / to / end）；
 * 运行时需要 `fromLabel + when` 的连线，所以加载时在这里生成。
 * 派生连线带 `derivedFromMenu` 标记，只存在于内存，序列化时剔除。
 */
export function deriveConditionLinks(book: MenuBook, orchestration: Orchestration): Orchestration {
  const links = orchestration.links.filter((l) => !l.derivedFromMenu);
  for (const menu of Object.values(book.menus)) {
    if (menu.type !== "condition") continue;
    if (!menu.to && !menu.end) continue;
    links.push({
      id: `cond_${menu.id}`,
      fromLabel: menu.labelId,
      when: menu.when ?? "true",
      ...(menu.to ? { to: menu.to } : {}),
      ...(menu.end ? { end: true } : {}),
      derivedFromMenu: menu.id,
    });
  }
  return { ...orchestration, links };
}

/* ------------------------- 项目校验 ------------------------- */

/** 某个菜单在源码中的锚点位置（用于诊断定位） */
export interface MenuAnchorInfo {
  menuId: string;
  file: string;
  line: number;
  labelId: string;
}

export function collectMenuAnchors(doc: ProjectDoc): MenuAnchorInfo[] {
  const out: MenuAnchorInfo[] = [];
  for (const script of doc.scripts) {
    for (const label of script.labels) {
      for (const anchor of label.menus) {
        out.push({ menuId: anchor.menuId, file: script.file, line: anchor.line, labelId: label.id });
      }
    }
  }
  return out;
}

/**
 * 校验项目：入口、菜单、结果出口、label 出口、可达性、循环。
 * 返回可定位到文件/行的诊断。
 */
export function validateProject(doc: ProjectDoc): Diagnostic[] {
  const bag = new DiagnosticBag();

  const labels = doc.labels;
  const labelIds = new Set(Object.keys(labels));

  // ---- 入口 ----
  if (!doc.orchestration.entry) {
    bag.error(
      DIAG.ORCH_ENTRY_MISSING,
      "项目没有设置开始片段（入口），请在「剧情编排」中选择一个 label",
      { file: PROJECT_FILE_NAME, line: 1, column: 1 },
    );
  } else if (!labelIds.has(doc.orchestration.entry)) {
    bag.error(
      DIAG.ORCH_ENTRY_MISSING,
      `入口片段 "${doc.orchestration.entry}" 不存在（可能已删除或改名）`,
      { file: PROJECT_FILE_NAME, line: 1, column: 1 },
      { entry: doc.orchestration.entry },
    );
  }

  // ---- 菜单挂载与定义 ----
  for (const menu of Object.values(doc.menus.menus)) {
    const label = labels[menu.labelId];
    if (!menu.labelId || !label) {
      bag.error(
        DIAG.MENU_LABEL_MISSING,
        `菜单「${menu.title}」挂载的片段 "${menu.labelId || "(空)"}" 不存在`,
        { file: PROJECT_FILE_NAME, line: 1, column: 1 },
        { menuId: menu.id, labelId: menu.labelId },
      );
    }
    validateMenu(
      menu,
      doc,
      bag,
      label ? { menuId: menu.id, file: label.file, line: label.line, labelId: label.id } : undefined,
    );
  }

  // ---- 连接 ----
  const seenKeys = new Set<string>();
  for (const link of doc.orchestration.links) {
    const loc = { file: PROJECT_FILE_NAME, line: 1, column: 1 };
    if (!link.fromMenu && !link.fromLabel) {
      bag.error(DIAG.ORCH_RESULT_UNKNOWN, `连线 "${link.id}" 缺少来源（菜单结果或片段出口）`, loc);
      continue;
    }
    if (link.to && !labelIds.has(link.to)) {
      bag.error(
        DIAG.ORCH_TARGET_MISSING,
        `连线 "${link.id}" 的目标片段 "${link.to}" 不存在`,
        loc,
        { linkId: link.id, to: link.to },
      );
    }
    if (!link.to && !link.end) {
      bag.error(DIAG.ORCH_RESULT_UNKNOWN, `连线 "${link.id}" 既没有目标片段也没有标记结束`, loc);
    }
    if (link.fromMenu) {
      const menu = doc.menus.menus[link.fromMenu];
      if (!menu) {
        bag.error(DIAG.MENU_UNDEFINED, `连线 "${link.id}" 引用了不存在的菜单 "${link.fromMenu}"`, loc);
        continue;
      }
      if (!link.resultId) {
        bag.error(DIAG.ORCH_RESULT_UNKNOWN, `连线 "${link.id}" 缺少结果 ID`, loc);
        continue;
      }
      const results = menuResults(menu).map((r) => r.resultId);
      if (!results.includes(link.resultId)) {
        bag.error(
          DIAG.ORCH_RESULT_UNKNOWN,
          `连线 "${link.id}" 的结果 "${link.resultId}" 不在菜单「${menu.title}」中（可能已删除该项）`,
          loc,
          { menuId: menu.id, resultId: link.resultId },
        );
      }
      const key = `menu:${link.fromMenu}:${link.resultId}:${link.when ?? ""}`;
      if (seenKeys.has(key)) {
        bag.error(
          DIAG.ORCH_DUPLICATE_LINK,
          `菜单「${menu.title}」的结果 "${link.resultId}" 存在重复连接${
            link.when ? `（条件：${link.when}）` : ""
          }`,
          loc,
          { menuId: link.fromMenu, resultId: link.resultId },
        );
      }
      seenKeys.add(key);
    } else if (link.fromLabel && !labelIds.has(link.fromLabel)) {
      bag.error(DIAG.ORCH_TARGET_MISSING, `连线 "${link.id}" 的来源片段 "${link.fromLabel}" 不存在`, loc);
    }
  }

  // ---- 条件出口：与剧情选项硬互斥；同片段条件按定义顺序求值 ----
  const menusByLabel = new Map<string, MenuDefinition[]>();
  for (const menu of Object.values(doc.menus.menus)) {
    if (!menu.labelId) continue;
    const list = menusByLabel.get(menu.labelId) ?? [];
    list.push(menu);
    menusByLabel.set(menu.labelId, list);
  }
  for (const [labelId, list] of menusByLabel) {
    const label = labels[labelId];
    const kinds = new Set(list.map((m) => m.type));
    if (kinds.has("choice") && kinds.has("condition")) {
      bag.error(
        DIAG.MENU_EXIT_CONFLICT,
        `片段「${label?.name ?? labelId}」同时配置了剧情选项和条件出口；两者互斥，请只保留一种`,
        label ? { file: label.file, line: label.line, column: 1 } : undefined,
        { labelId },
      );
    }
    const seenWhen = new Set<string>();
    for (const menu of list) {
      if (menu.type !== "condition") continue;
      const when = menu.when ?? "true";
      if (seenWhen.has(when)) {
        bag.warn(
          DIAG.MENU_CONDITION_DUPLICATE,
          `片段「${label?.name ?? labelId}」有多条条件同为「${when}」的出口，后面的永远不会命中`,
          label ? { file: label.file, line: label.line, column: 1 } : undefined,
          { menuId: menu.id, labelId },
        );
      }
      seenWhen.add(when);
    }
  }

  // ---- 菜单结果是否都有出口 ----
  for (const menu of Object.values(doc.menus.menus)) {
    // 条件出口不是玩家菜单，出口由派生连线负责
    if (menu.type === "condition") continue;
    // 回归菜单结算后继续本片段，不需要结果连线
    if (menu.jump === "back") continue;
    const label = labels[menu.labelId];
    for (const result of menuResults(menu)) {
      const connected = doc.orchestration.links.some(
        (l) => l.fromMenu === menu.id && l.resultId === result.resultId,
      );
      if (!connected) {
        bag.error(
          DIAG.ORCH_RESULT_UNCONNECTED,
          `菜单「${menu.title}」的结果 "${result.text}"（${result.resultId}）还没有连接目标片段`,
          label ? { file: label.file, line: label.line, column: 1 } : undefined,
          { menuId: menu.id, resultId: result.resultId, labelId: label?.id },
        );
      }
    }
  }

  // ---- label 出口 ----
  for (const label of Object.values(doc.labels)) {
    // 只有「跳出」菜单会把流程带离本片段；回归菜单结算后继续播放，仍需自动出口
    if (hasMenuExit(doc, label.id)) continue;
    // 顺序出口：后面只剩「别的可跳过支线片段」时，未开启就会跳过，不能算走得通；
    // 同一条支线内部的片段仍按顺序可走（是否开启由运行时判定）。
    const currentOwner = plotlineOfLabel(doc, label.id);
    const seq = nextEnterableLabel(doc, label.id, (id) => {
      const owner = plotlineOfLabel(doc, id);
      if (!owner || owner.kind !== "branch" || !owner.optional) return true;
      return owner.id === currentOwner?.id;
    });
    if (seq.next) continue;

    const exits = doc.orchestration.links.filter((l) => l.fromLabel === label.id);
    // 条件出口也是显式出口；条件不命中时运行时才会回落到顺序出口
    const usable = exits.filter((e) => e.end || e.to);

    if (seq.skipped.length) {
      const names = seq.skipped.map((id) => `「${doc.labels[id]?.name ?? id}」`).join("、");
      if (usable.length === 0) {
        bag.warn(
          DIAG.ORCH_BRANCH_GATED_DEAD_END,
          `片段「${label.name}」后面只有可跳过的支线片段 ${names}：支线未开启时它们会被跳过，流程将没有出口，请补结束或显式出口`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id, skipped: seq.skipped },
        );
      }
      continue;
    }

    // 顺序末尾的片段：必须显式结束，或用无条件连线跳到别处
    if (usable.length === 0) {
      bag.error(
        DIAG.ORCH_LABEL_NO_EXIT,
        `片段「${label.name}」是最后一个片段，没有配置自动出口或结束`,
        { file: label.file, line: label.line, column: 1 },
        { labelId: label.id },
      );
    } else if (usable.filter((e) => e.to).length > 1) {
      bag.warn(
        DIAG.ORCH_DUPLICATE_LINK,
        `片段「${label.name}」有多个自动出口，请为它们添加条件或删除多余连线`,
        { file: label.file, line: label.line, column: 1 },
        { labelId: label.id },
      );
    }
  }

  // ---- 可达性 ----
  const graph = new Map<string, Set<string>>();
  for (const id of labelIds) graph.set(id, new Set());
  for (const link of doc.orchestration.links) {
    if (!link.to) continue;
    if (link.fromMenu) {
      const menu = doc.menus.menus[link.fromMenu];
      if (menu) graph.get(menu.labelId)?.add(link.to);
    } else if (link.fromLabel) {
      graph.get(link.fromLabel)?.add(link.to);
    }
  }
  // 无菜单片段的默认顺序出口也算一条可走的路；但片段已有
  // 「结束」或「无条件连线」时，默认出口走不到，不能再算一条边
  // （否则结局片段会经文件顺序连回支线，误报循环）。
  const explicitExit = new Set<string>();
  for (const link of doc.orchestration.links) {
    if (!link.fromLabel) continue;
    if (link.end || (link.to && (!link.when || link.when.trim() === "true"))) {
      explicitExit.add(link.fromLabel);
    }
  }
  for (const label of Object.values(doc.labels)) {
    if (hasMenuExit(doc, label.id)) continue;
    if (explicitExit.has(label.id)) continue;
    const next = nextLabelId(doc, label.id);
    if (next) graph.get(label.id)?.add(next);
  }

  if (doc.orchestration.entry && labelIds.has(doc.orchestration.entry)) {
    const seen = new Set<string>([doc.orchestration.entry]);
    const queue = [doc.orchestration.entry];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of graph.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const label of Object.values(doc.labels)) {
      if (!seen.has(label.id)) {
        bag.warn(
          DIAG.ORCH_UNREACHABLE,
          `片段「${label.name}」从入口不可达`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id },
        );
      }
    }

    // ---- 循环（有意循环允许，提示确认） ----
    const reported = new Set<string>();
    const stack: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const dfs = (id: string) => {
      if (visiting.has(id)) {
        const start = stack.indexOf(id);
        const cycle = stack.slice(start >= 0 ? start : 0).concat(id);
        const key = [...new Set(cycle)].sort().join(">");
        if (!reported.has(key)) {
          reported.add(key);
          bag.info(
            DIAG.ORCH_CYCLE,
            `检测到循环：${cycle.join(" → ")}（如为有意循环可保留）`,
            { file: labels[id].file, line: labels[id].line, column: 1 },
            { cycle },
          );
        }
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      stack.push(id);
      for (const next of graph.get(id) ?? []) dfs(next);
      stack.pop();
      visiting.delete(id);
      visited.add(id);
    };
    dfs(doc.orchestration.entry);
  } else if (doc.orchestration.entry) {
    // 入口不存在时，跳过可达性分析（已有 entry 诊断）
  }

  // ---- 情节线归属：每个片段必须且只能属于一条「主线 / 支线」；线索线是登记线，不参与归属 ----
  const plotlineOwner = new Map<string, Plotline>();
  for (const plotline of doc.plotlines?.plotlines ?? []) {
    // 线索线（thread）的 labelIds 允许与主线重叠，不能参与"一片段一条线"的判定
    if (plotline.kind === "thread") {
      for (const id of plotline.labelIds ?? []) {
        if (!labelIds.has(id)) {
          bag.warn(
            DIAG.PLOTLINE_LABEL_MISSING,
            `线索线「${plotline.name}」引用了不存在的片段 "${id}"`,
            { file: PROJECT_FILE_NAME, line: 1, column: 1 },
            { plotlineId: plotline.id, labelId: id },
          );
        }
      }
      continue;
    }
    for (const id of plotline.labelIds ?? []) {
      if (!labelIds.has(id)) {
        bag.warn(
          DIAG.PLOTLINE_LABEL_MISSING,
          `情节线「${plotline.name}」引用了不存在的片段 "${id}"`,
          { file: PROJECT_FILE_NAME, line: 1, column: 1 },
          { plotlineId: plotline.id, labelId: id },
        );
        continue;
      }
      const previous = plotlineOwner.get(id);
      if (previous) {
        bag.error(
          DIAG.PLOTLINE_DUPLICATE_ASSIGN,
          `片段「${labels[id].name}」同时归属「${previous.name}」和「${plotline.name}」，每个片段只能属于一条情节线`,
          { file: labels[id].file, line: labels[id].line, column: 1 },
          { labelId: id, plotlineId: plotline.id },
        );
        continue;
      }
      plotlineOwner.set(id, plotline);
    }
  }
  for (const label of Object.values(labels)) {
    if (plotlineOwner.has(label.id)) continue;
    bag.warn(
      DIAG.PLOTLINE_UNASSIGNED,
      `片段「${label.name}」还没有归属情节线`,
      { file: label.file, line: label.line, column: 1 },
      { labelId: label.id },
    );
  }
  // 线索线只能标注主线片段（标注结构支线会让"始终播放"的前提失效）
  for (const plotline of doc.plotlines?.plotlines ?? []) {
    if (plotline.kind !== "thread") continue;
    for (const id of plotline.labelIds ?? []) {
      const owner = plotlineOwner.get(id);
      if (owner && owner.kind === "branch") {
        bag.warn(
          DIAG.PLOTLINE_DUPLICATE_ASSIGN,
          `线索线「${plotline.name}」挂在结构支线片段「${labels[id].name}」上；线索线只能标注主线片段`,
          { file: labels[id].file, line: labels[id].line, column: 1 },
          { labelId: id, plotlineId: plotline.id },
        );
      }
    }
  }

  // ---- 结束 ----
  if (!doc.orchestration.links.some((l) => l.end)) {
    bag.warn(DIAG.ORCH_NO_END, "编排中没有显式结束连接，流程可能无法收尾", {
      file: PROJECT_FILE_NAME,
      line: 1,
      column: 1,
    });
  }

  return bag.list;
}

function validateMenu(
  menu: MenuDefinition,
  doc: ProjectDoc,
  bag: DiagnosticBag,
  anchor?: MenuAnchorInfo,
): void {
  const loc = anchor
    ? { file: anchor.file, line: anchor.line, column: 1 }
    : { file: PROJECT_FILE_NAME, line: 1, column: 1 };

  // 条件出口不是玩家菜单：不检查选项、插入位置与结果连线，只检查目标
  if (menu.type === "condition") {
    if (!menu.when || !menu.when.trim()) {
      bag.warn(
        DIAG.MENU_CONDITION_TARGET_MISSING,
        `条件出口「${menu.title}」缺少条件表达式，将按恒真处理`,
        loc,
        { menuId: menu.id },
      );
    } else {
      validateExpression(menu.when, `条件出口「${menu.title}」`, doc, bag, loc, {
        menuId: menu.id,
        labelId: menu.labelId,
      });
    }
    if (!menu.to && !menu.end) {
      bag.warn(
        DIAG.MENU_CONDITION_TARGET_MISSING,
        `条件出口「${menu.title}」还没有目标片段`,
        loc,
        { menuId: menu.id },
      );
    }
    // 无条件出口又指向顺序上的下一个片段：和默认出口完全等价，属于冗余数据
    const when = (menu.when ?? "").trim();
    if (when === "true" && menu.to && menu.to === nextLabelId(doc, menu.labelId)) {
      bag.info(
        DIAG.MENU_CONDITION_REDUNDANT,
        `条件出口「${menu.title}」条件恒真、目标就是顺序上的下一个片段，与默认出口等价，可以删除`,
        loc,
        { menuId: menu.id, labelId: menu.labelId },
      );
    }
    return;
  }

  // 插入位置：越界按末尾处理；跳出菜单后面的步骤永远走不到
  const owner = doc.labels[menu.labelId];
  if (owner) {
    const steps = owner.steps.length;
    const index = menu.index ?? steps;
    if (index > steps) {
      bag.warn(
        DIAG.ORCH_MENU_POSITION,
        `菜单「${menu.title}」的插入位置（第 ${index} 步之后）超出片段「${owner.name}」的 ${steps} 步，将按末尾处理`,
        loc,
        { menuId: menu.id, index },
      );
    } else if (menu.jump === "out" && index < steps) {
      bag.warn(
        DIAG.ORCH_MENU_POSITION,
        `菜单「${menu.title}」是跳出菜单，位于第 ${index} 步之后，片段「${owner.name}」剩下的 ${steps - index} 步不会被执行`,
        loc,
        { menuId: menu.id, index },
      );
    }
  }

  const items = menu.items ?? [];
  if (items.length === 0) {
    bag.error(DIAG.MENU_EMPTY, `菜单「${menu.title}」没有任何剧情选项`, loc, { menuId: menu.id });
    return;
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.text.trim()) {
      bag.warn(DIAG.MENU_EMPTY, `菜单「${menu.title}」有选项缺少显示文案`, loc, {
        menuId: menu.id,
        resultId: item.resultId,
      });
    }
    if (seen.has(item.resultId)) {
      bag.error(
        DIAG.MENU_DUPLICATE_RESULT,
        `菜单「${menu.title}」的结果 ID "${item.resultId}" 重复`,
        loc,
        { menuId: menu.id, resultId: item.resultId },
      );
    }
    seen.add(item.resultId);
    validateEffects(item.effects, doc, bag, loc);
    if (item.require) {
      validateExpression(item.require, `菜单「${menu.title}」的选项「${item.text}」`, doc, bag, loc, {
        menuId: menu.id,
        resultId: item.resultId,
      });
    }
  }
}

/**
 * 条件表达式自检：
 *  - 语法解析不了 → 运行时按不命中处理，这里提前告警；
 *  - `flag('x')` 引用的状态没定义 → 运行时取不到值，同样不会命中。
 */
function validateExpression(
  expr: string,
  owner: string,
  doc: ProjectDoc,
  bag: DiagnosticBag,
  loc: { file: string; line: number; column: number },
  extra: Record<string, string>,
): void {
  const source = expr.trim();
  if (!source) return;
  try {
    evalFlagCondition(source, {});
  } catch {
    bag.warn(
      DIAG.MENU_CONDITION_INVALID,
      `${owner}的条件表达式无法解析：${source}（运行时会当作不命中）`,
      loc,
      extra,
    );
    return;
  }
  const known = new Set(doc.states.states.map((s) => s.id));
  if (known.size === 0) return;
  for (const m of source.matchAll(/flag\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const id = m[2];
    if (known.has(id)) continue;
    bag.warn(
      DIAG.MENU_CONDITION_UNDECLARED_STATE,
      `${owner}的条件引用了未定义的状态 "${id}"，运行时永远不命中`,
      loc,
      { ...extra, stateId: id },
    );
  }
}

function validateEffects(
  effects: { stateId: string; op: string; value: unknown }[] | undefined,
  doc: ProjectDoc,
  bag: DiagnosticBag,
  loc: { file: string; line: number; column: number },
): void {
  if (!effects) return;
  const byId = new Map(doc.states.states.map((s) => [s.id, s]));
  for (const effect of effects) {
    const def = byId.get(effect.stateId);
    if (!def) {
      bag.error(DIAG.STATE_UNDECLARED, `状态效果引用了未定义的状态 "${effect.stateId}"`, loc, {
        stateId: effect.stateId,
      });
      continue;
    }
    if (effect.op !== "set" && def.type !== "number") {
      bag.error(DIAG.STATE_TYPE_MISMATCH, `状态「${def.name}」不是数值类型，不能用 add/sub`, loc, {
        stateId: def.id,
      });
      continue;
    }
    if (effect.op === "set" && !matchesType(def.type, effect.value)) {
      bag.error(
        DIAG.STATE_TYPE_MISMATCH,
        `状态「${def.name}」是 ${def.type} 类型，赋值 ${JSON.stringify(effect.value)} 不匹配`,
        loc,
        { stateId: def.id },
      );
      continue;
    }
    if (
      effect.op === "set" &&
      def.type === "enum" &&
      !(def.options ?? []).includes(String(effect.value))
    ) {
      bag.error(
        DIAG.STATE_TYPE_MISMATCH,
        `状态「${def.name}」是下拉列表类型，赋值 ${JSON.stringify(effect.value)} 不在可选项里`,
        loc,
        { stateId: def.id },
      );
    }
  }
}

/** 目标 label 列表（编辑器连线下拉用） */
export function labelList(labels: Record<string, ScriptLabel>): ScriptLabel[] {
  return Object.values(labels).sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}

/* ------------------------- plotlines 段 ------------------------- */

/** 支线取舍档位（见 `1 情节线与剧情结构规范.md` §12.4） */
export type PlotlineTier = "core" | "important" | "optional";

/**
 * 支线功能类型清单（见 `1 情节线与剧情结构规范.md` §12.2）。
 * 顺序即"对主线的反作用力"强弱顺序，也是取舍优先级；主线不参与分类。
 */
export const PLOTLINE_TYPES: {
  id: PlotlineType;
  name: string;
  /** 取舍档位：核心 / 重要 / 可删减 */
  tier: PlotlineTier;
  desc: string;
}[] = [
  {
    id: "setting",
    name: "设定型",
    tier: "core",
    desc: "解释世界为什么能这样运转：前代布局、机制揭秘、传说层",
  },
  {
    id: "foreshadow",
    name: "伏笔型",
    tier: "core",
    desc: "前期只给细节、后期兑现：小人物、小物件、一句闲谈",
  },
  {
    id: "conflict",
    name: "冲突型",
    tier: "core",
    desc: "给主线制造阻力与代价：宿敌追杀、幕后布局、阶段大事件",
  },
  {
    id: "faction",
    name: "势力型",
    tier: "important",
    desc: "把个人升级推到天下棋局：地域 / 组织内斗、多方合纵连横",
  },
  {
    id: "character",
    name: "角色型",
    tier: "important",
    desc: "借他人弧光反衬主角：配角复仇 / 救赎、镜像角色、宿敌",
  },
  {
    id: "resource",
    name: "资源型",
    tier: "optional",
    desc: "提供升级燃料：秘境寻宝、生产、交易拍卖",
  },
  {
    id: "emotion",
    name: "情感型",
    tier: "optional",
    desc: "给升级框架加温：爱情、师徒、亲情、友情",
  },
];

/** 档位显示名 */
export const PLOTLINE_TIER_NAME: Record<PlotlineTier, string> = {
  core: "核心",
  important: "重要",
  optional: "可删减",
};

/** 类型 → 中文名 / 档位；未分类返回 null */
export function plotlineTypeInfo(type: PlotlineType | undefined): {
  name: string;
  tier: PlotlineTier;
  desc: string;
} | null {
  if (!type) return null;
  const found = PLOTLINE_TYPES.find((t) => t.id === type);
  return found ? { name: found.name, tier: found.tier, desc: found.desc } : null;
}

/**
 * 把写进项目文件的 `type` 归一化成稳定 ID。
 * 同时接受英文 ID（`setting`）与中文名（`设定型` / `设定`），非法值返回 null。
 */
export function parsePlotlineType(raw: unknown): PlotlineType | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  for (const t of PLOTLINE_TYPES) {
    if (lower === t.id || key === t.name || key === t.name.replace(/型$/, "")) return t.id;
  }
  return null;
}

/**
 * 解析「情节线」数组（story.project.json 的 plotlines 段）。
 * 只做结构校验：id 必填且唯一、name 缺省用 id、kind 非法按 branch、type 无法识别按未分类。
 * 情节线只有 `optional`（可跳过支线）参与运行时的顺序出口判定，其余字段纯展示；
 * 因此这里的错误一律是 warning，不阻断项目打开。
 */
export function parsePlotlinesJson(
  text: string | null,
  file = PROJECT_FILE_NAME,
): { book: PlotlineBook; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const book = emptyPlotlineBook();
  if (text == null) return { book, diagnostics: bag.list };
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { book, diagnostics: bag.list };
  if (!Array.isArray(raw.plotlines)) {
    bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `${file} 缺少 plotlines 数组，按空情节线处理`, {
      file,
      line: 1,
      column: 1,
    });
    return { book, diagnostics: bag.list };
  }

  const seen = new Set<string>();
  /** 主线唯一：多余的主线条目降级为支线 */
  let mainSeen = false;
  raw.plotlines.forEach((item, index) => {
    const loc = { file, line: index + 1, column: 1 };
    if (!isObject(item)) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `plotlines[${index}] 不是对象，已忽略`, loc);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `plotlines[${index}] 缺少稳定 ID，已忽略`, loc);
      return;
    }
    if (seen.has(id)) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `情节线 ID "${id}" 重复，已忽略后者`, loc);
      return;
    }
    seen.add(id);
    const wantsMain = item.kind === "main";
    if (wantsMain && mainSeen) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `情节线「${id}」重复声明为主线，已按支线处理`, loc);
    }
    // 线索线（thread）：设定型 / 伏笔型的登记线，只在项目文件里维护，不由剧本推导
    const wantsThread = item.kind === "thread";
    const kind: Plotline["kind"] = wantsMain
      ? mainSeen
        ? "branch"
        : "main"
      : wantsThread
        ? "thread"
        : "branch";
    if (kind === "main") mainSeen = true;
    const plotline: Plotline = {
      id,
      // 主线固定叫「主线」，名字不可改
      name:
        kind === "main"
          ? MAIN_PLOTLINE_NAME
          : typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : id,
      kind,
    };
    // 功能类型：支线与线索线有效，主线不参与分类；无法识别按未分类处理（warning，不阻断）
    if (kind !== "main" && item.type !== undefined && item.type !== null) {
      const type = parsePlotlineType(item.type);
      if (type) {
        plotline.type = type;
      } else {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `情节线「${plotline.name}」的功能类型 ${JSON.stringify(item.type)} 无法识别，已按未分类处理`,
          loc,
          { plotlineId: id },
        );
      }
    }
    // 线索线是设定型 / 伏笔型的登记线：类型必须有，且建议落在这两类
    if (kind === "thread") {
      if (!plotline.type) {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `线索线「${plotline.name}」缺少功能类型（应为设定型 setting 或伏笔型 foreshadow）`,
          loc,
          { plotlineId: id },
        );
      } else if (plotline.type !== "setting" && plotline.type !== "foreshadow") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `线索线「${plotline.name}」的类型是「${plotline.type}」，设定型 / 伏笔型之外的类型建议走结构支线`,
          loc,
          { plotlineId: id },
        );
      }
    }
    // 可跳过支线（optional）：仅支线有效，表示"整条线由它自己的片段里的选项决定是否继续播放"
    if (item.optional !== undefined && item.optional !== null) {
      if (kind !== "branch") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `情节线「${plotline.name}」不是支线，已忽略「可跳过支线」设置`,
          loc,
          { plotlineId: id },
        );
      } else if (typeof item.optional !== "boolean") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `情节线「${plotline.name}」的 optional 必须是 true / false，已忽略`,
          loc,
          { plotlineId: id },
        );
      } else if (item.optional) {
        plotline.optional = true;
      }
    }
    if (Array.isArray(item.labelIds)) {
      const labelIds = item.labelIds.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (labelIds.length) plotline.labelIds = labelIds;
    }
    book.plotlines.push(plotline);
  });

  return { book, diagnostics: bag.list };
}

/** 由情节线名称生成稳定 ID（保留中英文数字，其余折成下划线） */
export function makePlotlineId(name: string, used?: Set<string>): string {
  const slug = name
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const base = `pl_${slug || "branch"}`;
  if (!used || !used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** 片段所属情节线名称：`@plot` 行没写 `| 名称` 时归「主线」 */
export function plotlineNameOfLabel(label: ScriptLabel): string {
  return (label.plotline ?? "").trim() || MAIN_PLOTLINE_NAME;
}

/**
 * 用剧本里的 `@plot ... | <情节线名>` 重新生成情节线归属。
 *  - 主线唯一，名称固定「主线」；没写情节线的片段归主线，主线不带支线类型。
 *  - 支线按剧本中首次出现的顺序创建，同名复用同一条；已有 ID 与支线类型尽量沿用，避免 JSON 抖动。
 *  - 已不被任何片段引用的支线会被丢弃。
 */
export function syncPlotlinesFromLabels(
  labels: Record<string, ScriptLabel>,
  book?: PlotlineBook | null,
): PlotlineBook {
  const source = book?.plotlines ?? [];
  const mainSource = source.find((p) => p.kind === "main");
  // 主线只保留 ID，名称与归属都以剧本为准
  const main: Plotline = {
    id: mainSource?.id ?? "pl_main",
    name: MAIN_PLOTLINE_NAME,
    kind: "main",
  };
  // 支线类型是编辑器元数据：归属按剧本重推，但类型按名字沿用，不能每次打开项目就丢
  const typeByName = new Map<string, PlotlineType>();
  for (const p of source) {
    if (p.kind !== "branch" || !p.type) continue;
    typeByName.set(p.name, p.type);
  }
  // 「可跳过」同样是编辑器元数据：按 ID 沿用，避免每次打开项目就丢
  const optionalById = new Set<string>();
  for (const p of source) {
    if (p.kind !== "branch" || !p.optional) continue;
    optionalById.add(p.id);
  }

  // 线索线（thread）不由剧本推导：原样保留，只过滤掉已不存在的片段 ID
  const threads: Plotline[] = [];
  for (const p of source) {
    if (p.kind !== "thread" || p.id === main.id) continue;
    const item: Plotline = { id: p.id, name: p.name, kind: "thread" };
    if (p.type) item.type = p.type;
    const ids = (p.labelIds ?? []).filter((id) => Boolean(labels[id]));
    if (ids.length) item.labelIds = ids;
    threads.push(item);
  }

  // 按剧本顺序收集 name -> labelIds（每个片段只归一条线，天然唯一）
  const idsByName = new Map<string, string[]>();
  for (const label of labelList(labels)) {
    const name = plotlineNameOfLabel(label);
    const ids = idsByName.get(name);
    if (ids) ids.push(label.id);
    else idsByName.set(name, [label.id]);
  }

  const used = new Set<string>([main.id, ...threads.map((t) => t.id)]);
  const branches: Plotline[] = [];
  const created = new Map<string, Plotline>();
  const create = (name: string, preferredId?: string): Plotline => {
    let id = preferredId?.trim() ?? "";
    if (!id || used.has(id)) id = makePlotlineId(name, used);
    used.add(id);
    const item: Plotline = { id, name, kind: "branch" };
    const type = typeByName.get(name);
    if (type) item.type = type;
    if (optionalById.has(id) || (preferredId && optionalById.has(preferredId.trim()))) {
      item.optional = true;
    }
    created.set(name, item);
    branches.push(item);
    return item;
  };

  // 先沿用 JSON 里已有支线的顺序与 ID（只保留剧本里仍在用的名字）
  for (const p of source) {
    if (p.kind !== "branch" || created.has(p.name) || !idsByName.has(p.name)) continue;
    create(p.name, p.id);
  }
  // 剧本里新出现的支线，按出现顺序追加
  for (const name of idsByName.keys()) {
    if (name === MAIN_PLOTLINE_NAME || created.has(name)) continue;
    create(name);
  }

  for (const [name, ids] of idsByName) {
    const item = name === MAIN_PLOTLINE_NAME ? main : created.get(name);
    if (item) item.labelIds = ids;
  }
  if (!main.labelIds?.length) delete main.labelIds;

  return {
    schemaVersion: book?.schemaVersion ?? PROJECT_SCHEMA_VERSION,
    // 顺序：主线 → 支线（剧本首次出现顺序）→ 线索线（登记顺序）
    plotlines: [main, ...branches, ...threads],
  };
}

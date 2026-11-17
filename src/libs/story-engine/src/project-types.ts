/**
 * Editor 优先模型的数据类型
 *
 * 设计原则（来自需求文档）：
 *  - 一个剧情项目 = 一个目录 = 多个剧本文件 + 项目级状态定义 + 菜单定义 + 编排连接。
 *  - 剧本里的 `@plot` 是剧情节点片段（编排的基本单元），`@menu` 是片段内的交互入口。
 *  - 菜单的选项/交互配置不塞进 Markdown，而是存在项目级 `story.project.json` 的 `menus` 段，源码只留稳定锚点。
 *  - 节点之间的执行关系只由 `orchestration` 段表达，不从文件/行顺序推断。
 *  - 全部 ID 由系统生成或写入受控语法，作者界面默认不暴露，改名不断连接。
 */

import type { Asset, Step } from "./types.ts";

/* ------------------------- 诊断 ------------------------- */

export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * 诊断来源（由 code 前缀归一，见 `diagnosticSource`）。
 * 用于判断“这条诊断应该由谁负责重算”：
 *   script 解析结果不会因改菜单而变；menu / orchestration / plotline 则由本地数据重算。
 */
export type DiagnosticSource =
  | "script"
  | "state"
  | "menu"
  | "orchestration"
  | "plotline"
  | "asset"
  | "project"
  | "runtime";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** 来源域（收集时自动填入，无需调用方手写） */
  source?: DiagnosticSource;
  /** 相对项目根目录的路径（如 "story/01-码头.story.md"） */
  file?: string;
  /** 1 基行号 */
  line?: number;
  /** 1 基列号 */
  column?: number;
  /** 结构化附加信息（候选 ID、引用位置等） */
  data?: Record<string, unknown>;
}

/* ------------------------- 状态值定义 ------------------------- */

/**
 * 状态值类型：
 *  - number：数字（支持 add/sub）
 *  - boolean：布尔
 *  - string：自由字符串
 *  - enum：自定义下拉列表，只能取 options 中的一项
 */
export type StateType = "boolean" | "number" | "string" | "enum";

export interface StateDefinition {
  /** 系统生成的稳定 ID（作者界面默认隐藏，不允许手工改） */
  id: string;
  /** 作者可见名称 */
  name: string;
  /** 图例（图标字符/图标名，用于编排/菜单/预览快速识别） */
  icon?: string;
  type: StateType;
  initial: unknown;
  description?: string;
  min?: number;
  max?: number;
  values?: string[];
  /** enum（下拉列表）的可选项；initial 必须是其中一项 */
  options?: string[];
}

export interface StateModule {
  schemaVersion: number;
  states: StateDefinition[];
}

/* ------------------------- 状态效果 ------------------------- */

export type StateEffectOp = "set" | "add" | "sub";

/** 一次状态写入（菜单选择、交互结果都可携带） */
export interface StateEffect {
  stateId: string;
  op: StateEffectOp;
  value: unknown;
}

/* ------------------------- 菜单 ------------------------- */

/**
 * 菜单类型：
 *  - choice：剧情选项，玩家可见、需要选择；
 *  - condition：条件出口，玩家不可见，片段播完后按 `when` 自动分流。
 * 两者都挂在片段上（labelId），同一片段只允许一种（硬互斥）。
 */
export type MenuType = "choice" | "condition";

/**
 * 菜单的结算方式：
 *  - out（跳出）：结算后按编排连线跳到其它片段
 *  - back（回归）：结算后回到本片段，从菜单所在位置之后继续播放，不查连线
 */
export type MenuJump = "out" | "back";

/** 剧情选项：显示决定，结果 ID 稳定，不携带目标节点 */
export interface MenuChoiceItem {
  /** 菜单项稳定 ID（菜单内部唯一） */
  id: string;
  /** 稳定结果 ID（编排路由键） */
  resultId: string;
  /** 显示文案（可改，不影响连接） */
  text: string;
  /** 选择后写入的状态 */
  effects?: StateEffect[];
  /** 可选条件：不满足时该项不可用/隐藏 */
  require?: string;
}

export interface MenuDefinition {
  /** 菜单稳定 ID */
  id: string;
  /** 所属片段：菜单挂在片段上，脚本里不再出现 @menu */
  labelId: string;
  type: MenuType;
  /** 结算方式：跳出 / 回归 */
  jump: MenuJump;
  /** 菜单标题（作者可见） */
  title: string;
  /**
   * 片段内插入位置：播放完前 index 个步骤后触发菜单。
   * 0 = 片段开头；缺省 = 片段末尾（跟随片段长度变化）。
   */
  index?: number;
  /** 剧情选项的选项列表（type = choice 时必填） */
  items?: MenuChoiceItem[];
  /**
   * 条件出口（type = condition）：状态表达式。
   * 例：`"true"`、`"flag('has_worm') === true"`、`"num('stones') >= 30"`。
   * 运行时按同一片段内菜单的定义顺序求值，取第一条命中的出口。
   */
  when?: string;
  /** 条件出口（type = condition）：目标片段 ID；与 end 二选一 */
  to?: string;
  /** 条件出口（type = condition）：为 true 时直接结束本局 */
  end?: boolean;
}

export interface MenuBook {
  schemaVersion: number;
  menus: Record<string, MenuDefinition>;
}

/** 一个菜单结果（菜单选项的对外形态） */
export interface MenuResult {
  resultId: string;
  text: string;
  require?: string;
  effects?: StateEffect[];
}

/* ------------------------- 剧本片段 ------------------------- */

/** 片段内的菜单锚点：位于第 index 个步骤之前（0 表示片段开头） */
export interface LabelMenuAnchor {
  menuId: string;
  index: number;
  line: number;
}

/** @plot 定义的剧情节点片段 */
export interface ScriptLabel {
  /** 稳定 ID（改名不变） */
  id: string;
  /** 显示名称（可改） */
  name: string;
  /**
   * 所属情节线名称（`@plot` 行末尾 `| <情节线名>` 声明）。
   * 缺省表示「主线」；主线固定名为「主线」，其余都是支线。
   */
  plotline?: string;
  /**
   * 片段在情节线里的位置（`@plot` 行末尾 `$<位置>` 声明）。
   * 推荐「起点 / 铺垫 / 高潮 / 转折 / 结局」，也允许作者自定；缺省表示未标注。
   */
  position?: string;
  /** 所属文件（相对项目根） */
  file: string;
  /** @plot 所在行 */
  line: number;
  /** 片段结束行（下一个 label 前一行/文件末尾） */
  endLine: number;
  /** 片段内按源码顺序的原子步骤 */
  steps: Step[];
  /** 片段内按源码顺序的菜单锚点 */
  menus: LabelMenuAnchor[];
}

export interface ScriptFileDoc {
  file: string;
  labels: ScriptLabel[];
  diagnostics: Diagnostic[];
}

/* ------------------------- 情节线 ------------------------- */

/**
 * 情节线类型：
 * - `main` 主线：始终播放；
 * - `branch` 支线：由选项 / 显式连线打开，参与播放结构；
 * - `thread` 线索线：设定型 / 伏笔型的登记线，片段仍属主线，不参与播放结构。
 */
export type PlotlineKind = "main" | "branch" | "thread";

/**
 * 支线的功能类型（见 `1 情节线与剧情结构规范.md` §12.2），按对主线的反作用力从强到弱：
 * 设定型 / 伏笔型 / 冲突型 / 势力型 / 角色型 / 资源型 / 情感型。
 * 只描述"这条支线在替主线做什么"，不改变归属判定；主线不参与分类。
 */
export type PlotlineType =
  | "setting"
  | "foreshadow"
  | "conflict"
  | "faction"
  | "character"
  | "resource"
  | "emotion";

/**
 * 情节线：对应小说里的「主线」「支线-xxx」等。
 * 归属与展示用；`optional` 参与运行时的顺序出口判定，其余字段不参与运行时。
 * ID 稳定，改名不影响引用。
 */
export interface Plotline {
  /** 稳定 ID（系统生成，建议 pl_ 前缀） */
  id: string;
  /** 显示名，可改 */
  name: string;
  /** 主线 / 支线 / 线索线 */
  kind: PlotlineKind;
  /**
   * 功能类型（支线与线索线有效；主线不写）。
   * 属于编辑器元数据，保存在 `story.project.json` 的 `plotlines` 段，不写进剧本 `@plot` 行。
   */
  type?: PlotlineType;
  /**
   * 是否为「可跳过支线」（仅 `kind: "branch"` 有效）：
   *  - 不写 / `false`：核心支线，片段始终按连线与顺序播放，永不自动跳过；
   *  - `true`：非核心支线，只有本局**进入过**它的片段后才继续播放；
   *    本条线内任一片段的菜单若选择了离开本线，
   *    整条支线关闭，之后归属本线的片段在顺序出口上全部跳过。
   * 这是支线**自身**的开关，不表达支线之间的依赖。
   */
  optional?: boolean;
  /**
   * 片段 ID（有序）。
   * 主线 / 支线由剧本 `@plot` 推导；线索线（`thread`）由项目文件登记，允许与主线重叠。
   */
  labelIds?: string[];
}

export interface PlotlineBook {
  schemaVersion: number;
  /** 数组顺序 = 列表展示顺序 */
  plotlines: Plotline[];
}

/* ------------------------- 编排 ------------------------- */

/**
 * 一条编排连接。
 *  - 菜单出口：fromMenu + resultId → to / end
 *  - 无菜单片段的自动出口：fromLabel → to / end
 *  - when 可选：同一结果需要条件分流时才使用
 */
export interface OrchestrationLink {
  id: string;
  fromMenu?: string;
  fromLabel?: string;
  resultId?: string;
  to?: string;
  end?: boolean;
  when?: string;
  /**
   * 由 condition 菜单派生（值为菜单 ID）。加载时生成，只存在于内存；
   * 序列化时会被剔除，保证 `menus` 是条件出口的唯一真相。
   */
  derivedFromMenu?: string;
}

export interface Orchestration {
  schemaVersion: number;
  /** 入口 label ID（项目级） */
  entry: string;
  links: OrchestrationLink[];
}

/* ------------------------- 项目 ------------------------- */

/** 项目完整数据（编辑器与运行时共用同一份） */
export interface ProjectDoc {
  root: string;
  /** 剧本文件（相对项目根，已按文件名排序） */
  files: string[];
  scripts: ScriptFileDoc[];
  /** labelId → label（跨文件全局唯一） */
  labels: Record<string, ScriptLabel>;
  states: StateModule;
  menus: MenuBook;
  plotlines: PlotlineBook;
  orchestration: Orchestration;
  /** 素材注册表（assets.json 的磁盘形态，编辑器素材面板/预览共用） */
  assets: { nextId: number; items: Record<string, Asset> };
  diagnostics: Diagnostic[];
}

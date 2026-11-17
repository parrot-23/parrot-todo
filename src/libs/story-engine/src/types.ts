/**
 * 叙事骨架包 —— 核心数据类型定义
 *
 * 三段架构：
 *  1. 叙事骨架包：节点（幕/章/场景）+ 原子步骤 + 资源包 + 结局定义器
 *  2. 加载解释器：按序播放（见 engine.ts）
 *  3. 任务槽位提供器：task 步骤 + engine.state.task（见 engine.ts）
 *
 * 设计原则：
 *  - 所有实体用字符串 id 引用，全局唯一，实现"注册节点 id / 资源 id"。
 *  - 步骤原子化：每个 step 只做一件事（背景/立绘/对话/事件/flag/task/branch 之一）。
 *  - choices 是结局定义器：场景内的选项决定下一跳，支持多结局 / 卡关重来 / 单结局。
 */

/** 资源种类 */
export type AssetKind = "image" | "audio" | "video" | "sprite" | "font";

/**
 * 素材（资源）条目：唯一有独立 id 的实体。
 *
 * 设计要点（素材 id 化）：
 *  - id 由系统生成（如 "res_0001"），是唯一、稳定的引用键，作者不可见。
 *  - name 是作者写的显示名（如 "大厅"、"A"、"主题曲"），可随时改名，改名不影响 id 引用。
 *  - 同名自动归并：解析时按 (kind, name) 归并，多个章节里同名素材复用同一 id。
 *  - path 是真实文件路径（相对剧情包目录或占位），由编辑器绑定。
 */
export interface Asset {
  id: string;
  kind: AssetKind;
  /** 作者写的显示名（可改名，改名不断引用） */
  name: string;
  /** 本地文件路径（相对骨架包目录或绝对路径；未绑定时为占位） */
  path: string;
  /** 可选元数据（立绘的表情/位置等可在 sprite 步骤里覆盖） */
  meta?: Record<string, unknown>;
}

/** 节点类型：幕 / 章 / 场景 */
export type NodeType = "act" | "chapter" | "scene";

/** 节点定义（幕/章/场景统一结构） */
export interface Node {
  id: string;
  type: NodeType;
  title: string;
  /** 子节点 id 列表（幕→章，章→场景；场景为空数组） */
  children: string[];
}

/* ------------------------- 文本通道 ------------------------- */

/**
 * 文本通道：把「这句文本是谁、以什么方式发出的」统一分类。
 *
 * 角色侧（`@actor <角色名> #<通道> <内容>`）：
 *  - say    台词（说出口的话）
 *  - inner  心声（心里的话，不产生声音）
 *  - act    动作（以文本描述的角色行为）
 *  - sprite 立绘（角色形象）
 *
 * 旁白侧（`@narr #<通道> <内容>`）：
 *  - bg     背景
 *  - vo     旁白（镜头语言，只写可观察事实）
 *  - bgm    音乐
 *  - sfx    音效
 *  - fx     画面特效
 *  - item   关键物品（画面中心展示一件道具，不产生文本）
 */
export type ActorChannel = "say" | "inner" | "act" | "sprite";
export type NarrChannel = "bg" | "vo" | "bgm" | "sfx" | "fx" | "item";
export type StepChannel = ActorChannel | NarrChannel;

/**
 * 展示型步骤的公共字段。
 *
 * 通道由 `@actor` / `@narr` 显式标注，**必填**：旧语法已不再兼容，
 * 凡是展示型步骤都必须能回答「这条文本属于哪个通道」。
 */
export interface StepBase {
  channel: StepChannel;
}

/* ------------------------- 原子步骤 ------------------------- */

/** 背景步骤 */
export interface BgStep extends StepBase {
  type: "bg";
  channel: "bg";
  asset: string; // 资源 id
  transition?: string; // 如 "fade_in_2s"
}

/** 立绘步骤 */
export interface SpriteStep extends StepBase {
  type: "sprite";
  channel: "sprite";
  asset: string; // 立绘素材 id（kind=sprite，素材 name 即人物名）
  pose?: string; // 表情/姿势，如 "smile"
  position?: string; // 如 "left" | "center" | "right"
  enter?: boolean; // 是否登场动画
}

/** BGM 步骤 */
export interface BgmStep extends StepBase {
  type: "bgm";
  channel: "bgm";
  asset: string;
  fade?: number; // 渐入秒数
}

/** 音效步骤 */
export interface SfxStep extends StepBase {
  type: "sfx";
  channel: "sfx";
  asset: string;
  volume?: number;
}

/** 对话步骤（台词 / 心声） */
export interface DialogStep extends StepBase {
  type: "dialog";
  /** 通道：say = 台词，inner = 心声 */
  channel: "say" | "inner";
  /** 说话人名字（仅显示用，不绑定素材；人物形象由 #sprite 立绘素材决定） */
  speaker: string;
  text: string;
}

/** 旁白步骤（旁白 / 角色动作） */
export interface NarrationStep extends StepBase {
  type: "narration";
  /** 通道：vo = 旁白，act = 角色动作 */
  channel: "vo" | "act";
  text: string;
  /** channel = act 时的施动角色（显示用，不产生素材需求） */
  speaker?: string;
}

/** 画面特效步骤 */
export interface EffectStep extends StepBase {
  type: "effect";
  channel: "fx";
  effect: string; // 如 "shake" | "flash" | "fade_out"
  params?: Record<string, unknown>;
}

/**
 * 关键物品步骤（`@narr #item <素材名>`）。
 *
 * 播到这一步时在画面中心浮出物品图，播完/切到下一步即收起。
 * 只登记素材，不产生文本；素材 kind 复用 `image`（见 `4` §3.5）。
 */
export interface ItemStep extends StepBase {
  type: "item";
  channel: "item";
  asset: string; // 物品素材 id（kind=image，素材 name 即物品名）
}

/** 数值/状态变更步骤（flag 系统，用于多结局汇合与条件判断） */
export interface FlagStep {
  type: "flag";
  key: string;
  value: unknown;
  /** 写入方式：set（默认）/ add / sub，对应 @flag 键=值 / 键+=值 / 键-=值 */
  op?: "set" | "add" | "sub";
}

/** 任务槽位步骤：向任务剧情提供器写入当前任务 */
export interface TaskStep {
  type: "task";
  taskId: string;
  description?: string;
  /** 任务状态：active / completed / failed */
  status?: "active" | "completed" | "failed";
}

/** 分支步骤：读 flags 判断，动态决定跳转目标（用于结局路径判断） */
export interface BranchStep {
  type: "branch";
  /** 条件表达式，如 "flag('通过') === true" 或 "flag('好感度') >= 5" */
  condition: string;
  /** 满足条件的跳转场景 id */
  gotoIfTrue?: string;
  /** 不满足条件的跳转场景 id（缺省则停留/重来） */
  gotoIfFalse?: string;
}

/** 所有步骤的联合类型 */
export type Step =
  | BgStep
  | SpriteStep
  | BgmStep
  | SfxStep
  | DialogStep
  | NarrationStep
  | EffectStep
  | ItemStep
  | FlagStep
  | TaskStep
  | BranchStep;

/* ------------------------- 结局定义器 ------------------------- */

/** 场景内的一个选项（分支） */
export interface Choice {
  text: string;
  /** 下一跳场景 id */
  goto: string;
  /** 可选：满足条件才显示/可用的选项（卡关重来的依据） */
  require?: string;
  /** 可选：选择后写入 flag（如 flag: { "回应了A": true }） */
  setFlags?: Record<string, unknown>;
  /** 可选：retry 标记——未通过时回到当前场景重来 */
  retry?: boolean;
}

/* ------------------------- 骨架包顶层 ------------------------- */

export interface Skeleton {
  meta: {
    title: string;
    version: number;
    /** 作者/描述等自由字段 */
    [k: string]: unknown;
  };
  /** 节点注册表：id → 节点 */
  nodes: Record<string, Node>;
  /** 步骤注册表：id → 原子步骤 */
  steps: Record<string, Step>;
  /** 素材注册表：素材 id → 素材（id 系统生成、同名归并、name 可改名） */
  assets: Record<string, Asset>;
  /** 结局定义器：场景 id → 选项列表 */
  choices: Record<string, Choice[]>;
  /** 入口场景 id */
  entry: string;
}

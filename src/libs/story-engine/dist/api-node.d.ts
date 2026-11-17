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
interface Node {
	id: string;
	type: NodeType;
	title: string;
	/** 子节点 id 列表（幕→章，章→场景；场景为空数组） */
	children: string[];
}
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
/** 背景步骤 */
export interface BgStep extends StepBase {
	type: "bg";
	channel: "bg";
	asset: string;
	transition?: string;
}
/** 立绘步骤 */
export interface SpriteStep extends StepBase {
	type: "sprite";
	channel: "sprite";
	asset: string;
	pose?: string;
	position?: string;
	enter?: boolean;
}
/** BGM 步骤 */
export interface BgmStep extends StepBase {
	type: "bgm";
	channel: "bgm";
	asset: string;
	fade?: number;
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
	effect: string;
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
	asset: string;
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
export type Step = BgStep | SpriteStep | BgmStep | SfxStep | DialogStep | NarrationStep | EffectStep | ItemStep | FlagStep | TaskStep | BranchStep;
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
export type DiagnosticSeverity = "error" | "warning" | "info";
/**
 * 诊断来源（由 code 前缀归一，见 `diagnosticSource`）。
 * 用于判断“这条诊断应该由谁负责重算”：
 *   script 解析结果不会因改菜单而变；menu / orchestration / plotline 则由本地数据重算。
 */
export type DiagnosticSource = "script" | "state" | "menu" | "orchestration" | "plotline" | "asset" | "project" | "runtime";
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
export type StateEffectOp = "set" | "add" | "sub";
/** 一次状态写入（菜单选择、交互结果都可携带） */
export interface StateEffect {
	stateId: string;
	op: StateEffectOp;
	value: unknown;
}
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
export type PlotlineType = "setting" | "foreshadow" | "conflict" | "faction" | "character" | "resource" | "emotion";
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
	assets: {
		nextId: number;
		items: Record<string, Asset>;
	};
	diagnostics: Diagnostic[];
}
/**
 * 项目目录布局约定（只放常量，避免模块间循环依赖）
 *
 * 当前布局：
 *   story.project.json   状态 / 菜单 / 编排（合并后的单文件）
 *   assets.json          素材注册表（保持独立）
 *   story/*.story.md     剧本文件（纯文本，保持独立）
 *
 * 旧布局（仍可读取）：states.json + menus.json + orchestration.json，
 * 以及剧本文件直接放在项目根目录。
 */
/** 合并后的项目数据文件名（项目根目录） */
export declare const PROJECT_FILE_NAME = "story.project.json";
/** 剧本文件目录（相对项目根）；老项目没有该目录时回退项目根 */
export declare const STORY_DIR = "story";
/** 旧版分散文件；仅用于向后兼容读取与迁移提示 */
export declare const LEGACY_PROJECT_FILES: readonly [
	"states.json",
	"menus.json",
	"orchestration.json"
];
/** 文件系统适配器（路径相对项目根、"/" 分隔） */
export interface ProjectIO {
	readText(rel: string): string | null;
	exists(rel: string): boolean;
	listFiles(relDir: string): string[];
	listDirs(relDir: string): string[];
	readBytes?(rel: string): Uint8Array | null;
}
/** 剧本文件扩展名（按优先级） */
export declare const SCRIPT_EXTENSIONS: readonly [
	".story.md",
	".md",
	".markdown",
	".txt"
];
export interface LoadProjectOptions {
	/** 只加载指定剧本文件（默认全部） */
	files?: string[];
}
/** 目标 label 列表（编辑器连线下拉用） */
export declare function labelList(labels: Record<string, ScriptLabel>): ScriptLabel[];
/** 支线取舍档位（见 `1 情节线与剧情结构规范.md` §12.4） */
export type PlotlineTier = "core" | "important" | "optional";
/**
 * 支线功能类型清单（见 `1 情节线与剧情结构规范.md` §12.2）。
 * 顺序即"对主线的反作用力"强弱顺序，也是取舍优先级；主线不参与分类。
 */
export declare const PLOTLINE_TYPES: {
	id: PlotlineType;
	name: string;
	/** 取舍档位：核心 / 重要 / 可删减 */
	tier: PlotlineTier;
	desc: string;
}[];
/** 档位显示名 */
export declare const PLOTLINE_TIER_NAME: Record<PlotlineTier, string>;
/** 由情节线名称生成稳定 ID（保留中英文数字，其余折成下划线） */
export declare function makePlotlineId(name: string, used?: Set<string>): string;
/**
 * 素材库持久化结构（assets.json 的磁盘形态）。
 * items 按 id 索引；nameIndex 是 (kind:name → id) 的反向索引，便于同名归并查询。
 */
export interface AssetLibraryData {
	/** 下一个素材 id 的序号（持久化，避免 id 复用） */
	nextId: number;
	/** 素材注册表：id → 素材 */
	items: Record<string, Asset>;
}
/** 内存中的素材库（含运行期归并索引，不持久化） */
export interface AssetLibrary {
	data: AssetLibraryData;
	/** 归并索引：`kind:name` → 素材 id（运行期构建，不写入 assets.json） */
	nameIndex: Map<string, string>;
}
/** 创建空素材库 */
export declare function createLibrary(): AssetLibrary;
/** 从 assets.json 内容加载素材库（非法/缺失时返回空库） */
export declare function loadLibrary(json: string): AssetLibrary;
/** 序列化素材库为 assets.json 文本 */
export declare function serializeLibrary(lib: AssetLibrary): string;
/** 重建归并索引 */
export declare function rebuildIndex(lib: AssetLibrary): void;
/**
 * 按 (kind, name) 归并查询/创建素材，返回素材 id。
 *
 * - 命中已有素材 → 返回其 id（同名复用，跨章节/跨会话稳定）。
 * - 未命中 → 新建素材（占位 path），写入库并返回新 id。
 */
export declare function resolveAsset(lib: AssetLibrary, name: string, kind: AssetKind): string;
/** 改名：改素材的 name（并同步归并索引），id 不变 */
export declare function renameAsset(lib: AssetLibrary, id: string, newName: string): boolean;
/** 绑定真实文件路径到素材（编辑器导入素材时调用） */
export declare function bindAssetPath(lib: AssetLibrary, id: string, path: string): boolean;
/** 取素材显示名（id → name，查不到返回 id 本身） */
export declare function assetDisplayName(lib: AssetLibrary, id: string): string;
/** 由显示名称生成 label ID（创建时用；之后改名不再改变） */
export declare function makeLabelId(name: string, used: Set<string>): string;
/** 由显示名称生成菜单 ID */
export declare function makeMenuId(name: string, used: Set<string>): string;
/** 由结果文案生成结果 ID（菜单编辑器用） */
export declare function makeResultId(text: string, used: Set<string>): string;
/** 生成状态值稳定 ID（系统生成、作者不可见；创建后不再变化） */
export declare function makeStateId(used: Set<string>): string;
/** 推荐的位置标签：也允许作者自定（`$自定义`） */
export declare const LABEL_POSITIONS: readonly [
	"\u8D77\u70B9",
	"\u94FA\u57AB",
	"\u9AD8\u6F6E",
	"\u8F6C\u6298",
	"\u7ED3\u5C40"
];
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
export declare function parseDSL(source: string, meta?: Partial<Skeleton["meta"]>, library?: AssetLibrary): Skeleton;
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
export type EngineEvent = {
	type: "scene:enter";
	sceneId: string;
	title: string;
} | {
	type: "step";
	step: Step;
	sceneId: string;
	stepIndex: number;
} | {
	type: "choice:present";
	choices: Choice[];
} | {
	type: "task:set";
	task: TaskSlot;
} | {
	type: "end";
	reason: "no_more_steps" | "no_choices" | "explicit";
};
export type Listener = (e: EngineEvent) => void;
export declare class StoryEngine {
	private skeleton;
	/** 场景 id → 该场景的步骤 id 顺序列表（预解析，加速播放） */
	private sceneSteps;
	private listeners;
	state: EngineState;
	constructor(skeleton: Skeleton);
	/** 校验 + 建立场景→步骤索引 */
	private indexScenes;
	/** 订阅事件 */
	subscribe(fn: Listener): () => void;
	private emit;
	/** 启动：进入入口场景 */
	start(): void;
	/** 解析场景引用：优先精确 id，回退到按标题匹配 */
	private resolveSceneId;
	/** 进入指定场景。
	 * @param sceneId 场景 id 或标题
	 * @param startStepIndex 从该场景第几个步骤开始（编辑器"点击某步骤"跳转）
	 * @param autoPlay true = 同步一次性播完该场景（默认，兼容旧行为）；false = 仅进入场景，
	 *                 由调用方通过 nextStep() 逐步推进（顺序播放用）
	 */
	enterScene(sceneId: string, startStepIndex?: number, autoPlay?: boolean): void;
	/**
	 * 播放下一步（分步播放核心）。
	 * @returns "step" = 已播一步、可能还有后续；"choices" = 本场景步骤播完、已呈现选项；
	 *          "end" = 已结束；"none" = 无更多可播（已结束或已呈现选项）
	 */
	nextStep(): "step" | "choices" | "end" | "none";
	/** 应用一个步骤的副作用（flag/task/branch） */
	private applyStep;
	/** 呈现当前场景的选项（结局定义器） */
	private presentChoices;
	/** 玩家做出选择 */
	choose(choice: Choice, autoPlay?: boolean): void;
	private finish;
	/** 获取某场景的全部选项（编辑器可视化用） */
	getChoices(sceneId: string): Choice[];
	/** 获取骨架包（只读访问） */
	getSkeleton(): Skeleton;
	/** 获取所有场景节点（编辑器可视化用） */
	getSceneNodes(): Node[];
	/** 获取某场景的步骤 id 顺序列表（编辑器右侧步骤面板用） */
	getSceneStepIds(sceneId: string): string[];
}
export declare function isActorChannel(value: string): value is ActorChannel;
export declare function isNarrChannel(value: string): value is NarrChannel;
/**
 * 取步骤的文本通道。
 * `@flag` / 分支等非展示步骤没有 `channel` 字段，返回 null。
 */
export declare function stepChannel(step: Step): StepChannel | null;
/**
 * 文本步骤的标题（播放器气泡抬头）：
 *  - 台词 → 角色名
 *  - 心声 → `角色名（心声）`
 *  - 动作 → 角色名（无角色名时退回「旁白」）
 *  - 旁白 → 「旁白」
 *  - 其它步骤 → null（不产生气泡）
 */
export declare function stepTitle(step: Step): string | null;
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
/**
 * 角色名：含空白时必须用引号包裹，否则解析器只会取第一个空白前的片段。
 * 名字里已经带了某对引号时自动换下一对；全都撞上则原样返回（由校验提示）。
 */
export declare function quoteSpeaker(name: string): string;
/**
 * `@plot <id> <名称> #<情节线> $<位置>`
 *
 * 名称里的 ` #` / ` $` 会被空格替换——解析器把「空白 + #/$」当成标记起点，
 * 不清掉会被误判成情节线/位置。
 */
export declare function formatLabelHeader(spec: LabelHeaderSpec): string;
/** `@actor <角色名> #say|#inner|#act <文本>` */
export declare function formatActorLine(speaker: string, channel: ActorChannel, text: string): string;
/**
 * `@actor <角色名> #sprite <表情>/<位置>`
 * 两段都可省略；只有位置时写成 `/右`。表情与位置都不能含空白。
 */
export declare function formatSpriteLine(speaker: string, pose?: string, position?: string): string;
/** `@narr #vo <文本>` / `@narr #fx <特效名>` */
export declare function formatNarrLine(channel: NarrChannel, body: string): string;
/**
 * `@narr #bg|#bgm|#sfx|#item <资源名>(<参数>)`
 * - bg 的参数来自 `transition`（形如 `fade_in_2s`），写成 `(2秒)`
 * - bgm 的参数来自 `fade`（秒）
 * - sfx / item 无参数
 */
export declare function formatAssetLine(channel: "bg" | "bgm" | "sfx" | "item", assetName: string, params?: {
	fade?: number;
	transition?: string;
}): string;
/**
 * `@flag <键>=<值>` / `+=` / `-=`
 *
 * `rawValue` 是作者输入/生成好的字面量文本，本函数只做单行化与空白收尾，
 * 不改类型：`"3"` 仍写成 `3`（解析为数字），`"'3'"` 才会解析成字符串。
 */
export declare function formatFlagLine(key: string, op: "=" | "+=" | "-=" | "set" | "add" | "sub", rawValue: string): string;
/** 值 → 字面量文本（会被误判成布尔/数字的字符串自动加引号） */
export declare function formatLiteral(value: unknown): string;
/**
 * 步骤 → 一行剧本（`flag` / 旧 `task` 等不可表示时返回空串，由调用方跳过）。
 *
 * @param resolveAssetName 素材 id → 素材名（通常传 `(id) => doc.assets.items[id]?.name ?? id`）
 */
export declare function formatStep(step: Step, resolveAssetName: (assetId: string) => string): string;
/**
 * code 前缀 → 来源域。
 * 由引擎统一归一，调用方不用记前缀规则（例如判断“哪些诊断可以本地重算”）。
 */
export declare function diagnosticSource(code: string): DiagnosticSource;
/** 改菜单 / 编排 / 情节线后需要就地重算的诊断域 */
export declare function isLocalDiagnostic(code: string): boolean;
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
/**
 * 从任意文件系统抽象打开项目。
 *
 * `io` 只要求 4 个同步方法：readText / exists / listFiles / listDirs。
 * - Node / CLI / Electron 主进程：用 `api-node.ts` 的 `openProjectFromDisk(root)`。
 * - 浏览器 / 渲染进程：用 `openProjectFromSnapshot(root, snapshot)`。
 * - 其它（内存、远程）：自行实现这 4 个方法，或用 `snapshotIO`。
 */
export declare function openProject(root: string, io: ProjectIO, options?: LoadProjectOptions): StoryProject;
/** 浏览器 / Electron 渲染进程用：先拿整棵文件树快照，再同步加载 */
export interface ProjectSnapshot {
	/** 相对项目根的全部文件路径（"/" 分隔） */
	files: string[];
	/** 相对项目根的全部目录路径 */
	dirs: string[];
	/** 文件路径 → 文本内容（只需剧本 / json） */
	text: Record<string, string>;
}
export declare function openProjectFromSnapshot(root: string, snapshot: ProjectSnapshot): StoryProject;
/** 把项目快照转成 ProjectIO */
export declare function snapshotIO(snapshot: ProjectSnapshot): ProjectIO;
/**
 * 把项目序列化回磁盘内容。
 * 返回两个文件的文本，写入位置由调用方决定：
 *   projectJson → story.project.json
 *   assetsJson  → assets.json
 */
export declare function saveProject(target: ProjectLike): {
	projectJson: string;
	assetsJson: string;
};
/** 就地校验：重算「菜单 / 编排 / 情节线」类诊断，保留脚本解析与素材诊断基线 */
export declare function revalidate(target: ProjectLike): StoryIssue[];
/**
 * 重新读盘后校验：用磁盘上的最新内容刷新「脚本解析 / 素材」基线，
 * 再就地重算菜单与编排诊断（不替换调用方持有的项目对象）。
 */
export declare function refreshIssues(target: ProjectLike, io: ProjectIO): StoryIssue[];
/**
 * 重算条件出口派生连线。
 * `menus` 是条件出口的唯一真相；每次编辑菜单/编排后调用，落盘时会自动剔除派生项。
 */
export declare function resyncLinks(target: ProjectLike): void;
/** 顺序出口上的下一个片段（"下一个" = 文件顺序 + 源码行号） */
export declare function nextLabelOf(target: ProjectLike, labelId: string): string | null;
/** 片段是否自带跳出型剧情选项菜单（有则不需要默认顺序出口） */
export declare function hasMenuExit(target: ProjectLike, labelId: string): boolean;
/** 菜单的全部可能结果（文案 / 结果 ID / 条件 / 状态效果） */
export declare function menuOptions(menu: MenuDefinition | undefined): MenuResult[];
/** 片段列表（按播放顺序） */
export declare function labelsOf(target: ProjectLike): StoryLabelInfo[];
/** 片段归属的情节线（未归属返回 null） */
export declare function plotlineOfLabel(target: ProjectLike, labelId: string): Plotline | null;
/**
 * 就地同步情节线归属：以剧本 `@plot ... #情节线` 为唯一真相，
 * 重建主线 / 支线段落与 labelIds，并清理失效引用（线索线只清理不重建）。
 */
export declare function syncPlotlines(target: ProjectLike): void;
/**
 * 生成一条状态条件表达式（编辑器"状态 + 运算符 + 值"面板用）。
 * 统一由引擎产出语法，避免编辑器手拼 `flag('x') === y` 造成漂移。
 */
export declare function buildFlagCondition(stateId: string, op: string, rawValue: string, type?: StateType): string;
/**
 * 新建空项目的磁盘内容（脚手架用）。
 * 返回的文本直接写 `story.project.json` / `assets.json`，schema 由引擎维护。
 */
export declare function createEmptyProject(options?: {
	entry?: string;
}): {
	projectJson: string;
	assetsJson: string;
};
/**
 * 一条演出指令（cue）——渲染层的全部输入。
 *
 * `kind` 已经替调用方做完「谁以什么方式发出」的判断，直接 switch 即可：
 *   say 台词 / inner 心声 / act 动作 / vo 旁白 / sprite 立绘 /
 *   bg 背景 / bgm 音乐 / sfx 音效 / fx 特效 / item 物品 /
 *   state 状态变更（无需渲染）/ task 任务（旧项目才会出现）
 */
export type CueKind = "say" | "inner" | "act" | "vo" | "sprite" | "bg" | "bgm" | "sfx" | "fx" | "item" | "state" | "task";
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
export type PlayEvent = {
	type: "enter";
	labelId: string;
	labelName: string;
} | {
	type: "cue";
	cue: StageCue;
} | {
	type: "menu";
	menu: ChoiceMenu;
} | {
	type: "state";
	id: string;
	name: string;
	value: unknown;
	previous: unknown;
} | {
	type: "path";
	from: string;
	to: string;
	reason: string;
} | {
	type: "end";
	reason: "explicit" | "no-exit" | "error";
} | {
	type: "error";
	code: string;
	message: string;
};
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
	error: {
		code: string;
		message: string;
	} | null;
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
export declare function createPlayer(target: ProjectLike, options?: PlayerOptions): StoryPlayer;
/** 把一条内部步骤翻译成调用方可直接渲染的 cue（高级用法） */
export declare function describeStep(target: ProjectLike, step: Step, labelId?: string, index?: number): StageCue;
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
export declare function collectAssets(target: ProjectLike, file?: string): StoryAssetNeed[];
/**
 * 素材清单（按 id 排序）。`project.doc.assets` 是素材的唯一权威，
 * 素材页读写都走这里，不要另外维护一份素材库副本。
 */
export declare function assetsOf(target: ProjectLike): StoryAssetInfo[];
/** 按 id 取素材（不存在返回 null） */
export declare function assetOf(target: ProjectLike, assetId: string): StoryAssetInfo | null;
/**
 * 按 (kind, name) 归并查询/创建素材，返回素材 id。
 * 未命中时新建，占位路径默认 `assets/<image|sprite|audio>/<name>`，可由调用方覆盖。
 */
export declare function ensureAsset(target: ProjectLike, name: string, kind: AssetKind, path?: string): string;
/** 绑定/改回占位：设置素材的真实文件路径 */
export declare function setAssetPath(target: ProjectLike, assetId: string, path: string): boolean;
/** 素材改名（id 不变，引用不断；不做同名合并） */
export declare function setAssetName(target: ProjectLike, assetId: string, name: string): boolean;
export declare function createNodeIO(root: string): ProjectIO;
/** 直接从磁盘目录打开项目（root = 含 story/ 与 story.project.json 的那一层） */
export declare function openProjectFromDisk(root: string, options?: LoadProjectOptions): StoryProject;

export {
	Node as StoryNode,
};

export {};

/**
 * 剧情项目读取
 *
 * 目录约定（全部相对项目根）：
 *   story/*.story.md      剧本文件（可多个；也可用 .md/.txt）
 *   story.project.json    状态值定义 + 菜单定义 + 入口与连接（单文件）
 *   assets.json + assets/ 素材（沿用现有素材管理）
 *
 * 向后兼容：没有 story.project.json 时回退读取旧布局
 * （states.json + menus.json + orchestration.json）；
 * 没有 story/ 目录时，剧本文件按老布局从项目根读取。
 *
 * 文件系统通过 ProjectIO 注入，引擎核心保持纯逻辑：
 * 渲染进程用 IPC 适配、测试/主进程用 Node 适配（见 node-io.ts）。
 */

import type {
  Diagnostic,
  MenuBook,
  Orchestration,
  PlotlineBook,
  ProjectDoc,
  ScriptLabel,
  StateModule,
} from "./project-types.ts";
import { DIAG, DiagnosticBag } from "./project-diagnostics.ts";
import { parseScript } from "./label-parser.ts";
import {
  attachMenuAnchors,
  deriveConditionLinks,
  emptyPlotlineBook,
  parseMenusJson,
  parseOrchestrationJson,
  parseStatesJson,
  syncPlotlinesFromLabels,
  validateProject,
} from "./orchestration.ts";
import {
  LEGACY_PROJECT_FILES,
  PROJECT_FILE_NAME,
  parseProjectBundle,
} from "./project-bundle.ts";
import { STORY_DIR } from "./project-layout.ts";
import { loadLibrary, type AssetLibrary } from "./library.ts";
import { collectAssetDiagnostics } from "./asset-diagnostics.ts";

/** 文件系统适配器（路径相对项目根、"/" 分隔） */
export interface ProjectIO {
  readText(rel: string): string | null;
  exists(rel: string): boolean;
  listFiles(relDir: string): string[];
  listDirs(relDir: string): string[];
  readBytes?(rel: string): Uint8Array | null;
}

/** 剧本文件扩展名（按优先级） */
export const SCRIPT_EXTENSIONS = [".story.md", ".md", ".markdown", ".txt"] as const;

/** 非剧本的说明文件 */
const NON_SCRIPT_FILES = new Set(["readme.md", "story_format.md", "readme.txt"]);

/** 从目录文件列表中挑出剧本文件，按文件名排序 */
export function pickScriptFiles(files: string[]): string[] {
  const rank = (f: string) => {
    const lower = f.toLowerCase();
    const i = SCRIPT_EXTENSIONS.findIndex((ext) => lower.endsWith(ext));
    return i < 0 ? SCRIPT_EXTENSIONS.length : i;
  };
  return files
    .filter((f) => !NON_SCRIPT_FILES.has(f.toLowerCase()))
    .filter((f) => SCRIPT_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "zh"));
}

export interface LoadProjectOptions {
  /** 只加载指定剧本文件（默认全部） */
  files?: string[];
}

/**
 * 读取项目逻辑模型（状态 / 菜单 / 编排）。
 * 优先读合并文件 story.project.json；没有则回退旧版三个分散文件（向后兼容）。
 * 合并文件损坏且旧文件仍在时也回退，避免整个项目打不开。
 */
function readProjectModel(
  io: ProjectIO,
  bag: DiagnosticBag,
): {
  states: StateModule;
  menus: MenuBook;
  plotlines: PlotlineBook;
  orchestration: Orchestration;
} {
  const readLegacy = () => {
    const statesResult = parseStatesJson(io.readText("states.json"), "states.json");
    const menusResult = parseMenusJson(io.readText("menus.json"), "menus.json");
    const orchResult = parseOrchestrationJson(io.readText("orchestration.json"), "orchestration.json");
    bag.merge(statesResult.diagnostics);
    bag.merge(menusResult.diagnostics);
    bag.merge(orchResult.diagnostics);
    return {
      states: statesResult.module,
      menus: menusResult.book,
      // 旧布局没有情节线：按空处理
      plotlines: emptyPlotlineBook(),
      orchestration: orchResult.orchestration,
    };
  };

  const bundleText = io.readText(PROJECT_FILE_NAME);
  const hasLegacy = LEGACY_PROJECT_FILES.some((f) => io.exists(f));
  const loc = { file: PROJECT_FILE_NAME, line: 1, column: 1 };

  if (bundleText == null) {
    if (!hasLegacy) {
      bag.info(
        DIAG.PROJECT_FILE_MISSING,
        `未找到 ${PROJECT_FILE_NAME}，状态 / 菜单 / 编排按空处理`,
        loc,
      );
    }
    return readLegacy();
  }

  if (hasLegacy) {
    bag.info(
      DIAG.PROJECT_LAYOUT_CONFLICT,
      `同时存在 ${PROJECT_FILE_NAME} 与旧版分散文件，已按合并文件读取；旧文件可删除`,
      loc,
    );
  }

  const parsed = parseProjectBundle(bundleText);
  bag.merge(parsed.diagnostics);
  if (parsed.bundle) {
    return {
      states: parsed.bundle.states,
      menus: parsed.bundle.menus,
      plotlines: parsed.bundle.plotlines,
      orchestration: parsed.bundle.orchestration,
    };
  }

  bag.info(
    DIAG.PROJECT_LAYOUT_CONFLICT,
    `${PROJECT_FILE_NAME} 解析失败，已回退到旧版分散文件`,
    loc,
  );
  return readLegacy();
}

/**
 * 读取整个剧情项目。
 * 状态 / 菜单 / 编排优先读 story.project.json，缺失时回退旧版分散文件；缺失按空处理（info），不视为损坏。
 */
export function loadProject(root: string, io: ProjectIO, options: LoadProjectOptions = {}): ProjectDoc {
  const bag = new DiagnosticBag();
  // 剧本默认放在 story/ 下；没有该目录（或目录为空）的老项目回退项目根
  const storyNames = io.exists(STORY_DIR) ? pickScriptFiles(io.listFiles(STORY_DIR)) : [];
  const fromStory = storyNames.length > 0;
  const names = fromStory ? storyNames : pickScriptFiles(io.listFiles(""));
  const files =
    options.files ?? names.map((name) => (fromStory ? `${STORY_DIR}/${name}` : name));

  if (files.length === 0) {
    bag.error(
      DIAG.PROJECT_FILE_MISSING,
      fromStory
        ? `项目目录的 ${STORY_DIR}/ 下没有剧本文件（*.story.md / *.md）`
        : "项目目录下没有剧本文件（*.story.md / *.md）",
      {
        file: root,
        line: 1,
        column: 1,
      },
    );
  }

  // 状态 / 菜单 / 编排（合并文件优先，旧布局回退）
  const model = readProjectModel(io, bag);
  const states = model.states;

  // 素材：与现有素材管理共用 assets.json
  const assetsText = io.readText("assets.json");
  let library: AssetLibrary;
  if (assetsText == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, "未找到 assets.json，按空素材库处理", {
      file: "assets.json",
      line: 1,
      column: 1,
    });
    library = loadLibrary("");
  } else {
    library = loadLibrary(assetsText);
  }

  // 剧本
  const scripts = files.map((file) => {
    const source = io.readText(file) ?? "";
    return parseScript(source, { file, library, states });
  });

  // label 全局唯一
  const labels: Record<string, ScriptLabel> = {};
  for (const script of scripts) {
    bag.merge(script.diagnostics);
    for (const label of script.labels) {
      const existing = labels[label.id];
      if (existing) {
        bag.error(
          DIAG.LABEL_DUPLICATE_ID,
          `label ID "${label.id}" 在多个文件中重复（${existing.file} 与 ${label.file}），请重命名`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id },
        );
        continue;
      }
      labels[label.id] = label;
    }
  }

  // 菜单锚点：剧本里不写 @menu，锚点由 menus 段的 labelId + index 回填
  attachMenuAnchors(labels, model.menus);

  const base: ProjectDoc = {
    root,
    files,
    scripts,
    labels,
    states,
    menus: model.menus,
    // 情节线归属的唯一来源是剧本 @plot 行末尾的 `| 情节线名`
    plotlines: syncPlotlinesFromLabels(labels, model.plotlines),
    // 条件出口以 menus 为唯一真相，运行时由这里派生 fromLabel + when 连线
    orchestration: deriveConditionLinks(model.menus, model.orchestration),
    assets: library.data,
    diagnostics: [],
  };

  base.diagnostics = [
    ...bag.list,
    ...validateProject(base),
    ...collectAssetDiagnostics(base.assets, io),
  ];
  return base;
}

/** 剧本里用到的一个素材（素材管理页的「所需素材」数据源） */
export interface AssetNeed {
  kind: "sprite" | "image" | "audio";
  name: string;
  /** 已注册素材 id；剧本里未登记时为空串 */
  assetId: string;
  /** 来源指令 */
  from: "bg" | "sprite" | "bgm" | "sfx" | "item";
  labelId: string;
}

/**
 * 收集剧本用到的素材：只统计**演出指令** @bg / @sprite / @bgm / @sfx / @item。
 *
 * 说话人（对白）不再产生素材需求：
 *  - 只有真正以 @sprite 登场的角色才需要立绘；
 *  - 群像说话人（「众家老」「正道群雄」）没有立绘，也不会污染素材清单。
 * 同名同类型只出现一次；传 file 时只统计该剧本文件。
 */
export function collectAssetNeeds(doc: ProjectDoc, file?: string): AssetNeed[] {
  const out: AssetNeed[] = [];
  const seen = new Set<string>();

  const push = (need: AssetNeed) => {
    const key = `${need.kind}:${need.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(need);
  };

  // 调用方可能传项目内相对路径（story/xxx.story.md），也可能传文件列表里的裸文件名（xxx.story.md）。
  // 两种写法都指向同一个剧本文件；只做严格相等会比较不到任何 label，素材管理页就会显示「剧本中暂无人物」。
  const target = (file ?? "").replace(/\\/g, "/").replace(/^\.?\//, "");
  const matchesFile = (labelFile: string) => {
    if (!target) return true;
    const labelPath = labelFile.replace(/\\/g, "/").replace(/^\.?\//, "");
    return labelPath === target || labelPath.endsWith(`/${target}`) || target.endsWith(`/${labelPath}`);
  };

  for (const label of Object.values(doc.labels)) {
    if (!matchesFile(label.file)) continue;
    for (const step of label.steps) {
      // 对白本身不产生素材需求：立绘只由 @sprite 登记，群体说话人不占素材位
      if (
        step.type !== "bg" &&
        step.type !== "sprite" &&
        step.type !== "bgm" &&
        step.type !== "sfx" &&
        step.type !== "item"
      ) {
        continue;
      }
      const asset = doc.assets.items[step.asset];
      const kind: AssetNeed["kind"] =
        asset?.kind === "sprite" ? "sprite" : asset?.kind === "audio" ? "audio" : "image";
      push({
        kind,
        name: asset?.name ?? step.asset,
        assetId: step.asset,
        from: step.type,
        labelId: label.id,
      });
    }
  }
  return out;
}

/** 把 ProjectDoc 序列化为合并的单文件内容（编辑器保存用，见 project-bundle） */
export { serializeProjectBundle } from "./project-bundle.ts";

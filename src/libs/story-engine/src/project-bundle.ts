/**
 * 单文件项目数据（story.project.json）
 *
 * 存储策略调整：把原来的 states.json / menus.json / orchestration.json 合并成一个
 * `story.project.json`，因为它们都只服务于可视化编辑，且必须同时写回（删菜单选项要
 * 一起清理编排连线）。素材注册表 assets.json 仍然独立（与素材面板、素材文件绑定）。
 *
 * 旧布局仍可读取：project-loader 在找不到合流文件时回退到三个分散文件。
 */

import type {
  Diagnostic,
  MenuBook,
  Orchestration,
  PlotlineBook,
  ProjectDoc,
  StateModule,
} from "./project-types.ts";
import { DIAG, DiagnosticBag } from "./project-diagnostics.ts";
import { PROJECT_FILE_NAME } from "./project-layout.ts";
import {
  PROJECT_SCHEMA_VERSION,
  emptyMenuBook,
  emptyOrchestration,
  emptyPlotlineBook,
  emptyStateModule,
  parseMenusJson,
  parseOrchestrationJson,
  parsePlotlinesJson,
  parseStatesJson,
} from "./orchestration.ts";

export { PROJECT_FILE_NAME, LEGACY_PROJECT_FILES } from "./project-layout.ts";

export interface ProjectBundle {
  schemaVersion: number;
  states: StateModule;
  menus: MenuBook;
  plotlines: PlotlineBook;
  orchestration: Orchestration;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 解析 story.project.json。
 * 各段复用原有的 states / menus / orchestration 校验逻辑，保证诊断规则只有一套。
 */
export function parseProjectBundle(
  text: string,
  file = PROJECT_FILE_NAME,
): { bundle: ProjectBundle | null; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const loc = { file, line: 1, column: 1 };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 不是合法 JSON：${(e as Error).message}`, loc);
    return { bundle: null, diagnostics: bag.list };
  }
  if (!isObject(raw)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} 顶层必须是对象`, loc);
    return { bundle: null, diagnostics: bag.list };
  }

  const version = Number(raw.schemaVersion ?? PROJECT_SCHEMA_VERSION);
  if (version !== PROJECT_SCHEMA_VERSION) {
    bag.error(
      DIAG.PROJECT_VERSION_UNSUPPORTED,
      `${file} 的 schemaVersion=${version} 不受支持（当前 ${PROJECT_SCHEMA_VERSION}）`,
      loc,
    );
    return { bundle: null, diagnostics: bag.list };
  }

  const missing = (section: string) =>
    bag.info(DIAG.PROJECT_FILE_MISSING, `${file} 缺少 ${section} 段，按空处理`, loc);

  let states = emptyStateModule();
  if (isObject(raw.states)) {
    const r = parseStatesJson(JSON.stringify(raw.states), file);
    bag.merge(r.diagnostics);
    states = r.module;
  } else {
    missing("states");
  }

  let menus = emptyMenuBook();
  if (isObject(raw.menus)) {
    const r = parseMenusJson(JSON.stringify(raw.menus), file);
    bag.merge(r.diagnostics);
    menus = r.book;
  } else {
    missing("menus");
  }

  let orchestration = emptyOrchestration();
  if (isObject(raw.orchestration)) {
    const r = parseOrchestrationJson(JSON.stringify(raw.orchestration), file);
    bag.merge(r.diagnostics);
    orchestration = r.orchestration;
  } else {
    missing("orchestration");
  }

  // plotlines 是可选段（编辑器元数据）：缺失按空处理，不打 info，避免老项目刷提示
  let plotlines = emptyPlotlineBook();
  if (isObject(raw.plotlines)) {
    const r = parsePlotlinesJson(JSON.stringify(raw.plotlines), file);
    bag.merge(r.diagnostics);
    plotlines = r.book;
  }

  return {
    bundle: { schemaVersion: version, states, menus, plotlines, orchestration },
    diagnostics: bag.list,
  };
}

/** 序列化为 story.project.json 文本 */
export function serializeProjectBundle(
  doc: Pick<ProjectDoc, "states" | "menus" | "plotlines" | "orchestration">,
): string {
  const bundle: ProjectBundle = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    states: doc.states,
    menus: doc.menus,
    plotlines: doc.plotlines ?? emptyPlotlineBook(),
    orchestration: {
      ...doc.orchestration,
      // 条件出口由 menus 派生，属于内存视图；落盘只保留手写连线
      links: doc.orchestration.links.filter((l) => !l.derivedFromMenu),
    },
  };
  return JSON.stringify(bundle, null, 2);
}

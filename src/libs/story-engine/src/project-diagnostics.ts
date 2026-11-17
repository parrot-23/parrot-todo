/**
 * 项目级诊断：解析、菜单、编排、运行时共用
 *
 * 约定：
 *  - 诊断定位到「文件 + 行号 + 列号」，编辑器可一键跳到源码。
 *  - 可恢复错误不中断解析，保证作者始终能看到已解析内容。
 *  - code 稳定，UI 可按 code 分类与提供修复入口。
 */

import type { Diagnostic, DiagnosticSeverity, DiagnosticSource } from "./project-types.ts";

/**
 * code 前缀 → 来源域。
 * 由引擎统一归一，调用方不用记前缀规则（例如判断“哪些诊断可以本地重算”）。
 */
export function diagnosticSource(code: string): DiagnosticSource {
  const prefix = code.slice(0, code.indexOf("/"));
  switch (prefix) {
    case "label":
    case "step":
    case "file":
      return "script";
    case "state":
      return "state";
    case "menu":
      return "menu";
    case "orchestration":
      return "orchestration";
    case "plotline":
      return "plotline";
    case "asset":
      return "asset";
    case "runtime":
      return "runtime";
    default:
      return "project";
  }
}

/** 改菜单 / 编排 / 情节线后需要就地重算的诊断域 */
export function isLocalDiagnostic(code: string): boolean {
  const source = diagnosticSource(code);
  return source === "menu" || source === "orchestration" || source === "plotline";
}

export const DIAG = {
  /* 剧本 / 片段 */
  LABEL_UNOWNED_CONTENT: "label/unowned-content",
  LABEL_DUPLICATE_ID: "label/duplicate-id",
  LABEL_EMPTY: "label/empty",
  LABEL_MISSING_NAME: "label/missing-name",
  LABEL_PLOTLINE_EMPTY: "label/plotline-empty",
  LABEL_POSITION_EMPTY: "label/position-empty",
  LABEL_LEGACY_ANCHOR: "label/legacy-anchor",
  LABEL_MENU_ANCHOR_INVALID: "label/menu-anchor-invalid",
  STEP_DIRECTIVE_ERROR: "step/directive-error",
  STEP_UNRECOGNIZED: "step/unrecognized",
  /* 已移除的旧语法：不再兼容，一律报错并给出新写法 */
  STEP_DIRECTIVE_LEGACY: "step/directive-legacy",
  STEP_DIALOG_LEGACY: "step/dialog-legacy",
  /* 文本通道（@actor / @narr） */
  STEP_CHANNEL_UNKNOWN: "step/channel-unknown",
  STEP_CHANNEL_MISSING: "step/channel-missing",
  STEP_CHANNEL_MISPLACED: "step/channel-misplaced",
  STEP_ACTOR_MISSING: "step/actor-missing",
  FILE_EMPTY: "file/empty",

  /* 状态 */
  STATE_UNDECLARED: "state/undeclared",
  STATE_TYPE_MISMATCH: "state/type-mismatch",
  STATE_DUPLICATE_ID: "state/duplicate-id",
  STATE_INVALID_DEFINITION: "state/invalid-definition",

  /* 菜单 */
  MENU_EMPTY: "menu/empty",
  MENU_DUPLICATE_RESULT: "menu/duplicate-result",
  MENU_LABEL_MISSING: "menu/label-missing",
  MENU_UNDEFINED: "menu/undefined",
  MENU_UNUSED: "menu/unused",
  MENU_EXIT_CONFLICT: "menu/exit-conflict",
  MENU_CONDITION_TARGET_MISSING: "menu/condition-target-missing",
  MENU_CONDITION_DUPLICATE: "menu/condition-duplicate",
  MENU_CONDITION_INVALID: "menu/condition-invalid",
  MENU_CONDITION_UNDECLARED_STATE: "menu/condition-undeclared-state",
  MENU_CONDITION_REDUNDANT: "menu/condition-redundant",

  /* 编排 */
  ORCH_ENTRY_MISSING: "orchestration/entry-missing",
  ORCH_TARGET_MISSING: "orchestration/target-missing",
  ORCH_RESULT_UNKNOWN: "orchestration/result-unknown",
  ORCH_RESULT_UNCONNECTED: "orchestration/result-unconnected",
  ORCH_MENU_POSITION: "orchestration/menu-position",
  ORCH_LABEL_NO_EXIT: "orchestration/label-no-exit",
  ORCH_BRANCH_GATED_DEAD_END: "orchestration/branch-gated-dead-end",
  ORCH_DUPLICATE_LINK: "orchestration/duplicate-link",
  ORCH_UNREACHABLE: "orchestration/unreachable-label",
  ORCH_CYCLE: "orchestration/cycle-detected",
  ORCH_NO_END: "orchestration/no-end",

  /* 素材 */
  ASSET_UNBOUND: "asset/unbound",
  ASSET_PATH_INVALID: "asset/path-invalid",
  ASSET_DUPLICATE_FILE: "asset/duplicate-file",

  /* 项目文件 */
  PROJECT_FILE_MISSING: "project/file-missing",
  PROJECT_JSON_INVALID: "project/json-invalid",
  PROJECT_VERSION_UNSUPPORTED: "project/version-unsupported",
  PROJECT_LAYOUT_CONFLICT: "project/layout-conflict",
  PROJECT_PLOTLINE_INVALID: "project/plotline-invalid",

  /* 情节线归属 */
  PLOTLINE_LABEL_MISSING: "plotline/label-missing",
  PLOTLINE_DUPLICATE_ASSIGN: "plotline/duplicate-assignment",
  PLOTLINE_UNASSIGNED: "plotline/unassigned",

  /* 运行时 */
  RUNTIME_STATE_ERROR: "runtime/state-error",
  RUNTIME_RESULT_INVALID: "runtime/result-invalid",
  RUNTIME_NO_LINK: "runtime/no-link",
  RUNTIME_NO_EXIT: "runtime/no-exit",
  RUNTIME_LOOP_PROTECTION: "runtime/loop-protection",
} as const;

export type DiagnosticCode = (typeof DIAG)[keyof typeof DIAG];

export interface DiagLocation {
  file?: string;
  line?: number;
  column?: number;
}

/** 诊断收集器 */
export class DiagnosticBag {
  readonly list: Diagnostic[] = [];

  add(
    code: string,
    severity: DiagnosticSeverity,
    message: string,
    loc?: DiagLocation,
    data?: Record<string, unknown>,
  ): Diagnostic {
    const d: Diagnostic = { code, severity, message, source: diagnosticSource(code) };
    if (loc?.file) d.file = loc.file;
    if (loc?.line != null) d.line = loc.line;
    if (loc?.column != null) d.column = loc.column;
    if (data) d.data = data;
    this.list.push(d);
    return d;
  }

  error(code: string, message: string, loc?: DiagLocation, data?: Record<string, unknown>) {
    return this.add(code, "error", message, loc, data);
  }

  warn(code: string, message: string, loc?: DiagLocation, data?: Record<string, unknown>) {
    return this.add(code, "warning", message, loc, data);
  }

  info(code: string, message: string, loc?: DiagLocation, data?: Record<string, unknown>) {
    return this.add(code, "info", message, loc, data);
  }

  merge(items: Diagnostic[]) {
    for (const d of items) {
      if (!d.source) d.source = diagnosticSource(d.code);
      this.list.push(d);
    }
  }

  get hasErrors(): boolean {
    return this.list.some((d) => d.severity === "error");
  }

  errorsOf(code: string): Diagnostic[] {
    return this.list.filter((d) => d.code === code);
  }
}

/** 便于 UI 显示："story/01-码头.story.md:12" */
export function formatLocation(d: Diagnostic): string {
  if (!d.file) return "";
  return d.line != null ? `${d.file}:${d.line}` : d.file;
}

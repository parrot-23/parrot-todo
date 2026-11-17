// src/project-diagnostics.ts
function diagnosticSource(code) {
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
function isLocalDiagnostic(code) {
  const source = diagnosticSource(code);
  return source === "menu" || source === "orchestration" || source === "plotline";
}
var DIAG = {
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
  RUNTIME_LOOP_PROTECTION: "runtime/loop-protection"
};
var DiagnosticBag = class {
  list = [];
  add(code, severity, message, loc, data) {
    const d = { code, severity, message, source: diagnosticSource(code) };
    if (loc?.file) d.file = loc.file;
    if (loc?.line != null) d.line = loc.line;
    if (loc?.column != null) d.column = loc.column;
    if (data) d.data = data;
    this.list.push(d);
    return d;
  }
  error(code, message, loc, data) {
    return this.add(code, "error", message, loc, data);
  }
  warn(code, message, loc, data) {
    return this.add(code, "warning", message, loc, data);
  }
  info(code, message, loc, data) {
    return this.add(code, "info", message, loc, data);
  }
  merge(items) {
    for (const d of items) {
      if (!d.source) d.source = diagnosticSource(d.code);
      this.list.push(d);
    }
  }
  get hasErrors() {
    return this.list.some((d) => d.severity === "error");
  }
  errorsOf(code) {
    return this.list.filter((d) => d.code === code);
  }
};

// src/channels.ts
var ACTOR_CHANNELS = ["say", "inner", "act", "sprite"];
var NARR_CHANNELS = ["bg", "vo", "bgm", "sfx", "fx", "item"];
var CHANNEL_LABEL = {
  say: "\u53F0\u8BCD",
  inner: "\u5FC3\u58F0",
  act: "\u52A8\u4F5C",
  sprite: "\u7ACB\u7ED8",
  bg: "\u80CC\u666F",
  vo: "\u65C1\u767D",
  bgm: "\u97F3\u4E50",
  sfx: "\u97F3\u6548",
  fx: "\u7279\u6548",
  item: "\u7269\u54C1"
};
function isActorChannel(value) {
  return ACTOR_CHANNELS.includes(value);
}
function isNarrChannel(value) {
  return NARR_CHANNELS.includes(value);
}
function stepChannel(step) {
  return "channel" in step ? step.channel : null;
}
function stepTitle(step) {
  const channel = stepChannel(step);
  if (step.type === "dialog") {
    return channel === "inner" ? `${step.speaker}\uFF08\u5FC3\u58F0\uFF09` : step.speaker;
  }
  if (step.type === "narration") {
    if (channel === "act") return step.speaker ?? "\u65C1\u767D";
    return "\u65C1\u767D";
  }
  return null;
}

// src/library.ts
function createLibrary() {
  return {
    data: { nextId: 1, items: {} },
    nameIndex: /* @__PURE__ */ new Map()
  };
}
function loadLibrary(json) {
  const lib = createLibrary();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      lib.data.nextId = Number.isFinite(parsed.nextId) ? parsed.nextId : 1;
      if (parsed.items && typeof parsed.items === "object") {
        for (const [id, item] of Object.entries(parsed.items)) {
          const a = item;
          if (a && typeof a === "object" && a.name != null && a.kind != null) {
            lib.data.items[id] = { id, kind: a.kind, name: String(a.name), path: String(a.path ?? "") };
          }
        }
      }
    }
  } catch {
  }
  rebuildIndex(lib);
  return lib;
}
function serializeLibrary(lib) {
  return JSON.stringify(lib.data, null, 2);
}
function rebuildIndex(lib) {
  lib.nameIndex.clear();
  for (const [id, item] of Object.entries(lib.data.items)) {
    lib.nameIndex.set(keyOf(item.kind, item.name), id);
  }
}
function keyOf(kind, name) {
  return `${kind}:${name}`;
}
function nextId(lib) {
  const id = `res_${String(lib.data.nextId).padStart(4, "0")}`;
  lib.data.nextId += 1;
  return id;
}
function resolveAsset(lib, name, kind) {
  const k = keyOf(kind, name);
  const existing = lib.nameIndex.get(k);
  if (existing) return existing;
  const id = nextId(lib);
  const asset = { id, kind, name, path: placeholderPath(kind, name) };
  lib.data.items[id] = asset;
  lib.nameIndex.set(k, id);
  return id;
}
function placeholderPath(kind, name) {
  const dir = kind === "sprite" ? "sprite" : kind === "audio" ? "audio" : "image";
  return `assets/${dir}/${name}`;
}
function renameAsset(lib, id, newName) {
  const item = lib.data.items[id];
  if (!item) return false;
  const oldKey = keyOf(item.kind, item.name);
  if (lib.nameIndex.get(oldKey) === id) lib.nameIndex.delete(oldKey);
  item.name = newName;
  lib.nameIndex.set(keyOf(item.kind, newName), id);
  return true;
}
function bindAssetPath(lib, id, path) {
  const item = lib.data.items[id];
  if (!item) return false;
  item.path = path;
  return true;
}
function assetDisplayName(lib, id) {
  return lib.data.items[id]?.name ?? id;
}

// src/label-parser.ts
function slugify(text) {
  return text.replace(/[^\w\u4e00-\u9fa5-]/g, "").replace(/\s+/g, "_").slice(0, 24);
}
function makeLabelId(name, used) {
  const base = `lb_${slugify(name) || "label"}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function makeMenuId(name, used) {
  const base = `m_${slugify(name) || "menu"}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function makeResultId(text, used) {
  const base = slugify(text).toLowerCase() || "result";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function makeStateId(used) {
  let n = 1;
  while (used.has(`state_${n}`)) n++;
  return `state_${n}`;
}
function parseFade(params) {
  const m = params.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 2;
}
var QUOTE_PAIRS = {
  '"': '"',
  "'": "'",
  "\u201C": "\u201D",
  "\u2018": "\u2019",
  "\u300C": "\u300D",
  "\u300E": "\u300F"
};
function splitActorHead(rest) {
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
function splitChannel(rest) {
  const m = rest.match(/^#\s*([A-Za-z][\w-]*)\s*([\s\S]*)$/);
  if (!m) return null;
  return { channel: m[1].toLowerCase(), body: m[2].trim() };
}
function parseLiteral(raw) {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const quoted = v.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  return v;
}
function matchesType(type, value) {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string";
}
var LABEL_MARK = /(?:^|\s)[#$]/;
var LABEL_POSITIONS = ["\u8D77\u70B9", "\u94FA\u57AB", "\u9AD8\u6F6E", "\u8F6C\u6298", "\u7ED3\u5C40"];
function splitLabelLine(rest, bag, loc) {
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
  let m;
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
      "@plot \u7684\u60C5\u8282\u7EBF\u6807\u8BB0 `#` \u540E\u9762\u6CA1\u6709\u5199\u540D\u79F0\uFF0C\u8BE5\u7247\u6BB5\u6309\u4E3B\u7EBF\u5904\u7406",
      loc
    );
  }
  if (sawPosition && !position) {
    bag.warn(
      DIAG.LABEL_POSITION_EMPTY,
      "@plot \u7684\u4F4D\u7F6E\u6807\u8BB0 `$` \u540E\u9762\u6CA1\u6709\u5199\u540D\u79F0\uFF0C\u8BE5\u7247\u6BB5\u4E0D\u6807\u4F4D\u7F6E",
      loc
    );
  }
  return { name, plotline, position };
}
function parseActorDirective(args, ctx) {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const head = splitActorHead(args);
  if (!head || !head.name || head.name.startsWith("#")) {
    ctx.bag.error(
      DIAG.STEP_ACTOR_MISSING,
      `@actor \u7F3A\u5C11\u89D2\u8272\u540D\uFF1A\u5E94\u4E3A "@actor <\u89D2\u8272\u540D> #say <\u53F0\u8BCD>"\uFF08\u540D\u5B57\u542B\u7A7A\u683C\u65F6\u7528\u5F15\u53F7\u5305\u88F9\uFF09`,
      loc
    );
    return null;
  }
  const parsed = splitChannel(head.rest);
  if (!parsed) {
    ctx.bag.error(
      DIAG.STEP_CHANNEL_MISSING,
      `@actor \u7F3A\u5C11\u901A\u9053\u6807\u8BB0\uFF1A\u5E94\u5199\u6210 @actor ${head.name} #${ACTOR_CHANNELS.join(" / #")} <\u5185\u5BB9>`,
      loc
    );
    return null;
  }
  const { channel, body } = parsed;
  if (!isActorChannel(channel)) {
    if (isNarrChannel(channel)) {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_MISPLACED,
        `@actor \u4E0D\u652F\u6301\u65C1\u767D\u901A\u9053 "#${channel}"\uFF0C\u65C1\u767D\u8BF7\u5199\u6210 @narr #${channel} \u2026`,
        loc
      );
    } else {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_UNKNOWN,
        `\u672A\u77E5\u901A\u9053 "#${channel}"\uFF1A@actor \u652F\u6301 #${ACTOR_CHANNELS.join(" / #")}`,
        loc
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
          `@actor #${channel} \u7F3A\u5C11${channel === "inner" ? "\u5FC3\u58F0" : "\u53F0\u8BCD"}\u5185\u5BB9`,
          loc
        );
        return null;
      }
      return { type: "dialog", channel, speaker: head.name, text: body };
    case "act":
      if (!body) {
        ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, "@actor #act \u7F3A\u5C11\u52A8\u4F5C\u63CF\u8FF0", loc);
        return null;
      }
      return { type: "narration", channel: "act", speaker: head.name, text: body };
    default: {
      if (/\s/.test(body)) {
        ctx.bag.error(
          DIAG.STEP_DIRECTIVE_ERROR,
          `@actor #sprite \u53EA\u63A5\u53D7\u300C\u8868\u60C5/\u4F4D\u7F6E\u300D\uFF0C\u4E0D\u80FD\u542B\u7A7A\u683C\uFF1A${body}`,
          loc
        );
        return null;
      }
      const [pose, position] = body.split("/");
      return {
        type: "sprite",
        channel: "sprite",
        asset: resolveAsset(ctx.library, head.name, "sprite"),
        ...pose ? { pose } : {},
        ...position ? { position } : {},
        enter: true
      };
    }
  }
}
function parseNarrDirective(args, ctx) {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const parsed = splitChannel(args);
  if (!parsed) {
    ctx.bag.error(
      DIAG.STEP_CHANNEL_MISSING,
      `@narr \u5FC5\u987B\u5E26\u901A\u9053\u6807\u8BB0\uFF1A#${NARR_CHANNELS.join(" / #")}`,
      loc
    );
    return null;
  }
  const { channel, body } = parsed;
  if (!isNarrChannel(channel)) {
    if (isActorChannel(channel)) {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_MISPLACED,
        `@narr \u4E0D\u652F\u6301\u89D2\u8272\u901A\u9053 "#${channel}"\uFF0C\u89D2\u8272\u5185\u5BB9\u8BF7\u5199\u6210 @actor <\u89D2\u8272\u540D> #${channel} \u2026`,
        loc
      );
    } else {
      ctx.bag.error(
        DIAG.STEP_CHANNEL_UNKNOWN,
        `\u672A\u77E5\u901A\u9053 "#${channel}"\uFF1A@narr \u652F\u6301 #${NARR_CHANNELS.join(" / #")}`,
        loc
      );
    }
    return null;
  }
  if (!body) {
    ctx.bag.error(
      DIAG.STEP_DIRECTIVE_ERROR,
      `@narr #${channel} \u7F3A\u5C11${CHANNEL_LABEL[channel]}\u5185\u5BB9`,
      loc
    );
    return null;
  }
  switch (channel) {
    case "vo":
      return { type: "narration", channel: "vo", text: body };
    case "fx":
      return { type: "effect", channel: "fx", effect: body };
    default:
      return parseAssetDirective(channel, body, ctx);
  }
}
function parseAssetDirective(channel, args, ctx) {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const rm = args.match(/^(.+?)(?:\(([^)]*)\))?$/);
  if (!rm || !rm[1].trim()) {
    ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `@narr #${channel} \u7F3A\u5C11\u8D44\u6E90\u540D`, loc);
    return null;
  }
  const assetName = rm[1].trim();
  const params = rm[2];
  const assetId = resolveAsset(
    ctx.library,
    assetName,
    channel === "bg" || channel === "item" ? "image" : "audio"
  );
  if (channel === "item") {
    return { type: "item", channel: "item", asset: assetId };
  }
  if (channel === "bgm") {
    return { type: "bgm", channel: "bgm", asset: assetId, ...params ? { fade: parseFade(params) } : {} };
  }
  if (channel === "sfx") {
    return { type: "sfx", channel: "sfx", asset: assetId };
  }
  return {
    type: "bg",
    channel: "bg",
    asset: assetId,
    ...params ? { transition: `fade_in_${parseFade(params)}s` } : {}
  };
}
var LEGACY_HINTS = {
  vo: "@narr #vo <\u6587\u672C>",
  bg: "@narr #bg <\u80CC\u666F\u540D>",
  bgm: "@narr #bgm <\u97F3\u4E50\u540D>",
  sfx: "@narr #sfx <\u97F3\u6548\u540D>",
  effect: "@narr #fx <\u7279\u6548\u540D>",
  sprite: "@actor <\u89D2\u8272\u540D> #sprite <\u8868\u60C5/\u4F4D\u7F6E>"
};
function legacyHint(name) {
  return LEGACY_HINTS[name] ?? "";
}
function parseStepDirective(body, ctx) {
  const loc = { file: ctx.file, line: ctx.line, column: ctx.column };
  const m = body.match(/^@(\w+)(?:\s+(.*))?$/);
  if (!m) {
    ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `\u65E0\u6CD5\u89E3\u6790\u6307\u4EE4\uFF08\u5E94\u4E3A "@name \u53C2\u6570"\uFF09\uFF1A${body}`, loc);
    return null;
  }
  const name = m[1];
  const args = (m[2] ?? "").trim();
  switch (name) {
    case "actor":
      return parseActorDirective(args, ctx);
    case "narr":
      return parseNarrDirective(args, ctx);
    case "vo":
    case "bg":
    case "bgm":
    case "sfx":
    case "sprite":
    case "effect":
    case "task":
      ctx.bag.error(
        DIAG.STEP_DIRECTIVE_LEGACY,
        legacyHint(name) ? `@${name} \u5DF2\u79FB\u9664\uFF0C\u8BF7\u6539\u7528 ${legacyHint(name)}` : `@${name} \u5DF2\u79FB\u9664\uFF1A\u5267\u672C\u91CC\u4E0D\u518D\u652F\u6301\u4EFB\u52A1\u6307\u4EE4`,
        loc
      );
      return null;
    case "flag": {
      const fm = args.match(/^([\w\u4e00-\u9fa5-]+)\s*(\+=|-=|=)\s*(.+)$/);
      if (!fm) {
        ctx.bag.error(DIAG.STEP_DIRECTIVE_ERROR, `@flag \u683C\u5F0F\u5E94\u4E3A \u952E=\u503C / \u952E+=\u6570\u503C / \u952E-=\u6570\u503C\uFF1A${body}`, loc);
        return null;
      }
      const [, key, opRaw, rawValue] = fm;
      const value = parseLiteral(rawValue);
      const def = ctx.stateById.get(key);
      if (ctx.stateById.size > 0) {
        if (!def) {
          ctx.bag.error(
            DIAG.STATE_UNDECLARED,
            `\u72B6\u6001 "${key}" \u672A\u5728\u72B6\u6001\u503C\u4E2D\u5B9A\u4E49\uFF0C\u8BF7\u5148\u5728\u300C\u72B6\u6001\u503C\u300D\u9875\u521B\u5EFA`,
            loc,
            { stateId: key }
          );
          return null;
        }
        if (!matchesType(def.type, value)) {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `\u72B6\u6001 "${def.name}" \u662F ${def.type} \u7C7B\u578B\uFF0C\u4E0D\u80FD\u8D4B\u503C\u4E3A ${JSON.stringify(value)}`,
            loc,
            { stateId: key }
          );
          return null;
        }
        if (def.type === "enum" && !(def.options ?? []).includes(String(value))) {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `\u72B6\u6001 "${def.name}" \u662F\u4E0B\u62C9\u5217\u8868\u7C7B\u578B\uFF0C${JSON.stringify(value)} \u4E0D\u5728\u53EF\u9009\u9879\u91CC`,
            loc,
            { stateId: key }
          );
          return null;
        }
        if (opRaw !== "=" && def.type !== "number") {
          ctx.bag.error(
            DIAG.STATE_TYPE_MISMATCH,
            `\u72B6\u6001 "${def.name}" \u4E0D\u662F\u6570\u503C\u7C7B\u578B\uFF0C\u4E0D\u80FD\u7528 += / -=`,
            loc,
            { stateId: key }
          );
          return null;
        }
      }
      if (opRaw === "+=") return { type: "flag", key, value, op: "add" };
      if (opRaw === "-=") return { type: "flag", key, value, op: "sub" };
      return { type: "flag", key, value };
    }
    default:
      ctx.bag.warn(DIAG.STEP_UNRECOGNIZED, `\u672A\u77E5\u6307\u4EE4 "@${name}"\uFF08\u5DF2\u5FFD\u7565\uFF09`, loc);
      return null;
  }
}
function parseScript(source, options) {
  const bag = new DiagnosticBag();
  const file = options.file;
  const library = options.library ?? createLibrary();
  const states = options.states?.states ?? [];
  const stateById = new Map(states.map((s) => [s.id, s]));
  const labels = [];
  const byId = /* @__PURE__ */ new Map();
  let current = null;
  const unowned = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    const lineNo = i + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;
    const loc = { file, line: lineNo, column };
    const labelMatch = line.match(/^@plot\s+(\S+)(?:\s+(.+))?$/);
    if (labelMatch) {
      const [, id, rawRest] = labelMatch;
      const { name, plotline, position } = splitLabelLine(rawRest ?? "", bag, loc);
      if (!name) {
        bag.warn(DIAG.LABEL_MISSING_NAME, `label "${id}" \u7F3A\u5C11\u663E\u793A\u540D\u79F0\uFF0C\u6682\u7528 ID \u4EE3\u66FF`, loc, { labelId: id });
      }
      if (byId.has(id)) {
        bag.error(DIAG.LABEL_DUPLICATE_ID, `label ID "${id}" \u5728\u672C\u6587\u4EF6\u4E2D\u91CD\u590D`, loc, { labelId: id });
        current = byId.get(id);
        continue;
      }
      const label = {
        id,
        name: name || id,
        ...plotline ? { plotline } : {},
        ...position ? { position } : {},
        file,
        line: lineNo,
        endLine: lines.length,
        steps: [],
        menus: []
      };
      labels.push(label);
      byId.set(id, label);
      if (current) current.endLine = lineNo - 1;
      current = label;
      continue;
    }
    if (/^@(label|node)\b/.test(line)) {
      const legacyName = line.slice(1).split(/\s+/)[0];
      bag.error(
        DIAG.LABEL_LEGACY_ANCHOR,
        `@${legacyName} \u5DF2\u79FB\u9664\uFF0C\u8BF7\u6539\u7528 @plot <id> <\u663E\u793A\u540D\u79F0>`,
        loc
      );
      continue;
    }
    if (/^@menu\b/.test(line)) {
      bag.error(
        DIAG.STEP_DIRECTIVE_ERROR,
        "@menu \u5DF2\u5E9F\u5F03\uFF1A\u83DC\u5355\u4E0D\u5199\u5728\u5267\u672C\u91CC\uFF0C\u8BF7\u5728\u300C\u5267\u60C5\u7F16\u6392\u300D\u4E2D\u9009\u4E2D\u7247\u6BB5\u540E\u6DFB\u52A0\u83DC\u5355",
        loc
      );
      continue;
    }
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
    if (line.startsWith("#")) continue;
    const dialog = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (dialog) {
      const who = dialog[1].trim();
      const inner = /[（(]\s*心声\s*[)）]$/.test(who);
      const speaker = who.replace(/\s*[（(]\s*心声\s*[)）]$/, "");
      bag.error(
        DIAG.STEP_DIALOG_LEGACY,
        `\u96F6\u7B26\u53F7\u5BF9\u767D\u5DF2\u79FB\u9664\uFF0C\u8BF7\u6539\u7528 @actor ${speaker} #${inner ? "inner" : "say"} ${dialog[2].trim()}`,
        { file, line: lineNo, column: 1 }
      );
      continue;
    }
    if (!current) {
      unowned.push(lineNo);
      continue;
    }
    bag.warn(DIAG.STEP_UNRECOGNIZED, `\u65E0\u6CD5\u8BC6\u522B\u7684\u884C\uFF08\u5DF2\u5FFD\u7565\uFF09\uFF1A${line.slice(0, 40)}`, loc);
  }
  if (labels.length === 0) {
    bag.warn(
      DIAG.FILE_EMPTY,
      `${file} \u4E2D\u6CA1\u6709 @plot \u7247\u6BB5\uFF1B\u8BE5\u6587\u4EF6\u5185\u5BB9\u4E0D\u4F1A\u8FDB\u5165\u7F16\u6392`,
      { file, line: 1, column: 1 }
    );
  }
  if (unowned.length > 0) {
    bag.warn(
      DIAG.LABEL_UNOWNED_CONTENT,
      `\u6587\u4EF6\u5F00\u5934\u6709 ${unowned.length} \u884C\u5185\u5BB9\u4E0D\u5C5E\u4E8E\u4EFB\u4F55 @plot\uFF08\u884C ${unowned.slice(0, 5).join(", ")}${unowned.length > 5 ? " \u2026" : ""}\uFF09\uFF0C\u8BF7\u5728\u300C\u5267\u60C5\u7F16\u6392\u300D\u4E2D\u6307\u5B9A\u5F52\u5C5E\u6216\u8865\u5145 @plot`,
      { file, line: unowned[0], column: 1 },
      { lines: unowned }
    );
  }
  for (const label of labels) {
    if (label.steps.length === 0 && label.menus.length === 0) {
      bag.warn(
        DIAG.LABEL_EMPTY,
        `\u7247\u6BB5\u300C${label.name}\u300D\u6CA1\u6709\u4EFB\u4F55\u5185\u5BB9\u6216\u83DC\u5355`,
        { file, line: label.line, column: 1 },
        { labelId: label.id }
      );
    }
  }
  return { file, labels, diagnostics: bag.list };
}

// src/project-layout.ts
var PROJECT_FILE_NAME = "story.project.json";
var STORY_DIR = "story";
var LEGACY_PROJECT_FILES = ["states.json", "menus.json", "orchestration.json"];

// src/orchestration.ts
var PROJECT_SCHEMA_VERSION = 1;
var MAIN_PLOTLINE_NAME = "\u4E3B\u7EBF";
function emptyStateModule() {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, states: [] };
}
function emptyMenuBook() {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, menus: {} };
}
function emptyPlotlineBook() {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, plotlines: [] };
}
function emptyOrchestration() {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, entry: "", links: [] };
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function readJsonObject(text, file, bag) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${e.message}`, {
      file,
      line: 1,
      column: 1
    });
    return null;
  }
  if (!isObject(raw)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u9876\u5C42\u5FC5\u987B\u662F\u5BF9\u8C61`, { file, line: 1, column: 1 });
    return null;
  }
  const version = Number(raw.schemaVersion ?? PROJECT_SCHEMA_VERSION);
  if (version !== PROJECT_SCHEMA_VERSION) {
    bag.error(
      DIAG.PROJECT_VERSION_UNSUPPORTED,
      `${file} \u7684 schemaVersion=${version} \u4E0D\u53D7\u652F\u6301\uFF08\u5F53\u524D ${PROJECT_SCHEMA_VERSION}\uFF09`,
      { file, line: 1, column: 1 }
    );
    return null;
  }
  return raw;
}
function matchesType2(type, value) {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string";
}
function parseStatesJson(text, file = "states.json") {
  const bag = new DiagnosticBag();
  const mod = emptyStateModule();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `\u672A\u627E\u5230 ${file}\uFF0C\u6309\u7A7A\u72B6\u6001\u5B9A\u4E49\u5904\u7406`, { file, line: 1, column: 1 });
    return { module: mod, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { module: mod, diagnostics: bag.list };
  if (!Array.isArray(raw.states)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u7F3A\u5C11 states \u6570\u7EC4`, { file, line: 1, column: 1 });
    return { module: mod, diagnostics: bag.list };
  }
  const seen = /* @__PURE__ */ new Set();
  raw.states.forEach((item, index) => {
    const loc = { file, line: index + 1, column: 1 };
    if (!isObject(item)) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `states[${index}] \u4E0D\u662F\u5BF9\u8C61`, loc);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `states[${index}] \u7F3A\u5C11\u7A33\u5B9A ID`, loc);
      return;
    }
    if (seen.has(id)) {
      bag.error(DIAG.STATE_DUPLICATE_ID, `\u72B6\u6001 ID "${id}" \u91CD\u590D`, loc);
      return;
    }
    seen.add(id);
    const type = item.type;
    if (type !== "boolean" && type !== "number" && type !== "string" && type !== "enum") {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `\u72B6\u6001 "${id}" \u7684\u7C7B\u578B\u975E\u6CD5`, loc);
      return;
    }
    if (!("initial" in item) || !matchesType2(type, item.initial)) {
      bag.error(DIAG.STATE_INVALID_DEFINITION, `\u72B6\u6001 "${id}" \u7684\u521D\u59CB\u503C\u4E0E\u7C7B\u578B\u4E0D\u5339\u914D`, loc);
      return;
    }
    const def = {
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name : id,
      type,
      initial: item.initial
    };
    if (typeof item.icon === "string") def.icon = item.icon;
    if (typeof item.description === "string") def.description = item.description;
    if (type === "number") {
      if (typeof item.min === "number") def.min = item.min;
      if (typeof item.max === "number") def.max = item.max;
    }
    if (type === "string" && Array.isArray(item.values)) {
      def.values = item.values.filter((v) => typeof v === "string");
    }
    if (type === "enum") {
      const options = Array.isArray(item.options) ? [...new Set(item.options.filter((v) => typeof v === "string").map((v) => v.trim()))] : [];
      const cleaned = options.filter(Boolean);
      if (cleaned.length === 0) {
        bag.error(
          DIAG.STATE_INVALID_DEFINITION,
          `\u4E0B\u62C9\u5217\u8868\u72B6\u6001 "${id}" \u7F3A\u5C11 options\uFF08\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u53EF\u9009\u9879\uFF09`,
          loc
        );
        return;
      }
      def.options = cleaned;
      if (!cleaned.includes(String(item.initial))) {
        bag.error(
          DIAG.STATE_INVALID_DEFINITION,
          `\u4E0B\u62C9\u5217\u8868\u72B6\u6001 "${id}" \u7684\u521D\u59CB\u503C ${JSON.stringify(item.initial)} \u4E0D\u5728\u53EF\u9009\u9879\u91CC`,
          loc
        );
        return;
      }
    }
    mod.states.push(def);
  });
  return { module: mod, diagnostics: bag.list };
}
function parseMenusJson(text, file = "menus.json") {
  const bag = new DiagnosticBag();
  const book = emptyMenuBook();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `\u672A\u627E\u5230 ${file}\uFF0C\u6309\u7A7A\u83DC\u5355\u5904\u7406`, { file, line: 1, column: 1 });
    return { book, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { book, diagnostics: bag.list };
  if (!isObject(raw.menus)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u7F3A\u5C11 menus \u5BF9\u8C61`, { file, line: 1, column: 1 });
    return { book, diagnostics: bag.list };
  }
  for (const [id, value] of Object.entries(raw.menus)) {
    const loc = { file, line: 1, column: 1 };
    if (!isObject(value)) {
      bag.error(DIAG.PROJECT_JSON_INVALID, `\u83DC\u5355 "${id}" \u4E0D\u662F\u5BF9\u8C61`, loc);
      continue;
    }
    if (value.type !== "choice" && value.type !== "condition") continue;
    const type = value.type === "condition" ? "condition" : "choice";
    const labelId = typeof value.labelId === "string" ? value.labelId : "";
    if (!labelId) {
      bag.error(DIAG.MENU_LABEL_MISSING, `\u83DC\u5355 "${id}" \u7F3A\u5C11\u6240\u5C5E\u7247\u6BB5 labelId`, loc, { menuId: id });
    }
    const menu = {
      id,
      labelId,
      type,
      jump: type === "condition" ? "out" : value.jump === "back" ? "back" : "out",
      title: typeof value.title === "string" && value.title ? value.title : type === "condition" ? "\u6761\u4EF6\u51FA\u53E3" : id
    };
    if (type === "condition") {
      menu.when = typeof value.when === "string" && value.when.trim() ? value.when.trim() : "true";
      if (typeof value.to === "string" && value.to) menu.to = value.to;
      if (value.end === true) menu.end = true;
      book.menus[id] = menu;
      continue;
    }
    if (typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0) {
      menu.index = value.index;
    }
    const items = Array.isArray(value.items) ? value.items : [];
    menu.items = items.filter((it) => isObject(it)).map((it, i) => ({
      id: typeof it.id === "string" && it.id ? it.id : `item_${i + 1}`,
      resultId: typeof it.resultId === "string" && it.resultId ? it.resultId : `result_${i + 1}`,
      text: typeof it.text === "string" ? it.text : `\u9009\u9879 ${i + 1}`,
      ...Array.isArray(it.effects) ? { effects: it.effects } : {},
      ...typeof it.require === "string" && it.require ? { require: it.require } : {}
    }));
    if (menu.items.length === 0) {
      bag.error(DIAG.MENU_EMPTY, `\u83DC\u5355\u300C${menu.title}\u300D\u6CA1\u6709\u4EFB\u4F55\u5267\u60C5\u9009\u9879`, loc, { menuId: id });
    }
    book.menus[id] = menu;
  }
  return { book, diagnostics: bag.list };
}
function parseOrchestrationJson(text, file = "orchestration.json") {
  const bag = new DiagnosticBag();
  const orch = emptyOrchestration();
  if (text == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, `\u672A\u627E\u5230 ${file}\uFF0C\u6309\u672A\u7F16\u6392\u5904\u7406`, { file, line: 1, column: 1 });
    return { orchestration: orch, diagnostics: bag.list };
  }
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { orchestration: orch, diagnostics: bag.list };
  orch.entry = typeof raw.entry === "string" ? raw.entry : "";
  if (Array.isArray(raw.links)) {
    raw.links.forEach((link, index) => {
      if (!isObject(link)) return;
      const normalized = {
        id: typeof link.id === "string" && link.id ? link.id : `link_${index + 1}`
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
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u7F3A\u5C11 links \u6570\u7EC4`, { file, line: 1, column: 1 });
  }
  return { orchestration: orch, diagnostics: bag.list };
}
function menuResults(menu) {
  if (!menu) return [];
  return (menu.items ?? []).map((it) => ({
    resultId: it.resultId,
    text: it.text,
    ...it.require ? { require: it.require } : {},
    ...it.effects ? { effects: it.effects } : {}
  }));
}
function evalFlagCondition(expr, flags) {
  const parser = new ConditionParser(expr, flags);
  const value = parser.parse();
  if (!parser.done) throw new Error(`\u6761\u4EF6\u8868\u8FBE\u5F0F\u6709\u591A\u4F59\u5185\u5BB9\uFF1A${expr}`);
  return !!value;
}
var ConditionParser = class {
  pos = 0;
  src;
  flags;
  constructor(src, flags) {
    this.src = src;
    this.flags = flags;
  }
  get done() {
    this.skip();
    return this.pos >= this.src.length;
  }
  skip() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  matchAny(...alts) {
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
  parse() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.matchAny("||", "or")) {
      const right = this.parseAnd();
      left = !!left || !!right;
    }
    return left;
  }
  parseAnd() {
    let left = this.parseUnary();
    while (this.matchAny("&&", "and")) {
      const right = this.parseUnary();
      left = !!left && !!right;
    }
    return left;
  }
  parseUnary() {
    this.skip();
    if (this.matchAny("!", "not")) return !this.parseUnary();
    if (this.src[this.pos] === "(") {
      this.pos++;
      const v = this.parseOr();
      this.skip();
      if (this.src[this.pos] !== ")") throw new Error(`\u6761\u4EF6\u8868\u8FBE\u5F0F\u7F3A\u5C11\u53F3\u62EC\u53F7\uFF1A${this.src}`);
      this.pos++;
      return v;
    }
    return this.parseComparison();
  }
  parseComparison() {
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
        return left > right;
      case "<":
        return left < right;
      case ">=":
        return left >= right;
      case "<=":
        return left <= right;
      default:
        return false;
    }
  }
  readOperator() {
    this.skip();
    const m = this.src.slice(this.pos).match(/^(===|!==|==|!=|>=|<=|>|<)/);
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }
  parsePrimary() {
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
    throw new Error(`\u65E0\u6CD5\u89E3\u6790\u6761\u4EF6\u8868\u8FBE\u5F0F\uFF1A${this.src}`);
  }
};
function labelPlayOrder(doc) {
  const fileOrder = /* @__PURE__ */ new Map();
  doc.files.forEach((f, i) => fileOrder.set(f, i));
  return Object.values(doc.labels).sort((a, b) => {
    const fa = fileOrder.get(a.file) ?? Number.MAX_SAFE_INTEGER;
    const fb = fileOrder.get(b.file) ?? Number.MAX_SAFE_INTEGER;
    return fa === fb ? a.line - b.line : fa - fb;
  });
}
function nextLabelId(doc, labelId) {
  const order = labelPlayOrder(doc);
  const i = order.findIndex((l) => l.id === labelId);
  return i >= 0 && i + 1 < order.length ? order[i + 1].id : null;
}
function plotlineOfLabel(doc, labelId) {
  const label = doc.labels[labelId];
  if (!label) return void 0;
  const name = plotlineNameOfLabel(label);
  return (doc.plotlines?.plotlines ?? []).find((p) => p.name === name);
}
function nextEnterableLabel(doc, labelId, isEnterable) {
  const order = labelPlayOrder(doc);
  const i = order.findIndex((l) => l.id === labelId);
  const skipped = [];
  if (i < 0) return { next: null, skipped };
  for (let j = i + 1; j < order.length; j++) {
    const id = order[j].id;
    if (isEnterable(id)) return { next: id, skipped };
    skipped.push(id);
  }
  return { next: null, skipped };
}
function hasMenuExit(doc, labelId) {
  return Object.values(doc.menus.menus).some(
    (m) => m.labelId === labelId && m.type === "choice" && m.jump === "out"
  );
}
function attachMenuAnchors(labels, book) {
  for (const label of Object.values(labels)) label.menus = [];
  for (const menu of Object.values(book.menus)) {
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
function deriveConditionLinks(book, orchestration) {
  const links = orchestration.links.filter((l) => !l.derivedFromMenu);
  for (const menu of Object.values(book.menus)) {
    if (menu.type !== "condition") continue;
    if (!menu.to && !menu.end) continue;
    links.push({
      id: `cond_${menu.id}`,
      fromLabel: menu.labelId,
      when: menu.when ?? "true",
      ...menu.to ? { to: menu.to } : {},
      ...menu.end ? { end: true } : {},
      derivedFromMenu: menu.id
    });
  }
  return { ...orchestration, links };
}
function validateProject(doc) {
  const bag = new DiagnosticBag();
  const labels = doc.labels;
  const labelIds = new Set(Object.keys(labels));
  if (!doc.orchestration.entry) {
    bag.error(
      DIAG.ORCH_ENTRY_MISSING,
      "\u9879\u76EE\u6CA1\u6709\u8BBE\u7F6E\u5F00\u59CB\u7247\u6BB5\uFF08\u5165\u53E3\uFF09\uFF0C\u8BF7\u5728\u300C\u5267\u60C5\u7F16\u6392\u300D\u4E2D\u9009\u62E9\u4E00\u4E2A label",
      { file: PROJECT_FILE_NAME, line: 1, column: 1 }
    );
  } else if (!labelIds.has(doc.orchestration.entry)) {
    bag.error(
      DIAG.ORCH_ENTRY_MISSING,
      `\u5165\u53E3\u7247\u6BB5 "${doc.orchestration.entry}" \u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u5220\u9664\u6216\u6539\u540D\uFF09`,
      { file: PROJECT_FILE_NAME, line: 1, column: 1 },
      { entry: doc.orchestration.entry }
    );
  }
  for (const menu of Object.values(doc.menus.menus)) {
    const label = labels[menu.labelId];
    if (!menu.labelId || !label) {
      bag.error(
        DIAG.MENU_LABEL_MISSING,
        `\u83DC\u5355\u300C${menu.title}\u300D\u6302\u8F7D\u7684\u7247\u6BB5 "${menu.labelId || "(\u7A7A)"}" \u4E0D\u5B58\u5728`,
        { file: PROJECT_FILE_NAME, line: 1, column: 1 },
        { menuId: menu.id, labelId: menu.labelId }
      );
    }
    validateMenu(
      menu,
      doc,
      bag,
      label ? { menuId: menu.id, file: label.file, line: label.line, labelId: label.id } : void 0
    );
  }
  const seenKeys = /* @__PURE__ */ new Set();
  for (const link of doc.orchestration.links) {
    const loc = { file: PROJECT_FILE_NAME, line: 1, column: 1 };
    if (!link.fromMenu && !link.fromLabel) {
      bag.error(DIAG.ORCH_RESULT_UNKNOWN, `\u8FDE\u7EBF "${link.id}" \u7F3A\u5C11\u6765\u6E90\uFF08\u83DC\u5355\u7ED3\u679C\u6216\u7247\u6BB5\u51FA\u53E3\uFF09`, loc);
      continue;
    }
    if (link.to && !labelIds.has(link.to)) {
      bag.error(
        DIAG.ORCH_TARGET_MISSING,
        `\u8FDE\u7EBF "${link.id}" \u7684\u76EE\u6807\u7247\u6BB5 "${link.to}" \u4E0D\u5B58\u5728`,
        loc,
        { linkId: link.id, to: link.to }
      );
    }
    if (!link.to && !link.end) {
      bag.error(DIAG.ORCH_RESULT_UNKNOWN, `\u8FDE\u7EBF "${link.id}" \u65E2\u6CA1\u6709\u76EE\u6807\u7247\u6BB5\u4E5F\u6CA1\u6709\u6807\u8BB0\u7ED3\u675F`, loc);
    }
    if (link.fromMenu) {
      const menu = doc.menus.menus[link.fromMenu];
      if (!menu) {
        bag.error(DIAG.MENU_UNDEFINED, `\u8FDE\u7EBF "${link.id}" \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u83DC\u5355 "${link.fromMenu}"`, loc);
        continue;
      }
      if (!link.resultId) {
        bag.error(DIAG.ORCH_RESULT_UNKNOWN, `\u8FDE\u7EBF "${link.id}" \u7F3A\u5C11\u7ED3\u679C ID`, loc);
        continue;
      }
      const results = menuResults(menu).map((r) => r.resultId);
      if (!results.includes(link.resultId)) {
        bag.error(
          DIAG.ORCH_RESULT_UNKNOWN,
          `\u8FDE\u7EBF "${link.id}" \u7684\u7ED3\u679C "${link.resultId}" \u4E0D\u5728\u83DC\u5355\u300C${menu.title}\u300D\u4E2D\uFF08\u53EF\u80FD\u5DF2\u5220\u9664\u8BE5\u9879\uFF09`,
          loc,
          { menuId: menu.id, resultId: link.resultId }
        );
      }
      const key = `menu:${link.fromMenu}:${link.resultId}:${link.when ?? ""}`;
      if (seenKeys.has(key)) {
        bag.error(
          DIAG.ORCH_DUPLICATE_LINK,
          `\u83DC\u5355\u300C${menu.title}\u300D\u7684\u7ED3\u679C "${link.resultId}" \u5B58\u5728\u91CD\u590D\u8FDE\u63A5${link.when ? `\uFF08\u6761\u4EF6\uFF1A${link.when}\uFF09` : ""}`,
          loc,
          { menuId: link.fromMenu, resultId: link.resultId }
        );
      }
      seenKeys.add(key);
    } else if (link.fromLabel && !labelIds.has(link.fromLabel)) {
      bag.error(DIAG.ORCH_TARGET_MISSING, `\u8FDE\u7EBF "${link.id}" \u7684\u6765\u6E90\u7247\u6BB5 "${link.fromLabel}" \u4E0D\u5B58\u5728`, loc);
    }
  }
  const menusByLabel = /* @__PURE__ */ new Map();
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
        `\u7247\u6BB5\u300C${label?.name ?? labelId}\u300D\u540C\u65F6\u914D\u7F6E\u4E86\u5267\u60C5\u9009\u9879\u548C\u6761\u4EF6\u51FA\u53E3\uFF1B\u4E24\u8005\u4E92\u65A5\uFF0C\u8BF7\u53EA\u4FDD\u7559\u4E00\u79CD`,
        label ? { file: label.file, line: label.line, column: 1 } : void 0,
        { labelId }
      );
    }
    const seenWhen = /* @__PURE__ */ new Set();
    for (const menu of list) {
      if (menu.type !== "condition") continue;
      const when = menu.when ?? "true";
      if (seenWhen.has(when)) {
        bag.warn(
          DIAG.MENU_CONDITION_DUPLICATE,
          `\u7247\u6BB5\u300C${label?.name ?? labelId}\u300D\u6709\u591A\u6761\u6761\u4EF6\u540C\u4E3A\u300C${when}\u300D\u7684\u51FA\u53E3\uFF0C\u540E\u9762\u7684\u6C38\u8FDC\u4E0D\u4F1A\u547D\u4E2D`,
          label ? { file: label.file, line: label.line, column: 1 } : void 0,
          { menuId: menu.id, labelId }
        );
      }
      seenWhen.add(when);
    }
  }
  for (const menu of Object.values(doc.menus.menus)) {
    if (menu.type === "condition") continue;
    if (menu.jump === "back") continue;
    const label = labels[menu.labelId];
    for (const result of menuResults(menu)) {
      const connected = doc.orchestration.links.some(
        (l) => l.fromMenu === menu.id && l.resultId === result.resultId
      );
      if (!connected) {
        bag.error(
          DIAG.ORCH_RESULT_UNCONNECTED,
          `\u83DC\u5355\u300C${menu.title}\u300D\u7684\u7ED3\u679C "${result.text}"\uFF08${result.resultId}\uFF09\u8FD8\u6CA1\u6709\u8FDE\u63A5\u76EE\u6807\u7247\u6BB5`,
          label ? { file: label.file, line: label.line, column: 1 } : void 0,
          { menuId: menu.id, resultId: result.resultId, labelId: label?.id }
        );
      }
    }
  }
  for (const label of Object.values(doc.labels)) {
    if (hasMenuExit(doc, label.id)) continue;
    const currentOwner = plotlineOfLabel(doc, label.id);
    const seq = nextEnterableLabel(doc, label.id, (id) => {
      const owner = plotlineOfLabel(doc, id);
      if (!owner || owner.kind !== "branch" || !owner.optional) return true;
      return owner.id === currentOwner?.id;
    });
    if (seq.next) continue;
    const exits = doc.orchestration.links.filter((l) => l.fromLabel === label.id);
    const usable = exits.filter((e) => e.end || e.to);
    if (seq.skipped.length) {
      const names = seq.skipped.map((id) => `\u300C${doc.labels[id]?.name ?? id}\u300D`).join("\u3001");
      if (usable.length === 0) {
        bag.warn(
          DIAG.ORCH_BRANCH_GATED_DEAD_END,
          `\u7247\u6BB5\u300C${label.name}\u300D\u540E\u9762\u53EA\u6709\u53EF\u8DF3\u8FC7\u7684\u652F\u7EBF\u7247\u6BB5 ${names}\uFF1A\u652F\u7EBF\u672A\u5F00\u542F\u65F6\u5B83\u4EEC\u4F1A\u88AB\u8DF3\u8FC7\uFF0C\u6D41\u7A0B\u5C06\u6CA1\u6709\u51FA\u53E3\uFF0C\u8BF7\u8865\u7ED3\u675F\u6216\u663E\u5F0F\u51FA\u53E3`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id, skipped: seq.skipped }
        );
      }
      continue;
    }
    if (usable.length === 0) {
      bag.error(
        DIAG.ORCH_LABEL_NO_EXIT,
        `\u7247\u6BB5\u300C${label.name}\u300D\u662F\u6700\u540E\u4E00\u4E2A\u7247\u6BB5\uFF0C\u6CA1\u6709\u914D\u7F6E\u81EA\u52A8\u51FA\u53E3\u6216\u7ED3\u675F`,
        { file: label.file, line: label.line, column: 1 },
        { labelId: label.id }
      );
    } else if (usable.filter((e) => e.to).length > 1) {
      bag.warn(
        DIAG.ORCH_DUPLICATE_LINK,
        `\u7247\u6BB5\u300C${label.name}\u300D\u6709\u591A\u4E2A\u81EA\u52A8\u51FA\u53E3\uFF0C\u8BF7\u4E3A\u5B83\u4EEC\u6DFB\u52A0\u6761\u4EF6\u6216\u5220\u9664\u591A\u4F59\u8FDE\u7EBF`,
        { file: label.file, line: label.line, column: 1 },
        { labelId: label.id }
      );
    }
  }
  const graph = /* @__PURE__ */ new Map();
  for (const id of labelIds) graph.set(id, /* @__PURE__ */ new Set());
  for (const link of doc.orchestration.links) {
    if (!link.to) continue;
    if (link.fromMenu) {
      const menu = doc.menus.menus[link.fromMenu];
      if (menu) graph.get(menu.labelId)?.add(link.to);
    } else if (link.fromLabel) {
      graph.get(link.fromLabel)?.add(link.to);
    }
  }
  const explicitExit = /* @__PURE__ */ new Set();
  for (const link of doc.orchestration.links) {
    if (!link.fromLabel) continue;
    if (link.end || link.to && (!link.when || link.when.trim() === "true")) {
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
    const seen = /* @__PURE__ */ new Set([doc.orchestration.entry]);
    const queue = [doc.orchestration.entry];
    while (queue.length) {
      const cur = queue.shift();
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
          `\u7247\u6BB5\u300C${label.name}\u300D\u4ECE\u5165\u53E3\u4E0D\u53EF\u8FBE`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id }
        );
      }
    }
    const reported = /* @__PURE__ */ new Set();
    const stack = [];
    const visiting = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    const dfs = (id) => {
      if (visiting.has(id)) {
        const start = stack.indexOf(id);
        const cycle = stack.slice(start >= 0 ? start : 0).concat(id);
        const key = [...new Set(cycle)].sort().join(">");
        if (!reported.has(key)) {
          reported.add(key);
          bag.info(
            DIAG.ORCH_CYCLE,
            `\u68C0\u6D4B\u5230\u5FAA\u73AF\uFF1A${cycle.join(" \u2192 ")}\uFF08\u5982\u4E3A\u6709\u610F\u5FAA\u73AF\u53EF\u4FDD\u7559\uFF09`,
            { file: labels[id].file, line: labels[id].line, column: 1 },
            { cycle }
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
  }
  const plotlineOwner = /* @__PURE__ */ new Map();
  for (const plotline of doc.plotlines?.plotlines ?? []) {
    if (plotline.kind === "thread") {
      for (const id of plotline.labelIds ?? []) {
        if (!labelIds.has(id)) {
          bag.warn(
            DIAG.PLOTLINE_LABEL_MISSING,
            `\u7EBF\u7D22\u7EBF\u300C${plotline.name}\u300D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u7247\u6BB5 "${id}"`,
            { file: PROJECT_FILE_NAME, line: 1, column: 1 },
            { plotlineId: plotline.id, labelId: id }
          );
        }
      }
      continue;
    }
    for (const id of plotline.labelIds ?? []) {
      if (!labelIds.has(id)) {
        bag.warn(
          DIAG.PLOTLINE_LABEL_MISSING,
          `\u60C5\u8282\u7EBF\u300C${plotline.name}\u300D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u7247\u6BB5 "${id}"`,
          { file: PROJECT_FILE_NAME, line: 1, column: 1 },
          { plotlineId: plotline.id, labelId: id }
        );
        continue;
      }
      const previous = plotlineOwner.get(id);
      if (previous) {
        bag.error(
          DIAG.PLOTLINE_DUPLICATE_ASSIGN,
          `\u7247\u6BB5\u300C${labels[id].name}\u300D\u540C\u65F6\u5F52\u5C5E\u300C${previous.name}\u300D\u548C\u300C${plotline.name}\u300D\uFF0C\u6BCF\u4E2A\u7247\u6BB5\u53EA\u80FD\u5C5E\u4E8E\u4E00\u6761\u60C5\u8282\u7EBF`,
          { file: labels[id].file, line: labels[id].line, column: 1 },
          { labelId: id, plotlineId: plotline.id }
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
      `\u7247\u6BB5\u300C${label.name}\u300D\u8FD8\u6CA1\u6709\u5F52\u5C5E\u60C5\u8282\u7EBF`,
      { file: label.file, line: label.line, column: 1 },
      { labelId: label.id }
    );
  }
  for (const plotline of doc.plotlines?.plotlines ?? []) {
    if (plotline.kind !== "thread") continue;
    for (const id of plotline.labelIds ?? []) {
      const owner = plotlineOwner.get(id);
      if (owner && owner.kind === "branch") {
        bag.warn(
          DIAG.PLOTLINE_DUPLICATE_ASSIGN,
          `\u7EBF\u7D22\u7EBF\u300C${plotline.name}\u300D\u6302\u5728\u7ED3\u6784\u652F\u7EBF\u7247\u6BB5\u300C${labels[id].name}\u300D\u4E0A\uFF1B\u7EBF\u7D22\u7EBF\u53EA\u80FD\u6807\u6CE8\u4E3B\u7EBF\u7247\u6BB5`,
          { file: labels[id].file, line: labels[id].line, column: 1 },
          { labelId: id, plotlineId: plotline.id }
        );
      }
    }
  }
  if (!doc.orchestration.links.some((l) => l.end)) {
    bag.warn(DIAG.ORCH_NO_END, "\u7F16\u6392\u4E2D\u6CA1\u6709\u663E\u5F0F\u7ED3\u675F\u8FDE\u63A5\uFF0C\u6D41\u7A0B\u53EF\u80FD\u65E0\u6CD5\u6536\u5C3E", {
      file: PROJECT_FILE_NAME,
      line: 1,
      column: 1
    });
  }
  return bag.list;
}
function validateMenu(menu, doc, bag, anchor) {
  const loc = anchor ? { file: anchor.file, line: anchor.line, column: 1 } : { file: PROJECT_FILE_NAME, line: 1, column: 1 };
  if (menu.type === "condition") {
    if (!menu.when || !menu.when.trim()) {
      bag.warn(
        DIAG.MENU_CONDITION_TARGET_MISSING,
        `\u6761\u4EF6\u51FA\u53E3\u300C${menu.title}\u300D\u7F3A\u5C11\u6761\u4EF6\u8868\u8FBE\u5F0F\uFF0C\u5C06\u6309\u6052\u771F\u5904\u7406`,
        loc,
        { menuId: menu.id }
      );
    } else {
      validateExpression(menu.when, `\u6761\u4EF6\u51FA\u53E3\u300C${menu.title}\u300D`, doc, bag, loc, {
        menuId: menu.id,
        labelId: menu.labelId
      });
    }
    if (!menu.to && !menu.end) {
      bag.warn(
        DIAG.MENU_CONDITION_TARGET_MISSING,
        `\u6761\u4EF6\u51FA\u53E3\u300C${menu.title}\u300D\u8FD8\u6CA1\u6709\u76EE\u6807\u7247\u6BB5`,
        loc,
        { menuId: menu.id }
      );
    }
    const when = (menu.when ?? "").trim();
    if (when === "true" && menu.to && menu.to === nextLabelId(doc, menu.labelId)) {
      bag.info(
        DIAG.MENU_CONDITION_REDUNDANT,
        `\u6761\u4EF6\u51FA\u53E3\u300C${menu.title}\u300D\u6761\u4EF6\u6052\u771F\u3001\u76EE\u6807\u5C31\u662F\u987A\u5E8F\u4E0A\u7684\u4E0B\u4E00\u4E2A\u7247\u6BB5\uFF0C\u4E0E\u9ED8\u8BA4\u51FA\u53E3\u7B49\u4EF7\uFF0C\u53EF\u4EE5\u5220\u9664`,
        loc,
        { menuId: menu.id, labelId: menu.labelId }
      );
    }
    return;
  }
  const owner = doc.labels[menu.labelId];
  if (owner) {
    const steps = owner.steps.length;
    const index = menu.index ?? steps;
    if (index > steps) {
      bag.warn(
        DIAG.ORCH_MENU_POSITION,
        `\u83DC\u5355\u300C${menu.title}\u300D\u7684\u63D2\u5165\u4F4D\u7F6E\uFF08\u7B2C ${index} \u6B65\u4E4B\u540E\uFF09\u8D85\u51FA\u7247\u6BB5\u300C${owner.name}\u300D\u7684 ${steps} \u6B65\uFF0C\u5C06\u6309\u672B\u5C3E\u5904\u7406`,
        loc,
        { menuId: menu.id, index }
      );
    } else if (menu.jump === "out" && index < steps) {
      bag.warn(
        DIAG.ORCH_MENU_POSITION,
        `\u83DC\u5355\u300C${menu.title}\u300D\u662F\u8DF3\u51FA\u83DC\u5355\uFF0C\u4F4D\u4E8E\u7B2C ${index} \u6B65\u4E4B\u540E\uFF0C\u7247\u6BB5\u300C${owner.name}\u300D\u5269\u4E0B\u7684 ${steps - index} \u6B65\u4E0D\u4F1A\u88AB\u6267\u884C`,
        loc,
        { menuId: menu.id, index }
      );
    }
  }
  const items = menu.items ?? [];
  if (items.length === 0) {
    bag.error(DIAG.MENU_EMPTY, `\u83DC\u5355\u300C${menu.title}\u300D\u6CA1\u6709\u4EFB\u4F55\u5267\u60C5\u9009\u9879`, loc, { menuId: menu.id });
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.text.trim()) {
      bag.warn(DIAG.MENU_EMPTY, `\u83DC\u5355\u300C${menu.title}\u300D\u6709\u9009\u9879\u7F3A\u5C11\u663E\u793A\u6587\u6848`, loc, {
        menuId: menu.id,
        resultId: item.resultId
      });
    }
    if (seen.has(item.resultId)) {
      bag.error(
        DIAG.MENU_DUPLICATE_RESULT,
        `\u83DC\u5355\u300C${menu.title}\u300D\u7684\u7ED3\u679C ID "${item.resultId}" \u91CD\u590D`,
        loc,
        { menuId: menu.id, resultId: item.resultId }
      );
    }
    seen.add(item.resultId);
    validateEffects(item.effects, doc, bag, loc);
    if (item.require) {
      validateExpression(item.require, `\u83DC\u5355\u300C${menu.title}\u300D\u7684\u9009\u9879\u300C${item.text}\u300D`, doc, bag, loc, {
        menuId: menu.id,
        resultId: item.resultId
      });
    }
  }
}
function validateExpression(expr, owner, doc, bag, loc, extra) {
  const source = expr.trim();
  if (!source) return;
  try {
    evalFlagCondition(source, {});
  } catch {
    bag.warn(
      DIAG.MENU_CONDITION_INVALID,
      `${owner}\u7684\u6761\u4EF6\u8868\u8FBE\u5F0F\u65E0\u6CD5\u89E3\u6790\uFF1A${source}\uFF08\u8FD0\u884C\u65F6\u4F1A\u5F53\u4F5C\u4E0D\u547D\u4E2D\uFF09`,
      loc,
      extra
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
      `${owner}\u7684\u6761\u4EF6\u5F15\u7528\u4E86\u672A\u5B9A\u4E49\u7684\u72B6\u6001 "${id}"\uFF0C\u8FD0\u884C\u65F6\u6C38\u8FDC\u4E0D\u547D\u4E2D`,
      loc,
      { ...extra, stateId: id }
    );
  }
}
function validateEffects(effects, doc, bag, loc) {
  if (!effects) return;
  const byId = new Map(doc.states.states.map((s) => [s.id, s]));
  for (const effect of effects) {
    const def = byId.get(effect.stateId);
    if (!def) {
      bag.error(DIAG.STATE_UNDECLARED, `\u72B6\u6001\u6548\u679C\u5F15\u7528\u4E86\u672A\u5B9A\u4E49\u7684\u72B6\u6001 "${effect.stateId}"`, loc, {
        stateId: effect.stateId
      });
      continue;
    }
    if (effect.op !== "set" && def.type !== "number") {
      bag.error(DIAG.STATE_TYPE_MISMATCH, `\u72B6\u6001\u300C${def.name}\u300D\u4E0D\u662F\u6570\u503C\u7C7B\u578B\uFF0C\u4E0D\u80FD\u7528 add/sub`, loc, {
        stateId: def.id
      });
      continue;
    }
    if (effect.op === "set" && !matchesType2(def.type, effect.value)) {
      bag.error(
        DIAG.STATE_TYPE_MISMATCH,
        `\u72B6\u6001\u300C${def.name}\u300D\u662F ${def.type} \u7C7B\u578B\uFF0C\u8D4B\u503C ${JSON.stringify(effect.value)} \u4E0D\u5339\u914D`,
        loc,
        { stateId: def.id }
      );
      continue;
    }
    if (effect.op === "set" && def.type === "enum" && !(def.options ?? []).includes(String(effect.value))) {
      bag.error(
        DIAG.STATE_TYPE_MISMATCH,
        `\u72B6\u6001\u300C${def.name}\u300D\u662F\u4E0B\u62C9\u5217\u8868\u7C7B\u578B\uFF0C\u8D4B\u503C ${JSON.stringify(effect.value)} \u4E0D\u5728\u53EF\u9009\u9879\u91CC`,
        loc,
        { stateId: def.id }
      );
    }
  }
}
function labelList(labels) {
  return Object.values(labels).sort((a, b) => a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file));
}
var PLOTLINE_TYPES = [
  {
    id: "setting",
    name: "\u8BBE\u5B9A\u578B",
    tier: "core",
    desc: "\u89E3\u91CA\u4E16\u754C\u4E3A\u4EC0\u4E48\u80FD\u8FD9\u6837\u8FD0\u8F6C\uFF1A\u524D\u4EE3\u5E03\u5C40\u3001\u673A\u5236\u63ED\u79D8\u3001\u4F20\u8BF4\u5C42"
  },
  {
    id: "foreshadow",
    name: "\u4F0F\u7B14\u578B",
    tier: "core",
    desc: "\u524D\u671F\u53EA\u7ED9\u7EC6\u8282\u3001\u540E\u671F\u5151\u73B0\uFF1A\u5C0F\u4EBA\u7269\u3001\u5C0F\u7269\u4EF6\u3001\u4E00\u53E5\u95F2\u8C08"
  },
  {
    id: "conflict",
    name: "\u51B2\u7A81\u578B",
    tier: "core",
    desc: "\u7ED9\u4E3B\u7EBF\u5236\u9020\u963B\u529B\u4E0E\u4EE3\u4EF7\uFF1A\u5BBF\u654C\u8FFD\u6740\u3001\u5E55\u540E\u5E03\u5C40\u3001\u9636\u6BB5\u5927\u4E8B\u4EF6"
  },
  {
    id: "faction",
    name: "\u52BF\u529B\u578B",
    tier: "important",
    desc: "\u628A\u4E2A\u4EBA\u5347\u7EA7\u63A8\u5230\u5929\u4E0B\u68CB\u5C40\uFF1A\u5730\u57DF / \u7EC4\u7EC7\u5185\u6597\u3001\u591A\u65B9\u5408\u7EB5\u8FDE\u6A2A"
  },
  {
    id: "character",
    name: "\u89D2\u8272\u578B",
    tier: "important",
    desc: "\u501F\u4ED6\u4EBA\u5F27\u5149\u53CD\u886C\u4E3B\u89D2\uFF1A\u914D\u89D2\u590D\u4EC7 / \u6551\u8D4E\u3001\u955C\u50CF\u89D2\u8272\u3001\u5BBF\u654C"
  },
  {
    id: "resource",
    name: "\u8D44\u6E90\u578B",
    tier: "optional",
    desc: "\u63D0\u4F9B\u5347\u7EA7\u71C3\u6599\uFF1A\u79D8\u5883\u5BFB\u5B9D\u3001\u751F\u4EA7\u3001\u4EA4\u6613\u62CD\u5356"
  },
  {
    id: "emotion",
    name: "\u60C5\u611F\u578B",
    tier: "optional",
    desc: "\u7ED9\u5347\u7EA7\u6846\u67B6\u52A0\u6E29\uFF1A\u7231\u60C5\u3001\u5E08\u5F92\u3001\u4EB2\u60C5\u3001\u53CB\u60C5"
  }
];
var PLOTLINE_TIER_NAME = {
  core: "\u6838\u5FC3",
  important: "\u91CD\u8981",
  optional: "\u53EF\u5220\u51CF"
};
function parsePlotlineType(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  for (const t of PLOTLINE_TYPES) {
    if (lower === t.id || key === t.name || key === t.name.replace(/型$/, "")) return t.id;
  }
  return null;
}
function parsePlotlinesJson(text, file = PROJECT_FILE_NAME) {
  const bag = new DiagnosticBag();
  const book = emptyPlotlineBook();
  if (text == null) return { book, diagnostics: bag.list };
  const raw = readJsonObject(text, file, bag);
  if (!raw) return { book, diagnostics: bag.list };
  if (!Array.isArray(raw.plotlines)) {
    bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `${file} \u7F3A\u5C11 plotlines \u6570\u7EC4\uFF0C\u6309\u7A7A\u60C5\u8282\u7EBF\u5904\u7406`, {
      file,
      line: 1,
      column: 1
    });
    return { book, diagnostics: bag.list };
  }
  const seen = /* @__PURE__ */ new Set();
  let mainSeen = false;
  raw.plotlines.forEach((item, index) => {
    const loc = { file, line: index + 1, column: 1 };
    if (!isObject(item)) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `plotlines[${index}] \u4E0D\u662F\u5BF9\u8C61\uFF0C\u5DF2\u5FFD\u7565`, loc);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `plotlines[${index}] \u7F3A\u5C11\u7A33\u5B9A ID\uFF0C\u5DF2\u5FFD\u7565`, loc);
      return;
    }
    if (seen.has(id)) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `\u60C5\u8282\u7EBF ID "${id}" \u91CD\u590D\uFF0C\u5DF2\u5FFD\u7565\u540E\u8005`, loc);
      return;
    }
    seen.add(id);
    const wantsMain = item.kind === "main";
    if (wantsMain && mainSeen) {
      bag.warn(DIAG.PROJECT_PLOTLINE_INVALID, `\u60C5\u8282\u7EBF\u300C${id}\u300D\u91CD\u590D\u58F0\u660E\u4E3A\u4E3B\u7EBF\uFF0C\u5DF2\u6309\u652F\u7EBF\u5904\u7406`, loc);
    }
    const wantsThread = item.kind === "thread";
    const kind = wantsMain ? mainSeen ? "branch" : "main" : wantsThread ? "thread" : "branch";
    if (kind === "main") mainSeen = true;
    const plotline = {
      id,
      // 主线固定叫「主线」，名字不可改
      name: kind === "main" ? MAIN_PLOTLINE_NAME : typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
      kind
    };
    if (kind !== "main" && item.type !== void 0 && item.type !== null) {
      const type = parsePlotlineType(item.type);
      if (type) {
        plotline.type = type;
      } else {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `\u60C5\u8282\u7EBF\u300C${plotline.name}\u300D\u7684\u529F\u80FD\u7C7B\u578B ${JSON.stringify(item.type)} \u65E0\u6CD5\u8BC6\u522B\uFF0C\u5DF2\u6309\u672A\u5206\u7C7B\u5904\u7406`,
          loc,
          { plotlineId: id }
        );
      }
    }
    if (kind === "thread") {
      if (!plotline.type) {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `\u7EBF\u7D22\u7EBF\u300C${plotline.name}\u300D\u7F3A\u5C11\u529F\u80FD\u7C7B\u578B\uFF08\u5E94\u4E3A\u8BBE\u5B9A\u578B setting \u6216\u4F0F\u7B14\u578B foreshadow\uFF09`,
          loc,
          { plotlineId: id }
        );
      } else if (plotline.type !== "setting" && plotline.type !== "foreshadow") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `\u7EBF\u7D22\u7EBF\u300C${plotline.name}\u300D\u7684\u7C7B\u578B\u662F\u300C${plotline.type}\u300D\uFF0C\u8BBE\u5B9A\u578B / \u4F0F\u7B14\u578B\u4E4B\u5916\u7684\u7C7B\u578B\u5EFA\u8BAE\u8D70\u7ED3\u6784\u652F\u7EBF`,
          loc,
          { plotlineId: id }
        );
      }
    }
    if (item.optional !== void 0 && item.optional !== null) {
      if (kind !== "branch") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `\u60C5\u8282\u7EBF\u300C${plotline.name}\u300D\u4E0D\u662F\u652F\u7EBF\uFF0C\u5DF2\u5FFD\u7565\u300C\u53EF\u8DF3\u8FC7\u652F\u7EBF\u300D\u8BBE\u7F6E`,
          loc,
          { plotlineId: id }
        );
      } else if (typeof item.optional !== "boolean") {
        bag.warn(
          DIAG.PROJECT_PLOTLINE_INVALID,
          `\u60C5\u8282\u7EBF\u300C${plotline.name}\u300D\u7684 optional \u5FC5\u987B\u662F true / false\uFF0C\u5DF2\u5FFD\u7565`,
          loc,
          { plotlineId: id }
        );
      } else if (item.optional) {
        plotline.optional = true;
      }
    }
    if (Array.isArray(item.labelIds)) {
      const labelIds = item.labelIds.filter((v) => typeof v === "string" && v.trim() !== "");
      if (labelIds.length) plotline.labelIds = labelIds;
    }
    book.plotlines.push(plotline);
  });
  return { book, diagnostics: bag.list };
}
function makePlotlineId(name, used) {
  const slug2 = name.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  const base = `pl_${slug2 || "branch"}`;
  if (!used || !used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function plotlineNameOfLabel(label) {
  return (label.plotline ?? "").trim() || MAIN_PLOTLINE_NAME;
}
function syncPlotlinesFromLabels(labels, book) {
  const source = book?.plotlines ?? [];
  const mainSource = source.find((p) => p.kind === "main");
  const main = {
    id: mainSource?.id ?? "pl_main",
    name: MAIN_PLOTLINE_NAME,
    kind: "main"
  };
  const typeByName = /* @__PURE__ */ new Map();
  for (const p of source) {
    if (p.kind !== "branch" || !p.type) continue;
    typeByName.set(p.name, p.type);
  }
  const optionalById = /* @__PURE__ */ new Set();
  for (const p of source) {
    if (p.kind !== "branch" || !p.optional) continue;
    optionalById.add(p.id);
  }
  const threads = [];
  for (const p of source) {
    if (p.kind !== "thread" || p.id === main.id) continue;
    const item = { id: p.id, name: p.name, kind: "thread" };
    if (p.type) item.type = p.type;
    const ids = (p.labelIds ?? []).filter((id) => Boolean(labels[id]));
    if (ids.length) item.labelIds = ids;
    threads.push(item);
  }
  const idsByName = /* @__PURE__ */ new Map();
  for (const label of labelList(labels)) {
    const name = plotlineNameOfLabel(label);
    const ids = idsByName.get(name);
    if (ids) ids.push(label.id);
    else idsByName.set(name, [label.id]);
  }
  const used = /* @__PURE__ */ new Set([main.id, ...threads.map((t) => t.id)]);
  const branches = [];
  const created = /* @__PURE__ */ new Map();
  const create = (name, preferredId) => {
    let id = preferredId?.trim() ?? "";
    if (!id || used.has(id)) id = makePlotlineId(name, used);
    used.add(id);
    const item = { id, name, kind: "branch" };
    const type = typeByName.get(name);
    if (type) item.type = type;
    if (optionalById.has(id) || preferredId && optionalById.has(preferredId.trim())) {
      item.optional = true;
    }
    created.set(name, item);
    branches.push(item);
    return item;
  };
  for (const p of source) {
    if (p.kind !== "branch" || created.has(p.name) || !idsByName.has(p.name)) continue;
    create(p.name, p.id);
  }
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
    plotlines: [main, ...branches, ...threads]
  };
}

// src/project-bundle.ts
function isObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseProjectBundle(text, file = PROJECT_FILE_NAME) {
  const bag = new DiagnosticBag();
  const loc = { file, line: 1, column: 1 };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${e.message}`, loc);
    return { bundle: null, diagnostics: bag.list };
  }
  if (!isObject2(raw)) {
    bag.error(DIAG.PROJECT_JSON_INVALID, `${file} \u9876\u5C42\u5FC5\u987B\u662F\u5BF9\u8C61`, loc);
    return { bundle: null, diagnostics: bag.list };
  }
  const version = Number(raw.schemaVersion ?? PROJECT_SCHEMA_VERSION);
  if (version !== PROJECT_SCHEMA_VERSION) {
    bag.error(
      DIAG.PROJECT_VERSION_UNSUPPORTED,
      `${file} \u7684 schemaVersion=${version} \u4E0D\u53D7\u652F\u6301\uFF08\u5F53\u524D ${PROJECT_SCHEMA_VERSION}\uFF09`,
      loc
    );
    return { bundle: null, diagnostics: bag.list };
  }
  const missing = (section) => bag.info(DIAG.PROJECT_FILE_MISSING, `${file} \u7F3A\u5C11 ${section} \u6BB5\uFF0C\u6309\u7A7A\u5904\u7406`, loc);
  let states = emptyStateModule();
  if (isObject2(raw.states)) {
    const r = parseStatesJson(JSON.stringify(raw.states), file);
    bag.merge(r.diagnostics);
    states = r.module;
  } else {
    missing("states");
  }
  let menus = emptyMenuBook();
  if (isObject2(raw.menus)) {
    const r = parseMenusJson(JSON.stringify(raw.menus), file);
    bag.merge(r.diagnostics);
    menus = r.book;
  } else {
    missing("menus");
  }
  let orchestration = emptyOrchestration();
  if (isObject2(raw.orchestration)) {
    const r = parseOrchestrationJson(JSON.stringify(raw.orchestration), file);
    bag.merge(r.diagnostics);
    orchestration = r.orchestration;
  } else {
    missing("orchestration");
  }
  let plotlines = emptyPlotlineBook();
  if (isObject2(raw.plotlines)) {
    const r = parsePlotlinesJson(JSON.stringify(raw.plotlines), file);
    bag.merge(r.diagnostics);
    plotlines = r.book;
  }
  return {
    bundle: { schemaVersion: version, states, menus, plotlines, orchestration },
    diagnostics: bag.list
  };
}
function serializeProjectBundle(doc) {
  const bundle = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    states: doc.states,
    menus: doc.menus,
    plotlines: doc.plotlines ?? emptyPlotlineBook(),
    orchestration: {
      ...doc.orchestration,
      // 条件出口由 menus 派生，属于内存视图；落盘只保留手写连线
      links: doc.orchestration.links.filter((l) => !l.derivedFromMenu)
    }
  };
  return JSON.stringify(bundle, null, 2);
}

// src/asset-diagnostics.ts
var ABS_PATH = /^(?:[a-zA-Z]:[\\/]|\/)/;
function collectAssetDiagnostics(assets, io) {
  const bag = new DiagnosticBag();
  const byPath = /* @__PURE__ */ new Map();
  for (const [id, item] of Object.entries(assets.items)) {
    const path = (item.path ?? "").trim();
    const loc = { file: "assets.json", line: 1, column: 1 };
    if (!path) {
      bag.info(
        DIAG.ASSET_UNBOUND,
        `\u7D20\u6750\u300C${item.name}\u300D\u5C1A\u672A\u7ED1\u5B9A\u6587\u4EF6\uFF0C\u9884\u89C8\u4E2D\u5C06\u4EE5\u5360\u4F4D\u663E\u793A`,
        loc,
        { assetId: id, kind: item.kind }
      );
      continue;
    }
    if (!ABS_PATH.test(path)) byPath.set(path, [...byPath.get(path) ?? [], id]);
    if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) {
      bag.warn(
        DIAG.ASSET_PATH_INVALID,
        `\u7D20\u6750\u300C${item.name}\u300D\u7684\u8DEF\u5F84\u7F3A\u5C11\u6269\u5C55\u540D\uFF1A${path}`,
        loc,
        { assetId: id }
      );
      continue;
    }
    if (!ABS_PATH.test(path) && !io.exists(path)) {
      bag.warn(
        DIAG.ASSET_PATH_INVALID,
        `\u7D20\u6750\u300C${item.name}\u300D\u5F15\u7528\u7684\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${path}`,
        loc,
        { assetId: id, path }
      );
    }
  }
  for (const [path, ids] of byPath) {
    if (ids.length <= 1) continue;
    bag.warn(
      DIAG.ASSET_DUPLICATE_FILE,
      `\u6709 ${ids.length} \u4E2A\u7D20\u6750\u6761\u76EE\u6307\u5411\u540C\u4E00\u6587\u4EF6\uFF1A${path}\uFF08${ids.join(", ")}\uFF09`,
      { file: "assets.json", line: 1, column: 1 },
      { path, assetIds: ids }
    );
  }
  return bag.list;
}

// src/project-loader.ts
var SCRIPT_EXTENSIONS = [".story.md", ".md", ".markdown", ".txt"];
var NON_SCRIPT_FILES = /* @__PURE__ */ new Set(["readme.md", "story_format.md", "readme.txt"]);
function pickScriptFiles(files) {
  const rank = (f) => {
    const lower = f.toLowerCase();
    const i = SCRIPT_EXTENSIONS.findIndex((ext) => lower.endsWith(ext));
    return i < 0 ? SCRIPT_EXTENSIONS.length : i;
  };
  return files.filter((f) => !NON_SCRIPT_FILES.has(f.toLowerCase())).filter((f) => SCRIPT_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "zh"));
}
function readProjectModel(io, bag) {
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
      orchestration: orchResult.orchestration
    };
  };
  const bundleText = io.readText(PROJECT_FILE_NAME);
  const hasLegacy = LEGACY_PROJECT_FILES.some((f) => io.exists(f));
  const loc = { file: PROJECT_FILE_NAME, line: 1, column: 1 };
  if (bundleText == null) {
    if (!hasLegacy) {
      bag.info(
        DIAG.PROJECT_FILE_MISSING,
        `\u672A\u627E\u5230 ${PROJECT_FILE_NAME}\uFF0C\u72B6\u6001 / \u83DC\u5355 / \u7F16\u6392\u6309\u7A7A\u5904\u7406`,
        loc
      );
    }
    return readLegacy();
  }
  if (hasLegacy) {
    bag.info(
      DIAG.PROJECT_LAYOUT_CONFLICT,
      `\u540C\u65F6\u5B58\u5728 ${PROJECT_FILE_NAME} \u4E0E\u65E7\u7248\u5206\u6563\u6587\u4EF6\uFF0C\u5DF2\u6309\u5408\u5E76\u6587\u4EF6\u8BFB\u53D6\uFF1B\u65E7\u6587\u4EF6\u53EF\u5220\u9664`,
      loc
    );
  }
  const parsed = parseProjectBundle(bundleText);
  bag.merge(parsed.diagnostics);
  if (parsed.bundle) {
    return {
      states: parsed.bundle.states,
      menus: parsed.bundle.menus,
      plotlines: parsed.bundle.plotlines,
      orchestration: parsed.bundle.orchestration
    };
  }
  bag.info(
    DIAG.PROJECT_LAYOUT_CONFLICT,
    `${PROJECT_FILE_NAME} \u89E3\u6790\u5931\u8D25\uFF0C\u5DF2\u56DE\u9000\u5230\u65E7\u7248\u5206\u6563\u6587\u4EF6`,
    loc
  );
  return readLegacy();
}
function loadProject(root, io, options = {}) {
  const bag = new DiagnosticBag();
  const storyNames = io.exists(STORY_DIR) ? pickScriptFiles(io.listFiles(STORY_DIR)) : [];
  const fromStory = storyNames.length > 0;
  const names = fromStory ? storyNames : pickScriptFiles(io.listFiles(""));
  const files = options.files ?? names.map((name) => fromStory ? `${STORY_DIR}/${name}` : name);
  if (files.length === 0) {
    bag.error(
      DIAG.PROJECT_FILE_MISSING,
      fromStory ? `\u9879\u76EE\u76EE\u5F55\u7684 ${STORY_DIR}/ \u4E0B\u6CA1\u6709\u5267\u672C\u6587\u4EF6\uFF08*.story.md / *.md\uFF09` : "\u9879\u76EE\u76EE\u5F55\u4E0B\u6CA1\u6709\u5267\u672C\u6587\u4EF6\uFF08*.story.md / *.md\uFF09",
      {
        file: root,
        line: 1,
        column: 1
      }
    );
  }
  const model = readProjectModel(io, bag);
  const states = model.states;
  const assetsText = io.readText("assets.json");
  let library;
  if (assetsText == null) {
    bag.info(DIAG.PROJECT_FILE_MISSING, "\u672A\u627E\u5230 assets.json\uFF0C\u6309\u7A7A\u7D20\u6750\u5E93\u5904\u7406", {
      file: "assets.json",
      line: 1,
      column: 1
    });
    library = loadLibrary("");
  } else {
    library = loadLibrary(assetsText);
  }
  const scripts = files.map((file) => {
    const source = io.readText(file) ?? "";
    return parseScript(source, { file, library, states });
  });
  const labels = {};
  for (const script of scripts) {
    bag.merge(script.diagnostics);
    for (const label of script.labels) {
      const existing = labels[label.id];
      if (existing) {
        bag.error(
          DIAG.LABEL_DUPLICATE_ID,
          `label ID "${label.id}" \u5728\u591A\u4E2A\u6587\u4EF6\u4E2D\u91CD\u590D\uFF08${existing.file} \u4E0E ${label.file}\uFF09\uFF0C\u8BF7\u91CD\u547D\u540D`,
          { file: label.file, line: label.line, column: 1 },
          { labelId: label.id }
        );
        continue;
      }
      labels[label.id] = label;
    }
  }
  attachMenuAnchors(labels, model.menus);
  const base = {
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
    diagnostics: []
  };
  base.diagnostics = [
    ...bag.list,
    ...validateProject(base),
    ...collectAssetDiagnostics(base.assets, io)
  ];
  return base;
}
function collectAssetNeeds(doc, file) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (need) => {
    const key = `${need.kind}:${need.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(need);
  };
  const target = (file ?? "").replace(/\\/g, "/").replace(/^\.?\//, "");
  const matchesFile = (labelFile) => {
    if (!target) return true;
    const labelPath = labelFile.replace(/\\/g, "/").replace(/^\.?\//, "");
    return labelPath === target || labelPath.endsWith(`/${target}`) || target.endsWith(`/${labelPath}`);
  };
  for (const label of Object.values(doc.labels)) {
    if (!matchesFile(label.file)) continue;
    for (const step of label.steps) {
      if (step.type !== "bg" && step.type !== "sprite" && step.type !== "bgm" && step.type !== "sfx" && step.type !== "item") {
        continue;
      }
      const asset = doc.assets.items[step.asset];
      const kind = asset?.kind === "sprite" ? "sprite" : asset?.kind === "audio" ? "audio" : "image";
      push({
        kind,
        name: asset?.name ?? step.asset,
        assetId: step.asset,
        from: step.type,
        labelId: label.id
      });
    }
  }
  return out;
}

// src/label-runtime.ts
var LabelRuntime = class {
  project;
  listeners = /* @__PURE__ */ new Set();
  stateById;
  maxRepeats;
  legacyFlags;
  /** 每个片段被进入的次数（判断是否走回头路） */
  visits = /* @__PURE__ */ new Map();
  /** 累计重复进入次数（循环保护） */
  repeatCount = 0;
  /** 本次进入片段后已处理过的菜单（任务/已选择），避免重复触发 */
  consumedMenus = /* @__PURE__ */ new Set();
  /** 本局已关闭的可跳过支线（支线片段里的选项离开本线时关闭） */
  closedPlotlines = /* @__PURE__ */ new Set();
  state;
  constructor(project, options = {}) {
    this.project = project;
    this.maxRepeats = options.maxRepeats ?? options.maxTransitions ?? 200;
    this.stateById = new Map(project.states.states.map((s) => [s.id, s]));
    this.legacyFlags = project.states.states.length === 0;
    this.state = {
      labelId: options.startLabel ?? project.orchestration.entry ?? "",
      stepIndex: 0,
      flags: this.initialFlags(),
      status: "idle",
      menu: null,
      path: [],
      log: [],
      transitions: 0,
      error: null
    };
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) fn(e);
  }
  initialFlags() {
    const flags = {};
    for (const def of this.project.states.states) flags[def.id] = def.initial;
    return flags;
  }
  /** 重开：清空状态与路径，回到入口/指定片段 */
  reset(startLabel) {
    this.visits.clear();
    this.repeatCount = 0;
    this.consumedMenus.clear();
    this.closedPlotlines.clear();
    this.state = {
      labelId: startLabel ?? this.project.orchestration.entry ?? "",
      stepIndex: 0,
      flags: this.initialFlags(),
      status: "idle",
      menu: null,
      path: [],
      log: [],
      transitions: 0,
      error: null
    };
    return this.enter(this.state.labelId);
  }
  /** 从入口（或指定片段）开始 */
  start(startLabel) {
    return this.reset(startLabel);
  }
  get label() {
    return this.project.labels[this.state.labelId];
  }
  enter(labelId) {
    const label = this.project.labels[labelId];
    if (!label) {
      this.fail(DIAG.RUNTIME_NO_LINK, `\u7247\u6BB5 "${labelId}" \u4E0D\u5B58\u5728`);
      return false;
    }
    const seen = this.visits.get(labelId) ?? 0;
    this.visits.set(labelId, seen + 1);
    if (this.state.labelId !== labelId || this.state.path.length > 0) {
      this.state.transitions += 1;
    }
    if (seen > 0) {
      this.repeatCount += 1;
      if (this.repeatCount > this.maxRepeats) {
        this.fail(
          DIAG.RUNTIME_LOOP_PROTECTION,
          `\u7247\u6BB5\u300C${label.name}\u300D\u91CD\u590D\u8FDB\u5165\u8D85\u8FC7 ${this.maxRepeats} \u6B21\uFF0C\u7591\u4F3C\u6B7B\u5FAA\u73AF`,
          { labelId, repeats: this.repeatCount }
        );
        return false;
      }
    }
    this.state.labelId = labelId;
    this.state.stepIndex = 0;
    this.state.menu = null;
    this.consumedMenus.clear();
    this.state.status = "playing";
    this.state.error = null;
    this.state.path.push(labelId);
    this.state.log.push(`\u25B6 ${label.name}\uFF08${label.file}:${label.line}\uFF09`);
    this.emit({ type: "label:enter", labelId, name: label.name, file: label.file });
    return true;
  }
  fail(code, message, data) {
    const diagnostic = { code, severity: "error", message, ...data ? { data } : {} };
    this.state.error = diagnostic;
    this.state.status = "error";
    this.state.log.push(`\u2717 ${message}`);
    this.emit({ type: "error", diagnostic });
    this.emit({ type: "end", reason: "error" });
  }
  /**
   * 推进一帧：
   *  - "step" 播放了一步
   *  - "pause" 遇到菜单，等待 choose
   *  - "finished" 流程结束
   *  - "idle" 未开始或已结束
   */
  stepOnce() {
    if (this.state.status === "idle") return "idle";
    if (this.state.status === "awaiting-menu") return "pause";
    if (this.state.status === "finished") return "finished";
    if (this.state.status === "error") return "idle";
    const label = this.label;
    if (!label) {
      this.fail(DIAG.RUNTIME_NO_LINK, `\u5F53\u524D\u7247\u6BB5 "${this.state.labelId}" \u4E0D\u5B58\u5728`);
      return "idle";
    }
    for (const menu of this.menusForLabel(label.id)) {
      if (this.consumedMenus.has(menu.id)) continue;
      if (this.menuPosition(menu, label) !== this.state.stepIndex) continue;
      this.consumedMenus.add(menu.id);
      return this.openMenu(menu, label) ? "pause" : "idle";
    }
    const step = label.steps[this.state.stepIndex];
    if (step) {
      const index = this.state.stepIndex;
      this.state.stepIndex += 1;
      this.emit({ type: "step", step, labelId: label.id, index });
      this.applyStep(step);
      return "step";
    }
    return this.exitLabel(label);
  }
  /**
   * 无菜单片段播完后的出口，优先级：
   *  1. 带条件的自动出口（作者显式配置的分支）
   *  2. 显式结束（end: true）
   *  3. 默认出口：按卡片顺序进入下一个片段
   *  4. 顺序末尾时，退回无条件连线（回环 / 跳转收尾）
   */
  exitLabel(label) {
    const links = this.project.orchestration.links.filter((l) => l.fromLabel === label.id);
    const conditional = this.pickLink(links.filter((l) => l.when));
    if (conditional) return this.followLink(conditional, `\u7247\u6BB5\u300C${label.name}\u300D\u6761\u4EF6\u51FA\u53E3`);
    const end = this.pickLink(links.filter((l) => l.end));
    if (end) return this.followLink(end, `\u7247\u6BB5\u300C${label.name}\u300D\u81EA\u52A8\u7ED3\u675F`);
    const { next, skipped } = nextEnterableLabel(
      this.project,
      label.id,
      (id) => this.isEnterableBySequence(id)
    );
    if (skipped.length) {
      const names = skipped.map((id) => `\u300C${this.project.labels[id]?.name ?? id}\u300D`).join("\u3001");
      this.state.log.push(`\u293C \u8DF3\u8FC7\u652F\u7EBF\u7247\u6BB5\uFF08\u672A\u8FDB\u5165\u6216\u5DF2\u5173\u95ED\uFF09\uFF1A${names}`);
    }
    if (next) {
      this.emit({ type: "path", from: label.id, to: next, reason: `\u7247\u6BB5\u300C${label.name}\u300D\u9ED8\u8BA4\u51FA\u53E3` });
      return this.enter(next) ? "step" : "idle";
    }
    const fallback = this.pickLink(links.filter((l) => !l.when && l.to));
    if (fallback) return this.followLink(fallback, `\u7247\u6BB5\u300C${label.name}\u300D\u81EA\u52A8\u51FA\u53E3`);
    this.fail(
      DIAG.RUNTIME_NO_EXIT,
      `\u7247\u6BB5\u300C${label.name}\u300D\u662F\u6700\u540E\u4E00\u4E2A\u7247\u6BB5\uFF0C\u6CA1\u6709\u53EF\u7528\u51FA\u53E3\uFF0C\u8BF7\u5728\u300C\u5267\u60C5\u7F16\u6392\u300D\u4E2D\u8BBE\u7F6E\u7ED3\u675F`,
      { labelId: label.id }
    );
    return "idle";
  }
  /** 某条线的片段 ID：`labelIds` 由加载器同步，缺失时按剧本归属现场推导 */
  labelIdsOfPlotline(owner) {
    if (owner.labelIds?.length) return owner.labelIds;
    return Object.values(this.project.labels).filter((l) => plotlineNameOfLabel(l) === owner.name).map((l) => l.id);
  }
  /**
   * 能否由「顺序出口」进入该片段。
   * 可跳过支线（`optional`）只有本局进入过它、且没被关闭时才继续；
   * 核心支线、主线、线索线不受影响。
   */
  isEnterableBySequence(labelId) {
    const owner = plotlineOfLabel(this.project, labelId);
    if (!owner || owner.kind !== "branch" || !owner.optional) return true;
    if (this.closedPlotlines.has(owner.id)) return false;
    return this.labelIdsOfPlotline(owner).some((id) => (this.visits.get(id) ?? 0) > 0);
  }
  /**
   * 支线片段里的剧情选项离开本线时关闭整条线。
   * 判据：当前片段属于可跳过支线，跳出菜单的结果连线指向本线之外（或结束）。
   * 只处理「选项结算」这条路径；片段播完后的自动出口走 `exitLabel`，
   * 因此「正常回主线」不会误关（同一支线在主线多处插入时仍可再次进入）。
   */
  closePlotlineIfDeclined(fromLabelId, link) {
    const owner = plotlineOfLabel(this.project, fromLabelId);
    if (!owner || owner.kind !== "branch" || !owner.optional) return;
    if (this.closedPlotlines.has(owner.id)) return;
    const targetOwner = link.end || !link.to ? void 0 : plotlineOfLabel(this.project, link.to);
    if (link.end || !link.to || targetOwner?.id !== owner.id) {
      this.closedPlotlines.add(owner.id);
      this.state.log.push(`\u293C \u652F\u7EBF\u300C${owner.name}\u300D\u5DF2\u5173\u95ED\uFF08\u9009\u9879\u79BB\u5F00\u672C\u7EBF\uFF09\uFF0C\u540E\u7EED\u7247\u6BB5\u5C06\u8DF3\u8FC7`);
    }
  }
  pickLink(links) {
    const usable = links.filter((l) => {
      if (!l.when) return true;
      try {
        return evalFlagCondition(l.when, this.state.flags);
      } catch {
        return false;
      }
    });
    return usable.find((l) => l.when) ?? usable[0];
  }
  followLink(link, reason) {
    if (link.end) {
      this.state.status = "finished";
      this.state.log.push("\u25C6 \u6D41\u7A0B\u7ED3\u675F");
      this.emit({ type: "end", reason: "explicit" });
      return "finished";
    }
    if (!link.to) {
      this.fail(DIAG.RUNTIME_NO_LINK, `\u8FDE\u7EBF "${link.id}" \u6CA1\u6709\u76EE\u6807\u7247\u6BB5`);
      return "idle";
    }
    const from = this.state.labelId;
    this.emit({ type: "path", from, to: link.to, reason });
    return this.enter(link.to) ? "step" : "idle";
  }
  /** 片段上挂载的玩家菜单（按项目菜单定义顺序；条件出口不是菜单，不参与） */
  menusForLabel(labelId) {
    return Object.values(this.project.menus.menus).filter(
      (m) => m.labelId === labelId && m.type === "choice"
    );
  }
  /** 菜单在片段内的触发位置：播放完前 index 步之后；缺省/越界按末尾处理 */
  menuPosition(menu, label) {
    const raw = menu.index ?? label.steps.length;
    return Math.max(0, Math.min(raw, label.steps.length));
  }
  /** 打开菜单（按条件过滤可用结果），返回是否成功暂停等待选择 */
  openMenu(menu, label) {
    this.consumedMenus.add(menu.id);
    const results = menuResults(menu).filter((r) => {
      if (!r.require) return true;
      try {
        return evalFlagCondition(r.require, this.state.flags);
      } catch {
        return false;
      }
    });
    const runtimeMenu = {
      menuId: menu.id,
      labelId: label.id,
      title: menu.title,
      type: menu.type,
      jump: menu.jump,
      results
    };
    if (results.length === 0) {
      this.fail(
        DIAG.RUNTIME_RESULT_INVALID,
        `\u83DC\u5355\u300C${menu.title}\u300D\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7ED3\u679C\uFF08\u6761\u4EF6\u90FD\u4E0D\u6EE1\u8DB3\u6216\u672A\u914D\u7F6E\uFF09`,
        { menuId: menu.id, labelId: label.id }
      );
      return false;
    }
    this.state.menu = runtimeMenu;
    this.state.status = "awaiting-menu";
    this.state.log.push(`\u25C8 \u83DC\u5355\uFF1A${menu.title}\uFF08${results.map((r) => r.text).join(" / ")}\uFF09`);
    this.emit({ type: "menu:open", menu: runtimeMenu });
    return true;
  }
  /** 选择剧情选项 / 模拟交互结果 */
  choose(resultId) {
    if (this.state.status !== "awaiting-menu" || !this.state.menu) return false;
    const menu = this.state.menu;
    const result = menu.results.find((r2) => r2.resultId === resultId);
    if (!result) {
      this.fail(DIAG.RUNTIME_RESULT_INVALID, `\u7ED3\u679C "${resultId}" \u4E0D\u5728\u83DC\u5355\u300C${menu.title}\u300D\u4E2D`, {
        menuId: menu.menuId,
        resultId
      });
      return false;
    }
    this.applyEffects(result.effects);
    this.emit({ type: "menu:resolved", menuId: menu.menuId, resultId });
    this.state.log.push(`\u25C7 ${menu.title} \u2192 ${result.text}`);
    if (menu.jump === "back") {
      this.state.menu = null;
      this.state.status = "playing";
      this.state.log.push(`\u21A9 \u56DE\u5230\u7247\u6BB5\u300C${this.label?.name ?? menu.labelId}\u300D\u7EE7\u7EED`);
      return true;
    }
    const links = this.project.orchestration.links.filter(
      (l) => l.fromMenu === menu.menuId && l.resultId === resultId
    );
    const link = this.pickLink(links);
    this.state.menu = null;
    this.state.status = "playing";
    if (!link) {
      this.fail(
        DIAG.RUNTIME_NO_LINK,
        `\u7ED3\u679C\u300C${result.text}\u300D\u8FD8\u6CA1\u6709\u8FDE\u63A5\u76EE\u6807\u7247\u6BB5\uFF0C\u8BF7\u5728\u300C\u5267\u60C5\u7F16\u6392\u300D\u4E2D\u8FDE\u7EBF`,
        { menuId: menu.menuId, resultId, labelId: menu.labelId }
      );
      return false;
    }
    this.closePlotlineIfDeclined(menu.labelId, link);
    const r = this.followLink(link, `\u83DC\u5355\u300C${menu.title}\u300D\u7ED3\u679C ${result.text}`);
    return r !== "idle";
  }
  /** 应用一组状态效果（类型校验 + 数值收敛） */
  applyEffects(effects) {
    if (!effects || effects.length === 0) return;
    for (const effect of effects) {
      const def = this.stateById.get(effect.stateId);
      if (!def) {
        if (this.legacyFlags) {
          this.setFlag(effect.stateId, effect.value);
          continue;
        }
        this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001 "${effect.stateId}" \u672A\u5B9A\u4E49`, {
          stateId: effect.stateId
        });
        return;
      }
      const current = this.state.flags[effect.stateId];
      let next;
      if (effect.op === "add" || effect.op === "sub") {
        if (def.type !== "number") {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001\u300C${def.name}\u300D\u4E0D\u662F\u6570\u503C\u7C7B\u578B\uFF0C\u4E0D\u80FD\u7528\u52A0\u51CF`, {
            stateId: def.id
          });
          return;
        }
        const delta = Number(effect.value);
        if (!Number.isFinite(delta)) {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001\u300C${def.name}\u300D\u7684\u52A0\u51CF\u503C\u4E0D\u662F\u6570\u5B57`, {
            stateId: def.id
          });
          return;
        }
        next = (Number(current) || 0) + (effect.op === "add" ? delta : -delta);
      } else {
        next = effect.value;
      }
      if (def.type === "number" && typeof next === "number") {
        const value = next;
        next = Math.min(Math.max(value, def.min ?? -Infinity), def.max ?? Infinity);
      }
      if (def.type === "boolean" && typeof next !== "boolean") {
        this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001\u300C${def.name}\u300D\u9700\u8981\u5E03\u5C14\u503C`, { stateId: def.id });
        return;
      }
      if (def.type === "string" && typeof next !== "string") {
        this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001\u300C${def.name}\u300D\u9700\u8981\u5B57\u7B26\u4E32`, { stateId: def.id });
        return;
      }
      if (def.type === "enum") {
        const options = def.options ?? [];
        if (typeof next !== "string" || !options.includes(next)) {
          this.fail(
            DIAG.RUNTIME_STATE_ERROR,
            `\u72B6\u6001\u300C${def.name}\u300D\u53EA\u80FD\u53D6\u4E0B\u62C9\u5217\u8868\u4E2D\u7684\u503C\uFF1A${options.join(" / ")}`,
            { stateId: def.id }
          );
          return;
        }
      }
      this.setFlag(def.id, next);
    }
  }
  setFlag(stateId, value) {
    const previous = this.state.flags[stateId];
    this.state.flags[stateId] = value;
    const name = this.stateById.get(stateId)?.name ?? stateId;
    this.state.log.push(`\u2699 ${name} = ${JSON.stringify(value)}`);
    this.emit({ type: "state:change", stateId, value, previous });
  }
  /** 步骤副作用：@flag / @task 槽位（其它步骤仅供展示） */
  applyStep(step) {
    if (step.type === "flag") {
      const op = step.op ?? "set";
      if (op === "set") {
        if (!this.stateById.has(step.key) && !this.legacyFlags) {
          this.fail(DIAG.RUNTIME_STATE_ERROR, `\u72B6\u6001 "${step.key}" \u672A\u5B9A\u4E49`, { stateId: step.key });
          return;
        }
        this.applyEffects([{ stateId: step.key, op: "set", value: step.value }]);
        return;
      }
      this.applyEffects([{ stateId: step.key, op, value: step.value }]);
      return;
    }
    if (step.type === "task") {
      this.state.log.push(`\u2691 \u4EFB\u52A1\uFF1A${step.description ?? step.taskId}`);
    }
  }
};

// src/parser.ts
var IdGen = class {
  counters = /* @__PURE__ */ new Map();
  next(prefix) {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
};
function slug(s) {
  return s.replace(/[^\w\u4e00-\u9fa5]/g, "").replace(/\s+/g, "").slice(0, 12);
}
var ASSET_KIND_MAP = {
  "bg": { kind: "image", stepType: "bg" },
  "bgm": { kind: "audio", stepType: "bgm" },
  "sfx": { kind: "audio", stepType: "sfx" },
  "sprite": { kind: "sprite", stepType: "sprite" }
};
function parseDirective(body, idGen, lib) {
  const m0 = body.match(/^@(\w+)(?:\s+(.*))?$/);
  if (!m0) {
    throw new Error(`\u65E0\u6CD5\u89E3\u6790\u6307\u4EE4\uFF08\u5E94\u4E3A @name \u53C2\u6570 \u5F62\u5F0F\uFF09: "${body}"`);
  }
  const name = m0[1];
  const args = (m0[2] ?? "").trim();
  switch (name) {
    case "sprite": {
      const spriteM = args.match(/^(\S+)(?:\s+([^()\s]+(?:\/[^()\s]+)*))?$/);
      if (!spriteM) {
        throw new Error(`\u65E0\u6CD5\u89E3\u6790 sprite \u6307\u4EE4: "${body}"`);
      }
      const [, charName, optsRaw] = spriteM;
      const [pose, position] = optsRaw ? optsRaw.split("/") : [void 0, void 0];
      const assetId = resolveAsset(lib, charName, "sprite");
      return {
        step: {
          type: "sprite",
          channel: "sprite",
          asset: assetId,
          pose: pose?.trim() || void 0,
          position: position?.trim() || void 0,
          enter: true
        }
      };
    }
    case "effect": {
      if (!args) throw new Error(`effect \u6307\u4EE4\u7F3A\u5C11\u7279\u6548\u540D: "${body}"`);
      return { step: { type: "effect", channel: "fx", effect: args } };
    }
    case "flag": {
      const flagM = args.match(/^([\w\u4e00-\u9fa5]+)\s*=\s*(.+)$/);
      if (!flagM) {
        throw new Error(`\u65E0\u6CD5\u89E3\u6790 flag \u6307\u4EE4\uFF08\u5E94\u4E3A \u952E=\u503C\uFF09: "${body}"`);
      }
      const [, key, rawVal] = flagM;
      let value = rawVal.trim();
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
      return { step: { type: "flag", key, value } };
    }
    case "task": {
      if (!args) throw new Error(`task \u6307\u4EE4\u7F3A\u5C11\u4EFB\u52A1\u63CF\u8FF0: "${body}"`);
      return { step: { type: "task", taskId: slug(args), description: args, status: "active" } };
    }
    case "vo": {
      if (!args) throw new Error(`vo \u6307\u4EE4\u7F3A\u5C11\u65C1\u767D\u5185\u5BB9: "${body}"`);
      return { step: { type: "narration", channel: "vo", text: args } };
    }
    default: {
      const map = ASSET_KIND_MAP[name];
      if (!map) {
        throw new Error(`\u672A\u77E5\u6307\u4EE4\u7C7B\u578B: "@${name}"`);
      }
      const resM = args.match(/^(.+?)(?:\(([^)]*)\))?$/);
      if (!resM || !resM[1].trim()) {
        throw new Error(`\u65E0\u6CD5\u89E3\u6790\u8D44\u6E90\u6307\u4EE4: "${body}"`);
      }
      const assetName = resM[1].trim();
      const paramsRaw = resM[2];
      const assetId = resolveAsset(lib, assetName, map.kind);
      let step;
      if (map.stepType === "bgm") {
        const fade = paramsRaw ? parseFade2(paramsRaw) : void 0;
        step = { type: "bgm", channel: "bgm", asset: assetId, fade };
      } else if (map.stepType === "sfx") {
        step = { type: "sfx", channel: "sfx", asset: assetId };
      } else {
        const transition = paramsRaw ? `fade_in_${parseFade2(paramsRaw)}s` : void 0;
        step = { type: "bg", channel: "bg", asset: assetId, transition };
      }
      return { step };
    }
  }
}
function parseFade2(params) {
  const m = params.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 2;
}
function parseDSL(source, meta, library) {
  const idGen = new IdGen();
  const lines = source.split(/\r?\n/);
  const nodes = {};
  const steps = {};
  const choices = {};
  const lib = library ?? createLibrary();
  let currentAct = null;
  let currentChapter = null;
  let currentScene = null;
  const sceneByTitle = /* @__PURE__ */ new Map();
  const flushScene = () => {
    currentScene = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("### ")) {
      const title = line.slice(4).trim();
      sceneByTitle.set(title, sceneIdOf(title));
    }
  }
  function sceneIdOf(title) {
    return `sc_${slug(title)}`;
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flushScene();
      const title = line.slice(2).trim();
      const act = {
        id: `act_${idGen.next("act")}`,
        type: "act",
        title,
        children: []
      };
      nodes[act.id] = act;
      currentAct = act;
      currentChapter = null;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flushScene();
      const title = line.slice(3).trim();
      const chapter = {
        id: `ch_${idGen.next("ch")}`,
        type: "chapter",
        title,
        children: []
      };
      nodes[chapter.id] = chapter;
      if (currentAct) currentAct.children.push(chapter.id);
      currentChapter = chapter;
      continue;
    }
    if (line.startsWith("### ")) {
      flushScene();
      const title = line.slice(4).trim();
      const scene = {
        id: sceneIdOf(title),
        type: "scene",
        title,
        children: []
      };
      nodes[scene.id] = scene;
      if (currentChapter) currentChapter.children.push(scene.id);
      currentScene = scene;
      continue;
    }
    if (line.startsWith("- ")) {
      if (!currentScene) {
        throw new Error(`\u9009\u9879\u5FC5\u987B\u5728\u573A\u666F\u5185\u5B9A\u4E49: "${line}"`);
      }
      const body = line.slice(2).trim();
      const choice = parseChoice(body, sceneByTitle, nodes);
      if (!choices[currentScene.id]) choices[currentScene.id] = [];
      choices[currentScene.id].push(choice);
      continue;
    }
    if (line.startsWith("@")) {
      if (!currentScene) {
        throw new Error(`\u6307\u4EE4\u5FC5\u987B\u5728\u573A\u666F\u5185\u5B9A\u4E49: "${line}"`);
      }
      const { step } = parseDirective(line, idGen, lib);
      const sid = `st_${idGen.next("st")}`;
      steps[sid] = step;
      currentScene.children.push(sid);
      continue;
    }
    const dialogMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (dialogMatch && currentScene) {
      const [, speaker, text] = dialogMatch;
      const sid = `st_${idGen.next("st")}`;
      steps[sid] = { type: "dialog", channel: "say", speaker: speaker.trim(), text: text.trim() };
      currentScene.children.push(sid);
      continue;
    }
  }
  const firstScene = Object.values(nodes).find((n) => n.type === "scene");
  if (!firstScene) {
    throw new Error("\u5267\u672C\u4E2D\u6CA1\u6709\u5B9A\u4E49\u4EFB\u4F55\u573A\u666F");
  }
  return {
    meta: { title: "\u672A\u547D\u540D\u5267\u672C", version: 1, ...meta ?? {} },
    nodes,
    steps,
    assets: lib.data.items,
    choices,
    entry: firstScene.id
  };
}
function parseChoice(body, sceneByTitle, nodes) {
  const condMatch = body.match(/\((.+?)[:：]\s*(.+?)\)$/);
  let require2;
  let main = body;
  if (condMatch) {
    require2 = condMatch[2].trim();
    main = body.slice(0, condMatch.index).trim();
  }
  const m = main.match(/^(.+?)\s*→\s*(?:跳转\s*)?(.+)$/);
  if (!m) {
    throw new Error(`\u9009\u9879\u683C\u5F0F\u9519\u8BEF\uFF08\u9700\u542B "\u2192 \u8DF3\u8F6C \u76EE\u6807"\uFF09: "${body}"`);
  }
  const text = m[1].trim();
  const targetRaw = m[2].trim();
  let goto;
  if (nodes[targetRaw]) {
    goto = targetRaw;
  } else if (sceneByTitle.has(targetRaw)) {
    goto = sceneByTitle.get(targetRaw);
  } else {
    goto = resolveTarget(targetRaw, sceneByTitle, nodes);
  }
  return { text, goto, require: require2 };
}
function resolveTarget(raw, sceneByTitle, nodes) {
  if (nodes[raw]) return raw;
  if (sceneByTitle.has(raw)) return sceneByTitle.get(raw);
  const segs = raw.split(/[·.、:：]/).map((s) => s.trim()).filter(Boolean);
  if (segs.length > 1) {
    const last = segs[segs.length - 1];
    if (sceneByTitle.has(last)) return sceneByTitle.get(last);
    const sceneNo = last.replace(/^场景/, "");
    for (const [title, id] of sceneByTitle) {
      if (title === sceneNo || title.replace(/^场景/, "") === sceneNo) return id;
    }
  }
  for (const [title, id] of sceneByTitle) {
    if (title.includes(raw) || raw.includes(title)) return id;
  }
  throw new Error(`\u65E0\u6CD5\u89E3\u6790\u8DF3\u8F6C\u76EE\u6807: "${raw}"\uFF08\u573A\u666F\u6807\u9898\u6216 id \u4E0D\u5B58\u5728\uFF09`);
}

// src/engine.ts
function evalCondition(expr, flags) {
  const trimmed = expr.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const m = trimmed.match(/^flag\(\s*['"]([^'"]+)['"]\s*\)\s*(===|!==|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    throw new Error(`\u65E0\u6CD5\u89E3\u6790\u6761\u4EF6\u8868\u8FBE\u5F0F: "${expr}"`);
  }
  const [, key, op, rawValue] = m;
  const actual = flags[key];
  let expected = rawValue.trim();
  if (expected === "true") expected = true;
  else if (expected === "false") expected = false;
  else if (/^-?\d+(\.\d+)?$/.test(expected)) expected = Number(expected);
  else expected = expected.replace(/^['"]|['"]$/g, "");
  switch (op) {
    case "===":
      return actual === expected;
    case "!==":
      return actual !== expected;
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
  }
  return false;
}
var StoryEngine = class {
  skeleton;
  /** 场景 id → 该场景的步骤 id 顺序列表（预解析，加速播放） */
  sceneSteps = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  state;
  constructor(skeleton) {
    this.skeleton = skeleton;
    this.state = {
      sceneId: "",
      stepIndex: 0,
      flags: {},
      task: null,
      finished: false,
      history: [],
      pendingStepIds: [],
      choicesPresented: false
    };
    this.indexScenes();
  }
  /** 校验 + 建立场景→步骤索引 */
  indexScenes() {
    const { nodes, steps } = this.skeleton;
    for (const node of Object.values(nodes)) {
      if (node.type !== "scene") continue;
      const ids = node.children;
      for (const sid of ids) {
        if (!steps[sid]) {
          throw new Error(`\u573A\u666F "${node.id}" \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6B65\u9AA4 "${sid}"`);
        }
      }
      this.sceneSteps.set(node.id, ids);
    }
    if (!this.skeleton.nodes[this.skeleton.entry]) {
      throw new Error(`\u5165\u53E3\u573A\u666F "${this.skeleton.entry}" \u4E0D\u5B58\u5728`);
    }
  }
  /** 订阅事件 */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) fn(e);
  }
  /** 启动：进入入口场景 */
  start() {
    this.enterScene(this.skeleton.entry);
  }
  /** 解析场景引用：优先精确 id，回退到按标题匹配 */
  resolveSceneId(ref) {
    const { nodes } = this.skeleton;
    if (nodes[ref]) return ref;
    for (const n of Object.values(nodes)) {
      if (n.type === "scene" && (n.title === ref || n.title.includes(ref) || ref.includes(n.title))) {
        return n.id;
      }
    }
    return null;
  }
  /** 进入指定场景。
   * @param sceneId 场景 id 或标题
   * @param startStepIndex 从该场景第几个步骤开始（编辑器"点击某步骤"跳转）
   * @param autoPlay true = 同步一次性播完该场景（默认，兼容旧行为）；false = 仅进入场景，
   *                 由调用方通过 nextStep() 逐步推进（顺序播放用）
   */
  enterScene(sceneId, startStepIndex = 0, autoPlay = true) {
    const resolved = this.resolveSceneId(sceneId);
    if (!resolved) {
      throw new Error(`\u573A\u666F "${sceneId}" \u4E0D\u5B58\u5728\u6216\u4E0D\u662F scene`);
    }
    const node = this.skeleton.nodes[resolved];
    if (!node || node.type !== "scene") {
      throw new Error(`\u573A\u666F "${sceneId}" \u4E0D\u5B58\u5728\u6216\u4E0D\u662F scene`);
    }
    this.state.sceneId = resolved;
    this.state.stepIndex = startStepIndex;
    this.state.history.push(resolved);
    this.state.choicesPresented = false;
    this.state.pendingStepIds = (this.sceneSteps.get(resolved) ?? []).slice(startStepIndex);
    this.emit({ type: "scene:enter", sceneId: resolved, title: node.title });
    if (!autoPlay) return;
    while (this.nextStep() === "step") {
    }
  }
  /**
   * 播放下一步（分步播放核心）。
   * @returns "step" = 已播一步、可能还有后续；"choices" = 本场景步骤播完、已呈现选项；
   *          "end" = 已结束；"none" = 无更多可播（已结束或已呈现选项）
   */
  nextStep() {
    if (this.state.finished) return "none";
    if (this.state.pendingStepIds.length === 0) {
      if (!this.state.choicesPresented) {
        this.presentChoices(this.state.sceneId);
      }
      return this.state.finished ? "end" : "choices";
    }
    const sid = this.state.pendingStepIds.shift();
    const step = this.skeleton.steps[sid];
    const sceneBefore = this.state.sceneId;
    this.state.stepIndex += 1;
    this.emit({ type: "step", step, sceneId: this.state.sceneId, stepIndex: this.state.stepIndex - 1 });
    this.applyStep(step);
    if (this.state.sceneId !== sceneBefore) {
      if (this.state.pendingStepIds.length > 0) return "step";
      if (!this.state.choicesPresented) this.presentChoices(this.state.sceneId);
      return this.state.finished ? "end" : "choices";
    }
    if (this.state.pendingStepIds.length === 0) {
      if (!this.state.choicesPresented) this.presentChoices(this.state.sceneId);
      return this.state.finished ? "end" : "choices";
    }
    return "step";
  }
  /** 应用一个步骤的副作用（flag/task/branch） */
  applyStep(step) {
    switch (step.type) {
      case "flag": {
        this.state.flags[step.key] = step.value;
        break;
      }
      case "task": {
        const task = {
          taskId: step.taskId,
          description: step.description,
          status: step.status ?? "active",
          setAtScene: this.state.sceneId
        };
        this.state.task = task;
        this.emit({ type: "task:set", task });
        break;
      }
      case "branch": {
        const ok = evalCondition(step.condition, this.state.flags);
        const target = ok ? step.gotoIfTrue : step.gotoIfFalse;
        if (target) {
          this.enterScene(target);
        }
        break;
      }
      default:
        break;
    }
  }
  /** 呈现当前场景的选项（结局定义器） */
  presentChoices(sceneId) {
    this.state.choicesPresented = true;
    const choices = this.skeleton.choices[sceneId];
    if (!choices || choices.length === 0) {
      this.finish("no_choices");
      return;
    }
    const available = choices.filter((c) => {
      if (!c.require) return true;
      try {
        return evalCondition(c.require, this.state.flags);
      } catch {
        return false;
      }
    });
    if (available.length === 0) {
      this.finish("no_choices");
      return;
    }
    this.emit({ type: "choice:present", choices: available });
  }
  /** 玩家做出选择 */
  choose(choice, autoPlay = true) {
    if (choice.setFlags) {
      Object.assign(this.state.flags, choice.setFlags);
    }
    if (choice.goto) {
      this.enterScene(choice.goto, 0, autoPlay);
    } else if (choice.retry) {
      this.enterScene(this.state.sceneId, 0, autoPlay);
    } else {
      this.finish("no_choices");
    }
  }
  finish(reason) {
    this.state.finished = true;
    this.emit({ type: "end", reason });
  }
  /** 获取某场景的全部选项（编辑器可视化用） */
  getChoices(sceneId) {
    return this.skeleton.choices[sceneId] ?? [];
  }
  /** 获取骨架包（只读访问） */
  getSkeleton() {
    return this.skeleton;
  }
  /** 获取所有场景节点（编辑器可视化用） */
  getSceneNodes() {
    return Object.values(this.skeleton.nodes).filter((n) => n.type === "scene");
  }
  /** 获取某场景的步骤 id 顺序列表（编辑器右侧步骤面板用） */
  getSceneStepIds(sceneId) {
    return this.sceneSteps.get(sceneId) ?? [];
  }
};

// src/script-format.ts
var QUOTE_PAIRS2 = [
  ["\u201C", "\u201D"],
  ["\u300C", "\u300D"],
  ["\u300E", "\u300F"],
  ['"', '"'],
  ["'", "'"]
];
function oneLine(text) {
  return text.replace(/[\r\n]+/g, " ").trim();
}
function quoteSpeaker(name) {
  const n = oneLine(name).replace(/^#+/, "");
  if (!n) return n;
  if (!/\s/.test(n)) return n;
  for (const [open, close] of QUOTE_PAIRS2) {
    if (!n.includes(open) && !n.includes(close)) return `${open}${n}${close}`;
  }
  return n;
}
function formatLabelHeader(spec) {
  const parts = [`@plot ${oneLine(spec.id)}`];
  const name = oneLine(spec.name ?? "").replace(/\s+[#$]/g, " ");
  if (name) parts.push(name);
  const plotline = oneLine(spec.plotline ?? "");
  if (plotline) parts.push(`#${plotline}`);
  const position = oneLine(spec.position ?? "");
  if (position) parts.push(`$${position}`);
  return parts.join(" ");
}
function formatActorLine(speaker, channel, text) {
  if (channel === "sprite") return formatSpriteLine(speaker);
  return `@actor ${quoteSpeaker(speaker)} #${channel} ${oneLine(text)}`;
}
function formatSpriteLine(speaker, pose, position) {
  const p = oneLine(pose ?? "").replace(/[\s/]/g, "");
  const pos = oneLine(position ?? "").replace(/[\s/]/g, "");
  const body = p && pos ? `${p}/${pos}` : p ? p : pos ? `/${pos}` : "";
  const head = `@actor ${quoteSpeaker(speaker)} #sprite`;
  return body ? `${head} ${body}` : head;
}
function formatNarrLine(channel, body) {
  return `@narr #${channel} ${oneLine(body)}`;
}
function formatAssetLine(channel, assetName, params = {}) {
  const name = oneLine(assetName);
  let suffix = "";
  if (channel === "bg") {
    const m = params.transition?.match(/(\d+(?:\.\d+)?)/);
    if (m) suffix = `(${m[1]}\u79D2)`;
  } else if (channel === "bgm" && params.fade != null) {
    suffix = `(${params.fade}\u79D2)`;
  }
  return `@narr #${channel} ${name}${suffix}`;
}
function formatFlagLine(key, op, rawValue) {
  const symbol = op === "add" || op === "+=" ? "+=" : op === "sub" || op === "-=" ? "-=" : "=";
  return `@flag ${oneLine(key)}${symbol}${oneLine(rawValue)}`;
}
function formatLiteral(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = value == null ? "" : String(value);
  const ambiguous = text === "true" || text === "false" || /^-?\d+(\.\d+)?$/.test(text);
  if (ambiguous) return text.includes("'") ? `"${text}"` : `'${text}'`;
  if (!text.trim()) return "''";
  return text;
}
function formatStep(step, resolveAssetName) {
  switch (step.type) {
    case "bg":
      return formatAssetLine(
        "bg",
        resolveAssetName(step.asset),
        step.transition ? { transition: step.transition } : {}
      );
    case "bgm":
      return formatAssetLine(
        "bgm",
        resolveAssetName(step.asset),
        step.fade != null ? { fade: step.fade } : {}
      );
    case "sfx":
      return formatAssetLine("sfx", resolveAssetName(step.asset));
    case "item":
      return formatAssetLine("item", resolveAssetName(step.asset));
    case "sprite":
      return formatSpriteLine(resolveAssetName(step.asset), step.pose, step.position);
    case "dialog":
      return formatActorLine(step.speaker, step.channel, step.text);
    case "narration":
      return step.channel === "act" && step.speaker ? formatActorLine(step.speaker, "act", step.text) : formatNarrLine("vo", step.text);
    case "effect":
      return formatNarrLine("fx", step.effect);
    case "flag":
      return formatFlagLine(step.key, step.op ?? "set", formatLiteral(step.value));
    default:
      return "";
  }
}

// src/api.ts
function openProject(root, io, options = {}) {
  return toStoryProject(loadProject(root, io, options));
}
function openProjectFromSnapshot(root, snapshot) {
  return openProject(root, snapshotIO(snapshot));
}
function snapshotIO(snapshot) {
  const norm = (rel) => rel.replace(/^[\\/]+|[\\/]+$/g, "").replace(/\\/g, "/");
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
      return snapshot.files.filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/")).map((f) => f.slice(prefix.length)).sort();
    },
    listDirs(relDir) {
      const dir = norm(relDir);
      const prefix = dir ? `${dir}/` : "";
      return snapshot.dirs.filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/")).map((d) => d.slice(prefix.length)).sort();
    }
  };
}
function saveProject(target) {
  const doc = asDoc(target);
  return {
    projectJson: serializeProjectBundle(doc),
    assetsJson: serializeLibrary({ data: doc.assets, nameIndex: /* @__PURE__ */ new Map() })
  };
}
function revalidate(target) {
  const doc = asDoc(target);
  const merged = [...baseIssuesOf(doc), ...validateProject(doc)];
  return writeIssues(target, doc, merged);
}
function refreshIssues(target, io) {
  const doc = asDoc(target);
  const fresh = loadProject(doc.root || "", io);
  const merged = [...baseIssuesOf(fresh), ...validateProject(doc)];
  return writeIssues(target, doc, merged);
}
function resyncLinks(target) {
  const doc = asDoc(target);
  doc.orchestration.links = deriveConditionLinks(doc.menus, doc.orchestration).links;
}
function nextLabelOf(target, labelId) {
  return nextLabelId(asDoc(target), labelId);
}
function hasMenuExit2(target, labelId) {
  return hasMenuExit(asDoc(target), labelId);
}
function menuOptions(menu) {
  return menuResults(menu);
}
function labelsOf(target) {
  const doc = asDoc(target);
  return labelPlayOrder(doc).map(toLabelInfo);
}
function plotlineOfLabel2(target, labelId) {
  return plotlineOfLabel(asDoc(target), labelId) ?? null;
}
function syncPlotlines(target) {
  const doc = asDoc(target);
  doc.plotlines = syncPlotlinesFromLabels(doc.labels, doc.plotlines);
}
function buildFlagCondition(stateId, op, rawValue, type) {
  const raw = rawValue.trim();
  if (type === "number" || type === "boolean") {
    const value = raw || (type === "boolean" ? "true" : "0");
    return `flag('${stateId}') ${op} ${value}`;
  }
  return `flag('${stateId}') ${op} '${raw.replace(/'/g, "\\'")}'`;
}
function createEmptyProject(options = {}) {
  const doc = {
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
    diagnostics: []
  };
  return {
    projectJson: serializeProjectBundle(doc),
    assetsJson: serializeLibrary({ data: doc.assets, nameIndex: /* @__PURE__ */ new Map() })
  };
}
function createPlayer(target, options = {}) {
  const doc = asDoc(target);
  const runtimeOptions = {
    ...options.startLabel ? { startLabel: options.startLabel } : {},
    ...options.maxRepeats != null ? { maxRepeats: options.maxRepeats } : {}
  };
  const runtime = new LabelRuntime(doc, runtimeOptions);
  const listeners = /* @__PURE__ */ new Set();
  const stateNames = new Map(doc.states.states.map((s) => [s.id, s.name]));
  let lastCue = null;
  const emit = (e) => {
    for (const fn of listeners) fn(e);
  };
  const toMenu = (menu) => ({
    menuId: menu.menuId,
    labelId: menu.labelId,
    title: menu.title,
    jump: menu.jump,
    options: menu.results.map((r) => ({ ...r }))
  });
  runtime.subscribe((e) => {
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
          previous: e.previous
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
        break;
    }
  });
  const next = () => {
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
    advance() {
      const result = next();
      const cue = lastCue ?? void 0;
      lastCue = null;
      return cue ? { result, cue } : { result };
    },
    choose(resultId) {
      return runtime.choose(resultId);
    },
    snapshot() {
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
        error: s.error ? { code: s.error.code, message: s.error.message } : null
      };
    }
  };
}
function describeStep(target, step, labelId = "", index = -1) {
  return buildCue(asDoc(target), step, labelId, index);
}
function collectAssets(target, file) {
  const doc = asDoc(target);
  return collectAssetNeeds(doc, file).map((n) => ({
    ...n,
    path: doc.assets.items[n.assetId]?.path ?? ""
  }));
}
function assetsOf(target) {
  return Object.values(asDoc(target).assets.items).filter((a) => Boolean(a && a.id)).sort((a, b) => a.id.localeCompare(b.id)).map((a) => ({ id: a.id, name: a.name, kind: a.kind, path: a.path }));
}
function assetOf(target, assetId) {
  const a = asDoc(target).assets.items[assetId];
  return a ? { id: a.id, name: a.name, kind: a.kind, path: a.path } : null;
}
function ensureAsset(target, name, kind, path) {
  const doc = asDoc(target);
  for (const [id2, a] of Object.entries(doc.assets.items)) {
    if (a && a.kind === kind && a.name === name) return id2;
  }
  const id = `res_${String(doc.assets.nextId).padStart(4, "0")}`;
  doc.assets.nextId += 1;
  const dir = kind === "sprite" ? "characters" : kind === "audio" ? "audio" : "scenes";
  doc.assets.items[id] = {
    id,
    kind,
    name,
    path: path ?? `assets/${dir}/${name}`
  };
  return id;
}
function setAssetPath(target, assetId, path) {
  const item = asDoc(target).assets.items[assetId];
  if (!item) return false;
  item.path = path;
  return true;
}
function setAssetName(target, assetId, name) {
  const item = asDoc(target).assets.items[assetId];
  if (!item) return false;
  item.name = name;
  return true;
}
function isStoryProject(v) {
  return typeof v.ok === "boolean" && !!v.doc;
}
function asDoc(target) {
  return isStoryProject(target) ? target.doc : target;
}
function baseIssuesOf(doc) {
  return doc.diagnostics.filter((d) => !isLocalDiagnostic(d.code));
}
function writeIssues(target, doc, merged) {
  doc.diagnostics = merged;
  const issues = merged.map(toIssue);
  if (isStoryProject(target)) target.diagnostics = issues;
  return issues;
}
function toStoryProject(doc) {
  const ordered = labelPlayOrder(doc);
  const labelName = (id) => doc.labels[id]?.name ?? id;
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
      ...s.min != null ? { min: s.min } : {},
      ...s.max != null ? { max: s.max } : {},
      ...s.options ? { options: [...s.options] } : {}
    })),
    plotlines: (doc.plotlines.plotlines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      ...p.type ? { type: p.type } : {},
      ...p.optional ? { optional: true } : {}
    })),
    menus: Object.values(doc.menus.menus).filter((m) => m.type === "choice").map((m) => ({
      id: m.id,
      title: m.title,
      labelId: m.labelId,
      labelName: labelName(m.labelId),
      index: m.index ?? doc.labels[m.labelId]?.steps.length ?? 0,
      jump: m.jump,
      options: menuResults(m)
    })),
    assets: Object.entries(doc.assets.items).map(([id, a]) => ({
      id,
      name: a.name,
      kind: a.kind,
      path: a.path
    })),
    diagnostics: doc.diagnostics.map(toIssue),
    doc
  };
}
function toLabelInfo(label) {
  return {
    id: label.id,
    name: label.name,
    file: label.file,
    line: label.line,
    plotline: (label.plotline ?? "").trim() || "\u4E3B\u7EBF",
    ...label.position ? { position: label.position } : {},
    stepCount: label.steps.length
  };
}
function toIssue(d) {
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...d.source ? { source: d.source } : {},
    ...d.file ? { file: d.file } : {},
    ...d.line != null ? { line: d.line } : {}
  };
}
function buildCue(doc, step, labelId, index) {
  const base = { labelId, index, raw: step };
  const assetId = "asset" in step ? step.asset : void 0;
  const asset = assetId ? doc.assets.items[assetId] : void 0;
  const assetFields = asset ? { assetId: asset.id, assetName: asset.name, assetPath: asset.path } : assetId ? { assetId, assetName: assetId, assetPath: "" } : {};
  if (step.type === "flag") {
    return {
      ...base,
      kind: "state",
      stateKey: step.key,
      stateValue: step.value
    };
  }
  if (step.type === "task") {
    return {
      ...base,
      kind: "task",
      taskId: step.taskId,
      text: step.description ?? step.taskId
    };
  }
  switch (step.type) {
    case "bg":
      return {
        ...base,
        kind: "bg",
        ...assetFields,
        ...step.transition ? { transition: step.transition } : {}
      };
    case "sprite":
      return {
        ...base,
        kind: "sprite",
        ...assetFields,
        ...step.pose ? { pose: step.pose } : {},
        position: step.position ?? "left",
        ...step.enter != null ? { enter: step.enter } : {}
      };
    case "bgm":
      return {
        ...base,
        kind: "bgm",
        ...assetFields,
        ...step.fade != null ? { fade: step.fade } : {}
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
        ...step.params ? { params: step.params } : {}
      };
    case "dialog":
      return {
        ...base,
        kind: stepChannel(step) === "inner" ? "inner" : "say",
        speaker: step.speaker,
        text: step.text
      };
    case "narration":
      return {
        ...base,
        kind: stepChannel(step) === "act" ? "act" : "vo",
        ...step.speaker ? { speaker: step.speaker } : {},
        text: step.text
      };
    default:
      return { ...base, kind: "vo", text: "" };
  }
}
export {
  LABEL_POSITIONS,
  LEGACY_PROJECT_FILES,
  PLOTLINE_TIER_NAME,
  PLOTLINE_TYPES,
  PROJECT_FILE_NAME,
  SCRIPT_EXTENSIONS,
  STORY_DIR,
  StoryEngine,
  assetDisplayName,
  assetOf,
  assetsOf,
  bindAssetPath,
  buildFlagCondition,
  collectAssets,
  createEmptyProject,
  createLibrary,
  createPlayer,
  describeStep,
  diagnosticSource,
  ensureAsset,
  formatActorLine,
  formatAssetLine,
  formatFlagLine,
  formatLabelHeader,
  formatLiteral,
  formatNarrLine,
  formatSpriteLine,
  formatStep,
  hasMenuExit2 as hasMenuExit,
  isActorChannel,
  isLocalDiagnostic,
  isNarrChannel,
  labelList,
  labelsOf,
  loadLibrary,
  makeLabelId,
  makeMenuId,
  makePlotlineId,
  makeResultId,
  makeStateId,
  menuOptions,
  nextLabelOf,
  openProject,
  openProjectFromSnapshot,
  parseDSL,
  plotlineOfLabel2 as plotlineOfLabel,
  quoteSpeaker,
  rebuildIndex,
  refreshIssues,
  renameAsset,
  resolveAsset,
  resyncLinks,
  revalidate,
  saveProject,
  serializeLibrary,
  setAssetName,
  setAssetPath,
  snapshotIO,
  stepChannel,
  stepTitle,
  syncPlotlines
};

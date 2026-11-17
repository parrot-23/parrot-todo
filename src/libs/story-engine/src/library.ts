/**
 * 素材库 —— 素材实体（独立 id）的管理与持久化
 *
 * 设计要点（素材 id 化）：
 *  - 每个素材是一个唯一实体，有系统生成的稳定 id（如 "res_0001"）。
 *  - 同名自动归并：按 (kind, name) 归并，多个章节里同名素材复用同一 id。
 *  - id 对作者隐式：作者在 DSL 里只写名字，id 由系统维护。
 *  - name 可改名：改名只改 name，id 引用不断裂。
 *
 * 持久化：素材库序列化为 assets.json（剧情包内，非 . 开头）。
 */

import type { Asset, AssetKind } from "./types.ts";

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
export function createLibrary(): AssetLibrary {
  return {
    data: { nextId: 1, items: {} },
    nameIndex: new Map(),
  };
}

/** 从 assets.json 内容加载素材库（非法/缺失时返回空库） */
export function loadLibrary(json: string): AssetLibrary {
  const lib = createLibrary();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      lib.data.nextId = Number.isFinite(parsed.nextId) ? parsed.nextId : 1;
      if (parsed.items && typeof parsed.items === "object") {
        for (const [id, item] of Object.entries(parsed.items)) {
          const a = item as Asset;
          if (a && typeof a === "object" && a.name != null && a.kind != null) {
            lib.data.items[id] = { id, kind: a.kind, name: String(a.name), path: String(a.path ?? "") };
          }
        }
      }
    }
  } catch {
    // 解析失败 → 空库
  }
  rebuildIndex(lib);
  return lib;
}

/** 序列化素材库为 assets.json 文本 */
export function serializeLibrary(lib: AssetLibrary): string {
  return JSON.stringify(lib.data, null, 2);
}

/** 重建归并索引 */
export function rebuildIndex(lib: AssetLibrary): void {
  lib.nameIndex.clear();
  for (const [id, item] of Object.entries(lib.data.items)) {
    lib.nameIndex.set(keyOf(item.kind, item.name), id);
  }
}

function keyOf(kind: AssetKind, name: string): string {
  return `${kind}:${name}`;
}

/** 生成下一个素材 id（不推进 nextId，由 resolve 时推进） */
function nextId(lib: AssetLibrary): string {
  const id = `res_${String(lib.data.nextId).padStart(4, "0")}`;
  lib.data.nextId += 1;
  return id;
}

/**
 * 按 (kind, name) 归并查询/创建素材，返回素材 id。
 *
 * - 命中已有素材 → 返回其 id（同名复用，跨章节/跨会话稳定）。
 * - 未命中 → 新建素材（占位 path），写入库并返回新 id。
 */
export function resolveAsset(lib: AssetLibrary, name: string, kind: AssetKind): string {
  const k = keyOf(kind, name);
  const existing = lib.nameIndex.get(k);
  if (existing) return existing;

  const id = nextId(lib);
  const asset: Asset = { id, kind, name, path: placeholderPath(kind, name) };
  lib.data.items[id] = asset;
  lib.nameIndex.set(k, id);
  return id;
}

/** 占位路径（未绑定真实文件时的默认值） */
function placeholderPath(kind: AssetKind, name: string): string {
  const dir = kind === "sprite" ? "sprite" : kind === "audio" ? "audio" : "image";
  return `assets/${dir}/${name}`;
}

/** 改名：改素材的 name（并同步归并索引），id 不变 */
export function renameAsset(lib: AssetLibrary, id: string, newName: string): boolean {
  const item = lib.data.items[id];
  if (!item) return false;
  // 删除旧索引
  const oldKey = keyOf(item.kind, item.name);
  if (lib.nameIndex.get(oldKey) === id) lib.nameIndex.delete(oldKey);
  item.name = newName;
  lib.nameIndex.set(keyOf(item.kind, newName), id);
  return true;
}

/** 绑定真实文件路径到素材（编辑器导入素材时调用） */
export function bindAssetPath(lib: AssetLibrary, id: string, path: string): boolean {
  const item = lib.data.items[id];
  if (!item) return false;
  item.path = path;
  return true;
}

/** 取素材显示名（id → name，查不到返回 id 本身） */
export function assetDisplayName(lib: AssetLibrary, id: string): string {
  return lib.data.items[id]?.name ?? id;
}

/**
 * 素材引用诊断（模块三·素材管理 + 阶段1 基线）
 *
 * 检查 `assets.json` 里每个素材实体的绑定情况，输出可定位诊断：
 *  - 未绑定（空 path）：info，不阻断编辑，但预览/资源检查要能看见。
 *  - 路径缺少扩展名 / 文件不存在：warning，视为失效引用。
 *  - 多个素材条目指向同一文件：warning，疑似重复，需作者确认。
 *
 * 素材文件在磁盘上的「孤儿文件 / 字节级重复」扫描属于更高成本操作，
 * 由编辑器按需触发（见差距分析文档），此处只做引用级校验。
 */

import type { Diagnostic } from "./project-types.ts";
import type { AssetLibraryData } from "./library.ts";
import { DIAG, DiagnosticBag } from "./project-diagnostics.ts";
import type { ProjectIO } from "./project-loader.ts";

const ABS_PATH = /^(?:[a-zA-Z]:[\\/]|\/)/;

export function collectAssetDiagnostics(
  assets: AssetLibraryData,
  io: ProjectIO,
): Diagnostic[] {
  const bag = new DiagnosticBag();

  const byPath = new Map<string, string[]>();
  for (const [id, item] of Object.entries(assets.items)) {
    const path = (item.path ?? "").trim();
    const loc = { file: "assets.json", line: 1, column: 1 };
    if (!path) {
      bag.info(
        DIAG.ASSET_UNBOUND,
        `素材「${item.name}」尚未绑定文件，预览中将以占位显示`,
        loc,
        { assetId: id, kind: item.kind },
      );
      continue;
    }
    if (!ABS_PATH.test(path)) byPath.set(path, [...(byPath.get(path) ?? []), id]);
    if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) {
      bag.warn(
        DIAG.ASSET_PATH_INVALID,
        `素材「${item.name}」的路径缺少扩展名：${path}`,
        loc,
        { assetId: id },
      );
      continue;
    }
    if (!ABS_PATH.test(path) && !io.exists(path)) {
      bag.warn(
        DIAG.ASSET_PATH_INVALID,
        `素材「${item.name}」引用的文件不存在：${path}`,
        loc,
        { assetId: id, path },
      );
    }
  }

  for (const [path, ids] of byPath) {
    if (ids.length <= 1) continue;
    bag.warn(
      DIAG.ASSET_DUPLICATE_FILE,
      `有 ${ids.length} 个素材条目指向同一文件：${path}（${ids.join(", ")}）`,
      { file: "assets.json", line: 1, column: 1 },
      { path, assetIds: ids },
    );
  }

  return bag.list;
}

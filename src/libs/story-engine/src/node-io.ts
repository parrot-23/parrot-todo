/**
 * Node 环境的 ProjectIO 适配器（测试 / CLI / 主进程）
 *
 * 刻意不从 index.ts 导出：渲染进程打包不能引入 node:fs。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectIO } from "./project-loader.ts";

export function createNodeIO(root: string): ProjectIO {
  const abs = (rel: string) => (rel ? join(root, ...rel.split("/").filter(Boolean)) : root);

  return {
    readText(rel) {
      try {
        return readFileSync(abs(rel), "utf-8");
      } catch {
        return null;
      }
    },
    exists(rel) {
      return existsSync(abs(rel));
    },
    listFiles(relDir) {
      try {
        return readdirSync(abs(relDir), { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name)
          .sort();
      } catch {
        return [];
      }
    },
    listDirs(relDir) {
      try {
        return readdirSync(abs(relDir), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();
      } catch {
        return [];
      }
    },
    readBytes(rel) {
      try {
        return new Uint8Array(readFileSync(abs(rel)));
      } catch {
        return null;
      }
    },
  };
}

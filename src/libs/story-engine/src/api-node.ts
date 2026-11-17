/**
 * Node 环境门面（CLI / 服务端 / Electron 主进程）
 *
 * 与 api.ts 的区别只有一个：这里引用了 node:fs。
 * 浏览器 / 渲染进程请勿导入本文件，改用 api.ts 的 openProjectFromSnapshot。
 */

import { createNodeIO } from "./node-io.ts";
import { openProject, type StoryProject } from "./api.ts";
import type { LoadProjectOptions } from "./project-loader.ts";

// Node 侧单文件出口：门面的全部能力 + 磁盘读取，导入本文件即可
export * from "./api.ts";

/** 直接从磁盘目录打开项目（root = 含 story/ 与 story.project.json 的那一层） */
export function openProjectFromDisk(root: string, options: LoadProjectOptions = {}): StoryProject {
  return openProject(root, createNodeIO(root), options);
}

export { createNodeIO };

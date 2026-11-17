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
export const PROJECT_FILE_NAME = "story.project.json";

/** 剧本文件目录（相对项目根）；老项目没有该目录时回退项目根 */
export const STORY_DIR = "story";

/** 旧版分散文件；仅用于向后兼容读取与迁移提示 */
export const LEGACY_PROJECT_FILES = ["states.json", "menus.json", "orchestration.json"] as const;

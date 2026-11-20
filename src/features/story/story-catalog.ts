// 剧本目录扫描：在 story-engine 构建产物（dist/api.js）之上做一层极薄的磁盘适配。
// 只负责「列目录 / 读文本 / 打开项目」，不参与引擎内部逻辑。
import { openProject, type ProjectIO, type StoryProject } from '../../libs/story-engine/dist/api.js';

/** 扫描到的一个剧本项目 */
export interface StoryEntry {
    /** 目录名（卡片标题） */
    name: string;
    /** 项目根绝对路径 */
    dir: string;
    /** 片段数 */
    labelCount: number;
    /** 是否可直接播放（无 error 级诊断） */
    ok: boolean;
    /** error 级诊断数量 */
    errorCount: number;
    /** warning 级诊断数量 */
    warningCount: number;
}

/** 目录项（只用到判别文件 / 目录） */
interface DiskDirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
}

/** Node 侧 fs 的最小能力集合 */
interface DiskFs {
    readFileSync(path: string, encoding: string): string;
    existsSync(path: string): boolean;
    readdirSync(path: string, options: { withFileTypes: true }): DiskDirent[];
}

/** Obsidian 渲染进程里的 require（桌面端才有，移动端为空） */
function getRequire(): ((module: string) => unknown) | null {
    const win = window as unknown as { require?: (module: string) => unknown };
    if (typeof win.require === 'function') return win.require;
    const globalReq = (globalThis as { require?: (module: string) => unknown }).require;
    return typeof globalReq === 'function' ? globalReq : null;
}

/** 当前环境是否可以访问本地磁盘 */
export function isStoryDiskAvailable(): boolean {
    const req = getRequire();
    if (!req) return false;
    try {
        req('fs');
        req('path');
        return true;
    } catch {
        return false;
    }
}

/** 判断绝对路径是否为已存在的目录 */
export function isExistingDirectory(dir: string): boolean {
    const req = getRequire();
    if (!req || !dir) return false;
    try {
        const fs = req('fs') as {
            existsSync: (p: string) => boolean;
            statSync: (p: string) => { isDirectory(): boolean };
        };
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

/** 统一成相对项目根的 "/" 路径（去掉首尾分隔符） */
function normRel(rel: string): string {
    return rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** 把 ProjectIO 的 4 个同步方法映射到本地磁盘 */
function createDiskIO(root: string, fs: DiskFs, join: (...parts: string[]) => string): ProjectIO {
    const toAbs = (rel: string): string => {
        const clean = normRel(rel);
        return clean ? join(root, ...clean.split('/')) : root;
    };
    const list = (relDir: string, dirs: boolean): string[] => {
        try {
            const entries = fs.readdirSync(toAbs(relDir), { withFileTypes: true });
            return entries
                .filter((entry) => (dirs ? entry.isDirectory() : entry.isFile()))
                .map((entry) => entry.name)
                .sort();
        } catch {
            return [];
        }
    };
    return {
        readText(rel) {
            try {
                return fs.readFileSync(toAbs(rel), 'utf-8');
            } catch {
                return null;
            }
        },
        exists(rel) {
            try {
                return fs.existsSync(toAbs(rel));
            } catch {
                return false;
            }
        },
        listFiles(relDir) {
            return list(relDir, false);
        },
        listDirs(relDir) {
            return list(relDir, true);
        },
    };
}

/** 打开一个剧本项目（目录内有 story.project.json 与 story/）；失败返回 null */
export function loadStoryProject(dir: string): StoryProject | null {
    const req = getRequire();
    if (!req || !dir) return null;
    try {
        const fs = req('fs') as DiskFs;
        const path = req('path') as { join: (...parts: string[]) => string };
        return openProject(dir, createDiskIO(dir, fs, path.join));
    } catch (err) {
        console.error('剧本加载失败', dir, err);
        return null;
    }
}

/** 扫描官方目录下的所有剧本项目（每个子目录即一个项目） */
export function scanStoryProjects(root: string): StoryEntry[] {
    if (!root) return [];
    const req = getRequire();
    if (!req) return [];
    let fs: DiskFs;
    let join: (...parts: string[]) => string;
    try {
        fs = req('fs') as DiskFs;
        join = (req('path') as { join: (...parts: string[]) => string }).join;
    } catch {
        return [];
    }

    let dirents: DiskDirent[];
    try {
        dirents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }

    const entries: StoryEntry[] = [];
    for (const dirent of dirents) {
        if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
        const dir = join(root, dirent.name);
        const project = loadStoryProject(dir);
        // 目录里没有剧本文件就不算一个剧本项目
        if (!project || project.files.length === 0) continue;
        entries.push({
            name: dirent.name,
            dir,
            labelCount: project.labels.length,
            ok: project.ok,
            errorCount: project.diagnostics.filter((issue) => issue.severity === 'error').length,
            warningCount: project.diagnostics.filter((issue) => issue.severity === 'warning').length,
        });
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/** 图片扩展名 → MIME */
const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
};

/** 素材路径 → data URL 缓存（同一素材每帧重绘时不重复读盘） */
const assetUrlCache = new Map<string, string>();

/**
 * 把 cue.assetPath（相对项目根）解析成能直接放进 <img src> 的 data URL。
 * 直接读字节而不走 Obsidian 资源接口，这样官方目录在 vault 外也能显示。
 */
export function resolveAssetUrl(projectRoot: string, assetPath: string): string {
    if (!assetPath) return '';
    if (/^(data:|https?:|app:|file:)/i.test(assetPath)) return assetPath;
    const req = getRequire();
    if (!req) return '';
    try {
        const path = req('path') as { join: (...parts: string[]) => string; extname: (p: string) => string };
        const abs = /^([a-zA-Z]:[\\/]|\/)/.test(assetPath)
            ? assetPath
            : path.join(projectRoot, ...normRel(assetPath).split('/'));
        const cached = assetUrlCache.get(abs);
        if (cached) return cached;
        const fs = req('fs') as { readFileSync: (p: string) => { toString(encoding: 'base64'): string } };
        const mime = MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
        const url = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
        assetUrlCache.set(abs, url);
        return url;
    } catch (err) {
        console.warn('素材读取失败', assetPath, err);
        return '';
    }
}

// 后端配置缓存：把 getConfig 的结果缓存到插件目录下的 api-cache.json。
// 缓存有效期 7 天，过期后重新请求；请求失败时回退到过期缓存，避免网络异常导致功能不可用。
import type { App, Plugin } from 'obsidian';

import { log } from '../shared/logger';
import { getPluginDir } from '../shared/plugin-dir';
import type { ObConfig } from './types';

/** 缓存有效期：7 天（毫秒） */
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

/** 缓存文件名（与 data.json 同级） */
const CACHE_FILE = 'api-cache.json';

/** 缓存文件结构 */
interface ApiCacheFile {
    /** 配置项缓存 */
    config?: {
        /** 缓存的配置内容 */
        data: ObConfig;
        /** 写入缓存的时间戳（毫秒） */
        fetchedAt: number;
    };
}

/** 内存中的缓存（避免每次读取都访问磁盘） */
let cache: ApiCacheFile | null = null;

/** 缓存文件路径 */
function cachePath(app: App, plugin: Plugin): string {
    return `${getPluginDir(app, plugin)}/${CACHE_FILE}`;
}

/** 读取缓存文件（首次调用时从磁盘加载，之后走内存） */
async function loadCache(app: App, plugin: Plugin): Promise<ApiCacheFile> {
    if (cache) return cache;
    try {
        const raw = await app.vault.adapter.read(cachePath(app, plugin));
        const parsed: unknown = JSON.parse(raw);
        cache = parsed && typeof parsed === 'object' ? parsed as ApiCacheFile : {};
    } catch {
        // 文件不存在或解析失败：视为空缓存
        cache = {};
    }
    return cache;
}

/** 写回缓存文件 */
async function saveCache(app: App, plugin: Plugin): Promise<void> {
    if (!cache) return;
    try {
        await app.vault.adapter.write(cachePath(app, plugin), JSON.stringify(cache, null, 2));
    } catch (err) {
        log('写入配置缓存失败', err);
    }
}

/** 缓存是否仍在有效期内 */
function isFresh(fetchedAt: number): boolean {
    return Date.now() - fetchedAt < CACHE_TTL;
}

/**
 * 读取配置缓存。
 * @returns 命中有效缓存时返回配置内容，未命中或已过期返回 null
 */
export async function readConfigCache(app: App, plugin: Plugin): Promise<ObConfig | null> {
    const data = await loadCache(app, plugin);
    const entry = data.config;
    if (!entry || !isFresh(entry.fetchedAt)) return null;
    return entry.data;
}

/** 写入配置缓存（同时更新内存与磁盘） */
export async function writeConfigCache(app: App, plugin: Plugin, config: ObConfig): Promise<void> {
    const data = await loadCache(app, plugin);
    data.config = { data: config, fetchedAt: Date.now() };
    await saveCache(app, plugin);
}

/** 读取过期缓存（网络请求失败时的兜底） */
export async function readStaleConfigCache(app: App, plugin: Plugin): Promise<ObConfig | null> {
    const data = await loadCache(app, plugin);
    return data.config?.data ?? null;
}

/** 清空配置缓存（清空插件数据时调用） */
export async function clearConfigCache(app: App, plugin: Plugin): Promise<void> {
    cache = {};
    try {
        await app.vault.adapter.remove(cachePath(app, plugin));
    } catch {
        // 文件不存在时忽略
    }
}

// obconfig 云函数接口：客户端拉取 OB 端配置项。
import type { App, Plugin } from 'obsidian';

import { post } from './client';
import { readConfigCache, readStaleConfigCache, writeConfigCache } from './cache';
import type { ObConfig, ObConfigRequest, ObConfigResponse } from './types';

/** 配置项默认值（后端未设置时使用） */
const DEFAULT_CONFIG: ObConfig = {
    announcement: '',
    authCodeUrl: '',
};

/** 真正发起请求并解析配置（不走缓存） */
async function fetchConfig(): Promise<ObConfig> {
    const body: ObConfigRequest = { type: 'getConfig' };
    const res = await post<ObConfigResponse>('', body);

    if (!res || res.success !== true) {
        throw new Error(res?.message || '获取配置失败');
    }

    const config = res.config ?? {};
    return {
        announcement: typeof config.announcement === 'string' ? config.announcement : DEFAULT_CONFIG.announcement,
        authCodeUrl: typeof config.authCodeUrl === 'string' ? config.authCodeUrl : DEFAULT_CONFIG.authCodeUrl,
    };
}

/**
 * 获取 OB 端配置（公开接口，无需鉴权）。
 * 优先读缓存（有效期 7 天）；缓存过期或不存在时重新请求并写回缓存。
 * 请求失败时回退到过期缓存；无任何缓存可用时抛出错误，由调用方决定如何提示。
 */
export async function getConfig(app: App, plugin: Plugin): Promise<ObConfig> {
    const cached = await readConfigCache(app, plugin);
    if (cached) return cached;

    try {
        const config = await fetchConfig();
        await writeConfigCache(app, plugin, config);
        return config;
    } catch (err) {
        const stale = await readStaleConfigCache(app, plugin);
        if (stale) return stale;
        throw err;
    }
}

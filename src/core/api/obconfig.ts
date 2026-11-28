// obconfig 云函数接口：客户端拉取 OB 端配置项。
import { post } from './client';
import type { ObConfig, ObConfigRequest, ObConfigResponse } from './types';

/** 配置项默认值（后端未设置时使用） */
const DEFAULT_CONFIG: ObConfig = {
    announcement: '',
    authCodeUrl: '',
};

/**
 * 获取 OB 端配置（公开接口，无需鉴权）。
 * 请求失败或后端返回 success=false 时抛出错误，由调用方决定如何提示。
 */
export async function getConfig(): Promise<ObConfig> {
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

// 后端请求底座：统一域名、请求方式、超时与错误处理。
// 使用 Obsidian 的 requestUrl 而非 fetch：插件运行在渲染进程，fetch 会受 CORS 限制，
// requestUrl 走主进程发起请求，不受跨域限制。
import { requestUrl } from 'obsidian';

import { log } from '../shared/logger';

/**
 * 后端服务域名（云函数 HTTP 访问服务的公共前缀）。
 * 形如 `https://xxx.service.tcloudbase.com`，末尾不要带 `/`。
 * 各云函数地址由「域名 + 云函数名」拼接得到，只需在此配置一次。
 */
export const API_HOST = 'https://cloud1-d1g6azon61dd44c4e-1500284813.ap-shanghai.app.tcloudbase.com';

/** 配置服务（obconfig 云函数）地址 */
export const API_BASE_URL = `${API_HOST}/obconfig`;

/** 授权服务（obauth 云函数）地址 */
export const AUTH_API_BASE_URL = `${API_HOST}/obauth`;

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT = 15000;

/** 请求失败时抛出的错误 */
export class ApiError extends Error {
    /** HTTP 状态码（网络层失败时为 0） */
    status: number;

    constructor(message: string, status = 0) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/** 是否已配置后端域名 */
export function isApiConfigured(): boolean {
    return API_BASE_URL.trim().length > 0;
}

/**
 * 发起一次 POST 请求（后端统一使用 POST + JSON 请求体）。
 * @param path 接口路径（相对 API_BASE_URL，可为空表示直接请求域名本身）
 * @param body 请求体
 * @param baseUrl 服务地址，默认 API_BASE_URL（授权服务传 AUTH_API_BASE_URL）
 */
export async function post<T>(path: string, body: unknown, baseUrl: string = API_BASE_URL): Promise<T> {
    if (!isApiConfigured()) {
        throw new ApiError('后端服务地址未配置');
    }

    const url = `${baseUrl.replace(/\/+$/, '')}${path ? `/${path.replace(/^\/+/, '')}` : ''}`;
    log('后端请求', url, body);

    let res;
    try {
        res = await requestUrl({
            url,
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify(body),
            throw: false,
        });
    } catch (err) {
        log('后端请求异常', err);
        throw new ApiError(err instanceof Error ? err.message : String(err));
    }

    if (res.status < 200 || res.status >= 300) {
        log('后端请求失败', res.status, res.text);
        throw new ApiError(`请求失败（HTTP ${res.status}）`, res.status);
    }

    try {
        return res.json as T;
    } catch {
        log('后端响应解析失败', res.text);
        throw new ApiError('响应内容不是合法的 JSON', res.status);
    }
}

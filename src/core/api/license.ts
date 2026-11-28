// 授权（obauth 云函数）客户端：clientId 生成、授权码激活、授权状态读写。
// 存储约定：
// - clientId 与授权码（licenseKey）写入插件目录下的 license.json；
// - token 与过期时间写入 localStorage（键名见 TOKEN_STORAGE_KEY）。
import type { App, Plugin } from 'obsidian';

import { log } from '../shared/logger';
import { getPluginDir } from '../shared/plugin-dir';
import { AUTH_API_BASE_URL, post } from './client';
import type { ObAuthActivateParams, ObAuthRequest, ObAuthResponse } from './types';

/** 授权信息文件名（与 data.json 同级） */
const LICENSE_FILE = 'license.json';

/** token 在 localStorage 中的键名 */
const TOKEN_STORAGE_KEY = 'parrot-plan-auth-token';

/** 授权信息文件结构 */
interface LicenseFile {
    /** 客户端唯一标识（UUID v4） */
    clientId: string;
    /** 已激活的授权码（未激活时为空字符串） */
    licenseKey: string;
}

/** 授权状态 */
export interface LicenseState {
    /** 客户端唯一标识 */
    clientId: string;
    /** 已激活的授权码（未激活时为空字符串） */
    licenseKey: string;
    /** 会话令牌（未激活时为空字符串） */
    token: string;
    /** token 过期时间戳（毫秒，未激活时为 0） */
    expireTime: number;
}

/** 内存中的授权信息（避免每次读取都访问磁盘） */
let licenseFile: LicenseFile | null = null;

/** 授权信息文件路径 */
function licensePath(app: App, plugin: Plugin): string {
    return `${getPluginDir(app, plugin)}/${LICENSE_FILE}`;
}

/** 生成 UUID v4（优先使用 crypto.randomUUID） */
function generateUuid(): string {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    // 兜底：基于 getRandomValues 手工拼装 v4
    const bytes = new Uint8Array(16);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        cryptoObj.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 读取 localStorage 中的 token 信息（读取失败时返回空值） */
function readTokenStorage(): { token: string; expireTime: number } {
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return { token: '', expireTime: 0 };
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { token: '', expireTime: 0 };
        const r = parsed as Record<string, unknown>;
        return {
            token: typeof r.token === 'string' ? r.token : '',
            expireTime: typeof r.expireTime === 'number' ? r.expireTime : 0,
        };
    } catch {
        return { token: '', expireTime: 0 };
    }
}

/** 写入 token 信息到 localStorage */
function writeTokenStorage(token: string, expireTime: number): void {
    try {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expireTime }));
    } catch (err) {
        log('写入授权 token 失败', err);
    }
}

/** 读取授权信息文件（首次调用时从磁盘加载，之后走内存；不存在时生成 clientId 并落盘） */
async function loadLicenseFile(app: App, plugin: Plugin): Promise<LicenseFile> {
    if (licenseFile) return licenseFile;
    let parsed: LicenseFile | null = null;
    try {
        const raw = await app.vault.adapter.read(licensePath(app, plugin));
        const data: unknown = JSON.parse(raw);
        if (data && typeof data === 'object') {
            const r = data as Record<string, unknown>;
            parsed = {
                clientId: typeof r.clientId === 'string' ? r.clientId : '',
                licenseKey: typeof r.licenseKey === 'string' ? r.licenseKey : '',
            };
        }
    } catch {
        // 文件不存在或解析失败：视为未初始化
        parsed = null;
    }

    if (parsed && parsed.clientId) {
        licenseFile = parsed;
        return licenseFile;
    }

    // 首次运行（或文件损坏）：生成 clientId 并写入文件
    licenseFile = { clientId: generateUuid(), licenseKey: parsed?.licenseKey ?? '' };
    await saveLicenseFile(app, plugin);
    return licenseFile;
}

/** 写回授权信息文件 */
async function saveLicenseFile(app: App, plugin: Plugin): Promise<void> {
    if (!licenseFile) return;
    try {
        await app.vault.adapter.write(licensePath(app, plugin), JSON.stringify(licenseFile, null, 2));
    } catch (err) {
        log('写入授权信息文件失败', err);
    }
}

/** 获取客户端唯一标识（不存在时自动生成并写入 license.json） */
export async function getClientId(app: App, plugin: Plugin): Promise<string> {
    const file = await loadLicenseFile(app, plugin);
    return file.clientId;
}

/** 读取当前授权状态（未激活时 licenseKey / token 为空字符串） */
export async function getLicenseState(app: App, plugin: Plugin): Promise<LicenseState> {
    const file = await loadLicenseFile(app, plugin);
    const { token, expireTime } = readTokenStorage();
    return { clientId: file.clientId, licenseKey: file.licenseKey, token, expireTime };
}

/** 当前客户端系统标识（windows / macos / linux） */
function detectClientOs(): string {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    if (ua.includes('windows')) return 'windows';
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('linux')) return 'linux';
    return '';
}

/** 激活结果 */
export interface ActivateResult {
    success: boolean;
    /** 失败原因（成功时为空字符串） */
    errMsg: string;
    /** 会话令牌（tk_ 前缀，失败时为空字符串） */
    token: string;
    /** token 过期时间戳（毫秒，失败时为 0） */
    expireTime: number;
}

/**
 * 激活授权码：调用 obauth 的 activate 接口。
 * 成功后把授权码写入 license.json，token / 过期时间写入 localStorage。
 */
export async function activateLicense(app: App, plugin: Plugin, licenseKey: string): Promise<ActivateResult> {
    const file = await loadLicenseFile(app, plugin);
    const body: ObAuthRequest & ObAuthActivateParams = {
        type: 'activate',
        licenseKey,
        clientId: file.clientId,
        clientOs: detectClientOs(),
    };

    let res: ObAuthResponse;
    try {
        res = await post<ObAuthResponse>('', body, AUTH_API_BASE_URL);
    } catch (err) {
        log('激活请求失败', err);
        return { success: false, errMsg: err instanceof Error ? err.message : String(err), token: '', expireTime: 0 };
    }

    if (!res || res.success !== true) {
        const errMsg = res?.errMsg || '激活失败';
        log('激活失败', errMsg);
        return { success: false, errMsg, token: '', expireTime: 0 };
    }

    const token = res.token ?? '';
    const expireTime = res.expireTime ?? 0;
    file.licenseKey = licenseKey;
    await saveLicenseFile(app, plugin);
    writeTokenStorage(token, expireTime);
    log('激活成功', { licenseKey, token, expireTime });
    return { success: true, errMsg: '', token, expireTime };
}

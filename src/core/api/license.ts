// 授权（obauth 云函数）客户端：clientId 生成、授权码激活、授权状态校验与续期。
// 存储约定：
// - clientId 与授权码（licenseKey）写入 data.json；
// - token、过期时间与上次校验时间写入 localStorage（键名见 TOKEN_STORAGE_KEY）。
import type { App, Plugin } from 'obsidian';

import { log } from '../shared/logger';
import { getPluginDir } from '../shared/plugin-dir';
import { AUTH_API_BASE_URL, post } from './client';
import type { ObAuthActivateParams, ObAuthDevice, ObAuthListDevicesResponse, ObAuthRequest, ObAuthResponse } from './types';
import { ObAuthCode } from './types';

/** 授权信息文件名（旧版本使用，现已迁移到 data.json，仅用于兼容迁移） */
const LICENSE_FILE = 'license.json';

/** token 在 localStorage 中的键名 */
const TOKEN_STORAGE_KEY = 'parrot-plan-auth-token';

/** 校验间隔：24 小时（毫秒），距上次校验不足该时长时跳过 */
export const VALIDATE_INTERVAL = 24 * 60 * 60 * 1000;

/** 续期阈值：剩余有效期不足 15 天时调用 refresh */
const REFRESH_THRESHOLD = 15 * 24 * 60 * 60 * 1000;

/** 失效宽限期：token 失效后 7 天内重新激活未成功，则清除本地授权状态 */
const INVALID_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000;

/** 授权信息文件结构 */
interface LicenseFile {
    /** 客户端唯一标识（UUID v4） */
    clientId: string;
    /** 已激活的授权码（未激活时为空字符串） */
    licenseKey: string;
}

/** localStorage 中保存的 token 信息 */
interface TokenStorage {
    /** 会话令牌 */
    token: string;
    /** token 过期时间戳（毫秒） */
    expireTime: number;
    /** 上次校验时间戳（毫秒，0 表示从未校验） */
    lastValidateAt: number;
    /** 首次校验失效的时间戳（毫秒，0 表示当前未处于失效状态） */
    invalidSince: number;
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
    /** 上次校验时间戳（毫秒，0 表示从未校验） */
    lastValidateAt: number;
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
function readTokenStorage(): TokenStorage {
    const empty: TokenStorage = { token: '', expireTime: 0, lastValidateAt: 0, invalidSince: 0 };
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return empty;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return empty;
        const r = parsed as Record<string, unknown>;
        return {
            token: typeof r.token === 'string' ? r.token : '',
            expireTime: typeof r.expireTime === 'number' ? r.expireTime : 0,
            lastValidateAt: typeof r.lastValidateAt === 'number' ? r.lastValidateAt : 0,
            invalidSince: typeof r.invalidSince === 'number' ? r.invalidSince : 0,
        };
    } catch {
        return empty;
    }
}

/** 写入 token 信息到 localStorage */
function writeTokenStorage(data: TokenStorage): void {
    try {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        log('写入授权 token 失败', err);
    }
}

/** 清除 localStorage 中的 token 信息（授权失效时调用） */
function clearTokenStorage(): void {
    try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (err) {
        log('清除授权 token 失败', err);
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

    // 兼容旧版本：clientId 曾存放在 license.json，迁移到 data.json 后删除该文件
    if (parsed && parsed.clientId) {
        licenseFile = parsed;
        await migrateLegacyLicenseFile(app, plugin);
        return licenseFile;
    }

    // 首次运行（或文件损坏）：生成 clientId 并写入 data.json
    licenseFile = { clientId: generateUuid(), licenseKey: parsed?.licenseKey ?? '' };
    await saveLicenseFile(app, plugin);
    return licenseFile;
}

/** 写回授权信息（clientId 与授权码写入 data.json） */
async function saveLicenseFile(app: App, plugin: Plugin): Promise<void> {
    if (!licenseFile) return;
    try {
        await plugin.saveData({ ...(await readPluginData(plugin)), ...licenseFile });
    } catch (err) {
        log('写入授权信息失败', err);
    }
}

/** 读取 data.json 现有内容（保留其他字段，避免覆盖） */
async function readPluginData(plugin: Plugin): Promise<Record<string, unknown>> {
    try {
        const raw: unknown = await plugin.loadData();
        return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** 旧版本迁移：把 license.json 中的 clientId / licenseKey 写入 data.json 并删除旧文件 */
async function migrateLegacyLicenseFile(app: App, plugin: Plugin): Promise<void> {
    if (!licenseFile) return;
    try {
        const data = await readPluginData(plugin);
        if (data.clientId === licenseFile.clientId && data.licenseKey === licenseFile.licenseKey) {
            // 已迁移过，只需清理旧文件
            await app.vault.adapter.remove(licensePath(app, plugin));
            return;
        }
        await plugin.saveData({ ...data, ...licenseFile });
        await app.vault.adapter.remove(licensePath(app, plugin));
        log('已将授权信息从 license.json 迁移到 data.json');
    } catch (err) {
        log('迁移授权信息失败', err);
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
    const { token, expireTime, lastValidateAt } = readTokenStorage();
    return { clientId: file.clientId, licenseKey: file.licenseKey, token, expireTime, lastValidateAt };
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
    /** 业务状态码（0 表示成功，其余见 ObAuthCode） */
    code: number;
    /** 失败原因（成功时为空字符串） */
    errMsg: string;
    /** 会话令牌（tk_ 前缀，失败时为空字符串） */
    token: string;
    /** token 过期时间戳（毫秒，失败时为 0） */
    expireTime: number;
    /** 授权码已被其他设备占用时，当前绑定的设备列表（其他情况为空数组） */
    devices: ObAuthDevice[];
}

/** 查询授权码当前绑定的设备（公开接口，仅凭 licenseKey） */
export async function listDevices(licenseKey: string): Promise<ObAuthDevice[]> {
    const body: ObAuthRequest = { type: 'listDevices', licenseKey };
    try {
        const res = await post<ObAuthListDevicesResponse>('', body, AUTH_API_BASE_URL);
        if (!res || res.success !== true || !Array.isArray(res.list)) return [];
        return res.list;
    } catch (err) {
        log('查询绑定设备失败', err);
        return [];
    }
}

/** 解绑结果 */
export interface DeactivateResult {
    success: boolean;
    /** 失败原因（成功时为空字符串） */
    errMsg: string;
}

/**
 * 解绑设备：调用 obauth 的 deactivate 接口。
 * 需要该设备自身的 token 与 clientId（接口按 token 定位绑定关系）。
 * 成功后该授权码回到未激活状态，其下所有 token 被作废。
 */
export async function deactivateLicense(app: App, plugin: Plugin, token: string, clientId: string): Promise<DeactivateResult> {
    const body: ObAuthRequest = { type: 'deactivate', token, clientId };
    let res: ObAuthResponse;
    try {
        res = await post<ObAuthResponse>('', body, AUTH_API_BASE_URL);
    } catch (err) {
        log('解绑请求失败', err);
        return { success: false, errMsg: err instanceof Error ? err.message : String(err) };
    }
    if (!res || res.success !== true) {
        const errMsg = res?.errMsg || '解绑失败';
        log('解绑失败', errMsg);
        return { success: false, errMsg };
    }
    log('解绑成功', { clientId });
    return { success: true, errMsg: '' };
}

/**
 * 解绑指定设备（按 clientId 匹配）。
 * 若目标设备就是本机，直接用本地 token 调 deactivate；
 * 否则说明该授权码绑在别的设备上，本机没有它的 token，无法解绑。
 */
export async function deactivateDevice(app: App, plugin: Plugin, device: ObAuthDevice): Promise<DeactivateResult> {
    const state = await getLicenseState(app, plugin);
    if (device.clientId !== state.clientId || !state.token) {
        return { success: false, errMsg: '只能解绑当前设备' };
    }
    const result = await deactivateLicense(app, plugin, state.token, state.clientId);
    if (result.success) {
        // 本机已解绑：清除本地 token，授权码保留在 license.json 便于重新激活
        clearTokenStorage();
    }
    return result;
}

/**
 * 激活授权码：调用 obauth 的 activate 接口。
 * 成功后把授权码写入 license.json，token / 过期时间写入 localStorage。
 * 授权码已被其他设备占用（code 1001）时，额外查询并返回当前绑定的设备列表。
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
        return {
            success: false,
            code: -1,
            errMsg: err instanceof Error ? err.message : String(err),
            token: '',
            expireTime: 0,
            devices: [],
        };
    }

    if (!res || res.success !== true) {
        const code = typeof res?.code === 'number' ? res.code : -1;
        const errMsg = res?.errMsg || '激活失败';
        log('激活失败', { code, errMsg });
        // 已被其他设备占用：查询当前绑定设备，供界面展示
        const devices = code === ObAuthCode.BoundToOtherDevice ? await listDevices(licenseKey) : [];
        return { success: false, code, errMsg, token: '', expireTime: 0, devices };
    }

    const token = res.token ?? '';
    const expireTime = res.expireTime ?? 0;
    file.licenseKey = licenseKey;
    await saveLicenseFile(app, plugin);
    writeTokenStorage({ token, expireTime, lastValidateAt: Date.now(), invalidSince: 0 });
    log('激活成功', { licenseKey, token, expireTime });
    return { success: true, code: ObAuthCode.Success, errMsg: '', token, expireTime, devices: [] };
}

/** validate 接口响应 */
interface ObAuthValidateResponse extends ObAuthResponse {
    /** 是否有效 */
    valid?: boolean;
    /** 无效原因：invalid / expired / revoked / client_mismatch */
    reason?: string;
    /** 剩余天数（有效时） */
    remainDays?: number;
}

/** 校验结果 */
export interface ValidateResult {
    /** 是否有效 */
    valid: boolean;
    /** 无效原因（有效时为空字符串） */
    reason: string;
    /** 是否因网络异常未能完成校验（此时 valid 为 true，保持现状） */
    networkError: boolean;
}

/** 调用 validate 接口校验 token */
async function requestValidate(clientId: string, token: string): Promise<ValidateResult> {
    const body: ObAuthRequest = { type: 'validate', token, clientId };
    let res: ObAuthValidateResponse;
    try {
        res = await post<ObAuthValidateResponse>('', body, AUTH_API_BASE_URL);
    } catch (err) {
        // 网络异常：视为校验未完成，保持本地现状
        log('校验请求失败', err);
        return { valid: true, reason: '', networkError: true };
    }

    if (res && res.success === true && res.valid === true) {
        return { valid: true, reason: '', networkError: false };
    }
    return { valid: false, reason: res?.reason || 'invalid', networkError: false };
}

/** 调用 refresh 接口续期（token 值不变，过期时间延长 60 天） */
async function requestRefresh(app: App, plugin: Plugin, clientId: string, token: string): Promise<boolean> {
    const body: ObAuthRequest = { type: 'refresh', token, clientId };
    let res: ObAuthResponse;
    try {
        res = await post<ObAuthResponse>('', body, AUTH_API_BASE_URL);
    } catch (err) {
        log('续期请求失败', err);
        return false;
    }
    if (!res || res.success !== true) {
        log('续期失败', res?.errMsg);
        return false;
    }
    writeTokenStorage({
        token: res.token ?? token,
        expireTime: res.expireTime ?? 0,
        lastValidateAt: Date.now(),
        invalidSince: 0,
    });
    log('续期成功', { expireTime: res.expireTime });
    return true;
}

/**
 * 校验当前授权状态（按需调用，内部按 24 小时间隔节流）。
 * 流程：
 * 1. 未激活（无 token 或无授权码）→ 直接返回未授权；
 * 2. 距上次校验不足 24 小时 → 跳过请求，按本地状态返回；
 * 3. 调用 validate：有效且剩余不足 15 天 → refresh 续期；
 * 4. 无效 → 用 license.json 中的授权码自动重新激活；
 *    重新激活未成功时记录首次失效时间，超过 7 天宽限期仍未成功则清除本地授权状态。
 * 网络异常时保持现状，不改变本地授权状态。
 */
export async function checkLicense(app: App, plugin: Plugin): Promise<LicenseState> {
    const file = await loadLicenseFile(app, plugin);
    const storage = readTokenStorage();

    // 未激活：无需校验
    if (!file.licenseKey || !storage.token) return getLicenseState(app, plugin);

    // 节流：距上次校验不足 24 小时直接跳过
    if (storage.lastValidateAt && Date.now() - storage.lastValidateAt < VALIDATE_INTERVAL) {
        return getLicenseState(app, plugin);
    }

    const result = await requestValidate(file.clientId, storage.token);
    if (result.networkError) return getLicenseState(app, plugin);

    if (result.valid) {
        // 记录本次校验时间，并清除失效标记
        writeTokenStorage({ ...storage, lastValidateAt: Date.now(), invalidSince: 0 });
        // 剩余不足 15 天时续期
        if (storage.expireTime && storage.expireTime - Date.now() < REFRESH_THRESHOLD) {
            await requestRefresh(app, plugin, file.clientId, storage.token);
        }
        return getLicenseState(app, plugin);
    }

    // 无效：自动重新激活
    log('授权校验无效，尝试重新激活', result.reason);
    const activated = await activateLicense(app, plugin, file.licenseKey);
    if (activated.success) return getLicenseState(app, plugin);

    // 重新激活失败：记录首次失效时间，超过 7 天宽限期则清除本地授权状态
    const invalidSince = storage.invalidSince || Date.now();
    if (Date.now() - invalidSince >= INVALID_GRACE_PERIOD) {
        log('重新激活超过宽限期仍未成功，清除本地授权状态', activated.errMsg);
        clearTokenStorage();
        return getLicenseState(app, plugin);
    }

    log('重新激活失败，保留本地状态等待下次重试', { errMsg: activated.errMsg, invalidSince });
    writeTokenStorage({ ...storage, lastValidateAt: Date.now(), invalidSince });
    return getLicenseState(app, plugin);
}

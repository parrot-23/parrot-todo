// 后端接口的请求 / 响应数据结构定义

/** obconfig 云函数支持的接口名 */
export type ObConfigType = 'getConfig' | 'listConfig' | 'updateConfig';

/** obconfig 云函数请求体（type 为接口名，其余为接口参数） */
export interface ObConfigRequest {
    type: ObConfigType;
    [key: string]: unknown;
}

/** getConfig 返回的配置项 */
export interface ObConfig {
    /** 公告内容，未设置时为空字符串 */
    announcement: string;
    /** 授权码获取链接，未设置时为空字符串 */
    authCodeUrl: string;
}

/** obconfig 云函数响应体 */
export interface ObConfigResponse {
    success: boolean;
    config?: Partial<ObConfig>;
    /** 失败时的错误信息（后端约定之外的兜底字段） */
    message?: string;
}

/** obauth 云函数支持的接口名（客户端侧） */
export type ObAuthType = 'activate' | 'refresh' | 'validate' | 'deactivate' | 'listDevices';

/** obauth 云函数请求体（type 为接口名，其余为接口参数） */
export interface ObAuthRequest {
    type: ObAuthType;
    [key: string]: unknown;
}

/** activate 请求参数 */
export interface ObAuthActivateParams {
    /** 授权码（UUID v4） */
    licenseKey: string;
    /** 客户端唯一标识 */
    clientId: string;
    /** 客户端系统（windows / macos / linux），仅记录 */
    clientOs?: string;
}

/** obauth 云函数响应体（各接口字段的并集，按需取用） */
export interface ObAuthResponse {
    success: boolean;
    /** 业务状态码：0 表示成功，其余见 ObAuthCode */
    code?: number;
    /** 会话令牌（tk_ 前缀） */
    token?: string;
    /** token 过期时间戳（毫秒） */
    expireTime?: number;
    /** 失败时的错误信息（仅用于展示，判断逻辑请用 code） */
    errMsg?: string;
}

/** activate 接口的业务状态码 */
export const ObAuthCode = {
    /** 成功激活并绑定当前设备 */
    Success: 0,
    /** 授权码有效，但已被其他设备使用（已绑定） */
    BoundToOtherDevice: 1001,
    /** 授权码不存在 */
    NotFound: 1002,
    /** 授权码已作废 */
    Revoked: 1003,
    /** 授权码从未激活且已过期 */
    Expired: 1004,
    /** 参数错误（格式错误或缺少 clientId） */
    InvalidParams: 1005,
    /** 同一 clientId 激活过于频繁（每分钟 10 次） */
    TooFrequent: 1006,
} as const;

/** listDevices 返回的绑定设备信息 */
export interface ObAuthDevice {
    /** 绑定的客户端标识 */
    clientId: string;
    /** 客户端系统，未记录为空字符串 */
    clientOs: string;
    /** 绑定时间戳（毫秒） */
    bindTime: number;
}

/** listDevices 接口响应 */
export interface ObAuthListDevicesResponse extends ObAuthResponse {
    /** 绑定设备数组，未绑定为空数组 */
    list?: ObAuthDevice[];
}

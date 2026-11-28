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
    /** 会话令牌（tk_ 前缀） */
    token?: string;
    /** token 过期时间戳（毫秒） */
    expireTime?: number;
    /** 失败时的错误信息 */
    errMsg?: string;
}

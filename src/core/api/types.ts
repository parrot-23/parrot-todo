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

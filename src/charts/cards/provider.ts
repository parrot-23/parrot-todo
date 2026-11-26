// @experimental 声明式卡片管线：当前无业务消费方，禁止新代码引用，后续随卡片工作台决策增删。
// DataProvider 工厂：从插件持有的数据构建统一数据提供者。
// 统计图卡片通过 provider 读取完整类型的领域数据，避免弱类型回调丢失字段。

import type { EventBlock, ExecutionRecord } from '../../core/datatypes/domain';
import type { InboxItem } from '../../core/datatypes/domain';
import type { DataProvider, CategoryRef } from '../../core/datatypes/chart';

/**
 * 构建数据提供者。
 * 传入的 getter 返回插件当前持有的数据引用（视图重建时仍指向最新数据）。
 */
export function createDataProvider(
    getEvents: () => EventBlock[],
    getExecutions: () => ExecutionRecord[],
    getTasks: () => InboxItem[],
    getCategories?: () => CategoryRef[],
): DataProvider {
    return {
        getEvents,
        getExecutions,
        getTasks,
        getCategories,
    };
}

// 收集面板：一级菜单仅「收集」，二级菜单为收集 / 画廊，内容区直接嵌入对应功能面板。
// 复用功能面板的两级菜单与嵌入逻辑，仅保留「收集」一级菜单。
import { t } from '../../../i18n';
import { FunctionPanel, type FunctionPanelOptions } from '../interface/function-panel';

/** 收集面板配置（不需要根任务列表与一级菜单配置） */
export interface CollectHubPanelOptions extends Omit<FunctionPanelOptions, 'title' | 'groups' | 'getTasks'> {
    /** 面板标题，默认「收集」 */
    title?: string;
}

/** 收集面板 */
export class CollectHubPanel extends FunctionPanel {
    constructor(options: CollectHubPanelOptions) {
        super({
            ...options,
            title: options.title ?? t('interface.collect'),
            groups: ['collect'],
        });
    }
}

// @experimental 声明式卡片管线：当前无业务消费方，禁止新代码引用，后续随卡片工作台决策增删。
// 内嵌卡片内容渲染：按卡片机制渲染卡片内容（template → renderer → aggregate），
// 不创建工作台卡片外壳，供检查面板等内嵌场景复用统计渲染管线。
import type { App } from 'obsidian';

import type { CardTemplate } from '../../core/datatypes/form';
import type { CardInstance } from '../../core/datatypes/card';
import type { CardRenderContext } from '../../core/datatypes/renderer';
import type { DataProvider } from '../../core/datatypes/chart';
import { statsCardRenderer } from './stats-card';

/** 无外壳内容渲染的上下文 */
export interface CardContentRenderOptions {
    app: App;
    save: () => Promise<void>;
    refresh: () => void;
    provider: DataProvider;
}

/** 按卡片机制渲染卡片内容（template → renderer → aggregate），不创建工作台卡片外壳 */
export function renderCardContent(
    container: HTMLElement,
    instance: CardInstance,
    template: CardTemplate,
    opts: CardContentRenderOptions,
): void {
    const ctx: CardRenderContext = {
        app: opts.app,
        save: opts.save,
        refresh: opts.refresh,
        provider: opts.provider,
    };
    statsCardRenderer.render(container, instance, template, ctx);
}

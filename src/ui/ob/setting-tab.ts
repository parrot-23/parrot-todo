// 插件设置页
import { Notice, PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';

import { t } from '../../core/i18n';
import type ParrotPlanPlugin from '../../../main';
import { ConfirmModal } from './confirm-modal';
import { getConfig } from '../../core/api/obconfig';
import { isApiConfigured } from '../../core/api/client';

/** 插件设置页 */
export class ParrotPlanSettingTab extends PluginSettingTab {
    private plugin: ParrotPlanPlugin;

    constructor(app: App, plugin: ParrotPlanPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: t('settings.title'),
                desc: t('settings.about'),
                render: (setting) => {
                    setting.setName(t('settings.title'));
                    setting.setDesc(t('settings.about'));
                },
            },
            {
                name: t('settings.featureManagement'),
                searchable: false,
                render: (setting) => {
                    setting.setName(t('settings.featureManagement')).setHeading();
                },
            },
            {
                name: t('settings.scriptModeEnabled'),
                desc: t('settings.scriptModeEnabledDesc'),
                render: (setting) => {
                    setting
                        .setName(t('settings.scriptModeEnabled'))
                        .setDesc(t('settings.scriptModeEnabledDesc'))
                        .addToggle((toggle) => {
                            toggle.setValue(this.plugin.scriptModeEnabled).onChange(async (value) => {
                                await this.plugin.saveScriptModeEnabled(value);
                            });
                        });
                },
            },
            {
                name: t('settings.licenseKey'),
                desc: t('settings.licenseKeyDesc'),
                render: (setting) => {
                    setting
                        .setName(t('settings.licenseKey'))
                        .setDesc(t('settings.licenseKeyDesc'))
                        .addText((text) => {
                            text.setPlaceholder(t('settings.licenseKeyPlaceholder'));
                        })
                        .addButton((btn) => {
                            btn.setButtonText(t('settings.licenseKeySubmit'));
                        })
                        .addButton((btn) => {
                            btn.setButtonText(t('settings.licenseKeyGet'))
                                .onClick(async () => {
                                    if (!isApiConfigured()) {
                                        new Notice(t('settings.authCodeUnavailable'));
                                        return;
                                    }
                                    try {
                                        const config = await getConfig(this.app, this.plugin);
                                        if (!config.authCodeUrl) {
                                            new Notice(t('settings.authCodeUnavailable'));
                                            return;
                                        }
                                        window.open(config.authCodeUrl, '_blank');
                                    } catch (err) {
                                        new Notice(t('settings.authCodeUnavailable'));
                                    }
                                });
                        });
                },
            },
            {
                name: t('settings.data'),
                searchable: false,
                render: (setting) => {
                    setting.setName(t('settings.data')).setHeading();
                },
            },
            {
                name: t('settings.clearData'),
                desc: t('settings.clearDataDesc'),
                render: (setting) => {
                    setting
                        .setName(t('settings.clearData'))
                        .setDesc(t('settings.clearDataDesc'))
                        .addButton((btn) => {
                            btn.setButtonText(t('settings.clearData'))
                                .setDestructive()
                                .onClick(() => {
                                    new ConfirmModal(
                                        this.app,
                                        t('settings.clearDataConfirm'),
                                        t('settings.clearDataConfirmDesc'),
                                        async () => {
                                            await this.plugin.clearAllData();
                                            new Notice(t('settings.clearDataDone'));
                                        },
                                    ).open();
                                });
                        });
                },
            },
        ];
    }
}

// 插件设置页
import { Notice, PluginSettingTab, type App, type ButtonComponent, type SettingDefinitionItem, type TextComponent } from 'obsidian';

import { t } from '../../core/i18n';
import type ParrotPlanPlugin from '../../../main';
import { ConfirmModal } from './confirm-modal';
import { getConfig } from '../../core/api/obconfig';
import { isApiConfigured } from '../../core/api/client';
import { activateLicense, getLicenseState } from '../../core/api/license';

/** UUID 格式校验（兼容带/不带连字符的 32 位十六进制） */
const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** 插件设置页 */
export class ParrotPlanSettingTab extends PluginSettingTab {
    private plugin: ParrotPlanPlugin;

    /** 授权码输入框（用于激活后回填与禁用） */
    private licenseInput?: TextComponent;

    /** 授权码提交按钮（用于激活后禁用） */
    private licenseSubmitButton?: ButtonComponent;

    constructor(app: App, plugin: ParrotPlanPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** 已激活时回填授权码并禁用输入框与提交按钮 */
    private async applyActivatedState(): Promise<void> {
        const state = await getLicenseState(this.app, this.plugin);
        if (!state.licenseKey) return;
        this.licenseInput?.setValue(state.licenseKey);
        this.licenseInput?.setDisabled(true);
        this.licenseSubmitButton?.setDisabled(true);
    }

    /** 提交授权码：校验格式后调用 activate 接口激活 */
    private async submitLicenseKey(btn: ButtonComponent): Promise<void> {
        const licenseKey = (this.licenseInput?.getValue() ?? '').trim();
        if (!licenseKey) {
            new Notice(t('settings.licenseKeyEmpty'));
            return;
        }
        if (!UUID_PATTERN.test(licenseKey)) {
            new Notice(t('settings.licenseKeyInvalid'));
            return;
        }

        btn.setDisabled(true);
        btn.setButtonText(t('settings.licenseActivating'));
        const result = await activateLicense(this.app, this.plugin, licenseKey);
        if (!result.success) {
            new Notice(t('settings.licenseActivateFailed', { msg: result.errMsg }));
            btn.setButtonText(t('settings.licenseKeySubmit'));
            btn.setDisabled(false);
            return;
        }
        new Notice(t('settings.licenseActivateSuccess'));
        const state = await getLicenseState(this.app, this.plugin);
        this.licenseInput?.setValue(state.licenseKey);
        this.licenseInput?.setDisabled(true);
        btn.setButtonText(t('settings.licenseActivated'));
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
                            this.licenseInput = text;
                        })
                        .addButton((btn) => {
                            btn.setButtonText(t('settings.licenseKeySubmit'))
                                .onClick(async () => {
                                    await this.submitLicenseKey(btn);
                                });
                            this.licenseSubmitButton = btn;
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
                    // 已激活时回填授权码并禁用输入与提交
                    void this.applyActivatedState();
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

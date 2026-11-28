// 插件设置页
import { Notice, PluginSettingTab, setIcon, type App, type ButtonComponent, type Setting, type SettingDefinitionItem, type TextComponent, type ToggleComponent } from 'obsidian';

import { t } from '../../core/i18n';
import type ParrotPlanPlugin from '../../../main';
import { MainView, VIEW_TYPE_MAIN } from '../../core/main-view';
import { ConfirmModal } from './confirm-modal';
import { getConfig } from '../../core/api/obconfig';
import { isApiConfigured } from '../../core/api/client';
import { activateLicense, deactivateDevice, getLicenseState, listDevices } from '../../core/api/license';
import { ObAuthCode, type ObAuthDevice } from '../../core/api/types';

/** UUID 格式校验（兼容带/不带连字符的 32 位十六进制） */
const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** 时间戳格式化为 YYYY-MM-DD HH:mm（无效时间戳返回空字符串） */
function formatDateTime(timestamp: number): string {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 插件设置页 */
export class ParrotPlanSettingTab extends PluginSettingTab {
    private plugin: ParrotPlanPlugin;

    /** 授权码设置项（用于激活后更新描述） */
    private licenseSetting?: Setting;

    /** 授权码输入框（用于激活后回填与禁用） */
    private licenseInput?: TextComponent;

    /** 授权码提交按钮（用于激活后禁用） */
    private licenseSubmitButton?: ButtonComponent;

    /** 「启用剧本模式」设置项（用于按实验性功能开关显隐） */
    private scriptModeSetting?: Setting;

    /** 「启用剧本模式」开关（用于关闭实验性功能时同步状态） */
    private scriptModeToggle?: ToggleComponent;

    constructor(app: App, plugin: ParrotPlanPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** 按「开启实验性功能」开关同步「启用剧本模式」行的显隐 */
    private updateScriptModeVisibility(): void {
        this.scriptModeSetting?.settingEl.toggleClass('is-hidden', !this.plugin.experimentalEnabled);
    }

    /** 开关变化后重新渲染已打开主视图的顶部工具栏（按最新开关决定按钮是否创建） */
    private rerenderTopBars(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN)) {
            if (leaf.view instanceof MainView) leaf.view.rerenderTopBar();
        }
    }

    /** 已激活时回填授权码、显示已授权并禁用输入与提交 */
    private async applyActivatedState(): Promise<void> {
        const state = await getLicenseState(this.app, this.plugin);
        if (!state.licenseKey) return;
        this.licenseInput?.setValue(state.licenseKey);
        this.licenseInput?.setDisabled(true);
        this.licenseSubmitButton?.setDisabled(true);
        this.licenseSubmitButton?.setButtonText(t('settings.licenseActivated'));
        this.licenseSetting?.setDesc(t('settings.licenseActivatedDesc'));
    }

    /** 打开设置页时按本地状态回填界面（不发起校验请求） */
    private async refreshLicenseState(): Promise<void> {
        const state = await getLicenseState(this.app, this.plugin);
        if (state.licenseKey && state.token) {
            await this.applyActivatedState();
            return;
        }
        // 未激活 / 授权已失效：恢复为未激活界面
        this.licenseInput?.setValue('');
        this.licenseInput?.setDisabled(false);
        this.licenseSubmitButton?.setDisabled(false);
        this.licenseSubmitButton?.setButtonText(t('settings.licenseKeySubmit'));
        this.licenseSetting?.setDesc(t('settings.licenseKeyDesc'));
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
            // 已被其他设备占用：在描述中列出当前绑定的设备
            if (result.code === ObAuthCode.BoundToOtherDevice) {
                this.renderBoundDevices(licenseKey, result.devices);
            }
            btn.setButtonText(t('settings.licenseKeySubmit'));
            btn.setDisabled(false);
            return;
        }
        new Notice(t('settings.licenseActivateSuccess'));
        this.licenseInput?.setValue(licenseKey);
        this.licenseInput?.setDisabled(true);
        btn.setButtonText(t('settings.licenseActivated'));
        this.licenseSetting?.setDesc(t('settings.licenseActivatedDesc'));
    }

    /** 在设置项描述中渲染「已绑定其他设备」列表（每行末尾带解绑按钮） */
    private renderBoundDevices(licenseKey: string, devices: ObAuthDevice[]): void {
        const descEl = this.licenseSetting?.descEl;
        if (!descEl) return;
        descEl.empty();
        descEl.createDiv({ text: t('settings.licenseBoundOther') });
        if (devices.length === 0) return;

        for (const device of devices) {
            const row = descEl.createDiv({ cls: 'parrot-license-device-row' });
            const os = device.clientOs || t('settings.licenseDeviceUnknownOs');
            const time = device.bindTime ? formatDateTime(device.bindTime) : '';
            row.createSpan({
                text: time
                    ? t('settings.licenseDeviceItem', { os, time })
                    : t('settings.licenseDeviceItemNoTime', { os }),
            });
            const removeBtn = row.createEl('button', {
                cls: 'parrot-license-device-remove',
                attr: { 'aria-label': t('settings.licenseDeviceRemove') },
            });
            setIcon(removeBtn, 'trash-2');
            removeBtn.onclick = () => {
                new ConfirmModal(
                    this.app,
                    t('settings.licenseDeviceRemoveConfirm'),
                    t('settings.licenseDeviceRemoveConfirmDesc'),
                    async () => {
                        await this.removeDevice(licenseKey, device);
                    },
                ).open();
            };
        }
    }

    /** 解绑指定设备：调用 deactivate 接口后刷新设备列表 */
    private async removeDevice(licenseKey: string, device: ObAuthDevice): Promise<void> {
        const result = await deactivateDevice(this.app, this.plugin, device);
        if (!result.success) {
            new Notice(t('settings.licenseDeviceRemoveFailed', { msg: result.errMsg }));
            return;
        }
        new Notice(t('settings.licenseDeviceRemoveDone'));
        const devices = await listDevices(licenseKey);
        this.renderBoundDevices(licenseKey, devices);
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
                name: t('settings.advanced'),
                searchable: false,
                render: (setting) => {
                    setting.setName(t('settings.advanced')).setHeading();
                },
            },
            {
                name: t('settings.licenseKey'),
                desc: t('settings.licenseKeyDesc'),
                render: (setting) => {
                    this.licenseSetting = setting;
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
                    // 打开设置页时校验授权状态，并按结果回填界面
                    void this.refreshLicenseState();
                },
            },
            {
                name: t('settings.experimental'),
                searchable: false,
                render: (setting) => {
                    setting.setName(t('settings.experimental')).setHeading();
                },
            },
            {
                name: t('settings.experimentalEnabled'),
                desc: t('settings.experimentalEnabledDesc'),
                render: (setting) => {
                    setting
                        .setName(t('settings.experimentalEnabled'))
                        .setDesc(t('settings.experimentalEnabledDesc'))
                        .addToggle((toggle) => {
                            toggle.setValue(this.plugin.experimentalEnabled).onChange(async (value) => {
                                await this.plugin.saveExperimentalEnabled(value);
                                // 关闭实验性功能会同时关闭剧本模式，需同步开关显示
                                this.scriptModeToggle?.setValue(this.plugin.scriptModeEnabled);
                                this.updateScriptModeVisibility();
                                this.rerenderTopBars();
                            });
                        });
                },
            },
            {
                name: t('settings.scriptModeEnabled'),
                desc: t('settings.scriptModeEnabledDesc'),
                render: (setting) => {
                    this.scriptModeSetting = setting;
                    setting
                        .setName(t('settings.scriptModeEnabled'))
                        .setDesc(t('settings.scriptModeEnabledDesc'))
                        .addToggle((toggle) => {
                            this.scriptModeToggle = toggle;
                            toggle.setValue(this.plugin.scriptModeEnabled).onChange(async (value) => {
                                await this.plugin.saveScriptModeEnabled(value);
                                this.rerenderTopBars();
                            });
                        });
                    // 仅在开启实验性功能后显示
                    this.updateScriptModeVisibility();
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

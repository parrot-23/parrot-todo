import type { App, Plugin } from 'obsidian';

/**
 * 插件实际所在目录（vault 相对路径）。
 *
 * 不能直接用 `manifest.id` 拼路径：插件文件夹名与 manifest.id 可能不一致
 * （例如从正式环境拷贝数据时带入了不同的 id），会导致数据文件读写到不存在的目录。
 * 优先使用 Obsidian 在加载时写入的 `manifest.dir`，取不到时再回退到 id。
 */
export function getPluginDir(app: App, plugin: Plugin): string {
    const dir = plugin.manifest.dir;
    if (dir) return dir.replace(/\\/g, '/').replace(/\/+$/, '');
    return `${app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

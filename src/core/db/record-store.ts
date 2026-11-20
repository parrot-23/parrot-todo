// 记录卡片填写结果的数据存储层：基于 sql.js（SQLite 编译为 WASM）读写 .db 文件。
// 数据库按年度拆分为插件目录下的 data-YYYY.db（与 data.json / data-YYYY.json 同级），
// 写入按记录自身 day_key 的年份路由，查询跨年度时合并所有年度库的结果。
import type { App } from 'obsidian';
// 使用浏览器构建（无 node:fs/node:crypto 顶层 require，避免插件加载时报错）
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
// .wasm 由 @rollup/plugin-url 构建期内联为 base64 data URL
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm';

import type { OkrRecordEntry } from '../datatypes/domain';

/** 年度 .db 文件名格式（如 data-2026.db） */
const DB_FILE_PATTERN = /^data-(\d{4})\.db$/;

/** 建表语句：记录卡片填写结果表 + 按任务/日期索引（为后续聚合查询预留） */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS record_entries (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  values_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_record_entries_inbox ON record_entries(inbox_id);
CREATE INDEX IF NOT EXISTS idx_record_entries_day ON record_entries(day_key);
`;

/** sql.js 的 Database 实例类型（避免依赖 export = 的具名类型导入） */
type SqlDatabase = InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;
/** sql.js 模块类型（用于按年度新建数据库） */
type SqlStatic = Awaited<ReturnType<typeof initSqlJs>>;

/** 把内联的 base64 data URL 解码为 ArrayBuffer（作为 wasmBinary 传入 initSqlJs） */
function decodeWasm(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const buf = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return buf;
}

/** 从日键（如 2026-10-16）取年份 */
function yearFromDayKey(key?: string): number | null {
    if (!key) return null;
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(key);
    return m ? Number(m[1]) : null;
}

/** 把行数据解析为记录条目（values_json 非法时保留空 values） */
function parseRow(row: Record<string, unknown>): OkrRecordEntry {
    let values: Record<string, string | number | boolean> = {};
    try {
        const parsed = JSON.parse(String(row.values_json));
        if (parsed && typeof parsed === 'object') values = parsed as Record<string, string | number | boolean>;
    } catch {
        // 非法 JSON 忽略，保留空 values
    }
    return {
        id: String(row.id),
        recordId: String(row.record_id),
        inboxId: String(row.inbox_id),
        dayKey: String(row.day_key),
        createdAt: Number(row.created_at),
        values,
    };
}

let storeInstance: RecordStore | null = null;

/** 获取进程内唯一的记录存储实例（懒加载，首次使用时初始化） */
export function getRecordStore(app: App, pluginId: string): RecordStore {
    if (!storeInstance) storeInstance = new RecordStore(app, pluginId);
    return storeInstance;
}

/**
 * 旧版单库迁移入口：仅当检测到旧路径的 .db 文件时才初始化并迁移，
 * 避免每次启动都加载 wasm。迁移完成后删除旧文件。
 */
export async function migrateLegacyRecordDb(app: App, pluginId: string): Promise<void> {
    const store = getRecordStore(app, pluginId);
    if (await store.hasLegacyDb()) await store.init();
}

/**
 * 记录存储：按年度管理多个 sql.js 数据库文件。
 * 写入采用「内存数据库 → export → 整库写回 data-YYYY.db」的快照式落盘。
 */
export class RecordStore {
    private SQL: SqlStatic | null = null;
    private initPromise: Promise<void> | null = null;
    /** 年度 → 已打开的数据库实例 */
    private readonly dbs = new Map<number, SqlDatabase>();
    /** 插件目录（vault 相对路径） */
    private readonly pluginDir: string;

    constructor(private app: App, pluginId: string) {
        this.pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
    }

    /** 初始化（幂等）：加载 wasm，并把旧版单库迁移为年度库 */
    init(): Promise<void> {
        if (!this.initPromise) this.initPromise = this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        this.SQL = await initSqlJs({ wasmBinary: decodeWasm(wasmUrl) });
        await this.migrateLegacy();
    }

    /** 旧版单库路径（插件目录 db/ 与 vault 根目录 .parrot-plan/db/） */
    private legacyPaths(): string[] {
        return [
            `${this.pluginDir}/db/parrot-plan.db`,
            '.parrot-plan/db/parrot-plan.db',
        ];
    }

    /** 是否存在待迁移的旧版单库 */
    async hasLegacyDb(): Promise<boolean> {
        const adapter = this.app.vault.adapter;
        for (const path of this.legacyPaths()) {
            if (await adapter.exists(path)) return true;
        }
        return false;
    }

    /** 某年度的库文件路径 */
    private yearDbPath(year: number): string {
        return `${this.pluginDir}/data-${year}.db`;
    }

    /** 打开指定年度的库（懒加载；不存在则新建并确保表结构） */
    private async open(year: number): Promise<SqlDatabase> {
        const cached = this.dbs.get(year);
        if (cached) return cached;
        if (!this.SQL) throw new Error('RecordStore 尚未初始化');
        const adapter = this.app.vault.adapter;
        const path = this.yearDbPath(year);
        const db = await adapter.exists(path)
            ? new this.SQL.Database(new Uint8Array(await adapter.readBinary(path)))
            : new this.SQL.Database();
        db.run(SCHEMA);
        this.dbs.set(year, db);
        return db;
    }

    /** 将某年度内存库整库导出并写回 data-YYYY.db */
    private async persist(year: number): Promise<void> {
        const db = this.dbs.get(year);
        if (!db) return;
        const adapter = this.app.vault.adapter;
        // Obsidian 的 writeBinary 不会自动创建父目录，需先确保目录存在
        if (!(await adapter.exists(this.pluginDir))) {
            await adapter.mkdir(this.pluginDir);
        }
        await adapter.writeBinary(this.yearDbPath(year), db.export());
    }

    /** 写入一条记录（按 dayKey 年份路由，INSERT OR REPLACE 幂等），并立即落盘 */
    async insertEntry(entry: OkrRecordEntry): Promise<void> {
        await this.init();
        const year = yearFromDayKey(entry.dayKey) ?? new Date().getFullYear();
        const db = await this.open(year);
        db.run(
            'INSERT OR REPLACE INTO record_entries (id, record_id, inbox_id, day_key, created_at, values_json) VALUES (?, ?, ?, ?, ?, ?)',
            [entry.id, entry.recordId, entry.inboxId, entry.dayKey, entry.createdAt, JSON.stringify(entry.values)],
        );
        await this.persist(year);
    }

    /**
     * 按任务 id 查询该任务的全部填写记录（跨年度合并所有年度库）。
     * 排序与单库一致：日期倒序、创建时间倒序，最新在前。
     */
    async listEntriesByInbox(inboxId: string): Promise<OkrRecordEntry[]> {
        await this.init();
        const results: OkrRecordEntry[] = [];
        for (const year of await this.listYears()) {
            const db = await this.open(year);
            const stmt = db.prepare(
                'SELECT id, record_id, inbox_id, day_key, created_at, values_json FROM record_entries WHERE inbox_id = ? ORDER BY day_key DESC, created_at DESC',
            );
            try {
                stmt.bind([inboxId]);
                while (stmt.step()) {
                    results.push(parseRow(stmt.getAsObject() as Record<string, unknown>));
                }
            } finally {
                stmt.free();
            }
        }
        results.sort((a, b) => {
            if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? 1 : -1;
            return b.createdAt - a.createdAt;
        });
        return results;
    }

    /** 列出现有年度库的年份（升序） */
    private async listYears(): Promise<number[]> {
        const adapter = this.app.vault.adapter;
        try {
            const listing = await adapter.list(this.pluginDir);
            const years: number[] = [];
            for (const file of listing.files) {
                const name = file.split('/').pop() ?? '';
                const m = DB_FILE_PATTERN.exec(name);
                if (m) years.push(Number(m[1]));
            }
            return years.sort((a, b) => a - b);
        } catch {
            return [];
        }
    }

    /** 删除所有年度库（清空数据用） */
    async clearAll(): Promise<void> {
        const adapter = this.app.vault.adapter;
        for (const year of await this.listYears()) {
            this.dbs.get(year)?.close();
            this.dbs.delete(year);
            try {
                await adapter.remove(this.yearDbPath(year));
            } catch {
                // 忽略删除失败
            }
        }
        this.initPromise = null;
    }

    /** 迁移旧版单库：按 day_key 年份拆分写入年度库，成功后删除旧文件 */
    private async migrateLegacy(): Promise<void> {
        if (!this.SQL) return;
        const adapter = this.app.vault.adapter;
        for (const path of this.legacyPaths()) {
            if (!(await adapter.exists(path))) continue;
            try {
                const legacy = new this.SQL.Database(new Uint8Array(await adapter.readBinary(path)));
                const rows: OkrRecordEntry[] = [];
                try {
                    const stmt = legacy.prepare(
                        'SELECT id, record_id, inbox_id, day_key, created_at, values_json FROM record_entries',
                    );
                    try {
                        while (stmt.step()) {
                            rows.push(parseRow(stmt.getAsObject() as Record<string, unknown>));
                        }
                    } finally {
                        stmt.free();
                    }
                } catch {
                    // 旧库没有该表：视为空库
                }

                const touched = new Set<number>();
                for (const entry of rows) {
                    const year = yearFromDayKey(entry.dayKey) ?? new Date().getFullYear();
                    const db = await this.open(year);
                    db.run(
                        'INSERT OR REPLACE INTO record_entries (id, record_id, inbox_id, day_key, created_at, values_json) VALUES (?, ?, ?, ?, ?, ?)',
                        [entry.id, entry.recordId, entry.inboxId, entry.dayKey, entry.createdAt, JSON.stringify(entry.values)],
                    );
                    touched.add(year);
                }
                for (const year of Array.from(touched)) await this.persist(year);

                legacy.close();
                await adapter.remove(path);
            } catch {
                // 迁移失败时保留旧文件，避免数据丢失
            }
        }
    }
}

import { z } from "zod";
import BaseModel from "./baseModel.js";

import type { Database } from "better-sqlite3";

export const WatchUploadRecordStatus = z.enum(["pending", "uploading", "success", "error"]);
export type WatchUploadRecordStatus = z.infer<typeof WatchUploadRecordStatus>;

const BaseWatchUploadRecord = z.object({
  /** 文件路径 */
  path: z.string(),
  /** 文件大小 */
  size: z.number(),
  /** 文件最后修改时间 */
  mtime: z.number(),
  /** 状态 */
  status: WatchUploadRecordStatus,
  /** 监听配置 id */
  config_id: z.string(),
  /** 上传任务 id */
  task_id: z.string().nullable(),
  /** 错误信息 */
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type BaseWatchUploadRecord = z.infer<typeof BaseWatchUploadRecord>;
export type WatchUploadRecord = BaseWatchUploadRecord & { id: number };

export default class WatchUploadRecordModel extends BaseModel<BaseWatchUploadRecord> {
  constructor({ db }: { db: Database }) {
    super(db, "watch_upload_record");
    this.createTable();
  }

  async createTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,               -- 自增主键
        path TEXT NOT NULL,                                 -- 文件路径
        size INTEGER NOT NULL DEFAULT 0,                    -- 文件大小
        mtime INTEGER NOT NULL DEFAULT 0,                   -- 文件最后修改时间
        status TEXT NOT NULL DEFAULT 'pending',             -- 状态
        config_id TEXT NOT NULL DEFAULT '',                 -- 监听配置 id
        task_id TEXT,                                       -- 上传任务 id
        error TEXT,                                         -- 错误信息
        created_at INTEGER NOT NULL,                        -- 创建时间
        updated_at INTEGER NOT NULL                         -- 更新时间
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_upload_record_path ON ${this.tableName} (path);
      CREATE INDEX IF NOT EXISTS idx_watch_upload_record_config_id ON ${this.tableName} (config_id);
    `;
    return super.createTable(createTableSQL);
  }

  add(options: Omit<BaseWatchUploadRecord, "created_at" | "updated_at">) {
    const now = Date.now();
    const data = BaseWatchUploadRecord.parse({
      ...options,
      // 表是 STRICT 的，INTEGER 列不能存浮点数（fs.stat 返回的 mtimeMs 是浮点）
      size: Math.round(options.size),
      mtime: Math.round(options.mtime),
      created_at: now,
      updated_at: now,
    });
    return this.insert(data);
  }

  /**
   * 查询「已处理」的文件路径，用于过滤掉不需要再上传的文件
   *
   * 只有这几种情况才算已处理：
   * - status = success：已经上传成功
   * - status = uploading：正在上传
   * - status = error 且 updated_at 在 cooldownMs 内：刚失败，先不重试
   *
   * 也就是说失败的文件会在冷却时间后自动重试，不会因为一次失败就永远不上传。
   */
  filterNewPaths(paths: string[], cooldownMs = 5 * 60 * 1000): string[] {
    if (paths.length === 0) return [];

    const placeholders = paths.map(() => "?").join(", ");
    const sql = `SELECT path FROM ${this.tableName}
      WHERE path IN (${placeholders})
        AND (status IN ('success', 'uploading') OR updated_at > ?)`;
    const rows = this.db.prepare(sql).all(...paths, Date.now() - cooldownMs) as {
      path: string;
    }[];
    const exists = new Set(rows.map((item) => item.path));
    return paths.filter((item) => !exists.has(item));
  }

  /**
   * 把遗留的「上传中」记录标记为失败（软件重启后不可能还有正在进行的上传）
   *
   * updated_at 置 0 是为了跳过重试冷却，让这些文件在下次扫描时立刻重新上传
   */
  markAllUploadingAsError(error = "上传中断（软件重启）") {
    const sql = `UPDATE ${this.tableName} SET status = 'error', error = ?, updated_at = 0 WHERE status = 'uploading'`;
    return this.db.prepare(sql).run(error);
  }

  listRecent(options: { limit?: number; configId?: string } = {}) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.configId) {
      conditions.push("config_id = ?");
      values.push(options.configId);
    }
    values.push(options.limit ?? 200);

    const sql = `SELECT * FROM ${this.tableName}${
      conditions.length ? " WHERE " + conditions.join(" AND ") : ""
    } ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...values) as WatchUploadRecord[];
  }

  updateStatus(options: {
    id: number;
    status: WatchUploadRecordStatus;
    taskId?: string | null;
    error?: string | null;
    size?: number;
    mtime?: number;
  }) {
    const sets = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [options.status, Date.now()];

    if (options.taskId !== undefined) {
      sets.push("task_id = ?");
      values.push(options.taskId);
    }
    if (options.error !== undefined) {
      sets.push("error = ?");
      values.push(options.error);
    }
    if (options.size !== undefined) {
      sets.push("size = ?");
      values.push(Math.round(options.size));
    }
    if (options.mtime !== undefined) {
      sets.push("mtime = ?");
      values.push(Math.round(options.mtime));
    }

    values.push(options.id);
    const sql = `UPDATE ${this.tableName} SET ${sets.join(", ")} WHERE id = ?`;
    return this.db.prepare(sql).run(...values);
  }

  deleteById(id: number) {
    const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
    return this.db.prepare(sql).run(id);
  }

  deleteByPath(path: string) {
    const sql = `DELETE FROM ${this.tableName} WHERE path = ?`;
    return this.db.prepare(sql).run(path);
  }

  /** 清空记录，可只清理已成功上传的记录 */
  clear(options: { onlySuccess?: boolean } = {}) {
    if (options.onlySuccess) {
      const sql = `DELETE FROM ${this.tableName} WHERE status = 'success'`;
      return this.db.prepare(sql).run();
    }
    const sql = `DELETE FROM ${this.tableName}`;
    return this.db.prepare(sql).run();
  }
}

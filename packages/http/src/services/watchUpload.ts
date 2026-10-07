import path from "node:path";
import fs from "fs-extra";
import axios from "axios";
import { VideoPreset, DEFAULT_BILIUP_CONFIG } from "@biliLive-tools/shared";
import { biliApi } from "@biliLive-tools/shared/task/bili.js";
import { taskQueue } from "@biliLive-tools/shared/task/task.js";
import { watchUploadRecordService } from "@biliLive-tools/shared/db/index.js";
import log from "@biliLive-tools/shared/utils/log.js";

import type { AppConfig } from "@biliLive-tools/shared/config.js";
import type { AppConfig as GlobalAppConfig, BiliupConfig } from "@biliLive-tools/types";

/** 从各种错误里取出可读的信息（HTTP 接口的错误信息在 response.data 里） */
const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object" && "message" in data) {
      return String((data as { message: unknown }).message);
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
};

export type WatchUploadConfigItem = GlobalAppConfig["watchUpload"]["config"][number];

/** 默认监听的视频文件后缀 */
const DEFAULT_FILE_MATCH_REGEX = "\\.(mp4|flv|mkv|ts|m4s)$";
/** 轮询间隔下限（秒），避免配置过小导致频繁扫描 */
const MIN_INTERVAL_SECONDS = 10;
/** 最新文件的等待时间默认值：1 天（超过这个时间没变化就认为录制已经结束，自动上传） */
export const DEFAULT_SILENT_SECONDS = 24 * 60 * 60;

/** 除最新文件外的普通文件，至少等一轮扫描且大小不再变化才会上传 */
const MIN_SILENT_MS = 10 * 1000;

export type PendingFile = {
  configId: string;
  folder: string;
  path: string;
  filename: string;
  size: number;
  mtime: number;
  /**
   * latest：最新文件，静默时间（默认 1 天）还没到<br/>
   * skipped：开启了「跳过最新文件」，永不自动上传<br/>
   * silent：刚被写入，等下一轮扫描<br/>
   * unstable：文件大小仍在变化，可能正在写入
   */
  reason: "latest" | "skipped" | "silent" | "unstable";
};

type FolderFile = {
  path: string;
  filename: string;
  size: number;
  mtime: number;
};

export type WatchUploadStatusItem = {
  id: string;
  switch: boolean;
  watchFolder: string;
  folderExists: boolean;
  hasLogin: boolean;
  uid: number | null;
  intervalSeconds: number;
  silentSeconds: number;
  skipLatest: boolean;
  preset: { id: string; name: string; title?: string; partTitleTemplate?: string } | null;
  /** 文件夹里匹配到的文件数 */
  fileCount: number;
  /** 会被跳过的最新文件 */
  skippedLatest: string | null;
  /** 等待上传的文件 */
  waiting: { filename: string; reason: PendingFile["reason"] }[];
  /** 本次可以上传的文件 */
  readyToUpload: string[];
  successCount: number;
  errorCount: number;
  uploadingCount: number;
  lastError: string | null;
};

/**
 * 监听上传
 *
 * 周期性扫描配置的文件夹，把新出现的视频自动加入 B站上传任务队列（使用配置里选择的
 * 上传预设，与「B站上传」页面走的是同一个上传入口）。
 *
 * 判断文件是否已经写完：静默时间（距最后修改时间）+ 文件大小稳定（与上一轮扫描一致），
 * 因此最后录的那个视频也会被上传，不需要等新文件出现。
 * 如果担心「暂停录像」被误传，可以打开配置里的「跳过最新文件」。
 */
export class WatchUploadService {
  private appConfig: AppConfig;
  private videoPreset: VideoPreset;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  /** 上一轮扫描到的文件大小，用于判断文件是否仍在写入 */
  private fileSizeCache = new Map<string, number>();

  constructor(appConfig: AppConfig, videoPresetPath: string) {
    this.appConfig = appConfig;
    this.videoPreset = new VideoPreset({
      globalConfig: { videoPresetPath },
    });
  }

  /** 启动轮询（会立即先执行一次，用于软件启动时自动上传） */
  start() {
    this.stopped = false;
    // 静默时间的含义变更过，旧的小值统一重置为 1 天
    try {
      this.migrateConfig();
    } catch (error) {
      log.error("监听上传：迁移配置失败", error);
    }
    // 软件重启后不可能还有正在进行的上传，把遗留的「上传中」标记为失败以便重试
    try {
      const result = watchUploadRecordService.markAllUploadingAsError();
      if (result.changes) {
        log.warn(`监听上传：${result.changes} 个上传中断的记录已标记为失败，将会重新上传`);
      }
    } catch (error) {
      log.error("监听上传：重置中断记录失败", error);
    }
    void this.loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private getConfigList(): WatchUploadConfigItem[] {
    return this.appConfig.get("watchUpload")?.config ?? [];
  }

  /**
   * 迁移旧配置：静默时间的含义已从「文件的静默时间」改为「最新文件的等待时间」，
   * 旧的小值（如 60 秒）没有意义，统一重置为默认的 1 天
   */
  private migrateConfig() {
    const list = this.getConfigList();
    let changed = false;
    const next = list.map((item) => {
      if (item.silentSeconds > 60) return item;
      changed = true;
      return { ...item, silentSeconds: DEFAULT_SILENT_SECONDS };
    });

    if (changed) {
      log.info("监听上传：静默时间的含义已变更，旧配置已重置为 1 天（最新文件的等待时间）");
      this.appConfig.set("watchUpload", { config: next });
    }
  }

  private getIntervalSeconds() {
    const intervals = this.getConfigList()
      .filter((item) => item.switch)
      .map((item) => Number(item.intervalSeconds) || MIN_INTERVAL_SECONDS);
    const min = intervals.length ? Math.min(...intervals) : 60;
    return Math.max(MIN_INTERVAL_SECONDS, min);
  }

  private async loop() {
    if (this.stopped) return;

    try {
      await this.checkOnce();
    } catch (error) {
      log.error("监听上传检查失败", error);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          void this.loop();
        }, this.getIntervalSeconds() * 1000);
      }
    }
  }

  /** 扫描所有启用的配置并上传新文件 */
  async checkOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const uid = this.appConfig.get("uid");
      if (!uid) {
        log.warn("监听上传：未登录B站账号，跳过本轮检查");
        return;
      }

      for (const item of this.getConfigList()) {
        if (!item.switch) continue;
        try {
          await this.checkConfig(item, uid);
        } catch (error) {
          log.error(`监听上传：处理配置 ${item.watchFolder} 失败`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async checkConfig(item: WatchUploadConfigItem, uid: number) {
    if (!item.watchFolder) return;
    if (!(await fs.pathExists(item.watchFolder))) {
      log.warn(`监听上传：文件夹不存在 ${item.watchFolder}`);
      return;
    }

    const files = await this.collectFiles(item);
    if (files.length === 0) return;

    // 用上一轮的大小判断文件是否仍在写入
    const prevSizes = this.fileSizeCache;

    const { ready } = this.evaluateFiles(item, files, prevSizes);
    const newPaths = new Set(
      watchUploadRecordService.filterNewPaths(ready.map((file) => file.path)),
    );

    for (const file of ready) {
      if (!newPaths.has(file.path)) continue;
      try {
        await this.uploadFile(file, item, uid);
      } catch (error) {
        log.error(`监听上传：上传失败 ${file.path}`, error);
      }
    }

    // 放在最后更新，保证本轮判定用的是上一轮的大小
    this.fileSizeCache = new Map(files.map((file) => [file.path, file.size]));
  }

  /**
   * 把文件夹里的文件分成「可以上传」和「还需要等待」
   *
   * 判定规则：
   * 1. 开启了「跳过最新文件」时，最新文件永不自动上传
   * 2. 刚被修改过的文件（不足一轮扫描）先等一等
   * 3. 文件大小相比上一轮还在变化，说明仍在写入，继续等
   * 4. 最新文件需要超过「静默时间」（默认 1 天）才认为录制已经彻底结束，否则先不上传
   * 5. 其余文件（已经有更新的文件出现，说明它们已经写完了）直接上传
   */
  private evaluateFiles(
    item: WatchUploadConfigItem,
    files: FolderFile[],
    prevSizes: Map<string, number>,
  ): {
    ready: FolderFile[];
    waiting: { file: FolderFile; reason: PendingFile["reason"] }[];
  } {
    const now = Date.now();
    const latest = files.length > 0 ? files[files.length - 1] : undefined;
    const latestPath = latest?.path;
    const minSilentMs = Math.max(MIN_SILENT_MS, this.getIntervalSeconds() * 1000);
    const silentMs = Math.max(0, item.silentSeconds || 0) * 1000;

    const result: {
      ready: FolderFile[];
      waiting: { file: FolderFile; reason: PendingFile["reason"] }[];
    } = { ready: [], waiting: [] };

    for (const file of files) {
      const isLatest = file.path === latestPath;

      if (isLatest && item.skipLatest) {
        result.waiting.push({ file, reason: "skipped" });
        continue;
      }

      // 刚被写入，至少等一轮扫描
      if (now - file.mtime < minSilentMs) {
        result.waiting.push({ file, reason: "silent" });
        continue;
      }

      // 大小还在变，说明仍在写入
      const prevSize = prevSizes.get(file.path);
      if (prevSize !== undefined && prevSize !== file.size) {
        result.waiting.push({ file, reason: "unstable" });
        continue;
      }

      // 最新文件要等满静默时间才上传
      if (isLatest && silentMs > 0 && now - file.mtime < silentMs) {
        result.waiting.push({ file, reason: "latest" });
        continue;
      }

      result.ready.push(file);
    }

    return result;
  }

  /** 手动上传被跳过的文件 */
  async uploadNow(filePath: string, configId: string) {
    const uid = this.appConfig.get("uid");
    if (!uid) {
      throw new Error("未登录B站账号");
    }

    const item = this.getConfigList().find((item) => item.id === configId);
    if (!item) {
      throw new Error("监听配置不存在");
    }

    // 只允许上传监听文件夹内的文件
    const folder = path.resolve(item.watchFolder);
    const target = path.resolve(filePath);
    if (!target.startsWith(folder + path.sep)) {
      throw new Error("文件不在监听文件夹内");
    }
    if (!(await fs.pathExists(target))) {
      throw new Error("文件不存在");
    }

    const stat = await fs.stat(target);
    const file: FolderFile = {
      path: target,
      filename: path.basename(target),
      size: Math.floor(stat.size),
      // mtimeMs 是浮点数，而数据库列是 INTEGER（STRICT 表），必须取整
      mtime: Math.floor(stat.mtimeMs),
    };
    return this.uploadFile(file, item, uid);
  }

  /** 获取等待中的文件（页面"等待区"） */
  async getPending(configId?: string): Promise<PendingFile[]> {
    const result: PendingFile[] = [];
    const prevSizes = this.fileSizeCache;

    for (const item of this.getConfigList()) {
      if (!item.switch) continue;
      if (configId && item.id !== configId) continue;
      if (!item.watchFolder) continue;
      if (!(await fs.pathExists(item.watchFolder))) continue;

      try {
        const files = await this.collectFiles(item);
        if (files.length === 0) continue;

        const { waiting } = this.evaluateFiles(item, files, prevSizes);
        const newPaths = new Set(
          watchUploadRecordService.filterNewPaths(waiting.map((item) => item.file.path)),
        );

        for (const { file, reason } of waiting) {
          if (!newPaths.has(file.path)) continue;
          result.push(this.toPendingFile(item, file, reason));
        }
      } catch (error) {
        log.error(`监听上传：读取等待文件失败 ${item.watchFolder}`, error);
      }
    }

    return result;
  }

  /**
   * 获取每个监听配置的当前状态（用于页面上排查「为什么没上传」）
   */
  async getStatus(): Promise<WatchUploadStatusItem[]> {
    const uid = this.appConfig.get("uid") ?? null;
    const prevSizes = this.fileSizeCache;
    const result: WatchUploadStatusItem[] = [];

    for (const item of this.getConfigList()) {
      const folderExists = !!item.watchFolder && (await fs.pathExists(item.watchFolder));
      const files = folderExists ? await this.collectFiles(item) : [];

      const skippedLatest =
        item.skipLatest && files.length > 0 ? files[files.length - 1] : undefined;
      const { ready, waiting } = this.evaluateFiles(item, files, prevSizes);
      const newPaths = new Set(
        watchUploadRecordService.filterNewPaths(
          [...ready, ...waiting.map((item) => item.file)].map((file) => file.path),
        ),
      );
      const pendingFiles = waiting.filter((item) => newPaths.has(item.file.path));

      let preset: WatchUploadStatusItem["preset"] = null;
      try {
        const data = await this.videoPreset.get(item.uploadPresetId);
        preset = data
          ? {
              id: data.id,
              name: data.name,
              title: data.config?.title,
              partTitleTemplate: data.config?.partTitleTemplate,
            }
          : null;
      } catch (error) {
        preset = null;
      }

      const records = watchUploadRecordService.list({ configId: item.id, limit: 1000 });

      result.push({
        id: item.id,
        switch: item.switch,
        watchFolder: item.watchFolder,
        folderExists,
        hasLogin: !!uid,
        uid,
        intervalSeconds: item.intervalSeconds,
        silentSeconds: item.silentSeconds,
        skipLatest: item.skipLatest,
        preset,
        /** 文件夹里匹配到的文件数 */
        fileCount: files.length,
        /** 会被跳过的最新文件 */
        skippedLatest: skippedLatest?.filename ?? null,
        /** 等待上传的文件 */
        waiting: pendingFiles.map((item) => ({
          filename: item.file.filename,
          reason: item.reason,
        })),
        /** 本次可以上传的文件 */
        readyToUpload: ready.filter((file) => newPaths.has(file.path)).map((file) => file.filename),
        /** 已上传成功 / 失败的数量 */
        successCount: records.filter((record) => record.status === "success").length,
        errorCount: records.filter((record) => record.status === "error").length,
        uploadingCount: records.filter((record) => record.status === "uploading").length,
        lastError: records.find((record) => record.status === "error")?.error ?? null,
      });
    }

    return result;
  }

  private toPendingFile(
    item: WatchUploadConfigItem,
    file: FolderFile,
    reason: PendingFile["reason"],
  ): PendingFile {
    return {
      configId: item.id,
      folder: item.watchFolder,
      path: file.path,
      filename: file.filename,
      size: file.size,
      mtime: file.mtime,
      reason,
    };
  }

  /** 列出文件夹中匹配的文件，按修改时间从旧到新排序 */
  private async collectFiles(item: WatchUploadConfigItem): Promise<FolderFile[]> {
    const files = await fs.readdir(item.watchFolder);
    const matchRegex = this.buildRegex(item.fileMatchRegex, DEFAULT_FILE_MATCH_REGEX);
    const ignoreRegex = item.ignoreFileRegex ? this.buildRegex(item.ignoreFileRegex, "") : null;

    const result: FolderFile[] = [];
    for (const filename of files) {
      if (!matchRegex.test(filename)) continue;
      if (ignoreRegex?.test(filename)) continue;

      const filePath = path.join(item.watchFolder, filename);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        result.push({
          path: filePath,
          filename,
          size: Math.floor(stat.size),
          // mtimeMs 是浮点数，而数据库列是 INTEGER（STRICT 表），必须取整
          mtime: Math.floor(stat.mtimeMs),
        });
      } catch (error) {
        log.warn(`监听上传：读取文件信息失败 ${filePath}`, error);
      }
    }

    return result.sort((a, b) => a.mtime - b.mtime);
  }

  private buildRegex(source: string, fallback: string) {
    try {
      return new RegExp(source || fallback);
    } catch (error) {
      log.error(`监听上传：正则表达式解析失败 ${source}，使用默认规则`, error);
      return new RegExp(fallback || ".*");
    }
  }

  private async prepareUploadConfig(presetId: string): Promise<BiliupConfig> {
    let presetConfig: Partial<BiliupConfig> = {};
    try {
      const preset = await this.videoPreset.get(presetId);
      presetConfig = preset?.config ?? {};
    } catch (error) {
      log.warn(`监听上传：未找到上传预设 ${presetId}，使用默认配置`, error);
    }
    return { ...DEFAULT_BILIUP_CONFIG, ...presetConfig };
  }

  /** 创建上传任务并写入记录 */
  private async uploadFile(file: FolderFile, item: WatchUploadConfigItem, uid: number) {
    const config = await this.prepareUploadConfig(item.uploadPresetId);

    // 与「B站上传」页一样先校验投稿参数，不合法时直接记录错误，避免提交后才发现
    const [valid, message] = biliApi.validateBiliupConfig(config);
    if (!valid) {
      const error = `投稿预设校验失败：${message}`;
      log.error(`监听上传：${error}（${file.path}，预设 ${item.uploadPresetId}）`);
      watchUploadRecordService.deleteByPath(file.path);
      watchUploadRecordService.add({
        path: file.path,
        size: file.size,
        mtime: file.mtime,
        status: "error",
        config_id: item.id,
        task_id: null,
        error,
      });
      return { taskId: "" };
    }

    // 手动重传时先重置旧记录，避免唯一索引冲突
    watchUploadRecordService.deleteByPath(file.path);
    const recordId = watchUploadRecordService.add({
      path: file.path,
      size: file.size,
      mtime: file.mtime,
      status: "uploading",
      config_id: item.id,
      task_id: null,
      error: null,
    });

    log.info(
      `监听上传：添加任务 ${file.path}｜预设=${item.uploadPresetId}｜标题模板=${JSON.stringify(
        config.title,
      )}｜分P标题模板=${JSON.stringify(config.partTitleTemplate)}`,
    );

    try {
      // 与「B站上传」页的「立即上传」完全一致：走 POST /bili/upload
      const { taskId } = await this.requestUpload({
        uid,
        videos: [{ path: file.path, title: path.parse(file.path).name }],
        config,
        options: {
          removeOriginAfterUploadCheck: item.removeOriginAfterUploadCheck,
        },
      });

      watchUploadRecordService.updateStatus({
        id: Number(recordId),
        status: "uploading",
        taskId,
        error: null,
      });
      this.bindTaskEvents(taskId, recordId, file.path);

      return { taskId };
    } catch (error) {
      const message = getErrorMessage(error);
      log.error(`监听上传：上传失败 ${file.path}：${message}`);
      watchUploadRecordService.updateStatus({
        id: Number(recordId),
        status: "error",
        error: message,
      });
      throw new Error(message);
    }
  }

  /**
   * 调用「B站上传」页使用的上传接口
   *
   * 这里刻意走一次 HTTP，而不是直接调用 shared 里的函数，
   * 目的就是和页面上点「立即上传」走完全相同的路径（同一套参数校验、同一个任务队列）。
   */
  private async requestUpload(payload: {
    uid: number;
    videos: { path: string; title: string }[];
    config: BiliupConfig;
    options: { removeOriginAfterUploadCheck: boolean };
  }): Promise<{ taskId: string }> {
    const host = this.appConfig.get("host");
    const port = this.appConfig.get("port");
    const passKey = this.appConfig.get("passKey");
    // 监听 0.0.0.0 时不能直接请求，换成回环地址
    const target = !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

    const res = await axios.post(`http://${target}:${port}/bili/upload`, payload, {
      headers: {
        Authorization: passKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      proxy: false,
    });
    return res.data;
  }

  /** 订阅任务事件回写上传结果（通过 HTTP 提交时拿不到任务对象） */
  private bindTaskEvents(taskId: string, recordId: number | bigint, filePath: string) {
    const onEnd = ({ taskId: id }: { taskId: string }) => {
      if (id !== taskId) return;
      taskQueue.off("task-end", onEnd);
      taskQueue.off("task-error", onError);
      log.info(`监听上传：上传成功 ${filePath}`);
      watchUploadRecordService.updateStatus({
        id: Number(recordId),
        status: "success",
        error: null,
      });
    };
    const onError = ({ taskId: id, error }: { taskId: string; error: unknown }) => {
      if (id !== taskId) return;
      taskQueue.off("task-end", onEnd);
      taskQueue.off("task-error", onError);
      const message = error ? String(error) : "上传失败";
      log.error(`监听上传：上传失败 ${filePath}：${message}`);
      watchUploadRecordService.updateStatus({
        id: Number(recordId),
        status: "error",
        error: message,
      });
    };

    taskQueue.on("task-end", onEnd);
    taskQueue.on("task-error", onError);
  }
}

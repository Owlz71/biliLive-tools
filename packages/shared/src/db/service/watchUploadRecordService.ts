import type WatchUploadRecordModel from "../model/watchUploadRecord.js";
import type { WatchUploadRecordStatus } from "../model/watchUploadRecord.js";

export default class WatchUploadRecordService {
  private watchUploadRecordModel: WatchUploadRecordModel;

  constructor({ watchUploadRecordModel }: { watchUploadRecordModel: WatchUploadRecordModel }) {
    this.watchUploadRecordModel = watchUploadRecordModel;
  }

  add(options: {
    path: string;
    size: number;
    mtime: number;
    status: WatchUploadRecordStatus;
    config_id: string;
    task_id: string | null;
    error: string | null;
  }) {
    return this.watchUploadRecordModel.add(options);
  }

  /** 过滤掉已经处理过的文件，只返回需要上传的文件（失败的文件会在冷却后重试） */
  filterNewPaths(paths: string[], cooldownMs?: number) {
    return this.watchUploadRecordModel.filterNewPaths(paths, cooldownMs);
  }

  /** 把遗留的「上传中」记录标记为失败 */
  markAllUploadingAsError(error?: string) {
    return this.watchUploadRecordModel.markAllUploadingAsError(error);
  }

  list(options: { limit?: number; configId?: string } = {}) {
    return this.watchUploadRecordModel.listRecent(options);
  }

  updateStatus(options: {
    id: number;
    status: WatchUploadRecordStatus;
    taskId?: string | null;
    error?: string | null;
    size?: number;
    mtime?: number;
  }) {
    return this.watchUploadRecordModel.updateStatus(options);
  }

  deleteById(id: number) {
    return this.watchUploadRecordModel.deleteById(id);
  }

  deleteByPath(path: string) {
    return this.watchUploadRecordModel.deleteByPath(path);
  }

  clear(options: { onlySuccess?: boolean } = {}) {
    return this.watchUploadRecordModel.clear(options);
  }
}

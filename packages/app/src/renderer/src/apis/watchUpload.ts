import request from "./request";

export type WatchUploadRecordStatus = "pending" | "uploading" | "success" | "error";

export type WatchUploadRecord = {
  id: number;
  path: string;
  size: number;
  mtime: number;
  status: WatchUploadRecordStatus;
  config_id: string;
  task_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type WatchUploadReason = "latest" | "skipped" | "silent" | "unstable";

export type WatchUploadPending = {
  configId: string;
  folder: string;
  path: string;
  filename: string;
  size: number;
  mtime: number;
  reason: WatchUploadReason;
};

export type WatchUploadStatus = {
  id: string;
  switch: boolean;
  watchFolder: string;
  folderExists: boolean;
  hasLogin: boolean;
  uid: number | null;
  intervalSeconds: number;
  silentSeconds: number;
  skipLatest: boolean;
  preset: { id: string; name?: string; title?: string; partTitleTemplate?: string } | null;
  fileCount: number;
  skippedLatest: string | null;
  waiting: { filename: string; reason: WatchUploadReason }[];
  readyToUpload: string[];
  successCount: number;
  errorCount: number;
  uploadingCount: number;
  lastError: string | null;
};

/**
 * 上传记录列表
 */
const list = async (params?: {
  configId?: string;
  limit?: number;
}): Promise<WatchUploadRecord[]> => {
  const res = await request.get(`/watchUpload/list`, { params });
  return res.data;
};

/**
 * 等待中的文件
 */
const pending = async (configId?: string): Promise<WatchUploadPending[]> => {
  const res = await request.get(`/watchUpload/pending`, { params: { configId } });
  return res.data;
};

/**
 * 每个监听配置的当前状态
 */
const status = async (): Promise<WatchUploadStatus[]> => {
  const res = await request.get(`/watchUpload/status`);
  return res.data;
};

/**
 * 立即执行一次扫描
 */
const check = async (): Promise<{
  pending: WatchUploadPending[];
  records: WatchUploadRecord[];
}> => {
  const res = await request.post(`/watchUpload/check`);
  return res.data;
};

/**
 * 手动上传文件
 */
const upload = async (options: { path: string; configId: string }): Promise<{ taskId: string }> => {
  const res = await request.post(`/watchUpload/upload`, options);
  return res.data;
};

/**
 * 删除记录
 */
const remove = async (id: number): Promise<string> => {
  const res = await request.delete(`/watchUpload/${id}`);
  return res.data;
};

/**
 * 清空记录
 */
const clear = async (onlySuccess = false): Promise<string> => {
  const res = await request.delete(`/watchUpload`, { params: { onlySuccess } });
  return res.data;
};

const watchUploadApi = {
  list,
  pending,
  status,
  check,
  upload,
  remove,
  clear,
};

export default watchUploadApi;

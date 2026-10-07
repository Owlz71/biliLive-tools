import Router from "@koa/router";

import { watchUploadService } from "../index.js";
import { watchUploadRecordService } from "@biliLive-tools/shared/db/index.js";

const router = new Router({
  prefix: "/watchUpload",
});

/**
 * 上传记录列表
 */
router.get("/list", async (ctx) => {
  const { configId, limit } = ctx.request.query as { configId?: string; limit?: string };
  const data = watchUploadRecordService.list({
    configId,
    limit: limit ? Number(limit) : undefined,
  });
  ctx.body = data;
});

/**
 * 等待中的文件（被跳过的最新文件、静默时间不足的文件）
 */
router.get("/pending", async (ctx) => {
  const { configId } = ctx.request.query as { configId?: string };
  ctx.body = await watchUploadService.getPending(configId);
});

/**
 * 每个监听配置的当前状态（用于排查「为什么没上传」）
 */
router.get("/status", async (ctx) => {
  ctx.body = await watchUploadService.getStatus();
});

/**
 * 立即执行一次扫描
 */
router.post("/check", async (ctx) => {
  await watchUploadService.checkOnce();
  ctx.body = {
    pending: await watchUploadService.getPending(),
    records: watchUploadRecordService.list({ limit: 200 }),
  };
});

/**
 * 手动上传文件
 */
router.post("/upload", async (ctx) => {
  const { path, configId } = ctx.request.body as { path: string; configId: string };
  if (!path || !configId) {
    ctx.status = 400;
    ctx.body = "path and configId required";
    return;
  }
  ctx.body = await watchUploadService.uploadNow(path, configId);
});

/**
 * 删除记录（删除后该文件可以被重新上传）
 */
router.delete("/:id", async (ctx) => {
  const { id } = ctx.params;
  watchUploadRecordService.deleteById(Number(id));
  ctx.body = "success";
});

/**
 * 清空记录
 */
router.delete("/", async (ctx) => {
  const { onlySuccess } = ctx.request.query as { onlySuccess?: string };
  watchUploadRecordService.clear({ onlySuccess: onlySuccess === "true" });
  ctx.body = "success";
});

export default router;

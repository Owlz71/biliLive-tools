<!-- 监听上传 -->
<template>
  <div class="watch-upload">
    <div class="page-header">
      <h2 class="title">
        监听上传
        <Tip
          :size="22"
          tip="监听指定文件夹，把新出现的视频自动上传到B站。<br/>文件「静默时间」内不再变化后才会上传，最后一个视频也会自动上传"
        />
      </h2>
      <n-space>
        <n-button type="primary" :loading="checking" @click="() => checkNow()">立即检测</n-button>
      </n-space>
    </div>

    <n-alert v-if="!hasLogin" type="warning" style="margin-bottom: 20px">
      请先登录B站账号，否则无法上传
    </n-alert>

    <n-alert v-if="errorRecords.length" type="error" style="margin-bottom: 20px">
      有 {{ errorRecords.length }} 个文件上传失败，请看下方「上传记录」的原因，失败的文件会在 5
      分钟后自动重试
    </n-alert>

    <n-divider title-placement="left">监听配置</n-divider>
    <div class="config-list">
      <n-card v-for="(item, index) in configCards" :key="item.id" size="small" class="config-card">
        <template #header>
          <div class="card-header">
            <n-text strong>{{ item.watchFolder || "未设置文件夹" }}</n-text>
            <n-tag v-if="item.switch" type="info" size="small">监听中</n-tag>
            <n-tag v-else type="warning" size="small">已禁用</n-tag>
          </div>
        </template>
        <template #header-extra>
          <n-space>
            <n-button size="small" @click="editConfig(index)">编辑</n-button>
            <n-button size="small" text type="error" @click="deleteConfig(index)">删除</n-button>
          </n-space>
        </template>
        <n-space vertical size="small">
          <div class="info-item">
            <n-text depth="3">上传预设：</n-text>
            <n-text>{{ presetName(item.uploadPresetId) }}</n-text>
          </div>
          <div class="info-item">
            <n-text depth="3">轮询间隔：</n-text>
            <n-text>{{ item.intervalSeconds }} 秒</n-text>
            <n-text depth="3" style="margin-left: 12px">静默时间：</n-text>
            <n-text>{{ formatSeconds(item.silentSeconds) }}</n-text>
          </div>
          <div class="info-item">
            <n-text depth="3">跳过最新文件：</n-text>
            <n-text>{{ item.skipLatest ? "是" : "否" }}</n-text>
            <n-text depth="3" style="margin-left: 12px">审核通过后移除源文件：</n-text>
            <n-text>{{ item.removeOriginAfterUploadCheck ? "是" : "否" }}</n-text>
          </div>
          <template v-if="item.status">
            <n-divider style="margin: 6px 0" />
            <div class="info-item">
              <n-text depth="3">文件夹：</n-text>
              <n-text :type="item.status.folderExists ? undefined : 'error'">
                {{
                  item.status.folderExists ? `匹配 ${item.status.fileCount} 个文件` : "文件夹不存在"
                }}
              </n-text>
            </div>
            <div class="info-item">
              <n-text depth="3">本次可上传：</n-text>
              <n-text :type="item.status.readyToUpload.length ? 'info' : undefined">
                {{ item.status.readyToUpload.length }} 个
              </n-text>
              <n-text depth="3" style="margin-left: 12px">等待中：</n-text>
              <n-text>{{ item.status.waiting.length }} 个</n-text>
            </div>
            <div class="info-item">
              <n-text depth="3">已成功：</n-text>
              <n-text type="success">{{ item.status.successCount }}</n-text>
              <n-text depth="3" style="margin-left: 12px">发送中：</n-text>
              <n-text>{{ item.status.uploadingCount }}</n-text>
              <n-text depth="3" style="margin-left: 12px">失败：</n-text>
              <n-text :type="item.status.errorCount ? 'error' : undefined">
                {{ item.status.errorCount }}
              </n-text>
            </div>
            <div class="info-item">
              <n-text depth="3">B站账号：</n-text>
              <n-text :type="item.status.hasLogin ? undefined : 'error'">
                {{ item.status.hasLogin ? `UID ${item.status.uid}` : "未登录" }}
              </n-text>
              <n-text v-if="item.status.skipLatest" depth="3" style="margin-left: 12px">
                最新文件 {{ item.status.skippedLatest || "-" }} 已跳过
              </n-text>
            </div>
            <div class="info-item">
              <n-text depth="3">预设标题模板：</n-text>
              <n-text>{{ item.status.preset?.title || "（空）" }}</n-text>
            </div>
            <div class="info-item">
              <n-text depth="3">分P标题模板：</n-text>
              <n-text>{{ item.status.preset?.partTitleTemplate || "（空）" }}</n-text>
            </div>
            <div v-if="item.status.lastError" class="info-item">
              <n-text type="error">最后错误：{{ item.status.lastError }}</n-text>
            </div>
          </template>
        </n-space>
      </n-card>

      <n-card size="small" class="config-card add-card" @click="addConfig">
        <n-icon size="36" color="var(--n-text-color-disabled)">
          <Add />
        </n-icon>
      </n-card>
    </div>

    <n-divider title-placement="left">等待上传</n-divider>
    <n-data-table
      :columns="pendingColumns"
      :data="pendingList"
      :loading="loading"
      :bordered="false"
      size="small"
      :row-key="(row: WatchUploadPending) => row.path"
    />

    <n-divider title-placement="left">
      <div class="divider-header">
        <span>上传记录</span>
        <n-button size="tiny" text @click="clearRecords">清空记录</n-button>
      </div>
    </n-divider>
    <n-data-table
      :columns="recordColumns"
      :data="records"
      :loading="loading"
      :bordered="false"
      size="small"
      :row-key="(row: WatchUploadRecord) => row.id"
    />

    <!-- 编辑/新增配置 -->
    <n-modal v-model:show="modalVisible" :mask-closable="false">
      <n-card
        style="width: 640px; max-width: 95vw"
        :bordered="false"
        role="dialog"
        aria-modal="true"
        title="监听配置"
      >
        <n-form
          ref="formRef"
          :model="editingConfig"
          :rules="formRules"
          label-placement="left"
          :label-width="labelWidth"
        >
          <n-form-item label="监听文件夹" path="watchFolder">
            <n-input
              v-model:value="editingConfig.watchFolder"
              placeholder="请选择需要监听的文件夹"
            />
            <n-button style="margin-left: 10px" @click="selectFolder">选择</n-button>
          </n-form-item>
          <n-form-item label="上传预设" path="uploadPresetId">
            <n-select
              v-model:value="editingConfig.uploadPresetId"
              :options="uploaPresetsOptions"
              placeholder="请选择上传预设"
            />
          </n-form-item>
          <n-form-item label="轮询间隔（秒）">
            <n-input-number
              v-model:value="editingConfig.intervalSeconds"
              :min="10"
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item label="静默时间（秒）">
            <n-space vertical style="width: 100%">
              <n-input-number
                v-model:value="editingConfig.silentSeconds"
                :min="0"
                style="width: 100%"
              />
              <n-text depth="3" style="font-size: 12px">
                针对最新的文件：超过这个时间没有变化就认为录制已经结束，自动上传（默认 86400 秒 = 1
                天）。其余文件只要出现更新的文件就会上传
              </n-text>
            </n-space>
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="editingConfig.switch" />
          </n-form-item>
          <n-form-item label="跳过最新文件">
            <n-space align="center">
              <n-switch v-model:value="editingConfig.skipLatest" />
              <n-text depth="3" style="font-size: 12px">
                开启后文件夹里最新的文件不会自动上传（永不传最后一个视频），适合担心「暂停录像被误传」
              </n-text>
            </n-space>
          </n-form-item>
          <n-form-item label="审核通过后移除源文件">
            <n-switch v-model:value="editingConfig.removeOriginAfterUploadCheck" />
          </n-form-item>
          <n-form-item label="文件匹配规则">
            <n-input v-model:value="editingConfig.fileMatchRegex" placeholder="留空使用默认规则" />
          </n-form-item>
          <n-form-item label="忽略文件正则">
            <n-input
              v-model:value="editingConfig.ignoreFileRegex"
              placeholder="匹配的文件将被忽略"
            />
          </n-form-item>
        </n-form>
        <template #footer>
          <div style="text-align: right">
            <n-button @click="modalVisible = false">取消</n-button>
            <n-button type="primary" style="margin-left: 10px" @click="saveConfig">保存</n-button>
          </div>
        </template>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { NButton, NText, useNotification } from "naive-ui";
import { Add } from "@vicons/ionicons5";

import { showDirectoryDialog } from "@renderer/utils/fileSystem";
import { useConfirm, useBreakpoints } from "@renderer/hooks";
import { uuid, formatTime } from "@renderer/utils";
import Tip from "@renderer/components/Tip.vue";
import watchUploadApi from "@renderer/apis/watchUpload";
import { useAppConfig, useUserInfoStore, useUploadPreset } from "@renderer/stores";

import type { AppConfig } from "@biliLive-tools/types";
import type {
  WatchUploadPending,
  WatchUploadRecord,
  WatchUploadStatus,
} from "@renderer/apis/watchUpload";
import type { DataTableColumns } from "naive-ui";

defineOptions({
  name: "WatchUpload",
});

type WatchUploadConfigItem = AppConfig["watchUpload"]["config"][number];

const appConfigStore = useAppConfig();
const { appConfig } = storeToRefs(appConfigStore);
const { userInfo } = storeToRefs(useUserInfoStore());
const { uploaPresetsOptions } = storeToRefs(useUploadPreset());

const notice = useNotice();
const notification = useNotification();
const confirm = useConfirm();
const { isMobile } = useBreakpoints();

const hasLogin = computed(() => !!userInfo.value.uid);
const watchConfigs = computed<WatchUploadConfigItem[]>(
  () => (appConfig.value.watchUpload?.config ?? []) as WatchUploadConfigItem[],
);
const presetName = (id: string) => {
  return uploaPresetsOptions.value.find((item: any) => item.value === id)?.label ?? id ?? "未设置";
};

/** 秒数转成好读的文案 */
const formatSeconds = (seconds: number) => {
  if (!seconds || seconds <= 0) return "关闭";
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
};

const createDefaultConfig = (): WatchUploadConfigItem => ({
  id: uuid(),
  switch: true,
  watchFolder: "",
  uploadPresetId: uploaPresetsOptions.value[0]?.value ?? "default",
  intervalSeconds: 60,
  skipLatest: false,
  // 最新文件的等待时间，默认 1 天
  silentSeconds: 86400,
  fileMatchRegex: "",
  ignoreFileRegex: "",
  removeOriginAfterUploadCheck: false,
});

// 配置编辑
const modalVisible = ref(false);
const editingIndex = ref<number | null>(null);
const editingConfig = ref<WatchUploadConfigItem>(createDefaultConfig());
const formRef = ref();
const formRules = {
  watchFolder: {
    required: true,
    message: "请选择需要监听的文件夹",
    trigger: ["blur", "change"],
  },
  uploadPresetId: {
    required: true,
    message: "请选择上传预设",
    trigger: ["blur", "change"],
  },
};
const labelWidth = computed(() => (isMobile.value ? "100px" : "130px"));

const addConfig = () => {
  editingIndex.value = null;
  editingConfig.value = createDefaultConfig();
  modalVisible.value = true;
};

const editConfig = (index: number) => {
  editingIndex.value = index;
  editingConfig.value = JSON.parse(JSON.stringify(watchConfigs.value[index]));
  modalVisible.value = true;
};

const selectFolder = async () => {
  const file = await showDirectoryDialog({ defaultPath: editingConfig.value.watchFolder });
  if (!file) return;
  editingConfig.value.watchFolder = file;
};

const deleteConfig = async (index: number) => {
  const [status] = await confirm.warning({ content: "确定要删除该监听配置？" });
  if (!status) return;
  const list = [...watchConfigs.value];
  list.splice(index, 1);
  await saveConfigs(list);
};

const saveConfigs = async (list: WatchUploadConfigItem[]) => {
  await appConfigStore.set("watchUpload", { config: JSON.parse(JSON.stringify(list)) });
};

const saveConfig = async () => {
  try {
    await formRef.value?.validate();
  } catch (error) {
    return;
  }

  const list = JSON.parse(JSON.stringify(watchConfigs.value)) as WatchUploadConfigItem[];
  if (editingIndex.value === null) {
    list.push(JSON.parse(JSON.stringify(editingConfig.value)));
  } else {
    list[editingIndex.value] = JSON.parse(JSON.stringify(editingConfig.value));
  }
  await saveConfigs(list);
  modalVisible.value = false;
  notice.success("已保存");
  void checkNow(false);
};

// 数据
const loading = ref(false);
const checking = ref(false);
const records = ref<WatchUploadRecord[]>([]);
const pendingList = ref<WatchUploadPending[]>([]);
const statusList = ref<WatchUploadStatus[]>([]);

/** 配置卡片：把状态合并进去，避免模板里到处判空 */
const configCards = computed(() => {
  const statusMapById: Record<string, WatchUploadStatus> = {};
  for (const item of statusList.value) {
    statusMapById[item.id] = item;
  }
  return watchConfigs.value.map((item) => ({
    ...item,
    status: statusMapById[item.id] ?? null,
  }));
});

const refresh = async () => {
  loading.value = true;
  try {
    // 顺便触发一次扫描，避免"刚放进文件夹却没反应"
    const data = await watchUploadApi.check();
    records.value = data.records;
    pendingList.value = data.pending;
    statusList.value = await watchUploadApi.status();
    notifyFailedRecords(records.value);
  } catch (error) {
    notice.error(error instanceof Error ? error.message : "获取数据失败");
  } finally {
    loading.value = false;
  }
};

/** 已经弹过的失败记录，避免重复弹窗 */
const notifiedErrors = new Set<number>();

/** 有新的上传失败时弹出来，把具体原因直接显示给用户 */
const notifyFailedRecords = (list: WatchUploadRecord[]) => {
  let count = 0;
  for (const record of list) {
    if (record.status !== "error") continue;
    if (notifiedErrors.has(record.id)) continue;
    notifiedErrors.add(record.id);
    if (count >= 5) continue;
    count++;
    const filename = record.path.split(/[\\/]/).pop() || record.path;
    notification.error({
      title: `上传失败：${filename}`,
      content: record.error || "未知错误",
      duration: 0,
      keepAliveOnHover: true,
      closable: true,
    });
  }
};

const checkNow = async (showNotice = true) => {
  checking.value = true;
  try {
    const data = await watchUploadApi.check();
    records.value = data.records;
    pendingList.value = data.pending;
    if (showNotice) {
      notice.success("检测完成");
    }
  } catch (error) {
    notice.error(error instanceof Error ? error.message : "检测失败");
  } finally {
    checking.value = false;
  }
};

const uploadNow = async (row: WatchUploadPending) => {
  try {
    await watchUploadApi.upload({ path: row.path, configId: row.configId });
    notice.success("已添加上传任务");
    await refresh();
  } catch (error) {
    notice.error(error instanceof Error ? error.message : "上传失败");
  }
};

const removeRecord = async (row: WatchUploadRecord) => {
  const [status] = await confirm.warning({
    content: "删除记录后该文件会被重新上传，确定删除？",
  });
  if (!status) return;
  await watchUploadApi.remove(row.id);
  await refresh();
};

const clearRecords = async () => {
  const [status] = await confirm.warning({ content: "确定清空全部上传记录？" });
  if (!status) return;
  await watchUploadApi.clear();
  await refresh();
};

const statusMap: Record<string, { text: string; type: "default" | "info" | "success" | "error" }> =
  {
    pending: { text: "等待中", type: "default" },
    uploading: { text: "上传中", type: "info" },
    success: { text: "已完成", type: "success" },
    error: { text: "失败", type: "error" },
  };

const pendingReasonText: Record<WatchUploadPending["reason"], string> = {
  latest: "最新文件，静默时间未到",
  skipped: "已开启跳过最新文件",
  silent: "刚写入，等待下一轮",
  unstable: "文件仍在写入",
};

const pendingColumns: DataTableColumns<WatchUploadPending> = [
  {
    title: "文件名",
    key: "filename",
    ellipsis: { tooltip: true },
  },
  {
    title: "原因",
    key: "reason",
    width: 120,
    render: (row) => pendingReasonText[row.reason] ?? "-",
  },
  {
    title: "修改时间",
    key: "mtime",
    width: 180,
    render: (row) => formatTime(row.mtime),
  },
  {
    title: "操作",
    key: "action",
    width: 100,
    render: (row) =>
      h(
        NButton,
        {
          size: "small",
          type: "primary",
          onClick: () => uploadNow(row),
        },
        { default: () => "立即上传" },
      ),
  },
];

const recordColumns: DataTableColumns<WatchUploadRecord> = [
  {
    title: "文件名",
    key: "path",
    ellipsis: { tooltip: true },
    render: (row) => row.path,
  },
  {
    title: "预设",
    key: "config_id",
    width: 140,
    ellipsis: { tooltip: true },
    render: (row) => {
      const config = watchConfigs.value.find((item) => item.id === row.config_id);
      return config ? presetName(config.uploadPresetId) : "-";
    },
  },
  {
    title: "状态",
    key: "status",
    width: 110,
    render: (row) => {
      const item = statusMap[row.status] ?? statusMap.pending;
      return h(
        NText,
        { type: row.status === "error" ? "error" : undefined, title: row.error ?? undefined },
        { default: () => (row.error ? `${item.text}：${row.error}` : item.text) },
      );
    },
  },
  {
    title: "时间",
    key: "created_at",
    width: 180,
    render: (row) => formatTime(row.created_at),
  },
  {
    title: "操作",
    key: "action",
    width: 130,
    render: (row) =>
      h("div", { style: "display: flex; gap: 8px" }, [
        row.status === "error"
          ? h(
              NButton,
              {
                size: "small",
                text: true,
                type: "primary",
                onClick: () => retryRecord(row),
              },
              { default: () => "重试" },
            )
          : null,
        h(
          NButton,
          {
            size: "small",
            text: true,
            type: "error",
            onClick: () => removeRecord(row),
          },
          { default: () => "删除" },
        ),
      ]),
  },
];

const errorRecords = computed(() => records.value.filter((item) => item.status === "error"));

const retryRecord = async (row: WatchUploadRecord) => {
  try {
    await watchUploadApi.upload({ path: row.path, configId: row.config_id });
    notice.success("已重新加入上传任务");
    await refresh();
  } catch (error) {
    notice.error(error instanceof Error ? error.message : "重试失败");
  }
};

let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void refresh();
  // 轮询上传记录，出现失败时立刻弹窗提示
  pollTimer = setInterval(async () => {
    try {
      const list = await watchUploadApi.list({ limit: 200 });
      records.value = list;
      notifyFailedRecords(list);
    } catch (error) {
      // 轮询失败不打扰用户
    }
  }, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped lang="less">
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 20px;

  .title {
    display: inline-flex;
    align-items: center;
    margin: 0;
  }
}

.config-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;

  .config-card {
    width: 320px;
  }

  .add-card {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
    cursor: pointer;
  }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  word-break: break-all;
}

.info-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
}

.divider-header {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
</style>

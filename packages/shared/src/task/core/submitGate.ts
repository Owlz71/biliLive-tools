/**
 * 提交顺序闸门
 *
 * 用于「并行上传、顺序提交」的场景：多个任务可以同时上传分P（上传顺序不影响结果），
 * 但真正决定B站分P顺序的是 edit 提交请求的到达时刻，因此提交必须严格按任务创建顺序进行。
 *
 * 用法：
 * 1. 任务创建时调用 `createSubmitGate(key)` 拿到 `{ prev, release }`
 * 2. 提交前 `await gate.prev`（等待前一个任务结束）
 * 3. 任务结束时调用 `gate.release()`（成功、失败、取消、被移除都要调用，避免阻塞后面的任务）
 */
const gates = new Map<string, Promise<void>>();

export type SubmitGate = {
  /** 前一个任务的完成 Promise，提交前需要 await */
  prev: Promise<void>;
  /** 放行下一个任务（幂等） */
  release: () => void;
};

export function createSubmitGate(key: string): SubmitGate {
  const prev = gates.get(key) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.set(key, current);

  let released = false;
  return {
    prev,
    release: () => {
      if (released) return;
      released = true;
      // 只有自己还是链尾时才清理，避免切断后来的任务
      if (gates.get(key) === current) {
        gates.delete(key);
      }
      release();
    },
  };
}

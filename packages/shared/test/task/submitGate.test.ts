import { describe, it, expect } from "vitest";
import { createSubmitGate } from "../../src/task/core/submitGate.js";

describe("submitGate", () => {
  it("后创建的任务需要等前一个任务放行", async () => {
    const first = createSubmitGate("test-key-1");
    const second = createSubmitGate("test-key-1");

    let firstDone = false;
    void second.prev.then(() => {
      firstDone = true;
    });

    await Promise.resolve();
    expect(firstDone).toBe(false);

    first.release();
    await second.prev;
    expect(firstDone).toBe(true);
    second.release();
  });

  it("不同 key 之间互不影响", async () => {
    const first = createSubmitGate("test-key-2");
    const other = createSubmitGate("test-key-3");

    // 另一个 key 上没有前序任务，可以直接通过
    await other.prev;
    first.release();
    other.release();
  });

  it("release 幂等，且不会影响后续任务的顺序", async () => {
    const first = createSubmitGate("test-key-4");
    const second = createSubmitGate("test-key-4");
    const third = createSubmitGate("test-key-4");

    first.release();
    first.release();

    await second.prev;

    let thirdDone = false;
    void third.prev.then(() => {
      thirdDone = true;
    });

    await Promise.resolve();
    expect(thirdDone).toBe(false);

    second.release();
    await third.prev;
    expect(thirdDone).toBe(true);
    third.release();
  });

  it("链尾任务放行后，新的任务可以直接通过", async () => {
    const first = createSubmitGate("test-key-5");
    first.release();

    const second = createSubmitGate("test-key-5");
    await second.prev;
    second.release();
  });
});

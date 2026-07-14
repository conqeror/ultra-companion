import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldToUI } from "@/utils/yieldToUI";

describe("yieldToUI", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for both an animation frame and a following task", async () => {
    vi.useFakeTimers();
    const frame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", frame);

    let finished = false;
    const pending = yieldToUI().then(() => {
      finished = true;
    });

    expect(frame).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(finished).toBe(true);
  });
});

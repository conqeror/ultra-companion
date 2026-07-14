import { afterEach, describe, expect, it, vi } from "vitest";
import { measureAsync, measureSync } from "@/utils/perfMarks";

type PerfMarksGlobal = typeof globalThis & {
  __ULTRA_ENABLE_PERF_MARKS__?: boolean;
};

describe("perfMarks", () => {
  afterEach(() => {
    delete (globalThis as PerfMarksGlobal).__ULTRA_ENABLE_PERF_MARKS__;
    delete process.env.EXPO_PUBLIC_ENABLE_PERF_MARKS;
    performance.clearMarks();
    performance.clearMeasures();
    vi.restoreAllMocks();
  });

  it("does not create marks unless profiling is enabled", () => {
    const mark = vi.spyOn(performance, "mark");

    expect(measureSync("disabled", () => 42)).toBe(42);
    expect(mark).not.toHaveBeenCalled();
  });

  it("measures synchronous work when the runtime flag is enabled", () => {
    (globalThis as PerfMarksGlobal).__ULTRA_ENABLE_PERF_MARKS__ = true;
    const measure = vi.spyOn(performance, "measure");

    expect(measureSync("sync-work", () => "done")).toBe("done");
    expect(measure).toHaveBeenCalledWith("sync-work", expect.any(String), expect.any(String));
  });

  it("measures asynchronous work in a release-profile build", async () => {
    process.env.EXPO_PUBLIC_ENABLE_PERF_MARKS = "1";
    const measure = vi.spyOn(performance, "measure");

    await expect(measureAsync("async-work", async () => "done")).resolves.toBe("done");
    expect(measure).toHaveBeenCalledWith("async-work", expect.any(String), expect.any(String));
  });
});

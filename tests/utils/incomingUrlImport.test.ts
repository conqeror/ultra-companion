import { describe, expect, it, vi } from "vitest";
import { IncomingUrlImportGate } from "@/utils/incomingUrlImport";

describe("IncomingUrlImportGate", () => {
  it("retries the same URL after a failed import", async () => {
    const gate = new IncomingUrlImportGate();
    const importUrl = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Temporary file access failed"))
      .mockResolvedValueOnce(undefined);

    await expect(gate.run("file://route.gpx", importUrl)).rejects.toThrow(
      "Temporary file access failed",
    );
    await expect(gate.run("file://route.gpx", importUrl)).resolves.toBe(true);

    expect(importUrl).toHaveBeenCalledTimes(2);
  });

  it("does not import a successful URL twice", async () => {
    const gate = new IncomingUrlImportGate();
    const importUrl = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(gate.run("file://route.gpx", importUrl)).resolves.toBe(true);
    await expect(gate.run("file://route.gpx", importUrl)).resolves.toBe(false);

    expect(importUrl).toHaveBeenCalledOnce();
  });

  it("suppresses duplicate concurrent delivery", async () => {
    const gate = new IncomingUrlImportGate();
    let resolveImport: (() => void) | undefined;
    const importUrl = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        }),
    );

    const firstImport = gate.run("file://route.gpx", importUrl);
    await expect(gate.run("file://route.gpx", importUrl)).resolves.toBe(false);
    resolveImport?.();
    await expect(firstImport).resolves.toBe(true);

    expect(importUrl).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from "vitest";
import { computeSegmentTime } from "@/services/powerModel";
import { DEFAULT_POWER_CONFIG } from "@/constants";

describe("computeSegmentTime", () => {
  it("returns 0 for zero distance", () => {
    expect(computeSegmentTime(0, 0, DEFAULT_POWER_CONFIG)).toBe(0);
  });

  it("is slower uphill than flat for same distance", () => {
    const distance = 1_000;
    const flat = computeSegmentTime(distance, 0, DEFAULT_POWER_CONFIG);
    const uphill = computeSegmentTime(distance, 0.08, DEFAULT_POWER_CONFIG);

    expect(uphill).toBeGreaterThan(flat);
  });

  it("caps downhill speed at maxDescentSpeedKmh", () => {
    const distance = 1_000;
    const time = computeSegmentTime(distance, -0.02, DEFAULT_POWER_CONFIG);
    const speedKmh = (distance / time) * 3.6;

    expect(speedKmh).toBeLessThanOrEqual(DEFAULT_POWER_CONFIG.maxDescentSpeedKmh + 0.0001);
  });

  it("is slower with less drivetrain efficiency", () => {
    const distance = 1_000;
    const efficient = computeSegmentTime(distance, 0.02, {
      ...DEFAULT_POWER_CONFIG,
      drivetrainEfficiency: 1,
    });
    const lossy = computeSegmentTime(distance, 0.02, {
      ...DEFAULT_POWER_CONFIG,
      drivetrainEfficiency: 0.8,
    });

    expect(lossy).toBeGreaterThan(efficient);
  });
});

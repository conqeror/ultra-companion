import { describe, expect, it } from "vitest";
import { buildClimb } from "@/tests/fixtures/climb";
import { toDisplayClimb } from "@/services/displayDistance";
import { getClimbProgress } from "@/utils/climbProgress";

describe("climbProgress", () => {
  const climb = toDisplayClimb(buildClimb("c1", "r1", 10_000, 17_000));

  it("reports an upcoming climb relative to the start", () => {
    expect(getClimbProgress(climb, 7_500)).toMatchObject({
      state: "upcoming",
      distanceToStartMeters: 2_500,
      distanceToTopMeters: 9_500,
      completedDistanceMeters: 0,
      remainingDistanceMeters: 7_000,
      progressRatio: 0,
    });
  });

  it("reports active climb progress relative to the top", () => {
    expect(getClimbProgress(climb, 13_000)).toMatchObject({
      state: "active",
      distanceToStartMeters: 0,
      distanceToTopMeters: 4_000,
      completedDistanceMeters: 3_000,
      remainingDistanceMeters: 4_000,
      progressRatio: 3_000 / 7_000,
    });
  });

  it("reports completed climbs relative to the top, not the start", () => {
    expect(getClimbProgress(climb, 20_000)).toMatchObject({
      state: "past",
      distanceToTopMeters: 0,
      distancePastTopMeters: 3_000,
      completedDistanceMeters: 7_000,
      remainingDistanceMeters: 0,
      progressRatio: 1,
    });
  });
});

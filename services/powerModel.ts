import type { PowerModelConfig } from "@/types";
import { G } from "@/constants";

const MIN_SPEED_MS = 3 / 3.6; // 3 km/h walking pace floor
const NEWTON_MAX_ITER = 20;
const NEWTON_TOLERANCE = 1e-6;

/**
 * Solve for velocity (m/s) at a given gradient using the power balance equation.
 *
 * P_eff = (Crr * m * g * cos(θ) + 0.5 * ρ * CdA * v² + m * g * sin(θ)) * v
 *
 * Rearranged as cubic: 0.5 * ρ * CdA * v³ + F_resist * v - P_eff = 0
 * where F_resist = Crr * m * g * cos(θ) + m * g * sin(θ)
 *
 * Solved via Newton's method.
 *
 * Descent corrections (gradient < 0):
 * - Power fades linearly from full at 0% to 0W at -8% (riders coast downhill)
 * - CdA increases 1.5× (upright position, bags catch wind)
 * - Steep descents (< -9%) apply a braking factor for switchbacks
 */
export function solveVelocity(
  gradientFraction: number,
  config: PowerModelConfig,
): number {
  const theta = Math.atan(gradientFraction);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  // On descents riders coast (reduced power) and sit upright (higher drag)
  const isDescending = gradientFraction < 0;
  const effectivePower = isDescending
    ? config.powerWatts * Math.max(0, 1 + gradientFraction / 0.08)
    : config.powerWatts;
  const effectiveCda = isDescending ? config.cda * 1.5 : config.cda;

  const pEff = effectivePower * config.drivetrainEfficiency;
  const a = 0.5 * config.airDensity * effectiveCda; // coefficient of v³
  const fResist =
    config.crr * config.totalMassKg * G * cosTheta +
    config.totalMassKg * G * sinTheta;

  const maxDescentMs = config.maxDescentSpeedKmh / 3.6;

  // f(v) = a * v³ + fResist * v - pEff
  // f'(v) = 3 * a * v² + fResist
  //
  // On descents fResist < 0, so the standard initial guess (5 m/s) causes
  // Newton's method to diverge. Use the coasting equilibrium speed
  // (gravity = drag, no pedaling) as a starting point instead.
  let v: number;
  if (fResist < 0) {
    v = Math.sqrt(-fResist / a);
  } else {
    v = 5.0;
  }

  for (let i = 0; i < NEWTON_MAX_ITER; i++) {
    const fv = a * v * v * v + fResist * v - pEff;
    const fpv = 3 * a * v * v + fResist;

    if (Math.abs(fpv) < 1e-12) break;
    const vNext = v - fv / fpv;

    if (Math.abs(vNext - v) < NEWTON_TOLERANCE) {
      v = vNext;
      break;
    }
    v = Math.max(vNext, MIN_SPEED_MS * 0.1); // keep v positive during iteration
  }

  // Apply bounds
  v = Math.max(v, MIN_SPEED_MS);
  v = Math.min(v, maxDescentMs);

  // Steep descent braking: switchbacks limit achievable speed
  if (gradientFraction < -0.09) {
    const minDescentMs = 20 / 3.6;
    const brakeFactor = Math.max(0.2, 1 + (gradientFraction + 0.09) * 10);
    v = Math.max(v * brakeFactor, minDescentMs);
  }

  return v;
}

/**
 * Compute time in seconds to traverse a segment.
 */
export function computeSegmentTime(
  distanceM: number,
  gradientFraction: number,
  config: PowerModelConfig,
): number {
  if (distanceM <= 0) return 0;
  const speed = solveVelocity(gradientFraction, config);
  return distanceM / speed;
}

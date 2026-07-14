let measureCounter = 0;

type PerfMarksGlobal = typeof globalThis & {
  __ULTRA_ENABLE_PERF_MARKS__?: boolean;
};

const PERF_MARKS_ENABLED_KEY = "__ULTRA_ENABLE_PERF_MARKS__";

function perfMarksEnabled(): boolean {
  return (
    (globalThis as PerfMarksGlobal)[PERF_MARKS_ENABLED_KEY] === true ||
    process.env.EXPO_PUBLIC_ENABLE_PERF_MARKS === "1"
  );
}

function canMeasure(): boolean {
  return (
    perfMarksEnabled() &&
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  );
}

export function measureSync<T>(name: string, work: () => T): T {
  if (!canMeasure()) return work();

  const id = measureCounter++;
  const start = `${name}:start:${id}`;
  const end = `${name}:end:${id}`;
  performance.mark(start);
  try {
    return work();
  } finally {
    performance.mark(end);
    performance.measure(name, start, end);
    performance.clearMarks?.(start);
    performance.clearMarks?.(end);
  }
}

export async function measureAsync<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!canMeasure()) return work();

  const id = measureCounter++;
  const start = `${name}:start:${id}`;
  const end = `${name}:end:${id}`;
  performance.mark(start);
  try {
    return await work();
  } finally {
    performance.mark(end);
    performance.measure(name, start, end);
    performance.clearMarks?.(start);
    performance.clearMarks?.(end);
  }
}

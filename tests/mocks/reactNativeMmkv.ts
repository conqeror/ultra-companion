import { vi } from "vitest";

export const reactNativeMmkvMocks = {
  getString: vi.fn(() => null as string | null),
  set: vi.fn(),
};

export function createMockMMKV() {
  return {
    getString: reactNativeMmkvMocks.getString,
    set: reactNativeMmkvMocks.set,
  };
}

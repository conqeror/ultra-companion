import { vi } from "vitest";

export const reactNativeMmkvMocks = {
  getAllKeys: vi.fn(() => [] as string[]),
  getString: vi.fn(() => null as string | null),
  remove: vi.fn(),
  set: vi.fn(),
};

export function createMockMMKV() {
  return {
    getAllKeys: reactNativeMmkvMocks.getAllKeys,
    getString: reactNativeMmkvMocks.getString,
    remove: reactNativeMmkvMocks.remove,
    set: reactNativeMmkvMocks.set,
  };
}

export function resetReactNativeMmkvMocks(): void {
  reactNativeMmkvMocks.getAllKeys.mockReturnValue([]);
  reactNativeMmkvMocks.getString.mockReturnValue(null);
  reactNativeMmkvMocks.remove.mockReturnValue(undefined);
  reactNativeMmkvMocks.set.mockReturnValue(undefined);
}

import { vi } from "vitest";

export const expoNetworkMocks = {
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() })),
  getNetworkStateAsync: vi.fn(() => Promise.resolve({ isConnected: true })),
};

export function resetExpoNetworkMocks(): void {
  expoNetworkMocks.addNetworkStateListener.mockReturnValue({ remove: vi.fn() });
  expoNetworkMocks.getNetworkStateAsync.mockResolvedValue({ isConnected: true });
}

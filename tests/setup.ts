import { beforeEach, vi } from "vitest";

vi.mock("react-native-mmkv", async () => {
  const { createMockMMKV } = await import("@/tests/mocks/reactNativeMmkv");
  return { createMMKV: createMockMMKV };
});

vi.mock("expo-network", async () => {
  const { expoNetworkMocks } = await import("@/tests/mocks/expoNetwork");
  return expoNetworkMocks;
});

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
      ios: { bundleIdentifier: "com.ultra.test" },
    },
  },
}));

vi.mock("@/db/database", async () => {
  const { databaseMocks } = await import("@/tests/mocks/database");
  return databaseMocks;
});

vi.mock("@/services/offlineTiles", async () => {
  const { offlineTilesMocks } = await import("@/tests/mocks/offlineTiles");
  return offlineTilesMocks;
});

beforeEach(async () => {
  const [
    { resetDatabaseMocks },
    { resetExpoNetworkMocks },
    { resetOfflineTilesMocks },
    { resetReactNativeMmkvMocks },
  ] = await Promise.all([
    import("@/tests/mocks/database"),
    import("@/tests/mocks/expoNetwork"),
    import("@/tests/mocks/offlineTiles"),
    import("@/tests/mocks/reactNativeMmkv"),
  ]);

  resetDatabaseMocks();
  resetExpoNetworkMocks();
  resetOfflineTilesMocks();
  resetReactNativeMmkvMocks();
});

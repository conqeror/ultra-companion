import { createMMKV } from "react-native-mmkv";

export interface KeyValueStorage {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  set: (key: string, value: string | number | boolean) => void;
  remove: (key: string) => void;
  getAllKeys: () => string[];
}

export function createKeyValueStorage(id: string): KeyValueStorage {
  const storage = createMMKV({ id });
  return {
    getString: (key) => storage.getString(key),
    getNumber: (key) => storage.getNumber(key),
    set: (key, value) => storage.set(key, value),
    remove: (key) => storage.remove(key),
    getAllKeys: () => storage.getAllKeys(),
  };
}

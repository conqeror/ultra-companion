export interface KeyValueStorage {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  set: (key: string, value: string | number | boolean) => void;
  remove: (key: string) => void;
  getAllKeys: () => string[];
}

function storageKey(id: string, key: string): string {
  return `ultra:${id}:${key}`;
}

export function createKeyValueStorage(id: string): KeyValueStorage {
  return {
    getString: (key) => {
      if (typeof window === "undefined") return undefined;
      const value = window.localStorage.getItem(storageKey(id, key));
      return value == null ? undefined : value;
    },
    getNumber: (key) => {
      if (typeof window === "undefined") return undefined;
      const value = window.localStorage.getItem(storageKey(id, key));
      if (value == null) return undefined;
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : undefined;
    },
    set: (key, value) => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(storageKey(id, key), String(value));
    },
    remove: (key) => {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(storageKey(id, key));
    },
    getAllKeys: () => {
      if (typeof window === "undefined") return [];
      const prefix = storageKey(id, "");
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys;
    },
  };
}

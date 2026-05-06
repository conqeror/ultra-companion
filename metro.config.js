const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

function normalizeNativeWindChangeEvent(event) {
  if (!event || !Array.isArray(event.eventsQueue)) {
    return event;
  }

  const addedFiles = new Map();
  const modifiedFiles = new Map();
  const removedFiles = new Map();

  for (const change of event.eventsQueue) {
    if (!change.filePath) {
      continue;
    }

    const canonicalPath = path.relative(projectRoot, change.filePath);
    const metadata = {
      isSymlink: false,
      modifiedTime: change.metadata?.modifiedTime ?? Date.now(),
    };

    if (change.type === "add") {
      addedFiles.set(canonicalPath, metadata);
    } else if (change.type === "delete" || change.type === "remove") {
      removedFiles.set(canonicalPath, metadata);
    } else {
      modifiedFiles.set(canonicalPath, metadata);
    }
  }

  return {
    changes: {
      addedDirectories: new Set(),
      removedDirectories: new Set(),
      addedFiles,
      modifiedFiles,
      removedFiles,
    },
    logger: null,
    rootDir: projectRoot,
  };
}

// NativeWind 4.2 emits Metro <=0.82 virtual style change payloads.
function withNativeWindMetro83ChangeEventFix(metroConfig) {
  const originalEnhanceMiddleware = metroConfig.server?.enhanceMiddleware;

  return {
    ...metroConfig,
    server: {
      ...metroConfig.server,
      enhanceMiddleware(middleware, metroServer) {
        const bundler = metroServer.getBundler().getBundler();

        bundler.getDependencyGraph().then((graph) => {
          const haste = graph?._haste;

          if (!haste || haste.__nativewindMetro83ChangeEventFix) {
            return;
          }

          const originalEmit = haste.emit.bind(haste);

          haste.emit = (eventName, event) => {
            return originalEmit(
              eventName,
              eventName === "change" ? normalizeNativeWindChangeEvent(event) : event,
            );
          };

          haste.__nativewindMetro83ChangeEventFix = true;
        });

        return originalEnhanceMiddleware
          ? originalEnhanceMiddleware(middleware, metroServer)
          : middleware;
      },
    },
  };
}

module.exports = withNativeWindMetro83ChangeEventFix(
  withNativeWind(config, { input: "./global.css" }),
);

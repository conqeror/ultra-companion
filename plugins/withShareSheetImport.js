// Expo config plugin: copies GPX/KML files from the iOS share sheet to the
// Caches directory while the security scope is still active.  Without this,
// JS can't read the file because the scope is released before RN boots.
// JS-side fallback: store/routeStore.ts importFromUri

const { withAppDelegate } = require("expo/config-plugins");

const HELPER_METHOD = `\
  private static func copyImportedFileToTmpIfNeeded(_ url: URL) -> URL {
    guard url.isFileURL else { return url }
    let ext = url.pathExtension.lowercased()
    guard ["gpx", "kml"].contains(ext) else { return url }

    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }

    // Copy to Caches/pending-import.<ext> — JS fallback reads from this path
    // (see store/routeStore.ts importFromUri)
    guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return url
    }
    let dest = cacheDir.appendingPathComponent("pending-import." + ext)
    try? FileManager.default.removeItem(at: dest)

    do {
      try FileManager.default.copyItem(at: url, to: dest)
      return dest
    } catch {
      return url
    }
  }`;

const RESOLVED_OPTIONS_BLOCK = `    var resolvedOptions = launchOptions
    if let url = launchOptions?[.url] as? URL {
      resolvedOptions?[.url] = Self.copyImportedFileToTmpIfNeeded(url)
    }

`;

const ORIGINAL_OPEN_URL_RETURN =
  "return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)";

const RESOLVED_OPEN_URL_BLOCK = `let resolvedUrl = Self.copyImportedFileToTmpIfNeeded(url)
    return super.application(app, open: resolvedUrl, options: options)
      || RCTLinkingManager.application(app, open: resolvedUrl, options: options)`;

function removeExistingResolvedOptionsBlocks(src) {
  return src.replace(
    / {4,8}var resolvedOptions = launchOptions\n {4}if let url = launchOptions\?\[\.url\] as\? URL \{\n {6}resolvedOptions\?\[\.url\] = Self\.copyImportedFileToTmpIfNeeded\(url\)\n {4}\}\n\n/g,
    "",
  );
}

function removeExistingHelperMethods(src) {
  return src.split(`${HELPER_METHOD}\n\n`).join("");
}

function withShareSheetImport(config) {
  return withAppDelegate(config, (mod) => {
    let src = removeExistingHelperMethods(
      removeExistingResolvedOptionsBlocks(mod.modResults.contents),
    );

    // 1. didFinishLaunchingWithOptions — resolve URL from launchOptions before RN init
    src = src.replace(
      "    let delegate = ReactNativeDelegate()",
      `${RESOLVED_OPTIONS_BLOCK}    let delegate = ReactNativeDelegate()`,
    );

    // Pass resolvedOptions to startReactNative
    src = src.replace(
      "launchOptions: launchOptions)\n#endif",
      "launchOptions: resolvedOptions)\n#endif",
    );

    // Pass resolvedOptions to super.application
    src = src.replace(
      "didFinishLaunchingWithOptions: launchOptions)",
      "didFinishLaunchingWithOptions: resolvedOptions)",
    );

    // 2. application(_:open:options:) — resolve URL before passing downstream
    if (!src.includes(RESOLVED_OPEN_URL_BLOCK)) {
      src = src.replace(ORIGINAL_OPEN_URL_RETURN, RESOLVED_OPEN_URL_BLOCK);
    }

    // 3. Add helper method to AppDelegate class (before Universal Links section)
    src = src.replace("  // Universal Links", `${HELPER_METHOD}\n\n  // Universal Links`);

    mod.modResults.contents = src;
    return mod;
  });
}

module.exports = withShareSheetImport;

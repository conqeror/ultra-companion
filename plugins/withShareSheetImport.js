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

function withShareSheetImport(config) {
  return withAppDelegate(config, (mod) => {
    let src = mod.modResults.contents;

    // 1. didFinishLaunchingWithOptions — resolve URL from launchOptions before RN init
    src = src.replace(
      "let delegate = ReactNativeDelegate()",
      `var resolvedOptions = launchOptions
    if let url = launchOptions?[.url] as? URL {
      resolvedOptions?[.url] = Self.copyImportedFileToTmpIfNeeded(url)
    }

    let delegate = ReactNativeDelegate()`,
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
    src = src.replace(
      "return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)",
      `let resolvedUrl = Self.copyImportedFileToTmpIfNeeded(url)
    return super.application(app, open: resolvedUrl, options: options)
      || RCTLinkingManager.application(app, open: resolvedUrl, options: options)`,
    );

    // 3. Add helper method to AppDelegate class (before Universal Links section)
    src = src.replace("  // Universal Links", `${HELPER_METHOD}\n\n  // Universal Links`);

    mod.modResults.contents = src;
    return mod;
  });
}

module.exports = withShareSheetImport;

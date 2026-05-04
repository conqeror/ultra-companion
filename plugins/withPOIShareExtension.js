const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const EXTENSION_TARGET_NAME = "UltraCompanionShareExtension";
const EXTENSION_DIR = "UltraCompanionShareExtension";
const SHARE_VIEW_CONTROLLER_FILE = "ShareViewController.swift";
const INFO_PLIST_FILE = "Info.plist";
const INFO_PLIST = `${EXTENSION_DIR}/${INFO_PLIST_FILE}`;

const SHARE_VIEW_CONTROLLER_SOURCE = `import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let statusLabel = UILabel()
  private let activityIndicator = UIActivityIndicatorView(style: .medium)
  private var didFinishOpenAttempt = false

  override func viewDidLoad() {
    super.viewDidLoad()
    configureView()
    loadAndOpenSharedPlace()
  }

  private func configureView() {
    view.backgroundColor = .systemBackground

    statusLabel.text = "Opening Ultra Companion..."
    statusLabel.font = .preferredFont(forTextStyle: .body)
    statusLabel.textAlignment = .center
    statusLabel.textColor = .label
    statusLabel.translatesAutoresizingMaskIntoConstraints = false

    activityIndicator.translatesAutoresizingMaskIntoConstraints = false
    activityIndicator.startAnimating()

    view.addSubview(statusLabel)
    view.addSubview(activityIndicator)

    NSLayoutConstraint.activate([
      activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -18),
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 16),
    ])
  }

  private func loadAndOpenSharedPlace() {
    Task {
      let payload = await loadPayload()
      await MainActor.run {
        guard payload.url != nil || payload.text != nil || payload.title != nil else {
          cancelShare("Ultra Companion could not read this share.")
          return
        }

        guard let deepLink = makeDeepLink(payload: payload) else {
          cancelShare("Ultra Companion could not open this share.")
          return
        }

        openDeepLink(deepLink)
      }
    }
  }

  private func openDeepLink(_ deepLink: URL) {
    extensionContext?.open(deepLink) { [weak self] success in
      DispatchQueue.main.async {
        self?.finishOpenAttempt(deepLink, success: success)
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      guard let self, !self.didFinishOpenAttempt else { return }
      self.finishOpenAttempt(deepLink, success: false)
    }
  }

  private func finishOpenAttempt(_ deepLink: URL, success: Bool) {
    guard !didFinishOpenAttempt else { return }

    if success || openViaResponderChain(deepLink) {
      didFinishOpenAttempt = true
      extensionContext?.completeRequest(returningItems: nil)
      return
    }

    activityIndicator.stopAnimating()
    statusLabel.text = "Could not open Ultra Companion."
  }

  @discardableResult
  private func openViaResponderChain(_ url: URL) -> Bool {
    let selector = NSSelectorFromString("openURL:")
    var responder: UIResponder? = self

    while let currentResponder = responder {
      if currentResponder.responds(to: selector) {
        currentResponder.perform(selector, with: url)
        return true
      }
      responder = currentResponder.next
    }

    return false
  }

  private func loadPayload() async -> SharePayload {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      return SharePayload()
    }

    var payload = SharePayload()
    for item in extensionItems {
      if payload.title == nil {
        payload.title = item.attributedTitle?.string
      }
      if payload.text == nil {
        payload.text = item.attributedContentText?.string
      }

      for provider in item.attachments ?? [] {
        if payload.url == nil,
          let url = await loadURL(from: provider)
        {
          payload.url = url
        }

        if payload.text == nil,
          let text = await loadText(from: provider)
        {
          payload.text = text
        }
      }
    }

    return payload
  }

  private func loadURL(from provider: NSItemProvider) async -> String? {
    let identifiers = [UTType.url.identifier, "public.url"]
    for identifier in identifiers where provider.hasItemConformingToTypeIdentifier(identifier) {
      if let value = await loadItem(from: provider, typeIdentifier: identifier) {
        if let url = value as? URL {
          return url.absoluteString
        }
        if let url = value as? NSURL {
          return url.absoluteString
        }
        if let text = value as? String {
          return text
        }
      }
    }
    return nil
  }

  private func loadText(from provider: NSItemProvider) async -> String? {
    let identifiers = [UTType.plainText.identifier, UTType.text.identifier, "public.text"]
    for identifier in identifiers where provider.hasItemConformingToTypeIdentifier(identifier) {
      if let value = await loadItem(from: provider, typeIdentifier: identifier) {
        if let text = value as? String {
          return text
        }
        if let url = value as? URL {
          return url.absoluteString
        }
        if let data = value as? Data {
          return String(data: data, encoding: .utf8)
        }
      }
    }
    return nil
  }

  private func loadItem(from provider: NSItemProvider, typeIdentifier: String) async -> NSSecureCoding? {
    await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
        continuation.resume(returning: item)
      }
    }
  }

  private func makeDeepLink(payload: SharePayload) -> URL? {
    var components = URLComponents()
    components.scheme = "ultra"
    components.host = "share-poi"
    components.queryItems = [
      URLQueryItem(name: "title", value: trimmed(payload.title)),
      URLQueryItem(name: "text", value: trimmed(payload.text)),
      URLQueryItem(name: "url", value: trimmed(payload.url)),
    ].filter { $0.value != nil }
    return components.url
  }

  private func cancelShare(_ message: String) {
    let error = NSError(
      domain: "UltraCompanionShareExtension",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
    extensionContext?.cancelRequest(withError: error)
  }

  private func trimmed(_ value: String?) -> String? {
    let text = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    return text?.isEmpty == false ? text : nil
  }
}

private struct SharePayload {
  var title: String?
  var text: String?
  var url: String?
}
`;

const INFO_PLIST_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Save POI</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>$(MARKETING_VERSION)</string>
\t<key>CFBundleVersion</key>
\t<string>$(CURRENT_PROJECT_VERSION)</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionAttributes</key>
\t\t<dict>
\t\t\t<key>NSExtensionActivationRule</key>
\t\t\t<dict>
\t\t\t\t<key>NSExtensionActivationSupportsText</key>
\t\t\t\t<true/>
\t\t\t\t<key>NSExtensionActivationSupportsWebPageWithMaxCount</key>
\t\t\t\t<integer>1</integer>
\t\t\t\t<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
\t\t\t\t<integer>1</integer>
\t\t\t</dict>
\t\t</dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.share-services</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
\t</dict>
</dict>
</plist>
`;

function ensureTargetAttributes(project, targetUuid) {
  const firstProject = project.getFirstProject().firstProject;
  firstProject.attributes ||= {};
  firstProject.attributes.TargetAttributes ||= {};
  firstProject.attributes.TargetAttributes[targetUuid] = {
    ...firstProject.attributes.TargetAttributes[targetUuid],
    ProvisioningStyle: "Automatic",
  };
  delete firstProject.attributes.TargetAttributes[targetUuid].DevelopmentTeam;
}

function ensureGroup(project) {
  let groupKey = project.findPBXGroupKey({ path: EXTENSION_DIR });
  if (groupKey) return groupKey;

  groupKey = project.findPBXGroupKey({ name: EXTENSION_TARGET_NAME });
  if (groupKey) return groupKey;

  groupKey = project.pbxCreateGroup(EXTENSION_TARGET_NAME, EXTENSION_DIR);
  const mainGroup = project.getFirstProject().firstProject.mainGroup;
  project.addToPbxGroup(groupKey, mainGroup);
  return groupKey;
}

function targetBuildConfigurations(project, targetName) {
  const target = project.pbxTargetByName(targetName);
  const configList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  return configList.buildConfigurations.map((config) => configs[config.value]);
}

function getExtensionBundleIdentifier(config) {
  const appBundleIdentifier = config.ios?.bundleIdentifier;
  if (!appBundleIdentifier) {
    throw new Error("withPOIShareExtension requires ios.bundleIdentifier in app config.");
  }
  return `${appBundleIdentifier}.share`;
}

function repairExtensionFileReferences(project) {
  const files = project.pbxFileReferenceSection();
  for (const key of Object.keys(files)) {
    if (key.endsWith("_comment")) continue;
    const file = files[key];
    const rawPath = String(file.path ?? "").replace(/^"|"$/g, "");
    if (rawPath.endsWith(`${EXTENSION_DIR}/${SHARE_VIEW_CONTROLLER_FILE}`)) {
      file.path = SHARE_VIEW_CONTROLLER_FILE;
    }
    if (rawPath.endsWith(`${EXTENSION_DIR}/${INFO_PLIST_FILE}`)) {
      file.path = INFO_PLIST_FILE;
    }
  }
}

function updateExtensionBuildSettings(project, extensionBundleIdentifier) {
  for (const config of targetBuildConfigurations(project, EXTENSION_TARGET_NAME)) {
    config.buildSettings = {
      ...config.buildSettings,
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CODE_SIGN_IDENTITY: '"Apple Development"',
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: 1,
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: INFO_PLIST,
      IPHONEOS_DEPLOYMENT_TARGET: "15.1",
      LD_RUNPATH_SEARCH_PATHS: [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ],
      MARKETING_VERSION: "1.0",
      PRODUCT_BUNDLE_IDENTIFIER: extensionBundleIdentifier,
      PRODUCT_NAME: EXTENSION_TARGET_NAME,
      SKIP_INSTALL: "YES",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: 1,
    };
    delete config.buildSettings.DEVELOPMENT_TEAM;
    delete config.buildSettings.PROVISIONING_PROFILE;
    delete config.buildSettings.PROVISIONING_PROFILE_SPECIFIER;
  }
}

function hasTargetDependency(project, fromTargetUuid, toTargetUuid) {
  const fromTarget = project.pbxNativeTargetSection()[fromTargetUuid];
  const dependencies = fromTarget?.dependencies ?? [];
  const targetDependencies = project.hash.project.objects.PBXTargetDependency ?? {};

  return dependencies.some((dependency) => {
    const targetDependency = targetDependencies[dependency.value];
    return targetDependency?.target === toTargetUuid;
  });
}

function ensureSourceFile(project, targetUuid, groupKey) {
  if (!project.hasFile(INFO_PLIST_FILE)) {
    project.addFile(INFO_PLIST_FILE, groupKey, { lastKnownFileType: "text.plist.xml" });
  }

  const sources = project.pbxSourcesBuildPhaseObj(targetUuid);
  const hasSource = sources.files.some((file) =>
    file.comment?.includes(SHARE_VIEW_CONTROLLER_FILE),
  );
  if (!hasSource) {
    project.addSourceFile(SHARE_VIEW_CONTROLLER_FILE, { target: targetUuid }, groupKey);
  }
}

function withPOIShareExtension(config) {
  const extensionBundleIdentifier = getExtensionBundleIdentifier(config);

  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      const extensionPath = path.join(mod.modRequest.platformProjectRoot, EXTENSION_DIR);
      fs.mkdirSync(extensionPath, { recursive: true });
      fs.writeFileSync(
        path.join(extensionPath, "ShareViewController.swift"),
        SHARE_VIEW_CONTROLLER_SOURCE,
      );
      fs.writeFileSync(path.join(extensionPath, "Info.plist"), INFO_PLIST_SOURCE);
      return mod;
    },
  ]);

  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const appTargetUuid = project.getFirstTarget().uuid;
    const groupKey = ensureGroup(project);
    let targetUuid = project.findTargetKey(EXTENSION_TARGET_NAME);

    if (!targetUuid) {
      const target = project.addTarget(
        EXTENSION_TARGET_NAME,
        "app_extension",
        EXTENSION_DIR,
        extensionBundleIdentifier,
      );
      targetUuid = target.uuid;
    }

    ensureTargetAttributes(project, targetUuid);
    repairExtensionFileReferences(project);
    ensureSourceFile(project, targetUuid, groupKey);
    updateExtensionBuildSettings(project, extensionBundleIdentifier);

    if (!hasTargetDependency(project, appTargetUuid, targetUuid)) {
      project.addTargetDependency(appTargetUuid, [targetUuid]);
    }

    return mod;
  });
}

module.exports = withPOIShareExtension;

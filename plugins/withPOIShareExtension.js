const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const EXTENSION_TARGET_NAME = "UltraCompanionShareExtension";
const EXTENSION_DIR = "UltraCompanionShareExtension";
const SHARE_VIEW_CONTROLLER_FILE = "ShareViewController.swift";
const INFO_PLIST_FILE = "Info.plist";
const ENTITLEMENTS_FILE = `${EXTENSION_TARGET_NAME}.entitlements`;
const INFO_PLIST = `${EXTENSION_DIR}/${INFO_PLIST_FILE}`;
const ENTITLEMENTS_PLIST = `${EXTENSION_DIR}/${ENTITLEMENTS_FILE}`;
const APP_GROUPS_ENTITLEMENT = "com.apple.security.application-groups";
const PENDING_SHARED_POI_FILE = "pending-poi-share.json";

const SHARE_VIEW_CONTROLLER_SOURCE = (appGroupIdentifier) => `import UIKit
import UniformTypeIdentifiers
import OSLog

final class ShareViewController: UIViewController {
  private let statusLabel = UILabel()
  private let activityIndicator = UIActivityIndicatorView(style: .medium)
  private let doneButton = UIButton(type: .system)
  private let logger = Logger(subsystem: "com.conqeror.ultracompanion.share", category: "ShareExtension")
  private let appGroupIdentifier = ${JSON.stringify(appGroupIdentifier)}
  private let pendingShareFileName = "${PENDING_SHARED_POI_FILE}"

  override func viewDidLoad() {
    super.viewDidLoad()
    configureView()
    loadAndSaveSharedPlace()
  }

  private func configureView() {
    view.backgroundColor = .systemBackground

    statusLabel.text = "Saving POI..."
    statusLabel.font = .preferredFont(forTextStyle: .body)
    statusLabel.textAlignment = .center
    statusLabel.textColor = .label
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.numberOfLines = 0

    activityIndicator.translatesAutoresizingMaskIntoConstraints = false
    activityIndicator.startAnimating()

    doneButton.setTitle("Done", for: .normal)
    doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    doneButton.translatesAutoresizingMaskIntoConstraints = false
    doneButton.isHidden = true
    doneButton.addTarget(self, action: #selector(doneButtonTapped), for: .touchUpInside)

    view.addSubview(statusLabel)
    view.addSubview(activityIndicator)
    view.addSubview(doneButton)

    NSLayoutConstraint.activate([
      activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -18),
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 16),
      doneButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      doneButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 18),
      doneButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
    ])
  }

  private func loadAndSaveSharedPlace() {
    Task {
      let payload = await loadPayload()
      await MainActor.run {
        logger.info("Loaded Google Maps share payload title=\\(payload.title ?? "<nil>", privacy: .public) text=\\(payload.text ?? "<nil>", privacy: .public) url=\\(payload.url ?? "<nil>", privacy: .public)")

        guard payload.url != nil || payload.text != nil || payload.title != nil else {
          logger.error("Google Maps share payload was empty")
          finishShare("Ultra Companion could not read this share.", isError: true)
          return
        }

        guard savePayload(payload) else {
          finishShare("Ultra Companion could not save this POI.", isError: true)
          return
        }

        finishShare("Saved to Ultra Companion. Open Ultra Companion to finish.")
      }
    }
  }

  private func savePayload(_ payload: SharePayload) -> Bool {
    guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      logger.error("App Group container unavailable for \\(self.appGroupIdentifier, privacy: .public)")
      return false
    }

    var body: [String: String] = [
      "receivedAt": ISO8601DateFormatter().string(from: Date()),
    ]
    if let title = trimmed(payload.title) {
      body["title"] = title
    }
    if let text = trimmed(payload.text) {
      body["text"] = text
    }
    if let url = trimmed(payload.url) {
      body["url"] = url
    }

    guard body["title"] != nil || body["text"] != nil || body["url"] != nil else {
      logger.error("Google Maps share payload was blank after trimming")
      return false
    }

    do {
      let fileURL = containerURL.appendingPathComponent(pendingShareFileName)
      let data = try JSONSerialization.data(withJSONObject: body, options: [])
      try data.write(to: fileURL, options: [.atomic])
      logger.info("Saved Google Maps share payload to App Group \\(self.appGroupIdentifier, privacy: .public)")
      return true
    } catch {
      logger.error("Failed to save Google Maps share payload: \\(error.localizedDescription, privacy: .public)")
      return false
    }
  }

  private func finishShare(_ message: String, isError: Bool = false) {
    activityIndicator.stopAnimating()
    statusLabel.text = message
    statusLabel.textColor = isError ? .systemRed : .label
    doneButton.isHidden = false
  }

  private func loadPayload() async -> SharePayload {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      logger.error("Share extension had no NSExtensionItem input items")
      return SharePayload()
    }

    logger.info("Share extension input item count=\\(extensionItems.count, privacy: .public)")
    var payload = SharePayload()
    for (itemIndex, item) in extensionItems.enumerated() {
      logger.info("Share extension item=\\(itemIndex, privacy: .public) attributedTitle=\\(item.attributedTitle?.string ?? "<nil>", privacy: .public) attributedContentText=\\(item.attributedContentText?.string ?? "<nil>", privacy: .public)")
      if payload.title == nil {
        payload.title = item.attributedTitle?.string
      }
      if payload.text == nil {
        payload.text = item.attributedContentText?.string
      }

      for (providerIndex, provider) in (item.attachments ?? []).enumerated() {
        logger.info("Share extension provider item=\\(itemIndex, privacy: .public) provider=\\(providerIndex, privacy: .public) registeredTypes=\\(provider.registeredTypeIdentifiers.joined(separator: ", "), privacy: .public)")
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
      logger.info("Trying URL item provider type=\\(identifier, privacy: .public)")
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
      logger.info("Trying text item provider type=\\(identifier, privacy: .public)")
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
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
        if let error {
          self.logger.error("Failed to load item type=\\(typeIdentifier, privacy: .public) error=\\(error.localizedDescription, privacy: .public)")
        } else if let item {
          self.logger.info("Loaded item type=\\(typeIdentifier, privacy: .public) class=\\(String(describing: type(of: item)), privacy: .public) value=\\(self.describeLoadedValue(item), privacy: .public)")
        } else {
          self.logger.info("Loaded nil item type=\\(typeIdentifier, privacy: .public)")
        }
        continuation.resume(returning: item)
      }
    }
  }

  private func describeLoadedValue(_ value: NSSecureCoding) -> String {
    if let url = value as? URL {
      return url.absoluteString
    }
    if let url = value as? NSURL {
      return url.absoluteString ?? "<nil>"
    }
    if let text = value as? String {
      return text
    }
    if let data = value as? Data {
      return String(data: data, encoding: .utf8) ?? "<data \\(data.count) bytes>"
    }
    return String(describing: value)
  }

  @objc private func doneButtonTapped() {
    logger.info("Share extension done tapped")
    extensionContext?.completeRequest(returningItems: nil)
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

const ENTITLEMENTS_PLIST_SOURCE = (appGroupIdentifier) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>${APP_GROUPS_ENTITLEMENT}</key>
\t<array>
\t\t<string>${appGroupIdentifier}</string>
\t</array>
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

function getAppGroupIdentifier(config) {
  const appBundleIdentifier = config.ios?.bundleIdentifier;
  if (!appBundleIdentifier) {
    throw new Error("withPOIShareExtension requires ios.bundleIdentifier in app config.");
  }
  return `group.${appBundleIdentifier}`;
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
    if (rawPath.endsWith(`${EXTENSION_DIR}/${ENTITLEMENTS_FILE}`)) {
      file.path = ENTITLEMENTS_FILE;
    }
  }
}

function updateExtensionBuildSettings(project, extensionBundleIdentifier) {
  for (const config of targetBuildConfigurations(project, EXTENSION_TARGET_NAME)) {
    config.buildSettings = {
      ...config.buildSettings,
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CODE_SIGN_IDENTITY: '"Apple Development"',
      CODE_SIGN_ENTITLEMENTS: ENTITLEMENTS_PLIST,
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
  if (!project.hasFile(ENTITLEMENTS_FILE)) {
    project.addFile(ENTITLEMENTS_FILE, groupKey, { lastKnownFileType: "text.plist.entitlements" });
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
  const appGroupIdentifier = getAppGroupIdentifier(config);

  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      const extensionPath = path.join(mod.modRequest.platformProjectRoot, EXTENSION_DIR);
      fs.mkdirSync(extensionPath, { recursive: true });
      fs.writeFileSync(
        path.join(extensionPath, "ShareViewController.swift"),
        SHARE_VIEW_CONTROLLER_SOURCE(appGroupIdentifier),
      );
      fs.writeFileSync(path.join(extensionPath, "Info.plist"), INFO_PLIST_SOURCE);
      fs.writeFileSync(
        path.join(extensionPath, ENTITLEMENTS_FILE),
        ENTITLEMENTS_PLIST_SOURCE(appGroupIdentifier),
      );
      return mod;
    },
  ]);

  config = withEntitlementsPlist(config, (mod) => {
    const existingGroups = Array.isArray(mod.modResults[APP_GROUPS_ENTITLEMENT])
      ? mod.modResults[APP_GROUPS_ENTITLEMENT]
      : [];
    mod.modResults[APP_GROUPS_ENTITLEMENT] = Array.from(
      new Set([...existingGroups, appGroupIdentifier]),
    );
    return mod;
  });

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

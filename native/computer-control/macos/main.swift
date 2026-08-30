import AppKit
import ApplicationServices
import Foundation

private let blockedTargets = [
  "terminal", "iterm", "powershell", "credential", "keychain access",
  "1password", "bitwarden", "authenticator", "system settings",
  "system preferences", "activity monitor", "security",
]

private func emit(_ value: Any) {
  guard JSONSerialization.isValidJSONObject(value),
        let data = try? JSONSerialization.data(withJSONObject: value),
        let output = String(data: data, encoding: .utf8) else {
    FileHandle.standardError.write(Data("Unable to encode Computer Control output\n".utf8))
    exit(1)
  }
  FileHandle.standardOutput.write(Data((output + "\n").utf8))
}

private func fail(_ message: String) -> Never {
  emit(["error": message])
  exit(1)
}

private func clean(_ value: String, limit: Int) -> String {
  String(value.replacingOccurrences(of: "\0", with: "").prefix(limit))
}

private func ensureSafeTarget(_ target: String) {
  let lowered = target.lowercased()
  if blockedTargets.contains(where: lowered.contains) {
    fail("Computer Control cannot operate terminals, credential tools, or system security controls")
  }
}

private func runningApp(_ target: String) -> NSRunningApplication {
  ensureSafeTarget(target)
  let apps = NSWorkspace.shared.runningApplications.filter {
    !$0.isTerminated && $0.activationPolicy == .regular
  }
  let lowered = target.lowercased()
  if let exact = apps.first(where: {
    $0.localizedName?.lowercased() == lowered ||
      $0.bundleIdentifier?.lowercased() == lowered
  }) { return exact }
  let partial = apps.filter {
    $0.localizedName?.lowercased().contains(lowered) == true ||
      $0.bundleIdentifier?.lowercased().contains(lowered) == true
  }
  if partial.count == 1 { return partial[0] }
  if partial.count > 1 { fail("That application name matches more than one visible app") }
  fail("The requested application is not visible")
}

private func accessibilityReady() -> Bool {
  let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  return AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
}

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
    return nil
  }
  return value
}

private func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  if let string = attribute(element, name) as? String { return string }
  if let number = attribute(element, name) as? NSNumber { return number.stringValue }
  return nil
}

private func children(_ element: AXUIElement) -> [AXUIElement] {
  (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

private func bounds(_ element: AXUIElement) -> [String: Double]? {
  guard let positionValue = attribute(element, kAXPositionAttribute),
        let sizeValue = attribute(element, kAXSizeAttribute),
        CFGetTypeID(positionValue) == AXValueGetTypeID(),
        CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
  return [
    "x": Double(point.x), "y": Double(point.y),
    "width": Double(size.width), "height": Double(size.height),
  ]
}

private func snapshot(_ element: AXUIElement) -> [String: Any] {
  let role = stringAttribute(element, kAXRoleAttribute) ?? ""
  let title = stringAttribute(element, kAXTitleAttribute) ?? ""
  let description = stringAttribute(element, kAXDescriptionAttribute) ?? ""
  let identifier = stringAttribute(element, kAXIdentifierAttribute) ?? ""
  let value = stringAttribute(element, kAXValueAttribute) ?? ""
  let label = [title, description, identifier, value]
    .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? role
  var item: [String: Any] = [
    "role": role,
    "label": String(label.prefix(300)),
    "identifier": String(identifier.prefix(200)),
    "enabled": (attribute(element, kAXEnabledAttribute) as? NSNumber)?.boolValue ?? true,
  ]
  if let frame = bounds(element) { item["bounds"] = frame }
  return item
}

private func elements(_ application: NSRunningApplication, limit: Int = 400) -> [AXUIElement] {
  let root = AXUIElementCreateApplication(application.processIdentifier)
  var queue: [(AXUIElement, Int)] = [(root, 0)]
  var result: [AXUIElement] = []
  while !queue.isEmpty && result.count < limit {
    let (element, depth) = queue.removeFirst()
    result.append(element)
    if depth < 8 {
      for child in children(element).prefix(120) { queue.append((child, depth + 1)) }
    }
  }
  return result
}

private func matchingElement(_ application: NSRunningApplication, query: String) -> AXUIElement {
  let wanted = query.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
  if wanted.isEmpty { fail("Describe the control to use") }
  let all = elements(application)
  if let exact = all.first(where: {
    let item = snapshot($0)
    return [item["label"], item["identifier"]]
      .compactMap { $0 as? String }
      .contains(where: { $0.lowercased() == wanted })
  }) { return exact }
  if let partial = all.first(where: {
    let item = snapshot($0)
    return [item["label"], item["identifier"]]
      .compactMap { $0 as? String }
      .contains(where: { $0.lowercased().contains(wanted) })
  }) { return partial }
  fail("No accessible control matched that description")
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("Missing Computer Control command") }
let command = arguments[1]

if command == "list" {
  let apps: [[String: Any]] = NSWorkspace.shared.runningApplications.compactMap { application in
    guard !application.isTerminated,
          application.activationPolicy == .regular,
          let name = application.localizedName,
          !blockedTargets.contains(where: name.lowercased().contains) else { return nil }
    return [
      "name": name,
      "bundleIdentifier": application.bundleIdentifier ?? "",
      "pid": Int(application.processIdentifier),
    ]
  }
  emit(apps)
  exit(0)
}

guard accessibilityReady() else {
  fail("Allow osCode in System Settings > Privacy & Security > Accessibility, then try again")
}
guard arguments.count >= 3 else { fail("Choose a visible application first") }
let target = clean(arguments[2], limit: 160)
let query = arguments.count > 3 ? clean(arguments[3], limit: 300) : ""
let text = arguments.count > 4 ? clean(arguments[4], limit: 20_000) : ""
let application = runningApp(target)

switch command {
case "inspect":
  let visible = elements(application)
    .map(snapshot)
    .filter { item in
      guard !query.isEmpty else { return true }
      return ((item["label"] as? String) ?? "").lowercased().contains(query.lowercased()) ||
        ((item["identifier"] as? String) ?? "").lowercased().contains(query.lowercased())
    }
    .prefix(300)
  emit(Array(visible))
case "invoke", "click":
  let element = matchingElement(application, query: query)
  let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
  guard result == .success else {
    fail("That control does not expose a safe Accessibility action")
  }
  emit(["action": "invoke", "target": target, "control": snapshot(element)])
case "set-value", "type":
  let element = matchingElement(application, query: query)
  var settable = DarwinBoolean(false)
  guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success,
        settable.boolValue,
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef) == .success else {
    fail("That field does not expose a safe Accessibility value action")
  }
  emit(["action": "set-value", "target": target, "control": snapshot(element)])
default:
  fail("Unsupported Computer Control command")
}

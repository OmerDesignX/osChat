import assert from "node:assert/strict";
import test from "node:test";
import {
  ComputerSystemPermissionError,
  computerPermissionGuidance,
  computerPermissionIssue,
  isComputerSystemPermissionError,
} from "../dist-electron/main/computer-permissions.js";

test("Computer Control recognizes native permission failures without treating ordinary errors as permissions", () => {
  assert.equal(
    computerPermissionIssue(
      "Allow osCode in System Settings > Privacy & Security > Accessibility",
      "darwin",
    ),
    "accessibility",
  );
  assert.equal(
    computerPermissionIssue(
      "Screen capture permission was not granted",
      "linux",
    ),
    "screen-capture",
  );
  assert.equal(
    computerPermissionIssue("UI Automation was blocked", "win32"),
    "accessibility",
  );
  assert.equal(
    computerPermissionIssue("No visible control matched Search", "darwin"),
    null,
  );
});

test("Computer Control permission dialogs provide platform-specific settings guidance", () => {
  const mac = computerPermissionGuidance("accessibility", "darwin");
  assert.match(mac.detail, /Privacy & Security › Accessibility/);
  assert.match(mac.settingsUrl, /Privacy_Accessibility/);
  assert.equal(mac.restartRequired, false);

  const macScreen = computerPermissionGuidance("screen-capture", "darwin");
  assert.equal(macScreen.restartRequired, true);
  assert.match(macScreen.detail, /click \+.*Applications/);

  const windows = computerPermissionGuidance("accessibility", "win32");
  assert.match(windows.detail, /same privilege level/);
  assert.equal(windows.settingsUrl, "ms-settings:easeofaccess");

  const linux = computerPermissionGuidance("screen-capture", "linux");
  assert.match(linux.detail, /Wayland/);
  assert.equal(linux.settingsUrl, "");
  assert.equal(linux.restartRequired, false);
});

test("Computer Control system permissions retain typed retry metadata", () => {
  const error = new ComputerSystemPermissionError(
    "accessibility",
    "Enable Accessibility and return to osCode",
    false,
  );
  assert.equal(isComputerSystemPermissionError(error), true);
  assert.equal(error.code, "OSCODE_COMPUTER_PERMISSION_REQUIRED");
  assert.equal(error.permissionKind, "accessibility");
  assert.equal(error.restartRequired, false);
});

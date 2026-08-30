export type ComputerPermissionKind = "accessibility" | "screen-capture";

export class ComputerSystemPermissionError extends Error {
  readonly code = "OSCODE_COMPUTER_PERMISSION_REQUIRED";

  constructor(
    readonly permissionKind: ComputerPermissionKind,
    message: string,
    readonly restartRequired = false,
  ) {
    super(message);
    this.name = "ComputerSystemPermissionError";
  }
}

export function isComputerSystemPermissionError(
  error: unknown,
): error is ComputerSystemPermissionError {
  return (
    error instanceof ComputerSystemPermissionError ||
    (error instanceof Error &&
      (error as Error & { code?: string }).code ===
        "OSCODE_COMPUTER_PERMISSION_REQUIRED")
  );
}

export function computerPermissionIssue(
  diagnostic: string,
  platform: NodeJS.Platform = process.platform,
): ComputerPermissionKind | null {
  const value = diagnostic.toLowerCase();
  if (
    /screen recording|screen capture permission|screen-sharing settings|screencast portal|pipewire.*permission|org\.freedesktop\.portal.*(?:denied|notallowed)/i.test(
      value,
    )
  )
    return "screen-capture";
  if (
    /accessibility|axisprocesstrusted|at-spi.*(?:denied|unavailable)|ui automation.*(?:denied|blocked)|access is denied|requires elevation|0x80070005/i.test(
      value,
    )
  )
    return "accessibility";
  if (platform === "linux" && /permission denied/i.test(value))
    return "screen-capture";
  return null;
}

export function computerPermissionGuidance(
  kind: ComputerPermissionKind,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "darwin")
    return kind === "accessibility"
      ? {
          title: "Allow Computer Control",
          message: "osChat needs Accessibility access",
          detail:
            "Open System Settings, enable osChat under Privacy & Security › Accessibility, then return to osChat and retry the request.",
          settingsUrl:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          restartRequired: false,
        }
      : {
          title: "Allow screen viewing",
          message: "osChat needs Screen Recording access",
          detail:
            "Open System Settings and enable osChat under Privacy & Security › Screen & System Audio Recording. If osChat is missing from the list, click + and select the installed osChat.app from Applications. Then quit and reopen osChat if macOS asks you to.",
          settingsUrl:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
          restartRequired: true,
        };
  if (platform === "win32")
    return {
      title: "Allow Computer Control",
      message:
        kind === "screen-capture"
          ? "Windows blocked screen capture"
          : "Windows blocked UI Automation",
      detail:
        kind === "screen-capture"
          ? "Review Windows privacy and accessibility settings, allow desktop capture for osChat, then retry the request."
          : "The target app and osChat normally need the same privilege level. Reopen the target without Administrator mode, or deliberately reopen osChat as Administrator only when the target requires it.",
      settingsUrl: "ms-settings:easeofaccess",
      restartRequired: false,
    };
  return {
    title: "Allow Computer Control",
    message:
      kind === "screen-capture"
        ? "Linux blocked screen sharing"
        : "Linux accessibility access is unavailable",
    detail:
      kind === "screen-capture"
        ? "Allow osChat in your desktop's Screen Sharing, Screencast, or Privacy settings. On Wayland, approve the desktop portal chooser when it appears, then retry."
        : "Enable your desktop's accessibility service (AT-SPI) for osChat, then retry. The exact setting depends on GNOME, KDE, Cinnamon, MATE, or Xfce.",
    settingsUrl: "",
    restartRequired: false,
  };
}

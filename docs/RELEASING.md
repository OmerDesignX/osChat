# Releasing osChat

osChat packages are built locally on each target operating system and uploaded to GitHub Releases manually. GitHub Actions is not required. Native packages should be built and tested on the matching operating system.

## Release rules

- Build from a clean checkout of the commit being released.
- Use Node.js 22 or newer and pnpm 11.19.0.
- Keep at least 30 GB free; the scripts stop below 20 GiB.
- Change only `releaseScripts/VERSION.txt` to begin a release. The platform scripts validate and synchronize the version.
- Do not rebuild an already-published platform package unless its version or platform source changed.
- Model weights are downloaded separately from the verified `OmerDesignX/osCode-Models` catalogue and are never embedded in installers.

## macOS

On macOS 12 Monterey or newer, run:

```sh
bash releaseScripts/macos/build.sh
```

The script runs formatting, tests, native preparation, smoke tests, packaging, and architecture verification. It produces separate unsigned installers:

```text
release-assets/macos/osChat-<version>-mac-arm64.dmg
release-assets/macos/osChat-<version>-mac-x64.dmg
```

Use arm64 for Apple silicon and x64 for Intel. Apple-silicon Macs use MLX when the operating system and model support it; Monterey, Ventura, and Intel Macs fall back to the matching GGUF model through llama.cpp. The application is intentionally unsigned and unnotarized, so release notes must explain the normal Gatekeeper warning. Signing remains an explicit maintainer opt-in through the retained `OSCODE_REQUIRE_SIGNED=1` compatibility setting.

## Windows

On native 64-bit Windows 10 or 11, run from PowerShell or Command Prompt:

```powershell
.\releaseScripts\windows\build-windows.cmd
```

Both supported Windows versions currently use the same x64 NSIS installer:

```text
release-assets/windows/osChat-Setup-<version>.exe
```

## Linux

On current x64 Debian or Ubuntu, run:

```sh
bash releaseScripts/linux/build.sh
```

The verified package is staged at:

```text
release-assets/linux/osChat-<version>-x64.deb
```

Users install it with their graphical package manager or `sudo apt install ./osChat-<version>-x64.deb`. Linux ARM packages are not currently produced.

## Publish manually

1. Confirm the source commit, version, and release notes.
2. Create or open the matching draft GitHub Release.
3. Upload the verified artifacts for the platforms being published.
4. Confirm every filename contains the correct version and architecture.
5. Publish the release after testing the downloaded artifacts.

## Application updates

The full installer is also the updater payload; there is no separate patch file. Upload each installer without renaming it to its permanent osChat updater channel:

- [macOS Apple Silicon](https://github.com/OmerDesignX/osChat/releases/tag/macOS-Apple-Silicon-Updater)
- [macOS Intel](https://github.com/OmerDesignX/osChat/releases/tag/macOS-Intel-Updater)
- [Windows 11](https://github.com/OmerDesignX/osChat/releases/tag/Windows-11-Updater)
- [Windows 10](https://github.com/OmerDesignX/osChat/releases/tag/Windows-10-Updater)
- [Linux](https://github.com/OmerDesignX/osChat/releases/tag/Linux-Updater)

Windows 10 and Windows 11 currently receive the same installer, uploaded to both channels. Keeping the channels separate permits operating-system-specific packages later without changing installed clients.

When automatic updates are enabled, osChat downloads a newer verified package but lets the user decide when to install. Manual Check, Download, and Install controls remain in Settings. Windows opens the verified NSIS installer, Linux opens the `.deb` with the system package manager, and unsigned macOS builds open the DMG for the user to drag osChat into Applications.

## Safety checks

- Run `pnpm format:check`, `pnpm typecheck`, and `pnpm test`.
- Run the native smoke test on each target operating system.
- Confirm the packaged app exposes the preload bridge but no Node.js globals to the renderer.
- Verify document, spreadsheet, presentation, and chat creation, persistence, export, and deletion.
- Verify all agent tools still follow Files, Edits, Web, Browser, Terminal, and Computer Control permissions.
- Confirm outbound-data and prompt-injection guards remain enabled.
- Confirm a Small, Medium, Large, and custom model can be selected without changing the product workspace.
- Build artifacts only with the scripts under `releaseScripts/`.

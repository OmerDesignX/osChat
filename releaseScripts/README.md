# Local release scripts

Edit only `VERSION.txt` when starting a release. Each operating-system script validates that semantic version and synchronizes it into `package.json` before installing, testing, packaging, verifying, and staging the native artifact.

Run the script on the operating system it targets:

```sh
# macOS 12 or newer
bash releaseScripts/macos/build.sh

# Windows 10 or Windows 11, from PowerShell or Command Prompt
.\releaseScripts\windows\build-windows.cmd

# Current x64 Debian or Ubuntu
bash releaseScripts/linux/build.sh
```

Windows 10 and Windows 11 use the same x64 NSIS installer. The PowerShell entry point locates Git for Windows directly, avoiding the optional WSL `bash` launcher. Native packages must be built on their matching operating systems.

Verified artifacts are staged in the ignored `release-assets/macos`, `release-assets/windows`, or `release-assets/linux` folder. Electron Builder's intermediate root `release/` folder is ignored by Git and removed after successful staging. The macOS script generates a padded, multi-resolution `.icns` file without changing the Windows/Linux `build/icon.png` asset, then stages separate `mac-arm64` and `mac-x64` DMGs.

The macOS release is unsigned by design. The build disables Electron Builder's certificate discovery, verifies the application contents and native architectures, and stages both DMGs without requiring Apple credentials. macOS may show a Gatekeeper warning because the application is not signed or notarized. A maintainer can opt into a signed build explicitly with the retained compatibility setting `OSCODE_REQUIRE_SIGNED=1 bash releaseScripts/macos/build.sh` after configuring Electron Builder's signing credentials.

## Updater uploads

The same staged installer is used for both a normal versioned release and its permanent updater channel. Keep the generated filename unchanged and upload it as follows:

- upload the arm64 DMG to [macOS Apple Silicon](https://github.com/OmerDesignX/osChat/releases/tag/macOS-Apple-Silicon-Updater);
- upload the x64 DMG to [macOS Intel](https://github.com/OmerDesignX/osChat/releases/tag/macOS-Intel-Updater);
- upload the same Windows `.exe` to [Windows 10](https://github.com/OmerDesignX/osChat/releases/tag/Windows-10-Updater) and [Windows 11](https://github.com/OmerDesignX/osChat/releases/tag/Windows-11-Updater); and
- upload the Linux `.deb` to [Linux](https://github.com/OmerDesignX/osChat/releases/tag/Linux-Updater).

The application selects the highest newer semantic version in its own channel and verifies the GitHub SHA-256 digest before opening the installer. Each permanent channel release must be public, non-draft, and non-prerelease. See `docs/RELEASING.md` for the complete user experience and unsigned-macOS limitation.

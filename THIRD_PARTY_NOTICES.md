# Third-party notices

osChat uses open-source packages listed in `package.json` and `pnpm-lock.yaml`.

Windows release builds additionally bundle **MinGit 2.55.0(3)** from Git for Windows. MinGit is intended for non-interactive Git integration by third-party applications and is distributed under the licenses included inside the MinGit archive. Git is licensed under GNU GPL version 2. The corresponding Git for Windows source and immutable release are available at:

- https://github.com/git-for-windows/git/tree/v2.55.0.windows.3
- https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3

The bundled archive is `MinGit-2.55.0.3-64-bit.zip`, verified before packaging with SHA-256 `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`.

Release builds also bundle **uv 0.11.15**, licensed under Apache-2.0 or MIT, and Python distributions installed by uv from the Python Standalone Builds project. The uv executable archive is verified against its official release checksum before use. License files shipped inside each Python distribution remain with that distribution.

- https://github.com/astral-sh/uv/releases/tag/0.11.15
- https://github.com/astral-sh/python-build-standalone

Release builds bundle the native local command-line runtime from **llama.cpp build b10517**, licensed under MIT. osChat invokes the non-interactive `llama-completion` command as a hidden local child process; it does not start `llama-server`, and the server executable is not distributed. Official archives are verified before packaging: Windows x64 CPU `f3fed0673c934ade45663a8e29220a0903b58ad7eff91eeeef606a37061cd031`, Windows x64 Vulkan `afa3b2d38b2b461e45a3df7783009b22b2b7e4bb92b40bcb910d0c8924925c88`, Windows x64 CUDA 12.4 backend `e144d3291f4f2615ed9af1baa39b6f4777591188c31e18f0f0a8ba5e4cb1db13`, Windows x64 CUDA 13.3 backend `cbfac1e655d550df2515bac060b6410f9ed6aabc7df014353481608ac514b6dd`, macOS Apple silicon `d5d9ed544126f9f1af62252223f70ba11a75d1ee6f63bb61999e398bb8c74ffc`, macOS Intel `f0aa2c8b9b9b2a5b44c767b83e3f47c4e7e1da9473a038f11e6d1e6a983d4b2b`, and Ubuntu x64 CPU `dfe6304a96af76975838db974eacfb825a5bcc71096c8553e06a63ff2c0240b1`. Microsoft Visual C++ libraries are placed beside the Windows commands. NVIDIA CUDA runtime libraries are not embedded in the installer. A compatible installed runtime is used when available; users may explicitly add the checksum-pinned official CUDA 12.4 runtime to osChat's private application-data directory.

- https://github.com/ggml-org/llama.cpp/releases/tag/b10517
- https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist

osChat can install **PlatformIO Core** into a separate application-data environment when the user requests it. PlatformIO Core is not copied from the VS Code extension and is not included in the source repository. It is licensed under Apache-2.0:

- https://github.com/platformio/platformio-core

Windows releases bundle **Microsoft Windows App Development CLI 0.5.0** under the MIT license for local UI Automation. osChat opts out of its optional anonymous usage reporting on every launch by setting `WINAPP_CLI_TELEMETRY_OPTOUT=1`; no osChat Computer Control data is sent to Microsoft. The bundled helper uses Windows UI Automation for semantic actions and Windows `SendInput` only when a visible foreground control requires real input.

- https://github.com/microsoft/winappCli

macOS releases compile osChat's open-source Computer Control helper from `native/computer-control/macos/main.swift`. It uses the operating system Accessibility API and requires the user to grant Accessibility permission. It does not install a driver or start a server.

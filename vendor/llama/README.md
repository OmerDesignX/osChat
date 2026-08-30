# Bundled llama.cpp runtime

osCode uses the native, non-interactive `llama-completion` child process for local GGUF inference. It does not start an HTTP server, bind a network port, or distribute the `llama-server` executable.

Native runtimes are pinned to official llama.cpp build `b10517`:

- Release: https://github.com/ggml-org/llama.cpp/releases/tag/b10517
- Windows x64 CPU: `f3fed0673c934ade45663a8e29220a0903b58ad7eff91eeeef606a37061cd031`
- macOS Apple silicon: `d5d9ed544126f9f1af62252223f70ba11a75d1ee6f63bb61999e398bb8c74ffc`
- macOS Intel: `f0aa2c8b9b9b2a5b44c767b83e3f47c4e7e1da9473a038f11e6d1e6a983d4b2b`
- Ubuntu x64 CPU: `dfe6304a96af76975838db974eacfb825a5bcc71096c8553e06a63ff2c0240b1`
- License: MIT; see `LICENSE`

Only `llama-completion` and its required implementation/runtime libraries are retained. Windows also carries the matching Microsoft Visual C++ libraries so an administrator-installed runtime is unnecessary. Upstream completion launchers currently link to the server implementation library, but osCode never invokes server mode and no platform package contains the `llama-server` executable.

`pnpm run llama:prepare` verifies the checked-in Windows runtime and downloads, verifies, extracts, and trims the native macOS/Linux archives on their corresponding CI runners. Native symbolic links and executable permissions are therefore preserved by the target operating system.

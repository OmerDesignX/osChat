# Security policy

## Supported versions

Security fixes are applied to the latest released version of osCode.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not include exploit details, credentials, private project files, or personal information in a public issue.

Include the affected version, operating system, reproduction steps, impact, and any suggested mitigation. Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Security model

osCode treats opened projects as untrusted data. The renderer is sandboxed without Node access, IPC operations are constrained to the selected project, renderer networking is blocked, and text editing is limited to validated UTF-8 files no larger than 10 MB. Running project code, terminal commands, Git operations, and installing runtimes remain explicit user actions.

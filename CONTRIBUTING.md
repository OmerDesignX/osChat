# Contributing to osCode

Thank you for helping make osCode better.

## Development setup

1. Install Node.js 22 or newer and pnpm 11.19.0.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm dev` for local development.
4. Before submitting a change, run `pnpm run typecheck` and `pnpm run build:dir`.

Keep changes focused and include a clear explanation of user-visible behavior. Do not commit generated builds, dependency folders, editor settings, local environments, credentials, or project data.

## Security-sensitive changes

Changes to Electron IPC, filesystem boundaries, subprocess execution, extension permissions, Git operations, external links, or terminal handling need an explicit security review in the pull request description.

## Pull requests

- Use a descriptive title and explain how the change was tested.
- Keep the renderer sandboxed and preserve context isolation.
- Prefer argument arrays over shell command strings.
- Avoid adding telemetry, analytics, or implicit network access.
- Update documentation when behavior or packaging changes.

By contributing, you agree that your contribution is licensed under the MIT License.

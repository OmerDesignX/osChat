import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const requireNativeModule = createRequire(import.meta.url);

const nodePty = await import("node-pty");

if (typeof nodePty.spawn !== "function") {
  throw new Error("node-pty did not expose a terminal spawn function");
}

console.log(`node-pty is available for ${process.platform}-${process.arch}`);

if (process.platform !== "win32") {
  const shell = process.env.SHELL || "/bin/sh";
  const terminalOutput = await new Promise((resolve, reject) => {
    let output = "";
    const terminal = nodePty.spawn(shell, ["-c", "printf oscode-pty-ready"], {
      cwd: process.cwd(),
      env: process.env,
      cols: 80,
      rows: 24,
      name: "xterm-256color",
    });
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error("node-pty terminal check timed out"));
    }, 10_000);
    terminal.onData((data) => (output += data));
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode === 0) resolve(output);
      else reject(new Error(`node-pty terminal exited with ${exitCode}`));
    });
  });
  if (!String(terminalOutput).includes("oscode-pty-ready"))
    throw new Error("node-pty terminal returned unexpected output");
  console.log(
    `node-pty terminal launched for ${process.platform}-${process.arch}`,
  );
}

function run(executable, args, env = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...env },
    });
    child.stdout.on("data", (data) => (stdout += String(data)));
    child.stderr.on("data", (data) => (stderr += String(data)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0)
        reject(new Error(stderr.trim() || `${executable} exited with ${code}`));
      else resolve(stdout.trim());
    });
  });
}

if (process.platform === "win32") {
  const computerHelper = path.resolve(
    "node_modules",
    "@microsoft",
    "winappcli",
    "bin",
    "win-x64",
    "winapp.exe",
  );
  await access(computerHelper);
  const output = await run(computerHelper, ["ui", "list-windows", "--json"], {
    WINAPP_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  });
  if (!Array.isArray(JSON.parse(output)))
    throw new Error("Computer Control helper did not return a window list");
} else if (process.platform === "darwin") {
  const computerAddon = path.resolve(
    "vendor",
    "computer-control",
    "darwin-universal",
    "oscode-computer-control.node",
  );
  await access(computerAddon);
  const addon = requireNativeModule(computerAddon);
  if (
    typeof addon.list !== "function" ||
    typeof addon.isTrusted !== "function" ||
    typeof addon.isScreenCaptureTrusted !== "function" ||
    typeof addon.requestScreenCaptureAccess !== "function" ||
    typeof addon.inspect !== "function" ||
    typeof addon.invoke !== "function" ||
    typeof addon.setValue !== "function"
  )
    throw new Error("Computer Control addon did not expose its local API");
  const output = addon.list();
  if (!Array.isArray(JSON.parse(output)))
    throw new Error(
      "Computer Control addon did not return an application list",
    );
}

if (["win32", "darwin"].includes(process.platform)) {
  console.log(
    `Computer Control is available for ${process.platform}-${process.arch}`,
  );
}

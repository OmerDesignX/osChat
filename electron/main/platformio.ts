import fs from "node:fs/promises";
import path from "node:path";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { SecureDataStore } from "./secure-store.js";

const exec = promisify(execFile);

export type PlatformioState = {
  installed: boolean;
  version: string;
  project: boolean;
  environments: string[];
  autoUpdate: boolean;
  running: boolean;
  devices: PlatformioDevice[];
  telemetry: false;
};
export type PlatformioDevice = {
  port: string;
  description: string;
  hwid: string;
};
export type PlatformioBoard = {
  id: string;
  name: string;
  platform: string;
  frameworks: string[];
};

type PlatformioConfig = { autoUpdate: boolean; lastUpdateCheck: number };
type PlatformioAction = "build" | "upload" | "clean" | "test" | "monitor";

const compactSearch = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function damerauDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array(right.length + 1).fill(0),
  );
  for (let index = 0; index <= left.length; index += 1) rows[index][0] = index;
  for (let index = 0; index <= right.length; index += 1) rows[0][index] = index;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      )
        rows[row][column] = Math.min(
          rows[row][column],
          rows[row - 2][column - 2] + cost,
        );
    }
  }
  return rows[left.length][right.length];
}

function fuzzyContains(value: string, query: string) {
  if (value.includes(query)) return true;
  if (query.length < 4 || value.length < query.length) return false;
  for (let index = 0; index <= value.length - query.length; index += 1) {
    if (damerauDistance(value.slice(index, index + query.length), query) <= 1)
      return true;
  }
  return false;
}

export function rankPlatformioBoards(
  boards: PlatformioBoard[],
  rawQuery: string,
) {
  const query = compactSearch(rawQuery);
  if (!query) return boards.slice();
  const popular = new Map([
    ["esp32doit-devkit-v1", 0],
    ["esp32dev", 1],
    ["esp32cam", 2],
  ]);
  return boards
    .map((board) => {
      const id = compactSearch(board.id);
      const name = compactSearch(board.name);
      const platform = compactSearch(board.platform);
      const exact = [id, name, platform].findIndex((value) =>
        value.includes(query),
      );
      const fuzzy = [id, name, platform].some((value) =>
        fuzzyContains(value, query),
      );
      if (exact < 0 && !fuzzy) return null;
      return {
        board,
        score:
          (exact >= 0 ? exact : 4) * 100 +
          (id.startsWith(query) ? -25 : 0) +
          (popular.get(board.id) ?? 20),
      };
    })
    .filter(
      (entry): entry is { board: PlatformioBoard; score: number } =>
        entry !== null,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.board.name.localeCompare(right.board.name),
    )
    .map((entry) => entry.board);
}

export function preferredPlatformioSerialDevice(devices: PlatformioDevice[]) {
  return devices
    .map((device, index) => {
      const text = `${device.port} ${device.description} ${device.hwid}`;
      const physicalUsb =
        /(?:usb|cp210|uart|ftdi|ch340|wch|vid:pid|ttyacm|ttyusb|com\d+)/i.test(
          text,
        );
      const pseudo = /(?:bluetooth|debug-console|wlan-debug|\bn\/a\b)/i.test(
        text,
      );
      return {
        device,
        score: (physicalUsb ? -100 : 0) + (pseudo ? 100 : 0) + index,
      };
    })
    .sort((left, right) => left.score - right.score)[0]?.device;
}

export function platformioProgressFromOutput(data: string, previous = 0) {
  const text = data.replace(/\x1b\[[0-9;]*m/g, " ");
  const percentages = [...text.matchAll(/\b(\d{1,3})(?:\.\d+)?\s*%/g)].map(
    (match) => Math.max(0, Math.min(100, Number(match[1]))),
  );
  const explicit = percentages.at(-1);
  const stage = /PlatformIO is ready|\bSUCCESS\b/i.test(text)
    ? 100
    : /Uploading|Writing at 0x|Connecting\.\.\./i.test(text)
      ? 82
      : /Linking|Building \.pio|Creating firmware|Checking size/i.test(text)
        ? 72
        : /Compiling|Archiving/i.test(text)
          ? 38
          : /Downloading|Installing|Collecting|Package Manager|Tool Manager/i.test(
                text,
              )
            ? 18
            : /Processing|Resolving|Creating PlatformIO/i.test(text)
              ? 7
              : previous;
  return Math.max(previous, explicit ?? stage);
}

const validEnvironment = (value: string) =>
  !value || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const validBoard = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(value);
const validFramework = (value: string) =>
  !value || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(value);

export class PlatformioService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private progress = 0;
  private readonly secure: SecureDataStore;

  constructor(
    private readonly dataRoot: string,
    private readonly getPython: () => Promise<string>,
    private readonly output: (data: string) => void,
    secureStore?: SecureDataStore,
    private readonly activity?: (activity: {
      kind: "platformio";
      label: string;
      active: boolean;
      network: boolean;
      progress?: number;
      cancellable: boolean;
    }) => void,
  ) {
    this.secure = secureStore || new SecureDataStore(dataRoot);
  }

  private reportProgress(data: string, active = true) {
    this.progress = platformioProgressFromOutput(data, this.progress);
    const network = /download|install|collect|package|fetch|update/i.test(data);
    this.activity?.({
      kind: "platformio",
      label: network
        ? "PlatformIO is receiving packages"
        : "PlatformIO is working locally",
      active,
      network,
      progress: this.progress,
      cancellable: active,
    });
  }

  private get penvRoot() {
    return path.join(this.dataRoot, "penv");
  }

  private get pioExecutable() {
    return process.platform === "win32"
      ? path.join(this.penvRoot, "Scripts", "pio.exe")
      : path.join(this.penvRoot, "bin", "pio");
  }

  private get penvPython() {
    return process.platform === "win32"
      ? path.join(this.penvRoot, "Scripts", "python.exe")
      : path.join(this.penvRoot, "bin", "python");
  }

  private get configPath() {
    return path.join(this.secure.root, "state", "platformio.oscode-data");
  }

  private get legacyConfigPath() {
    return path.join(this.dataRoot, "oscode.json");
  }

  private get boardsPath() {
    return path.join(this.dataRoot, "boards.json");
  }

  private environment() {
    return {
      ...process.env,
      PLATFORMIO_CORE_DIR: path.join(this.dataRoot, "core"),
      PLATFORMIO_SETTING_ENABLE_TELEMETRY: "false",
      PLATFORMIO_DISABLE_UPGRADE_CHECK: "true",
      PLATFORMIO_NO_ANSI: "true",
      PLATFORMIO_DISABLE_PROGRESSBAR: "true",
      CI: "true",
    };
  }

  private async config(): Promise<PlatformioConfig> {
    const value = await this.secure.readJson<Partial<PlatformioConfig>>(
      this.configPath,
      {},
      "platformio-preferences",
      this.legacyConfigPath,
    );
    return {
      autoUpdate: value.autoUpdate === true,
      lastUpdateCheck: Number.isFinite(value.lastUpdateCheck)
        ? Number(value.lastUpdateCheck)
        : 0,
    };
  }

  private async saveConfig(config: PlatformioConfig) {
    await this.secure.writeJson(
      this.configPath,
      config,
      "platformio-preferences",
    );
  }

  private async exists(file: string) {
    try {
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  }

  private async environments(projectRoot: string) {
    if (!projectRoot) return [];
    try {
      const ini = await fs.readFile(
        path.join(projectRoot, "platformio.ini"),
        "utf8",
      );
      return [...ini.matchAll(/^\s*\[env:([^\]\r\n]+)\]\s*$/gim)]
        .map((match) => match[1].trim())
        .filter(
          (name, index, names) =>
            validEnvironment(name) && names.indexOf(name) === index,
        );
    } catch {
      return [];
    }
  }

  async state(projectRoot: string): Promise<PlatformioState> {
    const installed = await this.exists(this.pioExecutable);
    const config = await this.config();
    let version = "";
    if (installed) {
      try {
        const result = await exec(this.pioExecutable, ["--version"], {
          env: this.environment(),
          windowsHide: true,
          timeout: 15_000,
        });
        version = result.stdout
          .trim()
          .replace(/^PlatformIO Core, version\s+/i, "");
      } catch {
        version = "Installed";
      }
    }
    return {
      installed,
      version,
      project: Boolean(
        projectRoot &&
        (await this.exists(path.join(projectRoot, "platformio.ini"))),
      ),
      environments: await this.environments(projectRoot),
      autoUpdate: config.autoUpdate,
      running: Boolean(this.child),
      devices: installed && !this.child ? await this.devices() : [],
      telemetry: false,
    };
  }

  async install(update = false) {
    if (this.child) throw new Error("A PlatformIO task is already running");
    await fs.mkdir(this.dataRoot, { recursive: true });
    const basePython = await this.getPython();
    this.progress = 0;
    this.reportProgress("Creating PlatformIO environment");
    const penvPython =
      process.platform === "win32"
        ? path.join(this.penvRoot, "Scripts", "python.exe")
        : path.join(this.penvRoot, "bin", "python");
    if (!(await this.exists(penvPython))) {
      this.output("Creating PlatformIO's private environment…\n");
      await exec(basePython, ["-m", "venv", this.penvRoot], {
        env: this.environment(),
        windowsHide: true,
        timeout: 120_000,
      });
    }
    this.output(`${update ? "Updating" : "Installing"} PlatformIO Core…\n`);
    this.reportProgress(
      `${update ? "Updating" : "Installing"} PlatformIO Core`,
    );
    const args = [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
    ];
    if (update) args.push("--upgrade");
    args.push("platformio");
    await this.stream(penvPython, args, this.dataRoot);
    await exec(
      this.pioExecutable,
      ["settings", "set", "enable_telemetry", "No"],
      {
        env: this.environment(),
        windowsHide: true,
        timeout: 30_000,
      },
    );
    const config = await this.config();
    await this.saveConfig({ ...config, lastUpdateCheck: Date.now() });
    await this.refreshBoards().catch((error) =>
      this.output(`Board catalogue will refresh later: ${String(error)}\n`),
    );
    this.output("PlatformIO is ready. Telemetry is disabled.\n");
    this.reportProgress("PlatformIO is ready", false);
    return true;
  }

  async boards(query = ""): Promise<PlatformioBoard[]> {
    if (await this.exists(this.pioExecutable)) {
      const cached = await this.readBoards();
      const boards = cached.length ? cached : await this.refreshBoards();
      return rankPlatformioBoards(boards, query);
    }
    return [];
  }

  async devices(): Promise<PlatformioDevice[]> {
    if (!(await this.exists(this.pioExecutable))) return [];
    try {
      const result = await exec(
        this.pioExecutable,
        ["device", "list", "--json-output"],
        {
          env: this.environment(),
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      const raw = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
      return raw
        .map((item) => ({
          port: typeof item.port === "string" ? item.port : "",
          description:
            typeof item.description === "string" ? item.description : "",
          hwid: typeof item.hwid === "string" ? item.hwid : "",
        }))
        .filter((item) => item.port)
        .slice(0, 32);
    } catch {
      return [];
    }
  }

  private async readBoards(): Promise<PlatformioBoard[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.boardsPath, "utf8"));
      return Array.isArray(value)
        ? value.filter(
            (item): item is PlatformioBoard =>
              item &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              typeof item.platform === "string" &&
              Array.isArray(item.frameworks),
          )
        : [];
    } catch {
      return [];
    }
  }

  private async refreshBoards(): Promise<PlatformioBoard[]> {
    const result = await exec(this.pioExecutable, ["boards", "--json-output"], {
      env: this.environment(),
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const raw = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    const boards = raw
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        platform: typeof item.platform === "string" ? item.platform : "",
        frameworks: Array.isArray(item.frameworks)
          ? item.frameworks.filter(
              (framework): framework is string => typeof framework === "string",
            )
          : [],
      }))
      .filter((item) => item.id && item.name)
      .sort((left, right) => left.name.localeCompare(right.name));
    await fs.mkdir(this.dataRoot, { recursive: true });
    await fs.writeFile(this.boardsPath, `${JSON.stringify(boards)}\n`, "utf8");
    return boards;
  }

  async setAutoUpdate(enabled: boolean) {
    const config = await this.config();
    await this.saveConfig({ ...config, autoUpdate: enabled === true });
    return enabled === true;
  }

  async maybeAutoUpdate() {
    const config = await this.config();
    if (!config.autoUpdate || !(await this.exists(this.pioExecutable)))
      return false;
    if (Date.now() - config.lastUpdateCheck < 86_400_000) return false;
    await this.install(true);
    return true;
  }

  async initialize(projectRoot: string, board: string, framework: string) {
    if (!projectRoot) throw new Error("Open a project first");
    if (!validBoard(board))
      throw new Error("Enter a valid PlatformIO board ID");
    if (!validFramework(framework))
      throw new Error("Enter a valid framework name");
    const catalogue = await this.boards(board);
    const selected = catalogue.find((item) => item.id === board);
    if (!selected) throw new Error("Choose a board from the PlatformIO list");
    if (framework && !selected.frameworks.includes(framework))
      throw new Error(`${selected.name} does not support ${framework}`);
    const iniPath = path.join(projectRoot, "platformio.ini");
    if (await this.exists(iniPath))
      throw new Error("This folder already has a PlatformIO project");
    await Promise.all(
      ["include", "lib", "src", "test"].map((name) =>
        fs.mkdir(path.join(projectRoot, name), { recursive: true }),
      ),
    );
    const environmentName = board.replace(/[^A-Za-z0-9_.-]/g, "-");
    await fs.writeFile(
      iniPath,
      [
        `; ${selected.name}`,
        `[env:${environmentName}]`,
        `platform = ${selected.platform}`,
        `board = ${selected.id}`,
        ...(framework ? [`framework = ${framework}`] : []),
        "monitor_speed = 115200",
        "",
      ].join("\n"),
      { encoding: "utf8", flag: "wx" },
    );
    const source =
      framework === "espidf"
        ? '#include <stdio.h>\n\nvoid app_main(void) {\n  printf("osChat PlatformIO project ready\\n");\n}\n'
        : "#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n  delay(1000);\n}\n";
    const sourceName = framework === "espidf" ? "main.c" : "main.cpp";
    await fs
      .writeFile(path.join(projectRoot, "src", sourceName), source, {
        encoding: "utf8",
        flag: "wx",
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    this.output(
      `Created PlatformIO project for ${selected.name} (${selected.id}).\n`,
    );
    return this.state(projectRoot);
  }

  async monitorSnapshot(
    projectRoot: string,
    environment: string,
    durationMs = 5_000,
  ) {
    if (!projectRoot) throw new Error("Open a project first");
    if (!(await this.exists(path.join(projectRoot, "platformio.ini"))))
      throw new Error("This folder is not a PlatformIO project");
    if (!validEnvironment(environment))
      throw new Error("Invalid PlatformIO environment");
    const duration = Math.max(1_000, Math.min(15_000, durationMs));
    const ini = await fs.readFile(
      path.join(projectRoot, "platformio.ini"),
      "utf8",
    );
    const escapedEnvironment = environment.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const section = environment
      ? ini.match(
          new RegExp(
            `^\\s*\\[env:${escapedEnvironment}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|$)`,
            "im",
          ),
        )?.[1] || ""
      : ini;
    const setting = (name: string) =>
      section
        .match(new RegExp(`^\\s*${name}\\s*=\\s*([^;#\\r\\n]+)`, "im"))?.[1]
        .trim() ||
      ini
        .match(new RegExp(`^\\s*${name}\\s*=\\s*([^;#\\r\\n]+)`, "im"))?.[1]
        .trim() ||
      "";
    const connected = await this.devices();
    const port =
      setting("monitor_port") ||
      setting("upload_port") ||
      preferredPlatformioSerialDevice(connected)?.port;
    if (!port) throw new Error("No connected serial device was found");
    const configuredBaud = Number(setting("monitor_speed"));
    const boardHint = `${environment} ${setting("board")} ${setting("platform")}`;
    const baud =
      Number.isInteger(configuredBaud) && configuredBaud > 0
        ? configuredBaud
        : /esp32/i.test(boardHint)
          ? 115200
          : 9600;
    const reader = `import serial,sys,time
port=sys.argv[1]
baud=int(sys.argv[2])
duration=float(sys.argv[3])
with serial.Serial(port,baud,timeout=0.2) as device:
 end=time.monotonic()+duration
 while time.monotonic()<end:
  data=device.read(max(1,device.in_waiting))
  if data:
   sys.stdout.buffer.write(data)
   sys.stdout.buffer.flush()`;
    const output = await this.stream(
      this.penvPython,
      ["-c", reader, port, String(baud), String(duration / 1000)],
      projectRoot,
    );
    return { durationMs: duration, output, devices: await this.devices() };
  }

  async run(
    action: PlatformioAction,
    environment: string,
    projectRoot: string,
  ) {
    if (!projectRoot) throw new Error("Open a project first");
    if (!(await this.exists(path.join(projectRoot, "platformio.ini"))))
      throw new Error("This folder is not a PlatformIO project");
    if (!validEnvironment(environment))
      throw new Error("Invalid PlatformIO environment");
    const args =
      action === "test"
        ? ["test"]
        : action === "monitor"
          ? ["device", "monitor"]
          : ["run"];
    if (environment) args.push("--environment", environment);
    if (action === "upload") args.push("--target", "upload");
    if (action === "clean") args.push("--target", "clean");
    const output = await this.runPio(args, projectRoot);
    return {
      ...(await this.state(projectRoot)),
      action,
      output,
    };
  }

  stop() {
    if (!this.child) return false;
    const child = this.child;
    if (process.platform === "win32" && child.pid)
      spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      }).once("error", () => child.kill());
    else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else child.kill();
    this.child = null;
    this.output("\nPlatformIO task stopped.\n");
    this.activity?.({
      kind: "platformio",
      label: "PlatformIO task stopped",
      active: false,
      network: false,
      progress: this.progress,
      cancellable: false,
    });
    return true;
  }

  write(data: string) {
    if (!data || data.length > 10_000)
      throw new Error("Invalid PlatformIO input");
    if (!this.child?.stdin.writable)
      throw new Error("No PlatformIO task is accepting input");
    this.child.stdin.write(data);
    return true;
  }

  async dispose() {
    this.stop();
  }

  private async runPio(args: string[], cwd: string) {
    if (!(await this.exists(this.pioExecutable)))
      throw new Error("Install PlatformIO Core first");
    this.output(`\n> pio ${args.join(" ")}\n`);
    this.progress = 0;
    this.reportProgress(`Processing PlatformIO ${args.join(" ")}`);
    return this.stream(this.pioExecutable, args, cwd);
  }

  private stream(command: string, args: string[], cwd: string) {
    if (this.child) throw new Error("A PlatformIO task is already running");
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: this.environment(),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: "pipe",
      });
      this.child = child;
      let captured = "";
      const append = (data: unknown) => {
        const text = String(data);
        captured = `${captured}${text}`.slice(-120_000);
        this.output(text);
        this.reportProgress(text);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.once("error", (error) => {
        if (this.child === child) this.child = null;
        const diagnostic = captured.trim();
        reject(
          new Error(
            diagnostic ? `${error.message}\n${diagnostic}` : error.message,
          ),
        );
      });
      child.once("exit", (code, signal) => {
        if (this.child === child) this.child = null;
        const diagnostic = captured.trim();
        if (code === 0 || signal) {
          if (code === 0) {
            this.progress = 100;
            this.reportProgress("SUCCESS", false);
          }
          resolve(diagnostic);
        } else
          reject(
            new Error(
              [`PlatformIO exited with code ${code ?? "unknown"}.`, diagnostic]
                .filter(Boolean)
                .join("\n"),
            ),
          );
      });
    });
  }

  private captureForDuration(
    command: string,
    args: string[],
    cwd: string,
    durationMs: number,
  ) {
    if (this.child) throw new Error("A PlatformIO task is already running");
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: this.environment(),
        windowsHide: true,
        stdio: "pipe",
      });
      this.child = child;
      let captured = "";
      let timedOut = false;
      const append = (data: unknown) => {
        const text = String(data);
        captured = `${captured}${text}`.slice(-120_000);
        this.output(text);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGINT");
        setTimeout(() => child.kill(), 1_000).unref();
      }, durationMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        if (timedOut || code === 0 || signal) resolve(captured.trim());
        else
          reject(
            new Error(
              [
                `PlatformIO exited with code ${code ?? "unknown"}.`,
                captured.trim(),
              ]
                .filter(Boolean)
                .join("\n"),
            ),
          );
      });
    });
  }
}

export const platformioValidation = {
  validEnvironment,
  validBoard,
  validFramework,
};

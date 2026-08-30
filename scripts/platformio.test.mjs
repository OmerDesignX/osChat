import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PlatformioService,
  platformioProgressFromOutput,
  platformioValidation,
  preferredPlatformioSerialDevice,
  rankPlatformioBoards,
} from "../dist-electron/main/platformio.js";

test("PlatformIO progress follows real output and never moves backwards", () => {
  assert.equal(platformioProgressFromOutput("Processing esp32dev", 0), 7);
  assert.equal(platformioProgressFromOutput("Downloading toolchain", 7), 18);
  assert.equal(
    platformioProgressFromOutput("Compiling .pio/src/main.o", 18),
    38,
  );
  assert.equal(
    platformioProgressFromOutput("Writing at 0x00001000... (64.2 %)", 38),
    64,
  );
  assert.equal(platformioProgressFromOutput("earlier stage", 64), 64);
  assert.equal(platformioProgressFromOutput("SUCCESS", 64), 100);
});

test("PlatformIO board search tolerates the common eps32 transposition", () => {
  const boards = [
    {
      id: "uno",
      name: "Arduino Uno",
      platform: "atmelavr",
      frameworks: ["arduino"],
    },
    {
      id: "esp32dev",
      name: "Espressif ESP32 Dev Module",
      platform: "espressif32",
      frameworks: ["arduino", "espidf"],
    },
    {
      id: "esp32doit-devkit-v1",
      name: "DOIT ESP32 DEVKIT V1",
      platform: "espressif32",
      frameworks: ["arduino", "espidf"],
    },
  ];
  assert.deepEqual(
    rankPlatformioBoards(boards, "eps32").map((board) => board.id),
    ["esp32doit-devkit-v1", "esp32dev"],
  );
});

test("PlatformIO serial snapshots prefer a physical USB board over pseudo ports", () => {
  const selected = preferredPlatformioSerialDevice([
    { port: "/dev/cu.wlan-debug", description: "n/a", hwid: "n/a" },
    { port: "/dev/cu.debug-console", description: "n/a", hwid: "n/a" },
    {
      port: "/dev/cu.usbserial-0001",
      description: "CP2102 USB to UART Bridge Controller",
      hwid: "USB VID:PID=10C4:EA60",
    },
  ]);
  assert.equal(selected?.port, "/dev/cu.usbserial-0001");
});

test("PlatformIO project creation is local, immediate, and deterministic", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-pio-init-"));
  const data = path.join(root, "data");
  const project = path.join(root, "project");
  const executable =
    process.platform === "win32"
      ? path.join(data, "penv", "Scripts", "pio.exe")
      : path.join(data, "penv", "bin", "pio");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(executable, "test placeholder");
  await fs.writeFile(
    path.join(data, "boards.json"),
    `${JSON.stringify([
      {
        id: "esp32doit-devkit-v1",
        name: "DOIT ESP32 DEVKIT V1",
        platform: "espressif32",
        frameworks: ["arduino", "espidf"],
      },
    ])}\n`,
  );
  try {
    const service = new PlatformioService(
      data,
      async () => "unused",
      () => {},
    );
    const state = await service.initialize(
      project,
      "esp32doit-devkit-v1",
      "arduino",
    );
    assert.equal(state.project, true);
    assert.deepEqual(state.environments, ["esp32doit-devkit-v1"]);
    assert.match(
      await fs.readFile(path.join(project, "platformio.ini"), "utf8"),
      /board = esp32doit-devkit-v1/,
    );
    assert.match(
      await fs.readFile(path.join(project, "src", "main.cpp"), "utf8"),
      /Serial\.begin\(115200\)/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("PlatformIO state detects projects without enabling telemetry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-platformio-"));
  const data = path.join(root, "data");
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "platformio.ini"),
    "[platformio]\ndefault_envs = uno\n\n[env:uno]\nplatform = atmelavr\n\n[env:esp32-dev]\nplatform = espressif32\n",
  );
  try {
    const service = new PlatformioService(
      data,
      async () => "unused",
      () => {},
    );
    const state = await service.state(project);
    assert.equal(state.telemetry, false);
    assert.equal(state.installed, false);
    assert.equal(state.project, true);
    assert.deepEqual(state.environments, ["uno", "esp32-dev"]);
    assert.equal(state.autoUpdate, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("PlatformIO command fields reject shell syntax", () => {
  assert.equal(platformioValidation.validEnvironment("esp32-dev"), true);
  assert.equal(platformioValidation.validEnvironment("esp32; rm -rf"), false);
  assert.equal(platformioValidation.validBoard("uno"), true);
  assert.equal(platformioValidation.validBoard("uno && echo bad"), false);
  assert.equal(platformioValidation.validFramework("arduino"), true);
  assert.equal(platformioValidation.validFramework("$(whoami)"), false);
});

test(
  "PlatformIO failures return captured compiler diagnostics to the agent",
  { skip: process.platform === "win32" },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-pio-error-"));
    const data = path.join(root, "data");
    const project = path.join(root, "project");
    const executable = path.join(data, "penv", "bin", "pio");
    const streamed = [];
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.mkdir(project);
    await fs.writeFile(
      executable,
      "#!/usr/bin/env node\nprocess.stderr.write('src/main.cpp:42: error: bad firmware\\n'); process.exit(7);\n",
    );
    await fs.chmod(executable, 0o755);
    await fs.writeFile(
      path.join(project, "platformio.ini"),
      "[env:doit-esp32]\nplatform = espressif32\nboard = esp32doit-devkit-v1\nframework = arduino\n",
    );
    try {
      const service = new PlatformioService(
        data,
        async () => "unused",
        (value) => streamed.push(value),
      );
      await assert.rejects(
        service.run("build", "doit-esp32", project),
        /PlatformIO exited with code 7[\s\S]*src\/main\.cpp:42: error: bad firmware/,
      );
      assert.match(streamed.join(""), /src\/main\.cpp:42: error: bad firmware/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "bounded serial snapshots use pyserial without requiring an interactive TTY",
  { skip: process.platform === "win32" },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "oscode-pio-monitor-"),
    );
    const data = path.join(root, "data");
    const project = path.join(root, "project");
    const bin = path.join(data, "penv", "bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(project);
    await fs.writeFile(
      path.join(bin, "pio"),
      '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify([{port:"/dev/test-board",description:"Test board",hwid:"TEST"}]));\n',
    );
    await fs.writeFile(
      path.join(bin, "python"),
      "#!/usr/bin/env node\nprocess.stdout.write(`serial ${process.argv.at(-3)} ${process.argv.at(-2)} ${process.argv.at(-1)}`);\n",
    );
    await Promise.all([
      fs.chmod(path.join(bin, "pio"), 0o755),
      fs.chmod(path.join(bin, "python"), 0o755),
    ]);
    await fs.writeFile(
      path.join(project, "platformio.ini"),
      "[env:doit-esp32]\nplatform = espressif32\nboard = esp32doit-devkit-v1\nframework = arduino\n",
    );
    try {
      const service = new PlatformioService(
        data,
        async () => "unused",
        () => {},
      );
      const snapshot = await service.monitorSnapshot(
        project,
        "doit-esp32",
        1200,
      );
      assert.equal(snapshot.durationMs, 1200);
      assert.match(snapshot.output, /serial \/dev\/test-board 115200 1\.2/);
      assert.equal(snapshot.devices[0].port, "/dev/test-board");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

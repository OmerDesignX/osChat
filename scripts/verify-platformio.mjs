import path from "node:path";
import { PlatformioService } from "../dist-electron/main/platformio.js";

const dataRoot = process.env.OSCODE_PLATFORMIO_VERIFY_DIR;
const python = process.env.OSCODE_PLATFORMIO_VERIFY_PYTHON;
if (!dataRoot || !path.isAbsolute(dataRoot))
  throw new Error(
    "Set OSCODE_PLATFORMIO_VERIFY_DIR to an absolute temporary directory",
  );
if (!python || !path.isAbsolute(python))
  throw new Error(
    "Set OSCODE_PLATFORMIO_VERIFY_PYTHON to an absolute Python path",
  );

const service = new PlatformioService(
  dataRoot,
  async () => python,
  (data) => process.stdout.write(data),
);
await service.install(false);
const state = await service.state("");
if (!state.installed || !state.version || state.telemetry !== false)
  throw new Error(`PlatformIO verification failed: ${JSON.stringify(state)}`);
console.log(
  `PlatformIO verification passed: Core ${state.version}, telemetry disabled`,
);
await service.dispose();

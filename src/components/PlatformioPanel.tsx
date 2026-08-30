import { useEffect, useState } from "react";
import { FeatherIcon } from "./FeatherIcon";
import type { AgentActivity } from "../types";
import type {
  PlatformioAction,
  PlatformioBoard,
  PlatformioState,
} from "../types";

const emptyState: PlatformioState = {
  installed: false,
  version: "",
  project: false,
  environments: [],
  autoUpdate: false,
  running: false,
  devices: [],
  telemetry: false,
};

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
        "",
      )
    : "PlatformIO could not complete the request";

export function PlatformioPanel({
  projectRoot,
  onClose,
  onProjectChanged,
  onNotice,
  onActivity,
}: {
  projectRoot: string;
  onClose: () => void;
  onProjectChanged: () => Promise<void>;
  onNotice: (text: string) => void;
  onActivity: (activity: AgentActivity | null) => void;
}) {
  const [state, setState] = useState(emptyState);
  const [environment, setEnvironment] = useState("");
  const [board, setBoard] = useState("");
  const [framework, setFramework] = useState("arduino");
  const [output, setOutput] = useState("");
  const [monitorInput, setMonitorInput] = useState("");
  const [busy, setBusy] = useState("");
  const [boards, setBoards] = useState<PlatformioBoard[]>([]);
  const boardMatches = boards.slice(0, 60);

  const refresh = async () => {
    try {
      const next = await window.oscode.platformioState();
      setState(next);
      if (next.installed) setBoards(await window.oscode.platformioBoards());
      setEnvironment((current) =>
        next.environments.includes(current)
          ? current
          : next.environments[0] || "",
      );
    } catch (error) {
      onNotice(message(error));
    }
  };

  useEffect(() => {
    void refresh();
    const removeOutput = window.oscode.onPlatformioOutput((data) =>
      setOutput((current) => `${current}${data}`.slice(-120_000)),
    );
    const removeState = window.oscode.onPlatformioState(setState);
    return () => {
      removeOutput();
      removeState();
    };
  }, [projectRoot]);

  useEffect(() => {
    if (!state.installed || state.project) return;
    const timer = setTimeout(() => {
      void window.oscode
        .platformioBoards(board.trim())
        .then(setBoards)
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(timer);
  }, [board, state.installed, state.project]);

  const perform = async (
    label: string,
    action: () => Promise<PlatformioState>,
  ) => {
    setBusy(label);
    onActivity({
      kind: "platformio",
      label: `${label} · PlatformIO`,
      active: true,
      network: label === "Install" || label === "Update",
      cancellable: true,
    });
    try {
      const next = await action();
      setState(next);
      if (label === "Create project") await onProjectChanged();
      if ((label === "Install" || label === "Update") && next.installed)
        setBoards(await window.oscode.platformioBoards());
      setBusy("");
      onActivity(null);
      onNotice(`${label} completed`);
    } catch (error) {
      setBusy("");
      onActivity(null);
      onNotice(message(error));
    }
  };

  const run = (action: PlatformioAction, label: string) =>
    perform(label, () => window.oscode.runPlatformio(action, environment));

  return (
    <div className="platformio-dock" aria-label="PlatformIO">
      <div className="platformio-title">
        <div>
          <span className="platformio-mark">PIO</span>
          <div>
            <h2>PlatformIO</h2>
            <p>Embedded development</p>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Close PlatformIO"
          onClick={onClose}
        >
          <FeatherIcon icon="x" size="17" />
        </button>
      </div>

      {!state.installed ? (
        <section className="platformio-card platformio-install">
          <FeatherIcon icon="cpu" size="24" />
          <h3>Install PlatformIO Core</h3>
          <p>
            osCode installs PlatformIO in a private environment. It does not
            modify your project Python or the AI runtime.
          </p>
          <button
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => perform("Install", window.oscode.installPlatformio)}
          >
            <FeatherIcon icon="download" size="15" />
            {busy === "Install" ? "Installing…" : "Install Core"}
          </button>
        </section>
      ) : (
        <>
          <section className="platformio-card platformio-version">
            <div>
              <span>PlatformIO Core</span>
              <b>{state.version || "Installed"}</b>
            </div>
            <button
              className="quiet"
              disabled={Boolean(busy)}
              onClick={() => perform("Update", window.oscode.updatePlatformio)}
            >
              <FeatherIcon icon="refresh-cw" size="14" /> Update
            </button>
          </section>

          <label className="platformio-auto-update">
            <span>
              <b>Automatic updates</b>
              <small>Checks once daily when PlatformIO is opened</small>
            </span>
            <input
              type="checkbox"
              checked={state.autoUpdate}
              onChange={(event) =>
                void perform("Update preference", () =>
                  window.oscode.setPlatformioAutoUpdate(event.target.checked),
                )
              }
            />
          </label>

          {!projectRoot ? (
            <section className="platformio-card platformio-empty">
              <FeatherIcon icon="folder" size="22" />
              <h3>Open a project first</h3>
              <p>PlatformIO works with the folder currently open in osChat.</p>
            </section>
          ) : !state.project ? (
            <section className="platformio-card platformio-create">
              <h3>Create a PlatformIO project</h3>
              <label>
                Board ID
                <input
                  value={board}
                  onChange={(event) => setBoard(event.target.value)}
                  placeholder="uno or esp32dev"
                  autoComplete="off"
                />
                {boardMatches.length > 0 && (
                  <div
                    className="platformio-board-list"
                    aria-label="PlatformIO boards"
                  >
                    {boardMatches.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          setBoard(item.id);
                          if (item.frameworks.length === 1)
                            setFramework(item.frameworks[0]);
                        }}
                      >
                        <b>{item.id}</b>
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {board.trim() && boardMatches.length === 0 && (
                  <small className="platformio-board-empty">
                    No matching board. Try a model, vendor, or board ID.
                  </small>
                )}
              </label>
              <label>
                Framework
                <select
                  value={framework}
                  onChange={(event) => setFramework(event.target.value)}
                >
                  <option value="arduino">Arduino</option>
                  <option value="espidf">ESP-IDF</option>
                  <option value="zephyr">Zephyr</option>
                  <option value="mbed">Mbed</option>
                  <option value="">Board default</option>
                </select>
              </label>
              <button
                className="primary"
                disabled={Boolean(busy) || board.trim().length < 2}
                onClick={() =>
                  perform("Create project", () =>
                    window.oscode.initializePlatformio(board, framework),
                  )
                }
              >
                <FeatherIcon icon="plus" size="15" /> Create project
              </button>
            </section>
          ) : (
            <section className="platformio-card platformio-project">
              <div className="platformio-project-head">
                <div>
                  <span>PROJECT</span>
                  <h3>platformio.ini</h3>
                </div>
                <button
                  className="icon-button"
                  aria-label="Refresh PlatformIO"
                  onClick={refresh}
                >
                  <FeatherIcon icon="refresh-cw" size="16" />
                </button>
              </div>
              {state.devices.length > 0 && (
                <div
                  className="platformio-devices"
                  aria-label="Connected devices"
                >
                  <span>CONNECTED</span>
                  {state.devices.map((device) => (
                    <div key={device.port}>
                      <b>{device.port}</b>
                      <small>
                        {device.description || device.hwid || "Serial device"}
                      </small>
                    </div>
                  ))}
                </div>
              )}
              <label>
                Environment
                <select
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                >
                  {state.environments.length ? (
                    state.environments.map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))
                  ) : (
                    <option value="">Project default</option>
                  )}
                </select>
              </label>
              <div
                className="platformio-actions horizontal-menu-scroll"
                data-horizontal-menu
              >
                <button
                  disabled={Boolean(busy)}
                  onClick={() => run("build", "Build")}
                >
                  <FeatherIcon icon="package" size="16" /> Build
                </button>
                <button
                  className="accent"
                  disabled={Boolean(busy)}
                  onClick={() => run("upload", "Upload")}
                >
                  <FeatherIcon icon="upload" size="16" /> Upload
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => run("clean", "Clean")}
                >
                  <FeatherIcon icon="trash-2" size="16" /> Clean
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => run("test", "Test")}
                >
                  <FeatherIcon icon="check-circle" size="16" /> Test
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => run("monitor", "Serial monitor")}
                >
                  <FeatherIcon icon="radio" size="16" /> Monitor
                </button>
                <button
                  className="danger"
                  disabled={!busy}
                  onClick={() => {
                    window.oscode.stopPlatformio();
                    setBusy("");
                  }}
                >
                  <FeatherIcon icon="square" size="16" /> Stop
                </button>
              </div>
            </section>
          )}
        </>
      )}

      <section className="platformio-output">
        <div>
          <b>{busy || "Output"}</b>
          <button onClick={() => setOutput("")}>Clear</button>
        </div>
        <pre>{output || "PlatformIO output will appear here."}</pre>
        {busy === "Serial monitor" && (
          <form
            className="platformio-monitor-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (!monitorInput) return;
              void window.oscode.writePlatformio(`${monitorInput}\n`);
              setMonitorInput("");
            }}
          >
            <input
              aria-label="Serial monitor input"
              value={monitorInput}
              onChange={(event) => setMonitorInput(event.target.value)}
              placeholder="Send to device"
            />
            <button type="submit" disabled={!monitorInput}>
              Send
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

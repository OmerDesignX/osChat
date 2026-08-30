import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/fira-code/400.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./advanced.css";
import "./startup.css";
import osChatIcon from "./assets/oschat-icon.png";

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (
  !window.oscode &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("browser-qa") === "1"
) {
  const { createBrowserQaBridge } = await import("./browser-qa");
  window.oscode = createBrowserQaBridge();
}

function renderStartupError(message: string) {
  root.render(
    <div className="bridge-error">
      <img className="mark" src={osChatIcon} alt="osChat" />
      <h1>osChat couldn't start</h1>
      <p>{message}</p>
    </div>,
  );
}

if (!window.oscode) {
  renderStartupError(
    "The secure desktop bridge did not load. Restart osChat or reinstall the latest build.",
  );
} else {
  void import("./App")
    .then(({ App }) => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    })
    .catch(() =>
      renderStartupError(
        "The osChat workspace could not load. Restart osChat or reinstall the latest build.",
      ),
    );
}

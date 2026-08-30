import { useEffect, useState } from "react";
import type { ProjectMediaFile } from "../types";
import { FeatherIcon } from "./FeatherIcon";

type MediaPreviewProps = {
  file: ProjectMediaFile;
  name: string;
};

function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function MediaPreview({ file, name }: MediaPreviewProps) {
  const [fitImage, setFitImage] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFitImage(true);
    setFailed(false);
  }, [file.url]);

  const icon =
    file.kind === "image"
      ? "image"
      : file.kind === "video"
        ? "film"
        : "volume-2";
  const label = file.kind[0].toUpperCase() + file.kind.slice(1);

  return (
    <section className="media-preview" aria-label={`${label} preview: ${name}`}>
      <header className="media-preview-header">
        <span className="media-preview-title">
          <FeatherIcon icon={icon} size="17" />
          <span>
            <b>{name}</b>
            <small>
              {label} · {readableBytes(file.bytes)} · {file.mimeType}
            </small>
          </span>
        </span>
        {file.kind === "image" && !failed && (
          <div
            className="media-preview-actions horizontal-menu-scroll"
            role="group"
            aria-label="Image size"
            data-horizontal-menu
          >
            <button
              className={fitImage ? "active" : ""}
              onClick={() => setFitImage(true)}
            >
              <FeatherIcon icon="maximize" size="15" /> Fit
            </button>
            <button
              className={!fitImage ? "active" : ""}
              onClick={() => setFitImage(false)}
            >
              <FeatherIcon icon="maximize-2" size="15" /> Actual size
            </button>
          </div>
        )}
      </header>
      <div className={`media-preview-stage media-${file.kind}`}>
        {failed ? (
          <div className="media-preview-error" role="alert">
            <FeatherIcon icon="alert-circle" size="28" />
            <b>This media could not be decoded.</b>
            <p>
              The file is available, but its codec may not be supported by this
              operating system build.
            </p>
          </div>
        ) : file.kind === "image" ? (
          <img
            src={file.url}
            alt={name}
            className={fitImage ? "fit" : "actual"}
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : file.kind === "video" ? (
          <video
            src={file.url}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="audio-preview-card">
            <span className="audio-preview-icon" aria-hidden="true">
              <FeatherIcon icon="volume-2" size="32" />
            </span>
            <b>{name}</b>
            <audio
              src={file.url}
              controls
              preload="metadata"
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

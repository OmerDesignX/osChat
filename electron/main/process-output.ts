type OutputStream = {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
};

export function guardBrokenOutputPipe(stream: OutputStream | null | undefined) {
  stream?.on("error", (error) => {
    if (error.code === "EPIPE") return;
    throw error;
  });
}

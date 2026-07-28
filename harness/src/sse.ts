/**
 * Minimal Server-Sent Events parser over a fetch body stream.
 * Yields { event, data } pairs; callers JSON.parse the data as needed.
 */

export interface SseEvent {
  event: string;
  data: string;
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let dataLines: string[] = [];

  const flush = (): SseEvent | null => {
    if (dataLines.length === 0) return null;
    const out = { event, data: dataLines.join("\n") };
    event = "message";
    dataLines = [];
    return out;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const ev = flush();
          if (ev) yield ev;
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
        // comments (":...") and other fields ignored
      }
    }
    const ev = flush();
    if (ev) yield ev;
  } finally {
    reader.releaseLock();
  }
}

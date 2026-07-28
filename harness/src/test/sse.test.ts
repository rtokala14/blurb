import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSse } from "../sse.js";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

test("parses events split across chunks", async () => {
  const stream = streamOf(
    "event: content_block_delta\ndata: {\"a\":",
    "1}\n\n",
    "data: [DONE]\n\n",
  );
  const events = [];
  for await (const ev of parseSse(stream)) events.push(ev);
  assert.deepEqual(events, [
    { event: "content_block_delta", data: '{"a":1}' },
    { event: "message", data: "[DONE]" },
  ]);
});

test("handles CRLF and comments", async () => {
  const stream = streamOf(": keepalive\r\nevent: ping\r\ndata: {}\r\n\r\n");
  const events = [];
  for await (const ev of parseSse(stream)) events.push(ev);
  assert.deepEqual(events, [{ event: "ping", data: "{}" }]);
});

test("multi-line data joined with newline", async () => {
  const stream = streamOf("data: line1\ndata: line2\n\n");
  const events = [];
  for await (const ev of parseSse(stream)) events.push(ev);
  assert.equal(events[0]!.data, "line1\nline2");
});

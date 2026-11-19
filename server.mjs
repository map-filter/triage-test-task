import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify as mockClassify } from "./mock-ai.mjs";
import { MODEL_TIMEOUT_MS, parseInput, triage } from "./triage.mjs";

const MAX_BODY_BYTES = 64 * 1024;

const pages = {
  "/": {
    type: "text/html; charset=utf-8",
    body: await readFile(new URL("./index.html", import.meta.url)),
  },
  "/view.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(new URL("./view.mjs", import.meta.url)),
  },
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  return size <= MAX_BODY_BYTES ? Buffer.concat(chunks).toString("utf8") : null;
}

export function createApp({
  classify = mockClassify,
  timeoutMs = MODEL_TIMEOUT_MS,
  log = console.warn,
} = {}) {
  async function handleTriage(request, response) {
    const raw = await readBody(request);
    const text = raw === null ? null : parseInput(raw);
    if (text === null) return json(response, 400, { status: "invalid_input" });
    const result = await triage(text, {
      classify,
      timeoutMs,
      onFailure: (reason) => log(`[triage] manual_review: ${reason}`),
    });
    return json(response, 200, result);
  }

  return createServer(async (request, response) => {
    const page = request.method === "GET" ? pages[request.url] : undefined;
    if (page) {
      response.writeHead(200, { "Content-Type": page.type });
      response.end(page.body);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}

const TOPICS = new Set(["delivery", "pricing", "other"]);

export const MODEL_TIMEOUT_MS = 300;

class TriageFailure extends Error {}

export function parseInput(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

export function parseModelOutput(output) {
  if (typeof output !== "string") throw new TriageFailure("bad_output");
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new TriageFailure("bad_json");
  }
  if (result === null || typeof result !== "object") throw new TriageFailure("bad_output");
  const { topic, draft } = result;
  if (!TOPICS.has(topic)) throw new TriageFailure("bad_topic");
  if (typeof draft !== "string" || draft.trim() === "") throw new TriageFailure("empty_draft");
  return { topic, draft: draft.trim() };
}

export async function triage(text, { classify, timeoutMs = MODEL_TIMEOUT_MS, onFailure } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TriageFailure("timeout"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve().then(() => classify(text, { signal: controller.signal }));
    call.catch(() => {});
    const output = await Promise.race([call, timeout]);
    return { status: "ready", ...parseModelOutput(output) };
  } catch (error) {
    onFailure?.(error instanceof TriageFailure ? error.message : "model_error");
    return { status: "manual_review", topic: null, draft: null };
  } finally {
    clearTimeout(timer);
  }
}

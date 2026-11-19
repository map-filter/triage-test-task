import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, describe, test } from "node:test";
import { createApp } from "../server.mjs";
import { viewFor } from "../view.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

async function start(options) {
  const reasons = [];
  const server = createApp({ log: (line) => reasons.push(line), ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/triage`;
  return {
    reasons,
    close: () => new Promise((resolve) => server.close(resolve)),
    async post(body) {
      const reply = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: reply.status, body: await reply.json() };
    },
  };
}

describe("POST /api/triage с выданным имитатором", () => {
  let app;
  before(async () => {
    app = await start();
  });
  after(() => app.close());

  const invalidBodies = {
    "пустое тело": "",
    "битый JSON": "{text:",
    "нет поля text": {},
    "пустая строка": { text: "" },
    "одни пробелы": { text: "  \n " },
    "число вместо строки": { text: 42 },
    "null вместо строки": { text: null },
    "тело не объект": "null",
    "тело массив": ["Когда доставка?"],
  };
  for (const [name, body] of Object.entries(invalidBodies)) {
    test(`некорректный ввод (${name}) → 400 invalid_input`, async () => {
      assert.deepEqual(await app.post(body), { status: 400, body: { status: "invalid_input" } });
    });
  }

  test("слишком большое тело → 400 invalid_input", async () => {
    const reply = await app.post({ text: "a".repeat(70 * 1024) });
    assert.deepEqual(reply, { status: 400, body: { status: "invalid_input" } });
  });

  const topics = {
    "Когда будет доставка заказа?": "delivery",
    "Какая цена подключения?": "pricing",
    "Здравствуйте, есть вопрос": "other",
  };
  for (const [text, topic] of Object.entries(topics)) {
    test(`обычная заявка «${text}» → ready, тема ${topic}`, async () => {
      const { status, body } = await app.post({ text });
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body), ["status", "topic", "draft"]);
      assert.equal(body.status, "ready");
      assert.equal(body.topic, topic);
      assert.ok(body.draft.trim().length > 0);
    });
  }

  for (const tag of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    test(`сбой модели ${tag} → 200 manual_review без темы и черновика`, async () => {
      const reply = await app.post({ text: `Когда доставка? ${tag}` });
      assert.deepEqual(reply, { status: 200, body: MANUAL_REVIEW });
    });
  }

  test("ожидание модели ограничено: ответ на [timeout] приходит раньше её 1200 мс", async () => {
    const started = performance.now();
    await app.post({ text: "[timeout]" });
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 250 && elapsed < 900, `ответ пришёл за ${Math.round(elapsed)} мс`);
  });

  test("причина ручного разбора попадает в журнал", async () => {
    app.reasons.length = 0;
    await app.post({ text: "[bad-topic]" });
    assert.deepEqual(app.reasons, ["[triage] manual_review: bad_topic"]);
  });
});

describe("POST /api/triage с подменённой моделью", () => {
  async function postWith(classify, timeoutMs = 50) {
    const app = await start({ classify, timeoutMs });
    try {
      return await app.post({ text: "Когда доставка?" });
    } finally {
      await app.close();
    }
  }

  test("модель игнорирует отмену и не отвечает → manual_review по таймауту", async () => {
    const reply = await postWith(() => new Promise(() => {}));
    assert.deepEqual(reply, { status: 200, body: MANUAL_REVIEW });
  });

  test("модель падает синхронно → manual_review", async () => {
    const reply = await postWith(() => {
      throw new Error("boom");
    });
    assert.deepEqual(reply, { status: 200, body: MANUAL_REVIEW });
  });

  const badOutputs = {
    "не строка": { topic: "delivery", draft: "Ответ" },
    "JSON null": "null",
    "JSON массив": "[]",
    "нет черновика": JSON.stringify({ topic: "delivery" }),
    "черновик не строка": JSON.stringify({ topic: "delivery", draft: 5 }),
    "тема из прототипа": JSON.stringify({ topic: "constructor", draft: "Ответ" }),
  };
  for (const [name, output] of Object.entries(badOutputs)) {
    test(`неподходящий ответ модели (${name}) → manual_review`, async () => {
      assert.deepEqual(await postWith(async () => output), { status: 200, body: MANUAL_REVIEW });
    });
  }

  test("лишние поля ответа модели наружу не уходят", async () => {
    const reply = await postWith(async () =>
      JSON.stringify({ topic: "pricing", draft: " Ответ ", status: "hacked", debug: "secret" }),
    );
    assert.deepEqual(reply, {
      status: 200,
      body: { status: "ready", topic: "pricing", draft: "Ответ" },
    });
  });
});

describe("что видит менеджер на странице", () => {
  test("успех: тема по-русски и черновик", () => {
    const view = viewFor(200, { status: "ready", topic: "delivery", draft: "Спасибо за обращение." });
    assert.equal(view.kind, "ready");
    assert.equal(view.topic, "Доставка");
    assert.equal(view.draft, "Спасибо за обращение.");
  });

  test("manual_review: понятное сообщение, тема и прошлый черновик очищены", () => {
    const view = viewFor(200, { status: "manual_review", topic: null, draft: null });
    assert.equal(view.kind, "manual_review");
    assert.match(view.message, /вручную/);
    assert.equal(view.topic, "");
    assert.equal(view.draft, "");
  });

  test("пустой ввод: просьба ввести текст, черновика нет", () => {
    const view = viewFor(400, { status: "invalid_input" });
    assert.equal(view.kind, "invalid_input");
    assert.equal(view.draft, "");
  });

  const unexpected = {
    "ошибка сервера": [500, { status: "server_error" }],
    "ready без черновика": [200, { status: "ready", topic: "delivery", draft: "  " }],
    "ready с неизвестной темой": [200, { status: "ready", topic: "refund", draft: "Ответ" }],
    "пустой ответ": [200, null],
  };
  for (const [name, [status, body]] of Object.entries(unexpected)) {
    test(`неожиданный ответ сервера (${name}) → ручной разбор без черновика`, () => {
      const view = viewFor(status, body);
      assert.equal(view.kind, "manual_review");
      assert.equal(view.draft, "");
    });
  }
});

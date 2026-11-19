const TOPIC_LABELS = {
  delivery: "Доставка",
  pricing: "Цены",
  other: "Другое",
};

export const LOADING_VIEW = {
  kind: "loading",
  message: "Разбираем заявку…",
  topic: "",
  draft: "",
};

export const INVALID_INPUT_VIEW = {
  kind: "invalid_input",
  message: "Введите текст заявки.",
  topic: "",
  draft: "",
};

export const MANUAL_REVIEW_VIEW = {
  kind: "manual_review",
  message: "Автоматически разобрать заявку не получилось. Разберите её вручную.",
  topic: "",
  draft: "",
};

export function viewFor(httpStatus, body) {
  if (httpStatus === 400 && body?.status === "invalid_input") return INVALID_INPUT_VIEW;
  if (
    httpStatus === 200 &&
    body?.status === "ready" &&
    Object.hasOwn(TOPIC_LABELS, body.topic) &&
    typeof body.draft === "string" &&
    body.draft.trim() !== ""
  ) {
    return {
      kind: "ready",
      message: "Черновик готов. Проверьте его перед отправкой клиенту.",
      topic: TOPIC_LABELS[body.topic],
      draft: body.draft,
    };
  }
  return MANUAL_REVIEW_VIEW;
}

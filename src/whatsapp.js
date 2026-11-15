const graphBaseUrl = "https://graph.facebook.com";

function config() {
  const { META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_GRAPH_API_VERSION = "v27.0" } = process.env;
  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) throw new Error("META_ACCESS_TOKEN and META_PHONE_NUMBER_ID must be configured.");
  return { META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_GRAPH_API_VERSION };
}

async function send(payload) {
  const { META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_GRAPH_API_VERSION } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${graphBaseUrl}/${META_GRAPH_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`WhatsApp API error ${response.status}: ${await response.text()}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function sendText(to, body) {
  return send({ to, type: "text", text: { body } });
}

export function sendTemplate(to, name, languageCode, parameters) {
  return send({
    to,
    type: "template",
    template: {
      name,
      language: { code: languageCode },
      components: parameters.length ? [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] : []
    }
  });
}

import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import {
  addMessage,
  claimWebhookMessage,
  createTicket,
  getConversation,
  getTicketById,
  getTicketByNumber,
  getTicketForClientNotification,
  linkClientNotification,
  resolveTicket,
  saveConversation
} from "./store.js";
import { sendTemplate, sendText } from "./whatsapp.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const clientNumber = normalize(process.env.CLIENT_WHATSAPP_NUMBER ?? "");
const messageLimit = 4_000;
const senderWindows = new Map();

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true");
app.use((request, response, next) => {
  response.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  next();
});

const webhookRateLimit = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false });

function normalize(number) {
  return String(number).replace(/\D/g, "");
}

function ticketCode(ticket) {
  return `DS-${ticket.ticket_number}`;
}

function isValidPhone(number) {
  return /^[1-9][0-9]{6,14}$/.test(number);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) && email.length <= 254;
}

function textFrom(message) {
  return message.type === "text" ? message.text?.body?.trim() : "";
}

function isValidMetaSignature(rawBody, receivedSignature) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !receivedSignature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const actual = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function clientHasOpenSession(conversation) {
  if (!conversation?.last_message_at) return false;
  return Date.now() - new Date(conversation.last_message_at).getTime() < 24 * 60 * 60 * 1000;
}

function isWithinSenderLimit(sender) {
  const now = Date.now();
  const windowStart = now - 10 * 60 * 1000;
  const entries = (senderWindows.get(sender) ?? []).filter((time) => time > windowStart);
  if (entries.length >= 15) return false;
  entries.push(now);
  senderWindows.set(sender, entries);
  return true;
}

app.get("/health", (_request, response) => response.json({ ok: true }));

app.get("/webhook", (request, response) => {
  const mode = request.query["hub.mode"];
  const token = request.query["hub.verify_token"];
  const challenge = request.query["hub.challenge"];
  if (mode === "subscribe" && token && token === process.env.WEBHOOK_VERIFY_TOKEN) return response.status(200).send(challenge);
  return response.sendStatus(403);
});

app.post("/webhook", webhookRateLimit, express.raw({ type: "application/json", limit: "1mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !isValidMetaSignature(request.body, request.get("x-hub-signature-256"))) return response.sendStatus(401);

  let payload;
  try {
    payload = JSON.parse(request.body.toString("utf8"));
  } catch {
    return response.sendStatus(400);
  }

  try {
    await processWebhook(payload);
    return response.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
    return response.sendStatus(500);
  }
});

async function processWebhook(payload) {
  if (payload.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const contacts = change.value?.contacts ?? [];
      for (const message of change.value?.messages ?? []) await handleIncoming(message, contacts);
    }
  }
}

async function handleIncoming(message, contacts) {
  const from = normalize(message.from);
  const body = textFrom(message);
  if (!message.id || !isValidPhone(from) || !body || body.length > messageLimit) return;
  if (!isWithinSenderLimit(from)) return;
  if (!(await claimWebhookMessage(message.id))) return;

  if (from === clientNumber) {
    const priorConversation = await getConversation(clientNumber);
    await saveConversation(clientNumber, { step: priorConversation?.step ?? "issue", customerName: priorConversation?.customer_name });
    return relayClientReply(message, body);
  }

  const customerName = contacts.find((contact) => normalize(contact.wa_id) === from)?.profile?.name;
  const conversation = await getConversation(from);

  if (!conversation || conversation.step === "issue" || conversation.step === "complete") {
    await saveConversation(from, { step: "email", issue: body, customerName });
    return sendText(from, "Thanks. Please send the email address you used on DanSMS.");
  }

  if (conversation.step === "email") {
    if (!isValidEmail(body)) return sendText(from, "Please send a valid email address used on DanSMS.");
    const ticket = await createTicket({ customerNumber: from, customerName: conversation.customer_name ?? customerName, issue: conversation.issue, email: body.toLowerCase() });
    await saveConversation(from, { step: "awaiting_agent", ticketId: ticket.id, customerName: conversation.customer_name ?? customerName });
    await addMessage({ ticketId: ticket.id, direction: "customer_inbound", body: conversation.issue, wamid: message.id });
    await sendText(from, `Thank you. Your support request (${ticketCode(ticket)}) has been received. A live agent will reply shortly. Please do not call this number.`);
    return notifyClient(ticket);
  }

  const ticket = await getTicketById(conversation.ticket_id);
  return sendText(from, `Your request (${ticket ? ticketCode(ticket) : "current"}) is already with support. A live agent will reply shortly.`);
}

async function notifyClient(ticket) {
  if (!isValidPhone(clientNumber)) throw new Error("CLIENT_WHATSAPP_NUMBER must be configured as an international number without +.");
  const clientConversation = await getConversation(clientNumber);
  const body = [
    `New support request — ${ticketCode(ticket)}`,
    `Customer: +${ticket.customer_number}`,
    `Email: ${ticket.email}`,
    `Issue: ${ticket.issue}`,
    "Reply directly to this message to answer the customer.",
    `Fallback: #${ticketCode(ticket)} your message`,
    `Resolve: #${ticketCode(ticket)} resolve`
  ].join("\n");

  let result;
  if (clientHasOpenSession(clientConversation)) {
    result = await sendText(clientNumber, body);
  } else {
    const templateName = process.env.META_CLIENT_NOTIFICATION_TEMPLATE;
    if (!templateName) throw new Error("META_CLIENT_NOTIFICATION_TEMPLATE is required when the client has no active 24-hour window.");
    result = await sendTemplate(clientNumber, templateName, process.env.META_CLIENT_NOTIFICATION_TEMPLATE_LANGUAGE ?? "en_US", [
      ticketCode(ticket), ticket.customer_number, ticket.email, ticket.issue
    ]);
  }

  const wamid = result.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta did not return a notification message ID.");
  await linkClientNotification(ticket.id, wamid);
  await addMessage({ ticketId: ticket.id, direction: "client_notification", body, wamid });
}

async function relayClientReply(message, body) {
  const directReplyTicket = message.context?.id ? await getTicketForClientNotification(message.context.id) : null;
  const fallbackMatch = body.match(/^#DS-(\d+)\s+([\s\S]+)/i);
  const ticket = directReplyTicket ?? (fallbackMatch ? await getTicketByNumber(Number(fallbackMatch[1])) : null);
  const replyText = directReplyTicket ? body : fallbackMatch?.[2]?.trim();

  if (!ticket || !replyText) return sendText(clientNumber, "Reply directly to a ticket notification, or use: #DS-1001 your message");
  if (/^resolve$/i.test(replyText)) {
    await resolveTicket(ticket);
    return sendText(clientNumber, `${ticketCode(ticket)} is marked resolved.`);
  }
  if (ticket.status === "resolved") return sendText(clientNumber, `${ticketCode(ticket)} is resolved. Ask the customer to open a new request if they need more help.`);

  await sendText(ticket.customer_number, replyText);
  await addMessage({ ticketId: ticket.id, direction: "client_inbound", body: replyText, wamid: message.id });
  return sendText(clientNumber, `Sent to +${ticket.customer_number} for ${ticketCode(ticket)}.`);
}

app.use((_request, response) => response.sendStatus(404));
app.use((error, _request, response, _next) => {
  if (error.type === "entity.too.large") return response.sendStatus(413);
  console.error("Unhandled server error:", error.message);
  return response.sendStatus(500);
});

app.listen(port, "0.0.0.0", () => console.log(`DanSMS support bot listening on port ${port}`));

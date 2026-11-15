import { getSupabase } from "./supabase.js";

function fail(error, action) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export async function claimWebhookMessage(wamid) {
  const { error } = await getSupabase().from("processed_webhook_messages").insert({ wamid });
  if (!error) return true;
  if (error.code === "23505") return false;
  fail(error, "Could not record incoming WhatsApp message");
}

export async function getConversation(customerNumber) {
  const { data, error } = await getSupabase().from("conversations").select().eq("customer_number", customerNumber).maybeSingle();
  fail(error, "Could not load conversation");
  return data;
}

export async function saveConversation(customerNumber, conversation) {
  const { data, error } = await getSupabase().from("conversations").upsert({
    customer_number: customerNumber,
    customer_name: conversation.customerName ?? null,
    step: conversation.step,
    issue: conversation.issue ?? null,
    ticket_id: conversation.ticketId ?? null,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).select().single();
  fail(error, "Could not save conversation");
  return data;
}

export async function createTicket({ customerNumber, customerName, issue, email }) {
  const { data, error } = await getSupabase().from("tickets").insert({
    customer_number: customerNumber,
    customer_name: customerName ?? null,
    issue,
    email
  }).select().single();
  fail(error, "Could not create ticket");
  return data;
}

export async function getTicketByNumber(ticketNumber) {
  const { data, error } = await getSupabase().from("tickets").select().eq("ticket_number", ticketNumber).maybeSingle();
  fail(error, "Could not load ticket");
  return data;
}

export async function getTicketById(ticketId) {
  const { data, error } = await getSupabase().from("tickets").select().eq("id", ticketId).maybeSingle();
  fail(error, "Could not load ticket");
  return data;
}

export async function getTicketForClientNotification(messageId) {
  const { data, error } = await getSupabase().from("tickets").select().eq("client_notification_wamid", messageId).maybeSingle();
  fail(error, "Could not load ticket from reply context");
  return data;
}

export async function linkClientNotification(ticketId, messageId) {
  const { error } = await getSupabase().from("tickets").update({
    client_notification_wamid: messageId,
    client_notification_sent_at: new Date().toISOString()
  }).eq("id", ticketId);
  fail(error, "Could not link client notification");
}

export async function addMessage({ ticketId, direction, body, wamid = null }) {
  const { error } = await getSupabase().from("ticket_messages").insert({ ticket_id: ticketId, direction, body, wamid });
  fail(error, "Could not save ticket message");
}

export async function resolveTicket(ticket) {
  const now = new Date().toISOString();
  const database = getSupabase();
  const { error: ticketError } = await database.from("tickets").update({ status: "resolved", resolved_at: now }).eq("id", ticket.id);
  fail(ticketError, "Could not resolve ticket");
  const { error: conversationError } = await database.from("conversations").update({ step: "complete", updated_at: now }).eq("ticket_id", ticket.id);
  fail(conversationError, "Could not close conversation");
}

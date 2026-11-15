# DanSMS WhatsApp Support

WhatsApp Cloud API support bot with a two-number relay:

1. A customer messages the dedicated bot number.
2. The bot collects the issue and DanSMS email, then creates a ticket.
3. The client receives a notification on their ordinary WhatsApp account.
4. A direct reply is mapped using Meta's reply `context.id` and the saved notification `wamid`.
5. The backend sends the client's reply to the customer from the bot number.

## Stack

- Node.js and Express
- WhatsApp Cloud API
- Supabase managed PostgreSQL

Supabase is the production database. It preserves tickets, conversation state, Meta message IDs, and message history across restarts.

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Create a Supabase project, open its SQL Editor, and run [the migration](supabase/migrations/20261115193000_initial_schema.sql). Then set `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in `.env`.

Never commit `.env`, Meta tokens, the Meta app secret, or the Supabase secret key. The server must be the only place that has those secrets.

## Required WhatsApp configuration

Configure these values in `.env` after creating the Meta app:

- `META_APP_SECRET` — Meta app dashboard → App settings → Basic.
- `META_ACCESS_TOKEN` and `META_PHONE_NUMBER_ID` — WhatsApp → API Setup.
- `CLIENT_WHATSAPP_NUMBER` — the client's existing number in international digits only, for example `2348012345678`.
- `META_CLIENT_NOTIFICATION_TEMPLATE` — an approved template used when the client has not messaged the bot in the preceding 24 hours.

Use a template with four body variables in this order: ticket code, customer number, customer email, issue. Suggested body:

```text
New DanSMS support request {{1}}
Customer: +{{2}}
Email: {{3}}
Issue: {{4}}

Reply directly to this message to answer the customer.
```

## Meta webhook setup

Expose the local server through an HTTPS tunnel during testing, then set:

- Callback URL: `https://your-public-url/webhook`
- Verify token: exactly `WEBHOOK_VERIFY_TOKEN`
- Subscription: the `messages` field

The webhook validates Meta's `X-Hub-Signature-256` header using `META_APP_SECRET`. It rejects unsigned or altered requests and deduplicates Meta retries by `wamid`.

## Client reply rules

- Preferred: reply directly to the ticket notification in WhatsApp.
- Fallback for a new message: `#DS-1001 your reply`.
- Resolve: `#DS-1001 resolve`.

The bot never guesses which customer an unthreaded reply belongs to.

## Production checklist

- Deploy from GitHub to Render with [render.yaml](render.yaml). Render supplies `PORT`; this service listens on `0.0.0.0:$PORT` and uses `/health` as its health check.
- Deploy behind HTTPS with `TRUST_PROXY=true` only if the deployment platform supplies and sanitizes proxy headers.
- Set all environment variables in the host's secret manager, not in source control.
- Keep Supabase RLS enabled; the migration revokes browser roles from the support tables.
- Create the client-notification template before launch.
- Restart the process after changing `.env`.

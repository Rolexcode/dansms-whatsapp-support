# Security Audit — DanSMS WhatsApp Support

Mode: comprehensive first-build review. Date: 2026-11-15.

## Scope

- Node.js webhook and WhatsApp relay source
- Supabase migration and access controls
- Dependency supply chain
- Git history, local secret patterns, CI/CD configuration, and public routes

## Stack Summary

| Area | Result |
| --- | --- |
| Runtime | Node.js 24, Express 4 |
| Database | Supabase managed PostgreSQL |
| Auth | Meta HMAC webhook signature; privileged server-only database key |
| Public API | `GET /health`, `GET /webhook`, `POST /webhook` |
| External services | WhatsApp Cloud API, Supabase Data API |

## Findings

No unresolved critical, high, or medium-confidence vulnerabilities remain in the source reviewed.

### [INFO] AUD-001: Customer data retention needs an operational policy

**Confidence:** 9/10  
**Category:** Data classification / privacy  
**Location:** `tickets`, `ticket_messages`, and `conversations` tables

The service stores customer phone numbers, email addresses, and support messages. This is required for the relay, but the project has no documented retention period yet.

**Recommendation:** Agree a retention period with DanSMS before production (for example, 90 days after a ticket is resolved), then add a scheduled deletion job. Do not add that deletion until the business confirms the period.

## Controls Verified

- Meta webhook POSTs require a constant-time HMAC SHA-256 signature check.
- Webhook payloads are capped at 1 MB, text messages at 4,000 characters, and inbound senders at 15 messages per 10 minutes.
- Meta retry duplicates are prevented by a database uniqueness constraint on incoming `wamid` values.
- Direct operator replies map only through the saved notification `wamid`; unthreaded replies require an explicit ticket code.
- Supabase Row Level Security is enabled; `anon` and `authenticated` are revoked from support data tables.
- Secret keys are environment variables, `.env` is ignored, and no committed live secret was found in the current repository or its history.
- `npm audit --omit=dev` reported zero known dependency vulnerabilities.
- No CI/CD workflow, Dockerfile, public dashboard, file upload route, shell execution, or LLM integration exists in scope.

## Deployment Actions

1. Use Supabase's secret key only on the server and never in a browser or public repository.
2. Create and approve the client notification template before production use.
3. Configure all production secrets in the hosting provider, enable HTTPS, and set `TRUST_PROXY=true` only behind a trusted reverse proxy.
4. Add a documented retention/deletion policy before launch.

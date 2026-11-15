create table if not exists public.conversations (
  customer_number text primary key check (customer_number ~ '^[1-9][0-9]{6,14}$'),
  customer_name text,
  step text not null default 'issue' check (step in ('issue', 'email', 'awaiting_agent', 'complete')),
  issue text,
  ticket_id uuid,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique not null,
  customer_number text not null references public.conversations(customer_number),
  customer_name text,
  issue text not null check (char_length(issue) between 1 and 4000),
  email text not null check (char_length(email) between 3 and 254),
  status text not null default 'open' check (status in ('open', 'resolved')),
  client_notification_wamid text unique,
  client_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.conversations add constraint conversations_ticket_id_fkey foreign key (ticket_id) references public.tickets(id) on delete set null;
create index if not exists tickets_customer_number_created_at_idx on public.tickets (customer_number, created_at desc);
create index if not exists tickets_notification_wamid_idx on public.tickets (client_notification_wamid) where client_notification_wamid is not null;

create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  direction text not null check (direction in ('customer_inbound', 'client_inbound', 'bot_outbound', 'client_notification')),
  body text not null check (char_length(body) between 1 and 4096),
  wamid text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.processed_webhook_messages (
  wamid text primary key,
  received_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.processed_webhook_messages enable row level security;
revoke all on public.conversations, public.tickets, public.ticket_messages, public.processed_webhook_messages from anon, authenticated;
grant all on public.conversations, public.tickets, public.ticket_messages, public.processed_webhook_messages to service_role;

-- QRIS gateway schema (jalankan sekali di Supabase SQL editor / management API)
CREATE TABLE IF NOT EXISTS public.invoices (
  id text PRIMARY KEY,
  amount bigint NOT NULL,
  base_amount bigint NOT NULL,
  reference text,
  callback_url text,
  callback_secret text,
  status text NOT NULL DEFAULT 'pending',
  sender_name text,
  event_id text,
  paid_at timestamptz,
  expires_at timestamptz,
  tg_msg_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tg_chats (
  chat_id bigint PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id bigserial PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Sweep expired tiap menit: panggil edge function /expiry via pg_net
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('qris-expiry-sweep') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'qris-expiry-sweep'
);

SELECT cron.schedule('qris-expiry-sweep', '* * * * *', $net$ SELECT net.http_post(
  url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expiry',
  headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', '<QRIS_HOOK_SECRET>'),
  body := '{}'::jsonb
) $net$);

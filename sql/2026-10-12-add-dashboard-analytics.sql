-- Minimal, content-free Chatwoot projection used by the dashboard.
-- Apply to the database configured by DATABASE_URL.

CREATE SCHEMA IF NOT EXISTS dashboard_analytics;

CREATE TABLE IF NOT EXISTS dashboard_analytics.chatwoot_messages (
  message_id bigint PRIMARY KEY,
  conversation_id bigint NOT NULL,
  account_id bigint NOT NULL,
  inbox_id bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  kind text NOT NULL CHECK (kind IN ('customer', 'human', 'template', 'automation', 'system')),
  private boolean NOT NULL,
  delivery_status text CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed')),
  author_id bigint,
  author_name text,
  created_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_chatwoot_messages_inbox_created
  ON dashboard_analytics.chatwoot_messages (inbox_id, created_at, message_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_chatwoot_messages_conversation_created
  ON dashboard_analytics.chatwoot_messages (conversation_id, created_at, message_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_chatwoot_messages_author_created
  ON dashboard_analytics.chatwoot_messages (author_id, created_at, message_id)
  WHERE author_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dashboard_analytics.sync_state (
  source text PRIMARY KEY,
  cursor_updated_at timestamptz,
  cursor_id bigint,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  last_error_message text,
  CHECK (
    (cursor_updated_at IS NULL AND cursor_id IS NULL)
    OR (cursor_updated_at IS NOT NULL AND cursor_id IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION dashboard_analytics.business_seconds(
  interval_start timestamptz,
  interval_end timestamptz
) RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  WITH local_days AS (
    SELECT generated_day::date AS business_day
    FROM generate_series(
      (interval_start AT TIME ZONE 'America/Araguaina')::date,
      (interval_end AT TIME ZONE 'America/Araguaina')::date,
      interval '1 day'
    ) AS generated_day
  ), bounded_days AS (
    SELECT
      GREATEST(
        interval_start,
        (business_day::timestamp + time '08:00') AT TIME ZONE 'America/Araguaina'
      ) AS bounded_start,
      LEAST(
        interval_end,
        (business_day::timestamp + time '20:00') AT TIME ZONE 'America/Araguaina'
      ) AS bounded_end
    FROM local_days
    WHERE extract(isodow FROM business_day) BETWEEN 1 AND 6
      AND interval_end > interval_start
  )
  SELECT COALESCE(
    sum(GREATEST(0, extract(epoch FROM bounded_end - bounded_start))),
    0
  )::bigint
  FROM bounded_days;
$$;

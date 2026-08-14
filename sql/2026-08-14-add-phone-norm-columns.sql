-- sql/2026-08-14-add-phone-norm-columns.sql
-- Adds pre-normalized, indexed phone-number columns so the dashboard's
-- phone-matching queries (src/lib/dashboard-db.ts) can use an index instead
-- of computing regexp_replace/right per row. See
-- docs/superpowers/specs/2026-08-14-dashboard-query-timeout-design.md

ALTER TABLE disparos.contatos
  ADD COLUMN numero_norm text GENERATED ALWAYS AS (
    right(regexp_replace(COALESCE(wa_id, celular, ''), '[^0-9]', '', 'g'), 8)
  ) STORED;

CREATE INDEX CONCURRENTLY idx_contatos_numero_norm
  ON disparos.contatos (numero_norm);

ALTER TABLE disparos.campanha_destinatarios
  ADD COLUMN celular_norm text GENERATED ALWAYS AS (
    right(regexp_replace(COALESCE(celular_snapshot, ''), '[^0-9]', '', 'g'), 8)
  ) STORED;

CREATE INDEX CONCURRENTLY idx_destinatarios_conta_celular_norm
  ON disparos.campanha_destinatarios (conta_waba_id, celular_norm);

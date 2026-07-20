-- CSAT (avaliação de satisfação) do atendimento de RH: o colaborador avalia o
-- ticket assim que ele é marcado como resolvido. Sem isso, o RH não tinha
-- nenhum sinal se o atendimento foi bom, só se foi encerrado.
-- SLA de espera (tempo em "aguardando_rh") não precisa de coluna nova — é
-- calculado no cliente a partir de hr_tickets.updated_at, que já é atualizado
-- no exato momento em que o status vira 'aguardando_rh' (trigger hr_tickets_updated_at).

ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS csat_rating   SMALLINT CHECK (csat_rating BETWEEN 1 AND 5);
ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS csat_comment  TEXT;
ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS csat_rated_at TIMESTAMPTZ;

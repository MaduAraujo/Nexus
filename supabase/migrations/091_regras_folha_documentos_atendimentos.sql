ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_status_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_status_check CHECK (status IN ('rascunho', 'publicado', 'pago'));

DROP POLICY IF EXISTS "colabo_payslips_own" ON payslips;
CREATE POLICY "colabo_payslips_own" ON payslips FOR SELECT
  USING (employee_id = my_employee_id() AND status <> 'rascunho');

CREATE OR REPLACE FUNCTION payslips_tributacao_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_proventos JSONB;
  v_descontos JSONB;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR NEW.status NOT IN ('publicado', 'pago') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_proventos := NEW.proventos::TEXT::JSONB;
    v_descontos := NEW.descontos::TEXT::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_proventos := NULL;
  END;

  IF v_proventos IS NULL OR jsonb_typeof(v_proventos) <> 'array' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IN ('publicado', 'pago') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Holerite em rascunho só é publicado com a folha recalculada.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_proventos) p WHERE p->>'cod' IN ('040', '041') AND (p->>'valor')::NUMERIC > 0)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_descontos, '[]'::JSONB)) d WHERE d->>'cod' = '901' AND (d->>'valor')::NUMERIC > 0) THEN
    RAISE EXCEPTION 'Holerite com férias sem desconto de INSS não pode ser publicado nem pago. Recalcule a folha do mês.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION payslips_tributacao_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_a_tributacao_guard_trg ON payslips;
CREATE TRIGGER payslips_a_tributacao_guard_trg
  BEFORE INSERT OR UPDATE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_tributacao_guard();

CREATE OR REPLACE FUNCTION apply_ferias_payroll_event(
  p_employee_id UUID,
  p_mes TEXT,
  p_mes_formatado TEXT,
  p_competencia TEXT,
  p_novos_proventos JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing payslips_decrypted;
  v_proventos JSONB;
  v_total_proventos NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode gerar eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_existing FROM payslips_decrypted WHERE employee_id = p_employee_id AND mes = p_mes;

  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_existing.proventos, '[]'::jsonb)) p WHERE p->>'cod' = '040') THEN
      RETURN;
    END IF;
    IF v_existing.status = 'pago' THEN
      RAISE EXCEPTION 'O holerite de % já foi pago: lance as férias em folha complementar.', p_mes USING ERRCODE = '55000';
    END IF;
    v_proventos := COALESCE(v_existing.proventos, '[]'::jsonb) || p_novos_proventos;
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
    UPDATE payslips SET
      proventos = v_proventos::text,
      total_proventos = v_total_proventos::text,
      salario_liquido = (v_total_proventos - COALESCE(v_existing.total_descontos, 0))::text,
      status = 'rascunho'
    WHERE id = v_existing.id;
  ELSE
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(p_novos_proventos) p);
    INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
    VALUES (p_employee_id, p_mes, p_mes_formatado, p_competencia, p_novos_proventos::text, '[]', v_total_proventos::text, '0', v_total_proventos::text, 'rascunho');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;

UPDATE payslips p SET status = 'rascunho'
  FROM payslips_decrypted d
 WHERE d.id = p.id
   AND d.status = 'publicado'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.proventos, '[]'::jsonb)) x WHERE x->>'cod' IN ('040', '041'))
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.descontos, '[]'::jsonb)) x WHERE x->>'cod' = '901');

ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

CREATE OR REPLACE FUNCTION document_is_retained(p_status TEXT, p_retido_ate DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_status = 'aprovado' AND (p_retido_ate IS NULL OR p_retido_ate >= CURRENT_DATE);
$$;

GRANT EXECUTE ON FUNCTION document_is_retained(TEXT, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION document_path_locked(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
     WHERE d.storage_path = p_path
       AND (document_is_retained(d.status, d.retido_ate)
            OR (d.deleted_at IS NOT NULL AND (d.retido_ate IS NULL OR d.retido_ate >= CURRENT_DATE)))
  );
$$;

REVOKE ALL ON FUNCTION document_path_locked(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION document_path_locked(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "colabo_docs_select_own" ON documents;
CREATE POLICY "colabo_docs_select_own" ON documents FOR SELECT
  USING (employee_id = my_employee_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "colabo_docs_delete_own" ON documents;
CREATE POLICY "colabo_docs_delete_own" ON documents FOR DELETE
  USING (employee_id = my_employee_id() AND source = 'colaborador' AND deleted_at IS NULL
         AND NOT document_is_retained(status, retido_ate));

CREATE OR REPLACE FUNCTION documents_retention_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF document_is_retained(OLD.status, OLD.retido_ate) THEN
      RAISE EXCEPTION 'Documento aprovado sob guarda legal até % não pode ser apagado. O RH pode excluí-lo de forma lógica, informando o motivo.',
        COALESCE(to_char(OLD.retido_ate, 'DD/MM/YYYY'), 'prazo indefinido') USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Documento excluído é mantido só para guarda legal e não pode ser alterado.' USING ERRCODE = '42501';
  END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL OR NEW.deleted_reason IS NOT NULL THEN
    RAISE EXCEPTION 'A exclusão de documento só é feita pela função soft_delete_documents (com motivo).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION documents_retention_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_retention_guard_trg ON documents;
CREATE TRIGGER documents_retention_guard_trg
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_retention_guard();

CREATE OR REPLACE FUNCTION soft_delete_documents(p_ids UUID[], p_reason TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_count  INTEGER;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode excluir documentos.' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;

  WITH excluidos AS (
    UPDATE documents
       SET deleted_at = NOW(), deleted_by = auth.uid(), deleted_reason = v_reason
     WHERE id = ANY(p_ids) AND deleted_at IS NULL
    RETURNING id, name, employee_id, retido_ate
  ), auditoria AS (
    INSERT INTO document_audit_log (document_id, document_name, employee_id, action, actor_id, actor_name, actor_profile, details)
    SELECT id, name, employee_id, 'excluido', auth.uid(), 'Administrador', 'rh',
           jsonb_build_object('motivo', v_reason, 'exclusao', 'logica', 'retido_ate', retido_ate, 'email', auth.jwt()->>'email')
      FROM excluidos
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM auditoria;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_documents(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION soft_delete_documents(UUID[], TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "documents_storage_retention_delete" ON storage.objects;
CREATE POLICY "documents_storage_retention_delete" ON storage.objects AS RESTRICTIVE FOR DELETE
  USING (bucket_id <> 'documents' OR NOT document_path_locked(name));

DROP POLICY IF EXISTS "documents_storage_retention_update" ON storage.objects;
CREATE POLICY "documents_storage_retention_update" ON storage.objects AS RESTRICTIVE FOR UPDATE
  USING (bucket_id <> 'documents' OR NOT document_path_locked(name));

DROP POLICY IF EXISTS "tickets_colab_delete_own" ON hr_tickets;

CREATE OR REPLACE FUNCTION hr_tickets_history_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O histórico de atendimentos é preservado para o RH. Para tirar da sua lista, use "Apagar para mim".' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'hr_ticket_messages' THEN
    RAISE EXCEPTION 'Mensagens de atendimento não podem ser alteradas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION hr_tickets_history_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS hr_tickets_history_guard_trg ON hr_tickets;
CREATE TRIGGER hr_tickets_history_guard_trg
  BEFORE DELETE ON hr_tickets
  FOR EACH ROW EXECUTE FUNCTION hr_tickets_history_guard();

DROP TRIGGER IF EXISTS hr_ticket_messages_history_guard_trg ON hr_ticket_messages;
CREATE TRIGGER hr_ticket_messages_history_guard_trg
  BEFORE UPDATE OR DELETE ON hr_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION hr_tickets_history_guard();

-- Restringe a exclusão do colaborador aos próprios documentos autoenviados
-- (antes, "colabo_docs_own" permitia excluir qualquer documento vinculado a ele,
-- inclusive contratos e termos enviados pelo RH).
DROP POLICY IF EXISTS "colabo_docs_own" ON documents;

CREATE POLICY "colabo_docs_select_own" ON documents FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_docs_insert_own" ON documents FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND source = 'colaborador');

CREATE POLICY "colabo_docs_delete_own" ON documents FOR DELETE
  USING (employee_id = my_employee_id() AND source = 'colaborador');

-- Necessário para o versionamento: ao reenviar um documento, o colaborador marca a
-- própria versão anterior como superada (is_current = false). Só alcança documentos
-- que ele mesmo enviou — nunca os de origem "Administrador".
CREATE POLICY "colabo_docs_update_own" ON documents FOR UPDATE
  USING (employee_id = my_employee_id() AND source = 'colaborador')
  WITH CHECK (employee_id = my_employee_id() AND source = 'colaborador');

-- A assinatura eletrônica passa a ser feita por uma função com privilégios elevados
-- em vez de um UPDATE direto do colaborador na tabela — evita ter que conceder
-- ao colaborador permissão de update em documents (que reabriria a mesma brecha).
CREATE OR REPLACE FUNCTION sign_document(p_document_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id     UUID;
  v_requer_assinatura BOOLEAN;
  v_assinado_em     TIMESTAMPTZ;
BEGIN
  SELECT employee_id, requer_assinatura, assinado_em
    INTO v_employee_id, v_requer_assinatura, v_assinado_em
    FROM documents WHERE id = p_document_id;

  IF v_employee_id IS NULL OR v_employee_id <> my_employee_id() THEN
    RAISE EXCEPTION 'Documento não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF NOT v_requer_assinatura THEN
    RAISE EXCEPTION 'Este documento não requer assinatura eletrônica';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Documento já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE documents SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_document(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION documents_substitui_versao_anterior()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.replaces_document_id IS NULL OR NEW.is_current IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  UPDATE documents d
     SET is_current = false
   WHERE d.id = NEW.replaces_document_id
     AND d.id <> NEW.id
     AND d.is_current
     AND d.employee_id IS NOT DISTINCT FROM NEW.employee_id
     AND d.tipo IS NOT DISTINCT FROM NEW.tipo
     AND (NEW.source = 'Administrador' OR d.source = 'colaborador');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION documents_substitui_versao_anterior() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_substitui_versao_anterior_trg ON documents;
CREATE TRIGGER documents_substitui_versao_anterior_trg
  AFTER INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_substitui_versao_anterior();


CREATE OR REPLACE FUNCTION documents_collaborator_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_banco_horas BOOLEAN;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_banco_horas := NEW.category = 'banco_horas' AND NEW.tipo = 'Atestado/Comprovante';

    IF NEW.requer_assinatura IS TRUE OR NEW.assinado_em IS NOT NULL OR NEW.assinado_por IS NOT NULL THEN
      RAISE EXCEPTION 'Assinatura de documento só é registrada pelo próprio fluxo de assinatura.' USING ERRCODE = '42501';
    END IF;
    IF NEW.category IS NOT NULL AND NOT v_banco_horas THEN
      RAISE EXCEPTION 'A categoria do documento é definida pelo RH.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pendente' AND NOT v_banco_horas THEN
      RAISE EXCEPTION 'Documentos enviados pelo colaborador entram como pendentes; a aprovação é do RH.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
    RAISE EXCEPTION 'Você só pode substituir a versão do seu documento. Status, categoria e assinatura são geridos pelo RH.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION documents_collaborator_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_collaborator_guard_trg ON documents;
CREATE TRIGGER documents_collaborator_guard_trg
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_collaborator_guard();

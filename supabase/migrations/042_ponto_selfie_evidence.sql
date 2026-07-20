-- confirmarRegistro() (ponto-colaborador.js) gravava o ponto usando só a sessão autenticada
-- como prova de identidade — qualquer pessoa com acesso ao dispositivo/sessão de outro
-- colaborador conseguia bater o ponto por ela, sem nenhuma evidência de quem de fato apertou
-- o botão. Adiciona captura de selfie obrigatória no momento do registro (cliente já passa a
-- bloquear a confirmação sem foto).
--
-- Bucket privado (diferente de "avatars", que é público de propósito): são fotos do momento
-- da batida, não de perfil, então não devem ser legíveis por qualquer um. Leitura restrita ao
-- próprio colaborador dono do registro e ao RH (auditoria). Sem policy de UPDATE/DELETE — a
-- evidência não pode ser reescrita ou apagada depois de gravada, nem pelo RH.

ALTER TABLE time_records
  ADD COLUMN IF NOT EXISTS entrada_selfie_path        TEXT,
  ADD COLUMN IF NOT EXISTS saida_almoco_selfie_path    TEXT,
  ADD COLUMN IF NOT EXISTS retorno_almoco_selfie_path  TEXT,
  ADD COLUMN IF NOT EXISTS saida_selfie_path           TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ponto-selfies', 'ponto-selfies', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Caminho gravado pelo cliente é "{employee_id}/{data}_{step}_{timestamp}.jpg" — o primeiro
-- segmento do path é sempre o dono do registro, igual ao padrão já usado no bucket "documents".
CREATE POLICY "colabo_ponto_selfies_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_ponto_selfies_select_own" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "rh_ponto_selfies_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'ponto-selfies' AND is_rh());

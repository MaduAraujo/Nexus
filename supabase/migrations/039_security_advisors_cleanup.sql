-- Limpeza dos itens levantados por `supabase db advisors --type security` depois
-- das migrations 033–038.

-- 1) A migration 033 criou "public_avatars_select" sem checar que o bucket já
-- tinha uma policy de leitura pública idêntica ("avatar_public_read", USING
-- bucket_id = 'avatars', não rastreada em nenhuma migration anterior). O advisor
-- "public_bucket_allows_listing" aponta as duas como redundantes — mantém só a
-- que já existia.
DROP POLICY IF EXISTS "public_avatars_select" ON storage.objects;

-- 2) "function_search_path_mutable": estas 3 funções não tinham SET search_path,
-- diferente de approve_bank_request/sign_document (que já seguem essa prática).
-- Sem isso, uma função SECURITY DEFINER fica vulnerável a search_path hijacking
-- (uma role maliciosa poderia criar um objeto de mesmo nome em outro schema que
-- entra antes de "public" na search_path da sessão). Corpo idêntico ao de
-- schema.sql — apenas adiciona SET search_path.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION is_rh()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles WHERE id = auth.uid() AND profile = 'colaborador';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- 3) is_rh(), my_employee_id(), sign_document() e approve_bank_request() aparecem
-- no advisor como chamáveis via RPC por anon/authenticated. Não são um problema:
-- is_rh()/my_employee_id() só leem o que o próprio auth.uid() já enxergaria (uma
-- chamada anônima retorna false/NULL, já que auth.uid() é NULL); sign_document()
-- e approve_bank_request() validam por dentro quem está chamando e lançam
-- exceção se não for o dono/gestor/RH certo (ver migrations 016 e 020). Deixado
-- como está — revogar EXECUTE quebraria o fluxo normal do colaborador chamando
-- essas funções pela própria sessão autenticada.

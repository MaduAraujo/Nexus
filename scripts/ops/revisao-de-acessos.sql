SELECT e.name                                  AS nome,
       e.email,
       e.status                                AS status_vinculo,
       u.last_sign_in_at                       AS ultimo_login,
       u.created_at                            AS conta_criada_em,
       EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.id AND f.status = 'verified') AS mfa_verificado
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN employees e ON e.id = p.employee_id
 WHERE p.profile = 'Administrador'
 ORDER BY e.name;

SELECT p.profile                                AS perfil,
       e.name                                   AS nome,
       e.email,
       e.status                                 AS status_vinculo,
       e.termination_date                       AS desligado_em,
       u.last_sign_in_at                        AS ultimo_login,
       (u.banned_until IS NOT NULL AND u.banned_until > now()) AS conta_bloqueada
  FROM profiles p
  JOIN employees e ON e.id = p.employee_id
  JOIN auth.users u ON u.id = p.id
 WHERE e.status <> 'Ativo'
   AND NOT (u.banned_until IS NOT NULL AND u.banned_until > now())
 ORDER BY e.termination_date NULLS LAST;

SELECT e.name AS nome, e.email
  FROM profiles p
  JOIN employees e ON e.id = p.employee_id
 WHERE p.profile = 'Administrador'
   AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.id AND f.status = 'verified');

SELECT p.profile AS perfil, e.name AS nome, e.email, e.status AS status_vinculo, u.last_sign_in_at AS ultimo_login
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN employees e ON e.id = p.employee_id
 WHERE COALESCE(u.last_sign_in_at, u.created_at) < now() - interval '90 days'
 ORDER BY COALESCE(u.last_sign_in_at, u.created_at);

SELECT u.id, u.email, u.created_at, u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
 WHERE p.id IS NULL;

SELECT m.name AS gestor, m.email, m.status AS status_vinculo, count(e.id) AS pessoas_na_equipe
  FROM employees m
  JOIN employees e ON e.manager_id = m.id AND e.status = 'Ativo'
 GROUP BY m.id, m.name, m.email, m.status
 ORDER BY pessoas_na_equipe DESC;

SELECT e.name AS administrador, count(s.id) AS aparelhos, max(s.created_at) AS ultima_inscricao
  FROM admin_push_subscriptions s
  JOIN profiles p ON p.id = s.profile_id
  LEFT JOIN employees e ON e.id = p.employee_id
 GROUP BY e.name
 ORDER BY e.name;

SELECT accessed_by_email AS quem, tipo, count(*) AS acessos, min(created_at) AS primeiro, max(created_at) AS ultimo
  FROM data_access_log
 WHERE created_at > now() - interval '90 days'
 GROUP BY accessed_by_email, tipo
 ORDER BY acessos DESC;

SELECT kind, actor_id, detail, created_at
  FROM security_events
 WHERE kind IN ('data_export', 'file_download')
   AND created_at > now() - interval '90 days'
 ORDER BY created_at DESC
 LIMIT 200;

SELECT * FROM security_alerts WHERE created_at > now() - interval '90 days' ORDER BY created_at DESC;

SELECT c.relname AS tabela
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
 ORDER BY 1;

SELECT tablename, policyname, roles, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (trim(qual) IN ('true', '(true)') OR trim(with_check) IN ('true', '(true)'))
 ORDER BY 1, 2;

SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public'
 GROUP BY table_name
 ORDER BY 1;

SELECT p.proname AS funcao, p.prosecdef AS security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY 1;

SELECT item, aplicado
  FROM (VALUES
    ('060 colaborador só edita o próprio perfil (trigger)',  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'employees_self_update_guard_trg')),
    ('061 limite de requisições (rate_limit_check)',         to_regprocedure('public.rate_limit_check(text,integer,integer)') IS NOT NULL),
    ('062 dados pessoais cifrados (nascimento é TEXT)',      (SELECT data_type = 'text' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'birth_date')),
    ('063 MFA obrigatório (mfa_ok)',                         to_regprocedure('public.mfa_ok()') IS NOT NULL),
    ('064 holerites, feedback e IA cifrados (view)',         to_regclass('public.payslips_decrypted') IS NOT NULL),
    ('066 alertas de segurança',                             to_regclass('public.security_alerts') IS NOT NULL),
    ('067 rotação de chaves',                                to_regclass('public.nexus_key_config') IS NOT NULL),
    ('Vault tem data_encryption_key',                        (to_regclass('vault.decrypted_secrets') IS NOT NULL) AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'data_encryption_key')),
    ('Vault tem data_hmac_key',                              (to_regclass('vault.decrypted_secrets') IS NOT NULL) AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'data_hmac_key')),
    ('Limpeza diária de eventos agendada (pg_cron)',         to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-security-events'))
  ) AS t (item, aplicado);
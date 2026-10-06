# Segurança e Criptografia

Detalhes técnicos da proteção de dados do Nexus. O resumo está no [README](../README.md#segurança-e-criptografia).

## Em Trânsito e no Banco

**Em trânsito:** todo o tráfego usa HTTPS (Vercel e Supabase).

**Em repouso, no banco (criptografia em nível de coluna, AES-256 via `pgcrypto`)** — migration `059_column_encryption.sql`:

| Dado | Onde |
|---|---|
| CPF, RG, telefone, salário, chave PIX, agência e conta | `employees` |
| Data de nascimento, gênero, raça/cor, deficiência e tipo de pensão (dados pessoais sensíveis, LGPD art. 5º, II) | `employees` (migration 062) |
| Mensagens de canais e conversas diretas | `chat_messages.content` |
| Mensagens do atendimento com o RH | `hr_ticket_messages.content` |

Como funciona:

- **Escrita:** triggers cifram sozinhos. O código continua gravando texto normal em `employees`, `chat_messages` e `hr_ticket_messages`.
- **Leitura:** as tabelas devolvem texto cifrado. Para ler o valor, use as views **`employees_decrypted`**, **`chat_messages_decrypted`** e **`hr_ticket_messages_decrypted`**. Elas respeitam a RLS e só decifram para quem tem direito ao dado (RH e a própria pessoa em `employees`; membros em conversas; RH nunca em conversas diretas). O gestor enxerga a equipe, mas sem nenhum dos campos cifrados.
- **Amarração ao dono:** cada valor cifrado carrega o seu dono (`emp:<id>`, `chan:<id>`, `tkt:<id>`). Copiar o texto cifrado de uma linha para outra não revela nada, e a função de decifrar confere a autorização antes de abrir.
- **CPF único:** `cpf_hash` é um índice cego (HMAC-SHA256, com ou sem máscara) que garante unicidade sem guardar o CPF em claro.

**Chaves:** ficam no **Supabase Vault** (`data_encryption_key` e `data_hmac_key`), geradas pela própria migration. Nunca estão no código nem no navegador.

> ⚠️ **Guarde uma cópia das duas chaves fora do Supabase** (gerenciador de senhas do time) e faça backup do banco antes de aplicar a migration. Sem as chaves, os dados cifrados **não podem ser recuperados**. Para ler: `select name, decrypted_secret from vault.decrypted_secrets where name in ('data_encryption_key','data_hmac_key');`

**Aplicando em um banco existente:** veja a ordem e o que cada migration faz em [MIGRATIONS.md](MIGRATIONS.md).

**Regras para quem desenvolve:**

- Para **ler** CPF, RG, telefone, salário, PIX, agência, conta, nascimento, gênero, raça/cor, deficiência ou o conteúdo de mensagens, consulte a view `*_decrypted`. A tabela devolve texto cifrado.
- Depois de **adicionar coluna** em `employees`, rode `select nexus_refresh_employees_view();` (o teste `test-integration/column-encryption.js` falha se a view ficar desatualizada).
- Para cifrar **outra coluna**, siga o padrão de `employees_encrypt_sensitive()` na migration 059.

**Também cifrados** (migrations 064, 065 e 083): holerites (`payslips`), o histórico de edição (`employee_audit.changes`, lido pela view `employee_audit_decrypted`), feedback anônimo, as tabelas de histórico, cache, memória e log da IA do RH, os indicadores `pcd` e `pensao_alimenticia`, e os arquivos dos buckets `documents`, `message-attachments` e `ponto-selfies` (AES-256-GCM pela Edge Function `nexus-files`, chave mestra no segredo `FILES_ENCRYPTION_KEY`). A leitura segue o mesmo padrão das views `*_decrypted`.

**O que ainda NÃO é cifrado:** avatares (bucket privado desde a migration 110, aberto por link assinado, mas sem cifragem) e o número de dependentes. Nos dados cifrados em repouso, quem tem acesso administrativo ao banco **e** ao Vault enxerga tudo, porque a chave fica na mesma plataforma. Isso não vale para o que é cifrado de ponta a ponta (veja abaixo). A rotação das chaves existe para as colunas (migration 067) e para os arquivos (`scripts/rotate-file-key.mjs`, veja [EDGE-FUNCTIONS.md](EDGE-FUNCTIONS.md#trocar-a-chave-dos-arquivos)), as duas manuais.

## Criptografia de Ponta a Ponta (migration 085)

**O que é cifrado no navegador** (o servidor guarda só o conteúdo cifrado e nunca tem a chave): documentos do colaborador, atestados, anexos do banco de horas, selfies do ponto, as **mensagens diretas** e as mensagens dos **canais de grupo** do chat. Código em `src/javascript/shared/e2e-crypto.js` (WebCrypto), `e2e.js` (chaves e fluxos) e `e2e-ui.js` (janelas).

- **Chaves por pessoa:** cada usuário tem um par ECDH P-256 gerado no navegador. A chave privada vai ao banco (`e2e_keys`) só embrulhada pela senha (PBKDF2-SHA256, 600 mil iterações) e por uma **chave de recuperação** de 160 bits mostrada uma única vez no primeiro login. Depois do login, ela fica no IndexedDB como chave não exportável e é apagada ao sair.
- **Chave do RH:** um par da organização, entregue a cada administrador embrulhado com a chave pessoal dele (`e2e_org_key_grants`). Um administrador novo recebe acesso quando outro abre a tela Segurança.
- **Arquivos:** AES-256-GCM com chave aleatória por arquivo, embrulhada para o colaborador dono e para a chave do RH, no próprio cabeçalho do arquivo (formato `NXE1`). O envio vai direto ao Storage, com o RLS de sempre. Arquivos antigos seguem abrindo pela `nexus-files`, e o botão **Proteger arquivos antigos** (tela Segurança) os converte.
- **Mensagens diretas:** chave por conversa (`e2e_channel_keys`), embrulhada para os dois membros e versionada. Se um dos dois refaz as chaves, o outro recompartilha a conversa ao enviar a próxima mensagem.
- **Canais de grupo** (migration 086): chave por canal, embrulhada para cada membro que já tem chaves e para a chave do RH (o RH mantém a leitura prevista na política de compliance). Quem sai do canal força uma versão nova da chave e não lê o que vem depois. Quem entra ou cria chaves depois recebe a chave quando qualquer membro abre o canal.
- **Esqueceu a senha:** no login seguinte, a chave de recuperação reabre tudo e passa a valer a senha nova. Sem ela, a pessoa gera chaves novas: as conversas diretas antigas ficam ilegíveis, e os documentos voltam quando o RH usa "Proteger arquivos antigos".

**Continua visível para o servidor:** metadados (nome, tipo e dono do documento; quem conversa com quem e quando), cadastro, holerites e tudo que o sistema precisa processar (IA, alertas, folha, dashboard), que seguem cifrados em repouso com a chave do Vault. **Limite de todo E2E na web:** quem controla a hospedagem do front poderia publicar um JavaScript alterado; SRI, CSP e a revisão do código publicado reduzem, mas não eliminam, esse risco.

## Limitações e Desempenho

**Limitação conhecida da plataforma (Supabase, imagem `17.6.1.111`):** nessa versão, a extensão `supautils` derruba o Postgres quando `anon` ou `authenticated` chamam uma função sem permissão de execução (o código que monta a dica do erro, ligado por `supautils.hint_roles`, causa a falha de segmentação). Como a API expõe as funções do schema `public`, uma chamada a `/rest/v1/rpc/<função revogada>` reinicia o banco. Foi reproduzido localmente na mesma imagem, com PostgREST v12 e v14, e não acontece na `17.6.1.166`. A correção é atualizar o Postgres do projeto (no plano Free, pelo suporte do Supabase). O teste `test-integration/rpc-revogada-nao-derruba.js` confere esse comportamento. Ele fica fora do `npm run test:integration` enquanto o CI usar a imagem `17.6.1.111` e passa a fazer parte da suíte quando o projeto e o CI forem atualizados.

**Desempenho:** decifrar tem custo por linha; ler 200 colaboradores leva na ordem de décimos de segundo. Para volumes muito maiores, vale cachear a chave por consulta ou paginar as listas.

## Proteções contra Ataques

| Ameaça | Proteção |
|---|---|
| Colaborador alterar o próprio salário, cargo, status ou gestor | Migration `060`: policy de UPDATE só na própria linha **e** trigger que recusa qualquer coluna fora de nome, telefone, bio, avatar, preferências e último acesso. Vale também para colunas criadas no futuro. |
| XSS (código injetado por nome, mensagem, arquivo etc.) | Todo texto de usuário em HTML passa por `escapeHtml()` (`src/javascript/shared/html.js`). O teste `test/xss-guard.test.js` varre o código com um analisador de AST e **falha** se alguém interpolar texto de usuário sem escapar. Conteúdo HTML externo (markdown da IA, comunicados) passa por sanitizador com lista de permissões e parser inerte. |
| Execução de script externo / vazamento de dados | `vercel.json`: Content-Security-Policy (só as origens usadas; `connect-src` limitado ao Supabase, ViaCEP e CDNs), `frame-ancestors 'none'`, HSTS, `nosniff`, `Permissions-Policy` e COOP. |
| CDN comprometido (supply chain) | Todas as bibliotecas externas têm **versão fixa e SRI** (`integrity`). Para atualizar uma, gere o novo hash (`openssl dgst -sha384 -binary arquivo | openssl base64 -A`). |
| Senhas fracas | Mínimo de 12 caracteres, com letras e números, no app e em `supabase/config.toml`. **No projeto hospedado, ajuste o mesmo no painel** (Authentication → Sign In / Providers → Email). |
| Abuso e custo das funções de IA | Migration `061`: `rate_limit_check` limita por usuário (ai-alerts: 30/h; ai-employee-chat: 60/h). |
| Dependências vulneráveis | `npm audit --audit-level=high` no CI e Dependabot semanal. |
| Funções internas chamáveis por anônimo | Migrations `068` e `096`: retiram o `EXECUTE` de anônimos das funções internas; `kudos` e `onboarding_tasks` deixam de ser legíveis sem login. A `097` devolve o acesso só a `is_rh`, `my_employee_id`, `chat_is_member` e `chat_channel_is_dm`, usadas dentro das políticas de RLS (para quem não fez login elas devolvem "não" ou vazio), e `report_login_failure` segue aberta porque registra falhas antes do login. |
| Fraude no ponto (foto de outra pessoa, vídeo gravado) | Migration `092`: o modelo facial fica em `biometric_templates`, cifrado e sem acesso pela API; a comparação é feita no banco (`biometric_verify`), que recusa o mesmo vetor reenviado. No app há prova de vida (piscar) e consentimento explícito (LGPD art. 11). |
| Ex-colaborador continuar entrando | Migration `099`: `my_employee_id()` e `is_rh()` deixam de reconhecer quem está `Inativo` ou `Bloqueado`, então todas as políticas de RLS param de liberar dados para essa pessoa de uma vez. O login e as telas avisam "conta desativada" (`conta_desativada()`), e as inscrições de push são apagadas no desligamento. |
| Apagar provas (documentos, atendimentos) | Migration `091`: documento aprovado só sai por `soft_delete_documents` com motivo e respeitando o prazo de guarda; mensagens e chamados de atendimento não podem ser apagados, só ocultados. |

**Se o projeto Supabase mudar**, atualize o domínio em `connect-src` e `img-src` do `vercel.json`.

**Sem `'unsafe-inline'` em `script-src`:** o app não usa mais `onclick=`/`<script>` inline. Os manipuladores são atributos `data-click`, `data-change`, `data-input`, `data-keydown` e `data-keyup` (com `-args`, veja `src/javascript/shared/events.js`), ligados por listeners. Em templates JS use `data-click="fn" data-click-args="${dargs(id)}"`; nunca escreva `onclick=` (o teste `test/csp-inline.test.js` falha). O dispatcher só chama funções globais declaradas pelo app (não nativas), então markup injetado com `data-click="eval"` não executa código. Janelas de impressão usam `printWhenLoaded(win)` em vez de `<script>` inline.

**Sem `'unsafe-inline'` em `style-src`:** nenhum HTML ou template usa `style=`, `<style>` ou `setAttribute('style')` (o mesmo teste falha). Estilo fixo vai para classe CSS. Valor dinâmico usa um atributo de lista fechada, aplicado por `src/javascript/shared/dynamic-style.js` via `el.style`: `data-bg`/`data-color` (só cor), `data-w` (largura em %), `data-x`/`data-y` (px), `data-delay` (s), `data-bg-img` (só `https:`, `blob:` ou `data:image`) e `data-hide` (começa escondido e depois se comporta como `style.display = 'none'`). Janelas de impressão usam um `.css` próprio via `<link>`, e a orientação do holerite usa uma folha construída (`adoptedStyleSheets`).

**Limites conhecidos:** o CSS do Google Fonts não tem SRI (o Google serve um CSS diferente por navegador). A proteção contra senhas vazadas do Supabase (consulta ao HaveIBeenPwned) só existe no plano Pro; no plano Free o Security Advisor mostra esse aviso, e a compensação é a senha mínima de 12 caracteres, o MFA obrigatório para o RH, o limite de tentativas e o alerta de falhas de login em série. O Security Advisor também lista as funções `SECURITY DEFINER` chamáveis por usuários logados: são as RPCs do próprio app, e cada uma confere internamente o papel de quem chama. **MFA (TOTP):** obrigatório para o RH e opcional para o colaborador (`src/javascript/shared/mfa.js`, migration 063). Ao ativar, a pessoa recebe 10 códigos de recuperação (só o hash bcrypt fica no banco, migration 084). Se perder o celular, um código na tela de login desvincula o app e gera um alerta crítico para o RH; o RH então cadastra o celular novo na ativação obrigatória. **Alertas de comportamento anormal** (migration 066): falhas de login em série, login logo após falhas, exportação ou download em massa e acesso do RH fora do horário comercial, exibidos na tela Segurança.

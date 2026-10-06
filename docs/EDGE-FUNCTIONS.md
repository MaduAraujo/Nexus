# Edge Functions

As Edge Functions ficam em `supabase/functions/` e rodam no Supabase (TypeScript em Deno). A publicação básica está no passo 4 do [Guia de Instalação](../README.md#4-configurar-as-edge-functions), e as chaves estão em [Variáveis de Ambiente](../README.md#variáveis-de-ambiente).

## O que cada função faz

| Função | Para que serve | Chaves que usa |
|---|---|---|
| `nexus-files` | Cifra e decifra os arquivos do Storage (documentos, anexos de ponto e de chat, selfies). **Obrigatória:** sem ela nenhum upload nem abertura de arquivo funciona | `FILES_ENCRYPTION_KEY` |
| `invite-employee` | Envia o convite por e-mail quando o RH cadastra um colaborador, ou o link de nova senha se o e-mail já tiver conta | nenhuma |
| `ai-alerts` | Analisa os dados da equipe e gera os alertas de burnout e compliance da Central de Alertas | `GROQ_API_KEY` |
| `ai-employee-chat` | Assistente de IA que responde às dúvidas do colaborador sobre os próprios dados | `GROQ_API_KEY` |
| `mfa-recover` | Recebe o código de recuperação do MFA, confere no banco (uso único, até 5 tentativas a cada 15 min) e desvincula o aplicativo autenticador | nenhuma |
| `send-push` | Envia push quando o RH publica um comunicado imediato (não agendado) | VAPID, horário comercial |
| `send-alert-push` | Envia push dos alertas de compliance e burnout; chamada pelo banco | VAPID, horário comercial |
| `send-document-push` | Avisa o colaborador quando o RH entrega um documento (contrato, termos, políticas), respeitando a preferência "Documentos do RH" em Meu Perfil | VAPID, horário comercial |
| `send-chat-push` | Avisa quem recebe mensagem no chat e o RH quando um colaborador pede atendimento, respeitando a preferência "Mensagens do chat" em Meu Perfil; chamada por triggers da migration `113` | VAPID, horário comercial |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são entregues pelo Supabase a todas as funções e não precisam ser configuradas.

Depois de publicar, confira no painel do Supabase (**Edge Functions**) que as nove aparecem. Uma função ausente responde 404 ao front.

## Notificações push

- As funções de push só enviam em horário comercial (padrão das 8h às 18h, ajustável por `QUIET_HOURS_START_HOUR` e `QUIET_HOURS_END_HOUR`), por causa do direito à desconexão. Fora dele, o comunicado fica para o próximo horário comercial e o aviso de documento aparece só na tela inicial do colaborador.
- O push do chat nunca leva o conteúdo da mensagem, que pode estar cifrado de ponta a ponta. Em canais com várias pessoas, só a primeira mensagem não lida avisa; as seguintes aparecem no contador do menu.
- A chave pública VAPID precisa estar também em `VAPID_PUBLIC_KEY`, no topo de `src/javascript/perfil-colaborador.js`, porque o navegador usa essa chave para se inscrever. Mantenha as duas iguais. Se estiverem diferentes, o botão "Notificações push do navegador" em Meu Perfil continua aparecendo, mas o envio falha e o erro fica só no log da `send-push`.

## Vault: avisos que saem do banco

Os comunicados adiados para o horário comercial, os alertas de compliance e burnout e o push do chat são disparados pelo próprio banco, por `pg_cron` e triggers (`dispatch_deferred_pushes()`, `notify_alert_push()` e os triggers da `113`). Como não há um usuário logado nessas chamadas, o banco lê a URL do projeto e a `service_role key` do **Vault do Postgres**, que é diferente dos `supabase secrets` das funções.

Rode uma única vez no SQL Editor (a URL e a `service_role key` ficam em **Project Settings → API**):

```sql
select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'service_role_key');
```

Sem esses valores, nenhum aviso automático sai. As funções não dão erro: só registram um `RAISE WARNING`, visível em **Logs → Postgres** no painel do Supabase.

**Para conferir ou atualizar:**

```sql
select id, name from vault.secrets where name in ('project_url', 'service_role_key');
select vault.update_secret('ID_DO_SECRET', 'NOVO_VALOR');
```

Não rode `create_secret` de novo para um nome que já existe. Isso cria um registro duplicado, e as funções podem passar a ler o valor errado sem avisar.

## Trocar a Chave dos Arquivos

Cada arquivo guarda no cabeçalho o identificador da chave que o cifrou. Sem as variáveis abaixo, a chave atual vale como `v1`.

1. Ative a chave nova, mantenha a antiga só para leitura e republique a `nexus-files`:

   ```bash
   npx supabase secrets set FILES_ENCRYPTION_KEY=$(openssl rand -base64 32) FILES_ENCRYPTION_KEY_ID=v2 FILES_ENCRYPTION_OLD_KEYS=v1:CHAVE_ANTIGA
   npx supabase functions deploy nexus-files
   ```

2. Recifre o que já está no Storage. O script precisa das mesmas três variáveis, mais `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, no ambiente do terminal:

   ```bash
   node scripts/rotate-file-key.mjs --dry-run
   node scripts/rotate-file-key.mjs
   ```

3. Quando o script disser que nada depende mais da chave antiga, tire-a de `FILES_ENCRYPTION_OLD_KEYS`.

Guarde sempre uma cópia da chave atual fora do Supabase: sem ela, os arquivos cifrados são irrecuperáveis.

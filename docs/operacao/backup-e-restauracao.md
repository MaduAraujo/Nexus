# Backup e restauração

Versão 1.0, 2026-09-20. Complementa `plano-resposta-incidentes.md` (playbook P7) e o RIPD (risco R7).

## 1. O que foi provado e o que não foi

| Afirmação | Situação | Evidência |
|---|---|---|
| Nossa cópia própria do banco sai **cifrada** (AES-256, integridade verificada, frase fora do arquivo) | **Provado** | `docs/operacao/evidencias/restore-drill-*.md`, verificações 5–12; `test/backup-lib.test.js` |
| Essa cópia **restaura** num banco novo, com tabelas, RLS, gatilhos e dados cifrados idênticos | **Provado** (dados sintéticos, Postgres local) | mesmo relatório, verificações 13–22 |
| Sem as chaves do Vault, o banco restaurado abre mas os campos cifrados vêm vazios, **sem erro** | **Provado** | verificação 19 |
| Os backups **automáticos do Supabase** são cifrados | **Não verificado.** A [página de segurança do Supabase](https://supabase.com/security) afirma que discos e backups agendados ficam cifrados em repouso com AES-256 e que os backups trafegam cifrados; a [documentação de backups](https://supabase.com/docs/guides/platform/backups) não trata do assunto. Não há como inspecionar isso de dentro do projeto | ver seção 6 (como confirmar) |
| A restauração **pelo painel do Supabase** funciona no nosso projeto | **Não testado** (é do provedor e exige janela de indisponibilidade) | ver seção 7 |
| Arquivos do Storage têm backup | **Não** (não implementado; ver seção 4) | — |

## 2. Camadas

1. **Backup do provedor (Supabase).** Diário; no plano Pro guarda os últimos 7 dias, no Team 14 e no Enterprise 30 (conforme a documentação). Point-in-Time Recovery é um adicional pago. Restaurar pelo painel deixa o projeto **indisponível** durante o processo. Não inclui os objetos do Storage nem as senhas de papéis personalizados.
2. **Cópia própria cifrada** (`scripts/backup/backup-db.mjs`). Protege contra perder o projeto inteiro (conta suspensa, exclusão acidental, incidente no provedor). É o que este repositório prova e ensaia.
3. **Chaves e segredos**, guardados **fora** do Supabase e fora do backup (seção 3).

## 3. Chaves: sem elas o backup não serve para nada

O banco cifra colunas sensíveis (CPF, holerite, feedback, histórico da IA etc.) com chaves que ficam no **Vault do Supabase**. Segundo a [documentação do Vault](https://supabase.com/docs/guides/database/vault), a chave-raiz nunca fica no banco, e num projeto **novo** restaurado com `pg_dump`/`pg_restore` o Vault nasce com chave própria e **não consegue decifrar** os segredos antigos. Por isso o backup de dados **exclui** `nexus_key_store` (a tabela de reserva) e nada do Vault entra nele.

**Guardar num cofre de senhas da equipe (fora do Supabase, fora do Git), com pelo menos duas pessoas com acesso:**

| Segredo | Onde está | Como copiar |
|---|---|---|
| `data_encryption_key` e todas as `data_encryption_key_<kid>` (rotação, migration 067) | Vault | SQL Editor: `select name, decrypted_secret from vault.decrypted_secrets where name like 'data\_%' order by name;` |
| `data_hmac_key` e `data_hmac_key_<kid>` | Vault | idem. Sem a chave de HMAC, a busca por CPF (`cpf_hash`) para de funcionar |
| `FILES_ENCRYPTION_KEY` | Segredo da Edge Function `nexus-files` | Você a definiu; `supabase secrets list` não mostra o valor: precisa estar no cofre desde a criação |
| `GROQ_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Segredos das Edge Functions | Idem (recriáveis, mas VAPID novo invalida as inscrições de push) |
| Frase-secreta do backup (`BACKUP_PASSPHRASE_FILE`) | Só com quem executa o backup | **Em local diferente do backup.** Backup e frase juntos anulam a cifra |

**Todas** as chaves antigas (v1, v2...) precisam ser guardadas enquanto existir dado cifrado com elas. `nexus_key_status()` mostra quantos valores ainda usam cada chave.

Conferência trimestral: recuperar cada segredo do cofre e testar que abre (por exemplo, restaurar o último backup no exercício e ver os dados legíveis).

## 4. Fazer o backup (cópia própria)

Requisitos: Node 20+, `gpg` (GnuPG) e Docker **ou** `pg_dump` 17 instalado.

```bash
# 1. Frase-secreta longa, guardada no cofre; o arquivo fica FORA do repositório
openssl rand -base64 48 > ~/segredos/nexus-backup-frase.txt

# 2. String de conexão do Supabase (Settings → Database → Connection string, modo "Session pooler" ou direto)
export BACKUP_DB_URL='postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres'
export BACKUP_PASSPHRASE_FILE=~/segredos/nexus-backup-frase.txt

# 3. Gera backups/nexus-db-<data>.dump.gpg (+ .sha256). O texto claro nunca vai a disco.
node scripts/backup/backup-db.mjs --out ~/backups-nexus
```

- **O que entra:** schemas `public` e `auth` (usuários, identidades, fatores de MFA). **O que fica de fora:** chaves (`nexus_key_store`), sessões, tokens de refresh, logs de auditoria do Auth, migrations internas do Auth.
- **Quando:** semanal, e **sempre antes de aplicar uma migration** ou mexer em chaves. Registre a data.
- **Onde guardar:** em conta/armazenamento diferente do projeto Supabase e do repositório; cifrado como está. Retenção proposta: 30 dias de cópias semanais. Copie o `.sha256` junto e confira depois.
- **Storage (arquivos):** o backup do banco **não** contém os arquivos. Eles já estão cifrados (`nexus-files`), então copiá-los para outro local não expõe conteúdo. **Ainda não existe rotina para isso**; enquanto não existir, uma perda do Storage é perda definitiva. Lacuna registrada no RIPD (R7).

## 5. Restaurar

Cenário: o projeto foi perdido ou corrompido e é preciso subir um novo. Tempo medido no exercício com dados sintéticos: **23 s do banco novo ao banco verificado** (com dados reais, meça no primeiro exercício de verdade: é o seu RTO).

1. **Criar um projeto Supabase novo**, na mesma região. A URL e a chave `anon` mudam: atualizar `src/javascript/shared/supabase-client.js` e a CSP no `vercel.json`.
2. **Painel:** habilitar TOTP (Authentication → MFA) antes de publicar; configurar a política de senha.
3. **Recolocar as chaves no Vault do projeto novo**, uma a uma, com os **mesmos nomes**:
   ```sql
   select vault.create_secret('<valor do cofre>', 'data_encryption_key');
   select vault.create_secret('<valor do cofre>', 'data_hmac_key');
   -- e as de rotação, se existirem: data_encryption_key_v2 ...
   ```
4. **Restaurar os dados** a partir da cópia cifrada (o gpg pede a frase-secreta pelo arquivo):
   ```bash
   # usuários primeiro (o public referencia auth.users)
   gpg --batch --pinentry-mode loopback --passphrase-file FRASE --decrypt nexus-db-XXXX.dump.gpg \
     | pg_restore -d "$NOVA_URL" --no-owner --no-privileges --schema=auth --data-only --disable-triggers
   gpg --batch --pinentry-mode loopback --passphrase-file FRASE --decrypt nexus-db-XXXX.dump.gpg \
     | pg_restore -d "$NOVA_URL" --no-owner --no-privileges --schema=public
   ```
   No exercício, o passo de `auth` rodou com o superusuário do container (`supabase_admin`). **No Supabase hospedado esse papel não existe para nós**: use o papel `postgres` (a documentação do Supabase sobre migrar dados entre projetos descreve o procedimento) e, se `--disable-triggers` for recusado, remova-o. Esta parte **não foi testada no Supabase real**.
5. **Redeployar as Edge Functions e os segredos** (`GROQ_API_KEY`, `VAPID_*`, `FILES_ENCRYPTION_KEY`) e o front.
6. **Recolocar os arquivos do Storage**, se houver cópia.
7. **Verificar** (mesmo critério do exercício): contagem de linhas por tabela; o RH faz login com MFA; abrir um holerite e um perfil (dados legíveis, não vazios); um colaborador vê só o que é dele; buscar um colaborador por CPF.
8. Se os campos cifrados aparecem **vazios** sem erro: falta uma chave do Vault (ou o nome está errado). Não escreva nada no banco até corrigir: gravar por cima com chave errada cifra os dados novos com a chave errada.

## 6. Como confirmar que os backups do Supabase são cifrados

Não dá para provar de dentro do projeto. O caminho de evidência é documental; faça e guarde o resultado em `docs/operacao/evidencias/backup-criptografia-supabase-AAAA-MM-DD.md`:

1. No painel: Database → Backups. Anotar plano, quantidade de backups diários disponíveis e se PITR está ligado (print com data).
2. **Pedir por escrito ao suporte do Supabase** (projeto, plano): "Confirmem que os backups diários, os arquivos WAL do PITR e os snapshots são cifrados em repouso, com qual algoritmo e onde ficam as chaves". Anexar a resposta.
3. Se o plano for Team ou Enterprise: baixar o relatório **SOC 2 Tipo 2** (Organization → Legal Documents) e anotar a seção de criptografia em repouso e a data do relatório.
4. Citar a [página de segurança](https://supabase.com/security) com a data em que foi lida.
5. Registrar a conclusão: "cifrado conforme [documento], em [data], confirmado por [suporte/SOC 2]". Sem 2 ou 3, o registro deve dizer "declaração pública, sem confirmação específica do projeto".

## 7. Ensaios

| Ensaio | Frequência | Como | O que prova |
|---|---|---|---|
| **Exercício automatizado** | Todo mês (GitHub Actions `restore-drill.yml`) e antes de mudar o script de backup | `node scripts/backup/restore-drill.mjs` (precisa de Docker e gpg; ~1 min) | O procedimento e a cifra funcionam; RLS e dados cifrados sobrevivem; efeito da falta de chaves |
| **Restauração real de um backup do provedor** | Trimestral | Restaurar o backup diário mais recente para um **projeto novo/temporário** (nunca sobre o de produção), conferir os itens da etapa 7, apagar o projeto temporário | O backup do provedor existe, restaura e as chaves do cofre abrem os dados. Registrar tempo, data e quem fez em `evidencias/restauracao-real-AAAA-MM-DD.md` |
| **Cópia própria com dado real** | Semestral | Rodar a etapa 4 do backup e a etapa 5 num projeto temporário | O caminho da seção 4/5 funciona com o volume real e no Supabase real (o exercício automatizado é local) |

Gatilhos extras: mudança de versão do Postgres no Supabase, nova migration que crie objetos fora de `public`, troca ou rotação de chave.

## 8. Lacunas conhecidas

- Sem backup automático do Storage.
- A cópia própria é manual (ou agendada por quem executar); nada roda sozinho contra o projeto real (exigiria guardar `BACKUP_DB_URL` como segredo de CI, decisão da equipe).
- Restauração do `auth` no Supabase hospedado não testada.
- RPO (quanto de dado se aceita perder) não definido: com backup semanal seria de até 7 dias na cópia própria; o backup diário do provedor melhora isso para 24 h.

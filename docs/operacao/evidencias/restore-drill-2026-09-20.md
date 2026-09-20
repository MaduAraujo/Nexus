# Exercício de restauração — 2026-09-20

Resultado: **APROVADO** (22/22 verificações concluídas)

- Ambiente: containers Docker descartáveis, imagem `public.ecr.aws/supabase/postgres:17.6.1.111` (a mesma do job rls-integration do CI)
- Dados: sintéticos, gerados pelo próprio exercício (nenhum dado real)
- Duração total: 73.8 s; do banco novo ao banco verificado: 27.2 s
- Arquivo de backup: 273853 bytes, SHA-256 `a58b399c89ebf728dd5031a5230ca12023ab396079c32d67c8a246bb0ccb349a`

| # | Verificação | Resultado | Detalhe | s |
|---|---|---|---|---|
| 1 | Postgres de origem no ar | OK | porta 64612 | 35.8 |
| 2 | schema.sql carregado | OK | 17 avisos de erro esperados (storage.* não existe neste ambiente) | 3.1 |
| 3 | Chaves de cifragem copiadas da origem (a "cópia offline") | OK | estavam no Vault do banco | 0.1 |
| 4 | Dados sintéticos gravados e legíveis pelo RH | OK | 3 colaboradores | 0.1 |
| 5 | Backup cifrado gerado | OK | 273853 bytes, sha256 a58b399c89ebf728… | 1.7 |
| 6 | Arquivo é gpg simétrico AES-256 com proteção de integridade | OK | simétrico=true aes256=true integridade=true | 2.6 |
| 7 | Nenhum dado pessoal legível dentro do arquivo | OK | 4 textos sentinela procurados, 0 achados | 0 |
| 8 | Controle positivo: o mesmo conteúdo em texto puro deixa o nome legível | OK | prova que a busca acima consegue enxergar o texto se ele estivesse lá | 0.7 |
| 9 | Chave de cifragem de colunas não vai dentro do backup | OK | procurada no dump em texto puro, onde ela apareceria se estivesse no banco | 0.4 |
| 10 | Frase-secreta errada é recusada | OK |  | 0.5 |
| 11 | Arquivo adulterado é detectado (integridade) | OK |  | 0.5 |
| 12 | SHA-256 registrado confere com o arquivo | OK |  | 0 |
| 13 | Banco de origem destruído (simula a perda do projeto) | OK |  | 1.1 |
| 14 | Banco novo no ar (equivale a um projeto Supabase recém-criado) | OK | porta 56302 | 22 |
| 15 | pg_restore executado a partir do arquivo decifrado em fluxo | OK | 0 linhas de erro/aviso | 3.3 |
| 16 | Contagem de linhas idêntica em todas as tabelas | OK | 43 tabelas | 1.3 |
| 17 | Políticas RLS, gatilhos, funções e views restaurados | OK | {"policies":137,"triggers":13,"functions":68,"views":11,"tables_with_rls":44} | 0 |
| 18 | Dados cifrados voltaram byte a byte iguais | OK |  | 0 |
| 19 | SEM as chaves: o banco restaurado abre, mas os campos cifrados vêm vazios (NULL) | OK | é exatamente o que acontece se restaurar sem recolocar as chaves do Vault | 0.1 |
| 20 | COM as chaves recolocadas: tudo legível e idêntico ao original | OK | 3 colaboradores, 2 holerites | 0.2 |
| 21 | RLS continua valendo após a restauração (colaborador vê só o que é dele) | OK | vê 1 holerite(s) | 0.2 |
| 22 | Índice cego do CPF funciona (chave HMAC restaurada) | OK |  | 0.1 |

## O que este exercício prova e o que não prova

- Prova: o procedimento (`backup-db.mjs` → arquivo AES-256 → `pg_restore` num banco novo) funciona, o arquivo não contém dado legível nem as chaves de cifragem, adulteração e frase errada são recusadas, e a restauração recompõe tabelas, RLS, gatilhos e dados cifrados.
- Prova: sem recolocar as chaves do Vault, os campos cifrados voltam **NULL sem erro** — o sintoma silencioso a reconhecer numa restauração real.
- **Não prova** que os backups automáticos do Supabase estão cifrados nem que a restauração pelo painel funciona: isso é feito pelo provedor e precisa ser conferido no projeto real (ver `docs/operacao/backup-e-restauracao.md`).
- Não cobre Storage (arquivos), Edge Functions e segredos da Groq/VAPID: o banco não os contém.


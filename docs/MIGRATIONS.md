# Migrations do Banco

As alterações do banco ficam em `supabase/migrations/`, numeradas na ordem em que devem ser aplicadas. O resumo do projeto está no [README](../README.md).

## Projeto novo ou banco existente

- **Projeto novo:** carregue só o `supabase/schema.sql`. Ele já traz o resultado de todas as migrations (veja o passo 3 do [Guia de Instalação](../README.md#3-aplicar-o-schema-do-banco)).
- **Banco existente:** rode as migrations em ordem, a partir da `057` até a mais recente. As anteriores criam a estrutura base e já estão em qualquer banco que tenha rodado o sistema.

Antes de aplicar uma migration que cifra dados, faça backup do banco e guarde uma cópia das chaves do Vault fora do Supabase (veja [SEGURANCA.md](SEGURANCA.md)).

## Ordem de publicação

Para não travar o RH durante a atualização:

1. Habilite o TOTP no painel do Supabase (**Authentication → MFA**) e publique o front **antes** da `063`.
2. Publique o front e as Edge Functions **junto** com a `064` e a `065`, porque o front antigo lê as tabelas sem cifragem.
3. Aplique a `110` **antes** de publicar o front que usa a ciência dos comunicados e os avatares privados.

## O que as principais migrations fazem

| Migration | O que faz |
|---|---|
| `059` | Cifra CPF, RG, telefone, salário, PIX, agência e conta, e as mensagens do chat e do atendimento |
| `060` | Restringe o que o colaborador pode editar no próprio cadastro |
| `061` | Cria o limite de chamadas das funções de IA |
| `062` | Cifra os dados pessoais sensíveis (nascimento, gênero, raça/cor, deficiência e tipo de pensão) |
| `063` | Exige MFA para o RH |
| `064` | Cifra holerites, feedback anônimo e os dados da IA do RH (exige a `059` e a `062` antes) |
| `065` | Libera os buckets do Storage para arquivos cifrados |
| `066` | Cria os alertas de comportamento anormal |
| `067` | Permite trocar as chaves de cifragem das colunas |
| `068` | Fecha leituras e execuções que estavam abertas a anônimos |
| `082` | Faz as funções de RPC exigirem o segundo fator de quem tem MFA |
| `083` | Cifra o histórico de edição do cadastro |
| `084` | Cria os códigos de recuperação do MFA |
| `085` | Cria as tabelas de chaves da criptografia de ponta a ponta |
| `086` | Estende as chaves de ponta a ponta aos canais de grupo |
| `087` e `088` | Guardam o certificado do treinamento e exigem anexo no atestado |
| `089` | Impede excluir colaborador que tenha holerite, ponto ou documento (prazo legal de guarda) |
| `090` | Cria o bucket de documentos |
| `091` | Leva para o banco as regras de folha, guarda de documentos e atendimentos |
| `092` | Isola a biometria facial |
| `093` | Cria o recibo de férias com abono |
| `094` | Otimiza as políticas de RLS |
| `095` | Leva para o banco as regras de férias |
| `096` e `097` | Fecham para anônimos as funções que não precisam ser públicas e reabrem só as quatro usadas pelas políticas de acesso |
| `098` | Cria os índices das chaves estrangeiras |
| `099` | Tira todo o acesso de quem foi desligado |
| `100` e `102` | Tiram do PJ as regras da CLT (férias e processos disciplinares) |
| `101` | Aplica a Lei do Aprendiz |
| `103` | Aplica a Lei do Estágio (TCE, limite de 2 anos, carga horária, supervisor e recesso) |
| `104` | Trata o contrato temporário e o de prazo determinado |
| `105` | Leva para o banco os adicionais de periculosidade e insalubridade e a estabilidade |
| `106` | Guarda a pensão alimentícia (cifrada), cria as convenções coletivas com piso salarial e barra a dispensa sem justa causa durante a estabilidade |
| `107` | Mostra ao gestor as avaliações do estagiário |
| `108` | Impede alterar holerite já pago, grava o ponto feito sem internet no horário do aparelho (sem aceitar horário futuro, de outro dia ou sobrescrever marcação) e protege os débitos de banco de horas lançados pela folha |
| `109` | Faz a versão nova de um documento desmarcar a anterior na mesma gravação |
| `110` | Cria a ciência dos comunicados e a retenção de 5 anos dos atendimentos, e torna privado o bucket de avatares |
| `111` e `112` | Incluem na publicação do Realtime todas as tabelas que o front acompanha |
| `113` | Cria o contador de mensagens não lidas do chat e os triggers do push de mensagens |

## Criando uma migration nova

1. Crie o arquivo em `supabase/migrations/` com o próximo número da sequência e um nome curto em inglês, como `114_nome_da_mudanca.sql`.
2. Reflita a mesma mudança em `supabase/schema.sql`, para que um projeto novo continue nascendo completo.
3. Se adicionar coluna em `employees`, rode `select nexus_refresh_employees_view();` (o teste `test-integration/column-encryption.js` falha se a view ficar desatualizada).
4. Acrescente a migration nesta tabela.

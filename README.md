<div align="center">

# Nexus

### Software de Recursos Humanos

[![Licença](https://img.shields.io/badge/licença-todos%20os%20direitos%20reservados-lightgrey?style=flat-square)](LICENSE)

**[→ Acessar o Nexus](https://nexus-nine-zeta.vercel.app)**

</div>

---

## Índice

- [Sobre o Projeto](#sobre-o-projeto)
- [Painel do RH](#painel-do-rh)
- [Portal do Colaborador](#portal-do-colaborador)
- [Inteligência Artificial](#inteligência-artificial)
- [Arquitetura e Tecnologias](#arquitetura-e-tecnologias)
- [Requisitos](#requisitos)
- [Modelagem](#modelagem)
- [Base Legal e Normas](#base-legal-e-normas)
- [Guia de Instalação](#guia-de-instalação)
- [Instruções de Uso](#instruções-de-uso)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Segurança e Criptografia](#segurança-e-criptografia)
- [Privacidade (LGPD) e Operação](#privacidade-lgpd-e-operação)
- [Limitações e Trabalhos Futuros](#limitações-e-trabalhos-futuros)
- [Governança e Autoria](#governança-e-autoria)

---

## Sobre o Projeto

A palavra **Nexus** significa "conexão" ou "ponto de junção". O sistema atua como o elo central que une dados, processos e talentos, cobrindo todo o ciclo de vida do colaborador — da admissão (*onboarding*) ao desligamento (*offboarding*).

O Nexus resolve os gargalos do ciclo de vida do funcionário contratado através de dois ambientes espelhados e em tempo real: um **Painel do RH** para gestão completa e um **Portal do Colaborador**.

O projeto foi desenvolvido como Trabalho de Conclusão de Curso (TCC), com o objetivo de mostrar como um sistema web pode substituir planilhas, registro de ponto em dispositivos físicos e pastas compartilhadas na rotina do RH, aplicando as regras da legislação trabalhista e da LGPD no próprio sistema.

> **Nota de Escopo:** o Nexus é focado inteiramente na jornada do colaborador ativo. Ele não possui módulos de recrutamento e seleção nem suporte a múltiplas empresas na mesma conta.

### Demonstração

<p align="center">
  <img src="README/portal%20rh.png" alt="Painel do RH com os atalhos de acesso rápido" width="900">
  <br><em>Painel do RH</em>
</p>

<p align="center">
  <img src="README/portal%20colaborador.png" alt="Painel do colaborador com dados do cargo e atalhos de acesso rápido" width="900">
  <br><em>Portal do colaborador</em>
</p>

<p align="center">
  <img src="README/chat%20IA.png" alt="Central de Alertas com o Assistente RH" width="900">
  <br><em>Central de Alertas com o assistente de IA</em>
</p>

---

## Painel do RH

| Módulo | Descrição |
|---|---|
| **Painel** | Tela inicial com calendário e acesso rápido a todos os módulos |
| **Dashboard** | Indicadores da equipe em tempo real, incluindo horas de treinamento e taxa de promoção |
| **Colaboradores** | Cadastro com checklist de documentos por tipo de contrato, convite por e-mail, catálogo de cargos e salários, cadastro de departamentos com responsável, treinamentos, processos disciplinares, atestados e consulta às avaliações de desempenho |
| **Gestão de Horas** | Aprovação de registros de ponto, ajustes e banco de horas |
| **Férias** | Solicitações com fluxo de aprovação, férias coletivas, abono pecuniário e recibo de férias |
| **Pagamentos** | Folha mensal com faltas e DSR, INSS e IRRF, adicionais, hora extra do banco de horas, pensão alimentícia, 13º salário, recibo de férias e rescisão, com regras próprias para CLT, aprendiz, estágio, temporário, prazo determinado e PJ |
| **Comunicação Interna** | Comunicados (com aviso enviado só no expediente de cada colaborador e ciência obrigatória nos urgentes e de política) e chat com a equipe |
| **Atendimento ao Colaborador** | Chamados abertos pelos colaboradores, com avaliação do atendimento |
| **Arquivos** | Documentos por colaborador, com guarda legal (documento aprovado não pode ser apagado antes do prazo) |
| **Central de Alertas** | Detecção de risco de burnout e de prazos de compliance com inteligência artificial |
| **Segurança** | Alertas de comportamento anormal, chaves de criptografia de ponta a ponta e proteção de arquivos antigos |

---

## Portal do Colaborador

Cada colaborador tem um espaço personalizado com seus dados de cargo, departamento e data de admissão.

| Módulo | Descrição |
|---|---|
| **Painel** | Tela inicial com sino de avisos (comunicados não lidos) e alerta de documentos do RH para assinar |
| **Ponto** | Registro com selfie e reconhecimento facial com prova de vida, funcionamento offline e pedidos de ajuste |
| **Férias** | Saldo, solicitações, venda de 10 dias (abono) e status de cada pedido |
| **Holerites** | Histórico de contracheques e recibos de férias, com assinatura eletrônica e informe de rendimentos |
| **Documentos** | Envio das pendências do checklist e documentos entregues pelo RH, cifrados de ponta a ponta |
| **Comunicados** | Comunicados da empresa com controle de leitura e confirmação de ciência |
| **Meu Desempenho** | Avaliações concluídas, metas do PDI, treinamentos (inclusive cursos externos), processos disciplinares com ciência eletrônica e atestados |
| **Minha Equipe** | Para gestores: time, avaliações de desempenho, treinamentos e aprovação de férias |
| **Chat** | Conversas com colegas e canais, e atendimento com o RH, com contador de não lidas e aviso por push |
| **Perfil** | Dados pessoais, foto, biografia, MFA e preferências de notificação |

---

## Inteligência Artificial

O Nexus usa a API da Groq (modelo GPT-OSS 120B) em dois lugares, sempre por Edge Functions: a chave da IA nunca chega ao navegador.

| Onde | Para quem | O que faz |
|---|---|---|
| **Central de Alertas** (`ai-alerts`) | RH | Analisa padrões de jornada (excesso de horas, ausências frequentes, baixa interação) e sinaliza possíveis riscos de burnout e prazos de compliance. Também gera relatórios e responde perguntas do RH sobre a equipe |
| **Assistente no Chat** (`ai-employee-chat`) | Colaborador | Tira dúvidas do próprio colaborador sobre saldo de férias, banco de horas, ponto, holerites e contrato, usando só os dados dele |

**Cuidados com os dados:**

- **Pseudonimização.** Antes de chegar ao modelo, os nomes são trocados por apelidos (`[P1]`, `[P2]`…), e o sistema só devolve o nome real na tela.
- **Escopo fechado.** O assistente do colaborador recebe apenas os dados de quem está perguntando, é instruído a não inventar números e encaminha ao RH o que não consegue responder.
- **Limite de uso.** Cada usuário tem um número máximo de chamadas por hora (60 mensagens para o assistente), controlado no banco.
- **Prevenção, não punição.** O alerta de burnout serve para o RH oferecer apoio. Nenhuma decisão é tomada automaticamente: as decisões do RH sobre cada alerta ficam registradas em `ai_decision_log`.

---

## Arquitetura e Tecnologias

### Visão Geral

<p align="center">
  <img src="README/arquitetura.png" alt="Diagrama de arquitetura: o navegador (PWA) servido pela Vercel fala por HTTPS e JWT com o Supabase (Auth, PostgreSQL, Storage, Realtime e Edge Functions), e as Edge Functions chamam a API da Groq" width="840">
  <br><em>Arquitetura do Nexus</em>
</p>

O Nexus não tem um servidor de aplicação próprio. A Vercel só entrega os arquivos estáticos do front, e o navegador fala direto com o Supabase usando o token (JWT) do usuário logado. Quem decide o que cada perfil pode ler ou alterar é o próprio PostgreSQL, pelas políticas de Row Level Security, então uma chamada feita fora da tela recebe as mesmas restrições.

| Peça | Papel |
|---|---|
| **Navegador (PWA)** | Telas e regras de cálculo em `src/javascript/domain/`, cifragem de ponta a ponta com WebCrypto e funcionamento offline pelo service worker |
| **Vercel** | Hospeda os arquivos estáticos e envia os cabeçalhos de segurança (CSP, HSTS) definidos em `vercel.json` |
| **Auth** | Login com senha e MFA (TOTP), obrigatório para o RH |
| **PostgreSQL** | RLS por papel (RH, gestor, colaborador), regras trabalhistas em triggers e funções, colunas cifradas com `pgcrypto` e chaves no Vault, e tarefas agendadas pelo `pg_cron` (retenção e alertas) |
| **Storage** | Documentos e selfies do ponto, sempre cifrados |
| **Realtime** | Chat e avisos chegam na hora, sem consultas repetidas |
| **Edge Functions** | O que não pode rodar no navegador: convites, IA, arquivos cifrados, recuperação do MFA e push |
| **Groq** | Modelo de IA, chamado só pelas Edge Functions, com os nomes trocados por apelidos |

### Stack

| Camada | Tecnologias |
|---|---|
| **Front-end** | HTML5, CSS3 e JavaScript · PWA instalável com Service Worker |
| **Back-end** | [Supabase](https://supabase.com/): PostgreSQL (regras de negócio em funções, triggers e RLS), Auth com MFA (TOTP), Storage, Realtime, Vault e pg_cron |
| **Serverless** | Supabase Edge Functions em TypeScript (Deno): convites, IA, arquivos cifrados, recuperação do MFA e notificações push |
| **Banco de dados** | PostgreSQL |
| **Inteligência Artificial** | API da [Groq](https://groq.com/) com o modelo GPT-OSS 120B (`openai/gpt-oss-120b`) |
| **Bibliotecas** | `supabase-js` · Chart.js (gráficos) · jsPDF e jsPDF-AutoTable (holerites, recibos e relatórios) · SheetJS (planilhas) · face-api.js (reconhecimento facial no ponto) · Tesseract.js (leitura de documentos por OCR) · Leaflet (mapa do ponto) · marked (respostas da IA) |
| **Qualidade** | `node:test` + jsdom (unidade e telas) · Playwright (E2E) · axe-core (acessibilidade) · ESLint · Prettier · OWASP ZAP · GitHub Actions |
| **Hospedagem** | Vercel (front-end) e Supabase (back-end) |

### Features e Qualidade

- **Criptografia em três camadas.** Dados sensíveis (CPF, salário, conta bancária, holerites, histórico de edição) ficam cifrados no banco com AES-256 (`pgcrypto`) e chave guardada no Vault. O CPF tem um índice cego por HMAC-SHA256, que barra cadastro duplicado sem precisar decifrar nada. Documentos, selfies do ponto e mensagens do chat são cifrados **de ponta a ponta** no navegador, e o servidor nunca vê a chave. Detalhes em [Segurança e Criptografia](#segurança-e-criptografia).
- **Regras de negócio no banco.** As regras da CLT (folha, férias, 13º, rescisão, estabilidade, banco de horas) e as dos regimes de aprendiz, estágio, temporário, prazo determinado e PJ são validadas por triggers e funções do PostgreSQL. Uma chamada direta à API não consegue burlar o que a tela impede.
- **Isolamento de dados por usuário.** Row Level Security em todas as tabelas, MFA obrigatório para o RH e acesso cortado automaticamente para quem é desligado.
- **Tempo real e persistência offline.** Os dois ambientes se atualizam pelo Supabase Realtime, sem polling. O ponto registrado sem internet fica numa fila local e é enviado com o horário do aparelho quando a conexão volta.
- **IA com privacidade.** Antes de chegar ao modelo, os nomes dos colaboradores são trocados por apelidos (`[P1]`, `[P2]`…), e cada usuário tem limite de chamadas por hora.
- **Biometria com prova de vida.** O ponto compara o rosto no banco, a partir de um modelo facial cifrado e fora do alcance da API, e pede que a pessoa pisque para recusar foto ou vídeo gravado.
- **LGPD e direito à desconexão.** Retenção automática de dados pelo pg_cron, backup cifrado com ensaio mensal de restauração, e notificações enviadas só no expediente de cada colaborador (o do cadastro, senão o da convenção coletiva, senão o da empresa).
- **Segurança do front-end.** Content-Security-Policy sem `'unsafe-inline'`, bibliotecas externas com versão fixa e SRI, e um teste que analisa o código (AST) e falha se algum texto de usuário entrar no HTML sem escape.
- **Testes e CI.** Mais de 2.000 testes automatizados, com cobertura mínima de 99% de linhas, ramos e funções exigida no CI. Também rodam no CI testes de integração das políticas de RLS contra um PostgreSQL real, E2E no navegador (folha, rescisão, documentos, comunicados, vários perfis), acessibilidade WCAG 2.1 AA, navegação por teclado, carga e varredura OWASP ZAP.

---

## Requisitos

Os requisitos definidos no artigo do TCC, com o que o sistema entrega hoje, onde cada um está e qual teste o comprova. Os caminhos de teste ficam em `test/` (unidade e telas), `test-integration/` (banco real) e `e2e/` (navegador).

**Legenda:** ✅ atendido · ⚠️ atendido em parte · ❌ não atendido

### Requisitos Funcionais

**RF1 · Cadastro e jornada**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF1.1 Prova de vida em até 5 s | ✅ | Piscada detectada no próprio navegador com face-api.js (`ponto-colaborador.js`), com limite de 5 s contados no relógio. O tempo de cada prova de vida aparece para o colaborador e fica gravado na batida (`activity_logs.prova_vida_ms`). Os modelos de reconhecimento são baixados ao abrir a tela, fora desse tempo | `pages/ponto-interacoes.test.js`, `requisitos-pendentes.js` |
| RF1.2 Ponto disponível 99,9% do tempo | ⚠️ | O ponto funciona offline e envia as marcações quando a conexão volta, mas a disponibilidade depende da Vercel e do Supabase (plano Free, sem SLA) | `ponto-colaborador-flow.test.js`, `holerite-pago-ponto-offline.js` |
| RF1.3 Senhas e documentos cifrados | ✅ | Senhas com hash pelo Supabase Auth; documentos e selfies cifrados de ponta a ponta e com AES-256-GCM | `e2e-crypto.test.js`, `file-crypto.test.js`, `e2e-keys.js` |
| RF1.4 Interface simples no celular e no computador | ✅ | Telas responsivas e PWA instalável | Conferência manual; `e2e/acessibilidade.spec.js` |
| RF1.5 Banco de horas e faltas sem erro de cálculo | ✅ | `domain/clt-domain.js` e `shared/faltas.js`, conferidos contra o mesmo cálculo feito nas Edge Functions | `jornada-paridade.test.js`, `banco-horas-flow.test.js`, `faltas-loader.test.js` |

**RF2 · Folha e benefícios**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF2.1 Holerite visível só ao colaborador e ao RH | ✅ | RLS na tabela `payslips` e leitura pela view cifrada `payslips_decrypted` | `rls-policies.js`, `column-encryption.js` |
| RF2.2 Férias conforme a CLT | ✅ | Período aquisitivo, fracionamento, aviso de 30 dias, abono e férias vencidas em `domain/clt-domain.js` e em triggers do banco | `clt-domain-regras-clt.test.js`, `ferias-regras-banco.js` |
| RF2.3 13º nas datas da lei | ✅ | Avos, 1ª e 2ª parcela e descontos calculados em `domain/eventos-folha.js`. O modal do 13º mostra o prazo de cada parcela (30/11 e 20/12, antecipado para sexta quando cai no fim de semana); a 30 dias do prazo o botão do 13º passa a indicar quantos colaboradores ainda não receberam; depois do prazo, gerar a parcela exige confirmação. O pagamento atrasado não é bloqueado, porque isso deixaria o colaborador sem receber | `eventos-folha.test.js`, `pages/pagamentos-prazo-13.test.js`, `rescisao-13-pago.test.js` |
| RF2.4 Lançamentos de folha com log | ✅ | Um trigger no banco (migration 117) registra em `employee_audit`, cifrado, todo lançamento, alteração, pagamento e exclusão de holerite, com quem fez e o valor anterior e novo de cada provento e desconto. Por estar no banco, vale também para chamadas feitas fora da tela. Holerite pago não pode mais ser alterado | `requisitos-pendentes.js`, `employee-audit-encryption.js`, `holerite-pago-ponto-offline.js` |
| RF2.5 Rescisão conforme a lei e o eSocial | ⚠️ | Verbas por tipo de desligamento e regime e prazo de pagamento (CLT art. 477 §6º) em `domain/calculo-rescisao.js`. Não há integração com o eSocial | `calculo-rescisao*.test.js`, `e2e/rescisao.spec.js` |

**RF3 · Desenvolvimento de colaboradores**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF3.1 Sigilo das avaliações | ✅ | RLS: o colaborador vê só a própria avaliação, o gestor só a da equipe e o RH todas | `performance-reviews.js` |
| RF3.2 Treinamentos com certificado e validade | ✅ | Certificado anexado e cifrado em cada treinamento, com data de validade (`certificado_valido_ate`). O catálogo pode ter a validade em meses, e o banco calcula a data ao concluir o treinamento; no curso autodeclarado o colaborador informa a data. As listas mostram válido, vencendo (30 dias) ou vencido, e o alerta diário de compliance (migration 118) avisa o RH na Central de Alertas até a reciclagem ser registrada | `requisitos-pendentes.js`, `datas-validade-certificado.test.js`, `trainings.js` |
| RF3.3 Disciplinares com acesso restrito | ✅ | RLS: RH registra, gestor só lê os da equipe e o colaborador vê os seus e dá ciência eletrônica | `disciplinary-actions.js` |
| RF3.4 Atestados protegidos | ✅ | Tabela `medical_leaves` com anexo cifrado e acesso só do colaborador e do RH | `medical-leaves.js` |

**RF4 · Comunicação**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF4.1 Comunicados só pelo RH | ✅ | RLS: apenas o RH grava na tabela `messages`; colaboradores só leem e confirmam ciência | `ciencia-comunicados-avatars.js`, `e2e/comunicados.spec.js` |
| RF4.2 Chat cifrado em trânsito | ✅ | HTTPS em todo o tráfego e, além disso, mensagens cifradas de ponta a ponta no navegador | `e2e-crypto.test.js`, `e2e-keys.js` |
| RF4.3 Canais só para membros | ✅ | Tabela `chat_channel_members` e uma chave de cifragem por canal, entregue só aos membros | `e2e-keys.js`, `chat-nao-lidas-push.js` |
| RF4.4 Sigilo no atendimento ao RH | ✅ | RLS: o colaborador vê só os próprios chamados | `rls-policies.js` |

**RF5 · Indicadores de risco**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF5.1 Alertas de burnout sem discriminação nem punição | ✅ | Regras em `domain/burnout-domain.js`, nomes trocados por apelidos antes da IA e nenhuma ação automática sobre o colaborador | `burnout-domain.test.js`, `pseudonymize.test.js`, `ai-alerts-snapshot.test.js` |

**RF6 · Organização por departamento**

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RF6.1 Cadastrar, editar e inativar departamentos | ✅ | Tabela `departments` (migration 119) com nome, descrição, responsável e situação, gerida pelo RH no botão Departamentos da tela Colaboradores. O cadastro do colaborador, a importação por planilha e os destinos dos comunicados usam essa lista. Departamento inativo mantém quem já está nele e não recebe ninguém novo; com colaboradores, não pode ser excluído; renomear atualiza colaboradores, comunicados e canal do chat | `departamentos.js`, `pages/colaboradores-departamentos.test.js`, `pages/comunicacao.test.js` |
| RF6.2 Vincular colaborador a departamento e gestor | ✅ | `department_id` (ligado ao cadastro de departamentos) e `manager_id` no cadastro do colaborador | `pages/colaboradores.test.js` |
| RF6.3 Consultar por departamento | ✅ | Filtro por departamento na tela Colaboradores | `pages/colaboradores.test.js` |
| RF6.4 Gestor vê só a própria equipe | ⚠️ | O gestor vê os colaboradores ligados a ele por `manager_id` (Minha Equipe), não por departamento | `equipe-colaborador.test.js`, `performance-reviews.js` |
| RF6.5 Histórico da troca de departamento | ✅ | A mudança fica em `employee_audit`, com valor anterior, novo e quem alterou | `employee-audit-encryption.js` |

### Requisitos Não Funcionais

| Requisito | | Como o Nexus atende | Verificação |
|---|:-:|---|---|
| RNF1.1 MFA obrigatório para o RH | ✅ | Funções do banco exigem sessão com segundo fator (`aal2`) para o RH; recuperação por códigos | `mfa-enforcement.js`, `mfa-recovery.js`, `mfa.test.js` |
| RNF1.2 Isolamento por RLS | ✅ | RLS em todas as tabelas; quem é desligado perde o acesso | `rls-policies.js`, `desligado-sem-acesso.js` |
| RNF1.3 Criptografia em repouso (AES-256) | ✅ | Colunas sensíveis com `pgcrypto`, arquivos com AES-256-GCM e backup cifrado com gpg | `column-encryption.js`, `file-crypto.test.js`, ensaio mensal de restauração |
| RNF1.4 Comunicação protegida em trânsito | ✅ | HTTPS com HSTS (`vercel.json`) e cifragem de ponta a ponta no chat e nos documentos | `e2e-crypto.test.js`, varredura OWASP ZAP |
| RNF2.1 LGPD | ✅ | Finalidade e minimização na política de privacidade, exportação dos dados (art. 18, V), anonimização (art. 18, VI), registro de acesso e purga automática | `employee-audit-encryption.js`, `conversation-retention.js` |
| RNF2.2 Direito à desconexão | ✅ | Cada colaborador recebe notificações só no próprio expediente: o horário e os dias de trabalho do cadastro, senão os da convenção coletiva, senão os da empresa (8h às 18h, de segunda a sexta). Turnos que viram a noite e a escala 12x36 (alternada a partir de um dia de plantão, inclusive nos fins de semana) são aceitos. Comunicados chegam a quem está no expediente e ficam guardados para os demais até o início do horário deles | `quiet-hours.test.js`, `edge-functions.test.js`, `comunicacao.test.js` |
| RNF3.1 WCAG 2.1 AA | ✅ | axe-core em cada tela durante o E2E | `e2e/acessibilidade.spec.js` |
| RNF3.2 Navegação por teclado | ✅ | Todas as ações alcançáveis e acionáveis pelo teclado | `e2e/teclado.spec.js` |
| RNF4.1 Uso em computador e celular | ✅ | CSS responsivo nas telas | Conferência manual |
| RNF4.2 Instalável como PWA | ✅ | `manifest.json` e `service-worker.js` | `npm run test:pwa` |

---

## Modelagem

### Diagrama de Casos de Uso

<p align="center">
  <img src="README/casos-de-uso.jpg" alt="Diagrama de casos de uso com os atores Colaborador, RH e Gestor e as funcionalidades de cada um" width="840">
  <br><em>Casos de uso do Nexus</em>
</p>

RH e Gestor herdam tudo o que o Colaborador faz (setas de generalização apontando para ele) e somam as próprias funções:

| Ator | Casos de uso |
|---|---|
| **Colaborador** | Fazer login, atualizar dados pessoais, solicitar férias (inclui verificar o saldo disponível), visualizar notificações e solicitar revisão de pontos |
| **RH** | Gerenciar cadastros (com cadastrar novo colaborador e editar cadastro existente como extensões), gerar comunicados, acessar relatórios, organizar metas e registrar feedbacks |
| **Gestor** | Organizar metas, acessar relatórios, registrar feedbacks e verificar solicitações da equipe, registrando a decisão |

Em **organizar metas**, criar, alterar e atualizar o progresso são extensões opcionais. Em **acessar relatórios**, escolher o tipo de relatório faz parte de todo acesso (`<<include>>`).

### Diagrama de Classes

<p align="center">
  <img src="README/diagrama-de-classes.jpg" alt="Diagrama de classes com Employee no centro, ligado a Profile, TimeRecord, BankAdjustment, Vacation, Payslip, AdjustmentRequest, BurnoutAlert, ActivityLog e às mensagens" width="840">
  <br><em>Classes principais do Nexus</em>
</p>

`Employee` é o centro do modelo: cada colaborador tem um perfil de acesso e vários registros de ponto, ajustes do banco de horas, férias, holerites, pedidos de ajuste, alertas e atividades. Cada classe corresponde a uma tabela do banco:

| Classe | Tabela | O que guarda |
|---|---|---|
| `Employee` | `employees` | Dados pessoais, contrato, salário e departamento |
| `Profile` | `profiles` | Perfil de acesso (RH ou colaborador) ligado ao login |
| `TimeRecord` | `time_records` | Marcações do dia: entrada, almoço, retorno e saída |
| `BankAdjustment` | `bank_adjustments` | Créditos e débitos do banco de horas, com justificativa |
| `Vacation` | `vacations` | Pedidos de férias, abono e aprovação |
| `Payslip` | `payslips` | Holerites com proventos, descontos e líquido |
| `AdjustmentRequest` | `adjustment_requests` | Pedidos de correção de marcação do ponto, com justificativa e decisão |
| `BurnoutAlert` | `burnout_alerts` | Alertas de risco gerados pela análise da jornada |
| `ActivityLog` | `activity_logs` | Histórico de ações para auditoria |
| `Message` e `MessageRead` | `messages` e `message_reads` | Mensagens do chat e quem já as leu |

O código não usa classes: os métodos do diagrama viram funções JavaScript das telas e de `src/javascript/domain/` (cálculos de férias, folha e banco de horas) e, quando a regra não pode ser burlada, funções e triggers do PostgreSQL.

### Diagrama Entidade-Relacionamento (DER)

<p align="center">
  <a href="README/der.jpg"><img src="README/der.jpg" alt="Diagrama entidade-relacionamento com a tabela employees no centro, ligada às tabelas de ponto, férias, folha, documentos, desempenho, treinamentos, chat, atendimento e alertas" width="700"></a>
  <br><em>DER do banco do Nexus (clique para ampliar)</em>
</p>

Quase toda tabela aponta para `employees` por `employee_id`. Os grupos principais são:

| Grupo | Tabelas |
|---|---|
| **Cadastro e acesso** | `employees`, `profiles`, `employee_audit`, `convencoes_coletivas`, `departments`, `job_titles` |
| **Jornada** | `time_records`, `adjustment_requests`, `bank_adjustments`, `bank_requests`, `biometric_templates`, `biometric_verifications` |
| **Férias, folha e afastamentos** | `vacations`, `payslips`, `medical_leaves` |
| **Desenvolvimento** | `performance_reviews`, `performance_review_competencies`, `pdi_goals`, `trainings`, `employee_trainings`, `disciplinary_actions`, `kudos` |
| **Documentos** | `documents`, `document_requirements`, `document_audit_log`, `onboarding_tasks`, `onboarding_progress` |
| **Comunicação** | `messages`, `message_reads`, `chat_channels`, `chat_channel_members`, `chat_messages`, `e2e_channel_keys`, `hr_tickets`, `hr_ticket_messages`, `hr_ticket_hidden` |
| **Alertas e auditoria** | `burnout_alerts`, `compliance_alerts`, `ai_decision_log`, `activity_logs`, `data_access_log`, `push_subscriptions`, `admin_push_subscriptions` |

O diagrama mostra as tabelas de negócio. As de infraestrutura (limites de chamadas, eventos e regras de segurança, chaves de criptografia, códigos de recuperação do MFA e cache da IA) ficam de fora para não poluir a imagem; a definição completa de todas está em [`supabase/schema.sql`](supabase/schema.sql). A imagem é anterior às tabelas `departments` e `job_titles` e às colunas de validade de certificado, expediente e tempo da prova de vida (migrations 115 a 119), que já estão no schema.

---

## Base Legal e Normas

As regras do sistema foram escritas a partir da legislação e das normas abaixo. Cada regra legal virou caso de teste com valores conferidos à mão, então uma mudança no código que contrarie a lei quebra o CI.

**Legislação trabalhista e de proteção de dados**

| Norma | Onde o Nexus aplica |
|---|---|
| **CLT** (Decreto-Lei 5.452/1943) | Férias (arts. 129 a 146: períodos, fracionamento, abono, férias vencidas), jornada e intervalos (arts. 59 e 71), adicionais (arts. 73 e 193), aprendiz (arts. 428 a 433), prazo determinado (arts. 443, 445, 479 e 480) e rescisão (arts. 477, 482, 484 e 487). Cálculos em `src/javascript/domain/` e travas em triggers do banco |
| **Lei 605/1949** | Desconto do DSR na semana da falta injustificada |
| **Lei 4.749/1965** e **Lei 7.855/1989, art. 3º** | Prazos da 1ª e da 2ª parcela do 13º (30/11 e 20/12) e aviso da multa por atraso na tela de pagamentos |
| **Lei 12.506/2011** | Aviso prévio proporcional ao tempo de casa na rescisão |
| **Lei 8.213/1991, art. 93** | Alerta de cota de pessoas com deficiência |
| **Lei 11.788/2008** (Estágio) | Termo de compromisso, limite de 2 anos, carga horária, supervisor, cota de estagiários e recesso proporcional, sem verbas da CLT |
| **Lei 6.019/1974** (Temporário) | Prazo máximo do contrato e regras próprias de rescisão |
| **Tabelas de INSS e IRRF de 2026**, com a redução da Lei 15.270/2025 | `src/javascript/domain/tabelas-fiscais.js` |
| **Lei 13.709/2018** (LGPD) | Cifragem de dados pessoais e sensíveis, registro de quem acessou o quê, exportação dos dados do titular (art. 18, V), anonimização no desligamento (art. 18, VI), retenção com purga automática e política de privacidade |
| **Portaria MTP 671/2021** (ponto eletrônico) | Referência para o registro de ponto: o colaborador só marca o dia atual ou o anterior, cada marcação guarda local e selfie, e correções passam por pedido com justificativa e aprovação do RH, ficando sinalizadas como ajustadas |

**Segurança e acessibilidade**

| Norma | Como é verificada |
|---|---|
| **OWASP** | Varredura OWASP ZAP no CI (`security-scan`), CSP sem `'unsafe-inline'`, teste contra XSS e `npm audit` bloqueando vulnerabilidades altas |
| **WCAG 2.1 nível AA** | axe-core em cada tela durante o E2E (`e2e/acessibilidade.spec.js`), que falha em violação séria ou crítica, e teste de navegação só por teclado |

> **Limite conhecido:** o ponto do Nexus segue a Portaria 671 como referência, mas não é um REP-P. Ele não gera os arquivos fiscais da portaria (AFD e AEJ) nem o comprovante de cada marcação, e não garante que o registro seja inalterável: uma correção aprovada substitui o horário original e o RH consegue apagar marcações. Para uso oficial por uma empresa, isso precisaria ser implementado e o programa, registrado no INPI.

---

## Guia de Instalação

O Nexus é **HTML/CSS/JS puro, sem framework e sem build step** — não há bundler, então basta servir os arquivos estaticamente. O backend é 100% Supabase (Postgres + Auth + Storage + Realtime + Edge Functions).

### Pré-requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| [Git](https://git-scm.com/) | qualquer recente | Clonar o repositório |
| [Node.js](https://nodejs.org/) | **22 ou superior** | Servidor local, testes, lint e Supabase CLI via `npx`. Não é usado em produção |
| Projeto no [Supabase](https://supabase.com/) | plano Free já serve | Banco, autenticação, arquivos e Edge Functions |
| Cliente `psql` ([PostgreSQL](https://www.postgresql.org/download/)) | 15 ou superior | Carregar o `schema.sql` no banco (ou use o SQL Editor do Supabase) |
| [OpenSSL](https://www.openssl.org/) | qualquer recente | Gerar a chave de cifragem dos arquivos (já vem com o Git Bash no Windows) |
| [Docker](https://www.docker.com/) | opcional | Só para rodar o Supabase local e os testes de integração e E2E |
| [Deno](https://deno.com/) | 2.x, opcional | Só para `npm run check:edge` (checagem de tipos das Edge Functions) |

Não há ambiente virtual como no Python: o `npm install` instala tudo dentro da pasta `node_modules/` do próprio projeto.

### Passo a Passo de Configuração

#### 1. Clonar e Instalar Dependências

```bash
git clone https://github.com/MaduAraujo/Nexus.git
cd Nexus
npm install
```

#### 2. Configurar o Cliente Supabase

Copie o arquivo de exemplo e preencha com as credenciais do seu projeto Supabase (Project Settings → API):

```bash
cp src/javascript/shared/supabase-client.example.js src/javascript/shared/supabase-client.js
```

Edite `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `src/javascript/shared/supabase-client.js`. A `anon key` é uma chave pública (protegida pela RLS do banco, não por sigilo) — pode ficar commitada, ao contrário da `service_role key`, que nunca deve sair do backend/Edge Functions.

#### 3. Aplicar o Schema do Banco

Em um projeto Supabase **novo** (recém-criado), carregue o schema consolidado primeiro — as migrations em `supabase/migrations/` são incrementais e assumem que as tabelas base (`employees` etc.) já existem, então `db push` sozinho falha em um banco vazio:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
psql "SUA_CONNECTION_STRING" -f supabase/schema.sql
```

(a connection string fica em Project Settings → Database → Connection string no dashboard; alternativamente, cole o conteúdo de `supabase/schema.sql` direto no SQL Editor). Só depois disso, para futuras alterações incrementais, use `npx supabase db push` normalmente — a partir daí o banco já está na baseline que as migrations esperam.

#### 4. Configurar as Edge Functions

As functions em `supabase/functions/` são `invite-employee`, `ai-alerts`, `ai-employee-chat`, `nexus-files`, `mfa-recover`, `send-push`, `send-alert-push`, `send-document-push` e `send-chat-push`. A `nexus-files` é **obrigatória**: sem ela nenhum arquivo é enviado ou aberto. As demais ligam recursos específicos (IA, convites por e-mail, recuperação do MFA e notificações push). Preencha as chaves conforme [Variáveis de Ambiente](#variáveis-de-ambiente) e publique:

```bash
cp supabase/functions/.env.example supabase/functions/.env
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy
```

Depois, confira no painel do Supabase (Edge Functions) que as nove aparecem. Uma função ausente responde 404 ao front.

Os avisos automáticos (comunicados adiados para o expediente de cada colaborador, alertas e push do chat) saem do banco e precisam da URL do projeto e da `service_role key` no **Vault do Postgres**. Rode **uma única vez** no SQL Editor:

```sql
select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'service_role_key');
```

O que cada função faz, como trocar a chave dos arquivos e como atualizar os valores do Vault estão em [docs/EDGE-FUNCTIONS.md](docs/EDGE-FUNCTIONS.md).

#### E-mails de Convite e de Senha

Os modelos ficam em `supabase/templates/`:

| Arquivo | Modelo do Supabase | Assunto |
|---|---|---|
| `convite.html` | Invite user | Seu acesso ao Nexus |
| `redefinir-senha.html` | Reset Password | Redefinição de senha no Nexus |

O `supabase/config.toml` já os usa no Supabase local. **O projeto hospedado não lê o `config.toml`:** cole o conteúdo de cada arquivo e o assunto em Authentication → Emails → Templates. O `redefinir-senha.html` é usado tanto no "Esqueci minha senha" quanto quando o RH convida um e-mail que já tem conta (`invite-employee`), por isso o texto é neutro.

Para o link do e-mail abrir o app, configure em Authentication → URL Configuration o **Site URL** (`https://nexus-nine-zeta.vercel.app`) e inclua `https://nexus-nine-zeta.vercel.app/**` em **Redirect URLs**.

**Remetente (SMTP):** o servidor padrão do Supabase envia poucos e-mails por hora e cai no spam com facilidade. Configure um SMTP próprio em Project Settings → Authentication → SMTP Settings.

#### 5. Rodar os Testes

O projeto tem 3 camadas de teste automatizado (o número exato de casos muda a cada mudança; rode os comandos para ver):

```bash
npm test               # unidade e telas (jsdom) — folha/CLT/rescisão/férias/estágio, criptografia, MFA, guarda de XSS e de CSP, mais de 2.000 casos, sem dependências externas
npm run test:coverage   # o mesmo, exigindo 99% de linhas, ramos e funções (piso do CI)
npm run check:edge      # checagem de tipos das Edge Functions (Deno)
npm run test:pwa        # manifesto e service worker do PWA
npm run lint            # ESLint
npm run format:check    # Prettier (não rode Prettier em .html)
```

Os testes de **integração** (RLS real contra Postgres) e de **sistema/E2E** (Playwright, navegador real) precisam de uma instância local do Supabase via Docker:

```bash
mv supabase/migrations supabase/migrations.off
npx supabase start --exclude logflare,studio,realtime,imgproxy,vector,edge-runtime
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f test-support/local-test-db-grants.sql
mv supabase/migrations.off supabase/migrations

npm run test:integration   # RLS, criptografia, MFA, regras de folha/férias/documentos no banco, biometria e funções abertas a anônimos

npx playwright install --with-deps chromium
npm run test:e2e           # fluxos completos no navegador: login, folha, rescisão, documentos, comunicados, vários perfis, acessibilidade (axe, WCAG 2.1 AA) e navegação por teclado
npm run test:load          # carga: 20 colaboradores + 3 RH simultâneos, p95 ≤ 2 s
```

A pasta de migrations sai do lugar só enquanto o Supabase local sobe, porque o `supabase start` aplica as migrations sozinho e elas pressupõem as tabelas base que o `schema.sql` cria. O CI faz o mesmo.

> **Já tem um Supabase local com o esquema antigo?** O `schema.sql` é para um banco vazio e não se sobrepõe a tabelas existentes. Em vez de recriar o seu banco de desenvolvimento, suba um segundo stack isolado: copie `supabase/config.toml` para uma pasta nova (`supabase/config.toml` dentro dela), troque o `project_id` e some 1000 às portas 543xx, rode `npx supabase start --exclude logflare,studio,realtime,imgproxy,vector,edge-runtime` ali, carregue `schema.sql` e `local-test-db-grants.sql` na porta `55322` e rode os testes com `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres` e `E2E_SUPABASE_URL=http://127.0.0.1:55321`.

Tudo isso roda automaticamente em CI a cada push/PR para `main` (`.github/workflows/tests.yml`): jobs `test` (unidade com cobertura, lint, formatação, Edge Functions, PWA e `npm audit`), `rls-integration` (integração), `e2e` (fluxos no navegador com acessibilidade e teclado, e carga) e `security-scan` (varredura OWASP ZAP). O ensaio de restauração do backup roda todo mês (`restore-drill.yml`).

### Variáveis de Ambiente

O Nexus não tem um `.env` único, porque cada parte lê a configuração de um lugar diferente:

| Onde | Arquivo ou comando | O que vai lá |
|---|---|---|
| Front-end (navegador) | `src/javascript/shared/supabase-client.js`, criado a partir de `supabase-client.example.js` | URL do projeto e `anon key` |
| Edge Functions | `supabase/functions/.env`, criado a partir de `supabase/functions/.env.example` | Chaves de IA, de cifragem e de push |
| Banco (Postgres) | Vault, pelo SQL Editor | URL do projeto e `service_role key`, usadas pelos avisos automáticos |

**Edge Functions.** Copie o modelo, preencha e envie para o Supabase:

```bash
cp supabase/functions/.env.example supabase/functions/.env
npx supabase secrets set --env-file supabase/functions/.env
```

| Variável | Obrigatória | Como obter |
|---|---|---|
| `GROQ_API_KEY` | Para a IA | Crie em [console.groq.com](https://console.groq.com/keys) |
| `FILES_ENCRYPTION_KEY` | **Sim** (sem ela nenhum arquivo abre) | `openssl rand -base64 32`. Guarde uma cópia fora do Supabase: sem ela os arquivos cifrados são irrecuperáveis |
| `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` | Para notificações push | `npx web-push generate-vapid-keys`. A pública também vai em `src/javascript/perfil-colaborador.js` |
| `QUIET_HOURS_START_HOUR` e `QUIET_HOURS_END_HOUR` | Não (padrão 8 e 18) | Expediente padrão da empresa, em dias úteis. Vale para o RH e para quem não tem expediente próprio no cadastro nem na convenção coletiva |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` **não** entram nesse arquivo: o Supabase já as entrega às Edge Functions automaticamente.

**Testes e scripts** (só no terminal, não precisam de arquivo):

| Variável | Usada por | Padrão |
|---|---|---|
| `TEST_DATABASE_URL` | `npm run test:integration` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `E2E_SUPABASE_URL` | `npm run test:e2e` | `http://127.0.0.1:54321` |
| `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` | `scripts/rotate-file-key.mjs` | nenhum |

---

## Instruções de Uso

### Iniciar a Aplicação Localmente

Com a [instalação](#guia-de-instalação) feita, suba o servidor estático na raiz do projeto:

```bash
node test-support/static-server.js
```

| Endereço | O que abre |
|---|---|
| `http://127.0.0.1:4173/` | Página inicial pública |
| `http://127.0.0.1:4173/src/screens/login.html` | Login do RH e do colaborador |

Variações do mesmo comando:

```bash
E2E_STATIC_PORT=8080 node test-support/static-server.js
COMO_PRODUCAO=1 node test-support/static-server.js
```

A primeira troca a porta. A segunda aplica os mesmos cabeçalhos de segurança da Vercel (CSP, HSTS etc.) e esconde as pastas que não vão para produção, para testar o app como ele fica no ar.

### Criar o Primeiro Administrador

Em um projeto novo ainda não existe ninguém do RH para cadastrar os outros. Crie o usuário em **Authentication → Users → Add user** (marque *Auto Confirm User*) e, no SQL Editor, dê a ele o perfil de administrador:

```sql
insert into profiles (id, profile)
select id, 'Administrador' from auth.users where email = 'rh@suaempresa.com';
```

No primeiro login o sistema pede para configurar o MFA (aplicativo autenticador), obrigatório para o RH.

### Fluxo de Uso

A plataforma tem três perfis de acesso:

| Perfil | Quem é | O que pode fazer |
|---|---|---|
| **RH / Administrador** | Usuário com perfil `Administrador`, sempre com MFA | Acessa o Painel do RH e todos os colaboradores: cadastro, folha, férias, ponto, documentos, comunicados, atendimento, alertas e segurança |
| **Gestor** | Um colaborador que tem outros ligados a ele pelo campo `manager_id` | Tudo o que o colaborador faz e, só para a própria equipe, na aba **Minha Equipe**: aprovar férias e pedidos de banco de horas, fazer avaliações de desempenho, definir metas do PDI, atribuir treinamentos, consultar processos disciplinares e ver os períodos de atestado (sem CID nem dados do médico) |
| **Colaborador** | Qualquer pessoa cadastrada que ativou a conta | Usa o Portal do Colaborador com os próprios dados: ponto, holerites, férias, documentos, comunicados, desempenho, chat e perfil |

O Gestor não é um perfil separado no login: basta o RH indicar o gestor no cadastro do colaborador, e a aba Minha Equipe aparece para ele. As permissões são aplicadas pelo banco (RLS), então o gestor não consegue ver nem alterar dados de quem não é da sua equipe.

As credenciais da demonstração publicada não ficam aqui; solicite acesso diretamente à equipe do projeto pelos [Contatos](#contatos).

1. **O RH cadastra os colaboradores** no módulo **Colaboradores**, com cargo, salário e tipo de contrato.
2. **O convite sai automaticamente** por e-mail, com a identidade visual do Nexus. Se o e-mail já tiver conta, a pessoa recebe um link para definir uma nova senha.
3. **O colaborador ativa a conta** em **Ativar minha conta**, define a senha e passa a usar o próprio portal: ponto, holerites, férias, documentos, chat e muito mais. O link é de uso único e tem prazo de validade; se vencer, o RH reenvia o convite.
4. **Os dois lados conversam em tempo real:** um pedido de férias ou um ajuste de ponto feito pelo colaborador aparece na hora para o RH aprovar, e a resposta volta para o portal sem recarregar a página.

### Exemplos com o Código

As regras de cálculo ficam em `src/javascript/domain/` e rodam também no Node, sem navegador. Salve como `exemplo.js` na raiz do projeto e rode `node exemplo.js`.

**Descontos da folha (tabelas de 2026):**

```js
global.window = global;
const { calcINSS, calcIRRFMensal } = require('./src/javascript/domain/tabelas-fiscais.js');

const inss = calcINSS(5000);
const irrf = calcIRRFMensal({ rendimento: 5000, inss, dependentes: 1 });
console.log({ inss, irrf });
```

```text
{ inss: 501.51, irrf: 0 }
```

O IRRF sai zerado porque, desde 2026, a redução da Lei 15.270/2025 isenta quem ganha até R$ 5.000.

**Rescisão por pedido de demissão:**

```js
global.window = global;
require('./src/javascript/domain/clt-domain.js');
const { calcularRescisao } = require('./src/javascript/domain/calculo-rescisao.js');

const r = calcularRescisao({
    tipo: 'pedido_demissao',
    salario: 3000,
    admissao: new Date(2025, 2, 10),
    demissao: new Date(2026, 5, 30),
});
console.log(r.verbas, r.totalVerbas, r.prazoPagamento);
```

```text
[
  { descricao: 'Saldo de Salário', dias: 30, valor: 3000 },
  { descricao: '13º Salário Proporcional', dias: '6/12', valor: 1500 },
  { descricao: 'Férias Proporcionais', dias: '4/12', valor: 1000 },
  { descricao: '1/3 Constitucional de Férias', dias: '—', valor: 333.33 },
  { descricao: 'Férias Vencidas (CLT art. 146)', dias: 30, valor: 3000 },
  { descricao: '1/3 Constitucional sobre Férias Vencidas', dias: '—', valor: 1000 }
]
9833.33 2026-07-10
```

O mesmo `calcularRescisao` aceita `contractType` (`'Aprendiz'`, `'Estágio'`, `'PJ'`, `'Temporário'` etc.) e aplica a regra de cada regime.

### Exemplos de API

O front conversa com o Supabase por HTTP, e as mesmas chamadas funcionam no terminal. Troque `SEU_PROJECT_REF` e `SUA_ANON_KEY` pelos valores do passo 2 da instalação.

**1. Login (recebe o token de acesso):**

```bash
curl -X POST "https://SEU_PROJECT_REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: SUA_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"colaborador@suaempresa.com","password":"SuaSenha123"}'
```

```json
{ "access_token": "eyJhbGciOi...", "token_type": "bearer", "expires_in": 3600, "refresh_token": "...", "user": { "id": "...", "email": "colaborador@suaempresa.com" } }
```

Quem tem MFA ativado (todo o RH) precisa concluir o segundo fator antes de usar as RPCs; para testar pelo terminal, use um colaborador sem MFA.

**2. RPC: mensagens não lidas do chat**

```bash
curl -X POST "https://SEU_PROJECT_REF.supabase.co/rest/v1/rpc/chat_unread_summary" \
  -H "apikey: SUA_ANON_KEY" -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

```json
[
  { "kind": "channel", "thread": "4f1c2a9e-...", "unread": 3 },
  { "kind": "ticket", "thread": "b7d03e51-...", "unread": 1 }
]
```

Sem o cabeçalho `Authorization`, a resposta é `401`. O banco usa o token para saber quem chama, então ninguém consulta as conversas de outra pessoa.

**3. Edge Function: assistente de IA do colaborador**

```bash
curl -N -X POST "https://SEU_PROJECT_REF.supabase.co/functions/v1/ai-employee-chat" \
  -H "apikey: SUA_ANON_KEY" -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Quantos dias de férias eu tenho?","history":[]}'
```

A resposta chega em *streaming* (Server-Sent Events), um pedaço de texto por linha:

```text
data: {"choices":[{"index":0,"delta":{"content":"Você tem "}}]}

data: {"choices":[{"index":0,"delta":{"content":"30 dias disponíveis"}}]}

data: [DONE]
```

| Situação | Status | Corpo |
|---|---|---|
| Sem `message` | `400` | `{"error":"message é obrigatório"}` |
| Sem token ou token inválido | `401` | `{"error":"Não autorizado"}` |
| Usuário do RH chamando a função do colaborador | `403` | `{"error":"Acesso restrito ao colaborador"}` |
| Mais de 60 mensagens na mesma hora | `429` | `{"error":"Você atingiu o limite de mensagens por hora. ..."}` |

---

## Estrutura de Diretórios

```text
Nexus/
├── index.html                  # página inicial pública
├── service-worker.js           # cache e funcionamento offline do PWA
├── manifest.json               # instalação do PWA (nome, ícones, cores)
├── vercel.json                 # cabeçalhos de segurança (CSP, HSTS) da hospedagem
│
├── src/                        # front-end (o que vai para o navegador)
│   ├── screens/                # telas em HTML: login, painel do RH e portal do colaborador
│   ├── styles/                 # um CSS por tela, mais os de impressão (holerite, recibos)
│   ├── assets/                 # ícones, fontes e capturas de tela do PWA
│   └── javascript/             # comportamento de cada tela (um .js por tela)
│       ├── domain/             # lógica de negócio: CLT, folha, impostos, rescisão, estágio, burnout
│       └── shared/             # código comum: cliente Supabase, autenticação, MFA, criptografia de ponta a ponta
│
├── supabase/                   # back-end
│   ├── schema.sql              # banco completo, para um projeto novo
│   ├── migrations/             # alterações do banco em ordem (tabelas, RLS, triggers, cifragem)
│   ├── functions/              # Edge Functions em TypeScript (IA, convites, arquivos, push, MFA)
│   │   └── _shared/            # código comum às functions (cifragem de arquivos, pseudonimização)
│   ├── templates/              # e-mails de convite e de redefinição de senha
│   └── config.toml             # configuração do Supabase local
│
├── scripts/                    # operação
│   ├── backup/                 # backup cifrado do banco e ensaio de restauração
│   ├── ops/                    # revisão de acessos
│   ├── pentest/                # sondagem da API em ambiente parecido com produção
│   └── rotate-file-key.mjs     # troca da chave de cifragem dos arquivos
│
├── test/                       # testes de unidade e de tela (node:test + jsdom)
├── test-integration/           # testes de RLS e regras do banco contra PostgreSQL real
├── e2e/                        # testes ponta a ponta no navegador (Playwright)
├── test-support/               # servidor local, simuladores do Supabase e dados de teste
│
├── docs/                       # documentação técnica: segurança, migrations e Edge Functions
├── .github/workflows/          # CI: testes, varredura OWASP ZAP e ensaio mensal de backup
└── README/                     # imagens usadas neste README
```

**Onde fica cada coisa**

| Procurando… | Vá em |
|---|---|
| Scripts de banco de dados | `supabase/schema.sql` (banco inteiro) e `supabase/migrations/` (uma alteração por arquivo, numeradas) |
| Componentes visuais | `src/screens/` (HTML de cada tela) com o CSS de mesmo nome em `src/styles/` e o JS em `src/javascript/` |
| Lógica de negócio | `src/javascript/domain/` no navegador e, para o que não pode ser burlado, as funções e triggers em `supabase/migrations/` |
| Lógica que roda no servidor | `supabase/functions/` |

---

## Segurança e Criptografia

| Camada | Como o Nexus protege |
|---|---|
| **Em trânsito** | Todo o tráfego usa HTTPS (Vercel e Supabase) |
| **No banco** | CPF, RG, salário, dados bancários, dados sensíveis (LGPD art. 5º, II), mensagens e holerites cifrados com AES-256 (`pgcrypto`), chaves no Supabase Vault e leitura pelas views `*_decrypted`, que respeitam a RLS |
| **Arquivos** | AES-256-GCM pela Edge Function `nexus-files`, com rotação de chave |
| **Ponta a ponta** | Documentos, selfies do ponto e mensagens do chat cifrados no navegador (ECDH P-256 + AES-256-GCM); o servidor nunca tem a chave |
| **Acesso** | Row Level Security em todas as tabelas, MFA obrigatório para o RH (com códigos de recuperação) e acesso cortado para quem é desligado |
| **Front-end** | CSP sem `'unsafe-inline'`, SRI em todas as bibliotecas externas e teste automático contra XSS |
| **Monitoramento** | Alertas de comportamento anormal: falhas de login em série, exportação em massa e acesso do RH fora do horário comercial |

> ⚠️ **Guarde uma cópia das chaves de cifragem fora do Supabase** (`data_encryption_key`, `data_hmac_key` no Vault e `FILES_ENCRYPTION_KEY` nas Edge Functions). Sem elas, os dados cifrados **não podem ser recuperados**.

**Documentação técnica:**

- [docs/SEGURANCA.md](docs/SEGURANCA.md): criptografia por coluna e de ponta a ponta, proteções contra ataques, regras para quem desenvolve e limites conhecidos.
- [docs/MIGRATIONS.md](docs/MIGRATIONS.md): o que cada migration faz e a ordem de aplicação em um banco existente.
- [docs/EDGE-FUNCTIONS.md](docs/EDGE-FUNCTIONS.md): cada Edge Function, a troca da chave dos arquivos e a configuração do Vault para os avisos automáticos.

---

## Privacidade (LGPD) e Operação

- **Backup e restauração:** o backup cifrado (`scripts/backup/backup-db.mjs`) e a restauração em banco novo são ensaiados por `node scripts/backup/restore-drill.mjs` (Docker + gpg), que também roda todo mês no GitHub Actions. O relatório fica em `test-results/restore-drill/`.
- **Retenção:** `purge_security_events()` apaga eventos de segurança com mais de 180 dias e `purge_expired_conversations()` (migrations 081 e 110) apaga chat interno e histórico do assistente de IA do RH após 12 meses, e atendimentos resolvidos (ou só com o assistente) 5 anos após a última mensagem, por serem prova em reclamação trabalhista; atendimentos abertos ficam até serem resolvidos. As duas rodam todo dia pelo pg_cron. A política pública fica em `src/screens/privacidade.html` (versão de demonstração com empresa fictícia).
- **Acessos:** `scripts/ops/revisao-de-acessos.sql` lista quem tem acesso a quê.
- O schema não vai ao ar: o `.vercelignore` o exclui da hospedagem.

---

## Limitações e Trabalhos Futuros

Esta versão entrega a base do sistema, mas ainda tem limites conhecidos. Eles estão reunidos aqui para quem for avaliar ou implantar o Nexus.

### Limitações Atuais

| Área | Limitação |
|---|---|
| **Escopo** | Não há recrutamento e seleção, e cada instalação atende uma única empresa |
| **Ponto eletrônico** | Não é um REP-P da Portaria MTP 671/2021: não gera AFD, AEJ nem comprovante de marcação, uma correção aprovada substitui o horário original e o RH consegue apagar marcações |
| **Folha** | Não há integração com o eSocial: os eventos (S-1200, S-2299 etc.) não são gerados nem transmitidos |
| **Departamentos** | O responsável do departamento fica registrado, mas o acesso do gestor continua pela equipe ligada a ele (`manager_id`), não pelo departamento inteiro |
| **Direito à desconexão** | Feriados não entram no cálculo do expediente, e escalas diferentes de dias fixos e 12x36 (como 6x1 com folga rotativa) ainda não são representadas |
| **Infraestrutura** | O projeto roda no plano Free do Supabase, sem garantia de disponibilidade (SLA), e a IA depende da disponibilidade da Groq |
| **Responsividade** | O uso no celular é conferido à mão; não há teste automatizado de layout |

### Trabalhos Futuros

- **Ponto homologável:** gerar AFD, AEJ e comprovante de marcação, manter o horário original junto da correção, impedir a exclusão de marcações e registrar o programa no INPI.
- **Departamentos:** permitir que o responsável pelo departamento acompanhe o departamento todo em Minha Equipe.
- **Folha:** geração dos eventos do eSocial.
- **Desconexão por escala:** feriados e escalas com folga rotativa no cálculo do expediente.
- **Produção:** migrar para um plano com SLA e prever um modelo de IA alternativo caso a Groq fique fora do ar.
- **Novos módulos:** recrutamento e seleção e suporte a várias empresas na mesma instalação.

---

## Governança e Autoria

### Como Contribuir

Contribuições passam por *pull request* e só entram depois de revisadas pelos autores. Antes de começar algo grande, abra uma *issue* descrevendo a ideia.

**1. Faça um fork e clone a sua cópia**

Clique em **Fork** no GitHub e depois:

```bash
git clone https://github.com/SEU_USUARIO/Nexus.git
cd Nexus
git remote add upstream https://github.com/MaduAraujo/Nexus.git
npm install
```

**2. Crie uma branch a partir da `main` atualizada**

```bash
git fetch upstream
git switch -c feature/nome-curto upstream/main
```

| Prefixo | Quando usar | Exemplo |
|---|---|---|
| `feature/` | Funcionalidade nova | `feature/exportar-ponto-pdf` |
| `fix/` | Correção de bug | `fix/calculo-dsr-feriado` |
| `docs/` | Só documentação | `docs/guia-instalacao` |
| `test/` | Só testes | `test/rescisao-aprendiz` |
| `refactor/` | Mudança interna sem alterar comportamento | `refactor/modulo-ferias` |
| `chore/` | Dependências, CI e configuração | `chore/atualizar-playwright` |

Nomes em minúsculas, sem acento e com palavras separadas por hífen.

**3. Escreva os commits no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/)**

```text
<tipo>(<escopo opcional>): <descrição no imperativo, em minúsculas>
```

```bash
git commit -m "feat(ferias): permitir abono de 10 dias no pedido do colaborador"
git commit -m "fix(folha): descontar DSR só na semana da falta"
git commit -m "docs: explicar variáveis de ambiente das edge functions"
```

Os tipos são os mesmos dos prefixos de branch (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`). Cada commit trata de um assunto só.

**4. Siga as convenções do projeto**

- O código não leva comentários (`//`, `/* */` ou `--`); nomes claros de funções e variáveis fazem esse papel, e a explicação vai na descrição do PR.
- Toda mudança de comportamento vem com teste. O CI exige 99% de cobertura de linhas, ramos e funções.
- Mudança no banco vira uma migration nova em `supabase/migrations/`, com o próximo número da sequência, e também é refletida em `supabase/schema.sql`.
- Texto vindo do usuário só entra no HTML por `escapeHtml()`, e nada de `onclick=` ou `style=` inline (a CSP bloqueia e os testes falham).
- Não rode o Prettier em arquivos `.html`; use `npm run format` só no que ele já cobre.

**5. Confira tudo localmente antes de enviar**

```bash
npm run lint
npm run format:check
npm run test:coverage
```

**6. Abra o Pull Request**

```bash
git push origin feature/nome-curto
```

No GitHub, abra o PR da sua branch para a `main` de `MaduAraujo/Nexus`. Na descrição, informe:

- **o que** mudou e **por quê**, com o número da *issue*, se houver;
- **como testar**, passo a passo;
- capturas de tela, se a interface mudou;
- migrations novas e a ordem de aplicação, se houver.

O PR só é aceito com o CI verde (testes, integração, E2E e varredura de segurança) e a aprovação de um dos autores.

### Licença

**Todos os direitos reservados.** O código está público apenas para consulta e avaliação acadêmica. Copiar, modificar, distribuir ou usar o Nexus em outros projetos depende de autorização prévia e por escrito dos autores. Quem envia uma contribuição autoriza os autores a incorporá-la sob esses mesmos termos.

**Quer usar o Nexus na sua empresa?** O sistema pode ser contratado diretamente com os autores, incluindo implantação, suporte e o desenvolvimento sob medida das funcionalidades que ele ainda não tem. Prazos, valores, garantias e o tratamento de dados (LGPD) ficam em contrato próprio. Fale com a equipe pelos [Contatos](#contatos).

Texto completo em [LICENSE](LICENSE).

### Contatos

<table>
<tr>
<td valign="top">

| Nome | Contato |
|---|---|
| Maria Eduarda Araújo | [LinkedIn](https://www.linkedin.com/in/mariaeduarda2801/) |
| Vinicius Lopes | [LinkedIn](https://www.linkedin.com/in/vlopes1996/) |

</td>
<td valign="top">

| | |
|---|---|
| **Curso** | Bacharelado em Ciência da Computação |
| **Instituição** | FAM — Centro Universitário das Américas |
| **Orientador** | Prof. Me. Ranieri Marinho de Souza |
| **Ano** | 2026 |

</td>
</tr>
</table>

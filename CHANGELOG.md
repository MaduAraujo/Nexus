# Changelog

Todas as mudanças relevantes do Nexus ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Cadastro de departamentos com responsável e situação (ativo ou inativo), usado no cadastro do colaborador, na importação por planilha e nos destinos dos comunicados; renomear um departamento atualiza colaboradores, comunicados e canal do chat.
- Colaboradores ligados ao catálogo de cargos.
- Expediente por colaborador e por convenção coletiva, com dias da semana e escala 12x36.
- Validade de certificado nos treinamentos, com aviso de vencimento para o colaborador, o gestor e o RH.
- Prazos legais das parcelas do 13º salário na folha, com aviso quando estão próximos ou vencidos.
- Registro de cada lançamento, alteração, pagamento e exclusão de holerite no histórico do colaborador.
- Tempo da prova de vida medido e guardado em cada marcação de ponto.
- Atalho de teclado (Ctrl+K ou ⌘K) anunciado na busca universal.

### Alterado

- Comunicados podem ser enviados a qualquer hora; as notificações fora do expediente de cada colaborador ficam guardadas e saem no início do expediente seguinte.
- Cargo de estágio com nome neutro no catálogo (Estagiário(a)).
- Contagem de pendências e notificações lida pelos leitores de tela.

### Segurança

- Fotos de perfil deixam de ter leitura pública no Storage.
- Cadastro de departamentos exige MFA, como as demais tabelas.
- Dependências atualizadas, incluindo a correção do `source-map-js` (GHSA-68fv-2mgg-jv7q).

## [1.0.0] - 2026-10-06

Primeira versão numerada. Reúne o desenvolvimento feito de março a outubro de 2026.

### Adicionado

- Gestão de colaboradores com checklist de documentos por tipo de contrato (CLT, PJ, estágio, aprendiz, temporário e prazo determinado).
- Ponto eletrônico com biometria, prova de vida, banco de horas e registro offline.
- Folha de pagamento com INSS, IRRF 2026, FGTS, adicionais, horas extras, DSR, faltas, pensão e holerite.
- Férias, 13º salário e rescisão, incluindo as regras específicas do aprendiz, do estágio e do PJ.
- Avaliação de desempenho, cargos e salários, treinamentos com certificado, medidas disciplinares e atestados.
- Comunicados com ciência obrigatória, chat em tempo real com mensagens não lidas e notificações push respeitando o direito à desconexão.
- Assistente de IA para colaboradores e alertas de comportamento anormal.

### Segurança

- RLS em todas as tabelas, MFA exigido nas RPCs, recuperação de MFA, criptografia de colunas, de arquivos e de auditoria.
- Criptografia ponta a ponta em documentos, selfies e conversas.
- CSP, SRI e proteção contra XSS no front.
- Documentação LGPD, política de privacidade e retenção de dados.

### Qualidade

- Testes unitários com cobertura mínima de 99% em linhas, ramos e funções.
- Testes de integração de RLS, E2E com Playwright, acessibilidade (axe), teclado, carga e varredura ZAP no CI.

[Não lançado]: https://github.com/MaduAraujo/Nexus/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/MaduAraujo/Nexus/releases/tag/v1.0.0

# Changelog

Todas as mudanças relevantes do Nexus ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

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

# Nexus — Comunicação Interna

Módulo de envio e gerenciamento de comunicados internos do sistema. Permite que administradores redijam mensagens, escolham o setor de destino e consultem o histórico de avisos enviados — com interface responsiva para desktop e mobile.

---

## Visão Geral

A tela de **Comunicação Interna** é composta por duas seções principais, alternadas por um botão de navegação na topbar (desktop) ou um botão FAB flutuante (mobile):

| Seção | Descrição |
|---|---|
| **Central de Mensagens** | Área de envio de novos comunicados |
| **Histórico de Avisos** | Listagem de comunicados já enviados, com opção de exclusão |

---

## Estrutura de Arquivos

```
nexus/
├── pages/
│   └── comunicação.html       # Estrutura HTML da tela
├── styles/
│   └── comunicação.css        # Estilos e responsividade
└── javascript/
    └── comunicação.js         # Lógica e interação
```

---

## Como Usar

### 1. Enviar um comunicado

1. Na seção **Central de Mensagens**, digite o texto no campo de mensagem
2. Clique em **Enviar Comunicado**
3. No modal, selecione o setor de destino
4. O comunicado é salvo e aparece no histórico

### 2. Consultar o histórico

- Clique em **Comunicados Enviados** (desktop) ou no botão **FAB** (mobile)
- A seção exibe todos os comunicados em ordem cronológica reversa

### 3. Excluir um comunicado

- No histórico, clique no ícone 🗑️ ao lado do comunicado desejado
- Confirme a exclusão na caixa de diálogo

---

## Armazenamento de Dados

Os comunicados são persistidos no **`localStorage`** do navegador, sem necessidade de backend.

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| HTML5 | Estrutura semântica da página |
| CSS3 | Layout (Flexbox/Grid), variáveis CSS, media queries, animações |
| JavaScript | Lógica de negócio, manipulação do DOM, persistência |
| localStorage | Armazenamento local dos comunicados |
| Font Awesome 6 | Ícones da interface |
| Google Fonts | Tipografia: `Plus Jakarta Sans` + `DM Sans` |
# 👥 Nexus — Colaboradores

Módulo completo de gestão de colaboradores. Permite cadastrar, visualizar, editar, filtrar e excluir colaboradores, com formulário em dois modos (obrigatório e completo em 6 etapas), drawer de detalhes e interface totalmente responsiva.

---

## Visão Geral

A tela de **Colaboradores** é o módulo central. Ela oferece uma tabela interativa com todos os colaboradores cadastrados, filtros por status, busca em tempo real e um formulário para cadastro completo, incluindo dados pessoais, contratuais, benefícios e dados de pagamento.

---

## Estrutura de Arquivos

```
nexus/
├── screens/
│   └── colaboradores.html      # Estrutura HTML da tela
├── styles/
│   └── colaboradores.css       # Estilos e responsividade
└── javascript/
    └── colaboradores.js        # Lógica e interações
```

---

## Armazenamento de Dados

Todos os colaboradores são persistidos no **`localStorage`** do navegador.

---

## Máscaras e Validações

| Campo | Máscara | Formato resultante |
|---|---|---|
| CPF | Automática | `000.000.000-00` |
| RG | Automática | `00.000.000-X` |
| Telefone | Automática | `(00) 00000-0000` |
| CEP | Automática | `00000-000` |
| PIS/PASEP | Automática | `000.00000.00-0` |
| Salário / campos monetários | Automática | `R$ 0.000,00` |
| Agência | Numérico limitado | máx. 4 dígitos |
| Conta | Alfanumérico | `00000-X` |

**Validação de CPF duplicado:** ao submeter, verifica se já existe outro colaborador com o mesmo CPF (ignorando o próprio registro em caso de edição).

---

## Integração com ViaCEP

Ao preencher o campo **CEP** no passo 2 do formulário completo, o sistema consulta a API pública [ViaCEP](https://viacep.com.br) automaticamente.

Campos preenchidos automaticamente: **Logradouro, Bairro, Cidade, UF**.  
O foco avança para o campo **Número** após o preenchimento.  
Se o CEP for inválido ou não encontrado, um toast de aviso é exibido.

---

## Status dos Colaboradores

Todo colaborador é cadastrado com status **Ativo** por padrão.

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| HTML5 | Estrutura semântica |
| CSS3 | Flexbox/Grid, variáveis CSS, animações, media queries |
| JavaScript | Lógica, DOM, máscaras, filtros, persistência |
| localStorage | Armazenamento local dos colaboradores |
| ViaCEP API | Autopreenchimento de endereço por CEP |
| Font Awesome 6 | Ícones da interface |
| Google Fonts | `Plus Jakarta Sans` + `DM Sans` |
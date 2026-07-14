# Modernizar tela "Como deseja acessar?" (seleção de perfil) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernizar visualmente a etapa de seleção de perfil (`#form-profile`) da tela de login com um estilo glassmorphism, dando identidade de cor própria a cada perfil (dourado para RH, azul para Colaborador), e refinar sutilmente o painel esquerdo (`.panel-left`) que é compartilhado por toda a tela de login.

**Architecture:** Mudança é 100% CSS em `src/styles/login.css`. Nenhum HTML novo é necessário — as classes `rh` e `colaborador` já existem nos elementos `.profile-card` em `src/screens/login.html:55` e `:71`. Nenhuma alteração em `src/javascript/login.js`: a lógica de seleção (`selectProfile`, `goToLogin`) já funciona via `classList` em `.profile-card` e `.selected`, que continuam existindo sem mudança de nome.

**Tech Stack:** HTML/CSS/JS vanilla, sem build step. Projeto pessoal de RH (Nexus).

## Global Constraints

- Não alterar `src/javascript/login.js` (nenhuma função, id ou nome de classe usado pelo JS pode mudar).
- Não alterar `#form-login`, `#form-first-access`, `#form-forgot`, `#create-pass-modal` (fora de escopo — ver spec).
- Reaproveitar os tokens de cor já existentes em `login.css:7-24` (`--accent-gold`, `--accent-gold-dim`, `--accent-blue`, `--accent-blue-dim`) — não criar paleta nova.
- Botão "Continuar" (`.btn-continue`) permanece **sem mudança de cor por perfil** — não editar sua regra de `background`/`color` herdada de `.btn-submit`.
- Manter os breakpoints responsivos existentes em `login.css` (linhas 759-863) funcionando sem quebrar — não adicionar novos breakpoints.
- Não há framework de testes no projeto (`package.json` só lista dependências do Supabase, sem scripts). Verificação é manual, via navegador, seguindo os passos de cada tarefa.

---

### Task 1: Cards de perfil com identidade de vidro por cor

**Files:**
- Modify: `src/styles/login.css:186-254` (`.profile-card`, `.profile-card::before`, `.profile-icon`, `.profile-icon svg`, `.profile-check`, `.profile-card.selected .profile-check`)

**Interfaces:**
- Consumes: tokens `--accent-gold`, `--accent-gold-dim`, `--accent-blue`, `--accent-blue-dim`, `--border`, `--radius`, `--surface-2`, `--transition` (definidos em `login.css:7-24`); classes HTML já existentes `.profile-card.rh` (`login.html:55`) e `.profile-card.colaborador` (`login.html:71`); classe `.selected` alternada por `login.js:86`.
- Produces: nenhuma interface nova consumida por outras tarefas — mudança isolada de estilo.

- [ ] **Step 1: Substituir o bloco de estilos dos cards de perfil**

Em `src/styles/login.css`, localizar e substituir o bloco atual (linhas 186 a 254, do `.profile-card {` até `.profile-check svg { stroke: #000; }`):

```css
.profile-card {
    --profile-accent: var(--accent-blue);
    --profile-accent-dim: var(--accent-blue-dim);
    cursor: pointer;
    border: 1.5px solid var(--border);
    border-radius: var(--radius);
    padding: 1.1rem 1rem;
    background: rgba(35, 35, 41, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    transition: var(--transition);
    position: relative;
    overflow: hidden;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
}

.profile-card.rh {
    --profile-accent: var(--accent-gold);
    --profile-accent-dim: var(--accent-gold-dim);
}

.profile-card.colaborador {
    --profile-accent: var(--accent-blue);
    --profile-accent-dim: var(--accent-blue-dim);
}

.profile-card::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity var(--transition);
    background: var(--profile-accent-dim);
}

.profile-card:hover,
.profile-card.selected {
    border-color: var(--profile-accent);
    transform: translateY(-3px);
    box-shadow:
        0 1px 2px rgba(0,0,0,0.35),
        0 4px 10px rgba(0,0,0,0.3),
        0 14px 28px -10px var(--profile-accent-dim);
}

.profile-card:hover::before,
.profile-card.selected::before { opacity: 1; }

.profile-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0.75rem;
    flex-shrink: 0;
    background: radial-gradient(circle at 30% 30%, var(--profile-accent-dim), rgba(255,255,255,0.02));
    border: 1px solid var(--profile-accent-dim);
    position: relative;
    z-index: 1;
}

.profile-icon svg { stroke: var(--profile-accent); position: relative; z-index: 1; }

.profile-check {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--profile-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0);
    transition: opacity var(--transition), transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.profile-card.selected .profile-check { opacity: 1; transform: scale(1); }
.profile-check svg { stroke: #000; }
```

- [ ] **Step 2: Verificar visualmente no navegador**

Abrir `src/screens/login.html` diretamente no navegador (a etapa `#form-profile` já é a ativa por padrão). Confirmar:
- O card "RH" tem borda/ícone/glow em tom dourado ao passar o mouse.
- O card "Colaborador" tem borda/ícone/glow em tom azul ao passar o mouse.
- Ao clicar em um card, ele fica marcado como selecionado (borda colorida fixa, check com animação de escala aparecendo), e o botão "Continuar" é habilitado (isso já é feito por `login.js`, não deve ter regressão).
- Abrir o DevTools Console e confirmar que não há nenhum erro JS ao clicar nos cards.

- [ ] **Step 3: Commit**

```bash
git add src/styles/login.css
git commit -m "Adiciona estilo glassmorphism com identidade de cor por perfil aos cards de login"
```

---

### Task 2: Destaque no título da etapa de seleção de perfil

**Files:**
- Modify: `src/styles/login.css` (adicionar novo bloco logo após a regra `.form-subtitle strong { ... }`, por volta da linha 153)

**Interfaces:**
- Consumes: tokens `--accent-gold`, `--accent-blue` (`login.css:7-24`); seletor existente `#form-profile` (`login.html:50`) e `.form-title` (`login.html:51`).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Adicionar override de título escopado a `#form-profile`**

Em `src/styles/login.css`, logo após a regra `.form-subtitle strong { color: var(--text); font-weight: 500; }` (linha 153), adicionar:

```css
#form-profile .form-title {
    font-size: 1.5rem;
    font-weight: 700;
    position: relative;
    padding-left: 14px;
}

#form-profile .form-title::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 3px;
    border-radius: 2px;
    background: linear-gradient(180deg, var(--accent-gold), var(--accent-blue));
}
```

- [ ] **Step 2: Verificar visualmente no navegador**

Recarregar `src/screens/login.html`. Confirmar que o título "Como deseja acessar?" está maior, mais forte (peso 700), com uma barrinha vertical à esquerda em degradê dourado→azul. Confirmar que os outros títulos da tela (ex.: "Bem-vindo de volta" no login, "Esqueceu sua senha?" na recuperação) **não** mudaram — o seletor é escopado a `#form-profile`.

- [ ] **Step 3: Commit**

```bash
git add src/styles/login.css
git commit -m "Adiciona destaque visual ao título da etapa de seleção de perfil"
```

---

### Task 3: Refinar o efeito de vidro do painel esquerdo (badge e tagline)

**Files:**
- Modify: `src/styles/login.css:80-110` (`.panel-left-badge`, `.panel-left-tagline`)

**Interfaces:**
- Consumes: nenhuma nova — apenas propriedades CSS padrão.
- Produces: nenhuma interface nova.

- [ ] **Step 1: Atualizar `.panel-left-badge`**

Em `src/styles/login.css`, substituir o bloco `.panel-left-badge { ... }` (linhas 80-93) por:

```css
.panel-left-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255,255,255,0.12);
    backdrop-filter: blur(14px) saturate(160%);
    -webkit-backdrop-filter: blur(14px) saturate(160%);
    border: 1px solid rgba(255,255,255,0.22);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.25);
    border-radius: 100px;
    padding: 5px 12px;
    font-size: 12px;
    color: rgba(255,255,255,0.9);
    margin-bottom: 1rem;
    width: fit-content;
}
```

- [ ] **Step 2: Atualizar `.panel-left-tagline`**

Substituir o bloco `.panel-left-tagline { ... }` (linhas 104-110) por:

```css
.panel-left-tagline {
    font-family: 'Syne', sans-serif;
    font-size: 1.5rem;
    font-weight: 600;
    color: #fff;
    line-height: 1.3;
    text-shadow: 0 2px 16px rgba(0,0,0,0.35);
}
```

- [ ] **Step 3: Verificar visualmente no navegador**

Recarregar `src/screens/login.html`. Confirmar que o badge "Sistema ativo" tem um vidro mais nítido (blur mais forte, borda com leve brilho) e que a tagline "Gestão de pessoas, simplificada." mantém legibilidade sobre a foto, com uma sombra suave dando profundidade. Confirmar que a foto de fundo e o overlay de gradiente não mudaram.

- [ ] **Step 4: Commit**

```bash
git add src/styles/login.css
git commit -m "Refina efeito de vidro do badge e tagline do painel esquerdo do login"
```

---

### Task 4: Checagem final de responsividade e regressão

**Files:**
- None (verificação apenas)

**Interfaces:**
- Consumes: todo o resultado das Tasks 1-3.
- Produces: nenhuma.

- [ ] **Step 1: Testar nos breakpoints existentes**

Com o DevTools aberto em `src/screens/login.html`, usar o modo responsivo e verificar nas larguras 1024px, 800px (tablet), 600px (mobile) e 380px (mobile pequeno) que:
- Os cards de perfil continuam lado a lado (grid 2 colunas) e legíveis, sem overflow de texto.
- O glow/sombra dos cards não corta de forma estranha nas bordas do container `.card`.
- No breakpoint ≤480px, o painel esquerdo (`.panel-left`) some conforme já previsto em `login.css:798`, então badge/tagline não precisam ser checados nesse tamanho.

- [ ] **Step 2: Testar o fluxo completo sem regressão**

Clicar em "RH", depois em "Continuar", confirmar que avança para a etapa de login (`#form-login`) normalmente. Clicar em "Voltar", confirmar que volta para `#form-profile` sem nenhum card marcado como selecionado (mesmo comportamento de antes, via `login.js:131`).

- [ ] **Step 3: Commit final (se houver ajustes)**

Se algum ajuste foi feito durante a checagem, commitar:

```bash
git add src/styles/login.css
git commit -m "Ajustes finais de responsividade na tela de seleção de perfil"
```

Se nenhum ajuste foi necessário, este passo é apenas a confirmação de que as Tasks 1-3 já cobrem os critérios de sucesso da spec.

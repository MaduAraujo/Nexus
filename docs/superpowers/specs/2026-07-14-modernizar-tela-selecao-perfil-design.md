# Modernizar tela "Como deseja acessar?" (seleção de perfil no login)

## Contexto

A tela de login (`src/screens/login.html`, `src/styles/login.css`) tem uma etapa de seleção de perfil (`#form-profile`) onde o usuário escolhe entre "RH" e "Colaborador" antes de fazer login. O visual atual é funcional mas genérico: cards planos com fundo sólido (`--surface-2`), ícone em caixa com um único acento azul para ambos os perfis, e sem diferenciação visual entre os dois tipos de acesso.

Escopo: apenas a etapa de seleção de perfil (`#form-profile`) e o painel esquerdo (`.panel-left`), que é compartilhado por todas as etapas do login. Não altera as etapas de login/senha, primeiro acesso ou recuperação de senha, nem lógica em `login.js`.

## Direção visual: Glassmorphism com identidade por perfil

Reaproveita os tokens de cor já existentes em `login.css` (`--accent-gold` para RH, `--accent-blue` para Colaborador), hoje declarados mas sem uso real nos cards. Sem bibliotecas novas — CSS puro, mantendo o projeto vanilla.

### 1. Cards de perfil (`.profile-card`)

- Fundo translúcido (`rgba` sobre `--surface-2` + leve transparência) com `backdrop-filter: blur(12px)`.
- Borda semitransparente que acende na cor do perfil ao hover/seleção: dourado (`--accent-gold`) para RH, azul (`--accent-blue`) para Colaborador — cada card usa sua própria variável de acento em vez do azul único atual.
- Ícone dentro de um "orbe" de vidro: círculo com gradiente sutil (radial, tom do acento do perfil) + blur, em vez da caixa quadrada com cantos arredondados atual.
- Sombra em camadas (duas `box-shadow` sobrepostas: uma mais próxima/escura, uma mais distante/colorida na cor do perfil) para dar profundidade.
- Elevação no hover: `transform: translateY(-2px)` a `-3px`, transição suave.
- Estado selecionado: borda e sombra na cor do perfil ficam fixas (mesmo sem hover); o `.profile-check` (badge de confirmação) ganha uma pequena animação de escala (`scale(0) → scale(1)` com easing) ao ser marcado, em vez do fade de opacidade atual.

### 2. Título, subtítulo e botão (`.form-title`, `.form-subtitle`, `.btn-continue`)

- Título ligeiramente maior, com leve destaque de cor (ex.: peso maior ou um detalhe cromático discreto no texto), mantendo a fonte Syne já usada.
- Subtítulo permanece simples, sem mudança estrutural.
- Botão "Continuar" **permanece neutro** (não muda de cor conforme o perfil selecionado) — mantém o estilo outline atual (`.btn-continue`), apenas revisando espaçamento/raio se necessário para combinar com o novo peso visual dos cards.

### 3. Painel esquerdo (`.panel-left`)

- Mudança sutil, sem elementos decorativos novos sobre a foto (sem blobs flutuantes).
- Badge "Sistema ativo" (`.panel-left-badge`) e tagline ganham um refinamento do efeito de vidro já existente: mais blur (`backdrop-filter`), borda com leve brilho, para alinhar com a linguagem visual dos cards — sem alterar a foto de fundo, o overlay de gradiente existente, ou a estrutura do conteúdo.

## Fora de escopo

- Etapas de login/senha, primeiro acesso, recuperação de senha (`#form-login`, `#form-first-access`, `#form-forgot`).
- Lógica em `login.js` (seleção de perfil, navegação entre etapas) — nenhuma função ou id é alterado.
- Modal de criação de senha (`#create-pass-modal`).
- Breakpoints responsivos existentes são mantidos; ajustes de blur/sombra devem funcionar dentro deles sem novos breakpoints.

## Critério de sucesso

- Os dois cards são visualmente distintos (RH em tom dourado, Colaborador em tom azul) tanto no estado normal quanto no hover/selecionado.
- O efeito de vidro (translucidez + blur) é perceptível nos cards e no badge/tagline do painel esquerdo.
- Nenhuma regressão funcional: seleção de perfil, habilitação do botão Continuar e navegação para a etapa de login continuam funcionando (`selectProfile()`, `goToLogin()` em `login.js` inalterados).
- Visual permanece coerente nos breakpoints mobile/tablet já definidos em `login.css`.

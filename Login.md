# Tela de Login
O módulo de autenticação da Nexus foi projetado para oferecer uma experiência personalizada desde o primeiro contato, 
garantindo que a interface se adapte ao nível de permissão do usuário.

---

### Estrutura de Arquivos

```
nexus/
├── screens/
│   └── login.html          # Markup principal da tela
├── styles/
│   └── login.css           # Estilos da tela
├── javascript/
│   └── login.js            # Lógica e interações
└── assets/
    └── image.jpeg          # Imagem do painel esquerdo
```
---

### Diagramas do Fluxo

```mermaid
graph TD
    %% Estilização de Cores
    classDef default fill:#f9f9f9,stroke:#333,stroke-width:1px;
    classDef primary fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef warning fill:#fff3e0,stroke:#ef6c00,stroke-width:2px;
    classDef accent fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;

    Start(( )):::primary --> Profile{Seleção de Perfil}
    
    subgraph Portal_Entrada [Portal de Entrada]
        Profile -->|RH| Auth[Tela de Autenticação]:::primary
        Profile -->|Colaborador| Auth
    end

    subgraph Acoes [Ações Principais]
        Auth --> Login([Login]):::primary
        Auth --> Register([Cadastro]):::accent
    end

    subgraph Fluxo_Recuperacao [Fluxo de Recuperação de Senha]
        Login -.->|Esqueci a senha| Recover[Solicitar Reset]:::warning
        Recover --> S1[1. E-mail] --> S2[2. Código/Token] --> S3[3. Nova Senha] --> S4[4. Sucesso]:::success
        S4 --> Login
    end

    subgraph Detalhes_Cadastro [Requisitos de Cadastro]
        Register --> Fields[Campos: Nome, E-mail, Senha]
        Fields --> Val{Validação de Força}
        Val -->|Fraca| Fields
        Val -->|Forte| S5[Conta Criada]:::success
        S5 --> Login
    end

    Login --> Dashboard[Painel Nexus]:::success

    %% Notas de Estilo
    linkStyle default stroke:#555,stroke-width:1px;
```

---

```mermaid
graph LR
    A[Seleção de Perfil] --> B{Possui conta?}
    B -- Sim --> C[Login]
    B -- Não --> D[Cadastro]
    C --> E[Esqueceu a senha?]
    E --> F[Fluxo de Recuperação]
    F --> C
```

---

### Regras de Segurança e UX
* **Validação de Força de Senha:** O cadastro exige senhas com caracteres especiais, números e letras maiúsculas.
* **Feedback em Tempo Real:** Mensagens de erro para campos vazios ou formatos de e-mail inválidos.

---

### Tecnologias Utilizadas

- HTML
- CSS
- JavaScript

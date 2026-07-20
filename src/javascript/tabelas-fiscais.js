// Tabelas de INSS e IRRF usadas no cálculo da folha de pagamento (pagamentos.js).
// Atualize apenas os valores abaixo (e a respectiva "vigencia") a cada nova
// tabela publicada — a lógica de cálculo não precisa mudar.
//
// Fontes oficiais para conferência na atualização anual:
//   INSS:  Portaria Interministerial MPS/MF (reajuste do teto e faixas)
//   IRRF:  Instrução Normativa RFB (tabela progressiva mensal)
const TABELA_FISCAL = {
    // Contribuição do INSS (empregado CLT), no formato "alíquota efetiva com
    // parcela a deduzir": a primeira faixa cujo "limite" comporta o salário de
    // contribuição define a alíquota e a dedução. Acima do limite da última
    // faixa (teto do INSS), a contribuição fica congelada no valor do teto.
    inss: {
        vigencia: '2026-01',
        faixas: [
            { limite: 1621.00, aliquota: 0.075, deducao: 0 },
            { limite: 2902.84, aliquota: 0.090, deducao: 24.32 },
            { limite: 4354.27, aliquota: 0.120, deducao: 111.40 },
            { limite: 8475.55, aliquota: 0.140, deducao: 198.49 },
        ],
    },

    // Alíquota simplificada de INSS aplicada a Aprendiz (não segue a tabela acima).
    aprendizInssAliquota: 0.08,

    // Tabela progressiva mensal do IRRF: mesmo formato do INSS acima. A última
    // faixa cobre o restante (sem teto).
    irrf: {
        vigencia: '2026-01',
        faixas: [
            { limite: 2428.80,  aliquota: 0,     deducao: 0 },
            { limite: 2826.65,  aliquota: 0.075, deducao: 182.16 },
            { limite: 3751.05,  aliquota: 0.150, deducao: 394.16 },
            { limite: 4664.68,  aliquota: 0.225, deducao: 675.49 },
            { limite: Infinity, aliquota: 0.275, deducao: 908.73 },
        ],
    },
};

window.TABELA_FISCAL = TABELA_FISCAL;

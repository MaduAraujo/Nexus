const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
require('../src/javascript/domain/estagio-domain.js');
const { calcularRescisao, feriasVencidasNaRescisao } = require('../src/javascript/domain/calculo-rescisao.js');

const verba = (r, inicio) => r.verbas.find((v) => v.descricao.startsWith(inicio));

describe('férias vencidas na rescisão (CLT arts. 137 e 146)', () => {
    test('período com prazo de concessão perdido sai em dobro e o período recém-fechado sai simples, mesmo na justa causa', () => {
        const r = calcularRescisao({
            tipo: 'justa_causa',
            salario: 3000,
            admissao: new Date(2023, 0, 10),
            demissao: new Date(2026, 0, 20),
            diasFeriasGozados: 30,
        });
        assert.deepEqual(r.feriasVencidas, { simples: 30, dobro: 30 });
        assert.equal(verba(r, 'Férias Vencidas (CLT art. 146)').valor, 3000);
        assert.equal(verba(r, '1/3 Constitucional sobre Férias Vencidas').valor, 1000);
        assert.equal(verba(r, 'Férias Vencidas em Dobro').valor, 6000);
        assert.equal(verba(r, '1/3 Constitucional sobre Férias em Dobro').valor, 2000);
        assert.equal(r.totalVerbas, 14000);
    });

    test('quando o aviso projetado completa o período aquisitivo, as férias desse período viram vencidas e as proporcionais recomeçam', () => {
        const r = calcularRescisao({
            tipo: 'sem_justa_causa',
            salario: 3000,
            admissao: new Date(2025, 1, 10),
            demissao: new Date(2026, 0, 20),
        });
        assert.deepEqual(r.feriasVencidas, { simples: 30, dobro: 0 });
        assert.equal(verba(r, 'Férias Proporcionais').dias, '0/12');
        assert.equal(verba(r, 'Férias Vencidas (CLT art. 146)').valor, 3000);
    });

    test('dias já gozados (inclusive abono) abatem os períodos mais antigos primeiro', () => {
        const admissao = new Date(2022, 0, 10);
        assert.deepEqual(feriasVencidasNaRescisao({ admissao, dataProjetada: new Date(2026, 0, 20), demissao: new Date(2026, 0, 20), diasGozados: 70 }), {
            simples: 30,
            dobro: 20,
        });
        assert.deepEqual(feriasVencidasNaRescisao({ admissao, dataProjetada: new Date(2023, 0, 9), demissao: new Date(2023, 0, 9) }), { simples: 0, dobro: 0 });
    });
});

describe('aviso prévio do empregado no pedido de demissão (CLT art. 487 §2º)', () => {
    const base = { tipo: 'pedido_demissao', salario: 3000, admissao: new Date(2025, 5, 1), demissao: new Date(2026, 0, 20) };

    test('não cumprido: desconta 30 dias de salário', () => {
        const r = calcularRescisao({ ...base, avisoEmpregado: 'descontar' });
        assert.equal(verba(r, 'Desconto do Aviso Prévio').valor, -3000);
        assert.equal(verba(r, 'Desconto do Aviso Prévio').dias, 30);
    });

    test('cumprido ou dispensado pela empresa: sem desconto', () => {
        assert.equal(verba(calcularRescisao({ ...base, avisoEmpregado: 'cumprido' }), 'Desconto do Aviso Prévio'), undefined);
        assert.equal(verba(calcularRescisao({ ...base, avisoEmpregado: 'dispensado' }), 'Desconto do Aviso Prévio'), undefined);
    });

    test('só vale para o pedido de demissão comum, não para os outros tipos', () => {
        assert.equal(verba(calcularRescisao({ ...base, tipo: 'sem_justa_causa', avisoEmpregado: 'descontar' }), 'Desconto do Aviso Prévio'), undefined);
        assert.equal(verba(calcularRescisao({ ...base, contractType: 'aprendiz', avisoEmpregado: 'descontar' }), 'Desconto do Aviso Prévio'), undefined);
        assert.equal(
            verba(calcularRescisao({ ...base, contractType: 'prazo determinado', avisoEmpregado: 'descontar' }), 'Desconto do Aviso Prévio'),
            undefined
        );
    });
});

describe('remuneração da rescisão', () => {
    test('adicional de periculosidade/insalubridade entra no saldo de salário, no FGTS e na hora do banco', () => {
        const r = calcularRescisao({
            tipo: 'justa_causa',
            salario: 3000,
            adicionalFixo: 900,
            admissao: new Date(2025, 5, 1),
            demissao: new Date(2026, 0, 20),
            saldoBancoHorasMin: 60,
            jornadaMin: 480,
        });
        assert.equal(verba(r, 'Saldo de Salário').valor, 2600);
        assert.equal(verba(r, 'Saldo de Banco de Horas').valor, 19.5);
        assert.equal(r.adicionalFixo, 900);
        assert.equal(r.fgtsEstimado, +(3900 * 0.08 * 7).toFixed(2));
    });

    test('médias habituais entram no aviso prévio indenizado (CLT art. 487 §3º)', () => {
        const r = calcularRescisao({
            tipo: 'sem_justa_causa',
            salario: 3000,
            mediaAdicionaisHabituais: 300,
            admissao: new Date(2025, 5, 1),
            demissao: new Date(2026, 0, 20),
        });
        assert.equal(verba(r, 'Aviso Prévio Indenizado').valor, 3300);
    });

    test('informa o prazo de pagamento: 10 dias após o fim do contrato (CLT art. 477 §6º)', () => {
        const r = calcularRescisao({ tipo: 'sem_justa_causa', salario: 3000, admissao: new Date(2025, 5, 1), demissao: new Date(2026, 0, 25) });
        assert.equal(r.prazoPagamento, '2026-02-04');
    });
});

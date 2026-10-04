const pad0 = (n) => String(n).padStart(2, '0');

let currentMonth = '';
let currentSearch = '';
let currentDept = '';
let currentDeptHol = '';
let allRows = [];
let employees = [];
let payslips = [];
let feriasDoMes = {};
let feriasNoMes = {};
let recibosFerias = [];
let rhUser = null;
let currentSlipData = null;
const selectedIds = new Set();
let lastRescisaoCalc = null;
let bancoVencimentoMeses = 6;

document.addEventListener('DOMContentLoaded', async () => {
    setLoading(true);
    try {
        const auth = await NexusAuth.requireProfile('Administrador');
        if (!auth) return;
        rhUser = auth.user;

        setupExportDropdown();
        setupDeptFilterDropdown('dept-filter-dropdown', 'btn-dept-filter', 'dept-filter-menu', 'dept-filter-chevron');
        setupDeptFilterDropdown('dept-hol-filter-dropdown', 'btn-dept-hol-filter', 'dept-hol-filter-menu', 'dept-hol-filter-chevron');
        setupRescisaoDatePicker();
        setupRescisaoEmpSelect();
        setupRescisaoTipoToggle();
        setupDecimoTerceiroToggle();

        const now = new Date();
        currentMonth = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
        setupCustomMonthPicker();

        await refresh();
        setupRealtimeSync();
    } finally {
        setLoading(false);
    }
});

function setLoading(show) {
    const el = document.getElementById('page-loader');
    if (show) el.classList.add('active');
    else el.classList.remove('active');
}

async function loadData() {
    const [{ data: empData, error: empErr }, { data: slipData, error: slipErr }, { data: vacData }, { data: reciboData }, { data: settingsData }] =
        await Promise.all([
            sb
                .from('employees_decrypted')
                .select(
                    'id,name,cpf,role,dept,salary,contract_type,work_load,admission_date,email,vale_transporte,valor_passagem,conducoes_dia,vale_refeicao,vale_alimentacao,avatar_url,estagio_avaliacoes,contract_end_date,possui_dependentes,qtd_dependentes,adicional_periculosidade,grau_insalubridade,estabilidade_ate,estabilidade_motivo,pensao_alimenticia,tipo_pensao,pensao_valor'
                )
                .in('status', ['Ativo', 'ativo'])
                .order('name'),
            sb.from('payslips_decrypted').select('*').eq('mes', currentMonth),
            sb
                .from('vacations')
                .select('employee_id,start_date,end_date,days,abono')
                .in('status', ['aprovado', 'concluido'])
                .lte('start_date', lastDayOfMonthKey(currentMonth))
                .gte('end_date', `${currentMonth}-01`),
            sb
                .from('payslips_decrypted')
                .select('*')
                .gte('mes', `${prevMonthKey(currentMonth)}-F`)
                .lt('mes', `${currentMonth}-G`),
            sb.from('hr_settings').select('banco_horas_vencimento_meses').eq('id', 1).maybeSingle(),
        ]);
    bancoVencimentoMeses = Number(settingsData?.banco_horas_vencimento_meses) || 6;

    if (empErr) console.error('Erro ao carregar colaboradores:', empErr.message);
    if (slipErr) console.error('Erro ao carregar holerites:', slipErr.message);

    employees = (empData || []).map((e) => ({
        id: e.id,
        name: e.name,
        cpf: e.cpf,
        role: e.role,
        dept: e.dept,
        salary: e.salary,
        contractType: e.contract_type,
        workLoad: e.work_load,
        estagioAvaliacoes: e.estagio_avaliacoes,
        admissionDate: e.admission_date,
        contractEndDate: e.contract_end_date,
        email: e.email,
        valeTransporte: e.vale_transporte ? 'sim' : 'nao',
        valorPassagem: e.valor_passagem,
        conducoesdia: e.conducoes_dia,
        benValeRefeicao: e.vale_refeicao ? String(e.vale_refeicao) : null,
        benValeAlimentacao: e.vale_alimentacao ? String(e.vale_alimentacao) : null,
        avatarUrl: e.avatar_url,
        dependentes: e.possui_dependentes ? Number(e.qtd_dependentes) || 0 : 0,
        adicionalPericulosidade: !!e.adicional_periculosidade,
        grauInsalubridade: e.grau_insalubridade || null,
        estabilidadeAte: e.estabilidade_ate || null,
        estabilidadeMotivo: e.estabilidade_motivo || null,
        pensao: e.pensao_alimenticia && Number(e.pensao_valor) > 0 ? { tipo: e.tipo_pensao || 'percentual', valor: Number(e.pensao_valor) } : null,
    }));
    payslips = slipData || [];
    recibosFerias = (reciboData || []).filter((r) => /^\d{4}-\d{2}-F\d{2}$/.test(r.mes));
    feriasDoMes = {};
    feriasNoMes = {};
    (vacData || []).forEach((v) => {
        (feriasNoMes[v.employee_id] ??= []).push(v);
        if (v.start_date.slice(0, 7) === currentMonth) (feriasDoMes[v.employee_id] ??= []).push(v);
    });
}

async function refresh() {
    setLoading(true);
    try {
        await loadData();
        populateDeptFilters();
        buildFolhaRows();
        selectedIds.clear();
        renderFolha();
        renderHolerites();
        renderRecibosFerias();
        loadKPIs();
        atualizarPrevias();
    } finally {
        setLoading(false);
    }
}

function calcINSS(salBase) {
    return window.Impostos.calcINSS(salBase);
}

function calcIRRF(base) {
    return window.Impostos.calcIRRF(base);
}

function calcIRRFMensal(params) {
    return window.Impostos.calcIRRFMensal(params);
}

function irrfEPensao({ pensao, rendimento, inss, dependentes }) {
    if (!pensao) return { irrf: calcIRRFMensal({ rendimento, inss, dependentes }), pensao: 0 };
    return window.Impostos.calcPensaoAlimenticia({ ...pensao, rendimento, inss, dependentes });
}

function descontoPensao(valor, pensao) {
    const referencia =
        pensao.tipo === 'valor-fixo' ? 'Valor fixo' : pensao.tipo === 'salario-minimo' ? `${pensao.valor}% do salário mínimo` : `${pensao.valor}% do líquido`;
    return { cod: '907', descricao: 'Pensão alimentícia (decisão judicial)', referencia, valor };
}

function adicionalRiscoEmp(emp) {
    const ct = emp?.contractType;
    if (CLTDomain.isPJ(ct) || CLTDomain.isEstagio(ct)) return null;
    return CLTDomain.adicionalRisco({
        salario: Number(emp.salary) || 0,
        periculosidade: !!emp.adicionalPericulosidade,
        grauInsalubridade: emp.grauInsalubridade,
        salarioMinimo: TABELA_FISCAL.salarioMinimo.valor,
    });
}

function parseCurrency(str) {
    if (!str) return 0;
    return (
        parseFloat(
            String(str)
                .replace(/[^\d,]/g, '')
                .replace(',', '.')
        ) || 0
    );
}

function calcRow(emp) {
    const salary = Number(emp.salary) || 0;
    const ct = (emp.contractType || 'clt').toLowerCase();
    const isPJ = ct === 'pj';
    const isEstagio = CLTDomain.isEstagio(ct);
    let inss = 0,
        irrf = 0,
        pensao = 0,
        benef = 0,
        descVT = 0,
        adicional = 0;

    if (!isPJ) {
        adicional = adicionalRiscoEmp(emp)?.valor || 0;
        const tributavel = salary + adicional;
        inss = isEstagio ? 0 : calcINSS(tributavel);
        ({ irrf, pensao } = irrfEPensao({ pensao: emp.pensao, rendimento: tributavel, inss, dependentes: emp.dependentes }));

        if (emp.benValeRefeicao) benef += parseCurrency(emp.benValeRefeicao) * 22;
        if (emp.benValeAlimentacao) benef += parseCurrency(emp.benValeAlimentacao);

        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia || '2', 10);
            const valPass = parseCurrency(emp.valorPassagem || '0');
            const vtBruto = +(valPass * condDia * 22).toFixed(2);
            descVT = +Math.min(salary * CLTDomain.VALE_TRANSPORTE_DESCONTO_MAX_PERCENTUAL, vtBruto).toFixed(2);
            benef += vtBruto;
        }
    }
    benef = +benef.toFixed(2);
    const bruto = +(salary + adicional + benef).toFixed(2);
    const liquido = +(bruto - inss - irrf - descVT - pensao).toFixed(2);
    return { salary, inss, irrf, benef, bruto, descontos: +(inss + irrf + descVT + pensao).toFixed(2), liquido, isPJ };
}

const EVENTOS_PRESERVADOS = ['040', '041', '042', '043'];
const COD_FERIAS_TRIBUTAVEIS = ['040', '041'];

function proventosFeriasLegado(existingSlip) {
    return (existingSlip?.proventos || []).filter((p) => EVENTOS_PRESERVADOS.includes(p.cod));
}

const somaCods = (lista, cods) =>
    +lista
        .filter((x) => cods.includes(x.cod))
        .reduce((s, x) => s + Number(x.valor), 0)
        .toFixed(2);

function recibosDoColaborador(empId) {
    return recibosFerias.filter((r) => r.employee_id === empId);
}

function feriasNaCompetencia(recibos, monthKey) {
    let base = 0,
        inssRetido = 0;
    recibos.forEach((r) => {
        const inss901 = r.descontos.filter((d) => d.cod === '901');
        if (inss901.some((d) => d.competencia)) {
            inss901
                .filter((d) => d.competencia === monthKey)
                .forEach((d) => {
                    base += Number(d.base);
                    inssRetido += Number(d.valor);
                });
        } else if (r.mes.startsWith(monthKey)) {
            base += somaCods(r.proventos, COD_FERIAS_TRIBUTAVEIS);
            inssRetido += somaCods(r.descontos, ['901']);
        }
    });
    return { base: +base.toFixed(2), inssRetido: +inssRetido.toFixed(2) };
}

function calcImpostosMes({ contractType, baseMensal, baseFerias = 0, inssRetidoRecibo = 0, irrfFeriasNoRecibo = false, dependentes = 0, pensao = null }) {
    const isEstagio = CLTDomain.isEstagio(contractType);
    const mensal = Math.max(0, +Number(baseMensal).toFixed(2));
    const ferias = Math.max(0, +Number(baseFerias).toFixed(2));
    const base = +(mensal + ferias).toFixed(2);
    const inss = isEstagio ? 0 : calcINSS(base);
    const inssFerias = base > 0 && inss > 0 ? +((inss * ferias) / base).toFixed(2) : 0;
    const { irrf, pensao: valorPensao } = irrfEPensao({ pensao, rendimento: mensal, inss: inss - inssFerias, dependentes });
    const irrfFerias = !ferias || irrfFeriasNoRecibo ? 0 : calcIRRFMensal({ rendimento: ferias, inss: inssFerias, dependentes });
    const inssDevido = Math.max(0, +(inss - inssRetidoRecibo).toFixed(2));

    const descontos = [];
    if (inssDevido > 0) {
        const ref = `${((inss / base) * 100).toFixed(1)}%`;
        const descricao = inssRetidoRecibo > 0 ? 'INSS (salário + férias, menos o retido no recibo)' : ferias ? 'INSS (salário + férias)' : 'INSS';
        descontos.push({ cod: '901', descricao, referencia: ref, valor: inssDevido });
    }
    if (irrf > 0) descontos.push({ cod: '902', descricao: 'IRRF', referencia: 'Tabela', valor: irrf });
    if (irrfFerias > 0) descontos.push({ cod: '906', descricao: 'IRRF sobre Férias', referencia: 'Tabela', valor: irrfFerias });
    if (valorPensao > 0) descontos.push(descontoPensao(valorPensao, pensao));
    return { inss, inssFerias, irrf, irrfFerias, pensao: valorPensao, descontos };
}

function validarTributacaoFerias(slip, contractType) {
    if (String(contractType || 'clt').toLowerCase() === 'pj') return null;
    const temFerias = slip.proventos.some((p) => COD_FERIAS_TRIBUTAVEIS.includes(p.cod) && Number(p.valor) > 0);
    if (!temFerias) return null;
    if (slip.descontos.some((d) => d.cod === '901' && Number(d.valor) > 0)) return null;
    return 'Holerite com férias sem desconto de INSS — recalcule antes de fechar.';
}

async function buildPayslipData(emp, monthKey, existingSlip = null) {
    const calc = calcRow(emp);
    const [year, monthNum] = monthKey.split('-');
    const month = parseInt(monthNum, 10);

    const estagio = CLTDomain.isEstagio(emp.contractType);
    const diasSalario = calc.isPJ || estagio ? 30 : CLTDomain.diasSalarioNoMes(feriasNoMes[emp.id] || [], monthKey);
    const salarioMes = diasSalario === 30 ? calc.salary : +((calc.salary / 30) * diasSalario).toFixed(2);
    const proventos = [];
    if (salarioMes > 0 || diasSalario === 30)
        proventos.push({ cod: '001', descricao: estagio ? 'Bolsa de Estágio' : 'Salário Base', referencia: `${diasSalario} dias`, valor: salarioMes });
    const descontos = [];

    if (!calc.isPJ) {
        const diasBeneficio = CLTDomain.diasBeneficioNoMes(feriasNoMes[emp.id] || [], monthKey);
        if (emp.benValeRefeicao) {
            const vr = parseCurrency(emp.benValeRefeicao) * diasBeneficio;
            if (vr > 0) proventos.push({ cod: '010', descricao: 'Vale Refeição', referencia: `${diasBeneficio} dias`, valor: +vr.toFixed(2) });
        }
        if (emp.benValeAlimentacao) {
            const va = parseCurrency(emp.benValeAlimentacao);
            if (va > 0) proventos.push({ cod: '011', descricao: 'Vale Alimentação', referencia: 'Mensal', valor: va });
        }
        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia || '2', 10);
            const valPass = parseCurrency(emp.valorPassagem || '0');
            const vtBruto = +(valPass * condDia * diasBeneficio).toFixed(2);
            const descVT = estagio ? 0 : +Math.min(salarioMes * CLTDomain.VALE_TRANSPORTE_DESCONTO_MAX_PERCENTUAL, vtBruto).toFixed(2);
            if (vtBruto > 0) {
                proventos.push({ cod: '012', descricao: 'Vale Transporte', referencia: `${condDia} cond/dia · ${diasBeneficio} dias`, valor: vtBruto });
                if (descVT > 0) descontos.push({ cod: '903', descricao: 'Desc. Vale Transporte', referencia: '6%', valor: descVT });
            }
        }

        const risco = adicionalRiscoEmp(emp);
        let valorRisco = 0;
        if (risco) {
            valorRisco = diasSalario === 30 ? risco.valor : +((risco.valor / 30) * diasSalario).toFixed(2);
            if (valorRisco > 0) proventos.push({ cod: risco.cod, descricao: risco.descricao, referencia: `${diasSalario} dias`, valor: valorRisco });
        }

        const jornadaMin = getJornadaMinRH(emp);
        const { noturnoMin, feriadoMin, intervaloDeficitMin, feriadosDoMes } = await calcAdicionaisMes(emp.id, jornadaMin, monthKey, emp);
        const valorHora = (calc.salary + (risco?.valor || 0)) / CLTDomain.getDivisorHoraMensal(jornadaMin, emp.workLoad);
        let valorNoturno = 0,
            valorFeriado = 0,
            valorHoraExtra = 0,
            valorDsrVariaveis = 0;
        if (noturnoMin > 0) {
            valorNoturno = +((noturnoMin / 52.5) * valorHora * CLTDomain.ADICIONAL_NOTURNO_PERCENTUAL).toFixed(2);
            if (valorNoturno > 0)
                proventos.push({
                    cod: '020',
                    descricao: 'Adicional Noturno (20% — CLT art. 73, hora reduzida)',
                    referencia: `${(noturnoMin / 60).toFixed(1)}h reais`,
                    valor: valorNoturno,
                });
        }
        if (feriadoMin > 0) {
            valorFeriado = +((feriadoMin / 60) * valorHora * CLTDomain.ADICIONAL_DOMINGO_FERIADO_PERCENTUAL).toFixed(2);
            if (valorFeriado > 0)
                proventos.push({
                    cod: '021',
                    descricao: 'Adicional Domingo/Feriado Trabalhado (100% — Súmula 146 TST)',
                    referencia: `${(feriadoMin / 60).toFixed(1)}h`,
                    valor: valorFeriado,
                });
        }

        const bucketsHE = estagio ? [] : await bucketsBancoVencidos(emp, jornadaMin, monthKey);
        const minutosHE = bucketsHE.reduce((t, b) => t + b.minutos, 0);
        if (minutosHE > 0) {
            valorHoraExtra = +((minutosHE / 60) * valorHora * (1 + CLTDomain.ADICIONAL_HORA_EXTRA_PERCENTUAL)).toFixed(2);
            proventos.push({
                cod: '025',
                descricao: 'Horas Extras 50% — banco de horas vencido sem compensação (CLT art. 59 §§1º e 5º)',
                referencia: `${(minutosHE / 60).toFixed(1)}h`,
                valor: valorHoraExtra,
                buckets: bucketsHE,
            });
        }

        if (!estagio) {
            valorDsrVariaveis = CLTDomain.reflexoDsr(valorNoturno + valorHoraExtra, monthKey, feriadosDoMes);
            if (valorDsrVariaveis > 0)
                proventos.push({
                    cod: '026',
                    descricao: 'DSR sobre horas extras e adicional noturno (Lei 605/49 art. 7º; Súmula 172 TST)',
                    referencia: 'Mês',
                    valor: valorDsrVariaveis,
                });
        }

        if (intervaloDeficitMin > 0) {
            const valorIntervalo = +((intervaloDeficitMin / 60) * valorHora * CLTDomain.INTERVALO_INDENIZACAO_MULTIPLICADOR).toFixed(2);
            if (valorIntervalo > 0)
                proventos.push({
                    cod: '022',
                    descricao: 'Indenização de Intervalo Intrajornada (50% — CLT art. 71 §4º)',
                    referencia: `${(intervaloDeficitMin / 60).toFixed(1)}h`,
                    valor: valorIntervalo,
                });
        }

        const faltas = await window.NexusFaltas.listar(emp.id, `${monthKey}-01`, lastDayOfMonthKey(monthKey), { workLoad: emp.workLoad });
        const faltaCalc = CLTDomain.descontoFaltasDsr({ salario: calc.salary + (risco?.valor || 0), faltas });
        const falta = estagio ? { ...faltaCalc, semanas: 0, valorDsr: 0 } : faltaCalc;
        if (falta.valorFaltas > 0)
            descontos.push({
                cod: '905',
                descricao: 'Faltas injustificadas',
                referencia: `${falta.dias} dia${falta.dias > 1 ? 's' : ''}`,
                valor: falta.valorFaltas,
            });
        if (falta.valorDsr > 0)
            descontos.push({
                cod: '904',
                descricao: 'Desconto de DSR (falta injustificada — Lei 605/49 art. 6º)',
                referencia: `${falta.semanas} semana${falta.semanas > 1 ? 's' : ''}`,
                valor: falta.valorDsr,
            });

        const legado = proventosFeriasLegado(existingSlip);
        proventos.push(...legado);
        const recibos = recibosDoColaborador(emp.id);
        const ferias = feriasNaCompetencia(recibos, monthKey);
        const impostos = calcImpostosMes({
            contractType: emp.contractType,
            baseMensal: salarioMes + valorRisco + valorNoturno + valorFeriado + valorHoraExtra + valorDsrVariaveis - falta.valorFaltas - falta.valorDsr,
            baseFerias: somaCods(legado, COD_FERIAS_TRIBUTAVEIS) + ferias.base,
            inssRetidoRecibo: ferias.inssRetido,
            irrfFeriasNoRecibo: ferias.base > 0 && !legado.length,
            dependentes: emp.dependentes,
            pensao: emp.pensao,
        });
        descontos.push(...impostos.descontos);
    } else {
        proventos.push(...proventosFeriasLegado(existingSlip));
    }

    const totalProventos = +proventos.reduce((s, p) => s + Number(p.valor), 0).toFixed(2);
    const totalDescontos = +descontos.reduce((s, d) => s + d.valor, 0).toFixed(2);
    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    return {
        employee_id: emp.id,
        mes: monthKey,
        mes_formatado: `${MESES[month - 1]} ${year}`,
        competencia: `${pad0(month)}/${year}`,
        proventos,
        descontos,
        total_proventos: totalProventos,
        total_descontos: totalDescontos,
        salario_liquido: +(totalProventos - totalDescontos).toFixed(2),
        status: 'publicado',
    };
}

function naFolha(emp) {
    return !CLTDomain.isTemporario(emp.contractType);
}

function buildFolhaRows() {
    allRows = employees.filter(naFolha).map((emp) => {
        const calc = calcRow(emp);
        const slip = payslips.find((p) => p.employee_id === emp.id) || null;
        const pago = slip?.status === 'pago';
        const gerado = !!slip;
        return { emp, calc, slip, pago, gerado };
    });
}

function resumoDoHolerite(slip, isPJ) {
    const soma = (lista, cods) =>
        +lista
            .filter((x) => cods.includes(x.cod))
            .reduce((s, x) => s + Number(x.valor), 0)
            .toFixed(2);
    return {
        salary: soma(slip.proventos, ['001']),
        inss: soma(slip.descontos, ['901']),
        irrf: soma(slip.descontos, ['902', '906']),
        benef: soma(slip.proventos, ['010', '011', '012']),
        bruto: Number(slip.total_proventos || 0),
        descontos: Number(slip.total_descontos || 0),
        liquido: Number(slip.salario_liquido || 0),
        isPJ,
    };
}

const PREVIAS_EM_PARALELO = 3;
let previasGeracao = 0;

async function calcularPrevias(rows, mes) {
    const fila = rows.slice();
    const trabalhador = async () => {
        for (let r = fila.shift(); r; r = fila.shift()) {
            try {
                const slip = r.pago ? r.slip : await buildPayslipData(r.emp, mes, r.slip);
                r.calc = resumoDoHolerite(slip, r.calc.isPJ);
            } catch (e) {
                console.error('Prévia do holerite:', e);
            }
        }
    };
    await Promise.all(Array.from({ length: PREVIAS_EM_PARALELO }, trabalhador));
}

async function atualizarPrevias() {
    const geracao = ++previasGeracao;
    const tbody = document.getElementById('folha-tbody');
    tbody?.removeAttribute('data-previa');
    await calcularPrevias(allRows, currentMonth);
    if (geracao !== previasGeracao) return;
    renderFolha();
    loadKPIs();
    tbody?.setAttribute('data-previa', 'ok');
}

function loadKPIs() {
    let totalBruto = 0,
        totalLiquido = 0,
        totalPagos = 0;
    allRows.forEach((r) => {
        totalBruto += r.calc.bruto;
        totalLiquido += r.calc.liquido;
        if (r.pago) totalPagos++;
    });
    setText('kpi-bruto', fmtCurrency(totalBruto));
    setText('kpi-liquido', fmtCurrency(totalLiquido));
    setText('kpi-colab', allRows.length);
    setText('kpi-pagos', `${totalPagos}/${allRows.length}`);

    const total = allRows.length;
    const allPaid = total > 0 && totalPagos === total;
    const pending = total - totalPagos;

    const statusCard = document.getElementById('stat-card-status');
    if (statusCard) {
        statusCard.classList.toggle('stat-card--complete', allPaid);
        if (total === 0) statusCard.title = 'Pagos — holerites quitados';
        else if (allPaid) statusCard.title = 'Pagos — folha encerrada';
        else if (pending === 1) statusCard.title = 'Pagos — 1 colaborador pendente';
        else statusCard.title = `Pagos — ${pending} colaboradores pendentes`;
    }
}

function applySearch() {
    const input = document.getElementById('search-input');
    currentSearch = (input?.value || '').toLowerCase().trim();
    document.getElementById('search-clear')?.classList.toggle('hidden', !input?.value.trim());
    renderFolha();
}
window.applySearch = applySearch;

window.clearSearch = function () {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    applySearch();
};

function renderFolha() {
    const tbody = document.getElementById('folha-tbody');
    const cardsEl = document.getElementById('folha-cards');

    const filtered = allRows.filter((r) => {
        if (r.pago) return false;
        if (currentSearch && !r.emp.name.toLowerCase().includes(currentSearch) && !(r.emp.dept || '').toLowerCase().includes(currentSearch)) return false;
        if (currentDept && (r.emp.dept || '') !== currentDept) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="table-empty"><i class="fas fa-circle-check"></i><p>Todos os colaboradores já foram pagos nesta competência.</p></div></td></tr>`;
        if (cardsEl)
            cardsEl.innerHTML = `<div class="table-empty"><i class="fas fa-circle-check"></i><p>Todos os colaboradores já foram pagos nesta competência.</p></div>`;
        setText('folha-count', '');
        updateSummary([]);
        updateSelectionUI(filtered);
        return;
    }

    tbody.innerHTML = filtered.map((r) => buildFolhaRow(r)).join('');
    if (cardsEl) cardsEl.innerHTML = filtered.map((r) => buildFolhaCard(r)).join('');
    const temporarios = employees.length - employees.filter(naFolha).length;
    const notaTemporarios = temporarios
        ? ` · ${temporarios} temporário${temporarios !== 1 ? 's' : ''} fora da folha: pago${temporarios !== 1 ? 's' : ''} pela empresa de trabalho temporário (Lei 6.019/1974)`
        : '';
    setText('folha-count', `${filtered.length} colaborador${filtered.length !== 1 ? 'es' : ''} na folha${notaTemporarios}`);
    updateSummary(filtered);
    updateSelectionUI(filtered);
}

function buildFolhaRow(r) {
    const { emp, calc } = r;
    const ini = initials(emp.name);
    const color = nameToColor(emp.name);
    const ct = (emp.contractType || 'CLT').toUpperCase();

    const statusBadge = `<span class="badge badge--pendente">Pendente</span>`;

    const ctBadge = calc.isPJ ? `<span class="badge badge--pj">PJ</span>` : `<span class="ct-label">${ct}</span>`;

    const isSelected = selectedIds.has(emp.id);

    return `<tr class="${isSelected ? 'row-selected' : ''}">
        <td class="td-check"><input type="checkbox" class="cb-row" data-emp-id="${emp.id}" aria-label="Selecionar ${escapeHtml(emp.name)}" ${isSelected ? 'checked' : ''} data-change="toggleRowSelect" data-change-args="${dargs(emp.id, { $: 'this' })}"></td>
        <td data-label="Colaborador"><div class="emp-cell">${empAvatarHtml(emp, ini, color)}<div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept || '—')}</p></div></div></td>
        <td data-label="Contrato">${ctBadge}</td>
        <td data-label="Bruto"><span class="val-blue">${fmtCurrency(calc.bruto)}</span></td>
        <td data-label="INSS"><span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.inss)}</span></td>
        <td data-label="IRRF"><span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.irrf)}</span></td>
        <td data-label="Benefícios">${calc.benef > 0 ? `<span class="val-blue">${fmtCurrency(calc.benef)}</span>` : '—'}</td>
        <td data-label="Líquido"><span class="val-green">${fmtCurrency(calc.liquido)}</span></td>
        <td data-label="Status">${statusBadge}</td>
    </tr>`;
}

function buildFolhaCard(r) {
    const { emp, calc } = r;
    const ini = initials(emp.name);
    const color = nameToColor(emp.name);
    const ct = (emp.contractType || 'CLT').toUpperCase();

    const statusBadge = `<span class="badge badge--pendente">Pendente</span>`;

    const ctBadge = calc.isPJ ? `<span class="badge badge--pj">PJ</span>` : `<span class="ct-label ct-label--sm">${ct}</span>`;

    const isSelected = selectedIds.has(emp.id);

    return `<div class="folha-card-item${isSelected ? ' row-selected' : ''}">
        <div class="folha-card-top">
            <label class="folha-card-check">
                <input type="checkbox" class="cb-row" data-emp-id="${emp.id}" aria-label="Selecionar ${escapeHtml(emp.name)}" ${isSelected ? 'checked' : ''} data-change="toggleRowSelect" data-change-args="${dargs(emp.id, { $: 'this' })}">
            </label>
            <div class="emp-cell">
                ${empAvatarHtml(emp, ini, color)}
                <div>
                    <p class="emp-name">${escHtml(emp.name)}</p>
                    <p class="emp-dept">${escHtml(emp.dept || '—')}</p>
                </div>
            </div>
            ${statusBadge}
        </div>
        <div class="folha-card-badges">${ctBadge}</div>
        <div class="folha-card-grid">
            <div class="folha-card-stat">
                <span class="folha-card-stat-label">Bruto</span>
                <span class="val-blue">${fmtCurrency(calc.bruto)}</span>
            </div>
            <div class="folha-card-stat">
                <span class="folha-card-stat-label">INSS</span>
                <span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.inss)}</span>
            </div>
            <div class="folha-card-stat">
                <span class="folha-card-stat-label">IRRF</span>
                <span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.irrf)}</span>
            </div>
            <div class="folha-card-stat">
                <span class="folha-card-stat-label">Benefícios</span>
                ${calc.benef > 0 ? `<span class="val-blue">${fmtCurrency(calc.benef)}</span>` : '<span>—</span>'}
            </div>
        </div>
        <div class="folha-card-total">
            <span>Líquido</span>
            <span class="val-green">${fmtCurrency(calc.liquido)}</span>
        </div>
    </div>`;
}

window.toggleRowSelect = function (empId, cb) {
    if (cb.checked) selectedIds.add(empId);
    else selectedIds.delete(empId);
    renderFolha();
};

window.toggleSelectAll = function (headerCb) {
    const visibleIds = getVisibleIds();
    if (headerCb.checked) visibleIds.forEach((id) => selectedIds.add(id));
    else visibleIds.forEach((id) => selectedIds.delete(id));
    renderFolha();
};

window.limparSelecao = function () {
    selectedIds.clear();
    renderFolha();
};

function getVisibleIds() {
    return Array.from(document.querySelectorAll('#folha-tbody .cb-row'))
        .map((cb) => cb.dataset.empId)
        .filter(Boolean);
}

function syncHeaderCheckbox(visibleIds) {
    const headerCb = document.getElementById('select-all-cb');
    const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
    if (selectedVisible.length === 0) {
        headerCb.checked = false;
        headerCb.indeterminate = false;
    } else if (selectedVisible.length === visibleIds.length) {
        headerCb.checked = true;
        headerCb.indeterminate = false;
    } else {
        headerCb.checked = false;
        headerCb.indeterminate = true;
    }
}

function updateSelectionUI(filtered) {
    const visibleIds = filtered.map((r) => r.emp.id);
    syncHeaderCheckbox(visibleIds);
    showBulkBar();
}

function showBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    const n = selectedIds.size;
    if (n > 0) {
        bar.classList.add('visible');
        if (count) count.textContent = `${n} colaborador${n !== 1 ? 'es' : ''} selecionado${n !== 1 ? 's' : ''}`;
    } else {
        bar.classList.remove('visible');
    }
}

window.marcarSelecionadosPagos = async function () {
    if (!selectedIds.size) return;
    const rows = allRows.filter((r) => selectedIds.has(r.emp.id) && !r.pago);
    if (!rows.length) {
        showToast('Todos os selecionados já estão pagos.', 'info');
        return;
    }
    setLoading(true);
    try {
        const pagoEm = new Date().toISOString();
        const slipsData = await Promise.all(
            rows.map(async (r) => ({
                ...(await buildPayslipData(r.emp, currentMonth, r.slip)),
                status: 'pago',
                pago_em: pagoEm,
                created_by: rhUser?.id,
            }))
        );
        const bloqueio = rows.map((r, i) => validarTributacaoFerias(slipsData[i], r.emp.contractType) && r.emp.name).find(Boolean);
        if (bloqueio) {
            showToast(`${bloqueio}: holerite com férias sem desconto de INSS — não foi fechado.`, 'error');
            return;
        }
        const { error } = await sb.from('payslips').upsert(slipsData, { onConflict: 'employee_id,mes' });
        if (error) {
            showToast(`Erro: ${error.message}`, 'error');
            return;
        }
        const erroBaixa = await baixarHorasExtrasPagas(slipsData, currentMonth);
        if (erroBaixa)
            showToast(
                `Folha fechada, mas as horas extras pagas não foram baixadas do banco de horas (${erroBaixa.message}). Lance o débito manualmente para não pagar duas vezes.`,
                'warning'
            );
        rows.forEach((r) => {
            r.pago = true;
            r.gerado = true;
        });
        loadKPIs();
        showToast(
            `${rows.length} colaborador${rows.length !== 1 ? 'es' : ''} marcado${rows.length !== 1 ? 's' : ''} como pago${rows.length !== 1 ? 's' : ''}.`,
            'success'
        );
        await refresh();
    } catch (e) {
        showToast(`Não foi possível fechar a folha: ${e.message}`, 'error');
    } finally {
        setLoading(false);
    }
};

function updateSummary(rows) {
    let bruto = 0,
        inss = 0,
        irrf = 0,
        benef = 0,
        liquido = 0;
    rows.forEach((r) => {
        bruto += r.calc.salary;
        inss += r.calc.inss;
        irrf += r.calc.irrf;
        benef += r.calc.benef;
        liquido += r.calc.liquido;
    });
    setText('sum-bruto', fmtCurrency(bruto));
    setText('sum-inss', fmtCurrency(inss));
    setText('sum-irrf', fmtCurrency(irrf));
    setText('sum-benef', fmtCurrency(benef));
    setText('sum-liquido', fmtCurrency(liquido));
}

function applyHolSearch() {
    const input = document.getElementById('search-hol');
    document.getElementById('search-hol-clear')?.classList.toggle('hidden', !input?.value.trim());
    renderHolerites((input?.value || '').toLowerCase().trim(), currentDeptHol);
}
window.applyHolSearch = applyHolSearch;

window.clearHolSearch = function () {
    const input = document.getElementById('search-hol');
    if (input) input.value = '';
    document.getElementById('search-hol-clear')?.classList.add('hidden');
    applyHolSearch();
};

function renderHolerites(q = '', dept = '') {
    const tbody = document.getElementById('hol-tbody');
    const cardsEl = document.getElementById('hol-cards');

    const filtered = allRows.filter((r) => {
        if (!r.pago) return false;
        if (q && !r.emp.name.toLowerCase().includes(q) && !(r.emp.dept || '').toLowerCase().includes(q)) return false;
        if (dept && (r.emp.dept || '') !== dept) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="table-empty"><i class="fas fa-file-invoice"></i><p>Nenhum holerite pago nesta competência.</p></div></td></tr>`;
        if (cardsEl) cardsEl.innerHTML = `<div class="table-empty"><i class="fas fa-file-invoice"></i><p>Nenhum holerite pago nesta competência.</p></div>`;
        setText('hol-count', '');
        return;
    }

    const [year, monthNum] = currentMonth.split('-');
    const monthLabel = new Date(+year, parseInt(monthNum) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const competLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    tbody.innerHTML = filtered.map((r) => buildHolRow(r, competLabel)).join('');
    if (cardsEl) cardsEl.innerHTML = filtered.map((r) => buildHolCard(r, competLabel)).join('');

    setText('hol-count', `${filtered.length} colaborador${filtered.length !== 1 ? 'es' : ''}`);
}

function buildHolRow(r, competLabel) {
    const { emp, slip } = r;
    const ini = initials(emp.name);
    const color = nameToColor(emp.name);

    const statusBadge = `<span class="badge badge--pago">Pago</span>`;

    return `<tr>
        <td data-label="Colaborador"><div class="emp-cell">${empAvatarHtml(emp, ini, color)}<div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept || '—')}</p></div></div></td>
        <td data-label="Competência">${competLabel}</td>
        <td data-label="Líquido"><span class="val-green">${fmtCurrency(slip.salario_liquido)}</span></td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Ações"><div class="actions-cell">
            <button class="btn-action btn-action--view" data-click="verHolerite" data-click-args="${dargs(emp.id)}" title="Ver holerite">
                <i class="fas fa-eye"></i>
            </button>
        </div></td>
    </tr>`;
}

function buildHolCard(r, competLabel) {
    const { emp, slip } = r;
    const ini = initials(emp.name);
    const color = nameToColor(emp.name);

    const statusBadge = `<span class="badge badge--pago">Pago</span>`;

    return `<div class="folha-card-item">
        <div class="folha-card-top">
            <div class="emp-cell">
                ${empAvatarHtml(emp, ini, color)}
                <div>
                    <p class="emp-name">${escHtml(emp.name)}</p>
                    <p class="emp-dept">${escHtml(emp.dept || '—')}</p>
                </div>
            </div>
            ${statusBadge}
        </div>
        <div class="folha-card-grid folha-card-grid--1col">
            <div class="folha-card-stat">
                <span class="folha-card-stat-label">Competência</span>
                <span>${competLabel}</span>
            </div>
        </div>
        <div class="folha-card-total">
            <span>Líquido</span>
            <span class="val-green">${fmtCurrency(slip.salario_liquido)}</span>
        </div>
        <button type="button" class="btn-secondary folha-card-btn" data-click="verHolerite" data-click-args="${dargs(emp.id)}">
            <i class="fas fa-eye"></i> Ver Holerite
        </button>
    </div>`;
}

function linhasRecibosFerias() {
    const E = window.EventosFolha;
    const linhas = recibosFerias
        .filter((slip) => slip.mes.startsWith(currentMonth))
        .map((slip) => ({ slip, emp: employees.find((e) => e.id === slip.employee_id), inicio: E.inicioDoReciboFerias(slip.mes) }));
    Object.entries(feriasDoMes).forEach(([empId, lista]) =>
        lista.forEach((v) => {
            if (linhas.some((l) => l.emp?.id === empId && l.inicio === v.start_date)) return;
            const emp = employees.find((e) => e.id === empId);
            const semRecibo = !emp || (emp.contractType || '').toLowerCase() === 'pj' || CLTDomain.isEstagio(emp.contractType);
            if (!semRecibo) linhas.push({ slip: null, emp, inicio: v.start_date, ferias: v });
        })
    );
    return linhas.filter((l) => l.emp).sort((a, b) => a.inicio.localeCompare(b.inicio));
}

function renderRecibosFerias() {
    const box = document.getElementById('recibos-ferias');
    const list = document.getElementById('recibos-ferias-list');
    const linhas = linhasRecibosFerias();
    box.classList.toggle('hidden', !linhas.length);
    const hoje = todayKeyRH();
    const fmt = (iso) => iso.split('-').reverse().join('/');
    list.innerHTML = linhas
        .map(({ slip, emp, inicio, ferias }) => {
            const ate = window.EventosFolha.pagarFeriasAte(inicio);
            let status, acoes;
            if (!slip) {
                status = '<span class="badge badge--pendente">Sem recibo</span>';
                acoes = `<button type="button" class="btn-recibo" data-click="emitirReciboFerias" data-click-args="${dargs(emp.id, ferias.start_date)}"><i class="fas fa-file-circle-plus"></i> Emitir recibo</button>`;
            } else {
                const pago = slip.status === 'pago';
                status = pago
                    ? '<span class="badge badge--pago">Pago</span>'
                    : ate < hoje
                      ? '<span class="badge badge--atrasado">Atrasado</span>'
                      : '<span class="badge badge--gerado">A pagar</span>';
                acoes = `<button type="button" class="btn-recibo btn-recibo--sec" data-click="verReciboFerias" data-click-args="${dargs(slip.id)}"><i class="fas fa-eye"></i> Ver</button>${
                    pago
                        ? ''
                        : `<button type="button" class="btn-recibo" data-click="pagarReciboFerias" data-click-args="${dargs(slip.id)}"><i class="fas fa-check"></i> Marcar pago</button>`
                }`;
            }
            return `<div class="recibo-item" data-emp-id="${emp.id}">
                <div class="recibo-info">
                    <p class="recibo-nome">${escapeHtml(emp.name)}</p>
                    <p class="recibo-meta">Gozo a partir de ${fmt(inicio)} · pagar até ${fmt(ate)}${slip ? ` · líquido ${fmtCurrency(slip.salario_liquido)}` : ''}</p>
                </div>
                ${status}
                <div class="recibo-acoes">${acoes}</div>
            </div>`;
        })
        .join('');
}

function todayKeyRH() {
    const d = new Date();
    return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())}`;
}

window.emitirReciboFerias = async function (empId, startDate) {
    const emp = employees.find((e) => e.id === empId);
    const v = (feriasDoMes[empId] || []).find((x) => x.start_date === startDate);
    if (!emp || !v) return;
    const mediaVariaveis = await calcMediaAdicionaisHabituais(empId, startDate).catch(() => 0);
    const recibo = window.EventosFolha.reciboFerias({
        contractType: emp.contractType,
        salario: emp.salary,
        startDate,
        dias: v.days,
        abono: v.abono,
        adicionalFixo: adicionalRiscoEmp(emp)?.valor || 0,
        mediaVariaveis,
        dependentes: emp.dependentes,
    });
    if (!recibo) return;
    const { error } = await sb.rpc('apply_ferias_recibo', {
        p_employee_id: empId,
        p_mes: recibo.mes,
        p_mes_formatado: recibo.mesFormatado,
        p_competencia: recibo.competencia,
        p_proventos: recibo.proventos,
        p_descontos: recibo.descontos,
    });
    if (error) {
        showToast(`Erro: ${error.message}`, 'error');
        return;
    }
    showToast(`Recibo de férias de ${emp.name} emitido — pagar até ${recibo.pagarAte.split('-').reverse().join('/')}.`, 'success');
    await refresh();
};

window.pagarReciboFerias = async function (slipId) {
    const slip = recibosFerias.find((r) => r.id === slipId);
    if (!slip) return;
    const { error } = await sb.from('payslips').update({ status: 'pago', pago_em: new Date().toISOString() }).eq('id', slipId);
    if (error) {
        showToast(`Erro: ${error.message}`, 'error');
        return;
    }
    showToast('Recibo de férias marcado como pago.', 'success');
    await refresh();
};

window.verReciboFerias = function (slipId) {
    const slip = recibosFerias.find((r) => r.id === slipId);
    const emp = slip && employees.find((e) => e.id === slip.employee_id);
    if (!slip || !emp) return;
    renderSlipModal(emp, slip);
    document.getElementById('slip-bank-info')?.classList.add('hidden');
    currentSlipData = { emp, slip };
    openModal('slip-modal');
    NexusAuth.logAccess(emp.id, 'holerite', slip.mes_formatado || slip.mes);
};

window.verHolerite = function (empId) {
    const row = allRows.find((r) => r.emp.id === empId);
    if (!row || !row.slip) return;
    renderSlipModal(row.emp, row.slip);
    renderSlipBankInfo(row.emp, row.slip);
    currentSlipData = { emp: row.emp, slip: row.slip };
    openModal('slip-modal');
    NexusAuth.logAccess(empId, 'holerite', row.slip.competencia || row.slip.mes);
};

function renderSlipModal(emp, slip) {
    const sub = document.getElementById('slip-modal-sub');
    if (sub) sub.textContent = `${emp.name} — ${slip.competencia}`;

    const body = document.getElementById('slip-modal-body');

    const provRows = slip.proventos
        .map(
            (p) =>
                `<tr>
            <td>${p.cod}</td>
            <td>${escHtml(p.descricao)}</td>
            <td class="td-ref">${escapeHtml(p.referencia)}</td>
            <td class="td-val">${fmtCurrency(p.valor)}</td>
        </tr>`
        )
        .join('');

    const descRows = slip.descontos
        .map(
            (d) =>
                `<tr>
            <td>${d.cod}</td>
            <td>${escHtml(d.descricao)}</td>
            <td class="td-ref">${escapeHtml(d.referencia)}</td>
            <td class="td-val td-val--neg">${fmtCurrency(d.valor)}</td>
        </tr>`
        )
        .join('');

    const isPago = slip.status === 'pago';

    body.innerHTML = `
    <div class="slip-header">
        <div class="slip-header-top">
            <div>
                <div class="slip-company">Nexus RH</div>
                <div class="slip-company-sub">Sistema de Gestão de Recursos Humanos</div>
            </div>
            <div class="slip-period">Competência ${escapeHtml(slip.competencia)}</div>
        </div>
        <div class="slip-employee-row">
            <div class="slip-field"><span class="slip-field-label">Nome</span><span class="slip-field-value">${escHtml(emp.name)}</span></div>
            <div class="slip-field"><span class="slip-field-label">Cargo</span><span class="slip-field-value">${escHtml(emp.role || '—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Departamento</span><span class="slip-field-value">${escHtml(emp.dept || '—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Contrato</span><span class="slip-field-value">${escHtml(emp.contractType || 'CLT')}</span></div>
            ${emp.admissionDate ? `<div class="slip-field"><span class="slip-field-label">Admissão</span><span class="slip-field-value">${fmtDate(emp.admissionDate)}</span></div>` : ''}
        </div>
        ${isPago ? `<div class="slip-status-stamp"><i class="fas fa-circle-check"></i> <span class="slip-status-stamp-label">PAGAMENTO EFETUADO</span></div>` : ''}
    </div>

    <p class="slip-section-title">Proventos</p>
    <div class="slip-table-wrap">
    <table class="slip-table">
        <thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th>Valor (R$)</th></tr></thead>
        <tbody>${provRows || '<tr><td colspan="4" class="td-empty">Nenhum provento</td></tr>'}</tbody>
    </table>
    </div>

    <p class="slip-section-title">Descontos</p>
    <div class="slip-table-wrap">
    <table class="slip-table">
        <thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th>Valor (R$)</th></tr></thead>
        <tbody>${descRows || '<tr><td colspan="4" class="td-empty">Nenhum desconto</td></tr>'}</tbody>
    </table>
    </div>

    <div class="slip-totals">
        <div class="slip-total-box blue">
            <div class="slip-total-label">Total Proventos</div>
            <div class="slip-total-value">${fmtCurrency(slip.total_proventos)}</div>
        </div>
        <div class="slip-total-box red">
            <div class="slip-total-label">Total Descontos</div>
            <div class="slip-total-value">${fmtCurrency(slip.total_descontos)}</div>
        </div>
        <div class="slip-total-box green">
            <div class="slip-total-label">Salário Líquido</div>
            <div class="slip-total-value">${fmtCurrency(slip.salario_liquido)}</div>
        </div>
    </div>
    <div class="slip-bank-info hidden" id="slip-bank-info"></div>`;
}

function getJornadaMinRH(emp) {
    return CLTDomain.resolveJornadaMin({ contractType: emp?.contractType, workLoad: emp?.workLoad });
}

function jornadaNoDiaRH(jornadaMin, dataISO, emp) {
    return CLTDomain.jornadaNoDia(jornadaMin, dataISO, { contractType: emp?.contractType, avaliacoes: emp?.estagioAvaliacoes });
}

function diffMinRH(a, b) {
    return CLTDomain.diffMin(a, b);
}

let holidaysCacheRH = null;
async function getHolidaysMapRH() {
    if (holidaysCacheRH) return holidaysCacheRH;
    const { data } = await sb.from('holidays').select('date,name,abrangencia');
    holidaysCacheRH = {};
    (data || []).forEach((h) => {
        holidaysCacheRH[h.date] = h;
    });
    return holidaysCacheRH;
}

function isSundayRH(dateKey) {
    return CLTDomain.isSunday(dateKey);
}

function workSegmentsRH(r) {
    return CLTDomain.workSegments(r);
}

function calcIntervaloDeficitMinRH(rec, jornadaMin) {
    return CLTDomain.calcIntervaloDeficitMin(rec, jornadaMin);
}

async function calcAdicionaisMes(empId, jornadaMin, monthKey, emp) {
    const [{ data: recs }, holidaysMap] = await Promise.all([
        sb
            .from('time_records')
            .select('date,entrada,saida_almoco,retorno_almoco,saida')
            .eq('employee_id', empId)
            .gte('date', `${monthKey}-01`)
            .lt('date', nextMonthKey(monthKey)),
        getHolidaysMapRH(),
    ]);
    let noturnoMin = 0,
        feriadoMin = 0,
        intervaloDeficitMin = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        const segs = workSegmentsRH(r);
        noturnoMin += CLTDomain.noturnoMinRegistro(r);
        if (isSundayRH(r.date) || holidaysMap[r.date]) {
            segs.forEach(([s, e]) => {
                feriadoMin += diffMinRH(s, e);
            });
        }
        intervaloDeficitMin += calcIntervaloDeficitMinRH(r, jornadaNoDiaRH(jornadaMin, r.date, emp));
    });
    const feriadosDoMes = CLTDomain.feriadosQueContam(Object.values(holidaysMap)).filter((d) => d.startsWith(monthKey));
    return { noturnoMin, feriadoMin, intervaloDeficitMin, feriadosDoMes };
}

async function bucketsBancoVencidos(emp, jornadaMin, monthKey) {
    if (jornadaMin === null) return [];
    const fim = lastDayOfMonthKey(monthKey);
    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('date,entrada,saida_almoco,retorno_almoco,saida').eq('employee_id', emp.id).lte('date', fim),
        sb.from('bank_adjustments').select('tipo,minutos,date').eq('employee_id', emp.id).lte('date', fim).is('deleted_at', null),
    ]);
    const porMes = {};
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        const mk = r.date.slice(0, 7);
        porMes[mk] = (porMes[mk] || 0) + CLTDomain.calcWorkedMin(r) - jornadaNoDiaRH(jornadaMin, r.date, emp);
    });
    (adjs || []).forEach((a) => {
        const mk = a.date.slice(0, 7);
        porMes[mk] = (porMes[mk] || 0) + (a.tipo === 'credito' ? a.minutos : -a.minutos);
    });
    return CLTDomain.bucketsVencidosNoMes(porMes, bancoVencimentoMeses, monthKey);
}

async function baixarHorasExtrasPagas(slipsData, monthKey) {
    const competencia = monthKey.split('-').reverse().join('/');
    const linhas = slipsData.flatMap((slip) =>
        slip.proventos
            .filter((p) => p.cod === '025')
            .flatMap((p) =>
                (p.buckets || []).map((b) => ({
                    employee_id: slip.employee_id,
                    tipo: 'debito',
                    minutos: b.minutos,
                    date: `${b.mk}-01`,
                    justificativa: `Pago como hora extra 50% na folha de ${competencia} (banco vencido — CLT art. 59 §5º)`,
                    created_by_name: 'Folha de pagamento',
                }))
            )
    );
    if (!linhas.length) return null;
    const { error } = await sb.from('bank_adjustments').insert(linhas);
    return error || null;
}

async function renderSlipBankInfo(emp, slip) {
    const el = document.getElementById('slip-bank-info');
    const jornadaMin = getJornadaMinRH(emp);
    if (jornadaMin === null || !/^\d{4}-\d{2}$/.test(slip.mes)) {
        el.classList.add('hidden');
        return;
    }

    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb
            .from('time_records')
            .select('date,entrada,saida_almoco,retorno_almoco,saida')
            .eq('employee_id', emp.id)
            .gte('date', `${slip.mes}-01`)
            .lt('date', nextMonthKey(slip.mes)),
        sb
            .from('bank_adjustments')
            .select('tipo,minutos')
            .eq('employee_id', emp.id)
            .gte('date', `${slip.mes}-01`)
            .lt('date', nextMonthKey(slip.mes))
            .is('deleted_at', null),
    ]);
    let net = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        net += CLTDomain.calcWorkedMin(r) - jornadaNoDiaRH(jornadaMin, r.date, emp);
    });
    (adjs || []).forEach((a) => {
        net += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });

    const abs = Math.abs(net),
        h = Math.floor(abs / 60),
        m = String(abs % 60).padStart(2, '0');
    const sinal = net > 0 ? '+' : net < 0 ? '-' : '';
    el.innerHTML = `<i class="fas fa-clock"></i> Saldo do banco de horas na competência ${escapeHtml(slip.competencia) || slip.mes} (referência, não incluso nos totais acima): <strong>${sinal}${h}h ${m}min</strong>`;
    el.className = `slip-bank-info ${net > 0 ? 'positivo' : net < 0 ? 'negativo' : ''}`;
}

async function getRecessoGozadoDias(empId, ateDataStr) {
    const { data } = await sb.from('vacations').select('days').eq('employee_id', empId).in('status', ['aprovado', 'concluido']).lte('start_date', ateDataStr);
    return (data || []).reduce((s, v) => s + (Number(v.days) || 0), 0);
}

async function getSaldoBancoHorasReal(empId, jornadaMin, ateDataStr, emp) {
    if (jornadaMin === null) return 0;
    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('date,entrada,saida_almoco,retorno_almoco,saida').eq('employee_id', empId).lte('date', ateDataStr),
        sb.from('bank_adjustments').select('tipo,minutos').eq('employee_id', empId).lte('date', ateDataStr).is('deleted_at', null),
    ]);
    let net = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        net += CLTDomain.calcWorkedMin(r) - jornadaNoDiaRH(jornadaMin, r.date, emp);
    });
    (adjs || []).forEach((a) => {
        net += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });
    return net;
}

async function calcMediaAdicionaisHabituais(empId, ateDataStr) {
    const [ateAno, ateMes] = ateDataStr.split('-');
    const desdeKey = `${Number(ateAno) - 1}-${ateMes}`;
    const ateKey = ateDataStr.slice(0, 7);

    const { data: slips } = await sb.from('payslips_decrypted').select('mes,proventos').eq('employee_id', empId).gte('mes', desdeKey).lt('mes', ateKey);
    return window.EventosFolha.mediaVariaveisDosHolerites(slips || []);
}

async function getDiasFeriasConsumidos(empId, ateDataStr) {
    const { data } = await sb
        .from('vacations')
        .select('days,abono')
        .eq('employee_id', empId)
        .in('status', ['aprovado', 'concluido'])
        .lte('start_date', ateDataStr);
    return (data || []).reduce((s, v) => s + CLTDomain.diasConsumidosFerias(v), 0);
}

function nextMonthKey(monthKey) {
    return CLTDomain.nextMonthKey(monthKey);
}

function prevMonthKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}`;
}

function lastDayOfMonthKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return `${monthKey}-${pad0(new Date(y, m, 0).getDate())}`;
}

let lastDecimoTerceiroCalc = null;

function setupDecimoTerceiroToggle() {
    const toggle = document.getElementById('dt-parcela-toggle');
    const hidden = document.getElementById('dt-parcela');
    toggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-toggle-card');
        if (!btn) return;
        hidden.value = btn.dataset.parcela;
        toggle.querySelectorAll('.type-toggle-card').forEach((c) => c.classList.toggle('active', c === btn));
    });
}

window.openDecimoTerceiroModal = function () {
    document.getElementById('dt-ano').value = String(new Date().getFullYear());
    document.getElementById('dt-parcela').value = '1';
    document.querySelectorAll('#dt-parcela-toggle .type-toggle-card').forEach((c) => c.classList.toggle('active', c.dataset.parcela === '1'));
    const errEl = document.getElementById('dt-error');
    if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
    }
    document.getElementById('dt-result').innerHTML = '';
    document.getElementById('dt-result').classList.add('hidden');
    document.getElementById('btn-gerar-decimo-terceiro').classList.add('hidden');
    document.getElementById('btn-gerar-decimo-terceiro').disabled = true;
    lastDecimoTerceiroCalc = null;
    openModal('decimo-terceiro-modal');
};

window.calcularDecimoTerceiroModal = async function () {
    const errEl = document.getElementById('dt-error');
    const resultEl = document.getElementById('dt-result');
    const genBtn = document.getElementById('btn-gerar-decimo-terceiro');
    errEl.textContent = '';
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    genBtn.classList.add('hidden');
    genBtn.disabled = true;
    lastDecimoTerceiroCalc = null;

    const ano = parseInt(document.getElementById('dt-ano')?.value, 10);
    const parcela = parseInt(document.getElementById('dt-parcela')?.value, 10);
    if (!ano || ano < 2000 || ano > 2100) {
        errEl.textContent = 'Informe um ano válido.';
        errEl.classList.remove('hidden');
        return;
    }

    const elegiveis = employees.filter((e) => e.admissionDate && window.EventosFolha.isElegivel13(e.contractType) && Number(e.salary) > 0);
    if (!elegiveis.length) {
        errEl.textContent = 'Nenhum colaborador elegível ao 13º encontrado (PJ e Estágio não entram; o 13º do temporário é pago pela agência).';
        errEl.classList.remove('hidden');
        return;
    }

    const medias = await Promise.all(elegiveis.map((emp) => calcMediaAdicionaisHabituais(emp.id, `${ano}-12-31`).catch(() => 0)));
    const rows = elegiveis
        .map((emp, i) => {
            const { avos, valorIntegral } = window.EventosFolha.calcDecimoTerceiroIntegral({
                salario: Number(emp.salary) + (adicionalRiscoEmp(emp)?.valor || 0),
                admissaoISO: emp.admissionDate,
                anoBase: ano,
                mediaAdicionaisHabituais: medias[i],
            });
            if (avos <= 0 || valorIntegral <= 0) return null;
            const { valor: valorParcela } = window.EventosFolha.calcParcela13({ valorIntegral, parcela });
            let inss = 0,
                irrf = 0;
            if (parcela === 2) {
                inss = calcINSS(valorIntegral);
                irrf = calcIRRFMensal({ rendimento: valorIntegral, inss, dependentes: emp.dependentes });
            }
            const liquido = +(valorParcela - inss - irrf).toFixed(2);
            return { emp, avos, valorIntegral, valorParcela, inss, irrf, liquido };
        })
        .filter(Boolean);

    if (!rows.length) {
        errEl.textContent = 'Nenhum colaborador tem meses suficientes de trabalho neste ano.';
        errEl.classList.remove('hidden');
        return;
    }

    const totalLiquido = +rows.reduce((s, r) => s + r.liquido, 0).toFixed(2);
    resultEl.innerHTML = `
        <div class="dt-summary">
            <div><span>Colaboradores</span><strong>${rows.length}</strong></div>
            <div><span>Total líquido</span><strong>${fmtCurrency(totalLiquido)}</strong></div>
        </div>
        <div class="dt-list">
            ${rows
                .map(
                    (r) => `<div class="dt-row">
                <span class="dt-row-name">${escapeHtml(r.emp.name)}</span>
                <span class="dt-row-avos">${r.avos}/12</span>
                <span class="dt-row-value">${fmtCurrency(r.liquido)}</span>
            </div>`
                )
                .join('')}
        </div>`;
    resultEl.classList.remove('hidden');
    genBtn.classList.remove('hidden');
    genBtn.disabled = false;
    lastDecimoTerceiroCalc = { ano, parcela, rows };
};

window.gerarDecimoTerceiro = async function () {
    if (!lastDecimoTerceiroCalc) return;
    const { ano, parcela, rows } = lastDecimoTerceiroCalc;
    const btn = document.getElementById('btn-gerar-decimo-terceiro');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando…';
    }

    const mes = `${ano}-13-${parcela}`;
    const descricaoParcela = parcela === 1 ? '1ª Parcela' : '2ª Parcela';
    const slipsData = rows.map((r) => {
        const proventos = [
            { cod: parcela === 1 ? '030' : '031', descricao: `13º Salário (${descricaoParcela})`, referencia: `${r.avos}/12`, valor: r.valorParcela },
        ];
        const descontos = [];
        if (r.inss > 0) descontos.push({ cod: '901', descricao: 'INSS sobre 13º', referencia: 'Tabela', valor: r.inss });
        if (r.irrf > 0) descontos.push({ cod: '902', descricao: 'IRRF sobre 13º', referencia: 'Tabela', valor: r.irrf });
        return {
            employee_id: r.emp.id,
            mes,
            mes_formatado: `13º Salário — ${descricaoParcela} ${ano}`,
            competencia: `13/${ano}`,
            proventos,
            descontos,
            total_proventos: r.valorParcela,
            total_descontos: +(r.inss + r.irrf).toFixed(2),
            salario_liquido: r.liquido,
            status: 'publicado',
            created_by: rhUser?.id,
        };
    });

    const { error } = await sb.from('payslips').upsert(slipsData, { onConflict: 'employee_id,mes' });
    if (error) {
        showToast(`Erro ao gerar 13º: ${error.message}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Gerar Holerites';
        }
        return;
    }
    showToast(`13º Salário (${descricaoParcela}) gerado para ${rows.length} colaborador${rows.length === 1 ? '' : 'es'}.`, 'success');
    closeModal('decimo-terceiro-modal');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Gerar Holerites';
    }
};

window.openRescisaoModal = function () {
    window.setRescisaoEmpOptions?.(employees);
    window.setRescisaoEmp?.('');
    document.getElementById('rescisao-admissao').value = '';
    document.getElementById('rescisao-salario').value = '';
    window.setRescisaoDate?.('');
    const tipoHidden = document.getElementById('rescisao-tipo');
    if (tipoHidden) tipoHidden.value = 'sem_justa_causa';
    document.querySelectorAll('#rescisao-tipo-toggle .type-toggle-card').forEach((c) => c.classList.toggle('active', c.dataset.tipo === 'sem_justa_causa'));
    setAvisoEmpregado('cumprido');
    const errEl = document.getElementById('rescisao-error');
    if (errEl) errEl.textContent = '';
    document.getElementById('rescisao-result')?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.add('hidden');
    document.getElementById('btn-calcular-rescisao')?.classList.remove('hidden');
    setRescisaoInputsDisabled(false);
    lastRescisaoCalc = null;
    aplicarModoRescisaoPJ(false);
    aplicarModoRescisaoTemporario(false);
    aplicarModoRescisaoCards('clt');
    updateRescisaoBtnState();
    openModal('rescisao-modal');
};

function setRescisaoInputsDisabled(disabled) {
    document.getElementById('rescisao-emp-trigger').disabled = disabled;
    document.getElementById('rescisao-tipo-toggle')?.classList.toggle('disabled', disabled);
    document.getElementById('rescisao-aviso-toggle')?.classList.toggle('disabled', disabled);
    document.getElementById('rescisao-data-trigger').disabled = disabled;
}

function setAvisoEmpregado(valor) {
    const hidden = document.getElementById('rescisao-aviso-empregado');
    if (hidden) hidden.value = valor;
    document.querySelectorAll('#rescisao-aviso-toggle .type-toggle-card').forEach((c) => c.classList.toggle('active', c.dataset.aviso === valor));
}

window.onRescisaoEmpChange = function () {
    const empId = document.getElementById('rescisao-emp')?.value;
    const emp = employees.find((e) => e.id === empId);
    document.getElementById('rescisao-admissao').value = emp ? fmtDate(emp.admissionDate) : '';
    document.getElementById('rescisao-salario').value = emp ? fmtCurrency(emp.salary) : '';
    aplicarModoRescisaoPJ(CLTDomain.isPJ(emp?.contractType));
    aplicarModoRescisaoTemporario(CLTDomain.isTemporario(emp?.contractType));
    aplicarModoRescisaoCards(modoCardsRescisao(emp?.contractType));
    updateRescisaoBtnState();
};

const CARDS_RESCISAO_APRENDIZ = [
    ['aprendiz_termino', 'Término do Contrato', 'Fim do prazo ou 24 anos'],
    ['aprendiz_desempenho', 'Desempenho Insuficiente', 'Art. 433, I'],
    ['aprendiz_falta_grave', 'Falta Disciplinar Grave', 'Art. 433, II'],
    ['aprendiz_ausencia_escolar', 'Perda do Ano Letivo', 'Art. 433, III'],
    ['aprendiz_pedido', 'A Pedido do Aprendiz', 'Art. 433, IV'],
    ['aprendiz_sem_justa_causa', 'Dispensa Antecipada', 'Sem justa causa — art. 479'],
];
const CARDS_RESCISAO_PRAZO = [
    ['prazo_termino', 'Término do Contrato', 'Na data combinada'],
    ['prazo_sem_justa_causa', 'Dispensa Antecipada', 'Sem justa causa — art. 479'],
    ['prazo_pedido', 'Pedido Antecipado', 'Pelo empregado — art. 480'],
    ['prazo_justa_causa', 'Justa Causa', 'Art. 482'],
];
const MODOS_CARDS_RESCISAO = {
    aprendiz: { cards: CARDS_RESCISAO_APRENDIZ, padrao: 'aprendiz_termino', hint: 'rescisao-aprendiz-hint' },
    prazo: { cards: CARDS_RESCISAO_PRAZO, padrao: 'prazo_termino', hint: 'rescisao-prazo-hint' },
};
let cardsRescisaoCLT = null;
let modoRescisaoAtual = 'clt';

function modoCardsRescisao(contractType) {
    if (CLTDomain.isAprendiz(contractType)) return 'aprendiz';
    if (CLTDomain.isPrazoDeterminado(contractType)) return 'prazo';
    return 'clt';
}

function aplicarModoRescisaoCards(modo) {
    Object.entries(MODOS_CARDS_RESCISAO).forEach(([nome, cfg]) => document.getElementById(cfg.hint)?.classList.toggle('hidden', nome !== modo));
    const toggle = document.getElementById('rescisao-tipo-toggle');
    cardsRescisaoCLT ??= toggle.innerHTML;
    if (modo === modoRescisaoAtual) return;
    modoRescisaoAtual = modo;
    const cfg = MODOS_CARDS_RESCISAO[modo];
    const padrao = cfg ? cfg.padrao : 'sem_justa_causa';
    toggle.innerHTML = cfg
        ? cfg.cards
              .map(
                  ([tipo, titulo, sub]) =>
                      `<button type="button" class="type-toggle-card" data-tipo="${escapeHtml(tipo)}"><div class="type-toggle-body"><span class="type-toggle-title">${escapeHtml(titulo)}</span><span class="type-toggle-sub">${escapeHtml(sub)}</span></div></button>`
              )
              .join('')
        : cardsRescisaoCLT;
    document.getElementById('rescisao-tipo').value = padrao;
    toggle.querySelectorAll('.type-toggle-card').forEach((c) => c.classList.toggle('active', c.dataset.tipo === padrao));
}

function aplicarModoRescisaoTemporario(temporario) {
    document.getElementById('rescisao-temporario-hint')?.classList.toggle('hidden', !temporario);
    if (temporario) document.getElementById('rescisao-tipo-group')?.classList.add('hidden');
}

function aplicarModoRescisaoPJ(pj) {
    document.getElementById('rescisao-pj-hint')?.classList.toggle('hidden', !pj);
    document.getElementById('rescisao-tipo-group')?.classList.toggle('hidden', pj);
    const label = document.getElementById('rescisao-salario-label');
    if (label) label.textContent = pj ? 'Valor Mensal do Contrato' : 'Salário Bruto';
}

function updateRescisaoBtnState() {
    const btn = document.getElementById('btn-calcular-rescisao');
    const empId = document.getElementById('rescisao-emp').value;
    const tipo = document.getElementById('rescisao-tipo').value;
    const tipoVisivel = !document.getElementById('rescisao-tipo-group')?.classList.contains('hidden');
    document.getElementById('rescisao-aviso-empregado-group')?.classList.toggle('hidden', !(tipoVisivel && tipo === 'pedido_demissao'));
    const data = document.getElementById('rescisao-data')?.value || '';
    btn.disabled = !(empId && tipo && data);
}

window.calcularRescisaoModal = async function () {
    const errEl = document.getElementById('rescisao-error');
    const resultEl = document.getElementById('rescisao-result');
    const calcBtn = document.getElementById('btn-calcular-rescisao');
    if (errEl) errEl.textContent = '';
    resultEl?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.add('hidden');
    calcBtn?.classList.remove('hidden');
    setRescisaoInputsDisabled(false);
    lastRescisaoCalc = null;

    const empId = document.getElementById('rescisao-emp')?.value;
    const emp = employees.find((e) => e.id === empId);
    const dataStr = document.getElementById('rescisao-data')?.value;
    const tipo = document.getElementById('rescisao-tipo').value;

    if (!emp) {
        if (errEl) errEl.textContent = 'Selecione um colaborador.';
        return;
    }
    if (!emp.admissionDate) {
        if (errEl) errEl.textContent = 'Colaborador sem data de admissão cadastrada.';
        return;
    }
    if (!dataStr) {
        if (errEl) errEl.textContent = 'Informe a data de desligamento.';
        return;
    }

    const [ay, am, ad] = emp.admissionDate.split('-').map(Number);
    const admissao = new Date(ay, am - 1, ad);
    const [dy, dm, dd] = dataStr.split('-').map(Number);
    const demissao = new Date(dy, dm - 1, dd);

    if (demissao <= admissao) {
        if (errEl) errEl.textContent = 'A data de desligamento deve ser posterior à admissão.';
        return;
    }

    const salario = Number(emp.salary) || 0;
    if (salario <= 0) {
        if (errEl) errEl.textContent = 'Colaborador sem salário cadastrado.';
        return;
    }

    const estabilidade = CLTDomain.avaliarEstabilidade({
        estabilidadeAte: emp.estabilidadeAte,
        motivo: emp.estabilidadeMotivo,
        demissaoISO: dataStr,
        tipo,
    });
    if (estabilidade?.bloqueia) {
        if (errEl) errEl.textContent = estabilidade.mensagem;
        return;
    }

    const btnOriginalHTML = calcBtn?.innerHTML;
    if (calcBtn) {
        calcBtn.disabled = true;
        calcBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Apurando banco de horas…';
    }
    const jornadaMin = getJornadaMinRH(emp);
    let saldoBancoHorasMin = 0,
        mediaAdicionaisHabituais = 0,
        recessoGozadoDias = 0,
        diasFeriasGozados = 0;
    try {
        if (CLTDomain.isEstagio(emp.contractType)) recessoGozadoDias = await getRecessoGozadoDias(emp.id, dataStr);
        if (!CLTDomain.isPJ(emp.contractType))
            [saldoBancoHorasMin, mediaAdicionaisHabituais, diasFeriasGozados] = await Promise.all([
                getSaldoBancoHorasReal(emp.id, jornadaMin, dataStr, emp),
                calcMediaAdicionaisHabituais(emp.id, dataStr),
                getDiasFeriasConsumidos(emp.id, dataStr),
            ]);
    } catch (err) {
        console.error('Erro ao apurar banco de horas/médias habituais para a rescisão:', err.message);
    } finally {
        if (calcBtn) {
            calcBtn.disabled = false;
            calcBtn.innerHTML = btnOriginalHTML;
        }
    }

    const r = calcularRescisao({
        tipo,
        salario,
        admissao,
        demissao,
        saldoBancoHorasMin,
        jornadaMin,
        workLoad: emp.workLoad,
        mediaAdicionaisHabituais,
        contractType: emp.contractType,
        contratoFim: emp.contractEndDate ? new Date(`${emp.contractEndDate}T00:00:00`) : null,
        recessoGozadoDias,
        adicionalFixo: adicionalRiscoEmp(emp)?.valor || 0,
        diasFeriasGozados,
        avisoEmpregado: document.getElementById('rescisao-aviso-empregado')?.value || 'cumprido',
    });
    r.avisoEstabilidade = estabilidade?.mensagem || null;
    renderRescisaoResult(r);
    resultEl?.classList.remove('hidden');

    lastRescisaoCalc = { emp, dataStr, tipo, resultado: r };
    calcBtn?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.remove('hidden');
    setRescisaoInputsDisabled(true);
};

function gerarPdfRescisao(emp, r, dataStr) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFillColor(13, 14, 18);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(r.pj ? 'Nexus RH — Termo de Encerramento de Contrato PJ' : 'Nexus RH — Termo de Cálculo de Rescisão', 14, 14);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Colaborador: ${emp.name}`, 14, 30);
    doc.text(`${r.pj ? 'Tipo de encerramento' : 'Tipo de rescisão'}: ${r.label}`, 14, 36);
    doc.text(`Data de desligamento: ${fmtDate(dataStr)}`, 14, 42);
    doc.text(`Tempo de casa: ${r.anosCompletos} ano(s)`, 14, 48);

    doc.autoTable({
        startY: 56,
        head: [['Verba', 'Referência', 'Valor (R$)']],
        body: r.verbas.map((v) => [v.descricao, String(v.dias), fmtCurrency(v.valor)]),
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 9 },
        theme: 'striped',
        margin: { left: 14, right: 14 },
    });

    let finalY = doc.lastAutoTable.finalY + 6;
    if (r.encargos.length) {
        doc.autoTable({
            startY: finalY,
            head: [['Encargo da Empresa', 'Referência', 'Valor (R$)']],
            body: r.encargos.map((v) => [v.descricao, String(v.dias), fmtCurrency(v.valor)]),
            headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 9 },
            theme: 'striped',
            margin: { left: 14, right: 14 },
        });
        finalY = doc.lastAutoTable.finalY + 6;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Custo total do desligamento: ${fmtCurrency(r.custoTotal)}`, 14, finalY + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
        r.pj
            ? 'Contrato PJ: multas, aviso ou outras condições de encerramento seguem o contrato de prestação de serviços.'
            : r.temporario
              ? 'Trabalhador temporário: as verbas rescisórias são pagas pela empresa de trabalho temporário (Lei 6.019/1974).'
              : 'Estimativa gerada pelo simulador de rescisão do Nexus RH — não substitui o cálculo trabalhista oficial.',
        14,
        finalY + 12
    );

    return doc.output('blob');
}

window.confirmarDesligamento = async function () {
    if (!lastRescisaoCalc) return;
    const { emp, dataStr, tipo, resultado: r } = lastRescisaoCalc;

    if (
        !confirm(
            `Confirmar o desligamento de ${emp.name} em ${fmtDate(dataStr)}?\n\nIsso vai marcar o colaborador como Inativo e gerar um registro de auditoria e um documento de rescisão.`
        )
    )
        return;

    const btn = document.getElementById('btn-confirmar-desligamento');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando…';
    }

    try {
        if (typeof window.jspdf === 'undefined') {
            showToast('Biblioteca PDF não carregada.', 'error');
            return;
        }

        const { error: statusError } = await sb
            .from('employees')
            .update({ status: 'Inativo', termination_date: dataStr, termination_type: tipo })
            .eq('id', emp.id);
        if (statusError) {
            showToast(statusError.code === '23514' ? statusError.message : 'Não foi possível atualizar o status do colaborador.', 'error');
            return;
        }

        await sb
            .from('vacations')
            .update({ status: 'recusado', rejection_reason: 'Colaborador desligado pelo RH.', rejected_at: new Date().toISOString() })
            .eq('employee_id', emp.id)
            .eq('status', 'pendente');

        const blob = gerarPdfRescisao(emp, r, dataStr);
        const fileName = `rescisao_${emp.name.replace(/\s+/g, '_')}.pdf`;
        const storagePath = `rh/${Date.now()}_${fileName}`;

        const { error: uploadError } = await NexusFiles.upload('documents', storagePath, blob, { contentType: 'application/pdf', employeeId: emp.id });
        if (uploadError) {
            showToast('Colaborador desligado, mas não foi possível anexar o documento de rescisão.', 'warning');
        } else {
            const retidoAte = new Date();
            retidoAte.setFullYear(retidoAte.getFullYear() + 30);
            await sb.from('documents').insert({
                name: fileName,
                employee_id: emp.id,
                category: 'demissional',
                tipo: 'Termo de Rescisão',
                size_label: `${Math.round(blob.size / 1024)} KB`,
                storage_path: storagePath,
                source: 'Administrador',
                status: 'aprovado',
                created_by: rhUser.id,
                retido_ate: localISODate(retidoAte),
                lgpd_consentimento: true,
                lgpd_consentimento_em: new Date().toISOString(),
            });
        }

        await sb.from('employee_audit').insert({
            employee_id: emp.id,
            changes: [
                { field: 'status', label: 'Status', oldValue: 'Ativo', newValue: 'Inativo' },
                {
                    field: 'rescisao',
                    label: 'Rescisão',
                    oldValue: null,
                    newValue: {
                        tipo: r.label,
                        dataDesligamento: dataStr,
                        custoTotal: r.custoTotal,
                        totalVerbas: r.totalVerbas,
                        totalEncargos: r.totalEncargos,
                    },
                },
            ],
            operator_name: rhUser.email.split('@')[0],
            operator_email: rhUser.email,
        });

        showToast(`Desligamento confirmado: ${emp.name} foi inativado e o termo de rescisão foi anexado ao perfil.`, 'success');
        closeModal('rescisao-modal');
        await refresh();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-file-signature"></i> Confirmar Desligamento';
        }
    }
};

function renderRescisaoResult(r) {
    const el = document.getElementById('rescisao-result');

    const rows = (itens) =>
        itens.map((v) => `<tr><td>${escHtml(v.descricao)}</td><td class="td-ref">${v.dias}</td><td class="td-val">${fmtCurrency(v.valor)}</td></tr>`).join('');

    const encargosSection = r.encargos.length
        ? `
        <p class="slip-section-title">Encargos da Empresa</p>
        <div class="slip-table-wrap">
        <table class="slip-table">
            <thead><tr><th>Descrição</th><th>Referência</th><th class="th-num">Valor (R$)</th></tr></thead>
            <tbody>${rows(r.encargos)}</tbody>
        </table>
        </div>`
        : '';

    const avisoTermino = r.contratoFimAusente
        ? `<div class="modal-alert error"><i class="fas fa-exclamation-circle"></i> ${r.prazoDeterminado ? 'Contrato por prazo determinado' : 'Contrato de aprendizagem'} sem data de término no cadastro: a indenização do art. 479 (metade dos salários até o término) não foi calculada. Informe o término no cadastro e recalcule.</div>`
        : '';
    const avisoTemporario = r.temporario
        ? `<div class="modal-alert info"><i class="fas fa-people-arrows"></i> Trabalhador temporário (Lei 6.019/1974): o empregador é a empresa de trabalho temporário, que paga saldo de salário, 13º e férias proporcionais com 1/3 e libera o FGTS. Aqui só fica registrado o fim do trabalho na empresa e o acesso é encerrado. Se a agência não pagar, a empresa responde de forma subsidiária (art. 10 §7º).</div>`
        : '';
    const aviso480 = r.aviso480
        ? `<div class="modal-alert info"><i class="fas fa-circle-info"></i> Pedido antes do término (CLT art. 480): o empregado pode ter de indenizar os prejuízos que causar, limitados ao que receberia pelo art. 479. Esse desconto não entra na estimativa.</div>`
        : '';
    const avisoEstagio = r.estagio
        ? `<div class="modal-alert info"><i class="fas fa-user-graduate"></i> Estágio (Lei 11.788/2008): sem aviso prévio, 13º, FGTS ou multa. Recesso devido no período: ${r.recessoDevidoDias} dia(s), já gozados ${r.recessoGozadoDias}. Emita o termo de realização do estágio (art. 9º, V).</div>`
        : '';
    const avisoEstabilidade = r.avisoEstabilidade
        ? `<div class="modal-alert error"><i class="fas fa-shield-halved"></i> ${escHtml(r.avisoEstabilidade)}</div>`
        : '';
    const avisoPrazo =
        r.prazoPagamento && !r.temporario
            ? `<div class="modal-alert info"><i class="fas fa-calendar-check"></i> Pagar as verbas e entregar os documentos até ${fmtDate(r.prazoPagamento)} (CLT art. 477 §6º). Atrasar gera multa de um salário (art. 477 §8º).</div>`
            : '';
    el.innerHTML = `
        ${avisoEstabilidade}${avisoTermino}${avisoEstagio}${avisoTemporario}${aviso480}${avisoPrazo}
        <p class="slip-section-title">${r.pj ? 'Valores do Encerramento' : 'Verbas Rescisórias'}</p>
        <div class="slip-table-wrap">
        <table class="slip-table">
            <thead><tr><th>Descrição</th><th>Referência</th><th class="th-num">Valor (R$)</th></tr></thead>
            <tbody>${rows(r.verbas)}</tbody>
        </table>
        </div>
        ${encargosSection}
        <div class="slip-totals">
            <div class="slip-total-box blue">
                <div class="slip-total-label">Total Verbas</div>
                <div class="slip-total-value">${fmtCurrency(r.totalVerbas)}</div>
            </div>
            <div class="slip-total-box red">
                <div class="slip-total-label">Total Encargos</div>
                <div class="slip-total-value">${fmtCurrency(r.totalEncargos)}</div>
            </div>
            <div class="slip-total-box green">
                <div class="slip-total-label">Custo Total do Desligamento</div>
                <div class="slip-total-value">${fmtCurrency(r.custoTotal)}</div>
            </div>
        </div>`;
}

let closeActivePopover = null;

function claimPopover(close) {
    if (closeActivePopover && closeActivePopover !== close) closeActivePopover();
    closeActivePopover = close;
}
function releasePopover(close) {
    if (closeActivePopover === close) closeActivePopover = null;
}

function setupRescisaoDatePicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = document.getElementById('rescisao-data-trigger');
    const popover = document.getElementById('rescisao-data-popover');
    const titleEl = document.getElementById('rescisao-data-title');
    const gridEl = document.getElementById('rescisao-data-grid');
    const prevBtn = document.getElementById('rescisao-data-prev');
    const nextBtn = document.getElementById('rescisao-data-next');
    const hidden = document.getElementById('rescisao-data');
    const label = document.getElementById('rescisao-data-label');

    const today = new Date();
    let viewYear = today.getFullYear(),
        viewMonth = today.getMonth();

    function setValue(y, m, d) {
        hidden.value = `${y}-${pad0(m + 1)}-${pad0(d)}`;
        label.textContent = `${pad0(d)}/${pad0(m + 1)}/${y}`;
        label.classList.remove('select-placeholder');
        updateRescisaoBtnState();
    }

    function render() {
        titleEl.textContent = `${MESES_LONG[viewMonth]} ${viewYear}`;

        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
            )
            .join('');

        gridEl.querySelectorAll('.calendar-day:not(.calendar-day--muted)').forEach((el) => {
            el.addEventListener('click', () => {
                setValue(viewYear, viewMonth, parseInt(el.textContent, 10));
                close();
            });
        });
    }

    function open() {
        claimPopover(close);
        if (hidden.value) {
            const [y, m] = hidden.value.split('-').map(Number);
            viewYear = y;
            viewMonth = m - 1;
        }
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }

    function close() {
        releasePopover(close);
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });
    popover.addEventListener('click', (e) => e.stopPropagation());

    window.setRescisaoDate = function (dateStr) {
        if (!dateStr) {
            hidden.value = '';
            label.textContent = 'Selecione';
            label.classList.add('select-placeholder');
            updateRescisaoBtnState();
            return;
        }
        const [y, m, d] = dateStr.split('-').map(Number);
        setValue(y, m - 1, d);
        viewYear = y;
        viewMonth = m - 1;
    };
}

function setupRescisaoEmpSelect() {
    const trigger = document.getElementById('rescisao-emp-trigger');
    const popover = document.getElementById('rescisao-emp-popover');
    const label = document.getElementById('rescisao-emp-label');
    const hidden = document.getElementById('rescisao-emp');

    function open() {
        claimPopover(close);
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }
    function close() {
        releasePopover(close);
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }
    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });

    popover.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('.select-option');
        if (!btn) return;
        window.setRescisaoEmp(btn.dataset.value);
        close();
        window.onRescisaoEmpChange();
    });

    window.setRescisaoEmpOptions = function (list) {
        popover.innerHTML = list.length
            ? list
                  .map((e) => `<button type="button" class="select-option" role="option" data-value="${escHtml(String(e.id))}">${escHtml(e.name)}</button>`)
                  .join('')
            : '<div class="select-empty">Nenhum colaborador cadastrado</div>';
    };

    window.setRescisaoEmp = function (empId) {
        const emp = empId ? employees.find((e) => e.id === empId) : null;
        hidden.value = emp ? emp.id : '';
        label.textContent = emp ? emp.name : 'Selecione';
        label.classList.toggle('select-placeholder', !emp);
        popover.querySelectorAll('.select-option').forEach((o) => o.classList.toggle('selected', !!emp && o.dataset.value === emp.id));
        close();
    };
}

function setupRescisaoTipoToggle() {
    const toggle = document.getElementById('rescisao-tipo-toggle');
    const hidden = document.getElementById('rescisao-tipo');
    toggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-toggle-card');
        if (!btn) return;
        hidden.value = btn.dataset.tipo;
        toggle.querySelectorAll('.type-toggle-card').forEach((c) => c.classList.toggle('active', c === btn));
        updateRescisaoBtnState();
    });
    document.getElementById('rescisao-aviso-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-toggle-card');
        if (btn) setAvisoEmpregado(btn.dataset.aviso);
    });
}

window.printCurrentSlip = function () {
    if (!currentSlipData) return;
    const { emp, slip } = currentSlipData;

    const isPago = slip.status === 'pago';
    const provRows = slip.proventos
        .map(
            (p) => `<tr><td>${p.cod}</td><td>${escHtml(p.descricao)}</td><td>${escapeHtml(p.referencia)}</td><td class="num">${fmtCurrency(p.valor)}</td></tr>`
        )
        .join('');
    const descRows = slip.descontos
        .map(
            (d) =>
                `<tr><td>${d.cod}</td><td>${escHtml(d.descricao)}</td><td>${escapeHtml(d.referencia)}</td><td class="num neg">${fmtCurrency(d.valor)}</td></tr>`
        )
        .join('');

    const cssHref = new URL('../styles/holerite-print.css', window.location.href).href;
    const win = window.open('', '_blank', 'width=820,height=700');
    if (!win) {
        showToast('Permita pop-ups para imprimir o holerite.', 'error');
        return;
    }
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
        <meta charset="UTF-8">
        <title>Holerite — ${escHtml(emp.name)} — ${escapeHtml(slip.competencia)}</title>
        <link rel="stylesheet" href="${cssHref}">
    </head><body>
        <div class="header">
            <div class="header-top">
                <div>
                    <div class="company">Nexus RH</div>
                    <div class="company-sub">Sistema de Gestão de Recursos Humanos</div>
                </div>
                <div class="period">Competência ${escapeHtml(slip.competencia)}</div>
            </div>
            <div class="emp-grid">
                <div><div class="field-label">Nome</div><div class="field-value">${escHtml(emp.name)}</div></div>
                <div><div class="field-label">Cargo</div><div class="field-value">${escHtml(emp.role || '—')}</div></div>
                <div><div class="field-label">Departamento</div><div class="field-value">${escHtml(emp.dept || '—')}</div></div>
                <div><div class="field-label">Contrato</div><div class="field-value">${escHtml(emp.contractType || 'CLT')}</div></div>
                ${emp.admissionDate ? `<div><div class="field-label">Admissão</div><div class="field-value">${fmtDate(emp.admissionDate)}</div></div>` : ''}
            </div>
            ${isPago ? `<div class="stamp">✓ PAGAMENTO EFETUADO</div>` : ''}
        </div>
        <div class="section-title">Proventos</div>
        <table><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th class="num">Valor (R$)</th></tr></thead>
        <tbody>${provRows || '<tr><td colspan="4" class="empty">Nenhum provento</td></tr>'}</tbody></table>
        <div class="section-title">Descontos</div>
        <table><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th class="num">Valor (R$)</th></tr></thead>
        <tbody>${descRows || '<tr><td colspan="4" class="empty">Nenhum desconto</td></tr>'}</tbody></table>
        <div class="totals">
            <div class="total-box blue"><div class="total-label">Total Proventos</div><div class="total-value">${fmtCurrency(slip.total_proventos)}</div></div>
            <div class="total-box red"><div class="total-label">Total Descontos</div><div class="total-value">${fmtCurrency(slip.total_descontos)}</div></div>
            <div class="total-box green"><div class="total-label">Salário Líquido</div><div class="total-value">${fmtCurrency(slip.salario_liquido)}</div></div>
        </div>
        <div class="footer">
            <span>Gerado pelo Nexus RH em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
            <span>Este documento tem validade apenas com assinatura digital ou carimbo da empresa.</span>
        </div>
    </body></html>`);
    win.document.close();
    printWhenLoaded(win);
};

function populateDeptFilters() {
    const depts = [...new Set(employees.map((e) => e.dept || '').filter(Boolean))].sort();
    buildDeptChips('dept-filter-chips', 'btn-dept-filter', depts, currentDept, 'setDeptFilter');
    buildDeptChips('dept-hol-filter-chips', 'btn-dept-hol-filter', depts, currentDeptHol, 'setDeptHolFilter');
}

function buildDeptChips(chipsId, btnId, depts, selected, fnName) {
    const chipsEl = document.getElementById(chipsId);

    chipsEl.innerHTML = [
        `<button type="button" class="chip${!selected ? ' chip--active' : ''}" data-dept="" data-click="${fnName}" data-click-args="[{&quot;$&quot;:&quot;this&quot;}]">Todos os departamentos</button>`,
        ...depts.map(
            (d) =>
                `<button type="button" class="chip${d === selected ? ' chip--active' : ''}" data-dept="${escHtml(d)}" data-click="${fnName}" data-click-args="[{&quot;$&quot;:&quot;this&quot;}]">${escHtml(d)}</button>`
        ),
    ].join('');

    document.getElementById(btnId)?.classList.toggle('filtered', !!selected);
}

function setupDeptFilterDropdown(wrapId, btnId, menuId, chevronId) {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    const chevron = document.getElementById(chevronId);

    function open() {
        btn.classList.add('open');
        menu.classList.add('open');
        chevron?.classList.add('open');
    }
    function close() {
        btn.classList.remove('open');
        menu.classList.remove('open');
        chevron?.classList.remove('open');
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? close() : open();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', close);
}

function setDeptFilterCommon(btn, chipsId, btnId, chevronId, menuId) {
    document.querySelectorAll(`#${chipsId} .chip`).forEach((c) => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    const dept = btn.dataset.dept || '';
    document.getElementById(btnId)?.classList.toggle('filtered', !!dept);
    document.getElementById(btnId)?.classList.remove('open');
    document.getElementById(menuId)?.classList.remove('open');
    document.getElementById(chevronId)?.classList.remove('open');
    return dept;
}

window.setDeptFilter = function (btn) {
    currentDept = setDeptFilterCommon(btn, 'dept-filter-chips', 'btn-dept-filter', 'dept-filter-chevron', 'dept-filter-menu');
    renderFolha();
};

window.setDeptHolFilter = function (btn) {
    currentDeptHol = setDeptFilterCommon(btn, 'dept-hol-filter-chips', 'btn-dept-hol-filter', 'dept-hol-filter-chevron', 'dept-hol-filter-menu');
    applyHolSearch();
};

function setupRealtimeSync() {
    sb.channel('payslips-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payslips' }, async () => {
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await refresh();
        })
        .subscribe();
}

function setupExportDropdown() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        btn.classList.toggle('open', open);
    });
    document.addEventListener('click', () => {
        menu.classList.remove('open');
        btn.classList.remove('open');
    });
    menu.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('export-excel')?.addEventListener('click', () => {
        menu.classList.remove('open');
        exportExcel();
    });
    document.getElementById('export-pdf')?.addEventListener('click', () => {
        menu.classList.remove('open');
        exportPDF();
    });
    document.getElementById('export-csv')?.addEventListener('click', () => {
        menu.classList.remove('open');
        exportCSV();
    });
}

async function exportCSV() {
    const daFolha = employees.filter(naFolha);
    if (!daFolha.length) {
        showToast('Nada para exportar neste mês.', 'warning');
        return;
    }
    if (typeof XLSX === 'undefined') {
        showToast('Biblioteca de exportação não carregada.', 'error');
        return;
    }

    setLoading(true);
    try {
        const slips = await Promise.all(
            daFolha.map((emp) =>
                buildPayslipData(
                    emp,
                    currentMonth,
                    payslips.find((p) => p.employee_id === emp.id)
                )
            )
        );

        const header = ['Competência', 'Colaborador', 'CPF', 'Departamento', 'Cargo', 'Tipo de Contrato', 'Tipo', 'Código', 'Descrição', 'Referência', 'Valor'];
        const body = [];
        daFolha.forEach((emp, i) => {
            const slip = slips[i];
            const common = [slip.competencia, emp.name, emp.cpf || '', emp.dept || '—', emp.role || '—', (emp.contractType || 'CLT').toUpperCase()];
            slip.proventos.forEach((p) => body.push([...common, 'Provento', p.cod, p.descricao, p.referencia, p.valor]));
            slip.descontos.forEach((d) => body.push([...common, 'Desconto', d.cod, d.descricao, d.referencia, d.valor]));
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), `Folha ${currentMonth}`);
        XLSX.writeFile(wb, `folha-pagamento-${currentMonth}-contabilidade.csv`);
        NexusAuth.logExport('folha-pagamento.csv', daFolha.length);
        showToast('Exportação CSV concluída.', 'success');
    } catch (e) {
        console.error('exportCSV:', e);
        showToast('Erro ao gerar CSV.', 'error');
    } finally {
        setLoading(false);
    }
}

function exportExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Biblioteca Excel não carregada.', 'error');
        return;
    }
    const wb = XLSX.utils.book_new();
    const header = ['Colaborador', 'Departamento', 'Contrato', 'Salário Bruto', 'INSS', 'IRRF', 'Benefícios', 'Líquido', 'Status'];
    const body = allRows.map((r) => [
        r.emp.name,
        r.emp.dept || '—',
        (r.emp.contractType || 'CLT').toUpperCase(),
        r.calc.bruto,
        r.calc.inss,
        r.calc.irrf,
        r.calc.benef,
        r.calc.liquido,
        r.pago ? 'Pago' : r.gerado ? 'Gerado' : 'Pendente',
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), `Folha ${currentMonth}`);
    XLSX.writeFile(wb, `folha-pagamento-${currentMonth}.xlsx`);
    NexusAuth.logExport('folha-pagamento.xlsx', allRows.length);
    showToast('Exportação Excel concluída.', 'success');
}

function exportPDF() {
    if (typeof window.jspdf === 'undefined') {
        showToast('Biblioteca PDF não carregada.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFillColor(13, 14, 18);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(`Nexus RH — Folha de Pagamento — ${fmtMonthLabel(currentMonth)}`, 14, 14);

    doc.autoTable({
        startY: 28,
        head: [['Colaborador', 'Departamento', 'Contrato', 'Bruto', 'INSS', 'IRRF', 'Benefícios', 'Líquido', 'Status']],
        body: allRows.map((r) => [
            r.emp.name,
            r.emp.dept || '—',
            (r.emp.contractType || 'CLT').toUpperCase(),
            fmtCurrency(r.calc.bruto),
            fmtCurrency(r.calc.inss),
            fmtCurrency(r.calc.irrf),
            fmtCurrency(r.calc.benef),
            fmtCurrency(r.calc.liquido),
            r.pago ? 'Pago' : r.gerado ? 'Gerado' : 'Pendente',
        ]),
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        margin: { left: 14, right: 14 },
        theme: 'striped',
        styles: { fontSize: 9 },
    });
    doc.save(`folha-pagamento-${currentMonth}.pdf`);
    NexusAuth.logExport('folha-pagamento.pdf', allRows.length);
    showToast('Exportação PDF concluída.', 'success');
}

function setupCustomMonthPicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = document.getElementById('month-picker-btn');
    const popover = document.getElementById('month-picker-dropdown');
    const titleEl = document.getElementById('mpd-title');
    const gridEl = document.getElementById('mpd-grid');
    const prevBtn = document.getElementById('mpd-prev-month');
    const nextBtn = document.getElementById('mpd-next-month');

    const today = new Date();
    let viewYear, viewMonth;

    function updateLabel() {
        const [y, m] = currentMonth.split('-');
        const el = document.getElementById('month-picker-label');
        if (el) el.textContent = `${MESES_LONG[parseInt(m) - 1]} de ${y}`;
    }

    function render() {
        titleEl.textContent = `${MESES_LONG[viewMonth]} ${viewYear}`;

        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
            )
            .join('');

        gridEl.querySelectorAll('.calendar-day:not(.calendar-day--muted)').forEach((el) => {
            el.addEventListener('click', () => {
                currentMonth = `${viewYear}-${pad0(viewMonth + 1)}`;
                updateLabel();
                close();
                refresh();
            });
        });
    }

    function open() {
        const [y, m] = currentMonth.split('-').map(Number);
        viewYear = y;
        viewMonth = m - 1;
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });
    popover.addEventListener('click', (e) => e.stopPropagation());

    updateLabel();
}

window.switchTab = function (btn, name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${name}`)?.classList.add('active');
};

function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
}
window.closeModal = closeModal;
window.handleOverlayClick = function (e, id) {
    if (id === 'slip-modal') return;
    if (e.target === document.getElementById(id)) closeModal(id);
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
        document.body.style.overflow = '';
    }
});

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function fmtCurrency(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

function fmtMonthLabel(key) {
    const [y, m] = key.split('-');
    const lbl = new Date(+y, +m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}

function initials(name) {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');
}

function nameToColor(name) {
    const p = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#f97316', '#0ea5e9', '#14b8a6'];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
    return p[Math.abs(h) % p.length];
}

function empAvatarHtml(emp, ini, color) {
    if (emp.avatarUrl) return `<div class="emp-avatar" data-bg-img="${escapeHtml(emp.avatarUrl)}"></div>`;
    return `<div class="emp-avatar" data-bg="${escHtml(color)}">${ini}</div>`;
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type]}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escHtml(msg)}</p>
        </div>
        <button class="toast-close" data-click="dismissToast">
            <i class="fas fa-times"></i>
        </button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { calcINSS, calcIRRF, calcRow, parseCurrency, resumoDoHolerite };

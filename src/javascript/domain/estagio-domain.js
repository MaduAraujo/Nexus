const NIVEIS_ESTAGIO = [
    { value: 'superior', label: 'Educação superior' },
    { value: 'medio_profissional', label: 'Ensino médio profissional' },
    { value: 'medio', label: 'Ensino médio regular' },
    { value: 'especial', label: 'Educação especial' },
    { value: 'fundamental_eja', label: 'Anos finais do fundamental (EJA profissional)' },
];

const NIVEIS_JORNADA_4H = ['especial', 'fundamental_eja'];
const NIVEIS_COM_COTA = ['medio', 'especial', 'fundamental_eja'];
const CARGA_SEMANAL_HORAS = { '20h': 20, '30h': 30, '40h': 40 };

function parseISO(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return { y, m, d };
}

function toISO(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function hojeISO(ref) {
    const d = ref instanceof Date ? ref : new Date();
    return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function ultimoDiaDoMes(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function somarAnosISO(iso, anos) {
    const { y, m, d } = parseISO(iso);
    return toISO(y + anos, m, Math.min(d, ultimoDiaDoMes(y + anos, m)));
}

function somarDiasISO(iso, dias) {
    const { y, m, d } = parseISO(iso);
    const dt = new Date(Date.UTC(y, m - 1, d + dias));
    return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function mesesCompletos(inicioISO, fimISO) {
    const a = parseISO(inicioISO);
    const b = parseISO(fimISO);
    const meses = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    return Math.max(0, meses);
}

function idadeEm(nascimentoISO, refISO) {
    const n = parseISO(nascimentoISO);
    const r = parseISO(refISO);
    return r.y - n.y - (r.m < n.m || (r.m === n.m && r.d < n.d) ? 1 : 0);
}

const EstagioDomain = {
    NIVEIS: NIVEIS_ESTAGIO,
    DURACAO_MAXIMA_ANOS: 2,
    ESTAGIARIOS_POR_SUPERVISOR: 10,
    IDADE_MINIMA: 16,
    DIAS_RECESSO_ANO: 30,
    MESES_RELATORIO: 6,

    isEstagio(contractType) {
        const t = String(contractType || '').toLowerCase();
        return t === 'estagio' || t === 'estágio';
    },

    nivelLabel(nivel) {
        return NIVEIS_ESTAGIO.find((n) => n.value === nivel)?.label || '—';
    },

    temCota(nivel) {
        return NIVEIS_COM_COTA.includes(nivel);
    },

    cargaMaximaSemanal(nivel, alternancia = false) {
        if (NIVEIS_JORNADA_4H.includes(nivel)) return 20;
        return alternancia ? 40 : 30;
    },

    fimMaximo(admissaoISO) {
        if (!admissaoISO) return null;
        return somarDiasISO(somarAnosISO(admissaoISO, EstagioDomain.DURACAO_MAXIMA_ANOS), -1);
    },

    recessoAdquirido(admissaoISO, ref) {
        if (!admissaoISO) return 0;
        const refISO = typeof ref === 'string' ? ref : hojeISO(ref);
        return Math.floor((mesesCompletos(admissaoISO, refISO) * EstagioDomain.DIAS_RECESSO_ANO) / 12);
    },

    recessoNaRescisao({ admissaoISO, desligamentoISO, gozados = 0 }) {
        const meses = mesesCompletos(admissaoISO, somarDiasISO(desligamentoISO, 1));
        const devidos = Math.round((meses * EstagioDomain.DIAS_RECESSO_ANO) / 12);
        return { meses, devidos, gozados: Math.max(0, gozados), dias: Math.max(0, devidos - Math.max(0, gozados)) };
    },

    limiteCota(quadro) {
        const n = Math.max(0, Math.floor(Number(quadro) || 0));
        if (n === 0) return 0;
        if (n <= 5) return 1;
        if (n <= 10) return 2;
        if (n <= 25) return 5;
        return Math.ceil(n * 0.2);
    },

    proximoRelatorio(admissaoISO, ultimoRelatorioISO, ref) {
        if (!admissaoISO) return null;
        const refISO = typeof ref === 'string' ? ref : hojeISO(ref);
        const base = ultimoRelatorioISO && ultimoRelatorioISO > admissaoISO ? ultimoRelatorioISO : admissaoISO;
        const { y, m, d } = parseISO(base);
        const alvoMes = m + EstagioDomain.MESES_RELATORIO;
        const ay = y + Math.floor((alvoMes - 1) / 12);
        const am = ((alvoMes - 1) % 12) + 1;
        const prazo = toISO(ay, am, Math.min(d, ultimoDiaDoMes(ay, am)));
        return { prazo, vencido: prazo < refISO };
    },

    validar(dados = {}) {
        const {
            id,
            admissionDate,
            birthDate,
            workLoad,
            pcd,
            nivel,
            obrigatorio,
            alternancia,
            instituicao,
            fim,
            supervisorId,
            salary,
            valeTransporte,
            avaliacoes,
        } = dados;
        if (!NIVEIS_ESTAGIO.some((n) => n.value === nivel)) return 'Informe o nível de ensino do estagiário (Lei 11.788/2008, art. 1º).';
        if (obrigatorio !== true && obrigatorio !== false) return 'Informe se o estágio é obrigatório ou não obrigatório (art. 2º).';
        if (!String(instituicao || '').trim()) return 'Informe a instituição de ensino que assina o termo de compromisso (art. 3º, II).';
        if (!admissionDate) return 'Informe a data de início do estágio.';
        if (!fim) return 'Informe a data de término prevista no termo de compromisso.';
        if (fim < admissionDate) return 'O término do estágio deve ser igual ou posterior ao início.';
        if (!pcd && fim > EstagioDomain.fimMaximo(admissionDate))
            return 'O estágio não pode passar de 2 anos na mesma empresa, exceto para estagiário com deficiência (art. 11).';
        if (birthDate && idadeEm(birthDate, admissionDate) < EstagioDomain.IDADE_MINIMA)
            return 'O estagiário precisa ter pelo menos 16 anos no início do estágio.';
        if (alternancia && NIVEIS_JORNADA_4H.includes(nivel)) return 'A jornada de 40 horas só vale para cursos que alternam teoria e prática (art. 10, § 1º).';
        if (!CARGA_SEMANAL_HORAS[workLoad]) return 'A carga horária do estágio deve ser de 20h, 30h ou 40h semanais (art. 10).';
        const maxima = EstagioDomain.cargaMaximaSemanal(nivel, alternancia);
        if (CARGA_SEMANAL_HORAS[workLoad] > maxima) {
            if (maxima === 20) return 'Para educação especial e anos finais do fundamental (EJA), o limite é 4h por dia e 20h semanais (art. 10, I).';
            return 'O limite é 6h por dia e 30h semanais; 40h só com alternância entre teoria e prática, fora dos períodos de aula (art. 10).';
        }
        if (!supervisorId) return 'Indique o supervisor do estágio, um funcionário da área (art. 9º, III).';
        if (id && supervisorId === id) return 'O estagiário não pode ser o próprio supervisor.';
        if (obrigatorio === false && !(Number(salary) > 0)) return 'No estágio não obrigatório a bolsa é obrigatória (art. 12).';
        if (obrigatorio === false && !valeTransporte) return 'No estágio não obrigatório o auxílio-transporte é obrigatório (art. 12).';
        for (const p of avaliacoes || []) {
            if (!p?.inicio || !p?.fim || p.fim < p.inicio) return 'Cada período de provas precisa de início e fim, com o fim igual ou posterior ao início.';
        }
        return null;
    },
};

if (typeof window !== 'undefined') window.EstagioDomain = EstagioDomain;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EstagioDomain };
}

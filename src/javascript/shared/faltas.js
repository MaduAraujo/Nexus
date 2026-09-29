window.NexusFaltas = (function () {
    function ontemKey(hoje = new Date()) {
        const d = new Date(hoje);
        d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    async function listar(employeeId, inicio, fimPedido, { workLoad = '' } = {}) {
        const fim = fimPedido < ontemKey() ? fimPedido : ontemKey();
        if (fim < inicio) return [];
        const respostas = await Promise.all([
            sb.from('time_records').select('date,entrada').eq('employee_id', employeeId).gte('date', inicio).lte('date', fim),
            sb.from('holidays').select('date').gte('date', inicio).lte('date', fim),
            sb
                .from('adjustment_requests')
                .select('date')
                .eq('employee_id', employeeId)
                .eq('tipo', 'falta')
                .eq('status', 'aprovado')
                .gte('date', inicio)
                .lte('date', fim),
            sb
                .from('medical_leaves')
                .select('start_date,end_date')
                .eq('employee_id', employeeId)
                .eq('status', 'aprovado')
                .lte('start_date', fim)
                .gte('end_date', inicio),
            sb
                .from('vacations')
                .select('start_date,end_date,days,abono')
                .eq('employee_id', employeeId)
                .in('status', ['aprovado', 'concluido'])
                .lte('start_date', fim)
                .gte('end_date', inicio),
            sb.from('time_records').select('date').eq('employee_id', employeeId).not('entrada', 'is', null).order('date').limit(1),
        ]);
        const falha = respostas.find((r) => r.error);
        if (falha) throw new Error(`Não foi possível conferir as faltas: ${falha.error.message}`);
        const [{ data: recs }, { data: hols }, { data: adjs }, { data: leaves }, { data: vacs }, { data: first }] = respostas;
        return CLTDomain.listarFaltasInjustificadas({
            inicio,
            fim,
            registros: recs,
            feriados: hols.map((h) => h.date),
            abonadas: adjs.map((a) => a.date),
            afastamentos: [...vacs.map((v) => CLTDomain.periodoGozoFerias(v)).filter(Boolean), ...leaves],
            primeiroRegistro: first[0]?.date ?? null,
            workLoad,
        });
    }

    return { listar };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusFaltas;

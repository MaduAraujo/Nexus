window.localISODate = function localISODate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

window.validadeCertificado = function validadeCertificado(validoAte, hojeISO = window.localISODate()) {
    if (!validoAte) return null;
    const data = validoAte.split('-').reverse().join('/');
    const dias = Math.round((new Date(`${validoAte}T12:00:00`) - new Date(`${hojeISO}T12:00:00`)) / 86400000);
    if (dias < 0) return { estado: 'vencido', texto: `Certificado vencido em ${data}` };
    if (dias <= 30)
        return {
            estado: 'vencendo',
            texto: dias === 0 ? `Certificado vence hoje (${data})` : `Certificado vence em ${dias} dia${dias === 1 ? '' : 's'} (${data})`,
        };
    return { estado: 'valido', texto: `Certificado válido até ${data}` };
};

window.validadeCertificadoHtml = function validadeCertificadoHtml(validoAte, hojeISO) {
    const v = window.validadeCertificado(validoAte, hojeISO);
    return v ? `<span class="training-validade training-validade--${v.estado}">${escapeHtml(v.texto)}</span>` : null;
};

if (typeof module !== 'undefined' && module.exports)
    module.exports = {
        localISODate: window.localISODate,
        validadeCertificado: window.validadeCertificado,
        validadeCertificadoHtml: window.validadeCertificadoHtml,
    };

// Checklist de documentos obrigatórios por tipo de contratação. Cada regime tem exigências legais próprias
// (CLT, Lei 11.788/2008 do estágio, contrato de aprendizagem, etc.), então o checklist não pode ser único.
const RequisitosDocumentos = {
    DEFAULT_CONTRACT_TYPE: 'CLT',

    // `base` resume o fundamento legal exibido no modal do RH.
    CONTRACT_TYPES: [
        {
            value: 'CLT',
            label: 'CLT',
            base: 'CLT (Decreto-Lei 5.452/1943): carteira de trabalho (art. 29), registro do empregado (art. 41) e exame médico admissional (art. 168).',
        },
        {
            value: 'Estágio',
            label: 'Estágio',
            base: 'Lei 11.788/2008: termo de compromisso (art. 3º), comprovação de matrícula e frequência, seguro de acidentes pessoais e termo de realização ao final (art. 9º). Não há vínculo empregatício.',
        },
        {
            value: 'Aprendiz',
            label: 'Aprendiz',
            base: 'CLT, arts. 428 a 433: contrato de aprendizagem escrito, anotado na carteira de trabalho, com comprovação de matrícula e frequência escolar.',
        },
        {
            value: 'Temporário',
            label: 'Temporário',
            base: 'Lei 6.019/1974 e CLT, art. 443: registro e carteira de trabalho como no CLT, com contrato por prazo determinado (sem aviso prévio).',
        },
        {
            value: 'PJ',
            label: 'PJ',
            base: 'Código Civil, arts. 593 a 609 (prestação de serviços): não há vínculo empregatício. Exige contrato de prestação de serviços e comprovação do CNPJ.',
        },
    ],

    // Aceita o valor como está no banco ('estagio', 'Estágio', 'clt', ...) e devolve o valor canônico da lista.
    normalizeContractType(raw) {
        const key = String(raw ?? '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '');
        const found = this.CONTRACT_TYPES.find((t) => t.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === key);
        return found ? found.value : this.DEFAULT_CONTRACT_TYPE;
    },

    contractTypeInfo(raw) {
        const value = this.normalizeContractType(raw);
        return this.CONTRACT_TYPES.find((t) => t.value === value);
    },

    // Linhas sem contract_type (criadas antes da separação por regime) valem para CLT.
    requirementsFor(requirements, category, contractType) {
        const wanted = this.normalizeContractType(contractType);
        return (requirements || []).filter((r) => r.category === category && this.normalizeContractType(r.contract_type) === wanted);
    },

    requiredTipos(requirements, category, contractType) {
        return [...new Set(this.requirementsFor(requirements, category, contractType).map((r) => r.tipo))];
    },
};

window.RequisitosDocumentos = RequisitosDocumentos;

if (typeof module !== 'undefined' && module.exports) module.exports = { RequisitosDocumentos };

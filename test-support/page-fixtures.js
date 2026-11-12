const RH_USER = { id: 'u-rh', email: 'rh@empresa.com', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] };
const COLAB_USER = { id: 'u-ana', email: 'ana@empresa.com', factors: [] };
const MANAGER_USER = { id: 'u-bia', email: 'bia@empresa.com', factors: [] };

const ANA = {
    id: 'emp-ana',
    name: 'Ana Souza',
    email: 'ana@empresa.com',
    role: 'Analista',
    dept: 'Financeiro',
    contract_type: 'clt',
    work_load: '40h',
    salary: 4000,
    admission_date: '2024-02-01',
    status: 'Ativo',
    manager_id: 'emp-bia',
    cpf: '123.456.789-09',
    phone: '(11) 90000-0001',
};

const BIA = {
    id: 'emp-bia',
    name: 'Bia Lima',
    email: 'bia@empresa.com',
    role: 'Coordenadora',
    dept: 'Financeiro',
    contract_type: 'clt',
    work_load: '40h',
    salary: 8000,
    admission_date: '2022-05-10',
    status: 'Ativo',
    manager_id: null,
    cpf: '987.654.321-00',
};

const CAIO = {
    id: 'emp-caio',
    name: 'Caio Prado',
    email: 'caio@empresa.com',
    cpf: '846.213.579-64',
    role: 'Desenvolvedor PJ',
    dept: 'TI',
    contract_type: 'pj',
    work_load: '40h',
    salary: 9000,
    admission_date: '2025-01-15',
    status: 'Ativo',
    manager_id: null,
};

const EMPLOYEES = [ANA, BIA, CAIO];

function profiles() {
    return [
        { id: RH_USER.id, profile: 'Administrador', employee_id: null },
        { id: COLAB_USER.id, profile: 'colaborador', employee_id: ANA.id },
        { id: MANAGER_USER.id, profile: 'colaborador', employee_id: BIA.id },
    ];
}

const DEPARTMENTS = [
    { id: 'dep-adm', nome: 'Administrativo', descricao: null, responsavel_id: null, ativo: true },
    { id: 'dep-fin', nome: 'Financeiro', descricao: null, responsavel_id: null, ativo: true },
    { id: 'dep-jur', nome: 'Jurídico', descricao: null, responsavel_id: null, ativo: true },
    { id: 'dep-mkt', nome: 'Marketing', descricao: null, responsavel_id: null, ativo: true },
    { id: 'dep-rh', nome: 'RH', descricao: 'Recursos Humanos', responsavel_id: null, ativo: true },
    { id: 'dep-ti', nome: 'TI', descricao: 'Tecnologia da Informação', responsavel_id: null, ativo: true },
];

function baseTables(extra = {}) {
    return {
        departments: DEPARTMENTS.map((d) => ({ ...d })),
        profiles: profiles(),
        employees: EMPLOYEES.map((e) => ({ ...e })),
        employees_decrypted: EMPLOYEES.map((e) => ({ ...e })),
        ...extra,
    };
}

const AAL1_NO_MFA = { level: { currentLevel: 'aal1', nextLevel: 'aal1' } };
const AAL1_CHALLENGE = { level: { currentLevel: 'aal1', nextLevel: 'aal2' } };
const FIXED_NOW = '2026-06-17T14:00:00-03:00';

const BIOMETRIA_OK = {
    biometric_status: { enrolled: true, consent_at: '2026-06-01T10:00:00Z' },
    biometric_verify: { enrolled: true, matched: true, verification_id: 'tok-bio' },
};

module.exports = {
    RH_USER,
    COLAB_USER,
    MANAGER_USER,
    ANA,
    BIA,
    CAIO,
    EMPLOYEES,
    DEPARTMENTS,
    profiles,
    baseTables,
    AAL1_NO_MFA,
    AAL1_CHALLENGE,
    FIXED_NOW,
    BIOMETRIA_OK,
};

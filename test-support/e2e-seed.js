const U_COLAB = '10000000-0000-4000-8000-000000000001';
const E_COLAB = '10000000-0000-4000-9000-000000000001';
const U_ADMIN = '10000000-0000-4000-8000-000000000002';
const E_ADMIN = '10000000-0000-4000-9000-000000000002';

const E2E_PASSWORD = 'NexusE2E123!';

const E2E_USERS = {
    colaborador: {
        userId: U_COLAB,
        employeeId: E_COLAB,
        email: 'colaborador.e2e@nexustest.local',
        name: 'Colaborador E2E',
        cpf: '10000000001',
        password: E2E_PASSWORD,
    },
    administrador: { userId: U_ADMIN, employeeId: E_ADMIN, email: 'admin.e2e@nexustest.local', name: 'Admin E2E', cpf: '10000000002', password: E2E_PASSWORD },
};

async function seedE2EUsers(db) {
    for (const [profile, u] of [
        ['colaborador', E2E_USERS.colaborador],
        ['Administrador', E2E_USERS.administrador],
    ]) {
        await db.query(
            `INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password,
                email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                created_at, updated_at, confirmation_token, email_change,
                email_change_token_new, recovery_token
             ) VALUES (
                '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                extensions.crypt($3, extensions.gen_salt('bf')),
                now(), '{"provider":"email","providers":["email"]}', '{}',
                now(), now(), '', '', '', ''
             ) ON CONFLICT (id) DO NOTHING`,
            [u.userId, u.email, u.password]
        );
        await db.query(
            `INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2::text, jsonb_build_object('sub', $2::text, 'email', $3::text), 'email', now(), now())
             ON CONFLICT DO NOTHING`,
            [u.userId, u.userId, u.email]
        );
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, $2, $3, $4, 'E2E', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [u.employeeId, u.name, u.cpf, u.email]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [u.userId, profile, u.employeeId]
        );
    }
}

async function cleanupE2EUsers(db) {
    await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_COLAB, U_ADMIN]]);
    await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_COLAB, E_ADMIN]]);
}

module.exports = { seedE2EUsers, cleanupE2EUsers, E2E_USERS };
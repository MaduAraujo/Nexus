const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');
const CODE = fs.readFileSync(FILE, 'utf8');
const ESPERA_DO_AVISO_GLOBAL = 600;

const tick = () => new Promise((r) => setTimeout(r, 0));

function carregar({ semBody = false } = {}) {
    const erros = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => erros.push(a.map(String).join(' ')));
    const dom = new JSDOM(semBody ? '' : '<!doctype html><html><body></body></html>', {
        url: 'http://localhost:4173/src/screens/dashboard.html',
        runScripts: 'outside-only',
        virtualConsole: vc,
    });
    const w = dom.window;
    if (semBody) w.document.documentElement.removeChild(w.document.body);
    const respostas = [];
    class Builder {
        then(onFulfilled, onRejected) {
            const r = respostas.shift() || { data: [], error: null };
            return (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)).then(onFulfilled, onRejected);
        }
    }
    class Bucket {
        upload(resultado) {
            return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado);
        }
        getPublicUrl() {
            return { data: { publicUrl: 'x' } };
        }
    }
    Bucket.prototype.versao = 1;
    w.supabase = {
        createClient: () => ({ from: () => ({ select: () => new Builder() }), storage: { from: () => new Bucket() } }),
    };
    w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    const pendentes = [];
    const setTimeoutReal = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...a) => (ms === ESPERA_DO_AVISO_GLOBAL ? pendentes.push(fn) : setTimeoutReal(fn, ms, ...a));
    vm.runInContext(`${CODE}\n;globalThis.__sb = () => sb;`, dom.getInternalVMContext(), { filename: FILE });
    const sb = w.__sb();
    const toasts = () => [...w.document.querySelectorAll('#nexus-err-toast-container > div')].map((d) => d.textContent);
    const passarEspera = async () => {
        await tick();
        pendentes.splice(0).forEach((fn) => fn());
    };
    const avisoDaTela = (tipo, texto) => {
        const t = w.document.createElement('div');
        t.className = `toast toast-${tipo}`;
        t.textContent = texto;
        w.document.body.appendChild(t);
    };
    return { w, sb, respostas, erros, toasts, Bucket, passarEspera, avisoDaTela };
}

describe('supabase-client — aviso global de erro do servidor', () => {
    test('erro sem mensagem própria da tela: o aviso global aparece depois de um instante', async () => {
        const { sb, respostas, toasts, erros, passarEspera } = carregar();
        respostas.push({ data: null, error: { message: 'permission denied for table x' } });
        const r = await sb.from('x').select();
        assert.equal(r.error.message, 'permission denied for table x');
        assert.deepEqual(toasts(), [], 'ainda não: a tela tem a chance de avisar do jeito dela');
        await passarEspera();
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: permission denied for table x']);
        assert.ok(erros.some((e) => /Erro Supabase/.test(e)));
    });

    test('se a tela mostra a própria mensagem de erro, o aviso global não aparece', async () => {
        const { sb, respostas, toasts, passarEspera, avisoDaTela } = carregar();
        respostas.push({ data: null, error: { message: 'RLS' } });
        const { error } = await sb.from('x').select();
        if (error) avisoDaTela('error', 'Não foi possível atualizar a meta.');
        await passarEspera();
        assert.deepEqual(toasts(), []);
    });

    test('aviso de alerta ou erro no próprio campo do formulário também conta como mensagem da tela', async () => {
        const { w, sb, respostas, toasts, passarEspera, avisoDaTela } = carregar();
        respostas.push({ data: null, error: { message: 'a' } });
        await sb.from('x').select();
        avisoDaTela('warning', 'Documento sob guarda legal');
        await passarEspera();

        const campo = w.document.createElement('span');
        campo.id = 'forgot-email-err';
        w.document.body.appendChild(campo);
        await tick();
        respostas.push({ data: null, error: { message: 'b' } });
        await sb.from('x').select();
        campo.textContent = 'Erro ao enviar e-mail. Tente novamente.';
        await passarEspera();
        assert.deepEqual(toasts(), []);
    });

    test('aviso de sucesso de outra ação não esconde o erro', async () => {
        const { sb, respostas, toasts, passarEspera, avisoDaTela } = carregar();
        respostas.push({ data: null, error: { message: 'timeout' } });
        await sb.from('x').select();
        avisoDaTela('success', 'Perfil atualizado!');
        await passarEspera();
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: timeout']);
    });

    test('mensagem de erro que já estava na tela antes da falha não esconde a falha nova', async () => {
        const { sb, respostas, toasts, passarEspera, avisoDaTela } = carregar();
        avisoDaTela('error', 'Erro antigo');
        await tick();
        respostas.push({ data: null, error: { message: 'novo' } });
        await sb.from('x').select();
        await passarEspera();
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: novo']);
    });

    test('elemento de erro vazio não conta como mensagem', async () => {
        const { w, sb, respostas, toasts, passarEspera } = carregar();
        respostas.push({ data: null, error: { message: 'x' } });
        await sb.from('x').select();
        const vazio = w.document.createElement('p');
        vazio.className = 'field-error';
        w.document.body.appendChild(vazio);
        await passarEspera();
        assert.equal(toasts().length, 1);
    });

    test('"nenhuma linha" do .single() não é tratado como erro', async () => {
        const { sb, respostas, toasts, passarEspera } = carregar();
        respostas.push({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
        await sb.from('x').select();
        await passarEspera();
        assert.deepEqual(toasts(), []);
    });

    test('consulta que falha de vez (rede) avisa e repassa o erro para quem trata', async () => {
        const { sb, respostas, toasts, passarEspera } = carregar();
        respostas.push(new Error('Failed to fetch'));
        await assert.rejects(
            sb
                .from('x')
                .select()
                .then((r) => r),
            /Failed to fetch/
        );
        respostas.push(new Error('Failed to fetch'));
        const tratado = await sb
            .from('x')
            .select()
            .then(null, (e) => `tratado: ${e.message}`);
        assert.equal(tratado, 'tratado: Failed to fetch');
        await passarEspera();
        assert.equal(toasts().length, 2);
    });

    test('erro sem mensagem usa o texto padrão; consulta sem erro não avisa', async () => {
        const { sb, respostas, toasts, passarEspera } = carregar();
        respostas.push({ data: [], error: null }, { data: null, error: {} });
        await sb.from('x').select();
        await passarEspera();
        assert.deepEqual(toasts(), []);
        await sb.from('x').select();
        await passarEspera();
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: Erro ao comunicar com o servidor.']);
    });

    test('storage: erro devolvido e falha de rede também avisam; métodos síncronos continuam iguais', async () => {
        const { sb, toasts, passarEspera } = carregar();
        const bucket = sb.storage.from('documents');
        const r = await bucket.upload({ data: null, error: { message: 'Payload too large' } });
        assert.equal(r.error.message, 'Payload too large');
        await bucket.upload({ data: { path: 'ok' }, error: null });
        await assert.rejects(bucket.upload(new Error('rede')), /rede/);
        await passarEspera();
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: Payload too large', 'Erro ao comunicar com o servidor: rede']);
        assert.deepEqual(bucket.getPublicUrl(), { data: { publicUrl: 'x' } });
    });

    test('erro antes de a página ter <body> aparece quando o documento carrega', async () => {
        const { w, sb, respostas, toasts, passarEspera } = carregar({ semBody: true });
        respostas.push({ data: null, error: { message: 'cedo demais' } });
        await sb.from('x').select();
        await passarEspera();
        assert.equal(w.document.getElementById('nexus-err-toast-container'), null);
        w.document.documentElement.appendChild(w.document.createElement('body'));
        w.dispatchEvent(new w.Event('DOMContentLoaded'));
        assert.deepEqual(toasts(), ['Erro ao comunicar com o servidor: cedo demais']);
    });

    test('o aviso aparece com animação e some sozinho', async () => {
        const { w, sb, respostas, toasts, passarEspera } = carregar();
        respostas.push({ data: null, error: { message: 'x' } });
        await sb.from('x').select();
        const anterior = w.setTimeout;
        const agendados = [];
        w.setTimeout = (fn, ms) => (ms === 6000 || ms === 250 ? agendados.push(fn) : anterior(fn, ms));
        await passarEspera();
        await tick();
        await tick();
        const aviso = w.document.querySelector('#nexus-err-toast-container > div');
        assert.equal(aviso.style.opacity, '1');
        agendados.shift()();
        assert.equal(aviso.style.opacity, '0');
        agendados.shift()();
        w.setTimeout = anterior;
        assert.deepEqual(toasts(), []);
    });
});

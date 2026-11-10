/* Controle Financeiro — PWA
 * Os dados ficam na planilha do Google (via Apps Script). Este arquivo
 * não contém nenhum dado pessoal: URL e token ficam só no aparelho.
 */
'use strict';

const VERSAO = '1.1.0';
const CHAVE_CFG = 'cf_config';
const CHAVE_CACHE = 'cf_cache';
const CHAVE_UI = 'cf_ui';

/* ============================================================ utilidades */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function brl(v, sinal = false) {
  const n = Math.round((+v || 0) * 100) / 100;
  const s = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '− ' : sinal && n > 0 ? '+ ' : '') + 'R$ ' + s;
}
function brlCurto(v) {
  const n = Math.abs(+v || 0);
  if (n >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return 'R$ ' + Math.round(n);
}
function lerValor(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Math.round(parseFloat(s) * 100) / 100;
}
const num = v => (typeof v === 'number' ? v : lerValor(v)) || 0;
const pad = n => String(n).padStart(2, '0');
function hoje() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const mesAtual = () => hoje().slice(0, 7);
function somaMes(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
const ultimoDia = (y, m) => new Date(y, m, 0).getDate();
function nomeMes(ym, longo) {
  const [y, m] = ym.split('-').map(Number);
  return longo ? `${MESES_LONGOS[m - 1]} ${y}` : `${MESES[m - 1]}/${String(y).slice(2)}`;
}
function dataCurta(d) { if (!d) return ''; const [, m, dd] = d.split('-'); return `${+dd} ${MESES[+m - 1]}`; }
function dataLonga(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, dd);
  const h = hoje();
  if (d === h) return 'hoje';
  return `${SEMANA[dt.getDay()]}, ${dd} de ${MESES_LONGOS[m - 1]}`;
}
const novoId = p => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

function toast(msg, erro) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), erro ? 4500 : 2200);
}
const carregando = on => ($('#carregando').hidden = !on);

/* ============================================================ estado */
const S = {
  cfg: null,
  contas: [], categorias: [], lanc: [], planilha: '',
  tela: 'inicio',
  mes: mesAtual(),
  ui: {},
};
try { S.ui = JSON.parse(localStorage.getItem(CHAVE_UI)) || {}; } catch { S.ui = {}; }
const salvarUI = () => { try { localStorage.setItem(CHAVE_UI, JSON.stringify(S.ui)); } catch {} };

const contaPorId = id => S.contas.find(c => c.id === id);
const ehCartao = id => contaPorId(id)?.tipo === 'cartao';
const cartoes = () => S.contas.filter(c => c.tipo === 'cartao' && c.ativo !== 'não' && c.ativo !== 'nao');
const contasCorrentes = () => S.contas.filter(c => c.tipo !== 'cartao' && c.ativo !== 'não' && c.ativo !== 'nao');
function categoria(nome, tipo = 'despesa') {
  return S.categorias.find(c => c.nome === nome && c.tipo === tipo) || S.categorias.find(c => c.nome === nome) ||
    { nome: nome || 'Sem categoria', cor: '#9AA0A6', icone: '•' };
}

function aplicarDados(d) {
  S.contas = (d.contas || []).map(c => ({ ...c, id: String(c.id), fechamento: +c.fechamento || 0, vencimento: +c.vencimento || 0, saldo_inicial: num(c.saldo_inicial) }));
  S.categorias = d.categorias || [];
  S.lanc = (d.lancamentos || []).map(l => ({
    ...l, id: String(l.id), valor: num(l.valor), data: String(l.data || '').slice(0, 10),
    fatura: String(l.fatura || '').slice(0, 7), parcela: +l.parcela || '', parcelas: +l.parcelas || '',
    conta: String(l.conta || ''), destino: String(l.destino || ''),
  }));
  S.planilha = d.planilha || S.planilha;
}

/* ============================================================ regras de cartão */
// Em qual fatura (mês de vencimento, AAAA-MM) cai uma compra feita na data d?
function faturaDaCompra(conta, d) {
  const F = conta.fechamento || 1, V = conta.vencimento || 1;
  const [y, m, dia] = d.split('-').map(Number);
  let fech = `${y}-${pad(m)}`;
  if (dia > Math.min(F, ultimoDia(y, m))) fech = somaMes(fech, 1);
  return V > F ? fech : somaMes(fech, 1);
}
function datasDaFatura(conta, ym) {
  const F = conta.fechamento || 1, V = conta.vencimento || 1;
  const [y, m] = ym.split('-').map(Number);
  const venc = `${ym}-${pad(Math.min(V, ultimoDia(y, m)))}`;
  const fm = V > F ? ym : somaMes(ym, -1);
  const [fy, fmm] = fm.split('-').map(Number);
  const fech = `${fm}-${pad(Math.min(F, ultimoDia(fy, fmm)))}`;
  return { venc, fech };
}
// mês de competência: cartão = mês de vencimento da fatura; conta = mês da data
function competencia(l) {
  if (l.tipo === 'despesa' && ehCartao(l.conta)) {
    return l.fatura || (l.data ? faturaDaCompra(contaPorId(l.conta), l.data) : '');
  }
  return (l.data || '').slice(0, 7);
}
function fatura(contaId, ym) {
  const conta = contaPorId(contaId);
  const itens = S.lanc.filter(l => l.tipo === 'despesa' && l.conta === contaId && competencia(l) === ym);
  const total = itens.reduce((s, l) => s + l.valor, 0);
  const pagamentos = S.lanc.filter(l => l.tipo === 'pagamento' && l.destino === contaId && l.fatura === ym);
  const pago = pagamentos.reduce((s, l) => s + l.valor, 0);
  const { venc, fech } = datasDaFatura(conta, ym);
  const h = hoje();
  let status = 'aberta';
  if (total > 0.004 && pago >= total - 0.004) status = 'paga';
  else if (total <= 0.004) status = 'vazia';
  else if (h > venc) status = 'vencida';
  else if (h > fech) status = 'fechada';
  return { conta, ym, itens, total, pago, restante: Math.max(0, total - pago), venc, fech, status, pagamentos };
}
const NOME_STATUS = { paga: 'Paga', vencida: 'Vencida', fechada: 'Fechada', aberta: 'Aberta', vazia: 'Sem gastos' };

function faturasDoCartao(contaId) {
  const meses = new Set(S.lanc.filter(l => l.tipo === 'despesa' && l.conta === contaId).map(competencia));
  S.lanc.filter(l => l.tipo === 'pagamento' && l.destino === contaId && l.fatura).forEach(l => meses.add(l.fatura));
  return [...meses].filter(Boolean).sort().map(ym => fatura(contaId, ym));
}

function saldoConta(c) {
  let s = c.saldo_inicial || 0;
  const desde = c.data_saldo ? String(c.data_saldo).slice(0, 10) : '';
  for (const l of S.lanc) {
    if (desde && l.data <= desde) continue;
    if (l.conta === c.id) {
      if (l.tipo === 'entrada') s += l.valor;
      else if (l.tipo === 'despesa' || l.tipo === 'pagamento' || l.tipo === 'transferencia') s -= l.valor;
    }
    if (l.tipo === 'transferencia' && l.destino === c.id) s += l.valor;
  }
  return s;
}

/* ============================================================ API */
async function api(acao, dados = {}) {
  if (!S.cfg) throw new Error('App não configurado');
  let r;
  if (acao === 'ler') {
    r = await fetch(`${S.cfg.u}?token=${encodeURIComponent(S.cfg.t)}&_=${Date.now()}`);
  } else {
    r = await fetch(S.cfg.u, { method: 'POST', body: JSON.stringify({ token: S.cfg.t, acao, ...dados }) });
  }
  if (!r.ok) throw new Error('Erro de conexão (' + r.status + ')');
  const j = await r.json();
  if (!j.ok) throw new Error(j.erro === 'nao_autorizado' ? 'Código de acesso inválido' : j.erro);
  aplicarDados(j.dados);
  try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(j.dados)); } catch {}
  return j.dados;
}

async function atualizar(silencioso) {
  const b = $('#btn-atualizar'); b.classList.add('girando');
  try { await api('ler'); render(); if (!silencioso) toast('Atualizado'); }
  catch (e) { toast(navigator.onLine ? e.message : 'Sem internet — mostrando últimos dados', true); }
  finally { b.classList.remove('girando'); }
}

async function enviar(acao, dados, msg) {
  carregando(true);
  try { await api(acao, dados); render(); if (msg) toast(msg); return true; }
  catch (e) { toast('Não salvou: ' + e.message, true); return false; }
  finally { carregando(false); }
}

/* ============================================================ navegação */
function ir(tela, extra) {
  S.tela = tela;
  if (extra) Object.assign(S, extra);
  $$('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.tela === tela));
  render();
  window.scrollTo(0, 0);
}
$('#abas').addEventListener('click', e => { const b = e.target.closest('button'); if (b) ir(b.dataset.tela); });
$('#btn-atualizar').addEventListener('click', () => atualizar());
$('#btn-ajustes').addEventListener('click', () => ir('ajustes'));

function render() {
  const app = $('#app');
  if (!S.cfg) { $('#titulo').textContent = 'Bem-vindo'; $('#abas').hidden = true; $('#btn-ajustes').hidden = true; app.innerHTML = telaSetup(); ligarSetup(); return; }
  $('#abas').hidden = false;
  $('#btn-ajustes').hidden = false;
  const telas = { inicio: [telaInicio, 'Finanças'], painel: [telaPainel, 'Painel'], faturas: [telaFaturas, 'Faturas'], lancar: [telaLancar, 'Novo lançamento'], lista: [telaLista, 'Lançamentos'], ajustes: [telaAjustes, 'Ajustes'] };
  const [fn, titulo] = telas[S.tela] || telas.inicio;
  $('#titulo').textContent = titulo;
  app.innerHTML = fn();
  ligar[S.tela]?.();
}
const ligar = {};

function mesNav(chave = 'mes') {
  return `<div class="mesnav"><button data-mes="-1" aria-label="Mês anterior">‹</button><strong>${nomeMes(S[chave], true)}</strong><button data-mes="1" aria-label="Próximo mês">›</button></div>`;
}
function ligarMesNav(chave = 'mes') {
  $$('[data-mes]').forEach(b => b.onclick = () => { S[chave] = somaMes(S[chave], +b.dataset.mes); render(); });
}

/* ============================================================ setup */
function telaSetup() {
  return `<div class="setup">
    <h2>Vamos conectar à sua planilha</h2>
    <p>Cole aqui o <b>código do app</b> que aparece quando você roda <code>codigoDoApp</code> no Apps Script da planilha.</p>
    <div class="campo"><textarea id="codigo" rows="5" placeholder="Cole o código aqui" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea></div>
    <button class="btn" id="conectar">Conectar</button>
    <p class="rotulo" style="margin-top:20px">O código fica salvo só neste aparelho.</p>
  </div>`;
}
function decodificarCodigo(txt) {
  txt = txt.trim();
  const m = txt.match(/[#?&]c=([\w\-=]+)/); if (m) txt = m[1];
  const b = txt.replace(/-/g, '+').replace(/_/g, '/');
  const j = JSON.parse(decodeURIComponent(escape(atob(b))));
  if (!j.u || !j.t) throw new Error();
  return j;
}
function ligarSetup() {
  $('#conectar').onclick = async () => {
    let cfg;
    try { cfg = decodificarCodigo($('#codigo').value); } catch { return toast('Código inválido. Confira se copiou inteiro.', true); }
    S.cfg = cfg;
    carregando(true);
    try {
      await api('ler');
      localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg));
      toast('Conectado!'); ir('inicio');
    } catch (e) {
      const url = S.cfg.u; S.cfg = null;
      if (/failed to fetch|load failed|networkerror/i.test(e.message)) {
        toast(/\/dev$/.test(url) ? 'O código usa o endereço de teste (/dev). Gere de novo com a URL que termina em /exec.' :
          'Não consegui falar com a planilha. Confira se a implantação está com acesso "Qualquer pessoa".', true);
      } else toast(e.message, true);
    }
    finally { carregando(false); }
  };
}

/* ============================================================ início */
function telaInicio() {
  const M = S.mes;
  const entradas = S.lanc.filter(l => l.tipo === 'entrada' && l.data.slice(0, 7) === M);
  const despesas = S.lanc.filter(l => l.tipo === 'despesa' && competencia(l) === M);
  const totE = entradas.reduce((s, l) => s + l.valor, 0);
  const totD = despesas.reduce((s, l) => s + l.valor, 0);
  const noCartao = despesas.filter(l => ehCartao(l.conta)).reduce((s, l) => s + l.valor, 0);

  // por categoria
  const porCat = {};
  despesas.forEach(l => { porCat[l.categoria || 'Sem categoria'] = (porCat[l.categoria || 'Sem categoria'] || 0) + l.valor; });
  const cats = Object.entries(porCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = cats[0]?.[1] || 1;

  // por pessoa (titular da conta/cartão)
  const porPessoa = {};
  despesas.forEach(l => { const t = contaPorId(l.conta)?.titular || '—'; porPessoa[t] = (porPessoa[t] || 0) + l.valor; });

  // faturas que vencem no mês + vencidas antes
  const fats = cartoes().map(c => fatura(c.id, M)).filter(f => f.total > 0.004 || f.pago > 0);
  const atrasadas = cartoes().flatMap(c => faturasDoCartao(c.id).filter(f => f.ym < M && f.status === 'vencida'));

  // próximos meses (compromissos já lançados)
  const prox = Array.from({ length: 6 }, (_, i) => {
    const ym = somaMes(M, i + 1);
    const v = S.lanc.filter(l => l.tipo === 'despesa' && competencia(l) === ym).reduce((s, l) => s + l.valor, 0);
    return { ym, v };
  });
  const maxProx = Math.max(...prox.map(p => p.v), 1);

  const contas = contasCorrentes();
  const saldoTotal = contas.reduce((s, c) => s + saldoConta(c), 0);
  const emAberto = faturasEmAberto();

  return `<div class="card saldo-geral">
    <div class="rotulo">Saldo geral nas contas</div>
    <div class="valor num">${brl(saldoTotal)}</div>
    <div class="saldo-linhas">
      <span>Faturas em aberto <b class="num">${brl(emAberto)}</b></span>
      <span>Livre após faturas <b class="num">${brl(saldoTotal - emAberto)}</b></span>
    </div>
  </div>
  ${mesNav()}
  <div class="resumo">
    <div class="card destaque"><div class="rotulo">Resultado do mês</div><div class="valor num">${brl(totE - totD)}</div></div>
    <div class="card"><div class="rotulo">Entradas</div><div class="valor num pos">${brl(totE)}</div></div>
    <div class="card"><div class="rotulo">Despesas</div><div class="valor num neg">${brl(totD)}</div><div class="rotulo num">${brl(noCartao)} no cartão</div></div>
  </div>

  ${atrasadas.length ? `<div class="card"><h2>⚠️ Faturas vencidas</h2>${atrasadas.map(miniFatura).join('')}</div>` : ''}

  <div class="card"><h2>Faturas que vencem em ${MESES_LONGOS[+M.slice(5) - 1]} <small>${brl(fats.reduce((s, f) => s + f.total, 0))}</small></h2>
    ${fats.length ? fats.map(miniFatura).join('') : '<div class="vazio">Nenhuma fatura neste mês</div>'}
  </div>

  <div class="card"><h2>Gastos por categoria <small>${despesas.length} lançamentos</small></h2>
    ${cats.length ? cats.map(([n, v]) => { const c = categoria(n); return `<div class="barra-item"><div class="topo-b"><span>${esc(c.icone || '')} ${esc(n)}</span><span class="num">${brl(v)}</span></div><div class="barra"><i style="width:${(v / maxCat * 100).toFixed(1)}%;background:${esc(c.cor || '#9AA0A6')}"></i></div></div>`; }).join('') : '<div class="vazio">Sem despesas neste mês</div>'}
  </div>

  ${Object.keys(porPessoa).length > 1 ? `<div class="card"><h2>Por pessoa</h2><div class="pessoas">${Object.entries(porPessoa).sort((a, b) => b[1] - a[1]).map(([p, v]) => `<div><span class="rotulo">${esc(p)}</span><b class="num">${brl(v)}</b></div>`).join('')}</div></div>` : ''}

  <div class="card"><h2>Já comprometido nos próximos meses <small>parcelas e lançamentos futuros</small></h2>
    <div class="colunas">${prox.map(p => `<div class="col"><em class="num">${p.v ? brlCurto(p.v) : ''}</em><i style="height:${(p.v / maxProx * 100).toFixed(1)}%"></i><small>${nomeMes(p.ym)}</small></div>`).join('')}</div>
  </div>

  ${contas.length ? `<div class="card"><h2>Saldo nas contas <small>calculado</small></h2>
    ${contas.map(c => { const s = saldoConta(c); return `<div class="linha"><div class="ico" style="background:${esc(c.cor)}22;color:${esc(c.cor)}">🏦</div><div class="meio"><b>${esc(c.nome)}</b><span>${esc(c.titular || '')}${c.data_saldo ? '' : ' · informe o saldo inicial em Ajustes'}</span></div><div class="dir num ${s < 0 ? 'neg' : ''}">${brl(s)}</div></div>`; }).join('')}
    <div class="linha total"><div class="meio"><b>Total</b></div><div class="dir num ${saldoTotal < 0 ? 'neg' : ''}">${brl(saldoTotal)}</div></div>
  </div>` : ''}`;
}
// soma do que falta pagar em faturas já fechadas/vencidas e na fatura aberta atual de cada cartão
function faturasEmAberto() {
  const h = hoje();
  return cartoes().reduce((s, c) => {
    const atual = faturaDaCompra(c, h);
    return s + faturasDoCartao(c.id).filter(f => f.ym <= atual && f.status !== 'paga').reduce((x, f) => x + f.restante, 0);
  }, 0);
}
function miniFatura(f) {
  return `<button class="mini-fatura" data-fatura="${esc(f.conta.id)}|${f.ym}">
    <span class="cor" style="background:${esc(f.conta.cor)}"></span>
    <span class="meio"><b>${esc(f.conta.nome)}</b><span>vence ${dataCurta(f.venc)} · ${f.itens.length} lançamentos</span></span>
    <span class="dir" style="text-align:right"><b class="num">${brl(f.total)}</b><br><span class="selo-s ${f.status}">${NOME_STATUS[f.status]}</span></span>
  </button>`;
}
function ligarMiniFaturas() {
  $$('[data-fatura]').forEach(b => b.onclick = () => {
    const [id, ym] = b.dataset.fatura.split('|');
    S.ui.cartao = id; salvarUI(); ir('faturas', { mesFatura: ym });
  });
}
ligar.inicio = () => { ligarMesNav(); ligarMiniFaturas(); };

/* ============================================================ painel */
const N_MESES = 6;
const soma = ls => ls.reduce((s, l) => s + l.valor, 0);
const entradasDoMes = ym => S.lanc.filter(l => l.tipo === 'entrada' && l.data.slice(0, 7) === ym);
const gastosDoMes = ym => S.lanc.filter(l => l.tipo === 'despesa' && competencia(l) === ym);

// saldo de uma conta ao fim do dia `data` (vale para antes e depois da data do saldo informado)
function saldoEm(c, data) {
  const efeito = l => (l.conta === c.id ? (l.tipo === 'entrada' ? l.valor : -l.valor) : 0) +
    (l.tipo === 'transferencia' && l.destino === c.id ? l.valor : 0);
  const d0 = c.data_saldo ? String(c.data_saldo).slice(0, 10) : '';
  let s = c.saldo_inicial || 0;
  for (const l of S.lanc) {
    if (l.conta !== c.id && l.destino !== c.id) continue;
    if (!d0) { if (l.data <= data) s += efeito(l); }
    else if (data >= d0) { if (l.data > d0 && l.data <= data) s += efeito(l); }
    else if (l.data > data && l.data <= d0) s -= efeito(l);
  }
  return s;
}
function fimDoMes(ym) { const [y, m] = ym.split('-').map(Number); const f = `${ym}-${pad(ultimoDia(y, m))}`; return f > hoje() ? hoje() : f; }

function dadosPainel() {
  const M = S.mes, atual = mesAtual();
  const meses = Array.from({ length: N_MESES }, (_, i) => somaMes(M, i - (N_MESES - 1)));
  const futuros = Array.from({ length: N_MESES }, (_, i) => somaMes(M, i + 1));
  const primeiro = S.lanc.reduce((m, l) => { const c = competencia(l); return c && (!m || c < m) ? c : m; }, '');
  const comDados = meses.filter(ym => primeiro && ym >= primeiro && ym <= atual);
  const media = f => comDados.length ? comDados.reduce((s, ym) => s + f(ym), 0) / comDados.length : 0;

  const ent = meses.map(ym => soma(entradasDoMes(ym)));
  const gas = meses.map(ym => soma(gastosDoMes(ym)));
  const mediaEnt = media(ym => soma(entradasDoMes(ym)));
  const mediaGas = media(ym => soma(gastosDoMes(ym)));
  const aVista = ls => ls.filter(l => !(l.parcelas > 1));
  const mediaVar = media(ym => soma(aVista(gastosDoMes(ym))));

  const proj = futuros.map(ym => {
    const ls = gastosDoMes(ym);
    const comp = soma(ls);
    const est = Math.max(0, mediaVar - soma(aVista(ls)));
    return { ym, comp, est, total: comp + est };
  });

  // por categoria (média mensal e mês de referência)
  const porCat = (tipo, fonte) => {
    const r = {};
    comDados.forEach(ym => fonte(ym).forEach(l => { const k = l.categoria || 'Sem categoria'; r[k] = (r[k] || 0) + l.valor; }));
    const mesRef = {};
    fonte(M).forEach(l => { const k = l.categoria || 'Sem categoria'; mesRef[k] = (mesRef[k] || 0) + l.valor; });
    return Object.keys({ ...r, ...mesRef }).map(k => ({ nome: k, cat: categoria(k, tipo), media: (r[k] || 0) / (comDados.length || 1), total: r[k] || 0, mes: mesRef[k] || 0 }))
      .filter(x => x.media > 0.004 || x.mes > 0.004).sort((a, b) => b.media - a.media || b.mes - a.mes);
  };

  const porConta = S.contas.filter(c => c.ativo !== 'não' && c.ativo !== 'nao').map(c => {
    const vals = meses.map(ym => soma(gastosDoMes(ym).filter(l => l.conta === c.id)));
    const med = comDados.length ? comDados.reduce((s, ym) => s + vals[meses.indexOf(ym)], 0) / comDados.length : 0;
    return { c, vals, media: med, mes: vals[vals.length - 1] };
  }).filter(x => x.vals.some(v => v > 0.004)).sort((a, b) => b.media - a.media);

  // saldo geral: histórico (fim de cada mês) + projeção
  const contas = contasCorrentes();
  const hist = meses.filter(ym => ym <= atual && (!primeiro || ym >= primeiro))
    .map(ym => ({ ym, v: contas.reduce((s, c) => s + saldoEm(c, fimDoMes(ym)), 0) }));
  const saldoHoje = contas.reduce((s, c) => s + saldoConta(c), 0);
  const projSaldo = [];
  let s = saldoHoje;
  for (let k = 1; k <= 3; k++) {
    const ym = somaMes(atual, k);
    const p = proj.find(x => x.ym === ym) || { total: soma(gastosDoMes(ym)) };
    s += mediaEnt - p.total;
    projSaldo.push({ ym, v: s, proj: true });
  }

  return { meses, futuros, comDados, ent, gas, mediaEnt, mediaGas, mediaVar, proj, porConta, hist, projSaldo, saldoHoje,
    catGas: porCat('despesa', gastosDoMes), catEnt: porCat('entrada', entradasDoMes) };
}

/* ---- gráficos em SVG ---- */
function escalaBonita(max) {
  if (max <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
function topoArredondado(x, y, w, h, r = 3) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
let idGrafico = 0;
function graficoColunas({ meses, series, empilhado = false, linhas = [], altura = 180, vazio = 'Sem dados ainda' }) {
  const W = 340, H = altura, L = 44, R = 6, T = 10, B = 22;
  const n = meses.length, gw = (W - L - R) / n;
  const totais = meses.map((_, i) => empilhado ? series.reduce((s, x) => s + (x.valores[i] || 0), 0) : Math.max(...series.map(x => x.valores[i] || 0)));
  const max = escalaBonita(Math.max(...totais, ...linhas.map(l => l.valor), 0) * 1.05);
  const y = v => T + (H - T - B) * (1 - v / max);
  const id = 'g' + (++idGrafico);
  let svg = `<defs>${series.filter(s => s.hachura).map((s, i) => `<pattern id="${id}h${i}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${s.cor}" opacity=".18"/><line x1="0" y1="0" x2="0" y2="5" stroke="${s.cor}" stroke-width="2" opacity=".55"/></pattern>`).join('')}</defs>`;
  [0, .5, 1].forEach(f => {
    const v = max * f, yy = y(v);
    svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grade"/><text x="${L - 6}" y="${yy + 3.5}" class="eixo" text-anchor="end">${v ? brlCurto(v) : '0'}</text>`;
  });
  const vazioTudo = totais.every(t => t <= 0.004);
  meses.forEach((ym, i) => {
    const gx = L + gw * i;
    if (empilhado) {
      const bw = Math.min(24, gw * .55), x = gx + (gw - bw) / 2;
      let acc = 0;
      const vis = series.map((s, si) => ({ s, si, v: s.valores[i] || 0 })).filter(o => o.v > 0);
      vis.forEach((o, k) => {
        const y0 = y(acc), y1 = y(acc + o.v); acc += o.v;
        const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
        const fill = o.s.hachura ? `url(#${id}h${series.filter(s => s.hachura).indexOf(o.s)})` : o.s.cor;
        svg += k === vis.length - 1 ? `<path d="${topoArredondado(x, y1, bw, h)}" fill="${fill}"/>` : `<rect x="${x}" y="${y1 + 0}" width="${bw}" height="${h}" fill="${fill}"/>`;
      });
    } else {
      const k = series.length, bw = Math.min(14, (gw - 10 - (k - 1) * 2) / k), tot = k * bw + (k - 1) * 2, x0 = gx + (gw - tot) / 2;
      series.forEach((s, si) => { const v = s.valores[i] || 0; if (v > 0) svg += `<path d="${topoArredondado(x0 + si * (bw + 2), y(v), bw, y(0) - y(v))}" fill="${s.cor}"/>`; });
    }
    svg += `<text x="${gx + gw / 2}" y="${H - 6}" class="eixo" text-anchor="middle">${nomeMes(ym)}</text>`;
    const tip = `<b>${nomeMes(ym, true)}</b>` + series.map(s => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}: ${brl(s.valores[i] || 0)}</span>`).join('') +
      (empilhado && series.length > 1 ? `<span><b>Total: ${brl(totais[i])}</b></span>` : '');
    svg += `<rect x="${gx}" y="${T}" width="${gw}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  linhas.forEach(l => {
    if (!(l.valor > 0)) return;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(l.valor)}" y2="${y(l.valor)}" stroke="${l.cor}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  });
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>`;
  if (vazioTudo) svg += `<text x="${(L + W) / 2}" y="${(T + H - B) / 2}" class="vazio-svg" text-anchor="middle">${vazio}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img">${svg}</svg>`;
}
function graficoLinha(pontos, cor) {
  const W = 340, H = 170, L = 50, R = 12, T = 14, B = 22;
  if (!pontos.length) return `<svg viewBox="0 0 ${W} ${H}" class="grafico"><text x="${W / 2}" y="${H / 2}" class="vazio-svg" text-anchor="middle">Sem dados ainda</text></svg>`;
  const vs = pontos.map(p => p.v);
  let mn = Math.min(...vs, 0), mx = Math.max(...vs, 0);
  const pad0 = (mx - mn) * .12 || 100; mx += pad0; if (mn < 0) mn -= pad0;
  const n = pontos.length, gw = (W - L - R) / n;
  const x = i => L + gw * i + gw / 2, y = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  let svg = '';
  [mn, (mn + mx) / 2, mx].forEach(v => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grade"/><text x="${L - 6}" y="${y(v) + 3.5}" class="eixo" text-anchor="end">${(v < 0 ? '−' : '') + brlCurto(v)}</text>`; });
  if (mn < 0) svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>`;
  const real = pontos.map((p, i) => ({ ...p, i })).filter(p => !p.proj);
  const proj = pontos.map((p, i) => ({ ...p, i })).filter(p => p.proj);
  const caminho = ps => ps.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  if (real.length) svg += `<path d="${caminho(real)}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>`;
  if (proj.length) svg += `<path d="${caminho(real.slice(-1).concat(proj))}" fill="none" stroke="${cor}" stroke-width="2" stroke-dasharray="5 4" opacity=".8"/>`;
  pontos.forEach((p, i) => {
    svg += `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="${p.proj ? 'var(--card)' : cor}" stroke="${p.proj ? cor : 'var(--card)'}" stroke-width="2"/>`;
    svg += `<text x="${x(i)}" y="${H - 6}" class="eixo" text-anchor="middle">${n > 6 ? MESES[+p.ym.slice(5) - 1] : nomeMes(p.ym)}</text>`;
    svg += `<rect x="${x(i) - gw / 2}" y="${T}" width="${gw}" height="${H - T - B}" fill="transparent" data-tip="${esc(`<b>${nomeMes(p.ym, true)}</b><span>${p.proj ? 'Projeção' : 'Saldo no fim do mês'}: ${brl(p.v)}</span>`)}"/>`;
  });
  const ult = real[real.length - 1];
  if (ult) svg += `<text x="${Math.min(x(ult.i), W - R - 2)}" y="${y(ult.v) - 9}" class="rotulo-svg" text-anchor="${ult.i === n - 1 ? 'end' : 'middle'}">${brlCurto(ult.v)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img">${svg}</svg>`;
}
function miniColunas(vals, cor) {
  const W = 66, H = 22, n = vals.length, mx = Math.max(...vals, 0.01), bw = W / n - 3;
  return `<svg viewBox="0 0 ${W} ${H}" class="mini">${vals.map((v, i) => { const h = Math.max(v > 0 ? 2 : 0, (H - 2) * v / mx); return `<rect x="${i * (bw + 3)}" y="${H - h}" width="${bw}" height="${h}" rx="1.5" fill="${cor}" opacity="${i === n - 1 ? 1 : .45}"/>`; }).join('')}</svg>`;
}
const legenda = itens => `<div class="legenda">${itens.map(i => `<span><i class="${i.tipo || ''}" style="--c:${i.cor}"></i>${esc(i.nome)}</span>`).join('')}</div>`;

function barrasMedia(lista, vazio) {
  if (!lista.length) return `<div class="vazio">${vazio}</div>`;
  const mx = Math.max(...lista.map(x => Math.max(x.media, x.mes)), 0.01);
  const item = x => `<div class="barra-item" data-tip="${esc(`<b>${esc(x.nome)}</b><span>Média mensal: ${brl(x.media)}</span><span>Mês selecionado: ${brl(x.mes)}</span><span>Total no período: ${brl(x.total)}</span>`)}">
    <div class="topo-b"><span>${esc(x.cat.icone || '')} ${esc(x.nome)}</span><span class="num">${brl(x.media)}<small class="rotulo"> /mês</small></span></div>
    <div class="barra com-marca"><i style="width:${(x.media / mx * 100).toFixed(1)}%;background:${esc(x.cat.cor || '#9AA0A6')}"></i><b style="left:${(x.mes / mx * 100).toFixed(1)}%"></b></div>
  </div>`;
  const LIM = 7;
  return lista.slice(0, LIM).map(item).join('') +
    (lista.length > LIM ? `<details class="mais-itens"><summary>Ver mais ${lista.length - LIM}</summary>${lista.slice(LIM).map(item).join('')}</details>` : '');
}

function telaPainel() {
  const D = dadosPainel();
  const n = D.comDados.length;
  const base = n ? `média de ${n} ${n === 1 ? 'mês' : 'meses'}` : 'sem histórico ainda';
  const sobra = D.mediaEnt - D.mediaGas;
  const c = { ent: 'var(--c-entrada)', gas: 'var(--c-gasto)', saldo: 'var(--c-saldo)' };

  return `${mesNav()}
  <p class="rotulo centro">Janela: ${nomeMes(D.meses[0])} a ${nomeMes(D.meses[N_MESES - 1])} · ${base}</p>
  <div class="resumo">
    <div class="card destaque"><div class="rotulo">Saldo geral hoje</div><div class="valor num">${brl(D.saldoHoje)}</div></div>
    <div class="card"><div class="rotulo">Entradas / mês</div><div class="valor num pos">${brl(D.mediaEnt)}</div><div class="rotulo">média</div></div>
    <div class="card"><div class="rotulo">Gastos / mês</div><div class="valor num neg">${brl(D.mediaGas)}</div><div class="rotulo">média</div></div>
    <div class="card"><div class="rotulo">Sobra média / mês</div><div class="valor num ${sobra < 0 ? 'neg' : 'pos'}">${brl(sobra)}</div></div>
    <div class="card"><div class="rotulo">Próximo mês (projeção)</div><div class="valor num">${brl(D.proj[0].total)}</div><div class="rotulo">em gastos</div></div>
  </div>

  <div class="card"><h2>Projeção de gastos <small>próximos 6 meses</small></h2>
    ${legenda([{ nome: 'Já comprometido (faturas e parcelas)', cor: c.gas }, { nome: 'Estimativa do dia a dia', cor: c.gas, tipo: 'hach' }, { nome: 'Média de entradas', cor: c.ent, tipo: 'tracejado' }])}
    ${graficoColunas({ meses: D.futuros, empilhado: true, series: [{ nome: 'Comprometido', cor: c.gas, valores: D.proj.map(p => p.comp) }, { nome: 'Estimativa', cor: c.gas, hachura: true, valores: D.proj.map(p => p.est) }], linhas: [{ valor: D.mediaEnt, cor: c.ent }], vazio: 'Sem parcelas futuras' })}
    <p class="rotulo">A estimativa usa a média dos gastos à vista (sem parcelas) dos últimos meses: ${brl(D.mediaVar)}/mês.</p>
  </div>

  <div class="card"><h2>Saldo geral <small>+ 3 meses projetados</small></h2>
    ${legenda([{ nome: 'Saldo real', cor: c.saldo }, { nome: 'Projeção (média de entradas − gastos projetados)', cor: c.saldo, tipo: 'tracejado' }])}
    ${graficoLinha(D.hist.concat(D.projSaldo), c.saldo)}
  </div>

  <div class="card"><h2>Entradas × gastos <small>por mês</small></h2>
    ${legenda([{ nome: 'Entradas', cor: c.ent }, { nome: 'Gastos', cor: c.gas }])}
    ${graficoColunas({ meses: D.meses, series: [{ nome: 'Entradas', cor: c.ent, valores: D.ent }, { nome: 'Gastos', cor: c.gas, valores: D.gas }] })}
  </div>

  <div class="card"><h2>Histórico de entradas <small>média ${brl(D.mediaEnt)}</small></h2>
    ${legenda([{ nome: 'Entradas do mês', cor: c.ent }, { nome: 'Média', cor: 'var(--txt2)', tipo: 'tracejado' }])}
    ${graficoColunas({ meses: D.meses, series: [{ nome: 'Entradas', cor: c.ent, valores: D.ent }], linhas: [{ valor: D.mediaEnt, cor: 'var(--txt2)' }] })}
  </div>

  <div class="card"><h2>Entradas por categoria <small>média mensal</small></h2>
    ${barrasMedia(D.catEnt, 'Sem entradas no período')}
    <p class="rotulo">Barra = média · traço = mês selecionado</p>
  </div>

  <div class="card"><h2>Gastos por categoria <small>média mensal</small></h2>
    ${barrasMedia(D.catGas, 'Sem gastos no período')}
    <p class="rotulo">Barra = média · traço = mês selecionado</p>
  </div>

  <div class="card"><h2>Gastos por conta e cartão <small>6 meses</small></h2>
    ${D.porConta.length ? D.porConta.map(x => `<div class="linha conta-linha" data-tip="${esc(`<b>${esc(x.c.nome)}</b>` + D.meses.map((ym, i) => `<span>${nomeMes(ym)}: ${brl(x.vals[i])}</span>`).join(''))}">
      <span class="ico" style="background:${esc(x.c.cor)}22;color:${esc(x.c.cor)}">${x.c.tipo === 'cartao' ? '💳' : '🏦'}</span>
      <span class="meio"><b>${esc(x.c.nome)}</b><span>média ${brlCurto(x.media)} · ${MESES[+S.mes.slice(5) - 1]} ${brlCurto(x.mes)}</span></span>
      ${miniColunas(x.vals, esc(x.c.cor))}
    </div>`).join('') : '<div class="vazio">Sem gastos no período</div>'}
  </div>`;
}
ligar.painel = () => ligarMesNav();

/* tooltip dos gráficos (mouse e toque) */
(function () {
  const dica = $('#dica-grafico');
  const mostrar = (alvo, x, y) => {
    dica.innerHTML = alvo.getAttribute('data-tip'); dica.hidden = false;
    const r = dica.getBoundingClientRect();
    dica.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    dica.style.top = Math.max(8, y - r.height - 14) + 'px';
  };
  document.addEventListener('pointermove', e => {
    const t = e.target.closest?.('[data-tip]');
    if (t) mostrar(t, e.clientX, e.clientY); else dica.hidden = true;
  });
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest?.('[data-tip]');
    if (t) mostrar(t, e.clientX, e.clientY); else dica.hidden = true;
  });
  addEventListener('scroll', () => (dica.hidden = true), { passive: true });
})();

/* ============================================================ faturas */
function telaFaturas() {
  const cs = cartoes();
  if (!cs.length) return '<div class="card vazio">Nenhum cartão cadastrado. Adicione em Ajustes.</div>';
  if (!contaPorId(S.ui.cartao)) S.ui.cartao = cs[0].id;
  const c = contaPorId(S.ui.cartao);
  if (!S.mesFatura) S.mesFatura = faturaDaCompra(c, hoje());
  const f = fatura(c.id, S.mesFatura);

  const porCat = {};
  f.itens.forEach(l => { const k = l.categoria || 'Sem categoria'; porCat[k] = porCat[k] || { n: 0, v: 0 }; porCat[k].n++; porCat[k].v += l.valor; });
  const cats = Object.entries(porCat).sort((a, b) => b[1].v - a[1].v);
  const parcelados = f.itens.filter(l => l.parcelas > 1);
  const itens = [...f.itens].sort((a, b) => b.data.localeCompare(a.data));

  return `<div class="chips">${cs.map(x => `<button class="chip ${x.id === c.id ? 'ativo' : ''}" data-cartao="${esc(x.id)}"><span class="bolinha" style="background:${esc(x.cor)}"></span>${esc(x.nome)}</button>`).join('')}</div>
  ${mesNav('mesFatura')}
  <div class="fatura" style="background:${esc(c.cor || '#333')}">
    <div class="banco">${esc(c.banco)} · ${esc(c.titular || '')}</div>
    <div class="total num">${brl(f.total)}</div>
    <div class="datas">Fecha ${dataCurta(f.fech)} · Vence ${dataCurta(f.venc)} · ${f.itens.length} lançamentos</div>
    ${f.pago > 0 && f.status !== 'paga' ? `<div class="datas">Pago ${brl(f.pago)} · falta ${brl(f.restante)}</div>` : ''}
    <div class="acoes"><span class="selo ${f.status}">${NOME_STATUS[f.status]}</span>
      ${f.restante > 0.004 ? `<button class="btn-peq" id="pagar-fatura">Pagar fatura</button>` : ''}</div>
  </div>

  ${cats.length ? `<div class="card"><h2>Por categoria</h2>${cats.map(([n, x]) => { const k = categoria(n); return `<div class="barra-item"><div class="topo-b"><span>${esc(k.icone || '')} ${esc(n)} <span class="rotulo">· ${x.n}</span></span><span class="num">${brl(x.v)}</span></div><div class="barra"><i style="width:${(x.v / (cats[0][1].v || 1) * 100).toFixed(1)}%;background:${esc(k.cor)}"></i></div></div>`; }).join('')}</div>` : ''}

  ${parcelados.length ? `<div class="card"><h2>Parcelas nesta fatura <small>${brl(parcelados.reduce((s, l) => s + l.valor, 0))}</small></h2>${parcelados.map(linhaLanc).join('')}</div>` : ''}

  <div class="card"><h2>Lançamentos</h2>${itens.length ? itens.map(linhaLanc).join('') : '<div class="vazio">Nenhum lançamento nesta fatura</div>'}</div>
  ${f.pagamentos.length ? `<div class="card"><h2>Pagamentos</h2>${f.pagamentos.map(linhaLanc).join('')}</div>` : ''}`;
}
ligar.faturas = () => {
  ligarMesNav('mesFatura');
  $$('[data-cartao]').forEach(b => b.onclick = () => {
    S.ui.cartao = b.dataset.cartao; salvarUI();
    S.mesFatura = faturaDaCompra(contaPorId(b.dataset.cartao), hoje()); render();
  });
  const p = $('#pagar-fatura');
  if (p) p.onclick = () => { S.form = { tipo: 'pagamento', cartao: S.ui.cartao, fatura: S.mesFatura }; ir('lancar'); };
  ligarLinhas();
};

/* ============================================================ lista */
function linhaLanc(l) {
  const c = contaPorId(l.conta);
  const cat = categoria(l.categoria, l.tipo === 'entrada' ? 'entrada' : 'despesa');
  let ico = cat.icone || '•', cor = cat.cor || '#9AA0A6', sub = [], sinal = '-', cls = '';
  if (l.tipo === 'entrada') { sinal = '+'; cls = 'pos'; sub.push(l.origem || l.categoria); }
  else if (l.tipo === 'pagamento') { ico = '✓'; cor = contaPorId(l.destino)?.cor || '#888'; sub.push('Fatura ' + (l.fatura ? nomeMes(l.fatura) : '')); }
  else if (l.tipo === 'transferencia') { ico = '⇄'; cor = '#6B7A8F'; sub.push('→ ' + (contaPorId(l.destino)?.nome || 'outra conta')); }
  else sub.push(l.categoria);
  sub.push(c?.nome || l.conta);
  if (l.parcelas > 1) sub.push(`${l.parcela}/${l.parcelas}`);
  const neutro = l.tipo === 'pagamento' || l.tipo === 'transferencia';
  const v = l.valor;
  return `<button class="linha" data-lanc="${esc(l.id)}">
    <span class="ico" style="background:${esc(cor)}22;color:${esc(cor)}">${esc(ico)}</span>
    <span class="meio"><b>${esc(l.descricao || l.categoria || '(sem descrição)')}</b><span>${esc(sub.filter(Boolean).join(' · '))}</span></span>
    <span class="dir num ${neutro ? '' : v < 0 ? 'pos' : cls}">${v < 0 ? '+' : neutro ? '' : sinal} ${brl(Math.abs(v)).replace('R$ ', 'R$ ')}<small>${dataCurta(l.data)}</small></span>
  </button>`;
}
function ligarLinhas() { $$('[data-lanc]').forEach(b => b.onclick = () => abrirEdicao(b.dataset.lanc)); }

const FILTROS = { todos: 'Todos', despesa: 'Despesas', entrada: 'Entradas', pagamento: 'Pagamentos', transferencia: 'Transferências' };
function telaLista() {
  const filtro = S.ui.filtro || 'todos';
  const busca = (S.busca || '').toLowerCase();
  let ls = S.lanc.filter(l => competencia(l) === S.mes);
  if (filtro !== 'todos') ls = ls.filter(l => l.tipo === filtro);
  if (S.ui.contaFiltro) ls = ls.filter(l => l.conta === S.ui.contaFiltro || l.destino === S.ui.contaFiltro);
  if (busca) ls = ls.filter(l => [l.descricao, l.categoria, l.origem, l.obs, contaPorId(l.conta)?.nome].join(' ').toLowerCase().includes(busca));
  ls.sort((a, b) => b.data.localeCompare(a.data) || String(b.criado_em).localeCompare(String(a.criado_em)));
  const grupos = {};
  ls.forEach(l => (grupos[l.data] = grupos[l.data] || []).push(l));
  const tot = ls.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0);

  return `${mesNav()}
  <div class="busca"><input id="busca" type="search" placeholder="Buscar descrição, categoria, conta…" value="${esc(S.busca || '')}"></div>
  <div class="chips">${Object.entries(FILTROS).map(([k, n]) => `<button class="chip ${k === filtro ? 'ativo' : ''}" data-filtro="${k}">${n}</button>`).join('')}</div>
  <div class="chips"><button class="chip ${!S.ui.contaFiltro ? 'ativo' : ''}" data-cf="">Todas as contas</button>${S.contas.map(c => `<button class="chip ${S.ui.contaFiltro === c.id ? 'ativo' : ''}" data-cf="${esc(c.id)}"><span class="bolinha" style="background:${esc(c.cor)}"></span>${esc(c.nome)}</button>`).join('')}</div>
  <p class="rotulo">${ls.length} lançamentos · despesas ${brl(tot)}<br>Compras no cartão aparecem no mês da fatura.</p>
  ${Object.keys(grupos).length ? Object.entries(grupos).map(([d, it]) => `<div class="dia">${dataLonga(d)}</div><div class="card" style="padding:4px 16px">${it.map(linhaLanc).join('')}</div>`).join('') : '<div class="card vazio">Nada por aqui neste mês</div>'}`;
}
ligar.lista = () => {
  ligarMesNav(); ligarLinhas();
  $$('[data-filtro]').forEach(b => b.onclick = () => { S.ui.filtro = b.dataset.filtro; salvarUI(); render(); });
  $$('[data-cf]').forEach(b => b.onclick = () => { S.ui.contaFiltro = b.dataset.cf; salvarUI(); render(); });
  const i = $('#busca');
  i.oninput = () => { S.busca = i.value; clearTimeout(i.t); i.t = setTimeout(() => { const pos = i.selectionStart; render(); const n = $('#busca'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
};

/* ============================================================ lançar */
const TIPOS = { despesa: 'Despesa', entrada: 'Entrada', pagamento: 'Pagamento', transferencia: 'Transf.' };
function opcoesContas(lista, sel, vazio) {
  return (vazio ? `<option value="">${vazio}</option>` : '') +
    lista.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
}
function gradeCategorias(tipo, sel) {
  const cs = S.categorias.filter(c => c.tipo === tipo);
  return `<div class="cats" id="cats">${cs.map(c => `<button type="button" data-cat="${esc(c.nome)}" class="${c.nome === sel ? 'ativo' : ''}"><span>${esc(c.icone || '•')}</span>${esc(c.nome)}</button>`).join('')}</div>`;
}

function telaLancar() {
  const F = S.form = S.form || {};
  F.tipo = F.tipo || 'despesa';
  F.data = F.data || hoje();
  const seg = `<div class="segmento">${Object.entries(TIPOS).map(([k, n]) => `<button data-tipo="${k}" class="${k === F.tipo ? 'ativo' : ''}">${n}</button>`).join('')}</div>`;
  const valor = (rot = 'Valor') => `<div class="campo valor-grande"><label for="f-valor">${rot}</label><input id="f-valor" inputmode="decimal" placeholder="0,00" value="${esc(F.valor || '')}" autocomplete="off"></div>`;
  const data = `<div class="campo"><label for="f-data">Data</label><input id="f-data" type="date" value="${esc(F.data)}"></div>`;
  const obs = `<div class="campo"><label for="f-obs">Observação (opcional)</label><input id="f-obs" value="${esc(F.obs || '')}"></div>`;

  if (F.tipo === 'despesa') {
    const todas = [...cartoes(), ...contasCorrentes()];
    F.conta = F.conta || S.ui.ultimaConta || todas[0]?.id;
    const cartao = ehCartao(F.conta);
    const n = Math.max(1, +F.parcelas || 1);
    let dica = '';
    if (cartao && F.data) {
      const f0 = F.faturaManual || faturaDaCompra(contaPorId(F.conta), F.data);
      const v = lerValor(F.valor);
      const parc = F.parcelado && n > 1 ? (F.modoValor === 'parcela' ? v : v / n) : v;
      dica = `<div class="dica">${F.parcelado && n > 1 ? `${n}x de <b>${isNaN(parc) ? '—' : brl(parc)}</b> · ` : ''}entra na fatura de <b>${nomeMes(f0, true)}</b>${F.parcelado && n > 1 ? ` até ${nomeMes(somaMes(f0, n - 1), true)}` : ''}</div>`;
    }
    return `${seg}${valor(F.parcelado && F.modoValor === 'parcela' ? 'Valor da parcela' : 'Valor')}
      <div class="campo"><label for="f-desc">Descrição</label><input id="f-desc" value="${esc(F.descricao || '')}" placeholder="Ex.: Mercado, gasolina…" list="dl-desc"></div>
      <datalist id="dl-desc">${[...new Set(S.lanc.filter(l => l.tipo === 'despesa').map(l => l.descricao))].slice(-80).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <div class="campo"><span class="rotulo">Categoria</span>${gradeCategorias('despesa', F.categoria)}</div>
      <div class="campo"><label for="f-conta">Pago com</label><select id="f-conta">
        <optgroup label="Cartões">${opcoesContas(cartoes(), F.conta)}</optgroup>
        <optgroup label="Conta / Pix / Débito">${opcoesContas(contasCorrentes(), F.conta)}</optgroup></select></div>
      ${data}
      ${cartao ? `<div class="campo"><label class="alternar">Parcelado?<input type="checkbox" id="f-parcelado" ${F.parcelado ? 'checked' : ''}></label></div>
        ${F.parcelado ? `<div class="dupla campo">
          <div><label class="rotulo" for="f-n">Quantas vezes</label><select id="f-n">${Array.from({ length: 23 }, (_, i) => i + 2).map(i => `<option ${i === n ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
          <div><label class="rotulo" for="f-modo">O valor digitado é</label><select id="f-modo"><option value="total" ${F.modoValor !== 'parcela' ? 'selected' : ''}>o total</option><option value="parcela" ${F.modoValor === 'parcela' ? 'selected' : ''}>de cada parcela</option></select></div>
        </div>` : ''}
        ${dica}
        <div class="campo"><label for="f-fatura">Fatura (1ª parcela)</label><select id="f-fatura">${[-1, 0, 1, 2].map(k => { const auto = faturaDaCompra(contaPorId(F.conta), F.data); const ym = somaMes(auto, k); return `<option value="${k === 0 ? '' : ym}" ${(F.faturaManual || '') === (k === 0 ? '' : ym) ? 'selected' : ''}>${nomeMes(ym, true)}${k === 0 ? ' (automático)' : ''}</option>`; }).join('')}</select></div>` : ''}
      ${obs}
      <button class="btn" id="salvar">Lançar despesa</button>`;
  }

  if (F.tipo === 'entrada') {
    F.conta = contaPorId(F.conta) && !ehCartao(F.conta) ? F.conta : (S.ui.ultimaContaEntrada || contasCorrentes()[0]?.id);
    const origens = [...new Set(S.lanc.filter(l => l.tipo === 'entrada' && l.origem).map(l => l.origem))];
    return `${seg}${valor()}
      <div class="campo"><label for="f-origem">Origem</label><input id="f-origem" value="${esc(F.origem || '')}" placeholder="De onde veio? Ex.: Salário, cliente X" list="dl-origem"></div>
      <datalist id="dl-origem">${origens.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
      <div class="campo"><span class="rotulo">Categoria</span>${gradeCategorias('entrada', F.categoria)}</div>
      <div class="campo"><label for="f-conta">Entrou em qual banco</label><select id="f-conta">${opcoesContas(contasCorrentes(), F.conta)}</select></div>
      ${data}${obs}
      <button class="btn" id="salvar">Lançar entrada</button>`;
  }

  if (F.tipo === 'pagamento') {
    const cs = cartoes();
    F.cartao = F.cartao && contaPorId(F.cartao) ? F.cartao : cs[0]?.id;
    if (!F.cartao) return seg + '<div class="card vazio">Cadastre um cartão em Ajustes.</div>';
    const fats = faturasDoCartao(F.cartao).filter(f => f.restante > 0.004);
    if (!F.fatura || !fats.find(f => f.ym === F.fatura)) F.fatura = fats[0]?.ym || '';
    const fsel = fats.find(f => f.ym === F.fatura);
    if (fsel && F.valorAuto !== F.fatura) { F.valor = String(fsel.restante.toFixed(2)).replace('.', ','); F.valorAuto = F.fatura; }
    const cart = contaPorId(F.cartao);
    F.conta = F.conta && !ehCartao(F.conta) && contaPorId(F.conta) ? F.conta : (cart.conta_pagamento || contasCorrentes()[0]?.id);
    return `${seg}
      <div class="campo"><label for="f-cartao">Cartão</label><select id="f-cartao">${opcoesContas(cs, F.cartao)}</select></div>
      <div class="campo"><label for="f-fat">Fatura</label><select id="f-fat">${fats.length ? fats.map(f => `<option value="${f.ym}" ${f.ym === F.fatura ? 'selected' : ''}>${nomeMes(f.ym, true)} · ${brl(f.restante)} · ${NOME_STATUS[f.status].toLowerCase()}</option>`).join('') : '<option value="">Nenhuma fatura em aberto</option>'}</select></div>
      ${valor('Valor pago')}
      <div class="campo"><label for="f-conta">Pago de qual conta</label><select id="f-conta">${opcoesContas(contasCorrentes(), F.conta)}</select></div>
      ${data}${obs}
      <button class="btn" id="salvar" ${fats.length ? '' : 'disabled style="opacity:.5"'}>Registrar pagamento</button>`;
  }

  // transferência
  const cc = contasCorrentes();
  F.conta = F.conta && !ehCartao(F.conta) && contaPorId(F.conta) ? F.conta : cc[0]?.id;
  F.destino = F.destino || cc.find(c => c.id !== F.conta)?.id;
  return `${seg}${valor()}
    <div class="dupla campo">
      <div><label class="rotulo" for="f-conta">De</label><select id="f-conta">${opcoesContas(cc, F.conta)}</select></div>
      <div><label class="rotulo" for="f-destino">Para</label><select id="f-destino">${opcoesContas(cc, F.destino, 'Outra conta (fora do app)')}</select></div>
    </div>
    <div class="campo"><label for="f-desc">Descrição</label><input id="f-desc" value="${esc(F.descricao || '')}" placeholder="Ex.: Reserva, acerto"></div>
    ${data}${obs}
    <p class="rotulo">Transferências entre suas contas não contam como despesa nem entrada.</p>
    <button class="btn" id="salvar">Registrar transferência</button>`;
}

function lerForm() {
  const F = S.form;
  const v = id => $('#' + id)?.value;
  if ($('#f-valor')) F.valor = v('f-valor');
  if ($('#f-desc')) F.descricao = v('f-desc');
  if ($('#f-origem')) F.origem = v('f-origem');
  if ($('#f-data')) F.data = v('f-data');
  if ($('#f-obs')) F.obs = v('f-obs');
  if ($('#f-conta')) F.conta = v('f-conta');
  if ($('#f-destino')) F.destino = v('f-destino');
  if ($('#f-parcelado')) F.parcelado = $('#f-parcelado').checked;
  if ($('#f-n')) F.parcelas = +v('f-n');
  if ($('#f-modo')) F.modoValor = v('f-modo');
  if ($('#f-fatura')) F.faturaManual = v('f-fatura');
  if ($('#f-cartao')) F.cartao = v('f-cartao');
  if ($('#f-fat')) F.fatura = v('f-fat');
}

ligar.lancar = () => {
  const F = S.form;
  const rerender = () => { lerForm(); render(); };
  $$('[data-tipo]').forEach(b => b.onclick = () => { lerForm(); S.form = { tipo: b.dataset.tipo, data: F.data, valor: F.valor }; render(); });
  $$('[data-cat]').forEach(b => b.onclick = () => { F.categoria = b.dataset.cat; $$('[data-cat]').forEach(x => x.classList.toggle('ativo', x === b)); });
  ['f-conta', 'f-parcelado', 'f-n', 'f-modo', 'f-fatura', 'f-cartao', 'f-fat', 'f-data'].forEach(id => { const el = $('#' + id); if (el) el.onchange = () => { if (id === 'f-cartao') { F.fatura = ''; F.conta = ''; } if (id === 'f-conta' || id === 'f-data') F.faturaManual = ''; rerender(); }; });
  const val = $('#f-valor');
  if (val) {
    val.oninput = () => { F.valor = val.value; const d = $('.dica'); if (d && F.tipo === 'despesa') { clearTimeout(val.t); val.t = setTimeout(() => { const p = val.selectionStart; rerender(); const n = $('#f-valor'); n.focus(); n.setSelectionRange(p, p); }, 400); } };
    if (!F.valor && F.tipo !== 'pagamento') setTimeout(() => val.focus(), 50);
  }
  $('#salvar').onclick = salvarForm;
};

async function salvarForm() {
  lerForm();
  const F = S.form;
  const valor = lerValor(F.valor);
  if (!(valor > 0)) return toast('Informe um valor', true);
  if (!F.data) return toast('Informe a data', true);
  const base = { data: F.data, tipo: F.tipo, valor, conta: F.conta, obs: F.obs || '' };
  let itens = [];

  if (F.tipo === 'despesa') {
    if (!F.categoria) return toast('Escolha uma categoria', true);
    const desc = (F.descricao || '').trim() || F.categoria;
    const cartao = ehCartao(F.conta);
    const n = cartao && F.parcelado ? Math.max(2, +F.parcelas || 2) : 1;
    const f0 = cartao ? (F.faturaManual || faturaDaCompra(contaPorId(F.conta), F.data)) : '';
    if (n === 1) {
      itens.push({ ...base, id: novoId('l'), descricao: desc, categoria: F.categoria, fatura: f0 });
    } else {
      const total = F.modoValor === 'parcela' ? valor * n : valor;
      const parc = Math.floor(total / n * 100) / 100;
      const grupo = novoId('g');
      for (let i = 1; i <= n; i++) {
        const v = i === n ? Math.round((total - parc * (n - 1)) * 100) / 100 : parc;
        itens.push({ ...base, id: novoId('l'), valor: v, descricao: desc, categoria: F.categoria, parcela: i, parcelas: n, grupo, fatura: somaMes(f0, i - 1) });
      }
    }
    S.ui.ultimaConta = F.conta;
  } else if (F.tipo === 'entrada') {
    if (!F.categoria) return toast('Escolha uma categoria', true);
    itens.push({ ...base, id: novoId('l'), descricao: (F.origem || '').trim() || F.categoria, categoria: F.categoria, origem: (F.origem || '').trim() });
    S.ui.ultimaContaEntrada = F.conta;
  } else if (F.tipo === 'pagamento') {
    if (!F.fatura) return toast('Escolha a fatura', true);
    const c = contaPorId(F.cartao);
    itens.push({ ...base, id: novoId('l'), descricao: `Pagamento fatura ${c.nome} ${nomeMes(F.fatura)}`, categoria: 'Pagamento de fatura', destino: F.cartao, fatura: F.fatura });
  } else {
    if (F.destino && F.destino === F.conta) return toast('Escolha contas diferentes', true);
    itens.push({ ...base, id: novoId('l'), descricao: (F.descricao || '').trim() || 'Transferência', destino: F.destino || '' });
  }
  salvarUI();
  const msg = itens.length > 1 ? `${itens.length} parcelas lançadas!` : 'Lançado!';
  if (await enviar('salvar', { itens }, msg)) {
    S.form = { tipo: F.tipo, data: F.data, conta: F.conta };
    if (F.tipo === 'pagamento') { S.form = null; ir('faturas'); } else render();
  }
}

/* ============================================================ edição */
function abrirModal(html) { const m = $('#modal'); m.innerHTML = `<div class="folha">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) fecharModal(); }; }
function fecharModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function abrirEdicao(id) {
  const l = S.lanc.find(x => x.id === id);
  if (!l) return;
  const tipoCat = l.tipo === 'entrada' ? 'entrada' : 'despesa';
  const cats = S.categorias.filter(c => c.tipo === tipoCat);
  const doGrupo = l.grupo ? S.lanc.filter(x => x.grupo === l.grupo) : [];
  const contas = l.tipo === 'despesa' ? [...cartoes(), ...contasCorrentes()] : contasCorrentes();
  abrirModal(`<h3>${TIPOS[l.tipo] || 'Lançamento'}${l.parcelas > 1 ? ` · parcela ${l.parcela}/${l.parcelas}` : ''}<button id="m-fechar" aria-label="Fechar">✕</button></h3>
    <div class="campo valor-grande"><label for="e-valor">Valor</label><input id="e-valor" inputmode="decimal" value="${esc(String(l.valor.toFixed(2)).replace('.', ','))}"></div>
    <div class="campo"><label for="e-desc">Descrição</label><input id="e-desc" value="${esc(l.descricao)}"></div>
    ${l.tipo === 'despesa' || l.tipo === 'entrada' ? `<div class="campo"><label for="e-cat">Categoria</label><select id="e-cat">${cats.map(c => `<option ${c.nome === l.categoria ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}${cats.find(c => c.nome === l.categoria) ? '' : `<option selected>${esc(l.categoria)}</option>`}</select></div>` : ''}
    ${l.tipo === 'entrada' ? `<div class="campo"><label for="e-origem">Origem</label><input id="e-origem" value="${esc(l.origem)}"></div>` : ''}
    <div class="dupla campo">
      <div><label class="rotulo" for="e-data">Data</label><input id="e-data" type="date" value="${esc(l.data)}"></div>
      <div><label class="rotulo" for="e-conta">${l.tipo === 'despesa' ? 'Pago com' : 'Conta'}</label><select id="e-conta">${opcoesContas(contas, l.conta)}</select></div>
    </div>
    ${l.tipo === 'transferencia' ? `<div class="campo"><label for="e-destino">Para</label><select id="e-destino">${opcoesContas(contasCorrentes(), l.destino, 'Outra conta (fora do app)')}</select></div>` : ''}
    ${(l.tipo === 'despesa' && ehCartao(l.conta)) || l.tipo === 'pagamento' ? `<div class="campo"><label for="e-fatura">Fatura (mês de vencimento)</label><input id="e-fatura" type="month" value="${esc(l.fatura || competencia(l))}"></div>` : ''}
    <div class="campo"><label for="e-obs">Observação</label><input id="e-obs" value="${esc(l.obs)}"></div>
    ${doGrupo.length > 1 ? `<div class="campo"><label class="alternar">Aplicar descrição e categoria às ${doGrupo.length} parcelas<input type="checkbox" id="e-grupo" checked></label></div>` : ''}
    <button class="btn" id="e-salvar">Salvar alterações</button>
    <button class="btn perigo" id="e-excluir">Excluir${doGrupo.length > 1 ? '…' : ''}</button>`);

  $('#m-fechar').onclick = fecharModal;
  $('#e-salvar').onclick = async () => {
    const v = lerValor($('#e-valor').value);
    if (!(Math.abs(v) > 0)) return toast('Valor inválido', true);
    const novo = { ...l, valor: v, descricao: $('#e-desc').value.trim(), data: $('#e-data').value, conta: $('#e-conta').value, obs: $('#e-obs').value };
    if ($('#e-cat')) novo.categoria = $('#e-cat').value;
    if ($('#e-origem')) novo.origem = $('#e-origem').value.trim();
    if ($('#e-destino')) novo.destino = $('#e-destino').value;
    if ($('#e-fatura')) novo.fatura = ehCartao(novo.conta) || l.tipo === 'pagamento' ? $('#e-fatura').value : '';
    if (l.tipo === 'despesa' && !ehCartao(novo.conta)) novo.fatura = '';
    let itens = [novo];
    if ($('#e-grupo')?.checked) {
      itens = itens.concat(doGrupo.filter(x => x.id !== l.id).map(x => ({ ...x, descricao: novo.descricao, categoria: novo.categoria })));
    }
    fecharModal();
    await enviar('salvar', { itens }, 'Alterado');
  };
  $('#e-excluir').onclick = () => {
    if (doGrupo.length > 1) {
      const futuras = doGrupo.filter(x => x.parcela >= l.parcela);
      abrirModal(`<h3>Excluir parcelas<button id="m-fechar">✕</button></h3>
        <p class="rotulo">"${esc(l.descricao)}" tem ${doGrupo.length} parcelas lançadas.</p>
        <button class="btn perigo" data-ex="uma">Só esta parcela (${l.parcela}/${l.parcelas})</button>
        <button class="btn perigo" data-ex="futuras">Esta e as próximas (${futuras.length})</button>
        <button class="btn perigo" data-ex="todas">Todas as parcelas (${doGrupo.length})</button>
        <button class="btn sec" id="m-cancelar">Cancelar</button>`);
      $('#m-fechar').onclick = $('#m-cancelar').onclick = fecharModal;
      $$('[data-ex]').forEach(b => b.onclick = async () => {
        const ids = b.dataset.ex === 'uma' ? [l.id] : (b.dataset.ex === 'futuras' ? futuras : doGrupo).map(x => x.id);
        fecharModal(); await enviar('excluir', { ids }, 'Excluído');
      });
    } else {
      abrirModal(`<h3>Excluir lançamento?<button id="m-fechar">✕</button></h3>
        <p>"${esc(l.descricao)}" · ${brl(l.valor)}</p><p class="rotulo">A linha será apagada da planilha.</p>
        <button class="btn perigo" id="m-sim">Excluir</button><button class="btn sec" id="m-cancelar">Cancelar</button>`);
      $('#m-fechar').onclick = $('#m-cancelar').onclick = fecharModal;
      $('#m-sim').onclick = async () => { fecharModal(); await enviar('excluir', { ids: [l.id] }, 'Excluído'); };
    }
  };
}

/* ============================================================ ajustes */
function telaAjustes() {
  return `<div class="card"><h2>Contas e cartões <button class="link" id="nova-conta">+ Adicionar</button></h2>
    ${S.contas.map(c => `<button class="linha" data-conta="${esc(c.id)}"><span class="ico" style="background:${esc(c.cor)}22;color:${esc(c.cor)}">${c.tipo === 'cartao' ? '💳' : '🏦'}</span>
      <span class="meio"><b>${esc(c.nome)}</b><span>${esc(c.titular || '')} · ${c.tipo === 'cartao' ? `fecha dia ${c.fechamento}, vence dia ${c.vencimento}` : 'conta'}</span></span><span class="dir">›</span></button>`).join('')}
  </div>
  <div class="card"><h2>Categorias <button class="link" id="nova-cat">+ Adicionar</button></h2>
    ${['despesa', 'entrada'].map(t => `<p class="rotulo">${t === 'despesa' ? 'Despesas' : 'Entradas'}</p><div class="chips" style="flex-wrap:wrap">${S.categorias.filter(c => c.tipo === t).map(c => `<button class="chip" data-delcat="${esc(c.nome)}|${t}">${esc(c.icone)} ${esc(c.nome)}</button>`).join('')}</div>`).join('')}
    <p class="rotulo">Toque numa categoria para removê-la (os lançamentos antigos não mudam).</p>
  </div>
  <div class="card"><h2>Planilha</h2>
    ${S.planilha ? `<a class="btn sec" style="text-align:center;text-decoration:none" href="${esc(S.planilha)}" target="_blank" rel="noopener">Abrir planilha no Google</a>` : ''}
    <button class="btn sec" id="sair">Desconectar este aparelho</button>
    <p class="rotulo" style="margin-top:12px">Versão ${VERSAO}</p>
  </div>`;
}
ligar.ajustes = () => {
  $$('[data-conta]').forEach(b => b.onclick = () => editarConta(contaPorId(b.dataset.conta)));
  $('#nova-conta').onclick = () => editarConta(null);
  $('#nova-cat').onclick = novaCategoria;
  $$('[data-delcat]').forEach(b => b.onclick = () => {
    const [nome, tipo] = b.dataset.delcat.split('|');
    abrirModal(`<h3>Remover "${esc(nome)}"?<button id="m-fechar">✕</button></h3><p class="rotulo">Lançamentos que já usam essa categoria continuam com ela.</p>
      <button class="btn perigo" id="m-sim">Remover</button><button class="btn sec" id="m-cancelar">Cancelar</button>`);
    $('#m-fechar').onclick = $('#m-cancelar').onclick = fecharModal;
    $('#m-sim').onclick = async () => { fecharModal(); await enviar('salvarCategorias', { itens: S.categorias.filter(c => !(c.nome === nome && c.tipo === tipo)) }, 'Removida'); };
  });
  $('#sair').onclick = () => {
    abrirModal(`<h3>Desconectar?<button id="m-fechar">✕</button></h3><p class="rotulo">Os dados continuam na planilha. Você vai precisar colar o código de novo.</p>
      <button class="btn perigo" id="m-sim">Desconectar</button><button class="btn sec" id="m-cancelar">Cancelar</button>`);
    $('#m-fechar').onclick = $('#m-cancelar').onclick = fecharModal;
    $('#m-sim').onclick = () => { localStorage.removeItem(CHAVE_CFG); localStorage.removeItem(CHAVE_CACHE); S.cfg = null; fecharModal(); render(); };
  };
};

function editarConta(c) {
  const novo = !c;
  c = c || { id: '', nome: '', tipo: 'cartao', banco: '', titular: '', fechamento: '', vencimento: '', conta_pagamento: '', saldo_inicial: '', data_saldo: '', cor: '#0F7B5F', ativo: 'sim' };
  abrirModal(`<h3>${novo ? 'Nova conta/cartão' : esc(c.nome)}<button id="m-fechar">✕</button></h3>
    <div class="campo"><label for="c-nome">Nome</label><input id="c-nome" value="${esc(c.nome)}"></div>
    <div class="dupla campo">
      <div><label class="rotulo" for="c-tipo">Tipo</label><select id="c-tipo"><option value="cartao" ${c.tipo === 'cartao' ? 'selected' : ''}>Cartão de crédito</option><option value="conta" ${c.tipo !== 'cartao' ? 'selected' : ''}>Conta bancária</option></select></div>
      <div><label class="rotulo" for="c-banco">Banco</label><input id="c-banco" value="${esc(c.banco)}"></div>
    </div>
    <div class="dupla campo">
      <div><label class="rotulo" for="c-titular">Titular</label><input id="c-titular" value="${esc(c.titular)}"></div>
      <div><label class="rotulo" for="c-cor">Cor</label><input id="c-cor" type="color" value="${esc(c.cor || '#0F7B5F')}" style="height:48px;padding:4px"></div>
    </div>
    <div id="c-cartao" ${c.tipo === 'cartao' ? '' : 'hidden'}>
      <div class="dupla campo">
        <div><label class="rotulo" for="c-fech">Dia de fechamento</label><input id="c-fech" inputmode="numeric" value="${esc(c.fechamento || '')}"></div>
        <div><label class="rotulo" for="c-venc">Dia de vencimento</label><input id="c-venc" inputmode="numeric" value="${esc(c.vencimento || '')}"></div>
      </div>
      <div class="campo"><label for="c-pag">Fatura é paga pela conta</label><select id="c-pag">${opcoesContas(contasCorrentes(), c.conta_pagamento, '—')}</select></div>
    </div>
    <div id="c-conta" ${c.tipo !== 'cartao' ? '' : 'hidden'}>
      <div class="dupla campo">
        <div><label class="rotulo" for="c-saldo">Saldo em</label><input id="c-data" type="date" value="${esc(String(c.data_saldo || '').slice(0, 10))}"></div>
        <div><label class="rotulo" for="c-saldo">Saldo nesse dia (R$)</label><input id="c-saldo" inputmode="decimal" value="${c.saldo_inicial !== '' ? esc(String(c.saldo_inicial).replace('.', ',')) : ''}"></div>
      </div>
      <p class="rotulo">O app soma os lançamentos feitos depois dessa data.</p>
    </div>
    <div class="campo"><label class="alternar">Ativo<input type="checkbox" id="c-ativo" ${c.ativo === 'não' || c.ativo === 'nao' ? '' : 'checked'}></label></div>
    <button class="btn" id="c-salvar">Salvar</button>`);
  $('#m-fechar').onclick = fecharModal;
  $('#c-tipo').onchange = () => { const k = $('#c-tipo').value === 'cartao'; $('#c-cartao').hidden = !k; $('#c-conta').hidden = k; };
  $('#c-salvar').onclick = async () => {
    const nome = $('#c-nome').value.trim();
    if (!nome) return toast('Informe o nome', true);
    const tipo = $('#c-tipo').value;
    const item = {
      id: c.id || nome.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '_' + Math.random().toString(36).slice(2, 5),
      nome, tipo, banco: $('#c-banco').value.trim(), titular: $('#c-titular').value.trim(), cor: $('#c-cor').value,
      fechamento: tipo === 'cartao' ? +$('#c-fech').value || '' : '', vencimento: tipo === 'cartao' ? +$('#c-venc').value || '' : '',
      conta_pagamento: tipo === 'cartao' ? $('#c-pag').value : '',
      saldo_inicial: tipo === 'conta' ? (lerValor($('#c-saldo').value) || 0) : '', data_saldo: tipo === 'conta' ? $('#c-data').value : '',
      ativo: $('#c-ativo').checked ? 'sim' : 'não',
    };
    if (tipo === 'cartao' && !(item.fechamento >= 1 && item.fechamento <= 31 && item.vencimento >= 1 && item.vencimento <= 31)) return toast('Informe dias de fechamento e vencimento (1 a 31)', true);
    fecharModal();
    await enviar('salvarContas', { itens: [item] }, 'Salvo');
  };
}

function novaCategoria() {
  abrirModal(`<h3>Nova categoria<button id="m-fechar">✕</button></h3>
    <div class="campo"><label for="n-nome">Nome</label><input id="n-nome"></div>
    <div class="dupla campo">
      <div><label class="rotulo" for="n-tipo">Tipo</label><select id="n-tipo"><option value="despesa">Despesa</option><option value="entrada">Entrada</option></select></div>
      <div><label class="rotulo" for="n-icone">Emoji</label><input id="n-icone" value="•" maxlength="4"></div>
    </div>
    <div class="campo"><label for="n-cor">Cor</label><input id="n-cor" type="color" value="#3A7BD5" style="height:48px;padding:4px"></div>
    <button class="btn" id="n-salvar">Adicionar</button>`);
  $('#m-fechar').onclick = fecharModal;
  $('#n-salvar').onclick = async () => {
    const nome = $('#n-nome').value.trim(); const tipo = $('#n-tipo').value;
    if (!nome) return toast('Informe o nome', true);
    if (S.categorias.find(c => c.nome === nome && c.tipo === tipo)) return toast('Essa categoria já existe', true);
    fecharModal();
    await enviar('salvarCategorias', { itens: [...S.categorias, { nome, tipo, cor: $('#n-cor').value, icone: $('#n-icone').value || '•' }] }, 'Categoria criada');
  };
}

/* ============================================================ início do app */
(function iniciar() {
  try { S.cfg = JSON.parse(localStorage.getItem(CHAVE_CFG)); } catch { S.cfg = null; }
  // código via link (#c=...)
  const m = location.hash.match(/c=([\w\-=]+)/);
  if (m && !S.cfg) {
    try { S.cfg = decodificarCodigo(m[1]); localStorage.setItem(CHAVE_CFG, JSON.stringify(S.cfg)); } catch {}
    history.replaceState(null, '', location.pathname);
  }
  if (S.cfg) {
    try { const c = JSON.parse(localStorage.getItem(CHAVE_CACHE)); if (c) aplicarDados(c); } catch {}
    render();
    atualizar(true);
  } else render();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.cfg && Date.now() - (S.ultimaAtualizacao || 0) > 60000) {
      S.ultimaAtualizacao = Date.now(); atualizar(true);
    }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();

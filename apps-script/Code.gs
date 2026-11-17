/**
 * Controle Financeiro — backend (Google Apps Script ligado à planilha).
 *
 * A planilha é o banco de dados. Este script expõe uma API simples (JSON)
 * para o app PWA. O acesso é protegido por um token guardado nas
 * Propriedades do Script (nunca no código publicado).
 *
 * Funções para rodar manualmente no editor:
 *   configurar()      cria as abas, o token e importa os dados iniciais
 *   codigoDoApp()     mostra o código para colar no app (depois de implantar)
 *   ativarBackup()    liga a cópia de segurança diária da planilha (rodar uma vez)
 *   trocarToken()     gera um token novo e invalida o antigo (celular perdido, por exemplo)
 */

var ABAS = {
  Contas: ['id', 'nome', 'tipo', 'banco', 'titular', 'fechamento', 'vencimento', 'conta_pagamento',
           'saldo_inicial', 'data_saldo', 'cor', 'ativo'],
  Categorias: ['nome', 'tipo', 'cor', 'icone'],
  Lancamentos: ['id', 'data', 'tipo', 'descricao', 'categoria', 'valor', 'conta', 'destino', 'parcela',
                'parcelas', 'grupo', 'fatura', 'origem', 'obs', 'criado_em']
};
// colunas guardadas como texto (evita o Sheets converter "2026-11" em data)
var COLUNAS_TEXTO = ['id', 'data', 'fatura', 'data_saldo', 'grupo', 'criado_em', 'conta', 'destino', 'conta_pagamento'];
var CHAVE = { Contas: 'id', Categorias: null, Lancamentos: 'id' };

/* ------------------------------------------------------------------ setup */

function configurar() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(ABAS).forEach(function (nome) { garantirAba_(ss, nome); });
  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Planilha1');
  if (padrao && ss.getSheets().length > 1 && padrao.getLastRow() === 0) ss.deleteSheet(padrao);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    var t = (typeof TOKEN_INICIAL !== 'undefined') ? TOKEN_INICIAL : Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', t);
  }

  if (typeof DADOS_INICIAIS !== 'undefined') {
    Object.keys(DADOS_INICIAIS).forEach(function (nome) {
      var sh = ss.getSheetByName(nome);
      var linhas = DADOS_INICIAIS[nome];
      if (sh.getLastRow() > 1 || !linhas.length) {
        Logger.log('Aba ' + nome + ' já tem dados — importação ignorada.');
        return;
      }
      sh.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
      Logger.log('Aba ' + nome + ': ' + linhas.length + ' linhas importadas.');
    });
  }
  Logger.log('Pronto! Agora implante como App da Web e rode codigoDoApp().');
}

// Se o endereço sair terminando em /dev, cole aqui o endereço do App da Web
// (Implantar > Gerenciar implantações > URL terminando em /exec) e rode de novo.
var URL_DO_APP = '';

function codigoDoApp() {
  var url = URL_DO_APP || ScriptApp.getService().getUrl();
  if (!url) throw new Error('Implante primeiro: Implantar > Nova implantação > App da Web.');
  if (!/\/exec$/.test(url)) throw new Error('O endereço precisa terminar em /exec. Copie a URL em Implantar > Gerenciar implantações, cole em URL_DO_APP (no topo desta função) e rode de novo.');
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var codigo = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, t: token }));
  Logger.log('Código do app (copie tudo):\n\n' + codigo);
  return codigo;
}

function garantirAba_(ss, nome) {
  var cab = ABAS[nome];
  var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#EEF1F5');
    sh.setFrozenRows(1);
  }
  cab.forEach(function (c, i) {
    if (COLUNAS_TEXTO.indexOf(c) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return sh;
}

/* -------------------------------------------------------------------- API */

function doGet(e) {
  return responder_(function () {
    autorizar_(e.parameter.token);
    return lerTudo_();
  });
}

function doPost(e) {
  return responder_(function () {
    var req = JSON.parse(e.postData.contents);
    autorizar_(req.token);
    if (req.acao === 'ler') return lerTudo_(); // leitura por POST: o token não vai no endereço
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (req.acao) {
        case 'salvar':   salvar_('Lancamentos', validar_('Lancamentos', req.itens)); break;
        case 'excluir':  excluir_('Lancamentos', lista_(req.ids)); break;
        case 'salvarContas': salvar_('Contas', validar_('Contas', req.itens)); break;
        case 'adicionarCategoria': adicionarCategoria_(validar_('Categorias', [req.item])[0]); break;
        case 'removerCategoria': removerCategoria_(String(req.nome || ''), String(req.tipo || '')); break;
        case 'salvarCategorias': substituirCategorias_(validar_('Categorias', req.itens)); break;
        default: throw new Error('Ação desconhecida: ' + req.acao);
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return lerTudo_();
  });
}

function responder_(fn) {
  var out;
  try { out = { ok: true, dados: fn() }; }
  catch (err) { out = { ok: false, erro: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function autorizar_(token) {
  var certo = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!certo || token !== certo) throw new Error('nao_autorizado');
}

/* ---------------------------------------------------------- validação */

var MAX_ITENS = 500, MAX_TEXTO = 500;
var TIPOS = {
  Lancamentos: ['despesa', 'entrada', 'pagamento', 'transferencia', 'plano'],
  Contas: ['conta', 'cartao'],
  Categorias: ['despesa', 'entrada']
};

function lista_(v) {
  if (!Array.isArray(v)) throw new Error('Pedido inválido');
  if (v.length > MAX_ITENS) throw new Error('Itens demais de uma vez (máximo ' + MAX_ITENS + ')');
  return v;
}

// Confere cada item antes de gravar: só colunas conhecidas, tipos e formatos certos.
function validar_(nome, itens) {
  return lista_(itens).map(function (it) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Error('Item inválido');
    var o = {};
    ABAS[nome].forEach(function (c) {
      var v = it[c];
      if (v === undefined || v === null) return;
      if (typeof v === 'object') throw new Error('Valor inválido em ' + c);
      if (typeof v === 'string' && v.length > MAX_TEXTO) throw new Error('Texto longo demais em ' + c);
      o[c] = v;
    });
    if (TIPOS[nome].indexOf(o.tipo) < 0) throw new Error('Tipo inválido: ' + o.tipo);
    if (nome === 'Categorias') {
      if (!String(o.nome || '').trim()) throw new Error('Categoria sem nome');
      return o;
    }
    if (!/^[\w-]{1,40}$/.test(String(o.id || ''))) throw new Error('Id inválido');
    o.id = String(o.id);
    if (nome === 'Lancamentos') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.data || ''))) throw new Error('Data inválida: ' + o.data);
      if (o.fatura !== undefined && o.fatura !== '' && !/^\d{4}-\d{2}$/.test(String(o.fatura))) throw new Error('Fatura inválida: ' + o.fatura);
      o.valor = Number(o.valor);
      if (!isFinite(o.valor) || Math.abs(o.valor) > 1e9) throw new Error('Valor inválido');
    }
    return o;
  });
}

// Texto começando com = + - @ seria lido pelo Sheets como fórmula: o apóstrofo força texto puro.
function seguro_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v))) ? "'" + v : v;
}

/* ------------------------------------------------------------- leitura */

function lerTudo_() {
  var ss = SpreadsheetApp.getActive();
  return {
    contas: lerAba_(ss, 'Contas'),
    categorias: lerAba_(ss, 'Categorias'),
    lancamentos: lerAba_(ss, 'Lancamentos'),
    planilha: ss.getUrl(),
    api: 2, // versão do backend (2 = lixeira, validação, leitura por POST)
    atualizado: new Date().toISOString()
  };
}

function lerAba_(ss, nome) {
  var sh = ss.getSheetByName(nome);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = ss.getSpreadsheetTimeZone();
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var cab = vals.shift().map(String);
  return vals.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    cab.forEach(function (c, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'fatura' ? 'yyyy-MM' : 'yyyy-MM-dd');
      o[c] = v;
    });
    return o;
  });
}

/* ------------------------------------------------------------- escrita */

function salvar_(nome, itens) {
  if (!itens.length) return;
  var sh = garantirAba_(SpreadsheetApp.getActive(), nome);
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var chave = CHAVE[nome];
  var col = cab.indexOf(chave);
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getValues() : [];
  var linhaDoId = {};
  ids.forEach(function (r, i) { if (r[0] !== '') linhaDoId[String(r[0])] = i + 2; });

  var novos = [];
  itens.forEach(function (it) {
    if (!it[chave]) throw new Error('Item sem ' + chave);
    if (nome === 'Lancamentos' && !it.criado_em) it.criado_em = new Date().toISOString();
    var linha = cab.map(function (c) { return it[c] === undefined || it[c] === null ? '' : seguro_(it[c]); });
    var n = linhaDoId[String(it[chave])];
    if (n) {
      // preserva criado_em original
      var ci = cab.indexOf('criado_em');
      if (ci >= 0) linha[ci] = sh.getRange(n, ci + 1).getValue() || linha[ci];
      sh.getRange(n, 1, 1, cab.length).setValues([linha]);
    } else {
      novos.push(linha);
    }
  });
  if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, cab.length).setValues(novos);
}

// Excluir não apaga de vez: a linha vai para a aba "Lixeira" (com a data), de onde dá para recuperar.
function excluir_(nome, ids) {
  if (!ids.length) return;
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(nome);
  if (!sh || sh.getLastRow() < 2) return;
  var alvo = {};
  ids.forEach(function (i) { alvo[String(i)] = true; });
  var larg = sh.getLastColumn();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, larg).getValues();
  var tz = ss.getSpreadsheetTimeZone(), agora = new Date().toISOString();
  var cab = sh.getRange(1, 1, 1, larg).getValues()[0];
  var linhas = [], apagar = [];
  vals.forEach(function (r, i) {
    if (!alvo[String(r[0])]) return;
    apagar.push(i + 2);
    linhas.push([agora].concat(r.map(function (v, j) {
      if (v instanceof Date) v = Utilities.formatDate(v, tz, String(cab[j]) === 'fatura' ? 'yyyy-MM' : 'yyyy-MM-dd');
      return seguro_(v);
    })));
  });
  if (!apagar.length) return;
  var lx = ss.getSheetByName('Lixeira') || ss.insertSheet('Lixeira');
  if (lx.getLastRow() === 0) {
    lx.getRange(1, 1, 1, larg + 1).setValues([['excluido_em'].concat(cab)]).setFontWeight('bold').setBackground('#EEF1F5');
    lx.setFrozenRows(1);
    lx.getRange(2, 1, lx.getMaxRows() - 1, lx.getMaxColumns()).setNumberFormat('@');
  }
  lx.getRange(lx.getLastRow() + 1, 1, linhas.length, larg + 1).setValues(linhas);
  SpreadsheetApp.flush(); // só apaga depois que a cópia na Lixeira foi gravada
  for (var k = apagar.length - 1; k >= 0; k--) sh.deleteRow(apagar[k]);
}

function adicionarCategoria_(it) {
  var sh = garantirAba_(SpreadsheetApp.getActive(), 'Categorias');
  var cab = ABAS.Categorias;
  var atuais = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  if (atuais.some(function (r) { return String(r[0]) === String(it.nome) && String(r[1]) === it.tipo; })) return;
  sh.getRange(sh.getLastRow() + 1, 1, 1, cab.length).setValues([cab.map(function (c) { return seguro_(it[c] || ''); })]);
}

function removerCategoria_(nome, tipo) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Categorias');
  if (!sh || sh.getLastRow() < 2) return;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === nome && String(vals[i][1]) === tipo) sh.deleteRow(i + 2);
  }
}

// Mantida para os scripts antigos; o app usa adicionarCategoria / removerCategoria.
function substituirCategorias_(itens) {
  if (!itens.length) throw new Error('Lista de categorias vazia: nada foi alterado');
  var sh = garantirAba_(SpreadsheetApp.getActive(), 'Categorias');
  var cab = ABAS.Categorias;
  var linhas = itens.map(function (it) { return cab.map(function (c) { return seguro_(it[c] || ''); }); });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  sh.getRange(2, 1, linhas.length, cab.length).setValues(linhas);
}

/* -------------------------------------------------- backup e token */

var PASTA_BACKUP = 'Backups Finanças', DIAS_BACKUP = 30;

// Rode uma vez no editor: cria o gatilho diário (pede permissão de acesso ao Drive) e já faz o primeiro backup.
function ativarBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupDiario').timeBased().everyDays(1).atHour(3).create();
  backupDiario();
  Logger.log('Backup diário ativado. As cópias ficam na pasta "' + PASTA_BACKUP + '" do seu Drive (últimos ' + DIAS_BACKUP + ' dias).');
}

function backupDiario() {
  var ss = SpreadsheetApp.getActive();
  var id = PropertiesService.getScriptProperties().getProperty('PASTA_BACKUP_ID');
  var pasta = null;
  if (id) { try { pasta = DriveApp.getFolderById(id); if (pasta.isTrashed()) pasta = null; } catch (err) { pasta = null; } }
  if (!pasta) {
    pasta = DriveApp.createFolder(PASTA_BACKUP);
    PropertiesService.getScriptProperties().setProperty('PASTA_BACKUP_ID', pasta.getId());
  }
  var nome = 'Backup ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') + ' — ' + ss.getName();
  DriveApp.getFileById(ss.getId()).makeCopy(nome, pasta);
  // apaga (manda para a lixeira do Drive) só as cópias antigas desta pasta
  var limite = Date.now() - DIAS_BACKUP * 24 * 3600 * 1000;
  var arqs = pasta.getFiles();
  while (arqs.hasNext()) {
    var f = arqs.next();
    if (f.getName().indexOf('Backup ') === 0 && f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }
}

// Gera um token novo: todos os aparelhos precisam colar o código novo. O antigo para de funcionar na hora.
function trocarToken() {
  PropertiesService.getScriptProperties().setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Token trocado. O código antigo não funciona mais.');
  return codigoDoApp();
}

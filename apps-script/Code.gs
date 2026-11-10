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
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (req.acao) {
        case 'salvar':   salvar_('Lancamentos', req.itens || []); break;
        case 'excluir':  excluir_('Lancamentos', req.ids || []); break;
        case 'salvarContas': salvar_('Contas', req.itens || []); break;
        case 'salvarCategorias': substituirCategorias_(req.itens || []); break;
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

/* ------------------------------------------------------------- leitura */

function lerTudo_() {
  var ss = SpreadsheetApp.getActive();
  return {
    contas: lerAba_(ss, 'Contas'),
    categorias: lerAba_(ss, 'Categorias'),
    lancamentos: lerAba_(ss, 'Lancamentos'),
    planilha: ss.getUrl(),
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
    var linha = cab.map(function (c) { return it[c] === undefined || it[c] === null ? '' : it[c]; });
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

function excluir_(nome, ids) {
  if (!ids.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!sh || sh.getLastRow() < 2) return;
  var alvo = {};
  ids.forEach(function (i) { alvo[String(i)] = true; });
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (alvo[String(col[i][0])]) sh.deleteRow(i + 2);
  }
}

function substituirCategorias_(itens) {
  var sh = garantirAba_(SpreadsheetApp.getActive(), 'Categorias');
  var cab = ABAS.Categorias;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (!itens.length) return;
  var linhas = itens.map(function (it) { return cab.map(function (c) { return it[c] || ''; }); });
  sh.getRange(2, 1, linhas.length, cab.length).setValues(linhas);
}

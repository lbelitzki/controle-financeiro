# Finanças — controle financeiro com Google Planilhas

App web instalável (PWA) para lançar despesas, entradas, pagamentos de fatura e
transferências, com dashboard e faturas por cartão. O banco de dados é uma
planilha do Google; este repositório **não contém dados pessoais**.

## Como funciona

```
iPhone / navegador  ──►  App (GitHub Pages)  ──►  Apps Script (API)  ──►  Planilha no Drive
```

- `index.html`, `styles.css`, `app.js`: o app (sem frameworks, sem build).
- `sw.js` + `manifest.webmanifest`: deixam o app instalável e abrindo sem internet.
- `apps-script/Code.gs`: backend que roda dentro da planilha.
- `privado/` (fora do git): dados iniciais, token e servidor de teste local.

## Planilha

| Aba | Conteúdo |
| --- | --- |
| `Contas` | contas bancárias e cartões (dia de fechamento/vencimento, titular, saldo inicial) |
| `Categorias` | categorias de despesa e entrada |
| `Lancamentos` | uma linha por lançamento; compras parceladas geram uma linha por parcela |

Tipos de lançamento: `despesa`, `entrada`, `pagamento` (de fatura) e `transferencia`.
Em compras no cartão, a coluna `fatura` (AAAA-MM) é o mês de vencimento da fatura.

## Instalação

1. Crie uma planilha nova no Google Drive.
2. Em **Extensões › Apps Script**, cole `apps-script/Code.gs` (e o arquivo de dados
   iniciais, se houver) e rode a função `configurar`.
3. **Implantar › Nova implantação › App da Web** — Executar como: *eu*; Acesso: *qualquer pessoa*.
4. Rode `codigoDoApp` e copie o código que aparece no registro.
5. Abra o app, cole o código e, no iPhone, use **Compartilhar › Adicionar à Tela de Início**.

## Teste local

```bash
python3 privado/servidor_teste.py
```

## Segurança e backup

- O token de acesso fica nas Propriedades do Script; `trocarToken()` gera um novo e invalida o antigo.
- `ativarBackup()` (rodar uma vez) cria uma cópia diária da planilha na pasta "Backups Finanças" do Drive (últimos 30 dias).
- Excluir um lançamento move a linha para a aba `Lixeira` em vez de apagar.
- O backend valida tipo, data e valor de tudo que recebe e grava textos sem deixar virar fórmula.

## Atualizar o backend

Depois de mudar `Code.gs`: **Implantar › Gerenciar implantações › editar › Nova versão**
(mantém a mesma URL).

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Aumenta o limite para aceitar o ficheiro .s3db completo em binário
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'pdv_cad.s3db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;

function obterConexao() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Base de dados ainda não enviada para a nuvem.');
  }
  
  if (db) return db;

  try {
    db = new Database(DB_PATH, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_prod_barras ON produtos(sCodBarras);
      CREATE INDEX IF NOT EXISTS idx_prod_interno ON produtos(sCodInterno);
    `);
  } catch (err) {
    db = null;
    throw err;
  }

  return db;
}

// Rota para receber a base de dados enviada automaticamente pelo script da matriz
app.post('/api/upload-db', (req, res) => {
  const tokenSecreto = req.headers['x-token-secreto'];
  if (tokenSecreto !== 'RizzoSegredo2026!') {
    return res.status(403).json({ success: false, error: 'Acesso negado.' });
  }

  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum ficheiro enviado.' });
  }

  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (db) {
      db.close();
      db = null;
    }

    // Grava os bytes diretamente no ficheiro SQLite na pasta de dados
    fs.writeFileSync(DB_PATH, req.body);

    res.json({ success: true, message: 'Base de dados atualizada com sucesso no Render!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota de versão segura
app.get('/api/versao', (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return res.json({ success: false, error: 'Base de dados não encontrada na nuvem.' });
    }

    const stats = fs.statSync(DB_PATH);
    let versao = null;

    try {
      const database = obterConexao();
      versao = database.prepare('SELECT * FROM VersaoBanco ORDER BY ID DESC LIMIT 1').get();
    } catch (e) {}

    res.json({ 
      success: true, 
      data: versao || { sVersao: 'Atualizado' }, 
      ultimaAtualizacao: stats.mtime 
    });
  } catch (err) {
    db = null;
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota de diagnóstico para testar tabelas e colunas
app.get('/api/debug', (req, res) => {
  try {
    const database = obterConexao();
    const tabelas = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const colunas = database.prepare("PRAGMA table_info(produtos)").all();
    const amostra = database.prepare("SELECT * FROM produtos LIMIT 3").all();
    res.json({ success: true, tabelas, colunas, amostra });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Rota de produtos
app.get('/api/produtos', (req, res) => {
  const termo = req.query.q || '';
  try {
    const database = obterConexao();
    const query = `
      SELECT sCodInterno, sCodBarras, sDescricao, rPreco_Venda1, rEstoqueAtual, bAtivo 
      FROM produtos 
      WHERE sCodBarras LIKE ? 
         OR sCodInterno LIKE ? 
         OR sDescricao LIKE ? 
      LIMIT 20
    `;
    const produtos = database.prepare(query).all(`%${termo}%`, `%${termo}%`, `%${termo}%`);
    res.json({ success: true, data: produtos });
  } catch (err) {
    db = null;
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Render rodando na porta ${PORT}`);
});
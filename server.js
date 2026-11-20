// Servidor web: entrega o site (pasta public/) e a API (/api).
const path = require('path');
const express = require('express');
const session = require('express-session');
const cfg = require('./config');
const { pool } = require('./lib');
const { api } = require('./api');

const app = express();
app.disable('x-powered-by');
if (cfg.session.trustProxy) app.set('trust proxy', 1);

if (!cfg.session.secret) {
  console.warn('⚠  SESSION_SECRET não definido no .env — usando um segredo temporário (os logins caem ao reiniciar).');
}

app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'melo.sid',
  secret: cfg.session.secret || cfg.session.fallbackSecret,
  resave: false,
  saveUninitialized: false, // só cria cookie de sessão para quem faz login
  cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.session.secure },
}));

// A API responde em /api (e também em /api.php, para quem ainda usar o script.js antigo)
app.all(['/api', '/api.php'], api);

// Site (index.html, css/, js/)
app.use(express.static(path.join(__dirname, 'public')));

// JSON inválido e erros inesperados
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(cfg.port, async () => {
  console.log(`Melo Barbearia rodando em http://localhost:${cfg.port}`);
  try {
    await pool.query('SELECT 1');
    console.log('Banco de dados conectado ✔');
  } catch (e) {
    console.error(`✖ Não foi possível conectar ao MySQL (${e.code || e.message}).`);
    console.error('  Verifique se o MySQL está ligado (XAMPP) e os dados do arquivo .env.');
  }
});

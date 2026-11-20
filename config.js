// Configurações do sistema – equivalente ao antigo config.php.
// Os dados sensíveis (banco, senha, segredo da sessão) vêm do arquivo .env.
require('dotenv').config();
const crypto = require('crypto');

const bool = (v) => String(v).toLowerCase() === 'true';

module.exports = {
  port: Number(process.env.PORT) || 3000,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'melo_barbearia',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    charset: process.env.DB_CHARSET || 'utf8mb4_unicode_ci',
  },

  tz: process.env.APP_TZ || 'America/Recife',

  // Horário de funcionamento: dia da semana (0=Dom ... 6=Sáb) => [abre, fecha] em minutos
  // 540 = 09:00 | 1140 = 19:00 | 1020 = 17:00. Dia ausente = fechado.
  horario: { 2: [540, 1140], 3: [540, 1140], 4: [540, 1140], 5: [540, 1140], 6: [540, 1020] },
  passo: 30,            // intervalo entre horários (minutos)
  antecedencia_min: 30, // não permite marcar nos próximos X minutos

  session: {
    secret: process.env.SESSION_SECRET || '',
    fallbackSecret: crypto.randomBytes(32).toString('hex'), // usado só se faltar SESSION_SECRET
    secure: bool(process.env.SESSION_SECURE),
    trustProxy: bool(process.env.TRUST_PROXY),
  },
};

// Conexão com o banco, autenticação e regras de disponibilidade – equivalente ao antigo lib.php.
const mysql = require('mysql2/promise');
const cfg = require('./config');

/* ---------- Banco de dados ---------- */
const pool = mysql.createPool({
  host: cfg.db.host,
  port: cfg.db.port,
  user: cfg.db.user,
  password: cfg.db.password,
  database: cfg.db.database,
  charset: cfg.db.charset,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE volta como "AAAA-MM-DD" (e não como objeto Date)
});

/* ---------- Erros e utilitários ---------- */
class HttpError extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}
const fail = (msg, status = 400) => { throw new HttpError(msg, status); };
const created = (data) => ({ __status: 201, data }); // resposta com status 201
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;
const toInt = (v, def = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : def; };

/* ---------- Datas (sempre no fuso configurado, ex.: America/Recife) ---------- */
// Data e hora atuais no fuso do sistema: { data: 'AAAA-MM-DD', min: minutos desde 00:00 }
function agora() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { data: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
}
const diaSemana = (s) => new Date(s + 'T00:00:00Z').getUTCDay(); // 0 = domingo
function addDias(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Valida "AAAA-MM-DD"; se inválida, responde erro 400
function dt(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('Data inválida.');
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) fail('Data inválida.');
  return s;
}

function svcRow(r) {
  return { id: Number(r.id), nome: r.nome, descricao: r.descricao,
           duracao_min: Number(r.duracao_min), preco: Number(r.preco), ativo: Number(r.ativo) };
}

/* ---------- Autenticação ---------- */
function exige(session, papel = null) {
  const u = session && session.u;
  if (!u) fail('Faça login para continuar.', 401);
  if (papel && u.papel !== papel) fail('Sem permissão.', 403);
  return u;
}
function meuBarbeiro(u) {
  if (!u.barbeiro_id) fail('Usuário sem perfil de barbeiro.', 403);
  return Number(u.barbeiro_id);
}

/* ---------- Regras de agendamento ---------- */
function idsServicos(s) {
  const a = Array.isArray(s) ? s : String(s ?? '').split(',');
  return [...new Set(a.map((x) => parseInt(x, 10)).filter((x) => x))];
}
async function servicosSel(ids) {
  if (!ids.length) fail('Escolha ao menos um serviço.');
  const [l] = await pool.execute(
    `SELECT * FROM servicos WHERE ativo = 1 AND id IN (${ids.map(() => '?').join(',')})`, ids);
  if (l.length !== ids.length) fail('Serviço inválido.');
  return l;
}
async function barbeirosCand(b) {
  if (b === 'any' || b === '' || b === null || b === undefined) {
    const [r] = await pool.execute('SELECT id FROM barbeiros WHERE ativo = 1 ORDER BY id');
    return r.map((x) => x.id);
  }
  const [r] = await pool.execute('SELECT id FROM barbeiros WHERE ativo = 1 AND id = ?', [toInt(b)]);
  if (!r.length) fail('Profissional inválido.');
  return r.map((x) => x.id);
}

// Carrega de uma vez os agendamentos ativos e os bloqueios do dia (db = pool ou conexão da transação)
async function ocupacao(db, data) {
  const [ags] = await db.execute(
    "SELECT barbeiro_id, inicio, duracao_min FROM agendamentos WHERE data = ? AND status <> 'cancelado'", [data]);
  const [bls] = await db.execute('SELECT barbeiro_id, inicio, fim FROM bloqueios WHERE data = ?', [data]);
  return { ags, bls };
}
// O barbeiro está livre no intervalo [ini, ini+dur)? (sem agendamento ativo e sem bloqueio)
function livre(occ, bid, ini, dur) {
  const fim = ini + dur;
  if (occ.ags.some((a) => a.barbeiro_id === bid && a.inicio < fim && a.inicio + a.duracao_min > ini)) return false;
  return !occ.bls.some((k) => (k.barbeiro_id === null || k.barbeiro_id === bid) && k.inicio < fim && k.fim > ini);
}
// Horários livres do dia: [{ inicio: 540, barbeiro_id: 1 }, ...]
async function slotsDia(db, data, cands, dur) {
  const j = cfg.horario[diaSemana(data)];
  const hoje = agora();
  if (!j || data < hoje.data) return [];
  const min = data === hoje.data ? hoje.min + cfg.antecedencia_min : 0;
  const occ = await ocupacao(db, data);
  const out = [];
  for (let s = j[0]; s + dur <= j[1]; s += cfg.passo) {
    if (s < min) continue;
    const b = cands.find((c) => livre(occ, c, s, dur));
    if (b !== undefined) out.push({ inicio: s, barbeiro_id: b });
  }
  return out;
}

module.exports = {
  pool, HttpError, fail, created, sleep, round2, toInt,
  agora, diaSemana, addDias, dt, svcRow, exige, meuBarbeiro,
  idsServicos, servicosSel, barbeirosCand, ocupacao, livre, slotsDia,
};

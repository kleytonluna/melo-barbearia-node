// Rotas JSON da API – equivalente ao antigo api.php (mesmas rotas: /api?r=<rota>).
const bcrypt = require('bcryptjs');
const L = require('./lib');
const { pool, HttpError, fail, created, sleep, round2, toInt, agora, diaSemana, addDias, dt,
        svcRow, exige, meuBarbeiro, idsServicos, servicosSel, barbeirosCand, ocupacao, livre, slotsDia } = L;

const regenerar = (req) => new Promise((ok, no) => req.session.regenerate((e) => (e ? no(e) : ok())));
const destruir = (req) => new Promise((ok) => req.session.destroy(() => ok()));
const soma = (lista, campo) => lista.reduce((t, x) => t + Number(x[campo]), 0);

// Cada rota recebe { req, res, q (query), body, session } e devolve os dados em JSON.
const rotas = {

  /* ===== Público (cliente) ===== */
  async servicos() {
    const [r] = await pool.execute('SELECT * FROM servicos WHERE ativo = 1 ORDER BY id');
    return r.map(svcRow);
  },

  async barbeiros() {
    const [r] = await pool.execute('SELECT id, nome, especialidade FROM barbeiros WHERE ativo = 1 ORDER BY id');
    return r;
  },

  async dias({ q }) { // dias do mês com pelo menos um horário livre
    const mes = String(q.mes ?? '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) fail('Mês inválido.');
    const dur = soma(await servicosSel(idsServicos(q.servicos ?? '')), 'duracao_min');
    const c = await barbeirosCand(q.barbeiro ?? 'any');
    const n = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
    const dias = [];
    for (let d = 1; d <= n; d++) {
      const dia = `${mes}-${String(d).padStart(2, '0')}`;
      if ((await slotsDia(pool, dia, c, dur)).length) dias.push(dia);
    }
    return { dias };
  },

  async slots({ q }) {
    const dur = soma(await servicosSel(idsServicos(q.servicos ?? '')), 'duracao_min');
    const data = dt(q.data ?? '');
    return { slots: await slotsDia(pool, data, await barbeirosCand(q.barbeiro ?? 'any'), dur) };
  },

  async agendar({ body: d }) {
    const lista = await servicosSel(idsServicos(d.servicos ?? []));
    const dur = soma(lista, 'duracao_min');
    const total = round2(soma(lista, 'preco'));
    const data = dt(d.data ?? '');
    const ini = toInt(d.inicio ?? -1, -1);
    const nome = String(d.nome ?? '').trim().replace(/\s+/g, ' ');
    const zap = String(d.whatsapp ?? '').replace(/\D/g, '');
    const tamNome = [...nome].length;
    if (tamNome < 5 || tamNome > 100 || !nome.includes(' ')) fail('Informe seu nome completo.');
    if (zap.length < 10 || zap.length > 11) fail('WhatsApp inválido. Use DDD + número.');
    const cands = await barbeirosCand(d.barbeiro ?? 'any');
    const pref = toInt(d.barbeiro_id);
    cands.sort((a, b) => (b === pref) - (a === pref)); // barbeiro escolhido no slot vem primeiro
    if (!(await slotsDia(pool, data, cands, dur)).some((s) => s.inicio === ini))
      fail('Esse horário não está mais disponível. Escolha outro.', 409);

    const conn = await pool.getConnection();
    let id, bid;
    try {
      await conn.beginTransaction();
      // Trava os barbeiros candidatos (sempre em ordem de id) para que dois clientes
      // não consigam reservar o mesmo horário ao mesmo tempo.
      await conn.execute(
        `SELECT id FROM barbeiros WHERE id IN (${cands.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, cands);
      const occ = await ocupacao(conn, data);
      bid = cands.find((b) => livre(occ, b, ini, dur));
      if (bid === undefined) fail('Esse horário acabou de ser ocupado. Escolha outro.', 409);
      const [r] = await conn.execute(
        'INSERT INTO agendamentos (barbeiro_id, data, inicio, duracao_min, cliente_nome, cliente_whatsapp, total) VALUES (?,?,?,?,?,?,?)',
        [bid, data, ini, dur, nome, zap, total]);
      id = r.insertId;
      for (const s of lista)
        await conn.execute('INSERT INTO agendamento_servicos (agendamento_id, servico_id, preco_cobrado) VALUES (?,?,?)', [id, s.id, s.preco]);
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      if (e.code === 'ER_LOCK_DEADLOCK') fail('Esse horário acabou de ser ocupado. Escolha outro.', 409);
      throw e;
    } finally {
      conn.release();
    }
    const [[bn]] = await pool.execute('SELECT nome FROM barbeiros WHERE id = ?', [bid]);
    return created({ id, data, inicio: ini, duracao_min: dur, barbeiro: bn.nome,
                     servicos: lista.map((s) => s.nome), total, cliente_nome: nome });
  },

  /* ===== Autenticação ===== */
  async me({ session }) {
    return { usuario: session.u ?? null };
  },

  async login({ req, body: d }) {
    const [rows] = await pool.execute(
      'SELECT u.*, b.id AS barbeiro_id FROM usuarios u LEFT JOIN barbeiros b ON b.usuario_id = u.id WHERE u.email = ? AND u.ativo = 1',
      [String(d.email ?? '').trim().toLowerCase()]);
    const u = rows[0];
    // bcryptjs entende os hashes "$2y$" gerados pelo password_hash() do PHP
    const ok = u && (await bcrypt.compare(String(d.senha ?? ''), u.senha_hash));
    if (!ok) { await sleep(500); fail('E-mail ou senha incorretos.', 401); }
    await regenerar(req); // novo ID de sessão no login
    req.session.u = { id: Number(u.id), nome: u.nome, papel: u.papel, barbeiro_id: u.barbeiro_id ? Number(u.barbeiro_id) : null };
    return { usuario: req.session.u };
  },

  async logout({ req, res }) {
    await destruir(req);
    res.clearCookie('melo.sid');
    return { ok: true };
  },

  /* ===== Painel (admin e barbeiro) ===== */
  async agenda({ session, q }) {
    const u = exige(session);
    const d = dt(q.data ?? '');
    let de = d, ate = d;
    if ((q.modo ?? 'dia') === 'sem') { // semana de domingo a sábado
      de = addDias(d, -diaSemana(d));
      ate = addDias(de, 6);
    }
    const b = u.papel === 'barbeiro' ? meuBarbeiro(u) : ((q.barbeiro ?? 'all') === 'all' ? null : toInt(q.barbeiro) || null);
    const sql = `SELECT a.id, a.data, a.inicio, a.duracao_min, a.barbeiro_id, b.nome AS barbeiro, a.cliente_nome, a.cliente_whatsapp, a.status, a.total,
                   (SELECT GROUP_CONCAT(s.nome SEPARATOR ' + ') FROM agendamento_servicos x JOIN servicos s ON s.id = x.servico_id WHERE x.agendamento_id = a.id) AS servicos
                 FROM agendamentos a JOIN barbeiros b ON b.id = a.barbeiro_id
                 WHERE a.data BETWEEN ? AND ?` + (b ? ' AND a.barbeiro_id = ?' : '') + ' ORDER BY a.data, a.inicio';
    const [rows] = await pool.execute(sql, b ? [de, ate, b] : [de, ate]);
    return rows.map((a) => ({ ...a, total: Number(a.total) }));
  },

  async status({ session, body: d }) {
    const u = exige(session);
    const novo = d.status ?? '';
    if (!['concluido', 'cancelado'].includes(novo)) fail('Status inválido.');
    const [rows] = await pool.execute('SELECT * FROM agendamentos WHERE id = ?', [toInt(d.id)]);
    const a = rows[0];
    if (!a) fail('Agendamento não encontrado.', 404);
    if (u.papel === 'barbeiro' && Number(a.barbeiro_id) !== meuBarbeiro(u)) fail('Sem permissão.', 403);
    if (a.status !== 'agendado') fail('Este agendamento já foi finalizado.', 409);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // "AND status = 'agendado'" evita que duas pessoas finalizem o mesmo agendamento ao mesmo tempo
      const [r] = await conn.execute("UPDATE agendamentos SET status = ? WHERE id = ? AND status = 'agendado'", [novo, a.id]);
      if (!r.affectedRows) fail('Este agendamento já foi finalizado.', 409);
      if (novo === 'cancelado') {
        await conn.execute('INSERT INTO cancelamentos (agendamento_id, usuario_id, motivo) VALUES (?,?,?)',
          [a.id, u.id, [...String(d.motivo ?? '').trim()].slice(0, 200).join('')]);
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }
    return { ok: true };
  },

  async bloqueios({ session }) {
    const u = exige(session);
    let sql = `SELECT k.id, k.data, k.inicio, k.fim, k.motivo, k.barbeiro_id, b.nome AS barbeiro FROM bloqueios k
               LEFT JOIN barbeiros b ON b.id = k.barbeiro_id WHERE k.data >= ?`;
    const p = [agora().data];
    if (u.papel === 'barbeiro') { sql += ' AND (k.barbeiro_id IS NULL OR k.barbeiro_id = ?)'; p.push(meuBarbeiro(u)); }
    const [rows] = await pool.execute(sql + ' ORDER BY k.data, k.inicio', p);
    return rows;
  },

  async bloqueio_salvar({ session, body: d }) {
    const u = exige(session);
    const data = dt(d.data ?? '');
    const ini = toInt(d.inicio ?? -1, -1);
    const fim = toInt(d.fim ?? -1, -1);
    if (ini < 0 || fim > 1440 || fim <= ini) fail('Confira os horários.');
    const bid = u.papel === 'barbeiro' ? meuBarbeiro(u) : ((d.barbeiro ?? 'all') === 'all' ? null : toInt(d.barbeiro));
    await pool.execute('INSERT INTO bloqueios (barbeiro_id, data, inicio, fim, motivo) VALUES (?,?,?,?,?)',
      [bid, data, ini, fim, [...String(d.motivo ?? '').trim()].slice(0, 120).join('')]);
    return created({ ok: true });
  },

  async bloqueio_del({ session, body: d }) {
    const u = exige(session);
    const id = toInt(d.id);
    const [rows] = await pool.execute('SELECT barbeiro_id FROM bloqueios WHERE id = ?', [id]);
    const k = rows[0];
    if (!k) fail('Bloqueio não encontrado.', 404);
    if (u.papel === 'barbeiro' && Number(k.barbeiro_id) !== meuBarbeiro(u)) fail('Sem permissão.', 403);
    await pool.execute('DELETE FROM bloqueios WHERE id = ?', [id]);
    return { ok: true };
  },

  /* ===== Somente admin ===== */
  async servicos_admin({ session }) {
    exige(session, 'admin');
    const [r] = await pool.execute('SELECT * FROM servicos WHERE ativo = 1 ORDER BY id');
    return r.map(svcRow);
  },

  async servico_salvar({ session, body: d }) {
    exige(session, 'admin');
    const nome = String(d.nome ?? '').trim();
    const dur = toInt(d.duracao_min);
    const preco = round2(Number(d.preco ?? -1));
    if (nome === '' || [...nome].length > 80) fail('Nome do serviço inválido.');
    if (dur < 30 || dur > 480 || dur % 30) fail('A duração deve ser múltipla de 30 minutos.');
    if (!Number.isFinite(preco) || preco < 0 || preco > 999999.99) fail('Preço inválido.');
    const desc = [...String(d.descricao ?? '').trim()].slice(0, 255).join('');
    if (toInt(d.id)) {
      await pool.execute('UPDATE servicos SET nome = ?, descricao = ?, duracao_min = ?, preco = ? WHERE id = ?',
        [nome, desc, dur, preco, toInt(d.id)]);
    } else {
      await pool.execute('INSERT INTO servicos (nome, descricao, duracao_min, preco) VALUES (?,?,?,?)', [nome, desc, dur, preco]);
    }
    return { ok: true };
  },

  async servico_del({ session, body: d }) { // exclusão lógica: preserva o histórico dos agendamentos
    exige(session, 'admin');
    await pool.execute('UPDATE servicos SET ativo = 0 WHERE id = ?', [toInt(d.id)]);
    return { ok: true };
  },

  async barbeiros_admin({ session }) {
    exige(session, 'admin');
    const [l] = await pool.execute('SELECT b.id, b.nome, b.especialidade, b.ativo, u.email FROM barbeiros b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id');
    return l.map((b) => ({ ...b, id: Number(b.id), ativo: Number(b.ativo) }));
  },

  async barbeiro_salvar({ session, body: d }) {
    exige(session, 'admin');
    const nome = String(d.nome ?? '').trim();
    const esp = [...String(d.especialidade ?? '').trim()].slice(0, 120).join('');
    const ativo = Number(d.ativo) ? 1 : 0;
    if (nome === '' || [...nome].length > 100) fail('Nome inválido.');
    if (toInt(d.id)) {
      const id = toInt(d.id);
      await pool.execute('UPDATE barbeiros SET nome = ?, especialidade = ?, ativo = ? WHERE id = ?', [nome, esp, ativo, id]);
      await pool.execute('UPDATE usuarios u JOIN barbeiros b ON b.usuario_id = u.id SET u.ativo = ? WHERE b.id = ?', [ativo, id]);
      return { ok: true };
    }
    const email = String(d.email ?? '').trim().toLowerCase();
    const senha = String(d.senha ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) fail('E-mail inválido.');
    if (senha.length < 8) fail('A senha deve ter ao menos 8 caracteres.');
    const hash = await bcrypt.hash(senha, 10);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.execute("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?,?,?,'barbeiro')", [nome, email, hash]);
      await conn.execute('INSERT INTO barbeiros (usuario_id, nome, especialidade, ativo) VALUES (?,?,?,?)', [r.insertId, nome, esp, ativo]);
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      if (e.code === 'ER_DUP_ENTRY') fail('Este e-mail já está cadastrado.', 409);
      throw e;
    } finally {
      conn.release();
    }
    return created({ ok: true });
  },

  async relatorio({ session, q }) {
    exige(session, 'admin');
    const hoje = agora().data;
    const de = dt(q.de ?? hoje.slice(0, 8) + '01');
    const ate = dt(q.ate ?? hoje);
    const [pb] = await pool.execute(
      `SELECT b.nome, COUNT(*) AS qtd, COALESCE(SUM(a.total), 0) AS total FROM agendamentos a
       JOIN barbeiros b ON b.id = a.barbeiro_id WHERE a.status = 'concluido' AND a.data BETWEEN ? AND ?
       GROUP BY b.id, b.nome ORDER BY total DESC`, [de, ate]);
    const porBarbeiro = pb.map((x) => ({ nome: x.nome, qtd: Number(x.qtd), total: Number(x.total) }));
    const [c] = await pool.execute('SELECT status, COUNT(*) AS n FROM agendamentos WHERE data BETWEEN ? AND ? GROUP BY status', [de, ate]);
    const cont = Object.fromEntries(c.map((x) => [x.status, Number(x.n)]));
    return { de, ate, qtd: soma(porBarbeiro, 'qtd'), total: round2(soma(porBarbeiro, 'total')),
             agendados: cont.agendado || 0, cancelados: cont.cancelado || 0, por_barbeiro: porBarbeiro };
  },
};

// Despachante: valida CSRF básico, escolhe a rota (?r=...) e converte erros em JSON.
async function api(req, res) {
  try {
    // Proteção básica contra CSRF: toda escrita precisa vir do nosso JavaScript
    if (req.method === 'POST' && req.get('X-Requested-With') !== 'fetch') fail('Requisição inválida.', 403);
    const r = String(req.query.r ?? '');
    if (!Object.prototype.hasOwnProperty.call(rotas, r)) fail('Rota não encontrada.', 404);
    const out = await rotas[r]({ req, res, q: req.query, body: req.body && typeof req.body === 'object' ? req.body : {}, session: req.session });
    if (res.headersSent) return;
    if (out && out.__status) res.status(out.__status).json(out.data);
    else res.json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ erro: e.message });
    console.error(e);
    if (e.errno === 1452) return res.status(400).json({ erro: 'Registro relacionado não encontrado.' });
    const erroBanco = e.sqlState || e.code === 'ECONNREFUSED' || String(e.code || '').startsWith('ER_');
    res.status(500).json({ erro: erroBanco
      ? 'Erro no banco de dados. Verifique o arquivo .env e se o schema foi importado.'
      : 'Erro interno do servidor.' });
  }
}

module.exports = { api };

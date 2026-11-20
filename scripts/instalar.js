// Cria os logins iniciais (substitui o antigo instalar.php).
// Rode UMA vez, depois de importar o schema.sql:   npm run instalar
// As senhas são geradas aleatoriamente e exibidas somente agora. Anote-as.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../lib');

const LOGINS = [
  { nome: 'Administrador', email: 'admin@melo.com', papel: 'admin', barbeiro: null },
  { nome: 'Lucas Melo', email: 'lucas@melo.com', papel: 'barbeiro', barbeiro: 'Lucas Melo' },
  { nome: 'Wesley', email: 'wesley@melo.com', papel: 'barbeiro', barbeiro: 'Wesley' },
];

(async () => {
  const criados = [];
  const existentes = [];
  try {
    for (const l of LOGINS) {
      const [r] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', [l.email]);
      let id;
      if (r.length) {
        id = r[0].id;
        existentes.push(l.email);
      } else {
        const senha = crypto.randomBytes(9).toString('base64url'); // 12 caracteres
        const [ins] = await pool.execute(
          'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?,?,?,?)',
          [l.nome, l.email, await bcrypt.hash(senha, 10), l.papel]);
        id = ins.insertId;
        criados.push({ email: l.email, senha });
      }
      // Liga o login ao barbeiro correspondente (se ainda não estiver ligado)
      if (l.barbeiro) {
        await pool.execute('UPDATE barbeiros SET usuario_id = ? WHERE nome = ? AND usuario_id IS NULL', [id, l.barbeiro]);
      }
    }

    if (criados.length) {
      console.log('\nLogins criados (anote as senhas, elas não serão mostradas de novo):\n');
      for (const c of criados) console.log(`  ${c.email.padEnd(20)} senha: ${c.senha}`);
    }
    if (existentes.length) console.log(`\nJá existiam (não alterados): ${existentes.join(', ')}`);
    console.log('\nPronto! Inicie o sistema com: npm start\n');
  } catch (e) {
    console.error('\nErro ao criar os logins:', e.code || e.message);
    console.error('Confira o arquivo .env e se o schema.sql foi importado.\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

/* =====================================================================
   SISTEMA DE AGENDAMENTO - MELO BARBEARIA (front-end)
   Este arquivo controla 3 "telas" dentro de uma única página:
     1) HOME   -> mostra serviços e equipe
     2) BOOK   -> fluxo de agendamento em 5 passos
     3) ADMIN  -> painel do barbeiro/administrador
   Toda comunicação com o servidor é feita pela função api(), que
   chama a API do servidor (rota /api).
   ===================================================================== */

/* ===== FUNÇÕES AUXILIARES (utilitários pequenos e reutilizáveis) ===== */

// $  -> atalho para document.querySelector (ex.: $("#book") pega o elemento com id="book")
// p2 -> garante 2 dígitos: p2(5) devolve "05" (usado em datas e horas)
// esc -> "escapa" caracteres especiais de HTML (&, <, >, ", ') para evitar
//        injeção de código (XSS) quando exibimos texto vindo do usuário/banco
const $ = (s) => document.querySelector(s),
  p2 = (n) => String(n).padStart(2, "0"),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

// key   -> converte um objeto Date em texto "AAAA-MM-DD" (formato usado pelo servidor)
// parse -> faz o contrário: de "AAAA-MM-DD" para Date (T00:00:00 evita erro de fuso horário)
// tm    -> converte minutos do dia em "HH:MM" (ex.: 570 -> "09:30")
const key = (d) =>
    d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()),
  parse = (k) => new Date(k + "T00:00:00"),
  tm = (m) => p2(Math.floor(m / 60)) + ":" + p2(m % 60);

// brl -> formata número como moeda brasileira (ex.: 35 -> "R$ 35", 35.5 -> "R$ 35,50")
// Se o número for inteiro, não mostra casas decimais
const brl = (n) =>
  "R$ " +
  Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(+n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

// fz -> formata telefone: remove tudo que não é número e aplica a máscara
//       11 dígitos -> (81) 98888-0000 | 10 dígitos -> (81) 8888-0000
//       se não encaixar em nenhum, devolve o texto original
const fz = (s) => {
  const v = String(s).replace(/\D/g, "");
  return v.length === 11
    ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`
    : v.length === 10
      ? `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`
      : s;
};

// addD -> soma n dias a uma data (sem alterar a data original, pois cria uma cópia)
const addD = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// Listas de nomes para exibir dia da semana e mês (índice = valor do getDay()/getMonth())
const DIAS = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ],
  MES = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

// Constantes do negócio: número do WhatsApp (com DDI 55) e endereço da barbearia
const WPP = "55819988232003",
  LOCAL = "Av. Manoel Quirino, 25, Paulista-PE";

/* ===== VARIÁVEIS GLOBAIS (estado da aplicação) =====
   S       -> lista de serviços (vinda do servidor)
   BARBERS -> lista de barbeiros
   ME      -> usuário logado no painel (null = ninguém logado)
   B       -> estado do agendamento em andamento (passo, escolhas, etc.)
   M       -> mês exibido no calendário do passo 3 */
let S = [],
  BARBERS = [],
  ME = null,
  B,
  M;

/* ===== API (Node.js) ===== */

// Função central para falar com o servidor.
// r -> nome da rota (ex.: "servicos")   o -> opções: q (parâmetros na URL) e body (dados enviados)
// Se existir body, usa POST (envia dados); senão usa GET (busca dados).
async function api(r, o = {}) {
  // Monta os parâmetros extras da URL (?r=rota&chave=valor...)
  const q = o.q ? "&" + new URLSearchParams(o.q) : "";
  const res = await fetch("api?r=" + r + q, {
    method: o.body ? "POST" : "GET",
    credentials: "same-origin", // envia o cookie de sessão (login)
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  // Tenta ler a resposta como JSON; se falhar, j continua null
  let j = null;
  try {
    j = await res.json();
  } catch (e) {}
  // Se o servidor respondeu com erro (status fora de 200-299), lança uma exceção
  // com a mensagem do servidor (j.erro) e guarda o status (ex.: 401, 409)
  if (!res.ok)
    throw Object.assign(
      new Error((j && j.erro) || "Erro inesperado. Tente novamente."),
      { status: res.status },
    );
  return j;
}

// mapS -> traduz os nomes dos campos do banco (nome, descricao...) para nomes curtos
//         usados no front-end (n, d, dur, p). Economiza código nos templates.
const mapS = (x) => ({
  id: x.id,
  n: x.nome,
  d: x.descricao,
  dur: x.duracao_min,
  p: x.preco,
});

// sv -> busca um serviço pelo id. Se não achar (serviço excluído),
//       devolve um objeto padrão para o sistema não quebrar.
const sv = (id) =>
  S.find((s) => s.id == id) || { n: "(removido)", dur: 30, p: 0 };

/* ===== HOME ===== */

// Desenha na tela os cards de serviços e de barbeiros.
// .map() transforma cada item em um bloco de HTML; .join("") junta tudo em um texto só.
function renderHome() {
  $("#svcGrid").innerHTML = S.map(
    (s) =>
      `<div class="card"><h3 style="font-size:1.6rem">${esc(s.n)}</h3><p class="mut">${esc(s.d)}</p><div class="row" style="justify-content:space-between"><span class="price">${brl(s.p)}</span><span class="mut" style="text-align:right">${s.dur} min</span></div></div>`,
  ).join("");
  $("#teamGrid").innerHTML = BARBERS.map(
    (b) =>
      `<div class="card"><div class="av">${esc(b.i)}</div><h3 style="font-size:1.6rem">${esc(b.n)}</h3><p class="mut">${esc(b.sp)}</p></div>`,
  ).join("");
}

// Carrega serviços e barbeiros do servidor ao mesmo tempo (Promise.all = em paralelo,
// mais rápido que esperar um e depois o outro) e depois desenha a home.
async function loadPublic() {
  const [s, b] = await Promise.all([api("servicos"), api("barbeiros")]);
  S = s.map(mapS);
  BARBERS = b.map((x) => ({
    id: x.id,
    n: x.nome,
    sp: x.especialidade,
    i: x.nome[0], // inicial do nome, usada como "avatar"
  }));
  renderHome();
}

// Navega para uma seção da home (ex.: nav("servicos")) ou volta ao topo (nav("top")).
// O setTimeout dá um tempinho para a tela "home" aparecer antes de rolar a página.
function nav(id) {
  location.hash = "";
  show("home");
  setTimeout(
    () =>
      id === "top"
        ? scrollTo(0, 0)
        : document.getElementById(id).scrollIntoView(),
    30,
  );
}

/* ===== AGENDAMENTO ===== */

// Reinicia o estado do agendamento (chamada sempre que o cliente começa um novo).
// Campos de B:
//   step -> passo atual (1 a 5)      svc -> ids dos serviços escolhidos
//   barber -> id do barbeiro ou "any" (sem preferência)
//   date/time -> data escolhida e horário (em minutos)
//   asg -> barbeiro realmente atribuído ao horário escolhido
//   name/phone -> dados do cliente   err -> mensagem de erro
//   done -> resposta do servidor após confirmar
//   days/slots -> dias disponíveis e horários livres (null = ainda carregando)
//   busy -> true enquanto envia o agendamento (evita clique duplo)
const resetB = () => {
  B = {
    step: 1,
    svc: [],
    barber: null,
    date: null,
    time: null,
    asg: null,
    name: "",
    phone: "",
    err: "",
    done: null,
    days: null,
    slots: null,
    busy: false,
  };
  const t = new Date();
  M = new Date(t.getFullYear(), t.getMonth(), 1); // calendário começa no mês atual
};

// tot -> soma duração e preço de todos os serviços escolhidos (reduce acumula o total)
const tot = () => ({
  dur: B.svc.reduce((a, i) => a + sv(i).dur, 0),
  p: B.svc.reduce((a, i) => a + sv(i).p, 0),
});

// qs -> parâmetros que se repetem nas consultas de dias e horários
const qs = () => ({ barbeiro: B.barber, servicos: B.svc.join(",") });

// Busca no servidor os dias do mês (M) que têm horário livre.
// Primeiro limpa (null) e redesenha para mostrar "Carregando…".
async function loadDays() {
  B.days = null;
  rBook();
  try {
    B.days = (
      await api("dias", {
        q: { ...qs(), mes: M.getFullYear() + "-" + p2(M.getMonth() + 1) },
      })
    ).dias;
  } catch (e) {
    B.days = []; // em caso de erro, nenhum dia fica disponível
    B.err = e.message;
  }
  rBook();
}

// Busca os horários livres do dia escolhido (B.date).
// s = início (minutos), b = id do barbeiro que atende naquele horário.
async function loadSlots() {
  B.slots = null;
  rBook();
  try {
    B.slots = (await api("slots", { q: { ...qs(), data: B.date } })).slots.map(
      (x) => ({ s: x.inicio, b: x.barbeiro_id }),
    );
  } catch (e) {
    B.slots = [];
  }
  rBook();
}

// rBook -> "render Book": redesenha a tela de agendamento conforme o passo atual (B.step).
// Monta uma string HTML (h) e, no final, coloca dentro do elemento #book.
function rBook() {
  const t = tot(),
    st = B.step,
    T = [
      "Serviços",
      "Profissional",
      "Data e hora",
      "Seus dados",
      "Confirmação",
    ];

  // Cabeçalho comum a todos os passos: botão voltar, título e barra de progresso
  // (cada <i> com classe "on" representa um passo já alcançado)
  let h = `<a class="mut" href="#">← Início</a><h2 style="margin-top:8px">AGENDAR HORÁRIO</h2><div class="steps">${T.map((_, i) => `<i class="${i < st ? "on" : ""}"></i>`).join("")}</div><p class="mut">Passo ${st} de 5 · ${T[st - 1]}</p>`;

  // PASSO 1: escolher serviços (pode marcar vários; clicar de novo desmarca -> tgS)
  if (st === 1)
    h += S.map(
      (s) =>
        `<div class="card opt ${B.svc.includes(s.id) ? "sel" : ""}" onclick="tgS(${s.id})"><div><b>${esc(s.n)}</b><div class="mut">${esc(s.d)} · ${s.dur} min</div></div><span class="price">${brl(s.p)}</span></div>`,
    ).join("");

  // PASSO 2: escolher o barbeiro. Inclui a opção extra "Sem preferência" (id "any").
  // Ao trocar de barbeiro, zera data e horário, pois a disponibilidade muda.
  if (st === 2)
    h += [
      { id: "any", n: "Sem preferência", sp: "Primeiro horário livre", i: "★" },
      ...BARBERS,
    ]
      .map(
        (b) =>
          `<div class="card opt ${B.barber === String(b.id) ? "sel" : ""}" onclick="B.barber='${b.id}';B.date=B.time=null;rBook()"><div class="row" style="flex-wrap:nowrap"><div class="av" style="width:48px;height:48px;font-size:1.2rem;margin:0;flex:none">${esc(b.i)}</div><div><b>${esc(b.n)}</b><div class="mut">${esc(b.sp)}</div></div></div></div>`,
      )
      .join("");

  // PASSO 3: calendário + horários livres
  if (st === 3) {
    // f = dia da semana em que o mês começa (0 = domingo) -> quantos espaços vazios antes do dia 1
    // n = quantidade de dias do mês (dia 0 do mês seguinte = último dia do mês atual)
    const f = new Date(M.getFullYear(), M.getMonth(), 1).getDay(),
      n = new Date(M.getFullYear(), M.getMonth() + 1, 0).getDate();
    // Cabeçalho do calendário: botões ‹ › para mudar de mês + letras dos dias da semana
    h += `<div class="row" style="justify-content:space-between;margin:10px 0"><button class="btn ghost sm" style="flex:none" onclick="M=new Date(M.getFullYear(),M.getMonth()-1,1);loadDays()">‹</button><b>${MES[M.getMonth()]} ${M.getFullYear()}</b><button class="btn ghost sm" style="flex:none" onclick="M=new Date(M.getFullYear(),M.getMonth()+1,1);loadDays()">›</button></div><div class="cal">${"DSTQQSS"
      .split("")
      .map((x) => `<b>${x}</b>`)
      .join("")}${"<span></span>".repeat(f)}`;
    // Um botão para cada dia do mês; fica desabilitado (off) se o dia não está na lista de dias livres
    for (let d = 1; d <= n; d++) {
      const k = M.getFullYear() + "-" + p2(M.getMonth() + 1) + "-" + p2(d),
        off = !(B.days || []).includes(k);
      h += `<button class="${B.date === k ? "sel" : ""}" ${off ? "disabled" : ""} onclick="B.date='${k}';B.time=null;loadSlots()">${d}</button>`;
    }
    h += "</div>";
    if (B.days === null) h += '<p class="mut">Carregando…</p>';
    // Se já escolheu um dia, mostra os horários livres dele
    if (B.date)
      h +=
        `<h3 style="margin-top:20px;font-size:1.4rem">HORÁRIOS LIVRES – ${parse(B.date).toLocaleDateString("pt-BR")}</h3>` +
        (B.slots === null
          ? '<p class="mut">Carregando…</p>'
          : B.slots.length
            ? `<div class="slots">${B.slots.map((x) => `<button class="${B.time === x.s ? "sel" : ""}" onclick="B.time=${x.s};B.asg=${x.b};rBook()">${tm(x.s)}</button>`).join("")}</div>`
            : '<p class="mut">Sem horários livres neste dia.</p>');
  }

  // PASSO 4: formulário com nome e WhatsApp (value mantém o que já foi digitado)
  if (st === 4)
    h += `<div class="card"><label>Nome completo</label><input id="nm" value="${esc(B.name)}" placeholder="Ex.: Carlos Eduardo Silva" autocomplete="name" maxlength="100"><label>WhatsApp</label><input id="ph" value="${esc(B.phone)}" placeholder="(81) 98888-0000" inputmode="tel" oninput="mask(this)"><div class="err">${esc(B.err)}</div></div>`;

  // PASSO 5: tela de confirmação (a = resposta do servidor com os dados do agendamento)
  if (st === 5) {
    const a = B.done,
      d = parse(a.data),
      // f -> formata data+hora no padrão do Google Agenda: AAAAMMDDTHHMMSS
      f = (m) =>
        a.data.replace(/-/g, "") +
        "T" +
        p2(Math.floor(m / 60)) +
        p2(m % 60) +
        "00",
      nomes = a.servicos.join(" + "),
      // Mensagem pronta para enviar no WhatsApp como comprovante
      msg = `Olá! Agendei na Melo Barbearia:\n${nomes}\n${DIAS[d.getDay()]}, ${d.toLocaleDateString("pt-BR")} às ${tm(a.inicio)}\nProfissional: ${a.barbeiro}\nCliente: ${a.cliente_nome}`;
    // encodeURIComponent -> converte o texto para ser aceito dentro de uma URL
    h += `<div class="card" style="text-align:center"><div style="font-size:2.4rem">✅</div><h3 style="font-size:2rem;color:var(--gold)">AGENDAMENTO CONFIRMADO</h3><p class="mut">${esc(nomes)}<br>${DIAS[d.getDay()]}, ${d.toLocaleDateString("pt-BR")} às <b style="color:var(--tx)">${tm(a.inicio)}</b> (${a.duracao_min} min)<br>Com ${esc(a.barbeiro)} · ${brl(a.total)}<br>Cliente: ${esc(a.cliente_nome)}</p>
<div class="row"><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${WPP}?text=${encodeURIComponent(msg)}">Enviar comprovante no WhatsApp</a><a class="btn ghost" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Melo Barbearia – " + nomes)}&dates=${f(a.inicio)}/${f(a.inicio + a.duracao_min)}&location=${encodeURIComponent(LOCAL)}">Adicionar à agenda</a></div><p><a class="mut" href="#">Voltar ao início</a></p></div>`;
  }

  // Barra inferior (passos 1 a 4): mostra total, botão Voltar e Continuar/Confirmar.
  // O botão fica desabilitado se o passo ainda não foi preenchido (ok()) ou se está enviando (busy).
  if (st < 5)
    h += `<div class="bar"><div><div class="price">${brl(t.p)}</div><div class="mut">${t.dur} min${B.date && B.time != null ? " · " + parse(B.date).toLocaleDateString("pt-BR") + " " + tm(B.time) : ""}</div></div><div class="row" style="flex:none">${st > 1 ? '<button class="btn ghost" onclick="bk(-1)">Voltar</button>' : ""}<button class="btn" onclick="bk(1)" ${ok() && !B.busy ? "" : "disabled"}>${st === 4 ? "Confirmar" : "Continuar"}</button></div></div>`;

  $("#book").innerHTML = h;
}

// ok -> valida se o passo atual está preenchido, para liberar o botão "Continuar".
// O array é indexado pelo número do passo (posição 0 não é usada):
//   passo 1: pelo menos 1 serviço | passo 2: barbeiro escolhido
//   passo 3: horário escolhido    | passo 4: sempre true (validado em bk())
const ok = () =>
  [0, B.svc.length > 0, !!B.barber, B.time != null, true][B.step];

// tgS -> "toggle service": marca ou desmarca um serviço.
// Se já está na lista, remove (filter); se não está, adiciona (spread [...]).
// Ao mudar serviços, a duração muda, então data/hora escolhidas são descartadas.
const tgS = (id) => {
  B.svc = B.svc.includes(id) ? B.svc.filter((x) => x !== id) : [...B.svc, id];
  B.date = B.time = null;
  rBook();
};

// mask -> máscara do campo de telefone enquanto o usuário digita:
// aceita só números (máx. 11) e vai formatando como (81) 98888-0000
function mask(el) {
  let v = el.value.replace(/\D/g, "").slice(0, 11);
  el.value =
    v.length > 6
      ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`
      : v.length > 2
        ? `(${v.slice(0, 2)}) ${v.slice(2)}`
        : v;
}

// bk -> "book step": avança (n = 1) ou volta (n = -1) um passo.
// No passo 4, ao avançar, valida os dados e envia o agendamento ao servidor.
async function bk(n) {
  if (B.busy) return; // já está enviando: ignora cliques extras
  if (B.step === 4 && n > 0) {
    // Lê o que foi digitado nos campos
    B.name = $("#nm").value.trim();
    B.phone = $("#ph").value.trim();
    // Validação: precisa de nome e sobrenome (2+ palavras) e telefone com DDD (10+ dígitos)
    if (
      B.name.split(" ").filter(Boolean).length < 2 ||
      B.phone.replace(/\D/g, "").length < 10
    ) {
      B.err = "Informe nome completo e WhatsApp com DDD.";
      return rBook();
    }
    B.busy = true; // trava o botão durante o envio
    rBook();
    try {
      B.done = await api("agendar", {
        body: {
          servicos: B.svc,
          barbeiro: B.barber,
          barbeiro_id: B.asg,
          data: B.date,
          inicio: B.time,
          nome: B.name,
          whatsapp: B.phone,
        },
      });
    } catch (e) {
      B.busy = false;
      // Status 409 = conflito: alguém reservou esse horário antes.
      // Volta ao passo 3 e recarrega os horários para o cliente escolher outro.
      if (e.status === 409) {
        B.step = 3;
        B.time = null;
        B.err = "";
        loadSlots();
        loadDays();
        return alert(e.message);
      }
      B.err = e.message;
      return rBook();
    }
    B.busy = false;
  }
  B.err = "";
  B.step += n; // muda de passo
  rBook();
  scrollTo(0, 0);
  // Ao entrar no passo 3 (indo para frente), busca os dias disponíveis
  if (B.step === 3 && n > 0) loadDays();
}

/* ===== PAINEL (área do barbeiro / administrador) ===== */

// Estado do painel (A):
//   tab -> aba atual         date -> data selecionada
//   barber -> filtro de barbeiro ("all" = todos)   mode -> "dia" ou "sem" (semana)
//   err -> mensagem de erro
//   list/bl/svc/bar/rel -> dados carregados de cada aba
//   de/ate -> período do relatório (começa no dia 1 do mês até hoje)
let A = {
  tab: "agenda",
  date: key(new Date()),
  barber: "all",
  mode: "dia",
  err: "",
  list: [],
  bl: [],
  svc: [],
  bar: [],
  rel: null,
  de: key(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  ate: key(new Date()),
};

// Carrega do servidor os dados da aba atual e depois redesenha o painel.
// Se o servidor responder 401 (não autorizado), a sessão expirou -> ME = null (volta ao login).
async function loadTab() {
  A.err = "";
  try {
    if (A.tab === "agenda")
      A.list = await api("agenda", {
        q: { data: A.date, modo: A.mode, barbeiro: A.barber },
      });
    if (A.tab === "bloq") A.bl = await api("bloqueios");
    if (A.tab === "svc") A.svc = await api("servicos_admin");
    if (A.tab === "bar") A.bar = await api("barbeiros_admin");
    if (A.tab === "rel")
      A.rel = await api("relatorio", { q: { de: A.de, ate: A.ate } });
  } catch (e) {
    if (e.status === 401) ME = null;
    else A.err = e.message;
  }
  paint();
}

// act -> executa uma ação no servidor (salvar, excluir, mudar status...) e recarrega a aba.
// r = rota, body = dados, pub = se true, também recarrega os dados públicos
// (necessário quando serviços/barbeiros mudam, para a home refletir a alteração).
async function act(r, body, pub) {
  try {
    await api(r, { body });
    if (pub) await loadPublic();
  } catch (e) {
    alert(e.message);
  }
  await loadTab();
}

// paint -> desenha o painel inteiro: tela de login (se ME é null) ou a aba atual.
function paint() {
  const el = $("#admin");

  // Sem usuário logado: mostra o formulário de login
  if (!ME) {
    el.innerHTML = `<div class="card" style="max-width:380px;margin:40px auto"><h2>ÁREA DO BARBEIRO</h2><label>E-mail</label><input id="em" type="email" autocomplete="username"><label>Senha</label><input id="pw" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')login()"><div class="err">${esc(A.err)}</div><button class="btn" onclick="login()">Entrar</button><p><a class="mut" href="#">← Voltar ao site</a></p></div>`;
    return;
  }

  // adm = true se o usuário é administrador.
  // Barbeiro comum vê só Agenda e Bloqueios; admin vê também Serviços, Barbeiros e Relatório.
  const adm = ME.papel === "admin",
    tabs = [
      ["agenda", "Agenda"],
      ["bloq", "Bloqueios / Folgas"],
      ...(adm
        ? [
            ["svc", "Serviços"],
            ["bar", "Barbeiros"],
            ["rel", "Relatório"],
          ]
        : []),
    ];

  // Cabeçalho do painel: título, nome do usuário, botões Site/Sair e as abas
  let h = `<div class="row" style="justify-content:space-between"><h2>PAINEL</h2><div class="row" style="flex:none"><span class="mut">${esc(ME.nome)}</span><a class="btn ghost sm" href="#">Site</a><button class="btn ghost sm" onclick="logout()">Sair</button></div></div><div class="tabs">${tabs.map(([k, l]) => `<button class="btn ${A.tab === k ? "" : "ghost"} sm" onclick="A.tab='${k}';loadTab()">${l}</button>`).join("")}</div>${A.err ? `<div class="err">${esc(A.err)}</div>` : ""}`;

  // ---- ABA AGENDA ----
  if (A.tab === "agenda") {
    // Filtros: data, barbeiro (só admin) e visão (dia/semana)
    h += `<div class="row"><div><label>Data</label><input type="date" value="${A.date}" onchange="A.date=this.value||A.date;loadTab()"></div>${adm ? `<div><label>Barbeiro</label><select onchange="A.barber=this.value;loadTab()"><option value="all">Todos</option>${BARBERS.map((b) => `<option value="${b.id}" ${A.barber == b.id ? "selected" : ""}>${esc(b.n)}</option>`).join("")}</select></div>` : ""}<div><label>Visão</label><select onchange="A.mode=this.value;loadTab()"><option value="dia">Dia</option><option value="sem" ${A.mode === "sem" ? "selected" : ""}>Semana</option></select></div></div>`;

    // Lista de dias a exibir: só o dia escolhido, ou a semana inteira (domingo a sábado)
    let days = [A.date];
    if (A.mode === "sem") {
      const d = parse(A.date);
      // i - d.getDay() recua até o domingo e vai até o sábado
      days = [...Array(7)].map((_, i) => key(addD(d, i - d.getDay())));
    }
    // Para cada dia, mostra os agendamentos daquela data
    days.forEach((dk) => {
      const l = A.list.filter((a) => a.data === dk),
        d = parse(dk);
      h +=
        `<h3 style="margin:18px 0 8px;font-size:1.4rem">${DIAS[d.getDay()].toUpperCase()} ${d.toLocaleDateString("pt-BR")}</h3>` +
        (l.length
          ? l
              .map(
                // Só agendamentos com status "agendado" mostram os botões Concluído/Cancelar
                (a) =>
                  `<div class="card ap ${a.status}"><div><b>${tm(a.inicio)}–${tm(a.inicio + a.duracao_min)}</b> ${esc(a.cliente_nome)} <span class="tag ${a.status}">${a.status}</span><div class="mut">${esc(a.servicos)} · ${esc(a.barbeiro)} · ${esc(fz(a.cliente_whatsapp))} · ${brl(a.total)}</div></div>${a.status === "agendado" ? `<div class="row" style="flex:none"><button class="btn sm" onclick="st(${a.id},'concluido')">Concluído</button><button class="btn bad sm" onclick="st(${a.id},'cancelado')">Cancelar</button></div>` : ""}</div>`,
              )
              .join("")
          : '<p class="mut">Sem agendamentos.</p>');
    });
  }

  // ---- ABA BLOQUEIOS (folgas, almoço, consultas...) ----
  if (A.tab === "bloq") {
    // Formulário para criar bloqueio + lista dos bloqueios ativos
    h +=
      `<div class="card"><div class="row"><div><label>Data</label><input type="date" id="bd" value="${A.date}"></div>${adm ? `<div><label>Barbeiro</label><select id="bb"><option value="all">Todos (folga geral)</option>${BARBERS.map((b) => `<option value="${b.id}">${esc(b.n)}</option>`).join("")}</select></div>` : ""}<div><label>Das</label><input type="time" id="b1" value="09:00"></div><div><label>Até</label><input type="time" id="b2" value="19:00"></div></div><label>Motivo</label><input id="bn" maxlength="120" placeholder="Folga, consulta, almoço…"><button class="btn" onclick="addB()">Bloquear</button></div><h3 style="margin:18px 0 8px;font-size:1.4rem">BLOQUEIOS ATIVOS</h3>` +
      (A.bl.length
        ? A.bl
            .map(
              // Bloqueio geral (sem barbeiro_id) só o admin pode remover
              (k) =>
                `<div class="card ap"><div><b>${parse(k.data).toLocaleDateString("pt-BR")}</b> ${tm(k.inicio)}–${tm(k.fim)} · ${k.barbeiro_id ? esc(k.barbeiro) : "Todos"}<div class="mut">${esc(k.motivo || "—")}</div></div>${adm || k.barbeiro_id ? `<button class="btn bad sm" onclick="act('bloqueio_del',{id:${k.id}})">Remover</button>` : ""}</div>`,
            )
            .join("")
        : '<p class="mut">Nenhum bloqueio.</p>');
  }

  // ---- ABA SERVIÇOS (somente admin) ----
  // Cada campo salva automaticamente ao mudar (onchange -> eS)
  if (A.tab === "svc") {
    h +=
      A.svc
        .map(
          (s) =>
            `<div class="card ap"><div class="row" style="flex:1"><div style="flex:2"><label>Serviço</label><input value="${esc(s.nome)}" maxlength="80" onchange="eS(${s.id},'nome',this.value)"></div><div style="flex:2"><label>Descrição</label><input value="${esc(s.descricao)}" maxlength="255" onchange="eS(${s.id},'descricao',this.value)"></div><div><label>Preço (R$)</label><input type="number" min="0" step="0.5" value="${s.preco}" onchange="eS(${s.id},'preco',+this.value)"></div><div><label>Duração (min)</label><input type="number" step="30" min="30" value="${s.duracao_min}" onchange="eS(${s.id},'duracao_min',+this.value)"></div></div><button class="btn bad sm" onclick="if(confirm('Excluir este serviço?'))act('servico_del',{id:${s.id}},1)">Excluir</button></div>`,
        )
        .join("") +
      // Botão que cria um serviço com valores padrão para o admin editar depois
      `<button class="btn" onclick="act('servico_salvar',{nome:'Novo serviço',descricao:'Descrição curta.',duracao_min:30,preco:30},1)">+ Novo serviço</button>`;
  }

  // ---- ABA BARBEIROS (somente admin) ----
  if (A.tab === "bar") {
    h +=
      A.bar
        .map(
          (b) =>
            `<div class="card ap"><div class="row" style="flex:1"><div><label>Nome</label><input value="${esc(b.nome)}" maxlength="100" onchange="eB(${b.id},'nome',this.value)"></div><div><label>Especialidade</label><input value="${esc(b.especialidade)}" maxlength="120" onchange="eB(${b.id},'especialidade',this.value)"></div><div><label>Acesso</label><input value="${esc(b.email || "—")}" disabled></div><div><label>Status</label><select onchange="eB(${b.id},'ativo',+this.value)"><option value="1">Ativo</option><option value="0" ${b.ativo ? "" : "selected"}>Inativo</option></select></div></div></div>`,
        )
        .join("") +
      // Formulário para cadastrar um novo barbeiro (já cria o login dele)
      `<div class="card"><h3 style="font-size:1.4rem">NOVO BARBEIRO</h3><div class="row"><div><label>Nome</label><input id="nb1" maxlength="100"></div><div><label>Especialidade</label><input id="nb2" maxlength="120"></div><div><label>E-mail (login)</label><input id="nb3" type="email"></div><div><label>Senha (mín. 8)</label><input id="nb4" type="password"></div></div><button class="btn" onclick="addBar()">Cadastrar</button></div>`;
  }

  // ---- ABA RELATÓRIO (somente admin) ----
  if (A.tab === "rel") {
    const r = A.rel; // dados do relatório (null enquanto não carregou)
    h +=
      `<div class="row"><div><label>De</label><input type="date" value="${A.de}" onchange="A.de=this.value;loadTab()"></div><div><label>Até</label><input type="date" value="${A.ate}" onchange="A.ate=this.value;loadTab()"></div></div>` +
      (r
        ? `<div class="grid"><div class="card"><div class="mut">Faturamento (concluídos)</div><div class="price">${brl(r.total)}</div></div><div class="card"><div class="mut">Atendimentos concluídos</div><div class="price">${r.qtd}</div></div><div class="card"><div class="mut">Ainda agendados</div><div class="price">${r.agendados}</div></div><div class="card"><div class="mut">Cancelados</div><div class="price">${r.cancelados}</div></div></div><h3 style="margin:18px 0 8px;font-size:1.4rem">POR BARBEIRO</h3>` +
          (r.por_barbeiro.length
            ? r.por_barbeiro
                .map(
                  (x) =>
                    `<div class="card ap"><b>${esc(x.nome)}</b><span>${x.qtd} atendimentos · <b style="color:var(--gold)">${brl(x.total)}</b></span></div>`,
                )
                .join("")
            : '<p class="mut">Sem atendimentos concluídos no período.</p>')
        : "");
  }

  el.innerHTML = h; // coloca todo o HTML montado na tela
}

// Faz login: envia e-mail e senha; se der certo, guarda o usuário em ME e carrega a aba.
async function login() {
  try {
    ME = (
      await api("login", {
        body: { email: $("#em").value, senha: $("#pw").value },
      })
    ).usuario;
    A.err = "";
    await loadTab();
  } catch (e) {
    A.err = e.message;
    paint();
  }
}

// Faz logout: avisa o servidor (ignora erro) e limpa o usuário local.
async function logout() {
  try {
    await api("logout", { body: {} });
  } catch (e) {}
  ME = null;
  paint();
}

// st -> altera o status de um agendamento (concluído ou cancelado).
// Ao cancelar, pergunta o motivo; se o usuário apertar "Cancelar" no prompt (null), desiste.
function st(id, s) {
  let m = "";
  if (s === "cancelado") {
    m = prompt("Motivo do cancelamento (opcional):");
    if (m === null) return;
  }
  act("status", { id, status: s, motivo: m });
}

// eS -> edita um campo (k) de um serviço: atualiza o objeto local e salva no servidor.
function eS(id, k, v) {
  const s = A.svc.find((x) => x.id === id);
  s[k] = v;
  act("servico_salvar", s, 1);
}

// eB -> mesma ideia, para barbeiros.
function eB(id, k, v) {
  const b = A.bar.find((x) => x.id === id);
  b[k] = v;
  act("barbeiro_salvar", b, 1);
}

// addBar -> cadastra novo barbeiro com os valores digitados no formulário.
function addBar() {
  act(
    "barbeiro_salvar",
    {
      nome: $("#nb1").value,
      especialidade: $("#nb2").value,
      email: $("#nb3").value,
      senha: $("#nb4").value,
      ativo: 1,
    },
    1,
  );
}

// addB -> cria um bloqueio de horário.
// m converte "HH:MM" em minutos (ex.: "09:30" -> 9*60 + 30 = 570).
// Valida: data e horários preenchidos e horário inicial menor que o final.
function addB() {
  const f = $("#b1").value,
    t = $("#b2").value,
    m = (x) => +x.slice(0, 2) * 60 + +x.slice(3);
  if (!$("#bd").value || !f || !t || f >= t)
    return alert("Confira data e horários.");
  act("bloqueio_salvar", {
    data: $("#bd").value,
    barbeiro: $("#bb") ? $("#bb").value : "all", // #bb só existe para admin
    inicio: m(f),
    fim: m(t),
    motivo: $("#bn").value.trim(),
  });
}

/* ===== ROTAS (navegação pela # da URL) ===== */

// show -> exibe apenas a tela escolhida ("home", "book" ou "admin").
// classList.toggle("on", condição) liga a classe "on" só na tela desejada.
function show(v) {
  ["home", "book", "admin"].forEach((x) =>
    $("#v-" + x).classList.toggle("on", x === v),
  );
}

// route -> lê o que vem depois do # na URL e decide qual tela mostrar:
//   #agendar -> fluxo de agendamento | #admin -> painel | qualquer outro -> home
async function route() {
  const h = location.hash.slice(1);
  if (h === "agendar") {
    resetB(); // começa um agendamento do zero
    rBook();
    show("book");
    scrollTo(0, 0);
  } else if (h === "admin") {
    show("admin");
    scrollTo(0, 0);
    // Pergunta ao servidor se já existe sessão ativa (usuário logado)
    try {
      ME = (await api("me")).usuario;
    } catch (e) {
      ME = null;
    }
    if (ME) loadTab();
    else paint();
  } else show("home");
}

/* ===== INICIALIZAÇÃO ===== */

// Sempre que o # da URL mudar, chama route() para trocar de tela
addEventListener("hashchange", route);

// Ao abrir a página: carrega serviços/barbeiros; se falhar, mostra mensagem de erro;
// com sucesso ou erro (.finally), executa route() para exibir a tela correta.
loadPublic()
  .catch((e) => {
    $("#svcGrid").innerHTML =
      '<p class="mut">Não foi possível carregar os serviços. Verifique se o servidor Node.js está rodando e o banco de dados.</p>';
  })
  .finally(route);

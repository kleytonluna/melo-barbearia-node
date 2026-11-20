# Sistema de Agendamento para Barbearia (Node.js)

Sistema web de agendamento de horários para barbearia, com site para o cliente e painel de gestão para barbeiros e administrador.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-5.7%2B-4479A1?logo=mysql&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)

---

## 📋 Sobre o projeto

O cliente escolhe os serviços, o profissional, o dia e o horário em um fluxo de **5 passos**, sem precisar criar conta. O barbeiro e o administrador acessam um painel com login para acompanhar e gerenciar a agenda.

O front-end (`public/index.html`) é o mesmo da versão PHP e consome uma API JSON em Node.js/Express (`api.js`) conectada a um banco MySQL.

## ✨ Funcionalidades

**Cliente:** escolha de serviços (preço e duração somados), barbeiro ou "Sem preferência", calendário com dias livres, horários de 30 em 30 minutos, confirmação com resumo e botão flutuante de WhatsApp.

**Barbeiro:** agenda do dia/semana (somente a própria), marcar como concluído ou cancelado (com motivo), criar e remover os próprios bloqueios.

**Administrador:** agenda geral com filtro por barbeiro, bloqueios individuais ou folga geral, CRUD de serviços, cadastro/edição de barbeiros (com login) e relatório de faturamento.

## 🧱 Tecnologias

| Camada | Tecnologia |
|---|---|
| Front-end | HTML5, CSS3, JavaScript (vanilla) |
| Back-end | Node.js 18+ com Express |
| Banco de dados | MySQL 5.7+ / MariaDB 10.3+ (driver `mysql2`) |
| Autenticação | `express-session` + `bcryptjs` |
| Configuração | `dotenv` (arquivo `.env`) |

## 📁 Estrutura do projeto

```
melo-barbearia-node/
├── public/
│   ├── index.html      # Site, agendamento em 5 passos e painel
│   ├── css/style.css   # Estilos (tema escuro com detalhes dourados)
│   └── js/script.js    # Lógica do front-end
├── server.js           # Servidor Express (site + API + sessão)
├── api.js              # Rotas JSON da API (antigo api.php)
├── lib.js              # Conexão MySQL, autenticação e regras de disponibilidade (antigo lib.php)
├── config.js           # Fuso, horário de funcionamento e leitura do .env (antigo config.php)
├── scripts/instalar.js # Cria os logins iniciais (antigo instalar.php)
├── schema.sql          # Criação do banco, tabelas e dados iniciais
├── .env.example        # Modelo das variáveis de ambiente (conexão com o banco)
├── package.json
└── README.md
```

## 🚀 Como rodar localmente

### Pré-requisitos
- [Node.js](https://nodejs.org) 18 ou superior
- MySQL ou MariaDB (pode ser o do XAMPP ou Laragon)

### Passo a passo

1. **Instale as dependências** dentro da pasta do projeto:
   ```bash
   npm install
   ```

2. **Importe o banco de dados** no phpMyAdmin usando o arquivo `schema.sql` (ele cria o banco `melo_barbearia`, as tabelas e os dados iniciais).

3. **Crie o arquivo `.env`** copiando o modelo e ajustando os dados do seu MySQL:
   ```bash
   cp .env.example .env      # no Windows: copy .env.example .env
   ```
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=melo_barbearia
   DB_USER=root
   DB_PASS=
   ```

4. **Crie os logins iniciais** (uma única vez):
   ```bash
   npm run instalar
   ```
   As senhas são geradas aleatoriamente e exibidas **somente nesta vez**. Anote-as.

5. **Inicie o servidor:**
   ```bash
   npm start          # ou: npm run dev  (reinicia sozinho ao salvar arquivos)
   ```

6. **Acesse o sistema:**
   - Site: `http://localhost:3000/`
   - Painel: `http://localhost:3000/#admin`

### Logins criados

| Perfil | E-mail |
|---|---|
| Administrador | `admin@melo.com` |
| Barbeiro | `lucas@melo.com` |
| Barbeiro | `wesley@melo.com` |

## ⚙️ Configuração

| Onde | Opção | Descrição |
|---|---|---|
| `.env` | `PORT` | Porta do servidor (padrão `3000`) |
| `.env` | `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASS` | Conexão com o MySQL |
| `.env` | `APP_TZ` | Fuso horário (padrão `America/Recife`) |
| `.env` | `SESSION_SECRET` | Texto aleatório que protege a sessão de login |
| `.env` | `SESSION_SECURE` / `TRUST_PROXY` | Use `true` em produção com HTTPS |
| `config.js` | `horario` | Funcionamento por dia da semana (0 = Dom … 6 = Sáb), em minutos |
| `config.js` | `passo` | Intervalo entre horários (padrão `30`) |
| `config.js` | `antecedencia_min` | Antecedência mínima para agendar (padrão `30`) |

> Dias que não aparecem em `horario` são considerados fechados.

## 🗄️ Banco de dados

| Tabela | Função |
|---|---|
| `usuarios` | Logins (admin e barbeiro) com senha criptografada |
| `barbeiros` | Profissionais e especialidade |
| `servicos` | Serviços, duração, preço e status |
| `agendamentos` | Agendamentos com data, início, duração, cliente e status |
| `agendamento_servicos` | Serviços de cada agendamento e o preço cobrado |
| `bloqueios` | Folgas e horários bloqueados (`barbeiro_id` nulo = todos) |
| `cancelamentos` | Registro de quem cancelou e o motivo |

## 🔌 Rotas da API

Todas as rotas seguem o formato `/api?r=<rota>` e retornam JSON (as mesmas da versão PHP).

**Públicas:** `servicos`, `barbeiros`, `dias`, `slots`, `agendar` (POST), `me`, `login` (POST), `logout` (POST).

**Painel (login):** `agenda`, `status` (POST), `bloqueios`, `bloqueio_salvar` (POST), `bloqueio_del` (POST).

**Somente admin:** `servicos_admin`, `servico_salvar` (POST), `servico_del` (POST), `barbeiros_admin`, `barbeiro_salvar` (POST), `relatorio`.

## 🔒 Segurança e regras de negócio

- **Sem conflito de horários:** o agendamento roda em transação com `SELECT ... FOR UPDATE` nos barbeiros candidatos, então dois clientes não pegam o mesmo horário.
- **Preço histórico:** o valor do serviço é gravado em `preco_cobrado`.
- **Senhas** protegidas com `bcrypt` (compatível com os hashes gerados pelo `password_hash` do PHP).
- **SQL Injection:** todas as consultas usam *prepared statements*.
- **Sessão** com cookie `HttpOnly` e `SameSite=Lax`, com novo ID de sessão no login.
- **CSRF básico:** requisições `POST` precisam do cabeçalho `X-Requested-With: fetch`.
- **Controle de acesso:** o barbeiro só enxerga e altera a própria agenda e os próprios bloqueios.
- **Exclusão lógica** de serviços para preservar o histórico.
- O arquivo `.env` fica fora da pasta `public/` e do Git, então não é exposto.

## 🗺️ Próximos passos

- [ ] Login/cadastro e tela de cancelamento para o cliente
- [ ] Envio automático de WhatsApp (API oficial) a cada novo agendamento
- [ ] Limite de tentativas de login
- [ ] Guardar as sessões no MySQL (hoje ficam em memória e caem ao reiniciar o servidor)
- [ ] HTTPS em produção

## 📄 Licença

Defina a licença do projeto (por exemplo, [MIT](https://choosealicense.com/licenses/mit/)).

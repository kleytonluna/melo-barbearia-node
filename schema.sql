-- Melo Barbearia – banco de dados (MySQL 5.7+ / MariaDB 10.3+)
-- Pode ser importado mais de uma vez: não apaga nem duplica dados existentes.
CREATE DATABASE IF NOT EXISTS melo_barbearia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE melo_barbearia;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  papel ENUM('admin','barbeiro') NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS barbeiros (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NULL UNIQUE,
  nome VARCHAR(100) NOT NULL,
  especialidade VARCHAR(120) NOT NULL DEFAULT '',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS servicos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(80) NOT NULL,
  descricao VARCHAR(255) NOT NULL DEFAULT '',
  duracao_min SMALLINT UNSIGNED NOT NULL,
  preco DECIMAL(8,2) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agendamentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barbeiro_id INT UNSIGNED NOT NULL,
  data DATE NOT NULL,
  inicio SMALLINT UNSIGNED NOT NULL COMMENT 'minutos desde 00:00 (540 = 09:00)',
  duracao_min SMALLINT UNSIGNED NOT NULL,
  cliente_nome VARCHAR(100) NOT NULL,
  cliente_whatsapp VARCHAR(15) NOT NULL,
  total DECIMAL(8,2) NOT NULL,
  status ENUM('agendado','concluido','cancelado') NOT NULL DEFAULT 'agendado',
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agenda (barbeiro_id, data, inicio),
  KEY idx_data (data),
  FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agendamento_servicos (
  agendamento_id INT UNSIGNED NOT NULL,
  servico_id INT UNSIGNED NOT NULL,
  preco_cobrado DECIMAL(8,2) NOT NULL,
  PRIMARY KEY (agendamento_id, servico_id),
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (servico_id) REFERENCES servicos(id)
) ENGINE=InnoDB;

-- barbeiro_id NULL = folga geral (todos os barbeiros)
CREATE TABLE IF NOT EXISTS bloqueios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barbeiro_id INT UNSIGNED NULL,
  data DATE NOT NULL,
  inicio SMALLINT UNSIGNED NOT NULL,
  fim SMALLINT UNSIGNED NOT NULL,
  motivo VARCHAR(120) NOT NULL DEFAULT '',
  KEY idx_bloq (data, barbeiro_id),
  FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cancelamentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agendamento_id INT UNSIGNED NOT NULL UNIQUE,
  usuario_id INT UNSIGNED NULL,
  motivo VARCHAR(200) NOT NULL DEFAULT '',
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Dados iniciais (só são inseridos se a tabela estiver vazia)
INSERT INTO barbeiros (nome, especialidade)
SELECT t.nome, t.especialidade FROM (
  SELECT 'Lucas Melo' AS nome, 'Degradê e navalhado' AS especialidade
  UNION ALL SELECT 'Wesley', 'Barba e toalha quente'
) AS t
WHERE NOT EXISTS (SELECT 1 FROM barbeiros);

INSERT INTO servicos (nome, descricao, duracao_min, preco)
SELECT t.nome, t.descricao, t.duracao_min, t.preco FROM (
  SELECT 'Corte' AS nome, 'Tesoura e máquina, acabamento na navalha.' AS descricao, 30 AS duracao_min, 35.00 AS preco
  UNION ALL SELECT 'Bigode', 'Aparar e modelar o bigode.', 30, 5.00
  UNION ALL SELECT 'Barba', 'Toalha quente, óleo e modelagem.', 60, 35.00
  UNION ALL SELECT 'Corte e Barba', 'O pacote completo com desconto.', 90, 55.00
  UNION ALL SELECT 'Sobrancelhas', 'Acabamento rápido entre cortes.', 30, 5.00
) AS t
WHERE NOT EXISTS (SELECT 1 FROM servicos);

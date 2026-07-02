-- Migration : table des mods de l'instance TerraNova
-- Exécutée automatiquement par le panel admin via admin:initDb
-- Base : terranovalauncher_appli (alwaysdata)

CREATE TABLE IF NOT EXISTS mods (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  filename     VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  sha256       VARCHAR(64)  NOT NULL,
  size         INT          NOT NULL DEFAULT 0,
  download_url VARCHAR(500) NOT NULL,
  required     TINYINT(1)   NOT NULL DEFAULT 1,
  enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  added_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

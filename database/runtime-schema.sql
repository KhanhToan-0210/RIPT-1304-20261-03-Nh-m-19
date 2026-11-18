SET NAMES utf8mb4;

CREATE TABLE runtime_write_gate (
    singleton_id TINYINT UNSIGNED PRIMARY KEY,
    namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    node_id ENUM('A','B') NOT NULL,
    database_name VARCHAR(64) NOT NULL,
    server_uuid CHAR(36) CHARACTER SET ascii NOT NULL,
    schema_version INT NOT NULL DEFAULT 2,
    epoch BIGINT UNSIGNED NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    manifest_id VARCHAR(64) NOT NULL,
    transition_id VARCHAR(64) NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_gate_singleton CHECK (singleton_id = 1),
    CONSTRAINT chk_gate_version CHECK (schema_version = 2),
    CONSTRAINT chk_gate_epoch CHECK (enabled = FALSE OR epoch > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE runtime_write_receipts (
    namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    node_id ENUM('A','B') NOT NULL,
    epoch BIGINT UNSIGNED NOT NULL,
    method VARCHAR(12) CHARACTER SET ascii NOT NULL,
    request_path VARCHAR(512) NOT NULL,
    state ENUM('RESERVED','COMMITTED') NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    response_body JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (namespace, request_key),
    CONSTRAINT chk_receipt_status CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

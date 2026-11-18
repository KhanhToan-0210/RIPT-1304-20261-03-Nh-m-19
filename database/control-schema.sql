SET NAMES utf8mb4;

CREATE TABLE cluster_state (
    namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    protocol VARCHAR(40) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    state ENUM('PRIMARY_ACTIVE','MAINTENANCE','STANDBY_ACTIVE','FAILBACK_PENDING') NOT NULL,
    active_writer ENUM('A','B') NULL,
    epoch BIGINT UNSIGNED NOT NULL DEFAULT 0,
    gateway_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
    activation_complete BOOLEAN NOT NULL DEFAULT FALSE,
    transition_id VARCHAR(64) NULL,
    nodes JSON NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_cluster_revision CHECK (revision > 0),
    CONSTRAINT chk_cluster_nodes CHECK (JSON_TYPE(nodes) = 'OBJECT'),
    CONSTRAINT chk_cluster_writer CHECK (
        (state = 'MAINTENANCE' AND active_writer IS NULL AND activation_complete = FALSE) OR
        (state = 'PRIMARY_ACTIVE' AND (active_writer <=> 'A') AND activation_complete = TRUE AND epoch > 0) OR
        (state IN ('STANDBY_ACTIVE','FAILBACK_PENDING') AND (active_writer <=> 'B') AND activation_complete = TRUE AND epoch > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE transition_journal (
    transition_id VARCHAR(64) PRIMARY KEY,
    namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action VARCHAR(32) NOT NULL,
    step VARCHAR(32) NOT NULL,
    status ENUM('IN_PROGRESS','COMPLETE','FAILED','RECONCILE_REQUIRED') NOT NULL,
    owner_id VARCHAR(128) NOT NULL,
    source_node ENUM('A','B') NULL,
    target_node ENUM('A','B') NULL,
    expected_revision BIGINT UNSIGNED NOT NULL,
    epoch BIGINT UNSIGNED NOT NULL,
    details JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (namespace) REFERENCES cluster_state(namespace)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE snapshot_verifications (
    namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    node_id ENUM('A','B') NOT NULL,
    manifest_id VARCHAR(64) NOT NULL,
    database_name VARCHAR(64) NOT NULL,
    server_uuid CHAR(36) CHARACTER SET ascii NOT NULL,
    dump_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    business_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    schema_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    sealed BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (namespace, node_id),
    FOREIGN KEY (namespace) REFERENCES cluster_state(namespace)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO cluster_state (namespace, protocol, state, nodes)
VALUES ('shoponline-c2a-20261118', 'c2a-foundation-v1', 'MAINTENANCE', JSON_OBJECT());

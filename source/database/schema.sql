-- Dừng backend trước khi chạy bằng tài khoản quản trị MySQL.
DROP DATABASE IF EXISTS jumpking;
CREATE DATABASE jumpking CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE jumpking;

CREATE TABLE users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(32) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_id VARCHAR(64) NULL,
    crown VARCHAR(5) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_google_id (google_id)
) ENGINE=InnoDB;

CREATE TABLE matches (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    room_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode VARCHAR(16) NOT NULL,
    map_id SMALLINT NOT NULL,
    time_limit_minutes SMALLINT NULL,
    item_cooldown_minutes SMALLINT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    duration_ticks BIGINT NOT NULL DEFAULT 0,
    end_reason VARCHAR(32) NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_matches_ticks CHECK (duration_ticks BETWEEN 0 AND 9007199254740991),
    CONSTRAINT ck_matches_end CHECK (
        (ended_at IS NULL AND end_reason IS NULL)
        OR (ended_at IS NOT NULL AND ended_at >= started_at AND end_reason IS NOT NULL)
    )
) ENGINE=InnoDB;

CREATE TABLE play_runs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id BIGINT NOT NULL,
    match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    status VARCHAR(16) NOT NULL,
    play_ticks BIGINT NOT NULL DEFAULT 0,
    jumps INT NOT NULL DEFAULT 0,
    falls INT NOT NULL DEFAULT 0,
    current_progress DOUBLE NOT NULL DEFAULT 0,
    max_progress DOUBLE NOT NULL DEFAULT 0,
    peak_reached_ticks BIGINT NOT NULL DEFAULT 0,
    finish_ticks BIGINT NULL,
    `rank` TINYINT NULL,
    snapshot JSON NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    active_community_user_id BIGINT GENERATED ALWAYS AS
        (CASE WHEN match_id IS NULL AND status = 'ACTIVE' THEN user_id ELSE NULL END) VIRTUAL,
    started_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_active_community_user (active_community_user_id),
    KEY ix_runs_owner_history (user_id, ended_at, id),
    UNIQUE KEY uq_runs_match_user (match_id, user_id),
    KEY ix_runs_leaderboard (match_id, status),
    CONSTRAINT fk_runs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_runs_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE RESTRICT,
    CONSTRAINT ck_runs_counters CHECK (
        play_ticks BETWEEN 0 AND 9007199254740991 AND jumps >= 0 AND falls >= 0
        AND current_progress >= 0 AND max_progress >= current_progress
        AND peak_reached_ticks BETWEEN 0 AND play_ticks AND revision BETWEEN 1 AND 9007199254740991
    ),
    CONSTRAINT ck_runs_end CHECK (
        ended_at IS NULL OR ended_at >= started_at
    ),
    CONSTRAINT ck_runs_finish CHECK (
        finish_ticks IS NULL OR finish_ticks >= 0
    ),
    CONSTRAINT ck_runs_snapshot CHECK (
        snapshot IS NULL OR JSON_TYPE(snapshot) = 'OBJECT'
    ),
    CONSTRAINT ck_runs_rank CHECK (`rank` IS NULL OR `rank` >= 1)
) ENGINE=InnoDB;

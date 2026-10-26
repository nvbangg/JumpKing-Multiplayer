-- Dừng backend trước khi chạy bằng tài khoản quản trị MySQL.
DROP DATABASE IF EXISTS jumpking;
CREATE DATABASE jumpking CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE jumpking;

CREATE TABLE users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(32) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_id VARCHAR(64) NULL,
    crown VARCHAR(5) NOT NULL DEFAULT 'NONE',
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_google_id (google_id),
    CONSTRAINT ck_users_crown CHECK (crown IN ('NONE', 'GOLD', 'BLACK'))
) ENGINE=InnoDB;

CREATE TABLE matches (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    room_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode VARCHAR(16) NOT NULL,
    map_level SMALLINT NOT NULL DEFAULT 1,
    time_limit_minutes SMALLINT NULL,
    items_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    item_cooldown_minutes SMALLINT NOT NULL DEFAULT 3,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    duration_ticks BIGINT NOT NULL DEFAULT 0,
    end_reason VARCHAR(32) NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_matches_items CHECK (items_enabled IN (FALSE, TRUE)),
    CONSTRAINT ck_matches_map_level CHECK (map_level BETWEEN 1 AND 10),
    CONSTRAINT ck_matches_mode CHECK (
        (mode IN ('RACE', 'EASY', 'HARDCORE', 'NO_WALK') AND time_limit_minutes IS NULL)
        OR (mode = 'TIME_LIMIT' AND time_limit_minutes IS NOT NULL)
    ),
    CONSTRAINT ck_matches_ticks CHECK (duration_ticks BETWEEN 0 AND 9007199254740991),
    CONSTRAINT ck_matches_end CHECK (
        (ended_at IS NULL AND end_reason IS NULL)
        OR (ended_at IS NOT NULL AND ended_at >= started_at AND end_reason IS NOT NULL
            AND end_reason IN ('FINISH', 'TIME_LIMIT', 'HOST_ENDED', 'ALL_DISCONNECTED', 'ABORTED'))
    )
) ENGINE=InnoDB;

CREATE TABLE play_runs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id BIGINT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    status VARCHAR(16) NOT NULL,
    play_ticks BIGINT NOT NULL DEFAULT 0,
    jumps INT NOT NULL DEFAULT 0,
    falls INT NOT NULL DEFAULT 0,
    current_progress DOUBLE NOT NULL DEFAULT 0,
    max_progress DOUBLE NOT NULL DEFAULT 0,
    peak_reached_ticks BIGINT NOT NULL DEFAULT 0,
    finish_ticks BIGINT NULL,
    nickname VARCHAR(32) NULL,
    `rank` TINYINT NULL,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    snapshot JSON NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    active_community_user_id BIGINT GENERATED ALWAYS AS
        (CASE WHEN kind = 'COMMUNITY' AND status = 'ACTIVE' THEN user_id ELSE NULL END) VIRTUAL,
    started_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_active_community_user (active_community_user_id),
    KEY ix_runs_owner_history (user_id, ended_at, id),
    UNIQUE KEY uq_runs_match_user (match_id, user_id),
    KEY ix_runs_leaderboard (kind, status),
    CONSTRAINT fk_runs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_runs_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE RESTRICT,
    CONSTRAINT ck_runs_kind CHECK (
        (kind = 'COMMUNITY' AND match_id IS NULL AND nickname IS NULL
            AND `rank` IS NULL AND is_winner = FALSE AND status IN ('ACTIVE', 'FINISHED', 'ABANDONED'))
        OR (kind = 'ROOM' AND match_id IS NOT NULL AND nickname IS NOT NULL
            AND status IN ('ACTIVE', 'FINISHED', 'UNFINISHED', 'DNF'))
    ),
    CONSTRAINT ck_runs_counters CHECK (
        play_ticks BETWEEN 0 AND 9007199254740991 AND jumps >= 0 AND falls >= 0
        AND current_progress >= 0 AND max_progress >= current_progress
        AND peak_reached_ticks BETWEEN 0 AND play_ticks AND revision BETWEEN 1 AND 9007199254740991
    ),
    CONSTRAINT ck_runs_end CHECK (
        (status = 'ACTIVE' AND ended_at IS NULL)
        OR (status <> 'ACTIVE' AND ended_at IS NOT NULL AND ended_at >= started_at)
    ),
    CONSTRAINT ck_runs_finish CHECK (
        (status = 'FINISHED' AND finish_ticks IS NOT NULL AND finish_ticks >= 0
            AND (kind = 'ROOM' OR finish_ticks = play_ticks))
        OR (status <> 'FINISHED' AND finish_ticks IS NULL)
    ),
    CONSTRAINT ck_runs_snapshot CHECK (
        (kind = 'COMMUNITY' AND status = 'ACTIVE' AND snapshot IS NOT NULL AND JSON_TYPE(snapshot) = 'OBJECT')
        OR ((kind <> 'COMMUNITY' OR status <> 'ACTIVE') AND snapshot IS NULL)
    ),
    CONSTRAINT ck_runs_rank CHECK (`rank` IS NULL OR (kind = 'ROOM' AND `rank` BETWEEN 1 AND 10)),
    CONSTRAINT ck_runs_winner CHECK (
        is_winner IN (FALSE, TRUE) AND (is_winner = FALSE OR (kind = 'ROOM' AND status = 'FINISHED' AND `rank` IS NOT NULL AND `rank` = 1))
    )
) ENGINE=InnoDB;

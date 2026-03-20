/// SQLite persistence layer for Personaliz Assistant.
///
/// Tables
/// ------
/// agents          – stored agent definitions
/// schedules       – when each agent should run (hourly / daily / cron)
/// logs            – append-only execution log
/// run_history     – one row per agent invocation with result summary
/// heartbeats      – per-agent heartbeat config (interval, enabled)
/// heartbeat_runs  – history of heartbeat check outcomes
/// llm_usage       – log which model/provider was used for each LLM call
/// approvals       – audit history of human approval decisions
/// event_triggers  – generic event-based trigger definitions (URL change, keyword, new post)
/// event_history   – history of event trigger firings
/// openclaw_runs   – per-invocation OpenClaw CLI stdout/stderr capture
use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Global database handle (single connection, mutex-protected)
// ---------------------------------------------------------------------------

static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let path = db_path();
    let conn = Connection::open(&path).expect("Cannot open SQLite database");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("Cannot set PRAGMAs");
    init_schema(&conn).expect("Cannot initialize DB schema");
    Mutex::new(conn)
});

fn db_path() -> PathBuf {
    let base = dirs_next();
    let path = base.join("personaliz-assistant").join("data.db");
    // Ensure the parent directory exists so SQLite can create the file.
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("[db] Failed to create database directory {:?}: {e}", parent);
        }
    }
    path
}

fn dirs_next() -> PathBuf {
    // On Windows prefer APPDATA (C:\Users\<user>\AppData\Roaming) over ~/.local/share
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata);
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            return PathBuf::from(profile).join("AppData").join("Roaming");
        }
    }
    // On Linux/macOS use $HOME/.local/share
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".local").join("share");
    }
    // Last resort: use temp dir to avoid writing in unpredictable cwd
    std::env::temp_dir()
}

fn init_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agents (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            role        TEXT NOT NULL,
            goal        TEXT NOT NULL,
            tools       TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'idle',
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id              TEXT PRIMARY KEY,
            agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            frequency       TEXT NOT NULL,  -- 'hourly' | 'daily' | 'weekly' | 'once' | 'cron'
            cron_expression TEXT,           -- 5-field cron e.g. "0 9 * * 1-5"
            enabled         INTEGER NOT NULL DEFAULT 1,
            last_run        TEXT,
            next_run        TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id    TEXT NOT NULL,
            level       TEXT NOT NULL,
            message     TEXT NOT NULL,
            timestamp   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS run_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id    TEXT NOT NULL,
            started_at  TEXT NOT NULL,
            finished_at TEXT,
            status      TEXT NOT NULL DEFAULT 'running',
            result      TEXT
        );

        CREATE TABLE IF NOT EXISTS heartbeats (
            id           TEXT PRIMARY KEY,
            agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            interval_min INTEGER NOT NULL DEFAULT 60,
            enabled      INTEGER NOT NULL DEFAULT 1,
            last_check   TEXT,
            created_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS heartbeat_runs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id   TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            status     TEXT NOT NULL,
            message    TEXT
        );

        CREATE TABLE IF NOT EXISTS llm_usage (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            provider   TEXT NOT NULL,
            model      TEXT NOT NULL,
            context    TEXT NOT NULL DEFAULT '',
            timestamp  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS approvals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id        TEXT NOT NULL,
            content_preview TEXT NOT NULL,
            outcome         TEXT NOT NULL,  -- 'approved' | 'rejected' | 'cancelled'
            decided_at      TEXT NOT NULL,
            notes           TEXT
        );

        CREATE TABLE IF NOT EXISTS event_triggers (
            id                TEXT PRIMARY KEY,
            agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            trigger_type      TEXT NOT NULL,  -- 'keyword_found' | 'url_change' | 'new_post'
            target_url        TEXT NOT NULL,
            keyword           TEXT,           -- used for keyword_found triggers
            check_interval_min INTEGER NOT NULL DEFAULT 60,
            enabled           INTEGER NOT NULL DEFAULT 1,
            last_checked      TEXT,
            last_hash         TEXT,           -- used for url_change detection
            created_at        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS event_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_id      TEXT NOT NULL,
            agent_id        TEXT NOT NULL,
            fired_at        TEXT NOT NULL,
            matched_content TEXT,
            status          TEXT NOT NULL DEFAULT 'fired'  -- 'fired' | 'error'
        );

        CREATE TABLE IF NOT EXISTS openclaw_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id    TEXT NOT NULL,
            config_path TEXT NOT NULL,
            command     TEXT NOT NULL,
            stdout      TEXT NOT NULL DEFAULT '',
            stderr      TEXT NOT NULL DEFAULT '',
            exit_code   INTEGER,
            started_at  TEXT NOT NULL,
            finished_at TEXT
        );
        "#,
    )
}

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub role: String,
    pub goal: String,
    pub tools: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScheduleRow {
    pub id: String,
    pub agent_id: String,
    pub frequency: String,
    pub cron_expression: Option<String>,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub next_run: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogRow {
    pub id: i64,
    pub agent_id: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RunHistoryRow {
    pub id: i64,
    pub agent_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub result: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HeartbeatRow {
    pub id: String,
    pub agent_id: String,
    pub interval_min: i64,
    pub enabled: bool,
    pub last_check: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HeartbeatRunRow {
    pub id: i64,
    pub agent_id: String,
    pub checked_at: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmUsageRow {
    pub id: i64,
    pub provider: String,
    pub model: String,
    pub context: String,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

pub fn upsert_agent(agent: &AgentRow) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO agents (id, name, role, goal, tools, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           role=excluded.role,
           goal=excluded.goal,
           tools=excluded.tools,
           status=excluded.status",
        params![
            agent.id, agent.name, agent.role, agent.goal,
            agent.tools, agent.status, agent.created_at
        ],
    )?;
    Ok(())
}

pub fn list_agents() -> SqlResult<Vec<AgentRow>> {
    let db = DB.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, name, role, goal, tools, status, created_at FROM agents ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AgentRow {
            id: row.get(0)?,
            name: row.get(1)?,
            role: row.get(2)?,
            goal: row.get(3)?,
            tools: row.get(4)?,
            status: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn delete_agent(id: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_agent_status(id: &str, status: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "UPDATE agents SET status = ?1 WHERE id = ?2",
        params![status, id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

pub fn upsert_schedule(s: &ScheduleRow) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO schedules (id, agent_id, frequency, cron_expression, enabled, last_run, next_run, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           frequency=excluded.frequency,
           cron_expression=excluded.cron_expression,
           enabled=excluded.enabled,
           next_run=excluded.next_run",
        params![
            s.id, s.agent_id, s.frequency, s.cron_expression,
            s.enabled as i32,
            s.last_run, s.next_run, s.created_at
        ],
    )?;
    Ok(())
}

pub fn list_schedules() -> SqlResult<Vec<ScheduleRow>> {
    let db = DB.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, agent_id, frequency, cron_expression, enabled, last_run, next_run, created_at
         FROM schedules ORDER BY next_run",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ScheduleRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            frequency: row.get(2)?,
            cron_expression: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            last_run: row.get(5)?,
            next_run: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn update_schedule_run(id: &str, last_run: &str, next_run: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "UPDATE schedules SET last_run = ?1, next_run = ?2 WHERE id = ?3",
        params![last_run, next_run, id],
    )?;
    Ok(())
}

pub fn delete_schedule(id: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute("DELETE FROM schedules WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

pub fn append_log(agent_id: &str, level: &str, message: &str, timestamp: &str) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO logs (agent_id, level, message, timestamp) VALUES (?1, ?2, ?3, ?4)",
        params![agent_id, level, message, timestamp],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn get_logs(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<LogRow>> {
    let db = DB.lock().unwrap();
    let (sql, use_filter) = if agent_id.is_some() {
        (
            "SELECT id, agent_id, level, message, timestamp FROM logs WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
            true,
        )
    } else {
        (
            "SELECT id, agent_id, level, message, timestamp FROM logs ORDER BY id DESC LIMIT ?2",
            false,
        )
    };

    // rusqlite doesn't support truly dynamic param counts easily – use two branches
    if use_filter {
        let mut stmt = db.prepare(sql)?;
        let rows = stmt.query_map(
            params![agent_id.unwrap(), limit as i64],
            |row| Ok(LogRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                timestamp: row.get(4)?,
            }),
        )?;
        rows.collect()
    } else {
        let sql_no_filter =
            "SELECT id, agent_id, level, message, timestamp FROM logs ORDER BY id DESC LIMIT ?1";
        let mut stmt = db.prepare(sql_no_filter)?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(LogRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;
        rows.collect()
    }
}

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------

pub fn start_run(agent_id: &str, started_at: &str) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO run_history (agent_id, started_at, status) VALUES (?1, ?2, 'running')",
        params![agent_id, started_at],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn finish_run(run_id: i64, finished_at: &str, status: &str, result: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "UPDATE run_history SET finished_at = ?1, status = ?2, result = ?3 WHERE id = ?4",
        params![finished_at, status, result, run_id],
    )?;
    Ok(())
}

pub fn get_run_history(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<RunHistoryRow>> {
    let db = DB.lock().unwrap();
    if let Some(aid) = agent_id {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, started_at, finished_at, status, result
             FROM run_history WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![aid, limit as i64], |row| {
            Ok(RunHistoryRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                result: row.get(5)?,
            })
        })?;
        rows.collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, started_at, finished_at, status, result
             FROM run_history ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(RunHistoryRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                result: row.get(5)?,
            })
        })?;
        rows.collect()
    }
}

// ---------------------------------------------------------------------------
// Heartbeats
// ---------------------------------------------------------------------------

pub fn upsert_heartbeat(h: &HeartbeatRow) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO heartbeats (id, agent_id, interval_min, enabled, last_check, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           interval_min=excluded.interval_min,
           enabled=excluded.enabled",
        params![
            h.id, h.agent_id, h.interval_min, h.enabled as i32,
            h.last_check, h.created_at
        ],
    )?;
    Ok(())
}

pub fn list_heartbeats() -> SqlResult<Vec<HeartbeatRow>> {
    let db = DB.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, agent_id, interval_min, enabled, last_check, created_at
         FROM heartbeats ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(HeartbeatRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            interval_min: row.get(2)?,
            enabled: row.get::<_, i32>(3)? != 0,
            last_check: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn update_heartbeat_last_check(id: &str, last_check: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "UPDATE heartbeats SET last_check = ?1 WHERE id = ?2",
        params![last_check, id],
    )?;
    Ok(())
}

pub fn delete_heartbeat(id: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute("DELETE FROM heartbeats WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn record_heartbeat_run(agent_id: &str, checked_at: &str, status: &str, message: &str) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO heartbeat_runs (agent_id, checked_at, status, message) VALUES (?1, ?2, ?3, ?4)",
        params![agent_id, checked_at, status, message],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn get_heartbeat_runs(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<HeartbeatRunRow>> {
    let db = DB.lock().unwrap();
    if let Some(aid) = agent_id {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, checked_at, status, message
             FROM heartbeat_runs WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![aid, limit as i64], |row| {
            Ok(HeartbeatRunRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                checked_at: row.get(2)?,
                status: row.get(3)?,
                message: row.get(4)?,
            })
        })?;
        rows.collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, checked_at, status, message
             FROM heartbeat_runs ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(HeartbeatRunRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                checked_at: row.get(2)?,
                status: row.get(3)?,
                message: row.get(4)?,
            })
        })?;
        rows.collect()
    }
}

// ---------------------------------------------------------------------------
// LLM usage log
// ---------------------------------------------------------------------------

pub fn record_llm_usage(provider: &str, model: &str, context: &str, timestamp: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO llm_usage (provider, model, context, timestamp) VALUES (?1, ?2, ?3, ?4)",
        params![provider, model, context, timestamp],
    )?;
    Ok(())
}

pub fn get_llm_usage(limit: usize) -> SqlResult<Vec<LlmUsageRow>> {
    let db = DB.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, provider, model, context, timestamp FROM llm_usage ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(LlmUsageRow {
            id: row.get(0)?,
            provider: row.get(1)?,
            model: row.get(2)?,
            context: row.get(3)?,
            timestamp: row.get(4)?,
        })
    })?;
    rows.collect()
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApprovalRow {
    pub id: i64,
    pub agent_id: String,
    pub content_preview: String,
    pub outcome: String,
    pub decided_at: String,
    pub notes: Option<String>,
}

pub fn record_approval(
    agent_id: &str,
    content_preview: &str,
    outcome: &str,
    decided_at: &str,
    notes: Option<&str>,
) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO approvals (agent_id, content_preview, outcome, decided_at, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![agent_id, content_preview, outcome, decided_at, notes],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn list_approvals(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<ApprovalRow>> {
    let db = DB.lock().unwrap();
    if let Some(aid) = agent_id {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, content_preview, outcome, decided_at, notes
             FROM approvals WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![aid, limit as i64], |row| {
            Ok(ApprovalRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                content_preview: row.get(2)?,
                outcome: row.get(3)?,
                decided_at: row.get(4)?,
                notes: row.get(5)?,
            })
        })?;
        rows.collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, content_preview, outcome, decided_at, notes
             FROM approvals ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(ApprovalRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                content_preview: row.get(2)?,
                outcome: row.get(3)?,
                decided_at: row.get(4)?,
                notes: row.get(5)?,
            })
        })?;
        rows.collect()
    }
}

/// Ensure the database is initialised (call once at startup).
pub fn init() {
    Lazy::force(&DB);
    // Migrate: add new columns to existing databases gracefully
    if let Ok(db) = DB.lock() {
        // cron_expression column was added in v0.3 – safe to ignore error if already present
        let _ = db.execute_batch("ALTER TABLE schedules ADD COLUMN cron_expression TEXT;");
        // New tables added in v0.4 – safe to ignore errors if already present
        let _ = db.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS event_triggers (
                id                TEXT PRIMARY KEY,
                agent_id          TEXT NOT NULL,
                trigger_type      TEXT NOT NULL,
                target_url        TEXT NOT NULL,
                keyword           TEXT,
                check_interval_min INTEGER NOT NULL DEFAULT 60,
                enabled           INTEGER NOT NULL DEFAULT 1,
                last_checked      TEXT,
                last_hash         TEXT,
                created_at        TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                trigger_id      TEXT NOT NULL,
                agent_id        TEXT NOT NULL,
                fired_at        TEXT NOT NULL,
                matched_content TEXT,
                status          TEXT NOT NULL DEFAULT 'fired'
            );
            CREATE TABLE IF NOT EXISTS openclaw_runs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id    TEXT NOT NULL,
                config_path TEXT NOT NULL,
                command     TEXT NOT NULL,
                stdout      TEXT NOT NULL DEFAULT '',
                stderr      TEXT NOT NULL DEFAULT '',
                exit_code   INTEGER,
                started_at  TEXT NOT NULL,
                finished_at TEXT
            );
            "#,
        );
    }
}

// ---------------------------------------------------------------------------
// Event triggers
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EventTriggerRow {
    pub id: String,
    pub agent_id: String,
    pub trigger_type: String,
    pub target_url: String,
    pub keyword: Option<String>,
    pub check_interval_min: i64,
    pub enabled: bool,
    pub last_checked: Option<String>,
    pub last_hash: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EventHistoryRow {
    pub id: i64,
    pub trigger_id: String,
    pub agent_id: String,
    pub fired_at: String,
    pub matched_content: Option<String>,
    pub status: String,
}

pub fn upsert_event_trigger(t: &EventTriggerRow) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO event_triggers
             (id, agent_id, trigger_type, target_url, keyword, check_interval_min, enabled, last_checked, last_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
           trigger_type=excluded.trigger_type,
           target_url=excluded.target_url,
           keyword=excluded.keyword,
           check_interval_min=excluded.check_interval_min,
           enabled=excluded.enabled",
        params![
            t.id, t.agent_id, t.trigger_type, t.target_url, t.keyword,
            t.check_interval_min, t.enabled as i32,
            t.last_checked, t.last_hash, t.created_at
        ],
    )?;
    Ok(())
}

pub fn list_event_triggers() -> SqlResult<Vec<EventTriggerRow>> {
    let db = DB.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, agent_id, trigger_type, target_url, keyword,
                check_interval_min, enabled, last_checked, last_hash, created_at
         FROM event_triggers ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(EventTriggerRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            trigger_type: row.get(2)?,
            target_url: row.get(3)?,
            keyword: row.get(4)?,
            check_interval_min: row.get(5)?,
            enabled: row.get::<_, i32>(6)? != 0,
            last_checked: row.get(7)?,
            last_hash: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn delete_event_trigger(id: &str) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute("DELETE FROM event_triggers WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_event_trigger_checked(id: &str, last_checked: &str, last_hash: Option<&str>) -> SqlResult<()> {
    let db = DB.lock().unwrap();
    db.execute(
        "UPDATE event_triggers SET last_checked = ?1, last_hash = ?2 WHERE id = ?3",
        params![last_checked, last_hash, id],
    )?;
    Ok(())
}

pub fn record_event_history(
    trigger_id: &str,
    agent_id: &str,
    fired_at: &str,
    matched_content: Option<&str>,
    status: &str,
) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO event_history (trigger_id, agent_id, fired_at, matched_content, status)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![trigger_id, agent_id, fired_at, matched_content, status],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn get_event_history(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<EventHistoryRow>> {
    let db = DB.lock().unwrap();
    if let Some(aid) = agent_id {
        let mut stmt = db.prepare(
            "SELECT id, trigger_id, agent_id, fired_at, matched_content, status
             FROM event_history WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![aid, limit as i64], |row| {
            Ok(EventHistoryRow {
                id: row.get(0)?,
                trigger_id: row.get(1)?,
                agent_id: row.get(2)?,
                fired_at: row.get(3)?,
                matched_content: row.get(4)?,
                status: row.get(5)?,
            })
        })?;
        rows.collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, trigger_id, agent_id, fired_at, matched_content, status
             FROM event_history ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(EventHistoryRow {
                id: row.get(0)?,
                trigger_id: row.get(1)?,
                agent_id: row.get(2)?,
                fired_at: row.get(3)?,
                matched_content: row.get(4)?,
                status: row.get(5)?,
            })
        })?;
        rows.collect()
    }
}

// ---------------------------------------------------------------------------
// OpenClaw runs (per-invocation CLI output capture)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OpenClawRunRow {
    pub id: i64,
    pub agent_id: String,
    pub config_path: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i64>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

pub fn record_openclaw_run(
    agent_id: &str,
    config_path: &str,
    command: &str,
    stdout: &str,
    stderr: &str,
    exit_code: Option<i32>,
    started_at: &str,
    finished_at: &str,
) -> SqlResult<i64> {
    let db = DB.lock().unwrap();
    db.execute(
        "INSERT INTO openclaw_runs (agent_id, config_path, command, stdout, stderr, exit_code, started_at, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![agent_id, config_path, command, stdout, stderr, exit_code, started_at, finished_at],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn get_openclaw_runs(agent_id: Option<&str>, limit: usize) -> SqlResult<Vec<OpenClawRunRow>> {
    let db = DB.lock().unwrap();
    if let Some(aid) = agent_id {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, config_path, command, stdout, stderr, exit_code, started_at, finished_at
             FROM openclaw_runs WHERE agent_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![aid, limit as i64], |row| {
            Ok(OpenClawRunRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                config_path: row.get(2)?,
                command: row.get(3)?,
                stdout: row.get(4)?,
                stderr: row.get(5)?,
                exit_code: row.get(6)?,
                started_at: row.get(7)?,
                finished_at: row.get(8)?,
            })
        })?;
        rows.collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, agent_id, config_path, command, stdout, stderr, exit_code, started_at, finished_at
             FROM openclaw_runs ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(OpenClawRunRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                config_path: row.get(2)?,
                command: row.get(3)?,
                stdout: row.get(4)?,
                stderr: row.get(5)?,
                exit_code: row.get(6)?,
                started_at: row.get(7)?,
                finished_at: row.get(8)?,
            })
        })?;
        rows.collect()
    }
}

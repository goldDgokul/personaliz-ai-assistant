/// Background scheduler for Personaliz Assistant.
///
/// Reads schedules from SQLite every 60 seconds and triggers due runs
/// via the Python agent engine.  Also polls heartbeat configs and
/// records their outcomes.
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use chrono::{DateTime, Datelike, NaiveDateTime, TimeZone, Timelike, Utc, Duration as ChronoDuration};

use crate::db;

/// Spawn the scheduler loop as a detached Tauri async-runtime task.
pub fn start(agent_engine_path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            run_due_schedules(&agent_engine_path);
            run_due_heartbeats();
            run_due_event_triggers(&agent_engine_path);
        }
    });
}

/// Check all enabled schedules and execute any that are past their `next_run`.
fn run_due_schedules(agent_engine_path: &PathBuf) {
    let now = Utc::now();
    let schedules = match db::list_schedules() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[scheduler] Cannot read schedules: {e}");
            return;
        }
    };

    for schedule in schedules {
        if !schedule.enabled {
            continue;
        }

        let next_run = match schedule.next_run.parse::<DateTime<Utc>>() {
            Ok(dt) => dt,
            Err(_) => continue,
        };

        if now < next_run {
            continue;
        }

        // This schedule is due – trigger the agent
        eprintln!(
            "[scheduler] Triggering agent {} (schedule: {}, freq: {})",
            schedule.agent_id, schedule.id, schedule.frequency
        );

        let started_at = now.to_rfc3339();
        let run_id = match db::start_run(&schedule.agent_id, &started_at) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("[scheduler] Failed to record run start for agent {}: {e}", schedule.agent_id);
                -1
            }
        };

        let (status, result_msg) =
            execute_agent_python(agent_engine_path, &schedule.agent_id, true);

        let finished_at = Utc::now().to_rfc3339();
        if run_id >= 0 {
            let _ = db::finish_run(run_id, &finished_at, &status, &result_msg);
        }

        // Log the outcome
        let _ = db::append_log(
            &schedule.agent_id,
            if status == "success" { "success" } else { "error" },
            &format!("[Scheduled] {result_msg}"),
            &finished_at,
        );

        // Compute next_run based on frequency or cron expression
        let next = compute_next_run_from_schedule(&schedule.frequency, schedule.cron_expression.as_deref(), &now);
        let _ = db::update_schedule_run(
            &schedule.id,
            &started_at,
            &next.to_rfc3339(),
        );
    }
}

/// Compute the next run time given a frequency string and optional cron expression.
/// If a cron expression is present and valid, it takes precedence.
pub fn compute_next_run_from_schedule(
    frequency: &str,
    cron_expression: Option<&str>,
    from: &DateTime<Utc>,
) -> DateTime<Utc> {
    if let Some(expr) = cron_expression {
        if !expr.is_empty() {
            if let Some(next) = next_cron_time(expr, from) {
                return next;
            }
            eprintln!("[scheduler] Invalid cron expression {:?}; falling back to frequency", expr);
        }
    }
    compute_next_run(frequency, from)
}

/// Compute the next run time given a frequency string.
pub fn compute_next_run(frequency: &str, from: &DateTime<Utc>) -> DateTime<Utc> {
    match frequency.to_lowercase().as_str() {
        "hourly" => *from + ChronoDuration::hours(1),
        "daily" => *from + ChronoDuration::hours(24),
        "weekly" => *from + ChronoDuration::weeks(1),
        _ => *from + ChronoDuration::hours(24),
    }
}

// ---------------------------------------------------------------------------
// Cron expression parser
// ---------------------------------------------------------------------------

/// Parse a single cron field into the set of matching values.
///
/// Supports: `*`, `n`, `*/step`, `n-m`, `n,m,…` (and combinations).
pub fn parse_cron_field(s: &str, min: u8, max: u8) -> Option<Vec<u8>> {
    let mut result = Vec::new();

    for part in s.split(',') {
        if part == "*" {
            for v in min..=max {
                result.push(v);
            }
        } else if let Some(step_str) = part.strip_prefix("*/") {
            let step: u8 = step_str.parse().ok()?;
            if step == 0 {
                return None;
            }
            let mut v = min;
            while v <= max {
                result.push(v);
                v = v.saturating_add(step);
            }
        } else if let Some(dash_pos) = part.find('-') {
            let lo: u8 = part[..dash_pos].parse().ok()?;
            let hi: u8 = part[dash_pos + 1..].parse().ok()?;
            if lo > hi {
                return None;
            }
            for v in lo..=hi {
                result.push(v);
            }
        } else {
            let v: u8 = part.parse().ok()?;
            if v < min || v > max {
                return None;
            }
            result.push(v);
        }
    }

    result.sort_unstable();
    result.dedup();
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// Compute the next datetime that matches the given 5-field cron expression.
///
/// Field order: `minute hour day-of-month month day-of-week`
///
/// Returns `None` if the expression is invalid or no match is found within 1 year.
pub fn next_cron_time(cron: &str, from: &DateTime<Utc>) -> Option<DateTime<Utc>> {
    let fields: Vec<&str> = cron.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return None;
    }

    let mins_set = parse_cron_field(fields[0], 0, 59)?;
    let hrs_set = parse_cron_field(fields[1], 0, 23)?;
    let doms_set = parse_cron_field(fields[2], 1, 31)?;
    let months_set = parse_cron_field(fields[3], 1, 12)?;
    let dows_set = parse_cron_field(fields[4], 0, 6)?;

    let dom_restricted = fields[2] != "*";
    let dow_restricted = fields[4] != "*";

    // Advance by at least 1 minute and truncate to minute precision
    let start_naive = (from.naive_utc() + ChronoDuration::minutes(1))
        .with_second(0)
        .and_then(|dt| dt.with_nanosecond(0))?;
    let mut dt = DateTime::<Utc>::from_naive_utc_and_offset(start_naive, Utc);

    let limit = *from + ChronoDuration::days(366);

    while dt <= limit {
        let month = dt.month() as u8;
        let dom = dt.day() as u8;
        let dow = dt.weekday().num_days_from_sunday() as u8;
        let hour = dt.hour() as u8;
        let min = dt.minute() as u8;

        if !months_set.contains(&month) {
            dt = dt + ChronoDuration::minutes(1);
            continue;
        }

        let day_ok = if dom_restricted && dow_restricted {
            doms_set.contains(&dom) || dows_set.contains(&dow)
        } else if dom_restricted {
            doms_set.contains(&dom)
        } else if dow_restricted {
            dows_set.contains(&dow)
        } else {
            true
        };

        if !day_ok {
            dt = dt + ChronoDuration::minutes(1);
            continue;
        }

        if !hrs_set.contains(&hour) {
            dt = dt + ChronoDuration::minutes(1);
            continue;
        }

        if mins_set.contains(&min) {
            return Some(dt);
        }

        dt = dt + ChronoDuration::minutes(1);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn base_time() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap()
    }

    #[test]
    fn test_compute_next_run_hourly() {
        let from = base_time();
        let next = compute_next_run("hourly", &from);
        assert_eq!(next, from + ChronoDuration::hours(1));
    }

    #[test]
    fn test_compute_next_run_daily() {
        let from = base_time();
        let next = compute_next_run("daily", &from);
        assert_eq!(next, from + ChronoDuration::hours(24));
    }

    #[test]
    fn test_compute_next_run_weekly() {
        let from = base_time();
        let next = compute_next_run("weekly", &from);
        assert_eq!(next, from + ChronoDuration::weeks(1));
    }

    #[test]
    fn test_compute_next_run_unknown_defaults_to_daily() {
        let from = base_time();
        let next = compute_next_run("once", &from);
        assert_eq!(next, from + ChronoDuration::hours(24));
    }

    #[test]
    fn test_compute_next_run_case_insensitive() {
        let from = base_time();
        assert_eq!(compute_next_run("HOURLY", &from), compute_next_run("hourly", &from));
        assert_eq!(compute_next_run("Daily", &from), compute_next_run("daily", &from));
    }

    // -----------------------------------------------------------------------
    // Cron field parser tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_cron_field_star() {
        let v = parse_cron_field("*", 0, 5).unwrap();
        assert_eq!(v, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_parse_cron_field_exact() {
        let v = parse_cron_field("3", 0, 59).unwrap();
        assert_eq!(v, vec![3]);
    }

    #[test]
    fn test_parse_cron_field_step() {
        let v = parse_cron_field("*/15", 0, 59).unwrap();
        assert_eq!(v, vec![0, 15, 30, 45]);
    }

    #[test]
    fn test_parse_cron_field_range() {
        let v = parse_cron_field("1-3", 0, 6).unwrap();
        assert_eq!(v, vec![1, 2, 3]);
    }

    #[test]
    fn test_parse_cron_field_list() {
        let v = parse_cron_field("0,15,30,45", 0, 59).unwrap();
        assert_eq!(v, vec![0, 15, 30, 45]);
    }

    #[test]
    fn test_parse_cron_field_zero_step_invalid() {
        assert!(parse_cron_field("*/0", 0, 59).is_none());
    }

    // -----------------------------------------------------------------------
    // Cron next-time tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_next_cron_time_every_minute() {
        let from = base_time(); // 2024-01-01 12:00:00
        let next = next_cron_time("* * * * *", &from).unwrap();
        assert_eq!(next, from + ChronoDuration::minutes(1));
    }

    #[test]
    fn test_next_cron_time_daily_9am() {
        // "0 9 * * *" from 12:00 should give next day 09:00
        let from = base_time(); // 12:00
        let next = next_cron_time("0 9 * * *", &from).unwrap();
        let expected = Utc.with_ymd_and_hms(2024, 1, 2, 9, 0, 0).unwrap();
        assert_eq!(next, expected);
    }

    #[test]
    fn test_next_cron_time_before_trigger_same_day() {
        // "0 15 * * *" from 12:00 should fire same day at 15:00
        let from = base_time(); // 12:00
        let next = next_cron_time("0 15 * * *", &from).unwrap();
        let expected = Utc.with_ymd_and_hms(2024, 1, 1, 15, 0, 0).unwrap();
        assert_eq!(next, expected);
    }

    #[test]
    fn test_next_cron_time_every_15_min() {
        let from = Utc.with_ymd_and_hms(2024, 1, 1, 12, 7, 0).unwrap();
        let next = next_cron_time("*/15 * * * *", &from).unwrap();
        let expected = Utc.with_ymd_and_hms(2024, 1, 1, 12, 15, 0).unwrap();
        assert_eq!(next, expected);
    }

    #[test]
    fn test_next_cron_time_invalid_returns_none() {
        let from = base_time();
        assert!(next_cron_time("bad expression", &from).is_none());
        assert!(next_cron_time("* * * *", &from).is_none()); // only 4 fields
    }

    #[test]
    fn test_compute_next_run_from_schedule_uses_cron_when_present() {
        let from = base_time(); // 12:00
        let next = compute_next_run_from_schedule("daily", Some("0 15 * * *"), &from);
        let expected = Utc.with_ymd_and_hms(2024, 1, 1, 15, 0, 0).unwrap();
        assert_eq!(next, expected);
    }

    #[test]
    fn test_compute_next_run_from_schedule_falls_back_on_invalid_cron() {
        let from = base_time();
        let next = compute_next_run_from_schedule("hourly", Some("not valid"), &from);
        assert_eq!(next, from + ChronoDuration::hours(1));
    }

    #[test]
    fn test_compute_next_run_from_schedule_uses_frequency_when_no_cron() {
        let from = base_time();
        let next = compute_next_run_from_schedule("hourly", None, &from);
        assert_eq!(next, from + ChronoDuration::hours(1));
    }
}

/// Execute the Python agent in sandbox mode (scheduled runs are sandbox-safe).
fn execute_agent_python(
    agent_engine_path: &PathBuf,
    agent_id: &str,
    sandbox: bool,
) -> (String, String) {
    if !agent_engine_path.exists() {
        return (
            "error".to_string(),
            format!("agent_engine.py not found at {:?}", agent_engine_path),
        );
    }

    let python_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };
    let sandbox_arg = if sandbox { "sandbox" } else { "live" };

    match Command::new(python_cmd)
        .arg(agent_engine_path)
        .arg(agent_id)
        .arg(sandbox_arg)
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            ("success".to_string(), stdout.trim().to_string())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            ("error".to_string(), stderr.trim().to_string())
        }
        Err(e) => ("error".to_string(), e.to_string()),
    }
}

/// Poll event triggers and fire agents for any that are due.
/// Uses a simple HTTP GET to check the target URL for keyword matches or content changes.
fn run_due_event_triggers(agent_engine_path: &PathBuf) {
    let now = Utc::now();
    let triggers = match db::list_event_triggers() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[scheduler] Cannot read event_triggers: {e}");
            return;
        }
    };

    for trigger in triggers {
        if !trigger.enabled {
            continue;
        }

        // Determine if check interval has elapsed
        let due = match &trigger.last_checked {
            None => true,
            Some(last) => match last.parse::<DateTime<Utc>>() {
                Ok(dt) => now >= dt + ChronoDuration::minutes(trigger.check_interval_min),
                Err(_) => true,
            },
        };

        if !due {
            continue;
        }

        eprintln!(
            "[scheduler] Checking event trigger {} ({}) for agent {}",
            trigger.id, trigger.trigger_type, trigger.agent_id
        );

        let checked_at = now.to_rfc3339();
        let (fired, matched_content) = check_event_trigger(&trigger);

        let new_hash: Option<String> = if trigger.trigger_type == "url_change" {
            matched_content.clone()
        } else {
            trigger.last_hash.clone()
        };

        let _ = db::update_event_trigger_checked(&trigger.id, &checked_at, new_hash.as_deref());

        if fired {
            eprintln!(
                "[scheduler] Event trigger {} fired for agent {}! Content: {:?}",
                trigger.id, trigger.agent_id, matched_content
            );

            let _ = db::record_event_history(
                &trigger.id,
                &trigger.agent_id,
                &checked_at,
                matched_content.as_deref(),
                "fired",
            );

            // Run the agent
            let started_at = now.to_rfc3339();
            let run_id = db::start_run(&trigger.agent_id, &started_at).unwrap_or(-1);
            let (status, result_msg) = execute_agent_python(agent_engine_path, &trigger.agent_id, true);
            let finished_at = Utc::now().to_rfc3339();
            if run_id >= 0 {
                let _ = db::finish_run(run_id, &finished_at, &status, &result_msg);
            }
            let _ = db::append_log(
                &trigger.agent_id,
                if status == "success" { "success" } else { "error" },
                &format!("[EventTrigger] {result_msg}"),
                &finished_at,
            );
        }
    }
}

/// Check a single event trigger. Returns (fired, optional_matched_content).
fn check_event_trigger(trigger: &db::EventTriggerRow) -> (bool, Option<String>) {
    // Use a simple blocking TCP connection to avoid bringing in async reqwest here.
    // We parse the URL and do a minimal HTTP/1.1 GET over std::net::TcpStream.
    let body = match fetch_url_body(&trigger.target_url) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[scheduler] Event trigger {} fetch error: {e}", trigger.id);
            return (false, None);
        }
    };

    match trigger.trigger_type.as_str() {
        "keyword_found" => {
            if let Some(kw) = &trigger.keyword {
                let found = body.to_lowercase().contains(&kw.to_lowercase());
                if found {
                    return (true, Some(format!("Keyword '{}' found in {}", kw, trigger.target_url)));
                }
            }
            (false, None)
        }
        "url_change" => {
            // Use a hash of the body to detect changes
            let hash = format!("{:x}", fnv1a_hash(&body));
            let changed = trigger.last_hash.as_deref() != Some(&hash);
            if changed && trigger.last_hash.is_some() {
                (true, Some(hash))
            } else {
                // First check or no change — store hash but don't fire
                (false, Some(hash))
            }
        }
        "new_post" => {
            // Simple heuristic: look for common RSS/feed item indicators
            let item_count = body.matches("<item>").count() + body.matches("\"entry\"").count();
            if item_count > 0 {
                let hash = format!("{:x}", fnv1a_hash(&body));
                let changed = trigger.last_hash.as_deref() != Some(&hash);
                if changed && trigger.last_hash.is_some() {
                    return (true, Some(format!("New content detected ({item_count} items) at {}", trigger.target_url)));
                }
                (false, Some(hash))
            } else {
                (false, None)
            }
        }
        _ => (false, None),
    }
}

/// FNV-1a 64-bit hash used for content-change detection (no external crate needed).
fn fnv1a_hash(s: &str) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in s.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

/// Minimal synchronous HTTP GET that returns the response body as a String.
/// Only supports http:// (not https://).  Returns an error for https:// URLs.
fn fetch_url_body(url: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let url = url.trim();

    let (host, path) = if let Some(rest) = url.strip_prefix("http://") {
        let slash_pos = rest.find('/').unwrap_or(rest.len());
        (rest[..slash_pos].to_string(), rest[slash_pos..].to_string())
    } else if url.starts_with("https://") {
        // TLS requires an external dependency that is not bundled.
        // Users should either use an http:// URL or implement a custom polling solution.
        return Err("https:// URLs require TLS support which is not available in the built-in poller. Use http:// URLs instead.".to_string());
    } else {
        return Err(format!("Unsupported URL scheme: {url}"));
    };

    let host_port = if host.contains(':') {
        host.clone()
    } else {
        format!("{host}:80")
    };

    let path = if path.is_empty() { "/".to_string() } else { path };

    let mut stream = TcpStream::connect(&host_port)
        .map_err(|e| format!("Cannot connect to {host_port}: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;

    let request = format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| e.to_string())?;

    // Strip HTTP headers
    if let Some(body_start) = response.find("\r\n\r\n") {
        Ok(response[body_start + 4..].to_string())
    } else {
        Ok(response)
    }
}


fn run_due_heartbeats() {
    let now = Utc::now();
    let heartbeats = match db::list_heartbeats() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[scheduler] Cannot read heartbeats: {e}");
            return;
        }
    };

    for hb in heartbeats {
        if !hb.enabled {
            continue;
        }

        // Determine if the heartbeat interval has elapsed since last_check.
        let due = match &hb.last_check {
            None => true, // never checked – run immediately
            Some(last) => match last.parse::<DateTime<Utc>>() {
                Ok(dt) => now >= dt + ChronoDuration::minutes(hb.interval_min),
                Err(_) => true,
            },
        };

        if !due {
            continue;
        }

        eprintln!(
            "[scheduler] Heartbeat check for agent {} (interval: {} min)",
            hb.agent_id, hb.interval_min
        );

        let checked_at = now.to_rfc3339();

        // Determine if the agent is still active (has recent run_history entry).
        let (status, message) = match db::get_run_history(Some(&hb.agent_id), 1) {
            Ok(history) if !history.is_empty() => {
                let last = &history[0];
        // ISO 8601 prefix length 'YYYY-MM-DDTHH:MM:SS' == 19 chars
        const TIMESTAMP_DISPLAY_LEN: usize = 19;
        let msg = format!(
            "Last run: {} – {}",
            last.started_at.get(..TIMESTAMP_DISPLAY_LEN).unwrap_or(&last.started_at),
            last.status
        );
                ("ok".to_string(), msg)
            }
            Ok(_) => ("idle".to_string(), "No runs recorded yet".to_string()),
            Err(e) => ("error".to_string(), format!("DB error: {e}")),
        };

        let _ = db::record_heartbeat_run(&hb.agent_id, &checked_at, &status, &message);
        let _ = db::update_heartbeat_last_check(&hb.id, &checked_at);
        let _ = db::append_log(
            &hb.agent_id,
            "info",
            &format!("[Heartbeat] {message}"),
            &checked_at,
        );
    }
}


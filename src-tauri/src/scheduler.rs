/// Background scheduler for Personaliz Assistant.
///
/// Reads schedules from SQLite every 60 seconds and triggers due runs
/// via the Python agent engine.
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use chrono::{DateTime, Utc, Duration as ChronoDuration};

use crate::db;

/// Spawn the scheduler loop as a detached Tauri async-runtime task.
pub fn start(agent_engine_path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            run_due_schedules(&agent_engine_path);
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

        // Compute next_run
        let next = compute_next_run(&schedule.frequency, &now);
        let _ = db::update_schedule_run(
            &schedule.id,
            &started_at,
            &next.to_rfc3339(),
        );
    }
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

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod db;
mod scheduler;

use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use uuid::Uuid;

// ============================================================
// Ollama / LLM structs
// ============================================================

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct OllamaResponse {
    message: OllamaMessage,
}

// ============================================================
// Helper: locate agent_engine.py relative to the Tauri binary
// ============================================================

fn agent_engine_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop(); // src-tauri -> project root
    p.push("public");
    p.push("agent_engine.py");
    p
}

fn python_cmd() -> &'static str {
    if cfg!(target_os = "windows") { "python" } else { "python3" }
}

// ============================================================
// Ollama / LLM
// ============================================================

#[tauri::command]
fn check_ollama_status() -> bool {
    std::net::TcpStream::connect("127.0.0.1:11434").is_ok()
}

#[tauri::command]
async fn send_message_to_llm(
    message: String,
    history: Vec<OllamaMessage>,
    model: Option<String>,
) -> Result<String, String> {
    println!("Sending message to Ollama LLM");

    // Default: phi3 (small, offline-friendly)
    let selected_model = model.unwrap_or_else(|| "phi3".to_string());

    let client = reqwest::Client::new();

    let mut messages = vec![OllamaMessage {
        role: "system".to_string(),
        content: "You are Personaliz Desktop Assistant. You help users set up OpenClaw automation \
                  without touching command line. Be concise and helpful.".to_string(),
    }];

    messages.extend(history);
    messages.push(OllamaMessage {
        role: "user".to_string(),
        content: message,
    });

    let request_body = OllamaRequest {
        model: selected_model,
        messages,
        stream: false,
    };

    match client
        .post("http://localhost:11434/api/chat")
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            match response.json::<OllamaResponse>().await {
                Ok(r) => Ok(r.message.content),
                Err(e) => Err(format!("Failed to parse LLM response: {e}")),
            }
        }
        Ok(response) => Err(format!("Ollama returned error: {}", response.status())),
        Err(e) => Err(format!("Failed to connect to Ollama: {e}")),
    }
}

// ============================================================
// Agent execution (Python)
// ============================================================

#[tauri::command]
fn execute_agent(
    agent_id: String,
    agent_name: String,
    role: String,
    goal: String,
    tools: Vec<String>,
    sandbox: bool,
) -> Result<String, String> {
    println!("Executing agent: {} ({})", agent_id, agent_name);

    let agent_path = agent_engine_path();
    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let mode = if sandbox { "sandbox" } else { "prod" };
    let tools_str = tools.join(",");

    let output = Command::new(python_cmd())
        .arg(&agent_path)
        .arg(&agent_id)
        .arg(&agent_name)
        .arg(&role)
        .arg(&goal)
        .arg(&tools_str)
        .arg(mode)
        .output()
        .map_err(|e| format!("Failed to execute agent: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "Agent execution failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[tauri::command]
fn run_python_agent(
    agent_id: String,
    agent_name: String,
    sandbox: bool,
) -> Result<serde_json::Value, String> {
    println!("Running Python agent: {} (sandbox: {})", agent_name, sandbox);

    let agent_path = agent_engine_path();
    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let sandbox_arg = if sandbox { "sandbox" } else { "live" };

    let output = Command::new(python_cmd())
        .arg(&agent_path)
        .arg(&agent_id)
        .arg(sandbox_arg)
        .output()
        .map_err(|e| format!("Failed to execute Python agent: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(json) => Ok(json),
            Err(_) => Ok(serde_json::json!({
                "status": "success",
                "message": stdout.to_string(),
                "logs": []
            })),
        }
    } else {
        Err(format!(
            "Python agent failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

// ============================================================
// LinkedIn commands (new CLI contract)
// ============================================================

/// Post approved content to LinkedIn.
/// Calls: python agent_engine.py linkedin_post --content <…> --sandbox <true|false>
#[tauri::command]
fn post_to_linkedin(content: String, sandbox: bool) -> Result<String, String> {
    println!("Posting to LinkedIn (sandbox: {})", sandbox);

    let agent_path = agent_engine_path();
    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let sandbox_flag = if sandbox { "true" } else { "false" };

    let output = Command::new(python_cmd())
        .arg(&agent_path)
        .arg("linkedin_post")
        .arg("--content")
        .arg(&content)
        .arg("--sandbox")
        .arg(sandbox_flag)
        .output()
        .map_err(|e| format!("Failed to post to LinkedIn: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "LinkedIn post failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Comment on posts tagged with a LinkedIn hashtag.
/// Calls: python agent_engine.py linkedin_comment_hashtag --hashtag <…> --comment <…> --sandbox <…>
#[tauri::command]
fn comment_linkedin_hashtag(
    hashtag: String,
    comment: String,
    sandbox: bool,
) -> Result<serde_json::Value, String> {
    println!("Commenting on #{} (sandbox: {})", hashtag, sandbox);

    let agent_path = agent_engine_path();
    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let sandbox_flag = if sandbox { "true" } else { "false" };

    let output = Command::new(python_cmd())
        .arg(&agent_path)
        .arg("linkedin_comment_hashtag")
        .arg("--hashtag")
        .arg(&hashtag)
        .arg("--comment")
        .arg(&comment)
        .arg("--sandbox")
        .arg(sandbox_flag)
        .output()
        .map_err(|e| format!("Failed to run hashtag agent: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str::<serde_json::Value>(&stdout).map_err(|e| {
            format!("Failed to parse hashtag agent output: {e}\nOutput: {stdout}")
        })
    } else {
        Err(format!(
            "Hashtag comment agent failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

// ============================================================
// OpenClaw
// ============================================================

#[tauri::command]
fn check_openclaw_installed() -> bool {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    Command::new(cmd)
        .arg("openclaw")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn install_openclaw() -> Result<String, String> {
    println!("Installing OpenClaw via npm...");

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "npm install -g openclaw"])
            .output()
    } else {
        Command::new("sh")
            .args(["-c", "npm install -g openclaw"])
            .output()
    };

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();
            if result.status.success() {
                println!("OpenClaw installed successfully");
                Ok(format!("OK: OpenClaw installed.\n{stdout}"))
            } else {
                Err(format!(
                    "npm install failed. Make sure Node.js is installed.\n{stderr}"
                ))
            }
        }
        Err(e) => Err(format!(
            "Failed to run npm: {e}. Please install Node.js first."
        )),
    }
}

#[tauri::command]
fn run_openclaw_command(command: String) -> Result<String, String> {
    println!("Running OpenClaw command: {}", command);

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .output()
    } else {
        Command::new("sh")
            .args(["-c", &command])
            .output()
    };

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(String::from_utf8_lossy(&result.stdout).to_string())
            } else {
                Err(format!(
                    "Command failed: {}",
                    String::from_utf8_lossy(&result.stderr)
                ))
            }
        }
        Err(e) => Err(format!("Failed to execute command: {e}")),
    }
}

// ============================================================
// Python availability
// ============================================================

#[tauri::command]
fn check_python_available() -> bool {
    Command::new(python_cmd())
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ============================================================
// DB – Agents
// ============================================================

#[tauri::command]
fn db_upsert_agent(
    id: String,
    name: String,
    role: String,
    goal: String,
    tools: String,
    status: String,
) -> Result<(), String> {
    let row = db::AgentRow {
        id,
        name,
        role,
        goal,
        tools,
        status,
        created_at: Utc::now().to_rfc3339(),
    };
    db::upsert_agent(&row).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_agents() -> Result<Vec<db::AgentRow>, String> {
    db::list_agents().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_agent(id: String) -> Result<(), String> {
    db::delete_agent(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_agent_status(id: String, status: String) -> Result<(), String> {
    db::update_agent_status(&id, &status).map_err(|e| e.to_string())
}

// ============================================================
// DB – Schedules
// ============================================================

#[tauri::command]
fn db_upsert_schedule(
    agent_id: String,
    frequency: String,
    enabled: bool,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let next_run = scheduler::compute_next_run(&frequency, &now);
    let row = db::ScheduleRow {
        id: id.clone(),
        agent_id,
        frequency,
        enabled,
        last_run: None,
        next_run: next_run.to_rfc3339(),
        created_at: now.to_rfc3339(),
    };
    db::upsert_schedule(&row).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn db_list_schedules() -> Result<Vec<db::ScheduleRow>, String> {
    db::list_schedules().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_schedule(id: String) -> Result<(), String> {
    db::delete_schedule(&id).map_err(|e| e.to_string())
}

// ============================================================
// DB – Logs
// ============================================================

#[tauri::command]
fn db_append_log(
    agent_id: String,
    level: String,
    message: String,
) -> Result<i64, String> {
    let ts = Utc::now().to_rfc3339();
    db::append_log(&agent_id, &level, &message, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_logs(agent_id: Option<String>, limit: Option<usize>) -> Result<Vec<db::LogRow>, String> {
    db::get_logs(agent_id.as_deref(), limit.unwrap_or(200))
        .map_err(|e| e.to_string())
}

// ============================================================
// DB – Run history
// ============================================================

#[tauri::command]
fn db_get_run_history(
    agent_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<db::RunHistoryRow>, String> {
    db::get_run_history(agent_id.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

// ============================================================
// main
// ============================================================

fn main() {
    // Initialise SQLite (creates tables if needed)
    db::init();

    // Build path to agent_engine.py for the scheduler
    let engine_path = agent_engine_path();

    tauri::Builder::default()
        .setup(move |_app| {
            // Start background scheduler
            scheduler::start(engine_path.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // LLM
            check_ollama_status,
            send_message_to_llm,
            // Agent execution
            execute_agent,
            run_python_agent,
            // LinkedIn
            post_to_linkedin,
            comment_linkedin_hashtag,
            // OpenClaw
            check_openclaw_installed,
            install_openclaw,
            run_openclaw_command,
            // Python check
            check_python_available,
            // DB – agents
            db_upsert_agent,
            db_list_agents,
            db_delete_agent,
            db_update_agent_status,
            // DB – schedules
            db_upsert_schedule,
            db_list_schedules,
            db_delete_schedule,
            // DB – logs
            db_append_log,
            db_get_logs,
            // DB – run history
            db_get_run_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

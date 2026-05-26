#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod db;
mod scheduler;

use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, protocol::Message},
};
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

#[derive(Serialize, Deserialize, Debug)]
struct RemoteAgent {
    id: String,
    name: String,
    #[serde(default)]
    agentType: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct RemoteTaskPayload {
    agent: RemoteAgent,
    #[serde(default)]
    sandbox: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug)]
struct RemoteTask {
    id: String,
    action: String,
    payload: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
struct RemoteEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    task: Option<RemoteTask>,
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
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

// ============================================================
// LLM Usage logging
// ============================================================

#[tauri::command]
fn db_record_llm_usage(provider: String, model: String, context: String) -> Result<(), String> {
    let ts = Utc::now().to_rfc3339();
    db::record_llm_usage(&provider, &model, &context, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_llm_usage(limit: Option<usize>) -> Result<Vec<db::LlmUsageRow>, String> {
    db::get_llm_usage(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// ============================================================
// External LLM (OpenAI / Anthropic) – async HTTP via reqwest
// ============================================================

#[derive(Deserialize)]
struct ExternalLlmRequest {
    message: String,
    history: Vec<OllamaMessage>,
    api_key: String,
    model: String,
    context: Option<String>,
}

#[tauri::command]
async fn send_message_to_external_llm(req: ExternalLlmRequest) -> Result<String, String> {
    println!("Sending message to external LLM model: {}", req.model);

    let client = reqwest::Client::new();
    let system_prompt = "You are Personaliz Desktop Assistant. You help users set up OpenClaw \
                         automation without touching command line. Be concise and helpful.";

    let mut history = req.history;
    history.push(OllamaMessage {
        role: "user".to_string(),
        content: req.message.clone(),
    });

    let is_google = req.model.starts_with("gemini") || req.model.starts_with("gemma");
    let response_text = if req.model.contains("claude") {
        // Anthropic Claude API
        let messages: Vec<serde_json::Value> = history
            .iter()
            .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
            .collect();

        let body = serde_json::json!({
            "model": req.model,
            "max_tokens": 500,
            "system": system_prompt,
            "messages": messages,
        });

        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("Content-Type", "application/json")
            .header("x-api-key", &req.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Anthropic API error: {}. Make sure you are using an Anthropic key (sk-ant-…).",
                resp.status()
            ));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;
        data["content"][0]["text"]
            .as_str()
            .unwrap_or("No response.")
            .to_string()
    } else if is_google {
        // Google Generative Language API (Gemini / Gemma)
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            req.model, req.api_key
        );

        // Build conversation contents; Gemini uses "user"/"model" roles
        let contents: Vec<serde_json::Value> = history
            .iter()
            .map(|m| {
                let role = if m.role == "assistant" {
                    "model"
                } else {
                    "user"
                };
                serde_json::json!({
                    "role": role,
                    "parts": [{"text": m.content}]
                })
            })
            .collect();

        let body = serde_json::json!({
            "contents": contents,
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "generationConfig": {
                "maxOutputTokens": 500,
                "temperature": 0.7
            }
        });

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Google AI request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let hint = if status.as_u16() == 400 {
                " — Check that the model name is correct (e.g. gemini-2.0-flash, gemma-2-2b-it)."
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                " — Your Google AI Studio key (AIzaSy…) may be invalid or restricted."
            } else {
                ""
            };
            return Err(format!("Google AI API error: {}{}", status, hint));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Google AI response: {e}"))?;
        data["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("No response.")
            .to_string()
    } else {
        // OpenAI-compatible API
        let messages: Vec<serde_json::Value> =
            std::iter::once(serde_json::json!({"role": "system", "content": system_prompt}))
                .chain(
                    history
                        .iter()
                        .map(|m| serde_json::json!({"role": m.role, "content": m.content})),
                )
                .collect();

        let body = serde_json::json!({
            "model": req.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 500,
        });

        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", req.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let hint = if status.as_u16() == 401 {
                " — Make sure you are using an OpenAI key (sk-…). If you want to use Google Gemini, select a Gemini model and enter your Google AI Studio key (AIzaSy…)."
            } else {
                ""
            };
            return Err(format!("OpenAI API error: {}{}", status, hint));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse OpenAI response: {e}"))?;
        data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("No response.")
            .to_string()
    };

    // Log LLM usage to SQLite
    let provider = if req.model.contains("claude") {
        "anthropic"
    } else if is_google {
        "google"
    } else {
        "openai"
    };
    let ctx = req.context.unwrap_or_default();
    let _ = db::record_llm_usage(provider, &req.model, &ctx, &Utc::now().to_rfc3339());

    Ok(response_text)
}

// ============================================================
// OpenClaw dependency checks (OS-aware)
// ============================================================

#[tauri::command]
fn check_node_available() -> bool {
    Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn check_playwright_available() -> bool {
    Command::new(python_cmd())
        .args(["-c", "import playwright; print('ok')"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn get_os_info() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
    })
}

/// Check if Ollama is listening on port 11434 (500 ms timeout).
#[tauri::command]
fn check_ollama_status() -> bool {
    use std::net::ToSocketAddrs;
    use std::time::Duration;
    "127.0.0.1:11434"
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .and_then(|addr| {
            std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()
        })
        .is_some()
}

#[tauri::command]
async fn send_message_to_llm(
    message: String,
    history: Vec<OllamaMessage>,
    model: Option<String>,
    context: Option<String>,
) -> Result<String, String> {
    println!("Sending message to local LLM");

    // Default: llama3 (recommended local model – pull with: ollama pull llama3)
    let selected_model = model.unwrap_or_else(|| "llama3".to_string());

    let client = reqwest::Client::new();
    let system_content =
        "You are Personaliz Desktop Assistant. You help users set up OpenClaw automation \
                  without touching command line. Be concise and helpful.";

    let mut messages = vec![OllamaMessage {
        role: "system".to_string(),
        content: system_content.to_string(),
    }];

    messages.extend(history);
    messages.push(OllamaMessage {
        role: "user".to_string(),
        content: message,
    });

    // Try Ollama first (port 11434), then fall back to llama.cpp-server (port 8080)
    use std::net::ToSocketAddrs;
    use std::time::Duration;
    let tcp_check = |addr: &str| -> bool {
        addr.to_socket_addrs()
            .ok()
            .and_then(|mut a| a.next())
            .and_then(|a| std::net::TcpStream::connect_timeout(&a, Duration::from_millis(500)).ok())
            .is_some()
    };
    let ollama_available = tcp_check("127.0.0.1:11434");
    let llamacpp_available = tcp_check("127.0.0.1:8080");

    if !ollama_available && !llamacpp_available {
        return Err(
            "No local LLM found. Start Ollama (ollama serve) or llama-server on port 8080."
                .to_string(),
        );
    }

    let ctx = context.unwrap_or_default();

    if ollama_available {
        let request_body = OllamaRequest {
            model: selected_model.clone(),
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
                    Ok(r) => {
                        let _ = db::record_llm_usage(
                            "ollama",
                            &selected_model,
                            &ctx,
                            &Utc::now().to_rfc3339(),
                        );
                        return Ok(r.message.content);
                    }
                    Err(e) => return Err(format!("Failed to parse Ollama response: {e}")),
                }
            }
            Ok(response) => return Err(format!("Ollama returned error: {}", response.status())),
            Err(e) => return Err(format!("Failed to connect to Ollama: {e}")),
        }
    }

    // Fallback: llama.cpp server (OpenAI-compatible API on port 8080)
    let oai_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let body = serde_json::json!({
        "model": selected_model,
        "messages": oai_messages,
        "temperature": 0.7,
        "max_tokens": 500,
    });

    let resp = client
        .post("http://localhost:8080/v1/chat/completions")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to llama.cpp server: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "llama.cpp server returned error: {}",
            resp.status()
        ));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse llama.cpp response: {e}"))?;
    let reply = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("No response.")
        .to_string();

    let _ = db::record_llm_usage("llamacpp", &selected_model, &ctx, &Utc::now().to_rfc3339());
    Ok(reply)
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
    println!(
        "Running Python agent: {} (sandbox: {})",
        agent_name, sandbox
    );

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
        serde_json::from_str::<serde_json::Value>(&stdout)
            .map_err(|e| format!("Failed to parse hashtag agent output: {e}\nOutput: {stdout}"))
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
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
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

// ============================================================
// OpenClaw – run an agent via its config file
// ============================================================

/// Run an OpenClaw agent by invoking `openclaw run <config_path>`.
/// Captures stdout/stderr and stores them in the `openclaw_runs` table.
/// Returns a JSON object with status, stdout, stderr.
#[tauri::command]
fn run_openclaw_agent(agent_id: String, config_path: String) -> Result<serde_json::Value, String> {
    let started_at = Utc::now().to_rfc3339();
    let command_str = format!("openclaw run \"{}\"", config_path);

    println!("[openclaw] Running: {command_str}");

    if !check_openclaw_installed() {
        let finished_at = Utc::now().to_rfc3339();
        let stderr = "OpenClaw is not installed. Run npm install -g openclaw.";
        let _ = db::record_openclaw_run(
            &agent_id,
            &config_path,
            &command_str,
            "",
            stderr,
            None,
            &started_at,
            &finished_at,
        );
        let _ = db::append_log(
            &agent_id,
            "warning",
            &format!("[openclaw] {stderr}"),
            &finished_at,
        );
        return Ok(serde_json::json!({
            "status": "skipped",
            "reason": "openclaw_missing",
            "stdout": "",
            "stderr": stderr,
            "exit_code": null,
            "started_at": started_at,
            "finished_at": finished_at,
        }));
    }

    let output = Command::new("openclaw")
        .arg("run")
        .arg(&config_path)
        .output();

    let finished_at = Utc::now().to_rfc3339();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();
            let exit_code = result.status.code();
            let success = result.status.success();

            // Store run record in DB
            let _ = db::record_openclaw_run(
                &agent_id,
                &config_path,
                &command_str,
                &stdout,
                &stderr,
                exit_code,
                &started_at,
                &finished_at,
            );

            // Also append to logs table
            let level = if success { "success" } else { "error" };
            let log_msg = if success {
                format!(
                    "[openclaw] run succeeded: {}",
                    stdout.lines().next().unwrap_or("ok")
                )
            } else {
                format!(
                    "[openclaw] run failed (exit {:?}): {}",
                    exit_code,
                    stderr.lines().next().unwrap_or("")
                )
            };
            let _ = db::append_log(&agent_id, level, &log_msg, &finished_at);

            Ok(serde_json::json!({
                "status": if success { "success" } else { "error" },
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": exit_code,
                "started_at": started_at,
                "finished_at": finished_at,
            }))
        }
        Err(e) => {
            let stderr = format!("Failed to run openclaw: {e}. Make sure openclaw is installed (npm install -g openclaw).");
            let _ = db::record_openclaw_run(
                &agent_id,
                &config_path,
                &command_str,
                "",
                &stderr,
                Some(-1),
                &started_at,
                &finished_at,
            );
            let _ = db::append_log(
                &agent_id,
                "error",
                &format!("[openclaw] {stderr}"),
                &finished_at,
            );
            Err(stderr)
        }
    }
}

/// Retrieve openclaw run records from the DB.
#[tauri::command]
fn db_get_openclaw_runs(
    agent_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<db::OpenClawRunRow>, String> {
    db::get_openclaw_runs(agent_id.as_deref(), limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// ============================================================
// Dependency checks
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
    cron_expression: Option<String>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let next_run =
        scheduler::compute_next_run_from_schedule(&frequency, cron_expression.as_deref(), &now);
    let row = db::ScheduleRow {
        id: id.clone(),
        agent_id,
        frequency,
        cron_expression,
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
fn db_append_log(agent_id: String, level: String, message: String) -> Result<i64, String> {
    let ts = Utc::now().to_rfc3339();
    db::append_log(&agent_id, &level, &message, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_logs(agent_id: Option<String>, limit: Option<usize>) -> Result<Vec<db::LogRow>, String> {
    db::get_logs(agent_id.as_deref(), limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_clear_logs(agent_id: Option<String>) -> Result<(), String> {
    db::clear_logs(agent_id.as_deref()).map_err(|e| e.to_string())
}

// ============================================================
// DB – Run history
// ============================================================

#[tauri::command]
fn db_get_run_history(
    agent_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<db::RunHistoryRow>, String> {
    db::get_run_history(agent_id.as_deref(), limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// ============================================================
// DB – Approvals (audit log for human-in-the-loop decisions)
// ============================================================

#[tauri::command]
fn db_record_approval(
    agent_id: String,
    content_preview: String,
    outcome: String,
    notes: Option<String>,
) -> Result<i64, String> {
    let decided_at = Utc::now().to_rfc3339();
    db::record_approval(
        &agent_id,
        &content_preview,
        &outcome,
        &decided_at,
        notes.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_approvals(
    agent_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<db::ApprovalRow>, String> {
    db::list_approvals(agent_id.as_deref(), limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// ============================================================
// Cron expression validation helper
// ============================================================

/// Validate a 5-field cron expression and return the next run time as RFC-3339.
#[tauri::command]
fn validate_cron_expression(cron: String) -> Result<String, String> {
    let now = Utc::now();
    match scheduler::next_cron_time(&cron, &now) {
        Some(next) => Ok(next.to_rfc3339()),
        None => Err(format!(
            "Invalid cron expression: '{cron}'. Expected 5 fields: minute hour day month weekday"
        )),
    }
}

// ============================================================
// llama.cpp server detection
// ============================================================

/// Check if a llama.cpp server (or any OpenAI-compatible local server) is
/// listening on port 8080 (the default for llama-server). Uses a 500 ms timeout.
#[tauri::command]
fn check_llamacpp_status() -> bool {
    use std::net::ToSocketAddrs;
    use std::time::Duration;
    "127.0.0.1:8080"
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .and_then(|addr| {
            std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()
        })
        .is_some()
}

// ============================================================
// OpenClaw – config file generation
// ============================================================

/// Generate an OpenClaw agent config file at the given path.
/// Returns the absolute path of the written file.
#[tauri::command]
fn create_openclaw_config(
    agent_id: String,
    agent_name: String,
    role: String,
    goal: String,
    tools: Vec<String>,
    schedule: String,
    output_dir: Option<String>,
) -> Result<String, String> {
    use std::fs;

    let dir_path = match output_dir {
        Some(d) => std::path::PathBuf::from(d),
        None => {
            // Default: ~/.local/share/personaliz-assistant/agents/<agent_id>/
            let mut p = dirs_or_home();
            p.push("agents");
            p.push(&agent_id);
            p
        }
    };

    fs::create_dir_all(&dir_path).map_err(|e| format!("Cannot create config directory: {e}"))?;

    let config = serde_json::json!({
        "id": agent_id,
        "name": agent_name,
        "role": role,
        "goal": goal,
        "tools": tools,
        "schedule": schedule,
        "version": "1",
        "created_at": Utc::now().to_rfc3339(),
    });

    let config_path = dir_path.join("openclaw.config.json");
    fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| format!("Cannot write config file: {e}"))?;

    Ok(config_path.to_string_lossy().to_string())
}

fn dirs_or_home() -> std::path::PathBuf {
    // ~/.local/share/personaliz-assistant on Linux/macOS, %APPDATA% on Windows
    if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("personaliz-assistant")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("personaliz-assistant")
    }
}

fn to_ws_url(broker_url: &str) -> String {
    if broker_url.starts_with("https://") {
        broker_url.replacen("https://", "wss://", 1)
    } else if broker_url.starts_with("http://") {
        broker_url.replacen("http://", "ws://", 1)
    } else {
        broker_url.to_string()
    }
}

fn next_reconnect_delay_secs(current: u64) -> u64 {
    match current {
        0 | 1 => 2,
        2 => 5,
        5 => 10,
        _ => 10,
    }
}

fn run_remote_task(task: RemoteTask) -> Result<serde_json::Value, String> {
    if task.action != "run_agent" {
        return Err(format!("Unsupported task action: {}", task.action));
    }

    let payload: RemoteTaskPayload =
        serde_json::from_value(task.payload).map_err(|e| format!("Invalid task payload: {e}"))?;
    let sandbox = payload.sandbox.unwrap_or(true);
    let agent_id = payload.agent.id.clone();

    if payload.agent.agentType.as_deref() == Some("hashtag") {
        let default_comment = "🎯 Check out Personaliz – it makes OpenClaw automation accessible to everyone, no coding needed! https://github.com/goldDgokul/personaliz-ai-assistant #OpenClaw #Automation".to_string();
        let hashtag = comment_linkedin_hashtag("openclaw".to_string(), default_comment, sandbox)?;
        Ok(serde_json::json!({
            "agent_id": agent_id,
            "status": "success",
            "result": hashtag,
        }))
    } else {
        let py = run_python_agent(
            payload.agent.id.clone(),
            payload.agent.name.clone(),
            sandbox,
        )?;
        if py.get("status").and_then(|v| v.as_str()) == Some("error") {
            return Err(py
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Remote python agent failed")
                .to_string());
        }
        Ok(serde_json::json!({
            "agent_id": agent_id,
            "status": py.get("status").cloned().unwrap_or(serde_json::json!("success")),
            "result": py,
        }))
    }
}

async fn send_ws_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: serde_json::Value,
) -> Result<(), String> {
    ws.send(Message::Text(value.to_string()))
        .await
        .map_err(|e| format!("WS send failed: {e}"))
}

fn start_agent_connector() {
    let broker_url = std::env::var("BROKER_URL").ok();
    let agent_token = std::env::var("AGENT_TOKEN").ok();
    if broker_url.as_deref().unwrap_or("").trim().is_empty()
        || agent_token.as_deref().unwrap_or("").trim().is_empty()
    {
        println!("[broker] BROKER_URL or AGENT_TOKEN missing; remote connector disabled");
        return;
    }

    let broker_url = broker_url.unwrap();
    let agent_token = agent_token.unwrap();
    let device_id = std::env::var("DEVICE_ID").unwrap_or_else(|_| "gokul-pc".to_string());

    tauri::async_runtime::spawn(async move {
        let mut reconnect_delay_secs = 1_u64;
        loop {
            let base_ws = to_ws_url(&broker_url);
            let full_url = format!(
                "{}/ws/agent?device_id={}",
                base_ws.trim_end_matches('/'),
                device_id
            );

            let mut request = match full_url.clone().into_client_request() {
                Ok(r) => r,
                Err(e) => {
                    println!(
                        "[broker] WS connect failed ({e}); retrying in {}s",
                        reconnect_delay_secs
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay_secs)).await;
                    reconnect_delay_secs = next_reconnect_delay_secs(reconnect_delay_secs);
                    continue;
                }
            };

            let token_value = match HeaderValue::from_str(&agent_token) {
                Ok(v) => v,
                Err(e) => {
                    println!(
                        "[broker] WS connect failed (invalid AGENT_TOKEN header: {e}); retrying in {}s",
                        reconnect_delay_secs
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay_secs)).await;
                    reconnect_delay_secs = next_reconnect_delay_secs(reconnect_delay_secs);
                    continue;
                }
            };
            request.headers_mut().insert("X-AGENT-TOKEN", token_value);

            let (mut ws, _) = match connect_async(request).await {
                Ok(tuple) => tuple,
                Err(e) => {
                    println!(
                        "[broker] WS connect failed ({e}); retrying in {}s",
                        reconnect_delay_secs
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay_secs)).await;
                    reconnect_delay_secs = next_reconnect_delay_secs(reconnect_delay_secs);
                    continue;
                }
            };

            reconnect_delay_secs = 1;
            println!("[broker] Connected as {}", device_id);
            let _ = send_ws_json(
                &mut ws,
                serde_json::json!({"type":"agent.register","device_id":device_id}),
            )
            .await;

            let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(20));

            loop {
                tokio::select! {
                    _ = heartbeat.tick() => {
                        if send_ws_json(&mut ws, serde_json::json!({"type":"heartbeat"})).await.is_err() {
                            break;
                        }
                    }
                    incoming = ws.next() => {
                        match incoming {
                            Some(Ok(Message::Text(text))) => {
                                let parsed = serde_json::from_str::<RemoteEnvelope>(&text);
                                if let Ok(envelope) = parsed {
                                    if envelope.message_type == "task.created" {
                                        if let Some(task) = envelope.task {
                                            let task_id = task.id.clone();
                                            let _ = send_ws_json(&mut ws, serde_json::json!({
                                                "type":"task.start",
                                                "task_id": task_id,
                                            })).await;

                                            let action_name = task.action.clone();
                                            let run = tokio::task::spawn_blocking(move || run_remote_task(task)).await;
                                            match run {
                                                Ok(Ok(result)) => {
                                                    if let Some(logs) = result.get("result").and_then(|r| r.get("logs")).and_then(|l| l.as_array()) {
                                                        for entry in logs {
                                                            let level = entry.get("level").and_then(|v| v.as_str()).unwrap_or("info");
                                                            let message = entry.get("message").and_then(|v| v.as_str()).unwrap_or("log");
                                                            let _ = send_ws_json(&mut ws, serde_json::json!({
                                                                "type":"task.log",
                                                                "task_id": task_id,
                                                                "level": level,
                                                                "message": message,
                                                            })).await;
                                                        }
                                                    }
                                                    let _ = send_ws_json(&mut ws, serde_json::json!({
                                                        "type":"task.log",
                                                        "task_id": task_id,
                                                        "level":"info",
                                                        "message": format!("Completed action {}", action_name),
                                                        "result": result.clone(),
                                                    })).await;
                                                    let _ = send_ws_json(&mut ws, serde_json::json!({
                                                        "type":"task.done",
                                                        "task_id": task_id,
                                                        "success": true,
                                                        "result": result,
                                                    })).await;
                                                }
                                                Ok(Err(err)) => {
                                                    let _ = send_ws_json(&mut ws, serde_json::json!({
                                                        "type":"task.done",
                                                        "task_id": task_id,
                                                        "success": false,
                                                        "error": err,
                                                    })).await;
                                                }
                                                Err(err) => {
                                                    let _ = send_ws_json(&mut ws, serde_json::json!({
                                                        "type":"task.done",
                                                        "task_id": task_id,
                                                        "success": false,
                                                        "error": format!("Task thread failed: {}", err),
                                                    })).await;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        }
                    }
                }
            }

            println!(
                "[broker] Disconnected; retrying in {}s",
                reconnect_delay_secs
            );
            tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay_secs)).await;
            reconnect_delay_secs = next_reconnect_delay_secs(reconnect_delay_secs);
        }
    });
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
            // Optional remote broker connector (disabled unless env vars are set)
            start_agent_connector();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // LLM – local
            check_ollama_status,
            send_message_to_llm,
            // LLM – external (OpenAI / Anthropic)
            send_message_to_external_llm,
            // LLM usage log
            db_record_llm_usage,
            db_get_llm_usage,
            // Agent execution
            execute_agent,
            run_python_agent,
            // LinkedIn
            post_to_linkedin,
            comment_linkedin_hashtag,
            // OpenClaw
            check_openclaw_installed,
            install_openclaw,
            // Python / Node / Playwright checks
            check_python_available,
            check_node_available,
            check_playwright_available,
            get_os_info,
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
            db_clear_logs,
            // DB – run history
            db_get_run_history,
            // DB – approvals
            db_record_approval,
            db_list_approvals,
            // Cron
            validate_cron_expression,
            // llama.cpp
            check_llamacpp_status,
            // OpenClaw config
            create_openclaw_config,
            // OpenClaw agent runner + run log
            run_openclaw_agent,
            db_get_openclaw_runs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

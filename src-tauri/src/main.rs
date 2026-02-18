#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::process::Command;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

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

// ========== EXISTING COMMANDS (Kept) ==========

#[tauri::command]
fn check_ollama_status() -> bool {
    match std::net::TcpStream::connect("127.0.0.1:11434") {
        Ok(_) => {
            println!("Ollama is running on localhost:11434");
            true
        },
        Err(_) => {
            println!("Ollama is not running on localhost:11434");
            false
        }
    }
}

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

    // Get correct path to agent_engine.py (go UP from src-tauri to project root)
    let mut agent_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    agent_path.pop(); // Go up from src-tauri
    agent_path.push("public");
    agent_path.push("agent_engine.py");

    println!("Looking for agent_engine.py at: {:?}", agent_path);

    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let mode = if sandbox { "sandbox" } else { "prod" };
    let tools_str = tools.join(",");

    let output = Command::new("python")
        .arg(agent_path)
        .arg(&agent_id)
        .arg(&agent_name)
        .arg(&role)
        .arg(&goal)
        .arg(&tools_str)
        .arg(mode)
        .output()
        .map_err(|e| {
            let err_msg = format!("Failed to execute agent: {}", e.to_string());
            println!("{}", err_msg);
            err_msg
        })?;

    let result = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        println!("Agent execution successful");
        Ok(result.trim().to_string())
    } else {
        let err_msg = format!("Agent execution failed: {}", stderr);
        println!("{}", err_msg);
        Err(err_msg)
    }
}

#[tauri::command]
fn post_to_linkedin(content: String, sandbox: bool) -> Result<String, String> {
    println!("Posting to LinkedIn (sandbox: {})", sandbox);

    // Get correct path
    let mut agent_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    agent_path.pop();
    agent_path.push("public");
    agent_path.push("agent_engine.py");

    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let mode = if sandbox { "sandbox" } else { "prod" };

    let output = Command::new("python")
        .arg(agent_path)
        .arg("linkedin_post")
        .arg(&content)
        .arg(mode)
        .output()
        .map_err(|e| {
            let err_msg = format!("Failed to post to LinkedIn: {}", e.to_string());
            println!("{}", err_msg);
            err_msg
        })?;

    let result = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        println!("LinkedIn post successful");
        Ok(result.trim().to_string())
    } else {
        let err_msg = format!("LinkedIn post failed: {}", stderr);
        println!("{}", err_msg);
        Err(err_msg)
    }
}

#[tauri::command]
fn check_openclaw_installed() -> bool {
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    match Command::new(cmd)
        .arg("openclaw")
        .output()
    {
        Ok(output) => {
            let is_installed = output.status.success();
            if is_installed {
                println!("OpenClaw is installed");
            } else {
                println!("OpenClaw is not installed");
            }
            is_installed
        },
        Err(e) => {
            println!("Failed to check OpenClaw installation: {}", e);
            false
        }
    }
}

// ========== NEW COMMANDS (Added) ==========

#[tauri::command]
fn check_python_available() -> bool {
    let output = if cfg!(target_os = "windows") {
        Command::new("python")
            .arg("--version")
            .output()
    } else {
        Command::new("python3")
            .arg("--version")
            .output()
    };

    match output {
        Ok(result) => {
            let is_available = result.status.success();
            if is_available {
                println!("Python is available");
            } else {
                println!("Python is not available");
            }
            is_available
        },
        Err(e) => {
            println!("Python check failed: {}", e);
            false
        }
    }
}

#[tauri::command]
fn run_python_agent(agent_id: String, agent_name: String, sandbox: bool) -> Result<serde_json::Value, String> {
    println!("Running Python agent: {} (sandbox: {})", agent_name, sandbox);

    // Get correct path
    let mut agent_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    agent_path.pop(); // Go up from src-tauri to project root
    agent_path.push("public");
    agent_path.push("agent_engine.py");

    println!("Looking for agent_engine.py at: {:?}", agent_path);

    if !agent_path.exists() {
        return Err(format!("agent_engine.py not found at: {:?}", agent_path));
    }

    let python_cmd = if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    };

    let sandbox_arg = if sandbox { "sandbox" } else { "live" };

    let output = Command::new(python_cmd)
        .arg(agent_path)
        .arg(&agent_id)
        .arg(sandbox_arg)
        .output()
        .map_err(|e| {
            let err_msg = format!("Failed to execute Python agent: {}", e);
            println!("{}", err_msg);
            err_msg
        })?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);

        match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(json) => {
                println!("Python agent executed successfully");
                Ok(json)
            },
            Err(_) => {
                println!("Python agent output (non-JSON): {}", stdout);
                Ok(serde_json::json!({
                    "status": "success",
                    "message": stdout.to_string(),
                    "logs": []
                }))
            }
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let err_msg = format!("Python agent failed: {}", stderr);
        println!("{}", err_msg);
        Err(err_msg)
    }
}

#[tauri::command]
fn install_openclaw() -> String {
    let instructions = if cfg!(target_os = "windows") {
        "To install OpenClaw on Windows:\n\
         1. Download from: https://github.com/openclaw/openclaw\n\
         2. Run: npm install -g openclaw\n\
         3. Or follow installation instructions in the repository"
    } else if cfg!(target_os = "macos") {
        "To install OpenClaw on macOS:\n\
         1. Run: brew install openclaw\n\
         2. Or: npm install -g openclaw"
    } else {
        "To install OpenClaw on Linux:\n\
         1. Run: npm install -g openclaw\n\
         2. Or follow installation instructions"
    };

    println!("Install instructions requested");
    instructions.to_string()
}

#[tauri::command]
fn run_openclaw_command(command: String) -> Result<String, String> {
    println!("Running OpenClaw command: {}", command);

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(&["/C", &command])
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&command)
            .output()
    };

    match output {
        Ok(result) => {
            if result.status.success() {
                let stdout = String::from_utf8_lossy(&result.stdout).to_string();
                println!("Command executed successfully");
                Ok(stdout)
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                let err_msg = format!("Command failed: {}", stderr);
                println!("{}", err_msg);
                Err(err_msg)
            }
        }
        Err(e) => {
            let err_msg = format!("Failed to execute command: {}", e);
            println!("{}", err_msg);
            Err(err_msg)
        }
    }
}

#[tauri::command]
async fn send_message_to_llm(message: String, history: Vec<OllamaMessage>) -> Result<String, String> {
    println!("Sending message to Ollama LLM");

    let client = reqwest::Client::new();

    let mut messages = vec![
        OllamaMessage {
            role: "system".to_string(),
            content: "You are Personaliz Desktop Assistant. You help users set up OpenClaw automation without touching command line. Be concise and helpful.".to_string(),
        }
    ];

    messages.extend(history);
    messages.push(OllamaMessage {
        role: "user".to_string(),
        content: message,
    });

    let request_body = OllamaRequest {
        model: "llama3:8b".to_string(),
        messages,
        stream: false,
    };

    match client
        .post("http://localhost:11434/api/chat")
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<OllamaResponse>().await {
                    Ok(ollama_response) => {
                        println!("LLM response received");
                        Ok(ollama_response.message.content)
                    },
                    Err(e) => {
                        let err_msg = format!("Failed to parse LLM response: {}", e);
                        println!("{}", err_msg);
                        Err(err_msg)
                    }
                }
            } else {
                let err_msg = format!("Ollama returned error: {}", response.status());
                println!("{}", err_msg);
                Err(err_msg)
            }
        }
        Err(e) => {
            let err_msg = format!("Failed to connect to Ollama: {}", e);
            println!("{}", err_msg);
            Err(err_msg)
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // Existing commands
            check_ollama_status,
            execute_agent,
            post_to_linkedin,
            check_openclaw_installed,
            // New commands
            check_python_available,
            run_python_agent,
            install_openclaw,
            run_openclaw_command,
            send_message_to_llm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
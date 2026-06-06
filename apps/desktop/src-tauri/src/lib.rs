use tauri::{
    command,
    Manager,
    Emitter,
};
use std::process::{Command, Child};
use std::sync::Mutex;

struct BridgeState {
    child: Option<Child>,
}

impl BridgeState {
    fn new() -> Self {
        Self { child: None }
    }
}

#[command]
async fn spawn_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<BridgeState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if guard.child.is_some() {
        return Ok("bridge already running".into());
    }

    // Try to find the live-bridge directory relative to the app
    let bridge_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("apps")
        .join("live-bridge");

    if !bridge_dir.exists() {
        return Err(format!("live-bridge directory not found: {:?}", bridge_dir));
    }

    let child = Command::new("node")
        .arg("dist/index.js")
        .current_dir(&bridge_dir)
        .spawn()
        .map_err(|e| format!("failed to spawn bridge: {}", e))?;

    guard.child = Some(child);

    app_handle
        .emit("bridge-spawning", &())
        .map_err(|e| e.to_string())?;

    Ok(format!("bridge spawned in {:?}", bridge_dir))
}

#[command]
async fn stop_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<BridgeState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    app_handle
        .emit("bridge-stopped", &())
        .map_err(|e| e.to_string())?;

    Ok("bridge stopped".into())
}

#[command]
async fn bridge_status(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let state = app_handle.state::<Mutex<BridgeState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(child) = &mut guard.child {
        match child.try_wait() {
            Ok(Some(_)) => Ok(false),
            Ok(None) => Ok(true),
            Err(_) => Ok(false),
        }
    } else {
        Ok(false)
    }
}

#[command]
async fn list_templates() -> Result<serde_json::Value, String> {
    let manifest_path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("packages")
        .join("visual-corpus")
        .join("manifests")
        .join("templates.json");

    if !manifest_path.exists() {
        return Ok(serde_json::json!([]));
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read templates.json: {}", e))?;

    let templates: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("failed to parse templates.json: {}", e))?;

    Ok(templates)
}

#[command]
async fn forward_wire(
    app_handle: tauri::AppHandle,
    r#type: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    // Forward wire messages to the bridge via stdout/stdin or a local socket
    // For hackathon: log and emit to any listeners
    let _ = app_handle.emit("wire-forwarded", &serde_json::json!({
        "type": r#type,
        "payload": payload
    }));
    Ok(())
}

#[command]
async fn send_led_frame(_frame: serde_json::Value) -> Result<(), String> {
    // For hackathon: LED frames go through the bridge's serialosc layer
    // This is a placeholder — the bridge handles this via WebSocket
    Ok(())
}

#[command]
async fn mapping_request(_op: String, _name: Option<String>, _mapping: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    // For hackathon: mappings are handled by the bridge
    Ok(serde_json::json!({"ok": false, "error": "mapping requires bridge"}))
}

#[command]
async fn snapshot_request() -> Result<(), String> {
    // For hackathon: snapshots are handled by the bridge
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Lichtspiel.", name)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(BridgeState::new()))
        .invoke_handler(tauri::generate_handler![
            greet,
            spawn_bridge,
            stop_bridge,
            bridge_status,
            list_templates,
            forward_wire,
            send_led_frame,
            mapping_request,
            snapshot_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lichtspiel");
}

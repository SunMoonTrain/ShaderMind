use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::Manager;

const CONFIG_FILE: &str = "config.json";

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("找不到配置目录：{e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// 读取本地配置。文件不存在或内容损坏都返回 null，由前端回落到默认值。
#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取配置失败：{e}"))?;
    Ok(serde_json::from_str(&text).ok())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let text =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败：{e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入配置失败：{e}"))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// 把图片读成 data URL 交给前端。
///
/// 走这条路而不是 asset 协议，是为了不必给任意路径开放文件访问范围。
#[tauri::command]
fn load_image(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let bytes = fs::read(&path).map_err(|e| format!("{e}"))?;
    Ok(format!(
        "data:{};base64,{}",
        mime_for(&path),
        BASE64.encode(bytes)
    ))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 记住窗口的尺寸与位置
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            load_image,
            read_text_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("启动 ShaderMind 失败");
}

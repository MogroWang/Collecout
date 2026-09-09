use tauri_plugin_fs::FsExt;

/// 把用户通过对话框选中的路径登记进 tauri-plugin-fs 的运行时 scope。
/// 导出的目标通常在默认授权范围（appdata/exe/home）之外，不做这一步写入会被拒绝。
#[tauri::command]
fn extend_fs_scope(
    app: tauri::AppHandle,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let result = if is_dir {
        app.allow_directory(p.as_path(), Some(true))
    } else {
        app.allow_file(p.as_path())
    };
    result.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![extend_fs_scope])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

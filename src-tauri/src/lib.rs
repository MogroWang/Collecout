use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// 把用户通过对话框选中的路径登记进 tauri-plugin-fs 的运行时 scope。
/// 导出的目标通常在默认授权范围（appdata/exe/home）之外，不做这一步写入会被拒绝。
#[tauri::command]
fn extend_fs_scope(app: tauri::AppHandle, path: String, is_dir: bool) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let scope = app.fs_scope();
    if is_dir {
        scope.allow_directory(&p, true)
    } else {
        scope.allow_file(&p)
    }
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 记住窗口上次关闭时的位置与大小，下次启动自动恢复
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 窗口以隐藏方式启动（tauri.conf.json visible: false），由前端就绪后显示；
        // 这里兜底：万一前端脚本出错没能显示窗口，3 秒后强制亮出，避免「点了图标没反应」
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(win) = handle.get_webview_window("main") {
                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extend_fs_scope])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

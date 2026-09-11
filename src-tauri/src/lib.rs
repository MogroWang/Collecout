use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const DATA_DIR_NAME: &str = "collecout-data";

/// 把用户通过对话框选中的路径登记进 tauri-plugin-fs 的运行时 scope。
/// 导出的目标通常在默认授权范围（appdata/exe/home）之外，不做这一步写入会被拒绝。
#[tauri::command]
fn extend_fs_scope(app: tauri::AppHandle, path: String, is_dir: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let scope = app.fs_scope();
    if is_dir {
        scope.allow_directory(&p, true)
    } else {
        scope.allow_file(&p)
    }
    .map_err(|e| e.to_string())
}

/** 目录里建 collecout-data 并写探针文件，验证可写（std::fs 不受前端 fs 插件 scope 限制） */
fn dir_writable(dir: &Path) -> bool {
    let probe_dir = dir.join(DATA_DIR_NAME);
    if std::fs::create_dir_all(&probe_dir).is_err() {
        return false;
    }
    let probe_file = probe_dir.join(".probe");
    let ok = std::fs::write(&probe_file, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe_file);
    ok
}

/// 权威解析默认数据根，返回「<可写目录>/collecout-data」的绝对路径：
/// exe 所在目录（绿色便携，数据跟着程序走）→ 家目录 → AppData，取第一个可写的。
/// 前端不再用 fs 插件按 baseDir 逐个探测——插件 scope 与路径解析在 Windows 上
/// 对 exe 目录的处理不可靠，探测失败又被静默吞掉，默认根总是悄悄退回 AppData；
/// Rust 端 std::fs 的结果唯一确定。
#[tauri::command]
fn resolve_default_root(app: tauri::AppHandle) -> Result<String, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
        }
    }
    if let Ok(home) = app.path().home_dir() {
        candidates.push(home);
    }
    if let Ok(appdata) = app.path().app_data_dir() {
        candidates.push(appdata);
    }
    for dir in candidates {
        if dir_writable(&dir) {
            return Ok(dir.join(DATA_DIR_NAME).to_string_lossy().into_owned());
        }
    }
    Err("没有可写的数据位置".into())
}

/// 用系统文件管理器打开文件夹，或打开所在位置并选中文件。
/// 自研命令替代 opener 插件——open_path / reveal_item_in_dir 在插件侧还有独立的
/// 路径 scope 校验，「打开数据文件夹」等场景会被静默拒绝。
#[tauri::command]
fn open_or_reveal(path: String, reveal: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let arg = if reveal { format!("/select,\"{}\"", path) } else { path };
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if reveal {
            cmd.arg("-R");
        }
        cmd.arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
            // 任务栏 / Alt-Tab 图标：窗口类图标在注册时被锁在 32px（LR_DEFAULTSIZE），
            // 高 DPI 任务栏（125–175% 需要 30/36/42px）只能从 32px 放大而发虚；
            // 启动后用 WM_SETICON 显式设置高分辨率图标，运行时生效、不受图标缓存影响
            #[cfg(desktop)]
            {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(tauri::include_image!("icons/64x64.png"));
                }
            }
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
        .invoke_handler(tauri::generate_handler![
            extend_fs_scope,
            resolve_default_root,
            open_or_reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

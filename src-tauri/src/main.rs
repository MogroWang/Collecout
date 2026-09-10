// 发布构建下隐藏 Windows 控制台窗口；调试时保留以便查看日志
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    collecout_lib::run()
}

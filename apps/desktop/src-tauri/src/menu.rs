// 原生菜单栏模块

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime, Wry, Emitter,
};

/// 创建应用菜单栏
pub fn create_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    // File 菜单
    let open_project = MenuItem::with_id(app, "open_project", "打开项目...", true, Some("CmdOrCtrl+O"))?;
    let new_file = MenuItem::with_id(app, "new_file", "新建文件", true, Some("CmdOrCtrl+N"))?;
    let save = MenuItem::with_id(app, "save", "保存", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save_as", "另存为...", true, Some("CmdOrCtrl+Shift+S"))?;
    let close = MenuItem::with_id(app, "close", "关闭文件", true, Some("CmdOrCtrl+W"))?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;

    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &open_project,
            &new_file,
            &PredefinedMenuItem::separator(app)?,
            &save,
            &save_as,
            &close,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // Edit 菜单
    let undo = MenuItem::with_id(app, "undo", "撤销", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "重做", true, Some("CmdOrCtrl+Shift+Z"))?;
    let cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
    let copy = PredefinedMenuItem::copy(app, Some("复制"))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &cut,
            &copy,
            &paste,
            &PredefinedMenuItem::separator(app)?,
            &select_all,
        ],
    )?;

    // View 菜单
    let toggle_sidebar = MenuItem::with_id(app, "toggle_sidebar", "切换侧边栏", true, Some("CmdOrCtrl+B"))?;
    let toggle_fullscreen = MenuItem::with_id(app, "toggle_fullscreen", "全屏", true, Some("F11"))?;
    let zoom_in = MenuItem::with_id(app, "zoom_in", "放大", true, Some("CmdOrCtrl+Plus"))?;
    let zoom_out = MenuItem::with_id(app, "zoom_out", "缩小", true, Some("CmdOrCtrl+Minus"))?;
    let zoom_reset = MenuItem::with_id(app, "zoom_reset", "重置缩放", true, Some("CmdOrCtrl+0"))?;

    let view_menu = Submenu::with_items(
        app,
        "查看",
        true,
        &[
            &toggle_sidebar,
            &toggle_fullscreen,
            &PredefinedMenuItem::separator(app)?,
            &zoom_in,
            &zoom_out,
            &zoom_reset,
        ],
    )?;

    // Help 菜单
    let about = PredefinedMenuItem::about(app, Some("关于"), None)?;
    let help_docs = MenuItem::with_id(app, "help_docs", "帮助文档", true, Some("F1"))?;

    let help_menu = Submenu::with_items(
        app,
        "帮助",
        true,
        &[&help_docs, &PredefinedMenuItem::separator(app)?, &about],
    )?;

    // 创建菜单栏
    let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &help_menu])?;

    Ok(menu)
}

/// 菜单事件处理
pub fn handle_menu_event(app: &AppHandle<Wry>, event: &str) {
    if let Some(frontend_event) = frontend_event_for_menu_id(event) {
        let _ = app.emit(frontend_event, ());
        return;
    }

    match event {
        "toggle_fullscreen" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
            }
        }
        _ => {
            println!("未处理的菜单事件: {}", event);
        }
    }
}

pub fn frontend_event_for_menu_id(event: &str) -> Option<&'static str> {
    match event {
        "open_project" => Some("menu:open-project"),
        "new_file" => Some("menu:new-file"),
        "save" => Some("menu:save"),
        "save_as" => Some("menu:save-as"),
        "close" => Some("menu:close"),
        "undo" => Some("menu:undo"),
        "redo" => Some("menu:redo"),
        "toggle_sidebar" => Some("menu:toggle-sidebar"),
        "zoom_in" => Some("menu:zoom-in"),
        "zoom_out" => Some("menu:zoom-out"),
        "zoom_reset" => Some("menu:zoom-reset"),
        "help_docs" => Some("menu:help-docs"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::frontend_event_for_menu_id;

    #[test]
    fn maps_native_menu_ids_to_frontend_events() {
        let cases = [
            ("open_project", "menu:open-project"),
            ("new_file", "menu:new-file"),
            ("save", "menu:save"),
            ("save_as", "menu:save-as"),
            ("close", "menu:close"),
            ("undo", "menu:undo"),
            ("redo", "menu:redo"),
            ("toggle_sidebar", "menu:toggle-sidebar"),
            ("zoom_in", "menu:zoom-in"),
            ("zoom_out", "menu:zoom-out"),
            ("zoom_reset", "menu:zoom-reset"),
            ("help_docs", "menu:help-docs"),
        ];

        for (menu_id, frontend_event) in cases {
            assert_eq!(frontend_event_for_menu_id(menu_id), Some(frontend_event));
        }
    }

    #[test]
    fn keeps_fullscreen_and_unknown_events_out_of_frontend_event_mapping() {
        assert_eq!(frontend_event_for_menu_id("toggle_fullscreen"), None);
        assert_eq!(frontend_event_for_menu_id("unknown"), None);
    }
}

// The deterministic engine's only write port: application files under `.storyforge/`
// (derived canon caches, the serial plan, breakdown reports). Manuscripts are never
// written here; author writeback keeps going through the guarded writeback commands.
use super::{canonical_project_root, ensure_canonical_path_inside_project, stage_atomic_write};
use base64::Engine;
use std::fs;
use std::path::{Component, Path, PathBuf};

const APP_DIR: &str = ".storyforge";
const MAX_BYTES: usize = 8 * 1024 * 1024;

/// `.storyforge/<...>` written with `/` only: no empty, `.`, `..`, drive or NUL parts.
fn app_relative_parts(relative_path: &str) -> Result<Vec<&str>, String> {
    let parts: Vec<&str> = relative_path.split('/').collect();
    let clean = parts.len() >= 2
        && parts[0] == APP_DIR
        && parts.iter().all(|part| {
            !part.is_empty() && *part != "." && *part != ".." && !part.contains(['\\', ':', '\0'])
        });
    if !clean {
        return Err(format!(
            "引擎只能写入作品的 .storyforge/ 目录: {relative_path}"
        ));
    }
    Ok(parts)
}

fn first_component_is_app_dir(root: &Path, canonical: &Path) -> bool {
    matches!(
        canonical.strip_prefix(root).ok().and_then(|rest| rest.components().next()),
        Some(Component::Normal(name)) if name == APP_DIR
    )
}

/// 原子写（同目录临时文件 + sync + rename）；真实路径也必须落在项目根下的 `.storyforge/` 里——
/// 把 `.storyforge` 或其子目录做成指向书稿的链接，同样拒绝。
#[tauri::command]
pub fn write_engine_project_file(
    project_root: String,
    relative_path: String,
    base64: String,
) -> Result<(), String> {
    let parts = app_relative_parts(&relative_path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("写入内容不是合法的 base64: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("写入内容超过 {MAX_BYTES} 字节: {relative_path}"));
    }
    let root = canonical_project_root(&project_root)?;
    // 逐级建目录、逐级核真实路径：先核再往下建，链接指向书稿或项目外时一个空目录也不留下。
    let mut dir = root.clone();
    for part in &parts[..parts.len() - 1] {
        dir.push(part);
        match fs::symlink_metadata(&dir) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&dir)
                .map_err(|e| format!("无法创建目录 {}: {}", dir.display(), e))?,
            Err(e) => return Err(format!("无法检查目录 {}: {}", dir.display(), e)),
        }
        let canonical = fs::canonicalize(&dir)
            .map_err(|e| format!("无法解析作品目录 {}: {}", dir.display(), e))?;
        ensure_canonical_path_inside_project(&root, &canonical, &dir, false)?;
        if !first_component_is_app_dir(&root, &canonical) {
            return Err(format!(
                "目标不在作品的 .storyforge/ 目录里: {relative_path}"
            ));
        }
    }
    let target: PathBuf = dir.join(parts[parts.len() - 1]);
    if let Ok(info) = fs::symlink_metadata(&target) {
        if !info.is_file() {
            return Err(format!("目标不是普通文件: {relative_path}"));
        }
    }
    let staged = stage_atomic_write(&target, &bytes)
        .map_err(|e| format!("无法写入临时文件 {relative_path}: {e}"))?;
    if let Err(e) = fs::rename(&staged, &target) {
        let _ = fs::remove_file(&staged);
        return Err(format!("无法写入文件 {relative_path}: {e}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(temp: &tempfile::TempDir) -> String {
        temp.path().to_str().unwrap().to_string()
    }

    fn encoded(text: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
    }

    fn residue(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect()
    }

    #[test]
    fn writes_and_overwrites_app_files_creating_directories() {
        let temp = tempfile::tempdir().unwrap();
        let path = ".storyforge/canon/derived/dossier.md";
        write_engine_project_file(root(&temp), path.into(), encoded("一\r\n二")).unwrap();
        let target = temp.path().join(".storyforge/canon/derived/dossier.md");
        assert_eq!(fs::read(&target).unwrap(), "一\r\n二".as_bytes());
        write_engine_project_file(root(&temp), path.into(), encoded("新")).unwrap();
        assert_eq!(fs::read(&target).unwrap(), "新".as_bytes());
        assert!(residue(target.parent().unwrap()).is_empty());
    }

    #[test]
    fn refuses_anything_outside_the_app_directory() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("正文")).unwrap();
        fs::write(temp.path().join("正文/第001章.md"), b"original").unwrap();
        for path in [
            "正文/第001章.md",
            ".storyforge",
            ".storyforge/",
            ".storyforge//plan.json",
            ".storyforge/./plan.json",
            ".storyforge/../正文/第001章.md",
            "../outside.json",
            "/.storyforge/plan.json",
            ".storyforge\\plan.json",
            "C:/.storyforge/plan.json",
            ".storyforge/a:b.json",
            ".STORYFORGE/plan.json",
        ] {
            let failure = write_engine_project_file(root(&temp), path.into(), encoded("x"));
            assert!(failure.is_err(), "{path} should be refused");
        }
        assert_eq!(
            fs::read(temp.path().join("正文/第001章.md")).unwrap(),
            b"original"
        );
        assert!(!temp.path().join(".storyforge").exists());
    }

    #[test]
    fn refuses_bad_content_and_non_file_targets() {
        let temp = tempfile::tempdir().unwrap();
        assert!(
            write_engine_project_file(root(&temp), ".storyforge/a.json".into(), "%%".into())
                .is_err()
        );
        fs::create_dir_all(temp.path().join(".storyforge/dir")).unwrap();
        assert!(
            write_engine_project_file(root(&temp), ".storyforge/dir".into(), encoded("x")).is_err()
        );
        let oversized = base64::engine::general_purpose::STANDARD.encode(vec![b'x'; MAX_BYTES + 1]);
        assert!(
            write_engine_project_file(root(&temp), ".storyforge/big.json".into(), oversized)
                .is_err()
        );
        assert!(!temp.path().join(".storyforge/big.json").exists());
        let exact = base64::engine::general_purpose::STANDARD.encode(vec![b'x'; MAX_BYTES]);
        write_engine_project_file(root(&temp), ".storyforge/big.json".into(), exact).unwrap();
        let missing = temp.path().join("missing").to_str().unwrap().to_string();
        assert!(
            write_engine_project_file(missing, ".storyforge/a.json".into(), encoded("x")).is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn refuses_app_directory_links_into_manuscripts_or_outside() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let outside = tempfile::tempdir().unwrap();
        for target_name in ["正文", "outside"] {
            let temp = tempfile::tempdir().unwrap();
            fs::create_dir(temp.path().join("正文")).unwrap();
            let target = if target_name == "outside" {
                outside.path().to_path_buf()
            } else {
                temp.path().join("正文")
            };
            let link = temp.path().join(".storyforge");
            let status = Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(status.status.success(), "junction fixture must succeed");
            for path in [
                ".storyforge/plan.json",
                ".storyforge/canon/derived/dossier.md",
            ] {
                let failure = write_engine_project_file(root(&temp), path.into(), encoded("x"));
                assert!(
                    failure.is_err(),
                    "{target_name} junction should be refused for {path}"
                );
            }
            assert!(!target.join("plan.json").exists());
            assert!(
                !target.join("canon").exists(),
                "no directory may be created through the link"
            );
        }
    }
}

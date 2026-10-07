//! Visibility, interaction and native zoom checks for the isolated Desktop smoke runner.
//! Geometry and recovery probes use only owned synthetic projects, never author data or provider configuration.
use serde_json::{json, Value};
use std::time::Duration;

// Shared by state snapshots and click probes. Mounted-but-hidden workspace nodes
// must never count as visible or become an alternate navigation/writeback path.
pub(super) const DOM_HELPERS: &str = r#"
  const find = (id) => document.querySelector(`[data-testid="${id}"]`);
  const visible = (element) => {
    if (!element || !element.isConnected || element.closest('[hidden], .hidden, [inert], [aria-hidden="true"]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const click = (target, probeOnly = false) => {
    if (!target) return { clicked: false, reason: 'missing-target' };
    if (!visible(target)) return { clicked: false, reason: 'hidden-target' };
    if (target.matches(':disabled') || target.closest('[aria-disabled="true"]')) return { clicked: false, reason: 'disabled-target' };
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const box = target.getBoundingClientRect();
    if (box.x < -1 || box.y < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) {
      return { clicked: false, reason: 'outside-viewport' };
    }
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (!hit || (hit !== target && !target.contains(hit))) return { clicked: false, reason: 'occluded-target' };
    if (probeOnly) return { ready: true };
    target.click();
    return { clicked: true, testId: target.getAttribute('data-testid'), filePath: target.getAttribute('data-file-path') };
  };
"#;

pub(super) fn click_script(selector: &str) -> String {
    format!(
        "(() => {{ {DOM_HELPERS} return click(document.querySelector({})); }})()",
        serde_json::to_string(selector).expect("serialize smoke selector")
    )
}

pub(super) fn click_ready_script(selector: &str) -> String {
    format!(
        "(() => {{ {DOM_HELPERS} return click(document.querySelector({}), true); }})()",
        serde_json::to_string(selector).expect("serialize smoke selector")
    )
}

const GEOMETRY: &str = r#"
(() => {
  const rect = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height,
      right: box.right, bottom: box.bottom };
  };
  const find = (id) => document.querySelector(`[data-testid="${id}"]`);
  const reachable = (element) => {
    if (!element || element.closest('[hidden], .hidden, [inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || box.width < 1 || box.height < 1 ||
        box.x < -1 || box.y < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) return false;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  };
  const controls = Object.fromEntries(['patch-expand', 'suggestion-accept', 'suggestion-note', 'suggestion-reject']
    .map((id) => [id, { reachable: reachable(find(id)), rect: rect(find(id)) }]));
  const patch = find('patch-review');
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    documentWidth: document.documentElement.scrollWidth,
    expanded: patch?.getAttribute('data-review-expanded') === 'true',
    editor: rect(find('editor-root')), patch: rect(patch), diff: rect(find('patch-diff')),
    controls, controlsReachable: Object.values(controls).every((control) => control.reachable)
  };
})()
"#;

fn number(value: &Value, pointer: &str) -> f64 {
    value
        .pointer(pointer)
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN)
}

fn contained_in_editor(value: &Value, panel: &str) -> bool {
    number(value, &format!("/{panel}/x")) >= number(value, "/editor/x") - 1.0
        && number(value, &format!("/{panel}/y")) >= number(value, "/editor/y") - 1.0
        && number(value, &format!("/{panel}/right")) <= number(value, "/editor/right") + 1.0
        && number(value, &format!("/{panel}/bottom")) <= number(value, "/editor/bottom") + 1.0
}

fn geometry_is_usable(value: &Value, baseline: Option<&Value>, zoom: f64, expanded: bool) -> bool {
    let width = number(value, "/viewport/width");
    let height = number(value, "/viewport/height");
    let scale_matches = baseline.map_or(true, |base| {
        (width - number(base, "/viewport/width") / zoom).abs() <= 2.0
            && (height - number(base, "/viewport/height") / zoom).abs() <= 2.0
    });
    // ResizeObserver/flex layout can lag behind innerHeight. The status bar's
    // CSS height does not scale with set_zoom, so wait for the same bottom gap.
    let editor_layout_settled = baseline.map_or(true, |base| {
        ((height - number(value, "/editor/bottom"))
            - (number(base, "/viewport/height") - number(base, "/editor/bottom")))
        .abs()
            <= 1.0
    });
    width > 0.0
        && height > 0.0
        && scale_matches
        && editor_layout_settled
        && number(value, "/editor/width") > 0.0
        && number(value, "/editor/height") > 0.0
        && number(value, "/editor/x") >= -1.0
        && number(value, "/editor/y") >= -1.0
        && number(value, "/editor/right") <= width + 1.0
        && number(value, "/editor/bottom") <= height + 1.0
        && number(value, "/documentWidth") <= width + 1.0
        && contained_in_editor(value, "patch")
        && contained_in_editor(value, "diff")
        && number(value, "/patch/width") >= 200.0
        && number(value, "/patch/x") >= -1.0
        && number(value, "/patch/right") <= width + 1.0
        && number(value, "/patch/bottom") <= height + 1.0
        && number(value, "/diff/width") >= 200.0
        && number(value, "/diff/height") >= 159.0
        && number(value, "/diff/x") >= -1.0
        && number(value, "/diff/right") <= width + 1.0
        && number(value, "/diff/bottom") <= height + 1.0
        && super::has_bool(value, "expanded", expanded)
        && super::has_bool(value, "controlsReachable", true)
}

fn geometry_is_restored(value: &Value, baseline: &Value) -> bool {
    geometry_is_usable(
        value,
        Some(baseline),
        1.0,
        super::has_bool(value, "expanded", true),
    ) && ["x", "y", "width", "height", "right", "bottom"]
        .into_iter()
        .all(|edge| {
            let pointer = format!("/editor/{edge}");
            (number(value, &pointer) - number(baseline, &pointer)).abs() <= 1.0
        })
}

/// Zoom changes the WebView viewport, rather than faking a CSS transform or screenshot scale.
/// Every path restores 100%; failure to restore fails the smoke as well.
pub(super) fn verify_native_zoom<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let mut original_viewport = None;
    let result = (|| {
        window.set_zoom(1.0).map_err(|error| error.to_string())?;
        let baseline = super::wait_for_window_state(
            window,
            GEOMETRY,
            20,
            Duration::from_millis(150),
            |value| geometry_is_usable(value, None, 1.0, false),
        )?;
        original_viewport = Some(baseline.clone());
        println!(
            "Desktop native zoom evidence: {}",
            json!({"zoom": 1.0, "phase": "baseline", "geometry": baseline})
        );
        for zoom in [1.25, 1.5] {
            window
                .set_zoom(zoom)
                .map_err(|error| format!("set_zoom({zoom}) failed: {error}"))?;
            for (step, expanded) in [false, true, false].into_iter().enumerate() {
                if step > 0 {
                    super::click_window_test_id(window, "patch-expand")?;
                }
                let geometry = super::wait_for_window_state(
                    window,
                    GEOMETRY,
                    20,
                    Duration::from_millis(150),
                    |value| geometry_is_usable(value, Some(&baseline), zoom, expanded),
                )?;
                println!(
                    "Desktop native zoom evidence: {}",
                    json!({"zoom": zoom, "phase": (["workspace-review", "focused-review", "exit-review"][step]), "geometry": geometry})
                );
            }
        }
        Ok(())
    })();
    let reset = (|| {
        window
            .set_zoom(1.0)
            .map_err(|error| format!("restore zoom failed: {error}"))?;
        if let Some(baseline) = original_viewport {
            let restored = super::wait_for_window_state(
                window,
                GEOMETRY,
                20,
                Duration::from_millis(150),
                |value| geometry_is_restored(value, &baseline),
            )?;
            println!(
                "Desktop native zoom evidence: {}",
                json!({"zoom": 1.0, "phase": "restored", "geometry": restored})
            );
        }
        Ok(())
    })();
    match (result, reset) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(error), Err(reset_error)) => Err(format!("{error}; {reset_error}")),
    }
}

/// Real WebView clicks with real filesystem failures, never a mocked receipt.
/// Child fixtures belong to the outer smoke root and share its failure cleanup.
pub(super) fn verify_cache_recovery<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    owned_root: &std::path::Path,
) -> anyhow::Result<()> {
    use anyhow::{ensure, Context};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;

    // Unlike counts, exact byte maps detect replacement of existing evidence.
    fn files(path: &Path) -> anyhow::Result<BTreeMap<String, Vec<u8>>> {
        let mut found = BTreeMap::new();
        if !path.exists() {
            return Ok(found);
        }
        for entry in walkdir::WalkDir::new(path) {
            let entry = entry?;
            if entry.file_type().is_file() {
                found.insert(
                    entry.path().strip_prefix(path)?.to_string_lossy().into(),
                    fs::read(entry.path())?,
                );
            }
        }
        Ok(found)
    }
    let eval = |script: &str| {
        super::eval_window_json(window, script, Duration::from_millis(1500))
            .map_err(anyhow::Error::msg)
    };
    let wait = |script: &str| {
        super::wait_for_window_state(window, script, 100, Duration::from_millis(150), |value| {
            super::has_bool(value, "ready", true)
        })
        .map_err(anyhow::Error::msg)
    };
    let state_script = format!(
        r#"(() => {{ {DOM_HELPERS}
        return {{
            isTauri: !!window.__TAURI_INTERNALS__, mockFs: !!window.__STORYFORGE_MOCK_FS__,
            content: window.__STORYFORGE_SMOKE__?.getCurrentEditorContent(),
            counts: window.__STORYFORGE_SMOKE__?.getWritebackProbeSnapshot(),
            toasts: [...document.querySelectorAll('[data-testid="toast-item"]')]
                .filter(visible).map(e => e.textContent),
            actions: [...document.querySelectorAll('[data-testid="toast-action"]')]
                .filter(visible).map(e => e.textContent)
        }};
    }})()"#
    );
    let action_script = |label: &str, probe: bool| {
        format!(
            r#"(() => {{ {DOM_HELPERS}
        const target = [...document.querySelectorAll('[data-testid="toast-action"]')]
            .find(e => e.textContent === {});
        return click(target, {});
    }})()"#,
            json!(label),
            probe
        )
    };
    let click_action = |label: &str| -> anyhow::Result<()> {
        wait(&action_script(label, true))?;
        let clicked = eval(&action_script(label, false))?;
        ensure!(
            super::has_bool(&clicked, "clicked", true),
            "action not clicked: {label}: {clicked}"
        );
        Ok(())
    };
    for audit_failure in [false, true] {
        let scenario = if audit_failure {
            "audit-and-cache"
        } else {
            "cache-only"
        };
        let root = super::create_smoke_project_at(owned_root.join(scenario))?;
        let body = root.join("正文").join("chapter-001.md");
        let derived = root.join(".storyforge").join("canon").join("derived");
        let audit = root.join(".storyforge").join("author-loop");
        let versions = root.join(".storyforge").join("versions");
        let receipts = root.join(".storyforge").join("writeback-receipts");
        let before = fs::read_to_string(&body)?;
        let after = format!("# Chapter 1\n\nNative {scenario} accepted prose\n");
        let later = format!("{after}\nAuthor's later edits must survive recovery\n");
        eval(&format!(
            "(() => {{ window.__STORYFORGE_SMOKE__.openProject({}); return true; }})()",
            json!(root)
        ))?;
        wait(&format!(
            r#"(() => {{ {DOM_HELPERS}
            const project = find('file-list')?.getAttribute('data-project-path');
            return {{ ready: project === {} && click(find('activity-explorer'), true).ready === true, project }};
        }})()"#,
            json!(root)
        ))?;
        super::click_window_test_id(window, "activity-explorer").map_err(anyhow::Error::msg)?;
        let chapter_selector = format!(
            "[data-testid=\"file-item\"][data-file-path={}]",
            json!(body)
        );
        wait(&click_ready_script(&chapter_selector))?;
        ensure!(
            super::has_bool(&eval(&click_script(&chapter_selector))?, "clicked", true),
            "chapter click failed"
        );
        let ready = format!(
            r#"(() => {{ {DOM_HELPERS}
            const smoke = window.__STORYFORGE_SMOKE__;
            return {{ ready: visible(find('editor-root')) && smoke?.getCurrentEditorContent() === {},
                content: smoke?.getCurrentEditorContent(), currentFile: find('editor-root')?.getAttribute('data-current-file') }};
        }})()"#,
            json!(before)
        );
        wait(&ready).context("open isolated cache recovery project")?;
        fs::create_dir_all(&derived)?;
        if derived.join("presence.json").is_file() {
            fs::remove_file(derived.join("presence.json"))?;
        }
        fs::create_dir(derived.join("presence.json"))?;
        let proposals = r#"{"entities":[{"id":"pending-smoke","canonical_name":"待审人物"}]}"#;
        fs::write(derived.join("proposals.json"), proposals)?;
        if audit_failure {
            fs::write(&audit, "block audit directory creation")?;
        }
        let installation = eval("window.__STORYFORGE_SMOKE__.installWritebackProbe('observe')")?;
        ensure!(
            super::has_bool(&installation, "installed", true),
            "native observer: {installation}"
        );
        eval(&format!(
            "(() => {{ window.__STORYFORGE_SMOKE__.proposeRevision({}); return true; }})()",
            json!({"id": format!("smoke-{scenario}"), "filePath": body, "before": before, "after": after})
        ))?;
        wait(&click_ready_script("[data-testid=\"suggestion-accept\"]"))?;
        super::click_window_test_id(window, "suggestion-accept").map_err(anyhow::Error::msg)?;
        let action = if audit_failure {
            "重试记录（不重写正文）"
        } else {
            "修复缓存（不重写正文）"
        };
        wait(&action_script(action, true)).context("warning recovery action must be visible")?;
        let initial = eval(&state_script)?;
        ensure!(
            super::has_bool(&initial, "isTauri", true)
                && !super::has_bool(&initial, "mockFs", true),
            "not native: {initial}"
        );
        ensure!(
            initial.pointer("/counts/writes").and_then(Value::as_u64) == Some(1),
            "expected one native write: {initial}"
        );
        ensure!(
            initial["toasts"]
                .to_string()
                .contains("canon 派生缓存未失效"),
            "missing cache warning: {initial}"
        );
        ensure!(
            fs::read_to_string(&body)? == after,
            "accepted body mismatch"
        );
        let immutable = files(&receipts)?;
        ensure!(
            immutable.keys().any(|name| name.ends_with(".intent.json"))
                && immutable.keys().any(|name| name.ends_with(".outcome.json")),
            "missing durable receipt"
        );
        let version_bytes = files(&versions)?;
        ensure!(!version_bytes.is_empty(), "missing pre-write snapshot");
        println!(
            "Desktop native cache recovery evidence: {}",
            json!({"scenario": scenario, "phase": "warning", "ui": initial,
            "versionFiles": version_bytes.len(), "receiptFiles": immutable.len()})
        );

        // Simulate a real later author edit on disk and in Monaco. Recovery must
        // retain both; no current-buffer equality shortcut may authorize replay.
        fs::write(&body, &later)?;
        ensure!(
            eval(&format!(
                "window.__STORYFORGE_SMOKE__.setCurrentEditorContent({})",
                json!(later)
            ))? == json!(true),
            "editor edit failed"
        );
        let assert_preserved = || -> anyhow::Result<Value> {
            let state = eval(&state_script)?;
            ensure!(
                fs::read_to_string(&body)? == later && state["content"] == json!(later),
                "recovery changed author text: {state}"
            );
            ensure!(
                files(&versions)? == version_bytes,
                "recovery changed snapshots"
            );
            let current = files(&receipts)?;
            for (name, bytes) in &immutable {
                ensure!(
                    current.get(name) == Some(bytes),
                    "recovery changed original receipt {name}"
                );
            }
            ensure!(
                fs::read_to_string(derived.join("proposals.json"))? == proposals,
                "proposal changed"
            );
            ensure!(
                state.pointer("/counts/writes").and_then(Value::as_u64) == Some(1),
                "body dispatched again: {state}"
            );
            Ok(state)
        };
        // First retry with the fault still present: the real ToastHost must keep
        // the failed action reachable, not swallow it or dismiss its warning.
        click_action(action)?;
        let failed_action = format!(
            r#"(() => {{ {DOM_HELPERS}
            const target = [...document.querySelectorAll('[data-testid="toast-action"]')].find(e => e.textContent === {});
            const item = target?.closest('[data-testid="toast-item"]');
            return {{ ready: click(target, true).ready === true && !!item?.querySelector('[data-testid="toast-action-error"]') }};
        }})()"#,
            json!(action)
        );
        wait(&failed_action).context("failed recovery action remains retryable")?;
        println!(
            "Desktop native cache recovery evidence: {}",
            json!({"scenario": scenario, "phase": "retry-failed", "ui": assert_preserved()?})
        );
        if audit_failure {
            fs::remove_file(&audit)?;
            click_action(action)?;
            wait(&action_script("修复缓存（不重写正文）", true))
                .context("audit repair must expose cache repair")?;
            let audit_bytes = files(&audit)?;
            ensure!(
                audit_bytes.len() == 1,
                "audit repair must create exactly one record"
            );
            println!(
                "Desktop native cache recovery evidence: {}",
                json!({"scenario": scenario, "phase": "audit-repaired-cache-pending", "ui": assert_preserved()?})
            );
        }
        let audit_bytes = files(&audit)?;
        ensure!(
            audit_bytes.len() == 1,
            "expected one audit record before cache repair"
        );
        fs::remove_dir(derived.join("presence.json"))?;
        // A regular stale file must actually be deleted by the native repair.
        fs::write(derived.join("presence.json"), "stale disposable cache")?;
        click_action("修复缓存（不重写正文）")?;
        let repaired = format!(
            r#"(() => {{ {DOM_HELPERS}
            return {{ ready: [...document.querySelectorAll('[data-testid="toast-item"]')]
                .some(e => visible(e) && e.textContent.includes('派生缓存已清理，正文未再次写入'))
                && ![...document.querySelectorAll('[data-testid="toast-action"]')]
                    .some(e => visible(e) && e.textContent === '修复缓存（不重写正文）') }};
        }})()"#
        );
        wait(&repaired)?;
        ensure!(
            !derived.join("presence.json").exists(),
            "cache repair did not delete stale file"
        );
        ensure!(
            files(&audit)? == audit_bytes,
            "cache repair changed audit record"
        );
        let current = files(&receipts)?;
        ensure!(
            current.len() == immutable.len() + 1
                && current
                    .keys()
                    .any(|name| name.ends_with(".canon-invalidation.json")),
            "missing cache maintenance record"
        );
        println!(
            "Desktop native cache recovery evidence: {}",
            json!({"scenario": scenario, "phase": "cache-repaired",
            "ui": assert_preserved()?, "bodyPreserved": true, "versionsByteEqual": true, "originalReceiptsByteEqual": true, "auditByteEqual": true, "proposalsPreserved": true})
        );
        eval("window.__STORYFORGE_SMOKE__.restoreWritebackProbe()")?;
        // Reset only this synthetic fixture after the preservation assertions;
        // switching projects must not be diverted by a dirty-editor prompt.
        fs::write(&body, &after)?;
        eval(&format!(
            "window.__STORYFORGE_SMOKE__.setCurrentEditorContent({})",
            json!(after)
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn geometry(width: f64, height: f64) -> Value {
        json!({"viewport": {"width": width, "height": height}, "documentWidth": width,
            "editor": {"x": 100, "y": 76, "width": width - 140.0, "height": height - 102.0,
                "right": width - 40.0, "bottom": height - 26.0},
            "patch": {"x": 100, "y": height - 326.0, "width": width - 140.0, "height": 300,
                "right": width - 40.0, "bottom": height - 26.0},
            "diff": {"x": 100, "y": height - 226.0, "width": width - 140.0, "height": 200,
                "right": width - 40.0, "bottom": height - 26.0},
            "controlsReachable": true, "expanded": false})
    }
    #[test]
    fn native_zoom_requires_real_css_viewport_change() {
        let baseline = geometry(1200.0, 900.0);
        assert!(!geometry_is_usable(&baseline, Some(&baseline), 1.5, false));
        assert!(geometry_is_usable(
            &geometry(800.0, 600.0),
            Some(&baseline),
            1.5,
            false
        ));
    }
    #[test]
    fn clipped_controls_overflow_and_tiny_diff_fail() {
        let baseline = geometry(1200.0, 900.0);
        for (key, value) in [
            ("controlsReachable", json!(false)),
            ("documentWidth", json!(1205)),
        ] {
            let mut broken = baseline.clone();
            broken[key] = value;
            assert!(!geometry_is_usable(&broken, None, 1.0, false));
        }
        let mut broken = baseline;
        broken["diff"]["height"] = json!(80);
        assert!(!geometry_is_usable(&broken, None, 1.0, false));
    }

    #[test]
    fn smoke_zoom_rejects_animation_overhang_and_stale_editor_layout() {
        let baseline = geometry(1200.0, 900.0);
        let zoomed = geometry(800.0, 600.0);
        for panel in ["patch", "diff"] {
            let mut animating = zoomed.clone();
            for edge in ["y", "bottom"] {
                animating[panel][edge] = json!(animating[panel][edge].as_f64().unwrap() + 10.0);
            }
            assert!(!geometry_is_usable(&animating, Some(&baseline), 1.5, false));
        }
        // WebView has resized its viewport, but the old 150% layout is still
        // contained inside the larger viewport; containment alone is not enough.
        let mut stale = geometry(1200.0, 600.0);
        stale["viewport"]["height"] = json!(900);
        assert!(!geometry_is_usable(&stale, Some(&baseline), 1.0, false));
        assert!(!geometry_is_restored(&stale, &baseline));

        // Restore must compare the entire editor rectangle, not only its bottom.
        let mut wrong_width = baseline.clone();
        wrong_width["editor"]["width"] = json!(900);
        wrong_width["editor"]["right"] = json!(1000);
        wrong_width["patch"]["width"] = json!(900);
        wrong_width["patch"]["right"] = json!(1000);
        wrong_width["diff"]["width"] = json!(900);
        wrong_width["diff"]["right"] = json!(1000);
        assert!(!geometry_is_restored(&wrong_width, &baseline));
        assert!(geometry_is_restored(&baseline, &baseline));
    }
}

//! Visibility, interaction and native zoom checks for the isolated Desktop smoke runner.
//! The probe records geometry, never manuscript content or provider configuration.
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

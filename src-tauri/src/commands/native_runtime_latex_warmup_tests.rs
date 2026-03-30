use super::{
    format_warmup_heartbeat_message, managed_tectonic_runtime_ready, TECTONIC_BINARY_RELATIVE_PATH,
};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

fn create_temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("latotex-{name}-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn warmup_heartbeat_message_includes_elapsed_seconds() {
    assert_eq!(
        format_warmup_heartbeat_message("extracting_search", Duration::from_secs(12)),
        "extracting_search (12s)"
    );
}

#[test]
fn managed_runtime_ready_requires_expected_assets() {
    let tool_root = create_temp_dir("tectonic-ready");
    let engine_path = tool_root.join(TECTONIC_BINARY_RELATIVE_PATH);
    let cache_dir = tool_root.join("cache");
    let search_dir = tool_root.join("search/windows-x64");
    let pfb_dir = tool_root.join("pfb");
    let fontconfig_dir = tool_root.join("fontconfig/windows");

    fs::create_dir_all(engine_path.parent().expect("engine parent")).expect("engine dir");
    fs::write(&engine_path, b"tectonic").expect("engine file");
    for relative in ["files", "indexes", "manifests"] {
        fs::create_dir_all(cache_dir.join(relative)).expect("cache seed dir");
    }
    let search_files = [
        "latex.ltx",
        "l3backend-xetex.def",
        "tectonic-format-latex.tex",
        "ctexart.cls",
        "xeCJK.sty",
        "pdftex.map",
        "kanjix.map",
        "ckx.map",
        "pdfglyphlist.txt",
        "glyphlist.txt",
        "lmromanslant10-regular.otf",
        "FandolSong-Regular.otf",
    ];
    for relative in search_files {
        let path = search_dir.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("search parent");
        }
        fs::write(path, b"ok").expect("search file");
    }
    fs::create_dir_all(&pfb_dir).expect("pfb dir");
    fs::write(pfb_dir.join("cmex10.pfb"), b"pfb").expect("pfb file");
    fs::create_dir_all(&fontconfig_dir).expect("fontconfig dir");
    fs::write(fontconfig_dir.join("fonts.conf"), b"<fontconfig />").expect("fontconfig file");

    assert!(managed_tectonic_runtime_ready(&tool_root));

    fs::remove_file(search_dir.join("xeCJK.sty")).expect("remove search file");
    assert!(!managed_tectonic_runtime_ready(&tool_root));

    let _ = fs::remove_dir_all(&tool_root);
}

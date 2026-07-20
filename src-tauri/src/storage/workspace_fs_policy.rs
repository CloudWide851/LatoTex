pub(crate) const WORKSPACE_TEXT_FILE_LIMIT: u64 = 16 * 1024 * 1024;
pub(crate) const WORKSPACE_BINARY_FILE_LIMIT: u64 = 256 * 1024 * 1024;
pub(crate) const WORKSPACE_SCAN_FILE_LIMIT: u64 = 2 * 1024 * 1024;
pub(crate) const WORKSPACE_COMPILE_TOTAL_LIMIT: u64 = 256 * 1024 * 1024;
pub(crate) const WORKSPACE_SUBMISSION_TOTAL_LIMIT: u64 = 512 * 1024 * 1024;

pub(crate) fn normalize_workspace_path(input: &str) -> Result<PathBuf, String> {
    if input.contains('\0') {
        return Err("workspace.path.invalid".to_string());
    }
    let normalized = input.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("workspace.path.invalid".to_string());
    }
    if Path::new(&normalized).is_absolute() {
        return Err("workspace.path.outside_root".to_string());
    }
    let mut relative = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            std::path::Component::Normal(value) => relative.push(value),
            std::path::Component::CurDir => {}
            _ => return Err("workspace.path.outside_root".to_string()),
        }
    }
    if relative.as_os_str().is_empty() {
        return Err("workspace.path.invalid".to_string());
    }
    Ok(relative)
}

pub(crate) fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = normalize_workspace_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "workspace.path.root_unavailable".to_string())?;
    let candidate = canonical_root.join(&relative);
    let normalized_candidate = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|_| "workspace.path.unavailable".to_string())?
    } else {
        let mut existing_parent = candidate.as_path();
        while !existing_parent.exists() {
            existing_parent = existing_parent
                .parent()
                .ok_or_else(|| "workspace.path.invalid".to_string())?;
        }
        let canonical_existing = existing_parent
            .canonicalize()
            .map_err(|_| "workspace.path.unavailable".to_string())?;
        let suffix = candidate
            .strip_prefix(existing_parent)
            .map_err(|_| "workspace.path.invalid".to_string())?;
        canonical_existing.join(suffix)
    };
    if !normalized_candidate.starts_with(&canonical_root) {
        return Err("workspace.path.outside_root".to_string());
    }
    Ok(normalized_candidate)
}

#[cfg(target_os = "windows")]
fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(target_os = "windows"))]
fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn metadata_is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink() || metadata_is_reparse(metadata)
}

fn ensure_not_link_or_reparse_if_present(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_link_or_reparse(&metadata) => {
            Err("workspace.path.reparse_denied".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("workspace.path.unavailable".to_string()),
    }
}

fn ensure_mutation_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = normalize_workspace_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "workspace.path.root_unavailable".to_string())?;
    let mut current = canonical_root.clone();
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata_is_link_or_reparse(&metadata) => {
                return Err("workspace.path.reparse_denied".to_string());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(_) => return Err("workspace.path.unavailable".to_string()),
        }
    }
    safe_join(&canonical_root, relative_path)
}

pub(crate) fn prepare_workspace_mutation_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    ensure_mutation_path(root, relative_path)
}

fn ensure_file_with_limit(path: &Path, limit: u64) -> Result<fs::Metadata, String> {
    let metadata = fs::metadata(path).map_err(map_workspace_read_error)?;
    if !metadata.is_file() {
        return Err("workspace.file_read.not_file".to_string());
    }
    if metadata.len() > limit {
        return Err("workspace.file_read.too_large".to_string());
    }
    Ok(metadata)
}

pub(crate) fn read_file_with_limit(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    ensure_file_with_limit(path, limit)?;
    let bytes = fs::read(path).map_err(map_workspace_read_error)?;
    if bytes.len() as u64 > limit {
        return Err("workspace.file_read.too_large".to_string());
    }
    Ok(bytes)
}

pub(crate) fn workspace_path_is_link_or_reparse(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata_is_link_or_reparse(&metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("workspace.path.unavailable".to_string()),
    }
}

pub(crate) fn read_text_under_root(
    root: &Path,
    relative_path: &str,
    limit: u64,
) -> Result<String, String> {
    let target = safe_join(root, relative_path)?;
    let bytes = read_file_with_limit(&target, limit)?;
    String::from_utf8(bytes).map_err(|_| "workspace.file_read.invalid_utf8".to_string())
}

pub(crate) fn read_binary_under_root(
    root: &Path,
    relative_path: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let target = safe_join(root, relative_path)?;
    read_file_with_limit(&target, limit)
}

pub(crate) fn ensure_workspace_binary_file(path: &Path) -> Result<fs::Metadata, String> {
    ensure_file_with_limit(path, WORKSPACE_BINARY_FILE_LIMIT)
}

pub(crate) fn atomic_write_file(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "workspace.file.atomic_write_failed".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
    ensure_not_link_or_reparse_if_present(target)?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let temporary = parent.join(format!(".{name}.latotex-{}.tmp", Uuid::new_v4().simple()));
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        file.write_all(bytes)
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        file.flush()
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        file.sync_all()
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        drop(file);
        atomic_replace_file(&temporary, target)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(target_os = "windows")]
fn atomic_replace_file(source: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return fs::rename(source, target)
            .map_err(|_| "workspace.file.atomic_replace_failed".to_string());
    }
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            source_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err("workspace.file.atomic_replace_failed".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace_file(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|_| "workspace.file.atomic_replace_failed".to_string())
}

pub(crate) fn atomic_write_under_root(
    root: &Path,
    relative_path: &str,
    bytes: &[u8],
    limit: u64,
) -> Result<PathBuf, String> {
    if bytes.len() as u64 > limit {
        return Err("workspace.file_write.too_large".to_string());
    }
    let target = ensure_mutation_path(root, relative_path)?;
    atomic_write_file(&target, bytes)?;
    Ok(target)
}

pub(crate) fn atomic_write_stream_under_root<F>(
    root: &Path,
    relative_path: &str,
    limit: u64,
    write: F,
) -> Result<PathBuf, String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    let target = ensure_mutation_path(root, relative_path)?;
    let parent = target
        .parent()
        .ok_or_else(|| "workspace.file.atomic_write_failed".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
    ensure_not_link_or_reparse_if_present(&target)?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let temporary = parent.join(format!(".{name}.latotex-{}.tmp", Uuid::new_v4().simple()));
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        write(&mut file)?;
        file.flush()
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        file.sync_all()
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?;
        let size = file
            .metadata()
            .map_err(|_| "workspace.file.atomic_write_failed".to_string())?
            .len();
        if size > limit {
            return Err("workspace.file_write.too_large".to_string());
        }
        drop(file);
        atomic_replace_file(&temporary, &target)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map(|_| target)
}

#[cfg(test)]
mod workspace_fs_policy_tests {
    use super::*;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("latotex-workspace-fs-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn safe_join_rejects_escape_and_absolute_paths() {
        let root = fixture();
        assert_eq!(
            safe_join(&root, "../escape.tex").unwrap_err(),
            "workspace.path.outside_root"
        );
        assert_eq!(
            safe_join(&root, r"C:\\escape.tex").unwrap_err(),
            "workspace.path.outside_root"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_write_preserves_complete_previous_or_new_content() {
        let root = fixture();
        let target = root.join("paper.tex");
        fs::write(&target, "old").unwrap();
        atomic_write_file(&target, b"new content").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new content");
        assert!(fs::read_dir(&root)
            .unwrap()
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().contains(".latotex-")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bounded_write_rejects_oversized_payload_without_touching_target() {
        let root = fixture();
        fs::write(root.join("paper.tex"), "old").unwrap();
        let error = atomic_write_under_root(&root, "paper.tex", b"12345", 4).unwrap_err();
        assert_eq!(error, "workspace.file_write.too_large");
        assert_eq!(fs::read_to_string(root.join("paper.tex")).unwrap(), "old");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mutation_path_rejects_junction_ancestors() {
        let root = fixture();
        let outside = fixture();
        let junction = root.join("linked");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            ensure_mutation_path(&root, "linked/escape.tex").unwrap_err(),
            "workspace.path.reparse_denied"
        );
        fs::remove_dir(&junction).unwrap();
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }
}

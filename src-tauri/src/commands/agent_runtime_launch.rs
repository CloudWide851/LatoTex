use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::Path;

pub(crate) fn write_runtime_config(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "agent.runtime.config_failed".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "agent.runtime.config_failed".to_string())?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("agent-mcp"),
        uuid::Uuid::new_v4().simple()
    ));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|_| "agent.runtime.config_failed".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| {
            let _ = fs::remove_file(&temp);
            "agent.runtime.config_failed".to_string()
        })?;
    drop(file);
    fs::rename(&temp, path).map_err(|_| {
        let _ = fs::remove_file(&temp);
        "agent.runtime.config_failed".to_string()
    })
}

pub(crate) fn claude_mcp_config(proxy_exe: &Path) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(&json!({
        "mcpServers": {
            "latotex": {
                "type": "stdio",
                "command": proxy_exe.to_string_lossy(),
                "args": ["--mcp-proxy"]
            }
        }
    }))
    .map_err(|_| "agent.runtime.config_failed".to_string())
}

fn codex_mcp_config_args(proxy_exe: &Path) -> Vec<String> {
    let command_toml = serde_json::to_string(&proxy_exe.to_string_lossy().to_string())
        .unwrap_or_else(|_| "\"latotex.exe\"".to_string());
    vec![
        "--config".to_string(),
        format!("mcp_servers.latotex.command={command_toml}"),
        "--config".to_string(),
        "mcp_servers.latotex.args=[\"--mcp-proxy\"]".to_string(),
    ]
}

pub(crate) fn codex_managed_args(proxy_exe: &Path, project_root: &Path) -> Vec<String> {
    let mut args = vec![
        "exec".to_string(),
        "--json".to_string(),
        "--ephemeral".to_string(),
        "--skip-git-repo-check".to_string(),
        "--ignore-rules".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--cd".to_string(),
        project_root.to_string_lossy().to_string(),
    ];
    args.extend(codex_mcp_config_args(proxy_exe));
    args.push("-".to_string());
    args
}

pub(crate) fn codex_interactive_args(proxy_exe: &Path) -> Vec<String> {
    codex_mcp_config_args(proxy_exe)
}

fn claude_common_args(config_path: &Path) -> Vec<String> {
    vec![
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        "--disallowedTools".to_string(),
        "Bash,Edit,Write,NotebookEdit".to_string(),
        "--strict-mcp-config".to_string(),
        "--mcp-config".to_string(),
        config_path.to_string_lossy().to_string(),
    ]
}

pub(crate) fn claude_managed_args(config_path: &Path) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format=stream-json".to_string(),
        "--include-partial-messages".to_string(),
        "--no-session-persistence".to_string(),
    ];
    args.extend(claude_common_args(config_path));
    args
}

pub(crate) fn claude_interactive_args(config_path: &Path) -> Vec<String> {
    claude_common_args(config_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_arguments_keep_prompt_off_the_command_line() {
        let root = Path::new(r"C:\research");
        let proxy = Path::new(r"C:\Program Files\LatoTex\latotex.exe");
        let codex = codex_managed_args(proxy, root);
        assert_eq!(codex.last().map(String::as_str), Some("-"));
        assert!(!codex.join(" ").contains("secret prompt"));

        let claude = claude_managed_args(Path::new(r"C:\runtime\mcp.json"));
        assert!(claude.iter().any(|value| value == "--strict-mcp-config"));
        assert!(claude
            .iter()
            .any(|value| value == "Bash,Edit,Write,NotebookEdit"));
    }
}

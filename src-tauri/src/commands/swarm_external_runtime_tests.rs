use super::*;

#[test]
fn parses_codex_agent_message_only() {
    let line = r#"{"type":"item.completed","item":{"type":"agent_message","text":"done"}}"#;
    assert_eq!(
        parse_stream_text("codex-cli", line).as_deref(),
        Some("done")
    );
    assert!(parse_stream_text("codex-cli", r#"{"type":"turn.started"}"#).is_none());
}

#[test]
fn parses_claude_stream_delta() {
    let line =
        r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"研究"}}}"#;
    assert_eq!(
        parse_stream_text("claude-code-cli", line).as_deref(),
        Some("研究")
    );
}

#[test]
fn mcp_tools_remain_profile_bounded() {
    let mut profile = AgentProfile {
        id: "p".to_string(),
        name: "p".to_string(),
        description: String::new(),
        color: "#000000".to_string(),
        model_id: None,
        runtime_id: "codex-cli".to_string(),
        fallback_runtime_id: "native".to_string(),
        identity_prompt: String::new(),
        skill_ids: Vec::new(),
        mcp_server_ids: Vec::new(),
        tool_ids: Vec::new(),
        read_scopes: vec![".".to_string()],
        write_scopes: vec!["readonly".to_string()],
        tool_call_budget: 1,
        token_budget: 1024,
        timeout_ms: 5000,
        built_in: false,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert!(allowed_mcp_tools(&profile).is_empty());
    profile.tool_ids.push("web".to_string());
    assert_eq!(allowed_mcp_tools(&profile), vec!["academic_search"]);
    profile.tool_ids.push("workspace".to_string());
    let tools = allowed_mcp_tools(&profile);
    assert!(tools.contains(&"workspace_read".to_string()));
    assert!(tools.contains(&"citation_audit".to_string()));
    assert!(tools.contains(&"submission_check".to_string()));
    assert!(!tools.contains(&"data_analysis".to_string()));
    profile.tool_ids.push("python".to_string());
    assert!(allowed_mcp_tools(&profile).contains(&"data_analysis".to_string()));
}

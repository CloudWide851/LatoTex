use crate::logging::sanitize_log_message_with_limit;
use crate::models::{
    AnalysisPlanInput, AnalysisRunPythonInput, KnowledgeFetchInput, KnowledgeSearchInput,
};
use crate::storage;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

const MCP_INPUT_LIMIT: usize = 64 * 1024;
const MCP_TEXT_LIMIT: usize = 64 * 1024;
const MCP_TEXT_CHAR_LIMIT: usize = 16 * 1024;

fn bounded_json(value: Value) -> Result<Value, String> {
    if serde_json::to_vec(&value)
        .map_err(|_| "agent.mcp.result_invalid".to_string())?
        .len()
        > MCP_TEXT_LIMIT
    {
        return Err("agent.mcp.result_too_large".to_string());
    }
    Ok(value)
}

fn read_scope_allows(session: &crate::models::McpCapabilitySession, relative_path: &str) -> bool {
    let normalized = relative_path.trim().replace('\\', "/");
    session.read_scopes.iter().any(|scope| {
        let scope = scope.trim().trim_matches('/').replace('\\', "/");
        scope == "."
            || normalized == scope
            || (!scope.is_empty() && normalized.starts_with(&format!("{scope}/")))
    })
}

fn success(id: Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}

pub(super) fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc":"2.0",
        "id":id,
        "error":{
            "code":code,
            "message":sanitize_log_message_with_limit(message, 512)
        }
    })
}

fn tool_definitions(allowed: &[String]) -> Vec<Value> {
    let mut tools = Vec::new();
    if allowed.iter().any(|value| value == "knowledge_search") {
        tools.push(json!({
            "name":"knowledge_search",
            "description":"Search the authorized LatoTex project knowledge index. Returns stable evidence IDs and citation anchors.",
            "inputSchema":{
                "type":"object",
                "properties":{"query":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":40}},
                "required":["query"]
            }
        }));
    }
    if allowed.iter().any(|value| value == "knowledge_fetch") {
        tools.push(json!({
            "name":"knowledge_fetch",
            "description":"Fetch a bounded excerpt for an evidence ID returned by knowledge_search.",
            "inputSchema":{
                "type":"object",
                "properties":{"evidenceId":{"type":"string"},"maxChars":{"type":"integer","minimum":256,"maximum":32768}},
                "required":["evidenceId"]
            }
        }));
    }
    if allowed.iter().any(|value| value == "workspace_read") {
        tools.push(json!({
            "name":"workspace_read",
            "description":"Read a bounded UTF-8 text file through the LatoTex WorkspaceFs boundary.",
            "inputSchema":{
                "type":"object",
                "properties":{
                    "path":{"type":"string"},
                    "maxChars":{"type":"integer","minimum":256,"maximum":16384}
                },
                "required":["path"]
            }
        }));
    }
    if allowed.iter().any(|value| value == "academic_search") {
        tools.push(json!({
            "name":"academic_search",
            "description":"Search bounded academic metadata and open evidence through LatoTex research providers.",
            "inputSchema":{
                "type":"object",
                "properties":{
                    "queries":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":8},
                    "limit":{"type":"integer","minimum":1,"maximum":5},
                    "deep":{"type":"boolean"}
                },
                "required":["queries"]
            }
        }));
    }
    if allowed.iter().any(|value| value == "citation_audit") {
        tools.push(json!({
            "name":"citation_audit",
            "description":"Audit the authorized project's paper citation index for duplicate keys and missing Bib/PDF companions.",
            "inputSchema":{"type":"object","properties":{}}
        }));
    }
    if allowed.iter().any(|value| value == "submission_check") {
        tools.push(json!({
            "name":"submission_check",
            "description":"Run a read-only LatoTex submission preflight without creating a package.",
            "inputSchema":{
                "type":"object",
                "properties":{
                    "mainPath":{"type":"string"},
                    "profileId":{"type":"string","enum":["generic","arxiv","conference","journal","ieee-like","acm","springer","elsevier"]}
                },
                "required":["mainPath"]
            }
        }));
    }
    if allowed.iter().any(|value| value == "data_analysis") {
        tools.push(json!({
            "name":"data_analysis",
            "description":"Run the approved, deterministic LatoTex statistical analysis pipeline on authorized project-relative data files.",
            "inputSchema":{
                "type":"object",
                "properties":{
                    "prompt":{"type":"string"},
                    "outputLanguage":{"type":"string"},
                    "plan":{
                        "type":"object",
                        "properties":{
                            "intent":{"type":"string"},
                            "inputFiles":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":8},
                            "targetColumns":{"type":"array","items":{"type":"string"},"maxItems":32},
                            "groupColumn":{"type":["string","null"]},
                            "paired":{"type":["boolean","null"]},
                            "missingValueStrategy":{"type":"string","enum":["complete_case","report_only"]},
                            "alpha":{"type":"number","exclusiveMinimum":0,"exclusiveMaximum":1}
                        },
                        "required":["intent","inputFiles"]
                    }
                },
                "required":["plan"]
            }
        }));
    }
    tools
}

fn call_tool(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    session_log_path: &std::path::Path,
    session: &crate::models::McpCapabilitySession,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    if !session.allowed_tools.iter().any(|value| value == name) {
        return Err("agent.mcp.tool_denied".to_string());
    }
    match name {
        "knowledge_search" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "knowledge.search.query_empty".to_string())?;
            if query.chars().count() > 1_000 {
                return Err("knowledge.search.query_too_large".to_string());
            }
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(20)
                .clamp(1, 40) as u32;
            let response = storage::search_knowledge_scoped(
                db_path,
                runtime_root,
                &KnowledgeSearchInput {
                    project_id: session.project_id.clone(),
                    project_ids: None,
                    query: query.to_string(),
                    limit: Some(limit),
                    deep: Some(true),
                    run_id: Some(format!("mcp-{}", session.session_id.replace('-', ""))),
                    semantic: Some(true),
                },
            )?;
            bounded_json(serde_json::to_value(response).map_err(|error| error.to_string())?)
        }
        "knowledge_fetch" => {
            let evidence_id = args
                .get("evidenceId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "knowledge.evidence.id_missing".to_string())?;
            let max_chars = args
                .get("maxChars")
                .and_then(Value::as_u64)
                .unwrap_or(12_000)
                .clamp(256, MCP_TEXT_CHAR_LIMIT as u64) as u32;
            let response = storage::fetch_knowledge_evidence(
                db_path,
                &KnowledgeFetchInput {
                    project_id: session.project_id.clone(),
                    evidence_id: evidence_id.to_string(),
                    max_chars: Some(max_chars),
                },
            )?;
            bounded_json(serde_json::to_value(response).map_err(|error| error.to_string())?)
        }
        "workspace_read" => {
            let relative_path = args
                .get("path")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "workspace.path.empty".to_string())?;
            if !read_scope_allows(session, relative_path) {
                return Err("agent.mcp.scope_denied".to_string());
            }
            let file = storage::read_project_file(db_path, &session.project_id, relative_path)?;
            let max_chars = args
                .get("maxChars")
                .and_then(Value::as_u64)
                .unwrap_or(MCP_TEXT_CHAR_LIMIT as u64)
                .clamp(256, MCP_TEXT_CHAR_LIMIT as u64) as usize;
            bounded_json(json!({
                "path":file.relative_path,
                "content":file.content.chars().take(max_chars).collect::<String>(),
                "truncated":file.content.chars().count() > max_chars
            }))
        }
        "academic_search" => {
            let queries = args
                .get("queries")
                .and_then(Value::as_array)
                .ok_or_else(|| "research.query.invalid".to_string())?
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .take(9)
                .map(str::to_string)
                .collect::<Vec<_>>();
            if queries.is_empty()
                || queries.len() > 8
                || queries.iter().any(|query| query.chars().count() > 1_000)
            {
                return Err("research.query.invalid".to_string());
            }
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(5)
                .clamp(1, 5) as u32;
            let response = crate::commands::analysis::run_reference_check_queries_for_project(
                db_path,
                runtime_root,
                None,
                Some(&session.project_id),
                queries,
                limit,
                None,
                args.get("deep").and_then(Value::as_bool).unwrap_or(false),
            )?;
            bounded_json(serde_json::to_value(response).map_err(|error| error.to_string())?)
        }
        "citation_audit" => bounded_json(
            serde_json::to_value(storage::library_citation_index_status(
                db_path,
                &session.project_id,
            )?)
            .map_err(|error| error.to_string())?,
        ),
        "submission_check" => {
            let main_path = args
                .get("mainPath")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "submissionPack.invalidPath".to_string())?;
            if !read_scope_allows(session, main_path) {
                return Err("agent.mcp.scope_denied".to_string());
            }
            let profile_id = args
                .get("profileId")
                .and_then(Value::as_str)
                .unwrap_or("generic");
            bounded_json(crate::commands::submission_pack::preview_submission_pack(
                db_path,
                &session.project_id,
                main_path,
                profile_id,
            )?)
        }
        "data_analysis" => {
            let plan = serde_json::from_value::<AnalysisPlanInput>(
                args.get("plan").cloned().unwrap_or(Value::Null),
            )
            .map_err(|_| "analysis.plan.invalid".to_string())?;
            if plan
                .input_files
                .iter()
                .any(|path| !read_scope_allows(session, path))
            {
                return Err("agent.mcp.scope_denied".to_string());
            }
            let prompt = args
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or(&plan.intent)
                .trim();
            if prompt.is_empty() || prompt.chars().count() > 16_000 {
                return Err("analysis.plan.invalid_intent".to_string());
            }
            let output_language = args
                .get("outputLanguage")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.chars().count() <= 32)
                .unwrap_or("en-US");
            let response = crate::commands::native_runtime::run_analysis_python_blocking(
                db_path,
                runtime_root,
                app_data_dir,
                session_log_path,
                AnalysisRunPythonInput {
                    project_id: session.project_id.clone(),
                    task_id: Some(format!("mcp-{}", session.session_id.replace('-', ""))),
                    prompt: prompt.to_string(),
                    output_language: output_language.to_string(),
                    plan,
                },
            )?;
            bounded_json(json!({
                "status": response.status,
                "runtimeSource": response.runtime_source,
                "result": response.profile_json,
            }))
        }
        _ => Err("agent.mcp.tool_unknown".to_string()),
    }
}

pub(super) fn handle_message(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    session_log_path: &std::path::Path,
    session: &crate::models::McpCapabilitySession,
    message: Value,
) -> Option<Value> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    match message.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => Some(success(
            id,
            json!({
                "protocolVersion":"2024-11-05",
                "capabilities":{"tools":{}},
                "serverInfo":{"name":"latotex-research","version":env!("CARGO_PKG_VERSION")}
            }),
        )),
        "notifications/initialized" => None,
        "tools/list" => Some(success(
            id,
            json!({"tools":tool_definitions(&session.allowed_tools)}),
        )),
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let args = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            Some(
                match call_tool(
                    db_path,
                    runtime_root,
                    app_data_dir,
                    session_log_path,
                    session,
                    name,
                    &args,
                ) {
                    Ok(result) => success(
                        id,
                        json!({"content":[{"type":"text","text":result.to_string()}]}),
                    ),
                    Err(error) => failure(id, -32001, &error),
                },
            )
        }
        _ => Some(failure(id, -32601, "agent.mcp.method_unknown")),
    }
}

pub(crate) fn run_if_requested() -> bool {
    if !std::env::args().any(|arg| arg == "--mcp-proxy") {
        return false;
    }
    let broker_address = std::env::var("LATOTEX_MCP_BROKER_ADDR").unwrap_or_default();
    let token = std::env::var("LATOTEX_MCP_SESSION_TOKEN").unwrap_or_default();
    let Ok(mut broker) = super::agent_mcp_broker::connect(&broker_address) else {
        return true;
    };
    let _ = broker.set_read_timeout(Some(Duration::from_secs(120)));
    let _ = broker.set_write_timeout(Some(Duration::from_secs(120)));
    let Ok(reader_stream) = broker.try_clone() else {
        return true;
    };
    let mut broker_reader = BufReader::new(reader_stream);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.len() > MCP_INPUT_LIMIT {
            let response = failure(Value::Null, -32600, "agent.mcp.request_too_large");
            let _ = writeln!(stdout, "{response}");
            let _ = stdout.flush();
            continue;
        }
        let message = match serde_json::from_str::<Value>(&line) {
            Ok(message) => message,
            Err(_) => {
                let response = failure(Value::Null, -32700, "agent.mcp.invalid_json");
                let _ = writeln!(stdout, "{response}");
                let _ = stdout.flush();
                continue;
            }
        };
        let envelope = json!({"token": token, "message": message});
        if writeln!(broker, "{envelope}").is_err() || broker.flush().is_err() {
            break;
        }
        let mut broker_line = String::new();
        if broker_reader.read_line(&mut broker_line).is_err()
            || broker_line.is_empty()
            || broker_line.len() > MCP_INPUT_LIMIT + 8 * 1024
        {
            break;
        }
        let response = serde_json::from_str::<Value>(&broker_line)
            .ok()
            .and_then(|value| value.get("response").cloned())
            .filter(|value| !value.is_null());
        if let Some(response) = response {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                break;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_list_never_grants_unrequested_write_tools() {
        let tools = tool_definitions(&["knowledge_search".to_string()]);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "knowledge_search");
    }
}

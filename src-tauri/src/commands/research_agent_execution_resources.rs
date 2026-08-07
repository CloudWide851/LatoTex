use crate::models::{AgentAppCommand, ResearchPlanStep};
use serde_json::{json, Value};

pub(super) fn command_resources(command: &AgentAppCommand) -> Vec<(String, &'static str)> {
    match command {
        AgentAppCommand::LiteratureOpen { path }
        | AgentAppCommand::WorkspaceRead { path, .. }
        | AgentAppCommand::DrawOpen { path }
        | AgentAppCommand::GitDiff { path: Some(path) } => vec![(path.clone(), "read")],
        AgentAppCommand::ProposeLatex { path, .. }
        | AgentAppCommand::ApplyLatexProposal { path, .. }
        | AgentAppCommand::WriteNonLatex { path, .. }
        | AgentAppCommand::DrawCreate { name: path }
        | AgentAppCommand::DrawExport { path, .. } => vec![(path.clone(), "write")],
        AgentAppCommand::CompileLatex { main_path }
        | AgentAppCommand::SubmissionCheck { main_path, .. }
        | AgentAppCommand::SubmissionBuild { main_path, .. } => {
            vec![(main_path.clone(), "read")]
        }
        AgentAppCommand::AnalysisRun { input_files, .. } => input_files
            .iter()
            .cloned()
            .map(|path| (path, "read"))
            .collect(),
        AgentAppCommand::GitCommit { paths, .. } => {
            paths.iter().cloned().map(|path| (path, "write")).collect()
        }
        _ => Vec::new(),
    }
}

pub(super) fn command_input_summary(step: &ResearchPlanStep, command: &AgentAppCommand) -> Value {
    json!({
        "capability": step.capability,
        "resourceCount": command_resources(command).len(),
    })
}

pub(super) fn stable_diagnostic_code(value: &str) -> &str {
    if value.starts_with("research.")
        && value.len() <= 160
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        value
    } else {
        "research.run.command_failed"
    }
}

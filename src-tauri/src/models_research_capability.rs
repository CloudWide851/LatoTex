#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchCapabilityDescriptor {
    pub id: String,
    pub input_schema: serde_json::Value,
    pub output_type: String,
    pub risk_level: String,
    pub risk_reason_key: String,
    pub execution_target: String,
    pub auto_after_plan_approval: bool,
    pub resource_mode: Option<String>,
    pub idempotency: String,
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub undo_capability: Option<String>,
    pub egress_category: String,
    pub requires_network: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "command", rename_all_fields = "camelCase")]
pub enum AgentAppCommand {
    #[serde(rename = "project.overview")]
    ProjectOverview,
    #[serde(rename = "ui.navigate")]
    Navigate {
        page_id: String,
        resource: Option<String>,
    },
    #[serde(rename = "literature.search")]
    LiteratureSearch {
        queries: Vec<String>,
        deep: Option<bool>,
    },
    #[serde(rename = "literature.import")]
    LiteratureImport { source: String },
    #[serde(rename = "literature.open")]
    LiteratureOpen { path: String },
    #[serde(rename = "literature.citation_trace")]
    CitationTrace { doi: String, direction: String },
    #[serde(rename = "workspace.read")]
    WorkspaceRead {
        path: String,
        max_chars: Option<u32>,
    },
    #[serde(rename = "workspace.propose_latex")]
    ProposeLatex { path: String, instruction: String },
    #[serde(rename = "workspace.apply_latex")]
    ApplyLatexProposal { path: String, proposal_id: String },
    #[serde(rename = "workspace.write_non_latex")]
    WriteNonLatex { path: String, content: String },
    #[serde(rename = "workspace.compile")]
    CompileLatex { main_path: String },
    #[serde(rename = "analysis.run")]
    AnalysisRun {
        prompt: String,
        input_files: Vec<String>,
        spec: Option<AnalysisSpecInput>,
        #[serde(default, skip_deserializing)]
        approval_confirmed: bool,
    },
    #[serde(rename = "report.generate")]
    ReportGenerate { title: String },
    #[serde(rename = "report.export")]
    ReportExport { report_id: String, format: String },
    #[serde(rename = "draw.create")]
    DrawCreate { name: String },
    #[serde(rename = "draw.open")]
    DrawOpen { path: String },
    #[serde(rename = "draw.export")]
    DrawExport { path: String, format: String },
    #[serde(rename = "submission.check")]
    SubmissionCheck {
        main_path: String,
        profile_id: Option<String>,
    },
    #[serde(rename = "submission.build")]
    SubmissionBuild {
        main_path: String,
        profile_id: Option<String>,
    },
    #[serde(rename = "submission.send")]
    SubmissionSend {
        artifact_id: String,
        channel: String,
    },
    #[serde(rename = "git.status")]
    GitStatus,
    #[serde(rename = "git.diff")]
    GitDiff { path: Option<String> },
    #[serde(rename = "git.commit")]
    GitCommit { message: String, paths: Vec<String> },
    #[serde(rename = "runtime.status")]
    RuntimeStatus,
    #[serde(rename = "runtime.update")]
    RuntimeUpdate { runtime_id: String },
    #[serde(rename = "plugin.status")]
    PluginStatus,
    #[serde(rename = "plugin.update")]
    PluginUpdate { plugin_id: String },
    #[serde(rename = "settings.change")]
    SettingsChange { patch: serde_json::Value },
}

impl AgentAppCommand {
    pub fn requires_analysis_approval(&self) -> bool {
        matches!(
            self,
            Self::AnalysisRun {
                spec: Some(spec),
                ..
            } if spec.method_family != "descriptive"
        )
    }

    pub fn mark_analysis_approved(&mut self) {
        if let Self::AnalysisRun {
            spec: Some(spec),
            approval_confirmed,
            ..
        } = self
        {
            spec.approval_confirmed = true;
            *approval_confirmed = true;
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResourceLock {
    pub lock_id: String,
    pub project_id: String,
    pub resource_path: String,
    pub mode: String,
    pub run_id: String,
    pub heartbeat_at: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResourceLockListInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResourceLockReleaseInput {
    pub project_id: String,
    pub run_id: String,
}

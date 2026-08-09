#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResearchPlanningDecision {
    Clarify,
    Ready,
    Blocked,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPlanningQuestion {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub choices: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPlanningStep {
    pub id: Option<String>,
    #[serde(default = "default_planning_step_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub dependencies: Vec<String>,
    pub capability: String,
    #[serde(default)]
    pub input: serde_json::Value,
}

fn default_planning_step_enabled() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPlanningPlan {
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub steps: Vec<ResearchPlanningStep>,
    #[serde(default)]
    pub expected_artifacts: Vec<String>,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPlanningEnvelope {
    pub decision: ResearchPlanningDecision,
    pub assistant_message: String,
    #[serde(default)]
    pub questions: Vec<ResearchPlanningQuestion>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    pub plan: Option<ResearchPlanningPlan>,
}

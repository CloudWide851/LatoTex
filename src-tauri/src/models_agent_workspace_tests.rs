use crate::models::AppSettings;

#[test]
fn agent_workspace_layout_preferences_round_trip_with_camel_case_fields() {
    let settings: AppSettings = serde_json::from_value(serde_json::json!({
        "activeProjectId": "project-1",
        "modelProtocols": [],
        "modelCatalog": [],
        "agentBindings": [],
        "uiPrefs": {
            "agentWorkspaceLayoutByProject": {
                "project-1": {
                    "tasksOpen": true,
                    "inspectorOpen": false,
                    "inspectorTab": "evidence",
                    "panelSizes": [18.0, 54.0, 28.0]
                }
            }
        }
    }))
    .expect("agent workspace settings should deserialize");

    let serialized = serde_json::to_value(settings).expect("settings should serialize");
    assert_eq!(
        serialized["uiPrefs"]["agentWorkspaceLayoutByProject"]["project-1"]["inspectorTab"],
        "evidence"
    );
    assert_eq!(
        serialized["uiPrefs"]["agentWorkspaceLayoutByProject"]["project-1"]["panelSizes"],
        serde_json::json!([18.0, 54.0, 28.0])
    );
}

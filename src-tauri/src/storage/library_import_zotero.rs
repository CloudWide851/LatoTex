enum ZoteroTarget {
    Item {
        scope: String,
        owner_id: String,
        key: String,
    },
    Collection {
        scope: String,
        owner_id: String,
        key: String,
    },
}

fn parse_zotero_target(
    link: &str,
    fallback_scope: Option<&str>,
    fallback_owner_id: Option<&str>,
) -> Option<ZoteroTarget> {
    let normalized = link
        .trim()
        .replace('\\', "/")
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    let lower = normalized.to_lowercase();
    let fallback_scope = match fallback_scope.unwrap_or("users").trim().to_ascii_lowercase().as_str() {
        "groups" => "groups",
        _ => "users",
    };
    let fallback_owner_id = fallback_owner_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if let Some(index) = lower.find("zotero://select/") {
        let suffix = &normalized[index + "zotero://select/".len()..];
        let parts: Vec<&str> = suffix.split('/').filter(|item| !item.trim().is_empty()).collect();
        if parts.len() >= 4 && matches!(parts[0], "users" | "groups") {
            let scope = parts[0].trim().to_ascii_lowercase();
            let owner_id = parts[1].trim().to_string();
            let kind = parts[2].trim().to_ascii_lowercase();
            let key = parts[3].trim().to_string();
            if owner_id.is_empty() || key.is_empty() {
                return None;
            }
            return match kind.as_str() {
                "items" => Some(ZoteroTarget::Item { scope, owner_id, key }),
                "collections" => Some(ZoteroTarget::Collection { scope, owner_id, key }),
                _ => None,
            };
        }
        if parts.len() >= 2 {
            let kind = parts[0].trim().to_ascii_lowercase();
            let key = parts[1].trim().to_string();
            let owner_id = fallback_owner_id?;
            return match kind.as_str() {
                "items" => Some(ZoteroTarget::Item {
                    scope: fallback_scope.to_string(),
                    owner_id,
                    key,
                }),
                "collections" => Some(ZoteroTarget::Collection {
                    scope: fallback_scope.to_string(),
                    owner_id,
                    key,
                }),
                _ => None,
            };
        }
    }
    let marker = if let Some(index) = lower.find("/users/") {
        Some((index + "/users/".len(), "users".to_string()))
    } else if let Some(index) = lower.find("/groups/") {
        Some((index + "/groups/".len(), "groups".to_string()))
    } else {
        None
    }?;

    let suffix = &normalized[marker.0..];
    let parts: Vec<&str> = suffix.split('/').filter(|item| !item.trim().is_empty()).collect();
    if parts.len() < 3 {
        return None;
    }
    let owner_id = parts[0].trim().to_string();
    let kind = parts[1].trim().to_ascii_lowercase();
    let key = parts[2].trim().to_string();
    if owner_id.is_empty() || key.is_empty() {
        return None;
    }

    match kind.as_str() {
        "items" => Some(ZoteroTarget::Item {
            scope: marker.1,
            owner_id,
            key,
        }),
        "collections" => Some(ZoteroTarget::Collection {
            scope: marker.1,
            owner_id,
            key,
        }),
        _ => None,
    }
}

fn fetch_zotero_bibtex(target: &ZoteroTarget, api_key_override: Option<&str>) -> Result<String, String> {
    let (scope, owner_id, endpoint_candidates) = match target {
        ZoteroTarget::Item {
            scope,
            owner_id,
            key,
        } => (
            scope.as_str(),
            owner_id.as_str(),
            zotero_api_url_candidates(&format!(
                "{scope}/{owner_id}/items/{key}?format=bibtex"
            )),
        ),
        ZoteroTarget::Collection {
            scope,
            owner_id,
            key,
        } => (
            scope.as_str(),
            owner_id.as_str(),
            zotero_api_url_candidates(&format!(
                "{scope}/{owner_id}/collections/{key}/items?format=bibtex&limit=100"
            )),
        ),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let api_key = api_key_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            std::env::var("ZOTERO_API_KEY")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        });
    let mut last_error = None;
    for endpoint in endpoint_candidates {
        let mut request = client
            .get(&endpoint)
            .header("Zotero-API-Version", "3");
        if let Some(key) = api_key.as_deref() {
            request = request.header("Zotero-API-Key", key);
        }
        match request.send() {
            Ok(response) if response.status().is_success() => {
                let text = response.text().map_err(|e| e.to_string())?;
                if text.trim().is_empty() {
                    last_error = Some("zotero.empty_response".to_string());
                    continue;
                }
                return Ok(text);
            }
            Ok(response) => {
                last_error = Some(format!(
                    "zotero.fetch_failed: scope={scope}, owner={owner_id}, endpoint={endpoint}, status={}",
                    response.status()
                ));
            }
            Err(error) => {
                last_error = Some(format!(
                    "zotero.fetch_failed: scope={scope}, owner={owner_id}, endpoint={endpoint}, error={error}"
                ));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        format!("zotero.fetch_failed: scope={scope}, owner={owner_id}, reason=no_endpoint")
    }))
}

fn parse_total_results(response: &reqwest::blocking::Response) -> Option<u32> {
    response
        .headers()
        .get("Total-Results")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u32>().ok())
}

fn count_bib_entries(content: &str) -> u32 {
    content
        .lines()
        .filter(|line| line.trim_start().starts_with('@'))
        .count() as u32
}

pub fn sync_zotero_library(
    db_path: &Path,
    project_id: &str,
    scope: Option<&str>,
    owner_id: &str,
    api_key: &str,
) -> Result<crate::models::LibraryZoteroSyncResponse, String> {
    let owner = owner_id.trim();
    if owner.is_empty() {
        return Err("zotero.owner_required".to_string());
    }
    let token = api_key.trim();
    if token.is_empty() {
        return Err("zotero.api_key_required".to_string());
    }
    let normalized_scope = match scope.unwrap_or("users").trim().to_ascii_lowercase().as_str() {
        "groups" => "groups",
        _ => "users",
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let mut start: u32 = 0;
    let limit: u32 = 100;
    let mut total_results: Option<u32> = None;
    let mut aggregated = String::new();
    let mut pages = 0_u32;
    let mut entry_count = 0_u32;

    loop {
        let endpoint_candidates = zotero_api_url_candidates(&format!(
            "{normalized_scope}/{owner}/items/top?format=bibtex&limit={limit}&start={start}"
        ));
        let mut response = None;
        let mut last_error = None;
        for endpoint in endpoint_candidates {
            match client
                .get(&endpoint)
                .header("Zotero-API-Version", "3")
                .header("Zotero-API-Key", token)
                .send()
            {
                Ok(candidate) if candidate.status().is_success() => {
                    response = Some(candidate);
                    break;
                }
                Ok(candidate) => {
                    last_error = Some(format!(
                        "zotero.sync_http_failed: endpoint={endpoint}, status={}",
                        candidate.status()
                    ));
                }
                Err(error) => {
                    last_error = Some(format!(
                        "zotero.sync_request_failed: endpoint={endpoint}, error={error}"
                    ));
                }
            }
        }
        let response = response.ok_or_else(|| {
            last_error.unwrap_or_else(|| "zotero.sync_request_failed: no_endpoint".to_string())
        })?;
        if total_results.is_none() {
            total_results = parse_total_results(&response);
        }
        let text = response
            .text()
            .map_err(|e| format!("zotero.sync_body_failed: {e}"))?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            break;
        }
        if !aggregated.is_empty() {
            aggregated.push_str("\n\n");
        }
        aggregated.push_str(trimmed);
        let page_entries = count_bib_entries(trimmed);
        entry_count = entry_count.saturating_add(page_entries);
        pages = pages.saturating_add(1);
        start = start.saturating_add(limit);

        if let Some(total) = total_results {
            if start >= total {
                break;
            }
        } else if page_entries < limit || pages >= 40 {
            break;
        }
    }

    if aggregated.trim().is_empty() {
        return Err("zotero.sync_empty".to_string());
    }

    let stem = format!(
        "zotero-{normalized_scope}-{owner}-full-sync-{}",
        Utc::now().format("%Y%m%d%H%M%S")
    );
    let target_bib = unique_path_with_extension(&papers_root, &stem, "bib");
    fs::write(&target_bib, aggregated).map_err(|e| e.to_string())?;

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    let relative_path =
        to_library_relative(&papers_root, &target_bib).map_err(|_| "zotero.sync_path_failed".to_string())?;
    Ok(crate::models::LibraryZoteroSyncResponse {
        relative_path,
        entry_count,
        total_results,
    })
}

#[cfg(test)]
mod library_import_zotero_tests {
    use super::{parse_zotero_target, ZoteroTarget};

    #[test]
    fn parses_zotero_select_link_with_explicit_scope_and_owner() {
        let parsed = parse_zotero_target(
            "zotero://select/groups/2405685/items/ABCD1234",
            None,
            None,
        );

        assert!(matches!(
            parsed,
            Some(ZoteroTarget::Item { scope, owner_id, key })
                if scope == "groups" && owner_id == "2405685" && key == "ABCD1234"
        ));
    }

    #[test]
    fn parses_local_zotero_select_link_with_ui_fallback_owner() {
        let parsed = parse_zotero_target(
            "zotero://select/items/ZXCV5678",
            Some("users"),
            Some("998877"),
        );

        assert!(matches!(
            parsed,
            Some(ZoteroTarget::Item { scope, owner_id, key })
                if scope == "users" && owner_id == "998877" && key == "ZXCV5678"
        ));
    }

    #[test]
    fn local_zotero_select_link_requires_fallback_owner() {
        let parsed = parse_zotero_target("zotero://select/items/ZXCV5678", Some("users"), None);
        assert!(parsed.is_none());
    }
}

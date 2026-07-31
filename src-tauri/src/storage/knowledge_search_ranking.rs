fn compare_knowledge_candidates(
    left_id: &str,
    left_score: f64,
    right_id: &str,
    right_score: f64,
) -> std::cmp::Ordering {
    right_score
        .partial_cmp(&left_score)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| left_id.cmp(right_id))
}

fn ranked_knowledge_seed_ids(
    candidates: &std::collections::HashMap<String, (f64, std::collections::BTreeSet<String>)>,
    limit: usize,
) -> Vec<String> {
    let mut ranked = candidates
        .iter()
        .map(|(evidence_id, (score, _))| (evidence_id.as_str(), *score))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| compare_knowledge_candidates(left.0, left.1, right.0, right.1));
    ranked
        .into_iter()
        .take(limit)
        .map(|(evidence_id, _)| evidence_id.to_string())
        .collect()
}

fn add_knowledge_match_once(
    candidate: &mut (f64, std::collections::BTreeSet<String>),
    score: f64,
    match_kind: &str,
) {
    if candidate.1.insert(match_kind.to_string()) {
        candidate.0 += score;
    }
}

#[cfg(test)]
mod knowledge_search_ranking_tests {
    use super::*;

    #[test]
    fn deep_seed_order_is_score_first_then_stable_id() {
        let mut candidates = std::collections::HashMap::new();
        candidates.insert(
            "evidence-z".to_string(),
            (2.0, std::collections::BTreeSet::new()),
        );
        candidates.insert(
            "evidence-b".to_string(),
            (4.0, std::collections::BTreeSet::new()),
        );
        candidates.insert(
            "evidence-a".to_string(),
            (4.0, std::collections::BTreeSet::new()),
        );

        assert_eq!(
            ranked_knowledge_seed_ids(&candidates, 2),
            vec!["evidence-a".to_string(), "evidence-b".to_string()]
        );
    }

    #[test]
    fn repeated_neighbor_expansion_contributes_once() {
        let mut candidate = (2.0, std::collections::BTreeSet::new());
        add_knowledge_match_once(&mut candidate, 0.5, "adjacent");
        add_knowledge_match_once(&mut candidate, 0.5, "adjacent");

        assert_eq!(candidate.0, 2.5);
        assert_eq!(
            candidate.1.into_iter().collect::<Vec<_>>(),
            vec!["adjacent"]
        );
    }
}

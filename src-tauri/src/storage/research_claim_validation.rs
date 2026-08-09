fn evidence_tokens(value: &str) -> std::collections::HashSet<String> {
    value
        .split(|ch: char| !ch.is_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.chars().count() >= 4)
        .take(512)
        .collect()
}

fn evidence_numeric_tokens(value: &str) -> std::collections::HashSet<String> {
    value
        .split(|character: char| {
            !(character.is_ascii_digit() || matches!(character, '.' | '-' | '%' | ','))
        })
        .map(|token| token.replace(',', ""))
        .filter(|token| token.chars().any(|character| character.is_ascii_digit()))
        .take(128)
        .collect()
}

fn evidence_unit_tokens(value: &str) -> std::collections::HashSet<String> {
    const UNITS: &[&str] = &[
        "%", "mg", "kg", "g", "ml", "mmhg", "hz", "days", "weeks", "months", "years", "天", "周",
        "月", "年",
    ];
    let mut tokens = value
        .split(|character: char| !character.is_alphanumeric() && character != '%')
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| UNITS.contains(&token.as_str()))
        .collect::<std::collections::HashSet<_>>();
    if value.contains('%') {
        tokens.insert("%".to_string());
    }
    tokens
}

fn evidence_direction(value: &str) -> i8 {
    let normalized = value.to_ascii_lowercase();
    let positive = [
        "improve",
        "increase",
        "higher",
        "positive effect",
        "改善",
        "增加",
        "升高",
    ];
    let negative = [
        "reduce", "decrease", "lower", "worsen", "减少", "下降", "降低", "恶化",
    ];
    let has_positive = positive.iter().any(|marker| normalized.contains(marker));
    let has_negative = negative.iter().any(|marker| normalized.contains(marker));
    match (has_positive, has_negative) {
        (true, false) => 1,
        (false, true) => -1,
        _ => 0,
    }
}

fn classify_claim(claim: &str, packets: &[EvidencePacket]) -> (String, String) {
    if packets.is_empty() {
        return (
            "insufficient".to_string(),
            "research.claim.no_evidence".to_string(),
        );
    }
    let claim_tokens = evidence_tokens(claim);
    if claim_tokens.is_empty() {
        return (
            "insufficient".to_string(),
            "research.claim.too_vague".to_string(),
        );
    }
    let eligible_packets = packets
        .iter()
        .filter(|packet| packet.retraction_status != "retracted")
        .collect::<Vec<_>>();
    if eligible_packets.is_empty() {
        return (
            "insufficient".to_string(),
            "research.claim.retracted_evidence_only".to_string(),
        );
    }
    let evidence_text = eligible_packets
        .iter()
        .map(|packet| packet.excerpt.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let combined_evidence_tokens = evidence_tokens(&evidence_text);
    let overlap = claim_tokens.intersection(&combined_evidence_tokens).count() as f64
        / claim_tokens.len().max(1) as f64;
    let claim_numbers = evidence_numeric_tokens(claim);
    let evidence_numbers = evidence_numeric_tokens(&evidence_text);
    if overlap >= 0.25 && !claim_numbers.is_empty() && !claim_numbers.is_subset(&evidence_numbers) {
        return (
            if evidence_numbers.is_empty() {
                "insufficient"
            } else {
                "contradicted"
            }
            .to_string(),
            if evidence_numbers.is_empty() {
                "research.claim.numeric_missing"
            } else {
                "research.claim.numeric_conflict"
            }
            .to_string(),
        );
    }
    let claim_units = evidence_unit_tokens(claim);
    let evidence_units = evidence_unit_tokens(&evidence_text);
    if overlap >= 0.25 && !claim_units.is_empty() && !claim_units.is_subset(&evidence_units) {
        return (
            if evidence_units.is_empty() {
                "insufficient"
            } else {
                "contradicted"
            }
            .to_string(),
            if evidence_units.is_empty() {
                "research.claim.unit_missing"
            } else {
                "research.claim.unit_conflict"
            }
            .to_string(),
        );
    }
    let claim_direction = evidence_direction(claim);
    let evidence_direction = evidence_direction(&evidence_text);
    if overlap >= 0.25
        && claim_direction != 0
        && evidence_direction != 0
        && claim_direction != evidence_direction
    {
        return (
            "contradicted".to_string(),
            "research.claim.direction_conflict".to_string(),
        );
    }
    let contradiction_markers = [
        "contradict",
        "not associated",
        "no evidence",
        "no statistically significant",
        "no significant",
        "did not improve",
        "refuted",
        "相反",
        "无证据",
        "无统计学显著",
        "无显著",
        "未改善",
        "不支持",
    ];
    let contradicted = eligible_packets.iter().any(|packet| {
        let excerpt = packet.excerpt.to_lowercase();
        let packet_tokens = evidence_tokens(&excerpt);
        let packet_overlap = claim_tokens.intersection(&packet_tokens).count() as f64
            / claim_tokens.len().max(1) as f64;
        packet_overlap >= 0.25
            && contradiction_markers
                .iter()
                .any(|marker| excerpt.contains(marker))
    });
    if contradicted {
        return (
            "contradicted".to_string(),
            "research.claim.contradicted".to_string(),
        );
    }
    if overlap >= 0.6 {
        if eligible_packets
            .iter()
            .all(|packet| packet.correction_status == "expression_of_concern")
        {
            return (
                "partial".to_string(),
                "research.claim.correction_review_required".to_string(),
            );
        }
        (
            "supported".to_string(),
            "research.claim.supported".to_string(),
        )
    } else if overlap >= 0.25 {
        ("partial".to_string(), "research.claim.partial".to_string())
    } else {
        (
            "insufficient".to_string(),
            "research.claim.insufficient".to_string(),
        )
    }
}

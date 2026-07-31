#[cfg(test)]
mod tests {
    use super::{
        cache_key, load_provider_cache, outcome, persist_provider_cache, record_circuit_result,
        ProviderCategory, ProviderDomain, ProviderError, ProviderSpec, ACADEMIC_FRESH_TTL,
        ACADEMIC_STALE_TTL, WEB_FRESH_TTL, WEB_STALE_TTL,
    };

    #[test]
    fn cache_policies_match_research_source_classes() {
        assert_eq!(ProviderCategory::Academic.fresh_ttl(), ACADEMIC_FRESH_TTL);
        assert_eq!(ProviderCategory::Academic.stale_ttl(), ACADEMIC_STALE_TTL);
        assert_eq!(ProviderCategory::Web.fresh_ttl(), WEB_FRESH_TTL);
        assert_eq!(ProviderCategory::Web.stale_ttl(), WEB_STALE_TTL);
        assert!(ACADEMIC_STALE_TTL > ACADEMIC_FRESH_TTL);
        assert!(WEB_STALE_TTL > WEB_FRESH_TTL);
    }

    #[test]
    fn cache_key_normalizes_query_without_logging_it() {
        let spec = ProviderSpec {
            index: 99,
            name: "fixture",
            category: ProviderCategory::Academic,
            domain: ProviderDomain::General,
        };
        let key = cache_key(spec, "  Stable   Query ", 5, None);
        assert_eq!(key, cache_key(spec, "stable query", 5, None));
        assert_eq!(key.len(), 64);
        assert!(!key.contains("stable"));
    }

    #[test]
    fn retryable_failures_open_a_bounded_circuit() {
        let spec = ProviderSpec {
            index: 98,
            name: "fixture_circuit",
            category: ProviderCategory::Academic,
            domain: ProviderDomain::General,
        };
        let failure = Err(ProviderError {
            code: "academic.fixture.timeout".to_string(),
            retryable: true,
        });
        for _ in 0..3 {
            record_circuit_result(spec, &failure);
        }
        let root =
            std::env::temp_dir().join(format!("latotex-provider-circuit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("cache.sqlite3");
        let result =
            super::execute_provider_single_flight(&db_path, spec, "query".to_string(), 1, None);
        assert!(result
            .unwrap_err()
            .code
            .ends_with("fixture_circuit.circuit_open"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn provider_failures_keep_stable_health_metadata() {
        let spec = ProviderSpec {
            index: 97,
            name: "fixture_health",
            category: ProviderCategory::Web,
            domain: ProviderDomain::General,
        };
        let value = outcome(
            spec,
            Err(ProviderError {
                code: "academic.fixture_health.timeout".to_string(),
                retryable: true,
            }),
            "live",
            None,
        );
        assert_eq!(value.health.category, "web");
        assert_eq!(value.health.status, "failed");
        assert!(value.failure.unwrap().retryable);
    }

    #[test]
    fn persistent_cache_round_trips_stable_failures_without_raw_queries() {
        let root =
            std::env::temp_dir().join(format!("latotex-provider-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("cache.sqlite3");
        let spec = ProviderSpec {
            index: 96,
            name: "fixture_persistent",
            category: ProviderCategory::Academic,
            domain: ProviderDomain::General,
        };
        let key = cache_key(spec, "secret research query", 4, None);
        persist_provider_cache(
            &db_path,
            &key,
            spec,
            &Err(ProviderError {
                code: "academic.fixture_persistent.timeout".to_string(),
                retryable: true,
            }),
        );
        let loaded = load_provider_cache(&db_path, &key).unwrap();
        assert_eq!(
            loaded.result.unwrap_err().code,
            "academic.fixture_persistent.timeout"
        );
        let bytes = std::fs::read(&db_path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("secret research query"));
        let _ = std::fs::remove_dir_all(root);
    }
}

use super::analysis_academic_providers::{
    search_arxiv, search_crossref, search_duckduckgo, search_openalex, search_wikipedia,
    ProviderError,
};
use super::analysis_domain_providers::{search_dblp, search_doaj, search_openaire, search_pubmed};
use super::analysis_research_providers::{
    search_europe_pmc, search_semantic_scholar, search_unpaywall, unpaywall_enabled,
};
use super::{AcademicProviderFailure, AcademicProviderHealth, ReferenceEvidence};
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

const PROVIDER_PARALLELISM: usize = 4;
const TRANSIENT_FAILURE_TTL: Duration = Duration::from_secs(60);
const ACADEMIC_FRESH_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ACADEMIC_STALE_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const WEB_FRESH_TTL: Duration = Duration::from_secs(30 * 60);
const WEB_STALE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const CIRCUIT_FAILURE_THRESHOLD: u32 = 3;
const CIRCUIT_OPEN_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProviderCategory {
    Academic,
    Web,
}

impl ProviderCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::Academic => "academic",
            Self::Web => "web",
        }
    }

    fn fresh_ttl(self) -> Duration {
        match self {
            Self::Academic => ACADEMIC_FRESH_TTL,
            Self::Web => WEB_FRESH_TTL,
        }
    }

    fn stale_ttl(self) -> Duration {
        match self {
            Self::Academic => ACADEMIC_STALE_TTL,
            Self::Web => WEB_STALE_TTL,
        }
    }
}

#[derive(Clone, Copy)]
struct ProviderSpec {
    index: usize,
    name: &'static str,
    category: ProviderCategory,
    domain: ProviderDomain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProviderDomain {
    General,
    Biomedical,
    Computing,
    OpenAccess,
}

const PROVIDERS: [ProviderSpec; 11] = [
    ProviderSpec {
        index: 0,
        name: "openalex",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 1,
        name: "crossref",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 2,
        name: "arxiv",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 3,
        name: "semantic_scholar",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 4,
        name: "europe_pmc",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::Biomedical,
    },
    ProviderSpec {
        index: 5,
        name: "duckduckgo",
        category: ProviderCategory::Web,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 6,
        name: "wikipedia",
        category: ProviderCategory::Web,
        domain: ProviderDomain::General,
    },
    ProviderSpec {
        index: 7,
        name: "pubmed",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::Biomedical,
    },
    ProviderSpec {
        index: 8,
        name: "doaj",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::OpenAccess,
    },
    ProviderSpec {
        index: 9,
        name: "dblp",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::Computing,
    },
    ProviderSpec {
        index: 10,
        name: "openaire",
        category: ProviderCategory::Academic,
        domain: ProviderDomain::OpenAccess,
    },
];

const UNPAYWALL: ProviderSpec = ProviderSpec {
    index: 11,
    name: "unpaywall",
    category: ProviderCategory::Academic,
    domain: ProviderDomain::OpenAccess,
};

#[derive(Clone)]
struct CacheEntry {
    stored_at: Instant,
    result: Result<Vec<ReferenceEvidence>, ProviderError>,
}

include!("analysis_search_cache.rs");

#[derive(Default)]
struct CircuitState {
    failures: u32,
    opened_at: Option<Instant>,
}

#[derive(Default)]
struct ProviderFlight {
    result: Mutex<Option<Result<Vec<ReferenceEvidence>, ProviderError>>>,
    ready: Condvar,
}

struct ProviderPermit;

impl Drop for ProviderPermit {
    fn drop(&mut self) {
        let (active, ready) = PROVIDER_SEMAPHORE.get_or_init(|| (Mutex::new(0), Condvar::new()));
        let mut active = active.lock().unwrap_or_else(|error| error.into_inner());
        *active = active.saturating_sub(1);
        ready.notify_one();
    }
}

static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
static CIRCUITS: OnceLock<Mutex<HashMap<&'static str, CircuitState>>> = OnceLock::new();
static FLIGHTS: OnceLock<Mutex<HashMap<String, Arc<ProviderFlight>>>> = OnceLock::new();
static PROVIDER_SEMAPHORE: OnceLock<(Mutex<usize>, Condvar)> = OnceLock::new();

#[derive(Clone)]
struct ProviderOutcome {
    spec: ProviderSpec,
    items: Vec<ReferenceEvidence>,
    failure: Option<AcademicProviderFailure>,
    health: AcademicProviderHealth,
}

pub(super) struct RemoteSearchBundle {
    pub academic_lists: Vec<Vec<ReferenceEvidence>>,
    pub web_lists: Vec<Vec<ReferenceEvidence>>,
    pub failures: Vec<AcademicProviderFailure>,
    pub health: Vec<AcademicProviderHealth>,
}

fn lock_cache() -> std::sync::MutexGuard<'static, HashMap<String, CacheEntry>> {
    CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

fn acquire_provider_permit() -> ProviderPermit {
    let (active, ready) = PROVIDER_SEMAPHORE.get_or_init(|| (Mutex::new(0), Condvar::new()));
    let mut active = active.lock().unwrap_or_else(|error| error.into_inner());
    while *active >= PROVIDER_PARALLELISM {
        active = ready
            .wait(active)
            .unwrap_or_else(|error| error.into_inner());
    }
    *active += 1;
    ProviderPermit
}

fn circuit_open(spec: ProviderSpec) -> bool {
    let mut circuits = CIRCUITS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(state) = circuits.get_mut(spec.name) else {
        return false;
    };
    if state
        .opened_at
        .is_some_and(|opened| opened.elapsed() < CIRCUIT_OPEN_TTL)
    {
        return true;
    }
    if state.opened_at.is_some() {
        state.failures = 0;
        state.opened_at = None;
    }
    false
}

fn record_circuit_result(
    spec: ProviderSpec,
    result: &Result<Vec<ReferenceEvidence>, ProviderError>,
) {
    let mut circuits = CIRCUITS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let state = circuits.entry(spec.name).or_default();
    match result {
        Ok(_) => {
            state.failures = 0;
            state.opened_at = None;
        }
        Err(error) if error.retryable => {
            state.failures = state.failures.saturating_add(1);
            if state.failures >= CIRCUIT_FAILURE_THRESHOLD {
                state.opened_at = Some(Instant::now());
            }
        }
        Err(_) => {}
    }
}

fn provider_relevant(spec: ProviderSpec, query: &str) -> bool {
    let normalized = query.to_lowercase();
    match spec.domain {
        ProviderDomain::General | ProviderDomain::OpenAccess => true,
        ProviderDomain::Biomedical => [
            "pmid",
            "patient",
            "clinical",
            "disease",
            "gene",
            "protein",
            "biomedical",
            "randomized",
            "cohort",
            "pico",
            "医学",
            "临床",
            "疾病",
            "基因",
        ]
        .iter()
        .any(|term| normalized.contains(term)),
        ProviderDomain::Computing => [
            "algorithm",
            "computer",
            "software",
            "database",
            "machine learning",
            "neural",
            "information retrieval",
            "算法",
            "计算机",
            "软件",
            "机器学习",
        ]
        .iter()
        .any(|term| normalized.contains(term)),
    }
}

fn call_live_provider(
    spec: ProviderSpec,
    query: &str,
    limit: usize,
    contact_email: Option<&str>,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    match spec.name {
        "openalex" => search_openalex(query, limit),
        "crossref" => search_crossref(query, limit),
        "arxiv" => search_arxiv(query, limit),
        "semantic_scholar" => search_semantic_scholar(query, limit),
        "europe_pmc" => search_europe_pmc(query, limit),
        "pubmed" => search_pubmed(query, limit),
        "doaj" => search_doaj(query, limit),
        "dblp" => search_dblp(query, limit),
        "openaire" => search_openaire(query, limit),
        "duckduckgo" => search_duckduckgo(query, limit),
        "wikipedia" => search_wikipedia(query, limit),
        "unpaywall" => search_unpaywall(query, contact_email.unwrap_or_default()),
        _ => Err(ProviderError {
            code: "academic.provider.unsupported".to_string(),
            retryable: false,
        }),
    }
}

fn execute_provider_single_flight(
    db_path: &std::path::Path,
    spec: ProviderSpec,
    query: String,
    limit: usize,
    contact_email: Option<String>,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let key = cache_key(spec, &query, limit, contact_email.as_deref());
    let (flight, leader) = {
        let mut flights = FLIGHTS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(flight) = flights.get(&key) {
            (flight.clone(), false)
        } else {
            let flight = Arc::new(ProviderFlight::default());
            flights.insert(key.clone(), flight.clone());
            (flight, true)
        }
    };
    if !leader {
        let mut state = flight
            .result
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while state.is_none() {
            state = flight
                .ready
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }
        return state.clone().expect("provider flight result");
    }

    let result = if circuit_open(spec) {
        Err(ProviderError {
            code: format!("academic.{}.circuit_open", spec.name),
            retryable: true,
        })
    } else {
        let _permit = acquire_provider_permit();
        call_live_provider(spec, &query, limit, contact_email.as_deref())
    };
    record_circuit_result(spec, &result);
    persist_provider_cache(db_path, &key, spec, &result);
    lock_cache().insert(
        key.clone(),
        CacheEntry {
            stored_at: Instant::now(),
            result: result.clone(),
        },
    );
    {
        let mut state = flight
            .result
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *state = Some(result.clone());
    }
    flight.ready.notify_all();
    FLIGHTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&key);
    result
}

fn outcome(
    spec: ProviderSpec,
    result: Result<Vec<ReferenceEvidence>, ProviderError>,
    status: &str,
    cache_age_seconds: Option<u64>,
) -> ProviderOutcome {
    match result {
        Ok(items) => ProviderOutcome {
            spec,
            health: AcademicProviderHealth {
                provider: spec.name.to_string(),
                category: spec.category.as_str().to_string(),
                status: status.to_string(),
                result_count: items.len(),
                cache_age_seconds,
                code: None,
                retryable: false,
            },
            items,
            failure: None,
        },
        Err(error) => {
            let status = if error.code.ends_with(".circuit_open") {
                "circuit_open"
            } else {
                "failed"
            };
            ProviderOutcome {
                spec,
                items: Vec::new(),
                failure: Some(AcademicProviderFailure {
                    provider: spec.name.to_string(),
                    code: error.code.clone(),
                    retryable: error.retryable,
                }),
                health: AcademicProviderHealth {
                    provider: spec.name.to_string(),
                    category: spec.category.as_str().to_string(),
                    status: status.to_string(),
                    result_count: 0,
                    cache_age_seconds,
                    code: Some(error.code),
                    retryable: error.retryable,
                },
            }
        }
    }
}

fn resolve_provider(
    db_path: &std::path::Path,
    spec: ProviderSpec,
    query: String,
    limit: usize,
    contact_email: Option<String>,
) -> ProviderOutcome {
    let key = cache_key(spec, &query, limit, contact_email.as_deref());
    let cached = lock_cache()
        .get(&key)
        .cloned()
        .or_else(|| load_provider_cache(db_path, &key));
    if let Some(entry) = cached {
        lock_cache().insert(key.clone(), entry.clone());
        let age = entry.stored_at.elapsed();
        let age_seconds = Some(age.as_secs());
        match &entry.result {
            Ok(_) if age < spec.category.fresh_ttl() => {
                return outcome(spec, entry.result, "fresh_cache", age_seconds);
            }
            Ok(_) if age < spec.category.stale_ttl() => {
                let refresh_query = query.clone();
                let refresh_email = contact_email.clone();
                let refresh_db_path = db_path.to_path_buf();
                std::thread::spawn(move || {
                    let _ = execute_provider_single_flight(
                        &refresh_db_path,
                        spec,
                        refresh_query,
                        limit,
                        refresh_email,
                    );
                });
                return outcome(spec, entry.result, "stale_cache", age_seconds);
            }
            Err(_) if age < TRANSIENT_FAILURE_TTL => {
                return outcome(spec, entry.result, "failed", age_seconds);
            }
            _ => {}
        }
    }
    outcome(
        spec,
        execute_provider_single_flight(db_path, spec, query, limit, contact_email),
        "live",
        None,
    )
}

pub(super) fn run_remote_providers(
    db_path: &std::path::Path,
    query: &str,
    limit: usize,
    contact_email: Option<&str>,
) -> RemoteSearchBundle {
    let (sender, receiver) = std::sync::mpsc::channel::<ProviderOutcome>();
    std::thread::scope(|scope| {
        for spec in PROVIDERS
            .into_iter()
            .filter(|spec| provider_relevant(*spec, query))
        {
            let sender = sender.clone();
            let query = query.to_string();
            scope.spawn(move || {
                let _ = sender.send(resolve_provider(db_path, spec, query, limit, None));
            });
        }
        if unpaywall_enabled(query, contact_email) {
            let sender = sender.clone();
            let query = query.to_string();
            let contact_email = contact_email.map(str::to_string);
            scope.spawn(move || {
                let _ = sender.send(resolve_provider(
                    db_path,
                    UNPAYWALL,
                    query,
                    limit.min(1),
                    contact_email,
                ));
            });
        }
    });
    drop(sender);

    let mut outcomes = receiver.into_iter().collect::<Vec<_>>();
    outcomes.sort_by_key(|entry| entry.spec.index);
    let mut health = Vec::new();
    let mut failures = Vec::new();
    let mut academic_lists = Vec::new();
    let mut web_lists = Vec::new();
    for entry in outcomes {
        if let Some(failure) = entry.failure {
            failures.push(failure);
        }
        health.push(entry.health);
        if entry.items.is_empty() {
            continue;
        }
        match entry.spec.category {
            ProviderCategory::Academic => academic_lists.push(entry.items),
            ProviderCategory::Web => web_lists.push(entry.items),
        }
    }
    for spec in PROVIDERS
        .into_iter()
        .filter(|spec| !provider_relevant(*spec, query))
    {
        health.push(AcademicProviderHealth {
            provider: spec.name.to_string(),
            category: spec.category.as_str().to_string(),
            status: "skipped".to_string(),
            result_count: 0,
            cache_age_seconds: None,
            code: Some("academic.provider.domain_irrelevant".to_string()),
            retryable: false,
        });
    }
    if !unpaywall_enabled(query, contact_email) {
        health.push(AcademicProviderHealth {
            provider: "unpaywall".to_string(),
            category: "academic".to_string(),
            status: "disabled".to_string(),
            result_count: 0,
            cache_age_seconds: None,
            code: Some("academic.unpaywall.contact_or_doi_required".to_string()),
            retryable: false,
        });
    }
    RemoteSearchBundle {
        academic_lists,
        web_lists,
        failures,
        health,
    }
}

#[cfg(test)]
include!("analysis_search_coordinator_tests.rs");

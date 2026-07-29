use super::{parse_arxiv, parse_crossref, parse_openalex};

#[test]
fn parses_openalex_fixture_with_abstract_and_provenance() {
    let fixture = br#"{
      "results": [{
        "id": "https://openalex.org/W123",
        "doi": "https://doi.org/10.1000/Fixture",
        "title": "A Reproducible Fixture",
        "publication_year": 2026,
        "cited_by_count": 17,
        "authorships": [{"author": {"display_name": "Ada Researcher"}}],
        "primary_location": {
          "landing_page_url": "https://example.test/paper",
          "pdf_url": "https://example.test/paper.pdf",
          "source": {"display_name": "Fixture Journal"}
        },
        "open_access": {"is_oa": true},
        "abstract_inverted_index": {
          "Evidence": [0],
          "is": [1],
          "bounded": [2]
        }
      }]
    }"#;
    let parsed = parse_openalex(fixture, 5).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].stable_id, "doi:10.1000/fixture");
    assert_eq!(parsed[0].authors, vec!["Ada Researcher"]);
    assert_eq!(
        parsed[0].abstract_text.as_deref(),
        Some("Evidence is bounded")
    );
    assert_eq!(parsed[0].evidence_level, "abstract");
    assert_eq!(parsed[0].provenance, vec!["openalex"]);
}

#[test]
fn parses_crossref_fixture_with_pdf_and_normalized_doi() {
    let fixture = br#"{
      "message": {
        "items": [{
          "DOI": "10.1000/FIXTURE",
          "title": ["A Reproducible Fixture"],
          "container-title": ["Fixture Journal"],
          "author": [{"given": "Ada", "family": "Researcher"}],
          "issued": {"date-parts": [[2026, 7, 29]]},
          "URL": "https://doi.org/10.1000/FIXTURE",
          "is-referenced-by-count": 21,
          "link": [{
            "content-type": "application/pdf",
            "URL": "https://example.test/paper.pdf"
          }]
        }]
      }
    }"#;
    let parsed = parse_crossref(fixture, 5).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].doi.as_deref(), Some("10.1000/fixture"));
    assert_eq!(parsed[0].year, Some(2026));
    assert_eq!(
        parsed[0].pdf_url.as_deref(),
        Some("https://example.test/paper.pdf")
    );
    assert_eq!(parsed[0].open_access, Some(true));
}

#[test]
fn parses_arxiv_fixture_without_network() {
    let fixture = r#"<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>https://arxiv.org/abs/2607.01234v2</id>
          <title> Bounded Academic Evidence </title>
          <summary> A fixture abstract with explicit evidence. </summary>
          <published>2026-07-29T00:00:00Z</published>
          <author><name>Ada Researcher</name></author>
          <link title="pdf" href="https://arxiv.org/pdf/2607.01234"/>
        </entry>
      </feed>"#;
    let parsed = parse_arxiv(fixture, 5).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].stable_id, "arxiv:2607.01234");
    assert_eq!(parsed[0].arxiv_id.as_deref(), Some("2607.01234"));
    assert_eq!(parsed[0].authors, vec!["Ada Researcher"]);
    assert_eq!(parsed[0].evidence_level, "abstract");
}

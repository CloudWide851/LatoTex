use super::*;

#[test]
fn extract_crossref_pdf_urls_reads_pdf_links_from_message() {
    let payload = serde_json::json!({
        "link": [
            {
                "URL": "https://example.org/paper.pdf",
                "content-type": "application/pdf"
            },
            {
                "URL": "https://example.org/landing",
                "content-type": "text/html"
            }
        ]
    });

    let urls = extract_crossref_pdf_urls(&payload);

    assert_eq!(urls, vec!["https://example.org/paper.pdf"]);
}

#[test]
fn extract_pdf_links_from_html_reads_citation_pdf_url_and_relative_links() {
    let html = r#"
      <html>
        <head>
          <meta name="citation_pdf_url" content="/content/paper.pdf" />
        </head>
        <body>
          <a href="/downloads/paper.pdf">Download PDF</a>
          <a href="/article?id=123&type=printable">Printable View</a>
        </body>
      </html>
    "#;

    let urls = extract_pdf_links_from_html(html, "https://example.org/article?id=123");

    assert!(urls.contains(&"https://example.org/content/paper.pdf".to_string()));
    assert!(urls.contains(&"https://example.org/downloads/paper.pdf".to_string()));
    assert!(
        !urls.iter().any(|item| item.contains("type=printable")),
        "printable html fallback must not be treated as a PDF"
    );
}

#[test]
fn merge_remote_metadata_preserves_existing_fields_and_adds_urls() {
    let mut target = CitationRemoteMetadata {
        title: Some("Existing".to_string()),
        authors: vec!["Alice".to_string()],
        published_at: None,
        doi: Some("10.1000/test".to_string()),
        arxiv_id: None,
        source: Some("crossref".to_string()),
        urls: vec!["https://doi.org/10.1000/test".to_string()],
    };
    let source = CitationRemoteMetadata {
        title: Some("Incoming".to_string()),
        authors: vec!["Bob".to_string()],
        published_at: Some("2024-01-01".to_string()),
        doi: Some("10.1000/test".to_string()),
        arxiv_id: Some("2401.12345".to_string()),
        source: Some("meta".to_string()),
        urls: vec!["https://example.org/paper.pdf".to_string()],
    };

    merge_remote_metadata(&mut target, source);

    assert_eq!(target.title.as_deref(), Some("Existing"));
    assert_eq!(target.published_at.as_deref(), Some("2024-01-01"));
    assert_eq!(target.arxiv_id.as_deref(), Some("2401.12345"));
    assert!(target.authors.iter().any(|item| item == "Alice"));
    assert!(target.authors.iter().any(|item| item == "Bob"));
    assert!(target.urls.iter().any(|item| item == "https://example.org/paper.pdf"));
}

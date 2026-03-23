use std::cmp::Ordering;
use std::path::Path;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(super) struct OcrExtractionCandidate {
    pub text: String,
    pub engine: String,
    pub confidence: f32,
}

pub(super) fn normalize_for_blocks(raw: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut line = String::new();
    for ch in raw.chars() {
        let keep = ch.is_alphanumeric()
            || ch.is_whitespace()
            || matches!(
                ch,
                '\\'
                    | '/'
                    | '(' | ')'
                    | '[' | ']'
                    | '{' | '}'
                    | ',' | '.' | ':' | ';' | '-' | '_'
                    | '+' | '=' | '*' | '^' | '%'
                    | '，' | '。' | '；' | '：' | '（' | '）'
                    | '《' | '》' | '“' | '”' | '、'
            )
            || is_han(ch);
        if keep {
            line.push(ch);
            if ch == '\n' {
                let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
                if compact.chars().count() >= 8 {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(compact.trim());
                }
                line.clear();
            }
        } else {
            if line.chars().count() >= 8 {
                let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
                if !compact.is_empty() {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(compact.trim());
                }
            }
            line.clear();
        }
        if out.chars().count() >= max_chars {
            break;
        }
    }
    if out.chars().count() < max_chars && line.chars().count() >= 8 {
        let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !compact.is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(compact.trim());
        }
    }
    out.chars().take(max_chars).collect::<String>()
}

fn shell_quote_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('"', "\"\"");
    format!("\"{}\"", raw)
}

fn build_command_line(template: &str, pdf_path: &Path) -> String {
    let quoted = shell_quote_path(pdf_path);
    let trimmed = template.trim();
    if trimmed.contains("{input}") {
        trimmed.replace("{input}", &quoted)
    } else {
        format!("{trimmed} {quoted}")
    }
}

fn run_shell_command_line(command_line: &str) -> Option<String> {
    let output = if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        #[cfg(target_os = "windows")]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command.args(["/C", command_line]).output().ok()?
    } else {
        Command::new("sh").args(["-lc", command_line]).output().ok()?
    };
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn ascii_fallback(bytes: &[u8], max_chars: usize) -> String {
    let mut out = String::new();
    let mut current = String::new();
    for &byte in bytes {
        let ch = byte as char;
        let printable = ch.is_ascii_graphic() || ch == ' ';
        if printable {
            current.push(ch);
            continue;
        }
        if current.len() >= 20 {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(current.trim());
            if out.len() >= max_chars {
                break;
            }
        }
        current.clear();
    }
    if out.len() < max_chars && current.len() >= 20 {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(current.trim());
    }
    out.chars().take(max_chars).collect::<String>()
}

fn utf8_candidate(bytes: &[u8], max_chars: usize) -> String {
    let raw = String::from_utf8_lossy(bytes).to_string();
    normalize_for_blocks(&raw, max_chars)
}

fn utf16_le_candidate(bytes: &[u8], max_chars: usize) -> String {
    let mut values = Vec::<u16>::new();
    for chunk in bytes.chunks_exact(2) {
        values.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    let raw = String::from_utf16_lossy(&values);
    normalize_for_blocks(&raw, max_chars)
}

fn run_external_pdf_text(command: &str, pdf_path: &Path) -> Option<String> {
    if command.trim().is_empty() {
        return None;
    }
    let command_line = build_command_line(command, pdf_path);
    run_shell_command_line(&command_line)
}

fn sidecar_text_candidates(pdf_path: &Path, max_chars: usize) -> Option<OcrExtractionCandidate> {
    let mut best: Option<OcrExtractionCandidate> = None;
    let candidates = [
        pdf_path.with_extension("txt"),
        pdf_path.with_extension("ocr.txt"),
        pdf_path.with_extension("md"),
    ];
    for candidate in candidates {
        if !candidate.exists() || !candidate.is_file() {
            continue;
        }
        let raw = match std::fs::read_to_string(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let normalized = normalize_for_blocks(&raw, max_chars);
        if normalized.trim().is_empty() {
            continue;
        }
        let score = text_quality_score(&normalized);
        if score < 0.22 {
            continue;
        }
        let confidence = (0.70_f32 + score * 0.22).clamp(0.68, 0.97);
        let next = OcrExtractionCandidate {
            text: normalized,
            engine: format!(
                "sidecar.{}",
                candidate
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("txt")
                    .to_lowercase()
            ),
            confidence,
        };
        let replace = best
            .as_ref()
            .map(|item| text_quality_score(&item.text) < score)
            .unwrap_or(true);
        if replace {
            best = Some(next);
        }
    }
    best
}

fn is_han(ch: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&ch) || ('\u{3400}'..='\u{4DBF}').contains(&ch)
}

fn punctuation_ratio(input: &str) -> f32 {
    let mut total = 0_f32;
    let mut punct = 0_f32;
    for ch in input.chars() {
        if ch.is_whitespace() {
            continue;
        }
        total += 1.0;
        if ch.is_ascii_punctuation()
            || matches!(
                ch,
                '，' | '。' | '；' | '：' | '（' | '）' | '《' | '》' | '“' | '”' | '、' | '—'
            )
        {
            punct += 1.0;
        }
    }
    if total <= 0.0 {
        0.0
    } else {
        punct / total
    }
}

pub(super) fn text_quality_score(input: &str) -> f32 {
    let char_count = input.chars().count() as f32;
    if char_count < 40.0 {
        return 0.0;
    }
    let non_ws = input.chars().filter(|c| !c.is_whitespace()).count() as f32;
    if non_ws <= 0.0 {
        return 0.0;
    }
    let replacement = input.chars().filter(|c| *c == '�').count() as f32 / non_ws.max(1.0);
    let line_count = input.lines().filter(|line| !line.trim().is_empty()).count() as f32;
    let han = chinese_ratio(input);
    let punct = punctuation_ratio(input);
    let len_score = (char_count / 26_000.0).clamp(0.0, 1.0);
    let line_score = (line_count / 140.0).clamp(0.0, 1.0);
    let noise_score = (1.0 - replacement).clamp(0.0, 1.0);
    let punct_score = if punct < 0.03 {
        punct / 0.03
    } else if punct > 0.42 {
        (1.0 - ((punct - 0.42) / 0.58)).clamp(0.0, 1.0)
    } else {
        1.0
    };
    (len_score * 0.42)
        + (line_score * 0.20)
        + (noise_score * 0.26)
        + (punct_score * 0.10)
        + (han * 0.02)
}

fn default_external_candidates(pdf_path: &Path, max_chars: usize) -> Option<OcrExtractionCandidate> {
    let commands = [
        ("pdftotext.layout", "pdftotext -enc UTF-8 -layout -nopgbrk {input} -"),
        ("pdftotext.raw", "pdftotext -enc UTF-8 -raw -nopgbrk {input} -"),
        ("mutool.txt", "mutool draw -F txt -o - {input}"),
        ("tesseract.zh", "tesseract {input} stdout -l chi_sim+eng --dpi 300"),
        ("tesseract.en", "tesseract {input} stdout -l eng --dpi 300"),
    ];
    let mut best: Option<OcrExtractionCandidate> = None;
    for (name, command) in commands {
        if let Some(text) = run_external_pdf_text(command, pdf_path) {
            let normalized = normalize_for_blocks(&text, max_chars);
            if normalized.trim().is_empty() {
                continue;
            }
            let score = text_quality_score(&normalized);
            if score < 0.2 {
                continue;
            }
            let confidence = (0.60_f32 + score * 0.35).clamp(0.56, 0.95);
            let next = OcrExtractionCandidate {
                text: normalized,
                engine: format!("external.{name}"),
                confidence,
            };
            let replace = best
                .as_ref()
                .map(|item| text_quality_score(&item.text) < score)
                .unwrap_or(true);
            if replace {
                best = Some(next);
            }
        }
    }
    best
}

fn chinese_ratio(input: &str) -> f32 {
    let mut total = 0_f32;
    let mut han = 0_f32;
    for ch in input.chars() {
        if ch.is_whitespace() {
            continue;
        }
        total += 1.0;
        if is_han(ch) {
            han += 1.0;
        }
    }
    if total <= 0.0 {
        0.0
    } else {
        han / total
    }
}

fn has_common_chinese_tokens(input: &str) -> bool {
    const TOKENS: [&str; 12] = [
        "的", "了", "和", "研究", "方法", "结果", "本文", "我们", "模型", "数据", "系统", "实验",
    ];
    TOKENS.iter().filter(|token| input.contains(**token)).count() >= 2
}

pub(super) fn detect_source_language(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let ratio = chinese_ratio(text);
    let han_count = text.chars().filter(|ch| is_han(*ch)).count();
    if ratio > 0.10 || han_count >= 28 || has_common_chinese_tokens(text) {
        return Some("zh-CN".to_string());
    }
    Some("en-US".to_string())
}

pub(super) fn extract_pdf_text_with_local_ocr(
    pdf_path: &Path,
    bytes: &[u8],
    max_chars: usize,
) -> Option<OcrExtractionCandidate> {
    if let Some(sidecar) = sidecar_text_candidates(pdf_path, max_chars) {
        return Some(sidecar);
    }

    if let Ok(cmd) = std::env::var("LATOTEX_PDF_OCR_CMD") {
        if let Some(text) = run_external_pdf_text(&cmd, pdf_path) {
            let normalized = normalize_for_blocks(&text, max_chars);
            if !normalized.trim().is_empty() {
                let quality = text_quality_score(&normalized);
                return Some(OcrExtractionCandidate {
                    text: normalized,
                    engine: "external.ocr.cmd".to_string(),
                    confidence: (0.70_f32 + quality * 0.22).clamp(0.52, 0.96),
                });
            }
        }
    }

    if let Some(candidate) = default_external_candidates(pdf_path, max_chars) {
        return Some(candidate);
    }

    let utf8 = utf8_candidate(bytes, max_chars);
    let utf16 = utf16_le_candidate(bytes, max_chars);
    let ascii = ascii_fallback(bytes, max_chars);

    let mut candidates = vec![
        (utf8, "builtin.utf8", 0.62_f32),
        (utf16, "builtin.utf16", 0.58_f32),
        (ascii, "builtin.ascii", 0.45_f32),
    ];
    candidates.sort_by(|a, b| {
        text_quality_score(&b.0)
            .partial_cmp(&text_quality_score(&a.0))
            .unwrap_or(Ordering::Equal)
    });

    for (text, engine, confidence) in candidates {
        let trimmed_len = text.trim().chars().count();
        let quality = text_quality_score(&text);
        if trimmed_len >= 80 && quality >= 0.12 {
            return Some(OcrExtractionCandidate {
                text,
                engine: engine.to_string(),
                confidence,
            });
        }
        if trimmed_len >= 24 {
            return Some(OcrExtractionCandidate {
                text,
                engine: format!("{}.fallback", engine),
                confidence: confidence.min(0.42),
            });
        }
    }

    None
}




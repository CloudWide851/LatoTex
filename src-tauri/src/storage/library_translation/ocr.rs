fn is_han(ch: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&ch) || ('\u{3400}'..='\u{4DBF}').contains(&ch)
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
                    | '(' | ')' | '[' | ']' | '{' | '}'
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

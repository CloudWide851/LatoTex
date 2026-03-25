import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import fitz

TARGET_LANGUAGE_ALIASES = {
    "chinese": "zh",
    "chinese simplified": "zh",
    "chinese (simplified)": "zh",
    "simplified chinese": "zh",
    "zh-cn": "zh",
    "zh": "zh",
    "english": "en",
    "en": "en",
    "japanese": "ja",
    "ja": "ja",
    "korean": "ko",
    "ko": "ko",
    "french": "fr",
    "fr": "fr",
    "german": "de",
    "de": "de",
    "spanish": "es",
    "es": "es",
    "russian": "ru",
    "ru": "ru",
}


def normalize_target_language(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return "zh"
    return TARGET_LANGUAGE_ALIASES.get(normalized, normalized[:2])


def detect_language(text: str) -> str | None:
    sample = (text or "").strip()
    if not sample:
        return None
    cjk = sum(1 for ch in sample if "\u4e00" <= ch <= "\u9fff")
    latin = sum(1 for ch in sample if ch.isascii() and ch.isalpha())
    if cjk > latin:
        return "zh"
    if latin > 0:
        return "en"
    return None


def collect_output_pdfs(output_dir: Path) -> tuple[str | None, str | None, list[str]]:
    pdfs = sorted(output_dir.rglob("*.pdf"))
    mono = None
    dual = None
    artifacts: list[str] = []
    for path in pdfs:
        artifacts.append(str(path))
        lower = path.name.lower()
        if mono is None and "mono" in lower:
            mono = str(path)
        if dual is None and "dual" in lower:
            dual = str(path)
    if mono is None and pdfs:
        mono = str(pdfs[0])
    if dual is None and len(pdfs) > 1:
        dual = str(pdfs[1])
    elif dual is None:
        dual = mono
    return mono, dual, artifacts


def run_translate(payload: dict) -> dict:
    pdf_path = Path(payload["pdfPath"])
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    service = payload.get("service") or {"kind": "google"}
    service_kind = str(service.get("kind") or "google").strip().lower() or "google"
    model_name = str(service.get("model") or "").strip()
    base_url = str(service.get("baseUrl") or "").strip()
    api_key = str(service.get("apiKey") or "").strip()
    target_lang = normalize_target_language(payload.get("targetLanguage"))

    env = os.environ.copy()
    if service_kind == "openai":
        if base_url:
            env["OPENAI_BASE_URL"] = base_url
        if api_key:
            env["OPENAI_API_KEY"] = api_key
        if model_name:
            env["OPENAI_MODEL"] = model_name
    elif service_kind == "gemini":
        if api_key:
            env["GEMINI_API_KEY"] = api_key
        if model_name:
            env["GEMINI_MODEL"] = model_name

    command = [
        sys.executable,
        "-m",
        "pdf2zh",
        "-i",
        str(pdf_path),
        "-o",
        str(output_dir),
        "-s",
        service_kind,
        "-lo",
        target_lang,
        "--thread",
        "2",
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        env=env,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    if completed.returncode != 0:
        raise RuntimeError(stderr or stdout or f"pdf2zh exited with code {completed.returncode}")

    mono_path, dual_path, artifacts = collect_output_pdfs(output_dir)
    if not mono_path:
        raise RuntimeError("pdf2zh did not generate any translated PDF artifacts")

    with fitz.open(pdf_path) as doc:
        page_count = doc.page_count
        preview_text = []
        for page in doc:
            text = page.get_text("text") or ""
            if text.strip():
                preview_text.append(text)
            if sum(len(item) for item in preview_text) > 2400:
                break

    return {
        "runtimeSource": "uv",
        "status": "completed",
        "engine": f"pdfmathtranslate.{service_kind}",
        "service": service_kind,
        "targetLanguage": target_lang,
        "pageCount": page_count,
        "ocrPageCount": 0,
        "detectedLanguage": detect_language("\n".join(preview_text)),
        "extractionEngine": "pdfmathtranslate.cli",
        "extractionMode": "pdfmathtranslate",
        "layoutMode": "near-original",
        "refinedBySearch": False,
        "glossaryCount": 0,
        "monoPdf": mono_path,
        "dualPdf": dual_path,
        "artifactPaths": artifacts,
        "stdout": stdout,
        "stderr": stderr,
    }


def run_extract(payload: dict) -> dict:
    pdf_path = Path(payload["pdfPath"])
    with fitz.open(pdf_path) as doc:
        blocks = []
        previews = []
        for page_index, page in enumerate(doc, start=1):
            page_blocks = page.get_text("blocks", sort=True) or []
            page_texts = []
            for block_index, block in enumerate(page_blocks, start=1):
                text = str(block[4] or "").strip()
                if not text:
                    continue
                page_texts.append(text)
                blocks.append(
                    {
                        "id": f"pdf-{page_index}-b{block_index}",
                        "page": page_index,
                        "role": "paragraph",
                        "text": text,
                    }
                )
            if page_texts:
                previews.append("\n".join(page_texts[:4]))

        return {
            "runtimeSource": "uv",
            "status": "completed",
            "pageCount": doc.page_count,
            "ocrPageCount": 0,
            "detectedLanguage": detect_language("\n".join(previews)),
            "extractionEngine": "pdfmathtranslate.extract.pymupdf",
            "extractionMode": "native",
            "blocks": blocks,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    operation = str(payload.get("operation") or "translate").strip().lower()

    if operation == "translate":
        result = run_translate(payload)
    elif operation == "extract":
        result = run_extract(payload)
    else:
        raise SystemExit(f"unsupported operation: {operation}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": result.get("status", "completed"), "operation": operation}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

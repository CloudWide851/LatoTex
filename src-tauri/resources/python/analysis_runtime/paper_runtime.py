import argparse
import json
import os
import re
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


class PaperRuntimeError(Exception):
    def __init__(self, code: str, message: str, diagnostics: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.diagnostics = diagnostics or []

    def to_payload(self) -> dict:
        return {
            "status": "failed",
            "error": {
                "code": self.code,
                "message": self.message,
                "diagnostics": self.diagnostics,
            },
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


def resolve_timeout_secs(payload: dict) -> int:
    raw_value = payload.get("timeoutSecs")
    try:
        timeout_secs = int(raw_value)
    except (TypeError, ValueError):
        return 1800
    return max(30, min(7200, timeout_secs))


def compact_output(text: str, label: str) -> str | None:
    normalized = (text or "").strip().replace("\r", " ").replace("\n", " | ")
    if not normalized:
        return None
    if len(normalized) > 600:
        normalized = normalized[-600:]
    return f"{label}={normalized}"


def normalize_runtime_path(value: str | Path) -> Path:
    raw = os.fspath(value)
    if os.name == "nt":
        if raw.startswith("\\\\?\\UNC\\"):
            raw = "\\\\" + raw[8:]
        elif raw.startswith("\\\\?\\"):
            raw = raw[4:]
    return Path(raw)


def path_text(value: str | Path) -> str:
    return str(normalize_runtime_path(value))


def should_retry_without_subset_fonts(stdout: str, stderr: str) -> bool:
    combined = f"{stdout}\n{stderr}".lower()
    return (
        "subset_fonts" in combined
        or "build_subset" in combined
        or "uncifile.txt" in combined
        or ("invalid argument" in combined and "pymupdf" in combined)
    )


def run_pdf2zh_command(
    command: list[str],
    env: dict[str, str],
    timeout_secs: int,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        env=env,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=timeout_secs,
    )


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


def ensure_pdf2zh_config(output_dir: Path) -> Path:
    config_path = output_dir.joinpath(".pdf2zh", "config.json")
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if not config_path.exists():
        config_path.write_text("{}", encoding="utf-8")
    return config_path


def prepare_runtime_dirs(output_dir: Path, env: dict[str, str]) -> None:
    temp_dir = normalize_runtime_path(output_dir.joinpath(".tmp"))
    cache_dir = normalize_runtime_path(output_dir.joinpath(".cache"))
    temp_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    temp_text = path_text(temp_dir)
    env["TMPDIR"] = temp_text
    env["TMP"] = temp_text
    env["TEMP"] = temp_text
    env["XDG_CACHE_HOME"] = path_text(cache_dir)


def build_service_env(service: dict) -> tuple[str, dict[str, str], str, str]:
    service_kind = str(service.get("kind") or "").strip().lower()
    model_name = str(service.get("model") or "").strip()
    base_url = str(service.get("baseUrl") or "").strip()
    api_key = str(service.get("apiKey") or "").strip()
    env = os.environ.copy()

    if service_kind == "openai":
        if not base_url or not api_key or not model_name:
            raise PaperRuntimeError(
                "translation.provider.openai_config_missing",
                "OpenAI-compatible translation service is missing base URL, model, or API key.",
                [
                    f"base_url_set={bool(base_url)}",
                    f"model_set={bool(model_name)}",
                    f"api_key_set={bool(api_key)}",
                ],
            )
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        env["OPENAI_MODEL"] = model_name
        return service_kind, env, model_name, base_url

    if service_kind == "gemini":
        if not api_key or not model_name:
            raise PaperRuntimeError(
                "translation.provider.gemini_config_missing",
                "Gemini translation service is missing model or API key.",
                [
                    f"model_set={bool(model_name)}",
                    f"api_key_set={bool(api_key)}",
                ],
            )
        env["GEMINI_API_KEY"] = api_key
        env["GEMINI_MODEL"] = model_name
        return service_kind, env, model_name, base_url

    raise PaperRuntimeError(
        "translation.provider.unsupported",
        f"Unsupported translation service kind: {service_kind or '-'}.",
        [f"service_kind={service_kind or '-'}"],
    )


def run_translate(payload: dict) -> dict:
    pdf_path = normalize_runtime_path(payload["pdfPath"])
    output_dir = normalize_runtime_path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    target_lang = normalize_target_language(payload.get("targetLanguage"))
    timeout_secs = resolve_timeout_secs(payload)
    service_kind, env, model_name, base_url = build_service_env(payload.get("service") or {})
    prepare_runtime_dirs(output_dir, env)

    config_path = ensure_pdf2zh_config(output_dir)
    base_command = [
        sys.executable,
        "-m",
        "pdf2zh.pdf2zh",
        path_text(pdf_path),
        "-o",
        path_text(output_dir),
        "-s",
        service_kind,
        "-lo",
        target_lang,
        "--thread",
        "2",
        "--config",
        path_text(config_path),
    ]
    try:
        completed = run_pdf2zh_command(base_command, env, timeout_secs)
    except subprocess.TimeoutExpired as error:
        diagnostics = [
            f"service={service_kind}",
            f"model={model_name or '-'}",
            f"base_url={base_url or '-'}",
            f"timeout_secs={timeout_secs}",
        ]
        stdout_tail = compact_output(error.stdout or "", "stdout")
        stderr_tail = compact_output(error.stderr or "", "stderr")
        if stdout_tail:
            diagnostics.append(stdout_tail)
        if stderr_tail:
            diagnostics.append(stderr_tail)
        raise PaperRuntimeError(
            "translation.pdfmathtranslate.timeout",
            "pdf2zh did not finish within the backend timeout.",
            diagnostics,
        )
    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    retry_without_subset_fonts = False
    if completed.returncode != 0 and should_retry_without_subset_fonts(stdout, stderr):
        retry_command = [*base_command, "--skip-subset-fonts"]
        completed = run_pdf2zh_command(retry_command, env, timeout_secs)
        stdout = completed.stdout.strip()
        stderr = completed.stderr.strip()
        retry_without_subset_fonts = True
    if completed.returncode != 0:
        diagnostics = [
            f"service={service_kind}",
            f"model={model_name or '-'}",
            f"base_url={base_url or '-'}",
            f"exit_code={completed.returncode}",
            f"skip_subset_fonts_retry={retry_without_subset_fonts}",
        ]
        stdout_tail = compact_output(stdout, "stdout")
        stderr_tail = compact_output(stderr, "stderr")
        if stdout_tail:
            diagnostics.append(stdout_tail)
        if stderr_tail:
            diagnostics.append(stderr_tail)
        raise PaperRuntimeError(
            "translation.pdfmathtranslate.failed",
            "pdf2zh exited with a non-zero status.",
            diagnostics,
        )

    mono_path, dual_path, artifacts = collect_output_pdfs(output_dir)
    if not mono_path:
        raise PaperRuntimeError(
            "translation.pdfmathtranslate.mono_missing",
            "pdf2zh did not generate any translated PDF artifacts.",
            [f"service={service_kind}", f"model={model_name or '-'}"],
        )

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
    pdf_path = normalize_runtime_path(payload["pdfPath"])
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
            if not page_texts:
                fallback_text = str(page.get_text("text") or "").strip()
                if fallback_text:
                    fallback_parts = [part.strip() for part in re.split(r"\n\s*\n", fallback_text) if part.strip()]
                    if not fallback_parts:
                        fallback_parts = [fallback_text]
                    for block_index, text in enumerate(fallback_parts, start=1):
                        page_texts.append(text)
                        blocks.append(
                            {
                                "id": f"pdf-{page_index}-fallback-{block_index}",
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


def write_output(path: Path, payload: dict) -> None:
    normalized_path = normalize_runtime_path(path)
    normalized_path.parent.mkdir(parents=True, exist_ok=True)
    normalized_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    output_path = normalize_runtime_path(args.output)
    input_path = normalize_runtime_path(args.input)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    operation = str(payload.get("operation") or "translate").strip().lower()

    try:
        if operation == "translate":
            result = run_translate(payload)
        elif operation == "extract":
            result = run_extract(payload)
        else:
            raise PaperRuntimeError(
                "translation.operation.unsupported",
                f"Unsupported paper runtime operation: {operation}",
                [f"operation={operation}"],
            )
        write_output(output_path, result)
        print(json.dumps({"status": result.get("status", "completed"), "operation": operation}, ensure_ascii=False))
        return 0
    except PaperRuntimeError as error:
        failure = error.to_payload()
        write_output(output_path, failure)
        print(json.dumps({"status": "failed", "code": error.code, "operation": operation}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception as error:  # pragma: no cover - defensive catch for runtime diagnostics
        failure = PaperRuntimeError(
            "translation.runtime.unexpected",
            str(error),
            [f"exception_type={type(error).__name__}"],
        ).to_payload()
        write_output(output_path, failure)
        print(json.dumps({"status": "failed", "code": "translation.runtime.unexpected", "operation": operation}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

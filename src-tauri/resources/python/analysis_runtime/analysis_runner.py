import argparse
import json
from pathlib import Path


def build_profile(payload: dict) -> dict:
    snapshots = payload.get("snapshots") or []
    prompt = str(payload.get("prompt") or "").strip()
    output_language = str(payload.get("outputLanguage") or "").strip() or "English"
    kinds: dict[str, int] = {}
    rows_total = 0
    columns_total = 0
    excerpts = []
    numeric_signals = []

    for item in snapshots:
        kind = str(item.get("kind") or "unknown")
        kinds[kind] = kinds.get(kind, 0) + 1
        rows_total += int(item.get("rows") or 0)
        columns_total += int(item.get("columns") or 0)
        excerpt = str(item.get("excerpt") or "").strip()
        if excerpt:
            excerpts.append({
                "path": str(item.get("path") or ""),
                "preview": excerpt[:600],
            })
        for series in item.get("numericSeries") or []:
            try:
                numeric_signals.append({
                    "path": str(item.get("path") or ""),
                    "label": str(series.get("label") or "value"),
                    "value": float(series.get("value") or 0),
                })
            except Exception:
                continue

    numeric_signals = sorted(numeric_signals, key=lambda entry: abs(entry["value"]), reverse=True)[:12]
    prompt_keywords = [part for part in prompt.replace("\n", " ").split(" ") if len(part.strip()) >= 3][:16]

    return {
        "runtimeSource": "uv",
        "status": "ready",
        "outputLanguage": output_language,
        "fileCount": len(snapshots),
        "kindHistogram": kinds,
        "rowsTotal": rows_total,
        "columnsTotal": columns_total,
        "promptKeywords": prompt_keywords,
        "topNumericSignals": numeric_signals,
        "sourcePreviews": excerpts[:8],
        "recommendations": [
            "Prioritize the files with the highest numeric signal variance.",
            "Ground conclusions in extracted rows/columns before synthesis.",
            "Call out missing values or sparse tables explicitly if detected.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    profile = build_profile(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "fileCount": profile["fileCount"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

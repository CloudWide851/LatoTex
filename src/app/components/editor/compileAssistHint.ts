type TranslationFn = (key: any) => string;

function detectMissingPackage(diagnostics: string[]): string | null {
  for (const line of diagnostics) {
    const match = line.match(/File [`']([^`']+\.sty)[`'] not found/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function hasBusytexWorkerOriginIssue(diagnostics: string[]): boolean {
  const joined = diagnostics.join("\n").toLowerCase();
  return (
    joined.includes("cannot be accessed from origin")
    || joined.includes("failed to construct 'worker'")
    || joined.includes("unexpected token <")
  );
}

export function buildCompileAssistHint(diagnostics: string[], t: TranslationFn): string {
  const lines: string[] = [];
  const normalized = diagnostics
    .map((line) => String(line || "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);

  lines.push(t("workspace.compileAssist.hintTitle"));
  if (normalized.length > 0) {
    lines.push(...normalized.map((line, index) => `${index + 1}. ${line}`));
  }

  const missingPackage = detectMissingPackage(normalized);
  if (missingPackage && missingPackage.toLowerCase() === "ctex.sty") {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintMissingCtex"));
  } else if (missingPackage) {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintMissingPackage").replace("{package}", missingPackage));
  }

  if (hasBusytexWorkerOriginIssue(normalized)) {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintBusytexWorkerOrigin"));
  }

  lines.push("");
  lines.push(t("workspace.compileAssist.hintGeneric"));
  return lines.join("\n").trim();
}

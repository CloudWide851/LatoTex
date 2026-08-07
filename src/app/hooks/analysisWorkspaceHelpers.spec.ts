import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml } from "./analysisWorkspaceHelpers";

describe("buildReportHtml", () => {
  it("keeps model-controlled report fields inert while preserving their text", () => {
    const scriptPayload = `<script data-report-attack>window.__reportAttack = true</script>`;
    const eventPayload = `<img src=x onerror="window.__reportAttack = true">`;
    const closePayload = `</style><script data-style-breakout>window.__reportAttack = true</script>`;
    const { html, chartDataUrl } = buildReportHtml({
      language: "en-US",
      title: scriptPayload,
      summary: eventPayload,
      steps: [closePayload],
      insights: [`<svg onload="window.__reportAttack = true">finding</svg>`],
      sections: [{ title: eventPayload, content: scriptPayload }],
      labels: [`<text onmouseover="window.__reportAttack = true">series</text>`],
      values: [1],
    });

    expect(html).not.toContain("<script data-report-attack>");
    expect(html).not.toContain("<script data-style-breakout>");
    expect(html).not.toContain("<img src=x onerror=");
    expect(html).not.toContain("<svg onload=");
    expect(html).toContain("&lt;script data-report-attack&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;");

    const encodedSvg = chartDataUrl.split(",", 2)[1] ?? "";
    const svg = new TextDecoder().decode(Uint8Array.from(atob(encodedSvg), (char) => char.charCodeAt(0)));
    expect(svg).not.toContain("<text onmouseover=");
    expect(svg).toContain("&lt;text onmouseover=&quot;");
  });

  it("preserves ordinary report structure and visible content", () => {
    const { html } = buildReportHtml({
      language: "en-US",
      title: "Replication study",
      summary: "The estimate remained stable.",
      steps: ["Normalize observations", "Estimate uncertainty"],
      insights: ["The interval excludes zero"],
      sections: [{ title: "Limitations", content: "Single-site sample" }],
      labels: ["Control"],
      values: [2.5],
    });

    expect(html).toContain("<h1>Replication study</h1>");
    expect(html).toContain("<li>Normalize observations</li>");
    expect(html).toContain("<h3>Limitations</h3>");
    expect(html).toContain("Single-site sample");
  });

  it("renders generated reports in a scriptless iframe sandbox", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/app/components/analysis/AnalysisWorkspace.tsx"),
      "utf8",
    );
    expect(source).toContain('sandbox=""');
    expect(source).toContain('referrerPolicy="no-referrer"');
  });
});

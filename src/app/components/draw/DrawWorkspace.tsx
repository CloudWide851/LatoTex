import { Download, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { writeFile, writeFileBinary } from "../../../shared/api/desktop";

type TranslationFn = (key: any) => string;
type ExportFormat = "drawio" | "svg" | "png";

type DrawMessage = {
  event?: string;
  xml?: string;
  data?: string;
  error?: string;
};

const DRAWIO_EMBED_URL =
  "https://embed.diagrams.net/?embed=1&ui=min&spin=1&proto=json&configure=1&saveAndExit=0";

const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="default" name="Page-1">
    <mxGraphModel dx="1240" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1920" pageHeight="1080" background="#ffffff" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

function decodeDataUrl(dataUrl: string): Uint8Array {
  const payload = dataUrl.split(",", 2)[1] ?? "";
  const raw = atob(payload);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export function DrawWorkspace(props: {
  projectId: string | null;
  t: TranslationFn;
}) {
  const { projectId, t } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pendingExportRef = useRef<ExportFormat | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("diagram");
  const [format, setFormat] = useState<ExportFormat>("drawio");
  const [xml, setXml] = useState(EMPTY_DIAGRAM);
  const [status, setStatus] = useState("");

  const basePath = useMemo(() => {
    const normalized = fileName.trim().replace(/[\\/:*?"<>|]/g, "-") || "diagram";
    return `.latotex/drawings/${normalized}`;
  }, [fileName]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }
      let message: DrawMessage | null = null;
      try {
        message = JSON.parse(event.data) as DrawMessage;
      } catch {
        return;
      }
      if (!message) {
        return;
      }
      if (message.event === "init") {
        setReady(true);
        frameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ action: "load", autosave: 1, xml }),
          "*",
        );
        setStatus(t("draw.ready"));
        return;
      }
      if (message.event === "save" && typeof message.xml === "string") {
        setXml(message.xml);
        return;
      }
      if (message.event === "export" && typeof message.data === "string") {
        const pending = pendingExportRef.current;
        if (!pending || !projectId) {
          return;
        }
        const run = async () => {
          setBusy(true);
          try {
            if (pending === "svg") {
              const svg = atob((message!.data || "").split(",", 2)[1] || "");
              await writeFile(projectId, `${basePath}.svg`, svg);
            } else if (pending === "png") {
              await writeFileBinary(projectId, `${basePath}.png`, decodeDataUrl(message.data!));
            }
            setStatus(t("draw.saved"));
          } catch (error) {
            setStatus(String(error));
          } finally {
            pendingExportRef.current = null;
            setBusy(false);
          }
        };
        void run();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [basePath, projectId, t, xml]);

  const triggerSave = async (targetFormat: ExportFormat) => {
    if (!projectId) {
      return;
    }
    setBusy(true);
    try {
      if (targetFormat === "drawio") {
        await writeFile(projectId, `${basePath}.drawio`, xml);
        setStatus(t("draw.saved"));
        return;
      }
      pendingExportRef.current = targetFormat;
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({
          action: "export",
          format: targetFormat,
          xml,
          spinKey: "exporting",
        }),
        "*",
      );
      setStatus(t("draw.exporting"));
    } catch (error) {
      setStatus(String(error));
      pendingExportRef.current = null;
    } finally {
      if (targetFormat === "drawio") {
        setBusy(false);
      }
    }
  };

  const requestEditorSave = () => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ action: "save" }), "*");
  };

  if (!projectId) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500">
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <header className="flex items-center gap-2 border-b border-slate-200 px-3">
        <input
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          className="w-48 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          placeholder={t("draw.fileName")}
        />
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as ExportFormat)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="drawio">.drawio</option>
          <option value="svg">.svg</option>
          <option value="png">.png</option>
        </select>
        <button
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          onClick={requestEditorSave}
          disabled={!ready || busy}
        >
          <Save className="h-3.5 w-3.5" />
          {t("draw.capture")}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-primary-600 bg-primary-600 px-2 py-1 text-xs text-white hover:bg-primary-700 disabled:opacity-60"
          onClick={() => void triggerSave(format)}
          disabled={!ready || busy}
        >
          <Download className="h-3.5 w-3.5" />
          {t("draw.export")}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          onClick={() => {
            setReady(false);
            frameRef.current?.contentWindow?.location.reload();
          }}
          disabled={busy}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("common.refresh")}
        </button>
        <div className="ml-auto truncate text-[11px] text-slate-500">{status || t("draw.waiting")}</div>
      </header>

      <div className="min-h-0">
        <iframe
          ref={frameRef}
          src={DRAWIO_EMBED_URL}
          title="drawio"
          className="h-full w-full border-0"
        />
      </div>
    </section>
  );
}


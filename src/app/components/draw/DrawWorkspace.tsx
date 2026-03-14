import { ClipboardPaste, Download, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { writeFile, writeFileBinary } from "../../../shared/api/desktop";

type TranslationFn = (key: any) => string;
type ExportFormat = "drawio" | "svg" | "png";

type DrawMessage = {
  event?: string;
  xml?: string;
  data?: string;
  error?: string;
  [key: string]: unknown;
};

type ClipboardImage = {
  mime: string;
  dataUrl: string;
};

const DRAWIO_HOST_URL = "/drawio/index.html";
const DRAWIO_EMBED_FALLBACK_URL = "https://embed.diagrams.net/?embed=1&ui=min&spin=1&proto=json&configure=1&saveAndExit=0";

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

function parseDrawMessage(payload: unknown): DrawMessage | null {
  if (!payload) {
    return null;
  }
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as DrawMessage;
    } catch {
      return null;
    }
  }
  if (typeof payload === "object") {
    return payload as DrawMessage;
  }
  return null;
}

function readImageFromClipboardEvent(event: ClipboardEvent): Promise<ClipboardImage | null> {
  const items = event.clipboardData?.items;
  if (!items || items.length === 0) {
    return Promise.resolve(null);
  }
  const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    return Promise.resolve(null);
  }
  const file = imageItem.getAsFile();
  if (!file) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("clipboard read failed"));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        resolve(null);
        return;
      }
      resolve({ mime: file.type || "image/png", dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

function buildImageMergeXml(dataUrl: string): string {
  const cellId = `img_${Date.now().toString(36)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="LatoTex">
  <diagram id="paste" name="Page-1">
    <mxGraphModel dx="1240" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1920" pageHeight="1080" background="#ffffff" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="${cellId}" value="" style="shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=1;aspect=fixed;image=${dataUrl};" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="520" height="320" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

export function DrawWorkspace(props: {
  projectId: string | null;
  t: TranslationFn;
}) {
  const { projectId, t } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pendingExportRef = useRef<ExportFormat | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("diagram");
  const [format, setFormat] = useState<ExportFormat>("drawio");
  const [xml, setXml] = useState(EMPTY_DIAGRAM);
  const [status, setStatus] = useState("");
  const [frameSrc, setFrameSrc] = useState(DRAWIO_HOST_URL);

  const basePath = useMemo(() => {
    const normalized = fileName.trim().replace(/[\\/:*?"<>|]/g, "-") || "diagram";
    return `.latotex/drawings/${normalized}`;
  }, [fileName]);

  const postToFrame = (payload: Record<string, unknown>) => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) {
      return;
    }
    frame.postMessage(JSON.stringify(payload), "*");
  };

  const pasteImage = async (source: ClipboardImage | null) => {
    if (!ready) {
      setStatus(t("draw.waiting"));
      return;
    }
    if (!source?.dataUrl) {
      setStatus(t("draw.pasteNoImage"));
      return;
    }
    const mergeXml = buildImageMergeXml(source.dataUrl);
    postToFrame({ action: "merge", xml: mergeXml, autosave: 1 });
    setStatus(t("draw.pasted"));
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = parseDrawMessage(event.data);
      if (!message) {
        return;
      }
      if (message.event === "configure") {
        postToFrame({
          action: "configure",
          config: {
            css: "body{overflow:hidden;}"
          },
        });
        return;
      }
      if (message.event === "init") {
        setReady(true);
        if (initTimerRef.current !== null) {
          window.clearTimeout(initTimerRef.current);
          initTimerRef.current = null;
        }
        postToFrame({ action: "load", autosave: 1, xml });
        setStatus(t("draw.ready"));
        return;
      }
      if (message.event === "save" && typeof message.xml === "string") {
        setXml(message.xml);
        return;
      }
      if (message.event === "export" && typeof message.data === "string") {
        const exportData = message.data;
        const pending = pendingExportRef.current;
        if (!pending || !projectId) {
          return;
        }
        const run = async () => {
          setBusy(true);
          try {
            if (pending === "svg") {
              const svg = atob((message.data || "").split(",", 2)[1] || "");
              await writeFile(projectId, `${basePath}.svg`, svg);
            } else if (pending === "png") {
              await writeFileBinary(projectId, `${basePath}.png`, decodeDataUrl(exportData));
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
        return;
      }
      if (message.event === "error") {
        const err = typeof message.error === "string" ? message.error : t("draw.startFailed");
        setStatus(err);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [basePath, projectId, t, xml]);

  useEffect(() => {
    initTimerRef.current = window.setTimeout(() => {
      if (!ready) {
        if (frameSrc === DRAWIO_HOST_URL) {
          setFrameSrc(DRAWIO_EMBED_FALLBACK_URL);
          setStatus(t("draw.waiting"));
          return;
        }
        setStatus(t("draw.startFailed"));
      }
    }, 12_000);
    return () => {
      if (initTimerRef.current !== null) {
        window.clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [frameSrc, ready, t]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      void (async () => {
        const source = await readImageFromClipboardEvent(event);
        if (!source) {
          return;
        }
        event.preventDefault();
        await pasteImage(source);
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ready]);

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
      postToFrame({
        action: "export",
        format: targetFormat,
        xml,
        spinKey: "exporting",
      });
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
    postToFrame({ action: "save" });
  };

  const requestPasteFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      setStatus(t("draw.pasteNoImage"));
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const imageType = items
        .flatMap((item) => item.types)
        .find((mime) => mime.startsWith("image/"));
      if (!imageType) {
        setStatus(t("draw.pasteNoImage"));
        return;
      }
      const first = items.find((item) => item.types.includes(imageType));
      const blob = await first?.getType(imageType);
      if (!blob) {
        setStatus(t("draw.pasteNoImage"));
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("clipboard read failed"));
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.readAsDataURL(blob);
      });
      await pasteImage({ mime: imageType, dataUrl });
    } catch {
      setStatus(t("draw.pasteNoImage"));
    }
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
          title={t("draw.export")}
        >
          <option value="drawio">.drawio</option>
          <option value="svg">.svg</option>
          <option value="png">.png</option>
        </select>
        <button
          className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
          onClick={requestEditorSave}
          disabled={!ready || busy}
          title={t("draw.capture")}
          aria-label={t("draw.capture")}
        >
          <Save className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
          onClick={() => void requestPasteFromClipboard()}
          disabled={!ready || busy}
          title={t("draw.pasteImage")}
          aria-label={t("draw.pasteImage")}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex items-center rounded border border-primary-600 bg-primary-600 p-1.5 text-white hover:bg-primary-700 disabled:opacity-60"
          onClick={() => void triggerSave(format)}
          disabled={!ready || busy}
          title={t("draw.export")}
          aria-label={t("draw.export")}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
          onClick={() => {
            setReady(false);
            setStatus(t("draw.waiting"));
            if (frameSrc !== DRAWIO_HOST_URL) {
              setFrameSrc(DRAWIO_HOST_URL);
              return;
            }
            frameRef.current?.contentWindow?.location.reload();
          }}
          disabled={busy}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto truncate text-[11px] text-slate-500">{status || t("draw.waiting")}</div>
      </header>

      <div className="min-h-0">
        <iframe
          ref={frameRef}
          src={frameSrc}
          title="drawio"
          className="h-full w-full border-0"
        />
      </div>
    </section>
  );
}



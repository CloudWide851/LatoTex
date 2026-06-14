import { runtimeLogWrite } from "../../../shared/api/runtime";
import { isTexPath } from "../../../shared/utils/fileKind";
import { saveEditableTexMetric } from "../../hooks/useEditableTexMetric";

export function markFirstEditableTex(selectedFile: string | null) {
  if (typeof window === "undefined" || !isTexPath(selectedFile)) {
    return;
  }
  const metrics = window as Window & {
    __latotexBootStartedAt?: number;
    __latotexFirstEditableTexLogged?: boolean;
  };
  if (metrics.__latotexFirstEditableTexLogged) {
    return;
  }
  metrics.__latotexFirstEditableTexLogged = true;
  const startedAt = Number(metrics.__latotexBootStartedAt ?? performance.now());
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  saveEditableTexMetric({
    elapsedMs,
    file: selectedFile ?? "-",
    recordedAt: new Date().toISOString(),
  });
  void runtimeLogWrite(
    "INFO",
    `frontend performance time_to_editable_tex_ms=${elapsedMs}, file=${selectedFile ?? "-"}`,
  ).catch(() => undefined);
}

import { useEffect, useRef, useState } from "react";
import { readBackgroundImage } from "../../shared/api/settings";

export function useBackgroundImageObjectUrl(pathValue: string | null | undefined) {
  const normalizedPath = String(pathValue ?? "").trim();
  const [url, setUrl] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clearCurrent = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const run = async () => {
      clearCurrent();
      if (!normalizedPath) {
        setUrl("");
        return;
      }
      if (normalizedPath.startsWith("data:")) {
        setUrl(normalizedPath);
        return;
      }
      try {
        const payload = await readBackgroundImage(normalizedPath);
        if (!payload || cancelled) {
          setUrl("");
          return;
        }
        const blob = new Blob([new Uint8Array(payload.bytes)], {
          type: payload.mime || "application/octet-stream",
        });
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        objectUrlRef.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setUrl("");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      clearCurrent();
    };
  }, [normalizedPath]);

  return url;
}

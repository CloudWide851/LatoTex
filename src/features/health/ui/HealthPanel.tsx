import { useEffect, useState } from "react";
import { getHealthCheck } from "../../../shared/api/desktop";
import type { HealthCheckResponse } from "../../../shared/types/health";

export function HealthPanel() {
  const [data, setData] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const response = await getHealthCheck();
        if (isMounted) {
          setData(response);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="card">
      <h2>Backend Bridge Status</h2>
      {loading && <p>Loading health check...</p>}
      {!loading && error && <p className="error">Error: {error}</p>}
      {!loading && data && (
        <dl>
          <div>
            <dt>App</dt>
            <dd>{data.app}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{data.version}</dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd>{data.timestamp}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

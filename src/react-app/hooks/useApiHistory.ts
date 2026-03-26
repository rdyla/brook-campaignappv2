import { useCallback, useState } from "react";

export interface ApiHistoryEntry {
  id: string;
  time: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  requestBody?: string;
  responseBody?: string;
}

function safeJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

export function useApiHistory(limit = 50) {
  const [history, setHistory] = useState<ApiHistoryEntry[]>([]);

  const api = useCallback(
    async (url: string, init: RequestInit = {}): Promise<unknown> => {
      const t0 = Date.now();
      let res: Response | undefined;
      let text = "";
      let body: unknown = null;
      let ok = false;

      const reqBody =
        init.body != null
          ? typeof init.body === "string"
            ? init.body
            : JSON.stringify(init.body)
          : undefined;

      try {
        res = await fetch(url, init);
        const ct = res.headers.get("content-type") || "";
        const nullBody = [101, 204, 205, 304].includes(res.status);
        text = nullBody ? "" : await res.text();
        body = ct.includes("application/json") ? safeJson(text) : text;
        ok = res.ok;
      } catch (err) {
        body = String((err as Error)?.message || err);
      } finally {
        const ms = Date.now() - t0;
        const entry: ApiHistoryEntry = {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString(),
          method: (init.method || "GET").toUpperCase(),
          url,
          status: res?.status ?? 0,
          ms,
          requestBody: reqBody,
          responseBody:
            typeof body === "string" ? body : JSON.stringify(body, null, 2),
        };
        setHistory((prev) => [entry, ...prev].slice(0, limit));
      }

      if (!ok) {
        const err = new Error(
          typeof body === "string" ? body : JSON.stringify(body)
        ) as Error & { status: number };
        err.status = res?.status ?? 0;
        throw err;
      }
      return body;
    },
    [limit]
  );

  const clear = useCallback(() => setHistory([]), []);

  return { api, history, clear };
}

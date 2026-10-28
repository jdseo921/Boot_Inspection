// Thin fetch wrapper. Errors carry the API's problem detail so the UI can
// show what went wrong and how to fix it.

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type Params = Record<string, string | number | null | undefined>;

export function withParams(path: string, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let detail: string | null = null;
  try {
    const body = (await res.json()) as { detail?: string; title?: string };
    detail = body.detail ?? body.title ?? null;
  } catch {
    // not JSON; keep the status
  }
  throw new ApiError(res.status, detail);
}

export async function apiGet<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const res = await fetch(withParams(path, params), { headers: { Accept: "application/json" }, signal });
  return parse<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return parse<T>(res);
}

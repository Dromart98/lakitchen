type AiApiLogEvent = {
  endpoint: string;
  startedAt: number;
  code: string;
  status?: number;
  userId?: string;
  request?: Request;
  approximateSize?: number;
};

export function logAiApiEvent(event: AiApiLogEvent) {
  const durationMs = Math.max(0, Date.now() - event.startedAt);
  console.info(`[${event.endpoint}]`, {
    durationMs,
    code: event.code,
    status: event.status,
    approximateSize: event.approximateSize ?? getApproximateRequestSize(event.request),
    user: event.userId ? maskId(event.userId) : undefined,
  });
}

export function getApproximateRequestSize(request: Request): number | undefined {
  const raw = request.headers.get("content-length");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function rejectOversizedPayload(request: Request, maxBytes: number): Response | null {
  const size = getApproximateRequestSize(request);
  if (size !== undefined && size > maxBytes) {
    return json({ error: "Payload demasiado grande", code: "payload_too_large" }, 413);
  }
  return null;
}

function maskId(value: string) {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

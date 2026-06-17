import type { IncomingMessage, ServerResponse } from "node:http";

export type WebHandler = (request: Request) => Promise<Response> | Response;

type HeaderValue = string | string[] | number | undefined;

function getHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  return value;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const headerValue = getHeaderValue(value);
    if (headerValue !== undefined) headers.set(key, headerValue);
  }

  const protocol = getHeaderValue(req.headers["x-forwarded-proto"]) ?? "https";
  const host = getHeaderValue(req.headers.host) ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const body = await readBody(req);

  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    body,
  });
}

async function writeWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export async function runNodeApi(req: IncomingMessage, res: ServerResponse, handler: WebHandler) {
  try {
    const request = await toWebRequest(req);
    const response = await handler(request);
    await writeWebResponse(res, response);
  } catch (error) {
    console.error("[api] Unhandled Vercel function error", error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

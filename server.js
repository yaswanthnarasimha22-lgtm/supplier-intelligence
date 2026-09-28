import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  getSessionCredentials,
  findSessionsByAgent,
  findEventsByAgent
} from "./backend/supplier-sessions/create-session";
import { ingestEvent, listEvents } from "./backend/supplier-sessions/ingest-event";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    /* POST /api/supplier-sessions — create a new tracked session */
    if (request.method === "POST" && url.pathname === "/api/supplier-sessions") {
      const result = await createSession(await readJsonBody(request));
      sendJson(response, result.status, result.body || { error: result.error });
      return;
    }

    /* GET /api/supplier-sessions/:id/credentials — return credentials for a session */
    const credentialMatch = url.pathname.match(/^\/api\/supplier-sessions\/([^/]+)\/credentials$/);
    if (request.method === "GET" && credentialMatch) {
      const result = getSessionCredentials(
        credentialMatch[1],
        request.headers.authorization
      );
      sendJson(response, result.status, result.body || { error: result.error });
      return;
    }

    /* POST /api/supplier-events — ingest a tracking event */
    if (request.method === "POST" && url.pathname === "/api/supplier-events") {
      const result = await ingestEvent(
        await readJsonBody(request),
        request.headers.authorization
      );
      sendJson(response, result.status, result.body || { error: result.error });
      return;
    }

    /* GET /api/supplier-events — list recent events, optionally filtered.
       Query params (all optional): agent, supplier, eventType, limit.
       Example: /api/supplier-events?agent=yaswanth&supplier=hotelbeds  */
    if (request.method === "GET" && url.pathname === "/api/supplier-events") {
      const events = listEvents({
        agent: url.searchParams.get("agent") || undefined,
        supplier: url.searchParams.get("supplier") || undefined,
        eventType: url.searchParams.get("eventType") || undefined,
        limit: Number(url.searchParams.get("limit") || 200)
      });
      sendJson(response, 200, { events });
      return;
    }

    /* GET /api/agents/:username/sessions — every supplier session an agent
       has opened.  Read-only mirror of the future SQL:
         SELECT * FROM supplier_sessions WHERE username = $1 ORDER BY started_at DESC */
    const agentSessionsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/sessions$/);
    if (request.method === "GET" && agentSessionsMatch) {
      const sessions = findSessionsByAgent(decodeURIComponent(agentSessionsMatch[1]));
      sendJson(response, 200, { username: decodeURIComponent(agentSessionsMatch[1]), sessions });
      return;
    }

    /* GET /api/agents/:username/events — every event an agent has fired.
       Read-only mirror of the future SQL:
         SELECT * FROM supplier_events WHERE username = $1 ORDER BY occurred_at DESC */
    const agentEventsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (request.method === "GET" && agentEventsMatch) {
      const limit = Number(url.searchParams.get("limit") || 500);
      const events = findEventsByAgent(decodeURIComponent(agentEventsMatch[1]), limit);
      sendJson(response, 200, { username: decodeURIComponent(agentEventsMatch[1]), events });
      return;
    }

    /* Static file serving for the web app */
    let requestedPath = url.pathname;
    if (requestedPath === "/" || requestedPath === "/web-app/") {
      // The launcher gates every visit behind the login page; app.js in
      // /web-app/index.html re-redirects onward when a session already exists.
      requestedPath = "/web-app/login.html";
    }
    const filePath = normalize(join(rootDirectory, requestedPath));
    if (!filePath.startsWith(rootDirectory)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    const contents = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Invalid JSON request body" });
      return;
    }

    console.error(error);
    sendJson(response, 500, { error: "Unexpected server error" });
  }
});

server.listen(port, () => {
  console.log(`Supplier Tracker running at http://localhost:${port}`);
});

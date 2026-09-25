import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, getSessionCredentials } from "./backend/supplier-sessions/create-session";
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

    /* GET /api/supplier-events — list recent events */
    if (request.method === "GET" && url.pathname === "/api/supplier-events") {
      sendJson(response, 200, { events: listEvents() });
      return;
    }

    /* Static file serving for the web app */
    const requestedPath = url.pathname === "/" ? "/web-app/index.html" : url.pathname;
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

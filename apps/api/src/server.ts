import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env";
import { sourcing } from "./routes/sourcing";
import { quotes } from "./routes/quotes";
import { orders } from "./routes/orders";
import { tracking } from "./routes/tracking";
import { webhooks } from "./routes/webhooks";
import { requireAuth } from "./middleware/auth";

const app = new Hono();
app.use("*", logger());

// Allowed origins for browser/native client → API calls. Add additional staging
// or production origins here (or move to env if the list grows). Wildcard "*"
// is intentionally NOT used because we forward bearer tokens.
const ALLOWED_ORIGINS = [
  "http://localhost:3000",       // web dev
  "http://localhost:8081",       // expo metro
  "http://localhost:19006",      // expo web dev
  env.WEB_PUBLIC_URL,            // production web origin (if set)
].filter(Boolean) as string[];

app.use("*", cors({
  origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: false,
}));

app.get("/health", c => c.json({ ok: true, time: new Date().toISOString() }));

// Webhooks must NOT require user auth (called by providers, signature-verified).
app.route("/webhooks", webhooks);

// Authenticated user-facing routes
app.use("/api/*", requireAuth);
app.route("/api/sourcing", sourcing);
app.route("/api/quotes", quotes);
app.route("/api/orders", orders);
app.route("/api/tracking", tracking);

serve({ fetch: app.fetch, port: env.API_PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`GoGet API listening on http://localhost:${info.port}`);
});

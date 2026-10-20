
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { Redis } = require("@upstash/redis");
const { Ratelimit } = require("@upstash/ratelimit");

const app = express();

const PORT =
  process.env.PORT || process.env.LOAD_BALANCER_PORT || 5000;

// CORS: local development and deployed frontend.
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: [
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
    ],
  })
);

// Shared Upstash Redis client.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Rate limit: 20 URL creations per IP per 60 seconds.
const urlCreationLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  prefix: "ratelimit:url-creation",
});

// Configure these in Render as comma-separated service URLs.
// Local defaults keep development working on your laptop.
const encodingServers = (
  process.env.ENCODING_SERVERS ||
  "http://localhost:5001,http://localhost:5003"
)
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

const decodingServers = (
  process.env.DECODING_SERVERS ||
  "http://localhost:5002,http://localhost:5004"
)
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

const allServers = [...encodingServers, ...decodingServers];
const health = new Map();
const nextIndex = { encoding: 0, decoding: 0 };

for (const server of allServers) {
  health.set(server, false);
}

// Check backend health.
async function checkHealth() {
  await Promise.all(
    allServers.map(async (server) => {
      try {
        const response = await fetch(`${server}/health`, {
          signal: AbortSignal.timeout(3000),
        });

        health.set(server, response.ok);
      } catch (error) {
        health.set(server, false);
      }
    })
  );
}

// Round-robin selection among healthy servers.
function chooseServer(pool, name) {
  const healthy = pool.filter((server) => health.get(server));

  if (healthy.length === 0) {
    return null;
  }

  const index = nextIndex[name] % healthy.length;
  nextIndex[name] = (index + 1) % healthy.length;

  console.log(`${name} request -> ${healthy[index]}`);

  return healthy[index];
}

// Public health endpoint for the load balancer.
app.get("/health", (req, res) => {
  const servers = Object.fromEntries(health);
  const hasEncoding = encodingServers.some(
    (server) => health.get(server)
  );
  const hasDecoding = decodingServers.some(
    (server) => health.get(server)
  );

  const healthy = hasEncoding && hasDecoding;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    encoding: hasEncoding,
    decoding: hasDecoding,
    servers,
  });
});

// Create short URLs.
app.post("/api/urls", async (req, res, next) => {
  try {
    const identifier =
      req.ip || req.socket.remoteAddress || "unknown";

    const { success, limit, remaining, reset } =
      await urlCreationLimiter.limit(identifier);

    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(reset));

    if (!success) {
      return res.status(429).json({
        error: "Too many URL creation requests. Try again later.",
      });
    }

    const target = chooseServer(encodingServers, "encoding");

    if (!target) {
      return res.status(503).json({
        error: "No healthy encoding servers available",
      });
    }

    return createProxyMiddleware({
      target,
      changeOrigin: true,
      on: {
        error(error, req, res) {
          console.error("Encoding proxy error:", error.message);

          if (!res.headersSent) {
            res.status(502).json({
              error: "Encoding server unavailable",
            });
          }
        },
      },
    })(req, res, next);
  } catch (error) {
    console.error("Rate limiter error:", error.message);

    return res.status(503).json({
      error: "Rate limiting service temporarily unavailable",
    });
  }
});

// Send all other requests, including short-code redirects,
// to the decoding pool.
app.use("/", (req, res, next) => {
  const target = chooseServer(decodingServers, "decoding");

  if (!target) {
    return res.status(503).json({
      error: "No healthy decoding servers available",
    });
  }

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      error(error, req, res) {
        console.error("Decoding proxy error:", error.message);

        if (!res.headersSent) {
          res.status(502).send("Decoding server unavailable");
        }
      },
    },
  })(req, res, next);
});

async function start() {
  await checkHealth();

  // Recheck backend services every five seconds.
  const healthTimer = setInterval(checkHealth, 5000);
  healthTimer.unref();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Load balancer running on port ${PORT}`);
    console.log("Health checks and Redis rate limiting enabled");
  });
}

start().catch((error) => {
  console.error("Load balancer startup failed:", error);
  process.exit(1);
});


require("dotenv").config();

const express = require("express");
const pinoHttp = require("pino-http");
const logger = require("./logger");

const { connectDatabase, redisClient } = require("./database");
const Url = require("./url-model");
const { encodeBase62 } = require("./base62");

const app = express();

// Render provides PORT. Keep local defaults for development.
const PORT =process.env.ENCODING_PORT || process.env.PORT || 5001;

// Public URL of the load balancer, configured later on Render.
// Locally, this defaults to your existing load balancer.
const SHORT_URL_BASE = (
  process.env.SHORT_URL_BASE ||
  `http://localhost:${process.env.LOAD_BALANCER_PORT || 5000}`
).replace(/\/$/, "");

app.use(express.json());

app.use(
  pinoHttp({
    logger,
    customProps: () => ({
      service: "encoding",
    }),
    autoLogging: true,
  })
);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "encoding",
  });
});

// Create a short URL
app.post("/api/urls", async (req, res) => {
  try {
    const { originalUrl } = req.body || {};

    if (
      typeof originalUrl !== "string" ||
      !originalUrl.trim()
    ) {
      logger.warn(
        {
          event: "URL_VALIDATION_FAILED",
          reason: "missing_original_url",
        },
        "Original URL is required"
      );

      return res.status(400).json({
        error: "originalUrl is required",
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(originalUrl.trim());
    } catch {
      logger.warn(
        {
          event: "URL_VALIDATION_FAILED",
          reason: "invalid_url",
        },
        "Invalid original URL"
      );

      return res.status(400).json({
        error: "Invalid URL",
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        error: "Only HTTP and HTTPS URLs are allowed",
      });
    }

    // Generate a unique ID using the shared Redis counter.
    const id = await redisClient.incr("url:id_counter");

    // Encode the ID into a Base62 short code.
    const shortCode = encodeBase62(id);

    // Persist the mapping in MongoDB.
    const savedUrl = await Url.create({
      id,
      shortCode,
      originalUrl: parsedUrl.href,
    });

    // Cache the mapping. Cache failure should not invalidate
    // the URL already saved in MongoDB.
    try {
      await redisClient.set(
        `url:${shortCode}`,
        savedUrl.originalUrl,
        { ex: 3600 }
      );
    } catch (error) {
      logger.error(
        {
          event: "REDIS_CACHE_WRITE_FAILED",
          shortCode,
          err: error,
        },
        "URL saved, but Redis caching failed"
      );
    }

    const shortUrl = `${SHORT_URL_BASE}/${savedUrl.shortCode}`;

    logger.info(
      {
        event: "URL_CREATED",
        id: savedUrl.id,
        shortCode: savedUrl.shortCode,
      },
      "Short URL created successfully"
    );

    return res.status(201).json({
      id: savedUrl.id,
      originalUrl: savedUrl.originalUrl,
      shortCode: savedUrl.shortCode,
      shortUrl,
    });
  } catch (error) {
    logger.error(
      {
        event: "URL_CREATION_FAILED",
        err: error,
      },
      "Failed to create short URL"
    );

    return res.status(500).json({
      error: "Failed to create short URL",
    });
  }
});

// Start server
async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      logger.info(
        {
          event: "SERVER_STARTED",
          service: "encoding",
          port: PORT,
        },
        "Encoding server started"
      );
    });
  } catch (error) {
    logger.fatal(
      {
        event: "SERVER_STARTUP_ERROR",
        service: "encoding",
        err: error,
      },
      "Encoding server startup failed"
    );

    process.exit(1);
  }
}

startServer();

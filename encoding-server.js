
require("dotenv").config();

const express = require("express");
const pinoHttp = require("pino-http");
const logger = require("./logger");

const { connectDatabase, redisClient } = require("./database");
const Url = require("./url-model");
const { encodeBase62 } = require("./base62");

const app = express();
const PORT = process.env.ENCODING_PORT || 5001;

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
        const { originalUrl } = req.body;

        // Validate input
        if (
            typeof originalUrl !== "string" ||
            !originalUrl.trim()
        ) {
            logger.warn(
                { event: "URL_VALIDATION_FAILED", reason: "missing_original_url" },
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
                { event: "URL_VALIDATION_FAILED", reason: "invalid_url" },
                "Invalid original URL"
            );

            return res.status(400).json({
                error: "Invalid URL",
            });
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            logger.warn(
                {
                    event: "URL_VALIDATION_FAILED",
                    reason: "unsupported_protocol",
                    protocol: parsedUrl.protocol,
                },
                "Only HTTP and HTTPS URLs are allowed"
            );

            return res.status(400).json({
                error: "Only HTTP and HTTPS URLs are allowed",
            });
        }

        // Allocate a unique ID from the shared Redis counter.
        const id = await redisClient.incr("url:id_counter");

        // Generate the Base62 short code.
        const shortCode = encodeBase62(id);

        // Store the permanent URL mapping in MongoDB.
        const savedUrl = await Url.create({
            id,
            shortCode,
            originalUrl: parsedUrl.href,
        });

        // Cache the mapping. Cache failure should not invalidate
        // a URL that has already been saved in MongoDB.
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
            shortUrl: `http://localhost:${process.env.LOAD_BALANCER_PORT || 5000}/${savedUrl.shortCode}`,
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

        app.listen(PORT, () => {
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

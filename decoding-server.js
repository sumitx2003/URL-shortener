
require("dotenv").config();

const express = require("express");
const pinoHttp = require("pino-http");
const logger = require("./logger");

const { connectDatabase, redisClient } = require("./database");
const Url = require("./url-model");

const app = express();

// Render uses PORT; local development defaults to 5002.
const PORT = process.env.DECODING_PORT || process.env.PORT || 5002;

app.use(
    pinoHttp({
        logger,
        customProps: () => ({
            service: "decoding",
        }),
        autoLogging: true,
    })
);

// Health check
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "decoding",
    });
});

// Redirect short URLs
app.get("/:shortCode", async (req, res) => {
    const { shortCode } = req.params;
    const cacheKey = `url:${shortCode}`;

    try {
        let originalUrl = null;

        // 1. Try Redis cache
        try {
            originalUrl = await redisClient.get(cacheKey);

            if (originalUrl) {
                logger.info(
                    { event: "CACHE_HIT", shortCode },
                    "URL found in Redis"
                );
            } else {
                logger.info(
                    { event: "CACHE_MISS", shortCode },
                    "URL not found in Redis"
                );
            }
        } catch (error) {
            logger.error(
                { event: "REDIS_READ_ERROR", shortCode, err: error },
                "Redis read failed; trying MongoDB"
            );
        }

        // 2. If cache misses, look up MongoDB
        if (!originalUrl) {
            const url = await Url.findOne({ shortCode })
                .select("originalUrl")
                .lean();

            if (!url) {
                logger.warn(
                    { event: "URL_NOT_FOUND", shortCode },
                    "Short URL does not exist"
                );

                return res.status(404).json({
                    error: "Short URL not found",
                });
            }

            originalUrl = url.originalUrl;

            // 3. Populate Redis cache without blocking the redirect
            redisClient
                .set(cacheKey, originalUrl, { ex: 3600 })
                .catch((error) => {
                    logger.error(
                        { event: "REDIS_WRITE_ERROR", shortCode, err: error },
                        "Failed to cache URL"
                    );
                });
        }

        // 4. Redirect to the original URL
        res.redirect(302, originalUrl);

        // 5. Update click count asynchronously
        Url.updateOne(
            { shortCode },
            { $inc: { clicks: 1 } }
        ).catch((error) => {
            logger.error(
                { event: "CLICK_UPDATE_ERROR", shortCode, err: error },
                "Failed to update click count"
            );
        });

        logger.info(
            { event: "URL_REDIRECTED", shortCode, statusCode: 302 },
            "Redirect completed"
        );
    } catch (error) {
        logger.error(
            { event: "REDIRECT_ERROR", shortCode, err: error },
            "Failed to process redirect"
        );

        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to redirect",
            });
        }
    }
});

// Start server after database connections succeed
async function startServer() {
    try {
        await connectDatabase();

        app.listen(PORT, "0.0.0.0", () => {
            logger.info(
                {
                    event: "SERVER_STARTED",
                    port: PORT,
                    service: "decoding",
                },
                "Decoding server started"
            );
        });
    } catch (error) {
        logger.fatal(
            { event: "SERVER_STARTUP_ERROR", err: error },
            "Decoding server startup failed"
        );

        process.exit(1);
    }
}

startServer();
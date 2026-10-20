
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const { Redis } = require("@upstash/redis");
const { encodeBase62 } = require("./base62");

const app = express();

const PORT = process.env.PORT || process.env.SERVER_PORT || 5000;

const SHORT_URL_BASE = (
    process.env.SHORT_URL_BASE ||
    `http://localhost:${PORT}`
).replace(/\/$/, "");

app.use(express.json());

// Redis client
const redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// MongoDB schema
const urlSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true,
        unique: true,
    },
    shortCode: {
        type: String,
        required: true,
        unique: true,
    },
    originalUrl: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    clicks: {
        type: Number,
        default: 0,
    },
});

const Url = mongoose.model("Url", urlSchema);

// Root route
app.get("/", (req, res) => {
    res.json({
        message: "URL Shortener API is running",
        service: "url-shortener",
    });
});

// Health check
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "url-shortener",
    });
});

// Create short URL
app.post("/api/urls", async (req, res) => {
    try {
        const { originalUrl } = req.body;

        if (
            typeof originalUrl !== "string" ||
            !originalUrl.trim()
        ) {
            return res.status(400).json({
                error: "originalUrl is required",
            });
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(originalUrl.trim());
        } catch {
            return res.status(400).json({
                error: "Invalid URL",
            });
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return res.status(400).json({
                error: "Only HTTP and HTTPS URLs are allowed",
            });
        }

        // Atomically allocate a unique ID.
        const id = await redisClient.incr("url:id_counter");
        const shortCode = encodeBase62(id);

        const savedUrl = await Url.create({
            id,
            shortCode,
            originalUrl: parsedUrl.href,
        });

        // Cache is optional; MongoDB remains the source of truth.
        redisClient
            .set(`url:${shortCode}`, savedUrl.originalUrl, {
                ex: 3600,
            })
            .catch((error) => {
                console.error("Redis cache write failed:", error.message);
            });

        return res.status(201).json({
            id: savedUrl.id,
            originalUrl: savedUrl.originalUrl,
            shortCode: savedUrl.shortCode,
            shortUrl: `${SHORT_URL_BASE}/${savedUrl.shortCode}`,
        });
    } catch (error) {
        console.error("Create URL error:", error.message);

        return res.status(500).json({
            error: "Failed to create short URL",
        });
    }
});

// Redirect short URL
app.get("/:shortCode", async (req, res) => {
    const { shortCode } = req.params;
    const cacheKey = `url:${shortCode}`;

    try {
        let originalUrl = null;

        // Check Redis first.
        try {
            originalUrl = await redisClient.get(cacheKey);
        } catch (error) {
            console.error("Redis cache read failed:", error.message);
        }

        // Fall back to MongoDB.
        if (!originalUrl) {
            const url = await Url.findOne({ shortCode })
                .select("originalUrl")
                .lean();

            if (!url) {
                return res.status(404).json({
                    error: "Short URL not found",
                });
            }

            originalUrl = url.originalUrl;

            // Populate cache without delaying the redirect.
            redisClient
                .set(cacheKey, originalUrl, { ex: 3600 })
                .catch((error) => {
                    console.error("Redis cache write failed:", error.message);
                });
        }

        // Send the redirect immediately.
        res.redirect(302, originalUrl);

        // Increment click count in the background.
        Url.updateOne(
            { shortCode },
            { $inc: { clicks: 1 } }
        ).catch((error) => {
            console.error("Click update failed:", error.message);
        });
    } catch (error) {
        console.error("Redirect error:", error.message);

        if (!res.headersSent) {
            return res.status(500).json({
                error: "Failed to redirect",
            });
        }
    }
});

// Start after database connections succeed.
async function startServer() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is not configured");
        }

        if (
            !process.env.UPSTASH_REDIS_REST_URL ||
            !process.env.UPSTASH_REDIS_REST_TOKEN
        ) {
            throw new Error("Upstash Redis environment variables are missing");
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected successfully");

        // Verify Redis connectivity.
        await redisClient.set("url:health_check", "ok", { ex: 60 });
        const result = await redisClient.get("url:health_check");

        if (result !== "ok") {
            throw new Error("Redis connectivity verification failed");
        }

        console.log("Upstash Redis connected successfully");

        // Initialize the counter only if it doesn't already exist.
        const latest = await Url.findOne({})
            .sort({ id: -1 })
            .select("id")
            .lean();

        const maxId = latest ? latest.id : 0;

        await redisClient.set("url:id_counter", String(maxId), {
            nx: true,
        });

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`URL Shortener server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Server startup failed:", error.message);
        process.exit(1);
    }
}

startServer();


require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const { Redis } = require("@upstash/redis");
const { encodeBase62 } = require("./base62");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Upstash Redis REST client (HTTPS)
const redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// MongoDB schema
const urlSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true,
        unique: true
    },
    shortCode: {
        type: String,
        required: true,
        unique: true
    },
    originalUrl: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    clicks: {
        type: Number,
        default: 0
    }
});

const Url = mongoose.model("Url", urlSchema);

app.get("/", (req, res) => {
    res.send("URL Shortener API is running!");
});

// Create a short URL
app.post("/api/urls", async (req, res) => {
    try {
        const { originalUrl } = req.body;

        if (typeof originalUrl !== "string" || !originalUrl.trim()) {
            return res.status(400).json({
                error: "originalUrl is required"
            });
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(originalUrl);
        } catch {
            return res.status(400).json({
                error: "Invalid URL"
            });
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return res.status(400).json({
                error: "Only HTTP and HTTPS URLs are allowed"
            });
        }

        // Allocate a unique ID from the shared Redis counter.
        const id = await redisClient.incr("url:id_counter");

        // Convert the numeric ID to a Base62 short code.
        const shortCode = encodeBase62(id);

        // MongoDB is the permanent source of truth.
        const savedUrl = await Url.create({
            id,
            shortCode,
            originalUrl: parsedUrl.href
        });

        res.status(201).json({
            id: savedUrl.id,
            originalUrl: savedUrl.originalUrl,
            shortCode: savedUrl.shortCode,
            shortUrl: `http://localhost:${PORT}/${savedUrl.shortCode}`
        });
    } catch (error) {
        console.error("Create URL error:", error.message);
        res.status(500).json({
            error: "Internal server error"
        });
    }
});

// Redirect using a short code
app.get("/:shortCode", async (req, res) => {
    try {
        const { shortCode } = req.params;
        const cacheKey = `url:${shortCode}`;

        // Check Redis cache first.
        let originalUrl = await redisClient.get(cacheKey);

        if (originalUrl) {
            console.log("CACHE HIT:", shortCode);
        } else {
            console.log("CACHE MISS:", shortCode);

            // Cache miss: retrieve the mapping from MongoDB.
            const url = await Url.findOne({ shortCode });

            if (!url) {
                return res.status(404).json({
                    error: "Short URL not found"
                });
            }

            originalUrl = url.originalUrl;

            // Cache the URL for one hour.
            await redisClient.set(cacheKey, originalUrl, {
                ex: 3600
            });
        }

        // Count every successful redirect, including cache hits.
        await Url.updateOne(
            { shortCode },
            { $inc: { clicks: 1 } }
        );

        return res.redirect(302, originalUrl);
    } catch (error) {
        console.error("Redirect error:", error.message);
        return res.status(500).json({
            error: "Internal server error"
        });
    }
});

// Connect services before starting the server.
async function startServer() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected successfully");

        // Verify Upstash Redis over HTTPS.
        await redisClient.set("url:test", "connected");
        const result = await redisClient.get("url:test");

        if (result !== "connected") {
            throw new Error("Redis read/write verification failed");
        }

        console.log("Upstash Redis connected successfully");
        console.log("Redis test:", result);

        // Initialize a missing counter from existing numeric IDs.
        const latest = await Url.findOne({
            id: { $exists: true }
        })
            .sort({ id: -1 })
            .select({ id: 1 })
            .lean();

        const maxId = latest ? latest.id : 0;

        // NX prevents overwriting an existing counter.
        await redisClient.set("url:id_counter", String(maxId), {
            nx: true
        });

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
}

startServer();

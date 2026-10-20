
require("dotenv").config();

const mongoose = require("mongoose");
const { Redis } = require("@upstash/redis");

const redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

async function connectDatabase() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");

    // Verify Upstash Redis works over HTTPS.
    await redisClient.set("url:test", "connected");
    const result = await redisClient.get("url:test");

    if (result !== "connected") {
        throw new Error("Upstash Redis verification failed");
    }

    console.log("Upstash Redis connected successfully");
}

module.exports = {
    mongoose,
    redisClient,
    connectDatabase
};


require("dotenv").config();

const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function main() {
  const totalRequests = 100;
  const start = performance.now();

  const results = await Promise.all(
    Array.from({ length: totalRequests }, () =>
      redis.incr("url:benchmark_counter")
    )
  );

  const elapsed = performance.now() - start;
  const uniqueIds = new Set(results);

  console.log("Total INCR requests:", totalRequests);
  console.log("Elapsed time:", elapsed.toFixed(2), "ms");
  console.log(
    "Throughput:",
    (totalRequests / (elapsed / 1000)).toFixed(2),
    "operations/second"
  );
  console.log("Unique IDs returned:", uniqueIds.size);

  if (uniqueIds.size !== totalRequests) {
    throw new Error("Duplicate IDs detected!");
  }

  console.log("SUCCESS: All returned IDs are unique.");
}

main().catch((error) => {
  console.error("Redis benchmark failed:", error.message);
  process.exitCode = 1;
});

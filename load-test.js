
import http from "k6/http";
import { check, sleep } from "k6";

// Override with K6_BASE_URL when running load tests.
const BASE_URL = (
  __ENV.K6_BASE_URL || "http://localhost:5000"
).replace(/\/$/, "");

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "20s", target: 10 },
    { duration: "10s", target: 0 },
  ],

  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1000"],
    checks: ["rate>0.95"],
  },
};

export default function () {
  // Create a short URL
  const response = http.post(
    `${BASE_URL}/api/urls`,
    JSON.stringify({
      originalUrl: "https://www.google.com/",
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      tags: { endpoint: "create_url" },
    }
  );

  const created = check(response, {
    "URL creation returns 201": (r) => r.status === 201,
    "response contains shortCode": (r) => {
      try {
        return Boolean(r.json("shortCode"));
      } catch {
        return false;
      }
    },
  });

  if (created) {
    const data = response.json();

    // Test the redirect without following it.
    const redirect = http.get(
      `${BASE_URL}/${encodeURIComponent(data.shortCode)}`,
      {
        redirects: 0,
        tags: { endpoint: "redirect" },
      }
    );

    check(redirect, {
      "redirect returns 302": (r) => r.status === 302,
      "redirect has Location header": (r) =>
        Boolean(r.headers.Location),
    });
  }

  sleep(1);
}

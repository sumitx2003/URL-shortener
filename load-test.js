
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "20s", target: 10 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function () {
  const response = http.post(
    "http://localhost:5000/api/urls",
    JSON.stringify({ originalUrl: "https://www.google.com" }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(response, {
    "URL created": (r) => r.status === 201,
  });

  if (response.status === 201) {
    const data = response.json();

    const redirect = http.get(
      `http://localhost:5000/${data.shortCode}`,
      { redirects: 0 }
    );

    check(redirect, {
      "redirect returns 302": (r) => r.status === 302,
    });
  }

  sleep(1);
}

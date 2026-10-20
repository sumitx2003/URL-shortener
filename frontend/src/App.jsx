
import { useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  const [url, setUrl] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleShorten(event) {
    event.preventDefault();

    setError("");
    setShortUrl("");
    setCopied(false);

    const originalUrl = url.trim();

    // Validate the URL
    try {
      const parsedUrl = new URL(originalUrl);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        setError("Only HTTP and HTTPS URLs are supported.");
        return;
      }
    } catch {
      setError("Please enter a valid URL beginning with https://");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/urls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // IMPORTANT: Backend expects originalUrl, not url
        body: JSON.stringify({ originalUrl }),
      });

      const data = await response.json();

      console.log("Backend response:", data);

      if (!response.ok) {
        throw new Error(
          data.error || data.message || "Unable to shorten the URL."
        );
      }

      // Read the short URL returned by the backend
      let result =
        data.shortUrl ||
        data.shortURL ||
        data.shortLink ||
        data.short_url;

      // If backend returns only a short code, build the URL
      if (!result && data.shortCode) {
        result = `${API_URL}/${data.shortCode}`;
      }

      if (!result) {
        throw new Error(
          "The backend succeeded but did not return a recognized short URL. Check the console response."
        );
      }

      setShortUrl(result);
    } catch (err) {
      console.error("Shortening error:", err);

      if (err.message === "Failed to fetch") {
        setError(
          "Cannot reach the backend. Check your servers and browser CORS settings."
        );
      } else {
        setError(err.message || "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Please copy the short link manually.");
    }
  }

  return (
    <main className="page">
      <section className="shortener-card">
        <div className="logo">↗</div>

        <p className="eyebrow">YOUR LINKS, SIMPLIFIED</p>

        <h1>
          Shorten your links.
          <br />
          <span>Share more.</span>
        </h1>

        <p className="subtitle">
          Transform long URLs into clean, shareable links in seconds.
        </p>

        <form onSubmit={handleShorten}>
          <label htmlFor="url">Paste your long URL</label>

          <div className="input-row">
            <input
              id="url"
              type="url"
              placeholder="https://example.com/your-long-link"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={loading}
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Shorten URL →"}
            </button>
          </div>
        </form>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {shortUrl && (
          <div className="result" aria-live="polite">
            <div className="result-title">
              ✓ Your short link is ready
            </div>

            <div className="result-row">
              <a
                href={shortUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortUrl}
              </a>

              <button
                className="copy-button"
                onClick={copyLink}
                type="button"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="footer-note">
          <span />
          Fast. Simple. Shareable.
        </div>
      </section>

      <footer>One shorter link can make sharing simpler.</footer>
    </main>
  );
}

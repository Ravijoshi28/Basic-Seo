# Analyzer backend

Run `npm run dev` and call `GET /api/analyze?url=https://example.com`.
Run regression checks with `npm test` (requires Puppeteer's installed Chrome).

The analyzer accepts HTTP(S) destinations on ports 80 and 443, without embedded
credentials. Requests, redirects, and subresources are checked for private and
reserved destinations. A temporary local forwarding proxy connects to validated
IP addresses directly to prevent DNS rebinding between validation and connection.
Chrome retains its sandbox, disables QUIC and non-proxied WebRTC, and routes
loopback destinations through the proxy too.

Before public deployment, isolate the browser worker and enforce outbound network
rules denying internal networks and cloud metadata services as defense in depth.
The proxy and application checks are not an operating-system security boundary
for hostile browser code or a compromised Chrome process.

Each process allows two active analyses, rejects overflow with 503, and permits
ten requests per client IP per minute (429). Jobs have a 45-second deadline;
client disconnects cancel work. Limits are held in memory and reset on restart.
For multiple server processes, enforce shared limits at your gateway or with a
shared store. If deployed behind a proxy, configure Express `trust proxy` only
for your trusted proxy addresses so client IP limits remain meaningful.

Results preserve `url`, `status`, `seo`, and the string array `issues`, and add
structured `findings` with `code`, `severity`, and `message`. Heading/image lists
are capped at 200 entries and strings at 2000 characters. Image counts remain
complete. Dynamic rendering waits up to three seconds after DOM readiness; a
finding indicates when the page remained active at that deadline.

Non-HTML destinations return 422, invalid or blocked targets return 400, network
failures return 502, and navigation/job timeouts return 504. A successfully loaded
HTML page returning an HTTP error still produces findings containing its status.

# PageLens frontend

A responsive Next.js interface for the analyzer backend, with page metadata,
severity filters, heading and image details, cancellation, and JSON report export.
Reports are fetched from `GET /api/analyze?url=...`; the interface starts empty
and displays real results after submission.

## Run locally

1. In `backend`, run `npm install` then `npm run dev` (port 4000 in the current backend configuration; 3000 if PORT is unset).
2. In `useraction`, run `npm install` then `npm run dev`.
3. Open http://localhost:3001 and enter a public website URL.

If the backend runs at a different address, copy `.env.example` to `.env.local`
and update `NEXT_PUBLIC_API_URL`. Restart Next.js after changing it. This public
setting contains only the API origin; keep secrets out of it. For deployment,
set it to the externally reachable backend origin before building and use HTTPS
when the frontend is served over HTTPS. The browser calls Express directly so
client IP rate limits aren't collapsed behind a Next.js proxy.

Run `npm run lint` and `npm run build` to validate the frontend.
For production, run `npm run build` then `npm start` (port 3001).

The dashboard shows the backend's findings rather than calculating an SEO score.
HTTP errors on analyzed HTML pages remain visible in the report. Invalid targets,
non-HTML destinations, busy responses, rate limits, and timeouts appear as errors.
Heading and image lists retain the backend's output caps and full image counts.

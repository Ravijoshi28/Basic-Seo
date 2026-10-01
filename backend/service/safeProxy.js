import http from "node:http";
import net from "node:net";
import { normalizeUrl, validatePublicUrl } from "./urlSafety.js";

// Pin each connection to its validated IP, avoiding a second DNS lookup by Chrome.
export async function createSafeProxy() {
  const sockets = new Set();
  let closed = false;
  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(30000, () => socket.destroy());
    return socket;
  };
  const server = http.createServer(async (request, response) => {
    request.on("error", () => response.destroy());
    try {
      const url = normalizeUrl(request.url);
      if (url.protocol !== "http:") throw new Error("HTTPS requires CONNECT");
      const address = await validatePublicUrl(url);
      if (closed || response.destroyed) return response.destroy();
      const headers = { ...request.headers, host: url.host, connection: "close" };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request({
        hostname: address, port: url.port || 80,
        method: request.method, path: url.pathname + url.search, headers,
      }, (incoming) => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      upstream.on("socket", track);
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      response.writeHead(403);
      response.end("Destination blocked");
    }
  });
  server.on("connection", track);
  server.on("connect", async (request, client, head) => {
    try {
      const url = normalizeUrl(`https://${request.url}`);
      const address = await validatePublicUrl(url);
      if (closed || client.destroyed) return client.destroy();
      const upstream = track(net.connect({ host: address, port: Number(url.port || 443) }));
      client.on("close", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("clientError", (_, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

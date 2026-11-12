/**
 * ABESS SSH over RFC6455 WebSocket (binary framing only).
 * UNPRIVILEGED loopback listener; TLS/WSS is terminated by a trusted reverse proxy.
 * Does not manage SSH credentials, nor accept arbitrary TCP destinations.
 */
import http from 'node:http';
import net from 'node:net';
import {WebSocketServer, createWebSocketStream} from 'ws';
import {pathToFileURL} from 'node:url';

function validPort(value, allowZero = false) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) throw Error('Invalid TCP port');
  return port;
}
export async function startGateway(options = {}) {
  const port = validPort(options.port ?? process.env.SSH_WS_LISTEN_PORT ?? 2080, true);
  const sshPort = validPort(options.sshPort ?? process.env.SSH_WS_SSH_PORT ?? 22);
  const wsPath = options.path ?? process.env.SSH_WS_PATH ?? '/ssh-ws';
  const maxConnections = Number(options.maxConnections ?? process.env.SSH_WS_MAX_CONNECTIONS ?? 512);
  if (!/^\/[A-Za-z0-9/_-]{1,80}$/.test(wsPath) ||
      !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 5000) {
    throw Error('Invalid path or connection ceiling');
  }
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200).end(JSON.stringify({ok: true, connections: wss.clients.size}));
    } else res.writeHead(404).end(JSON.stringify({error: 'not found'}));
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.maxHeadersCount = 32;
  const wss = new WebSocketServer({
    noServer: true, perMessageDeflate: false, maxPayload: 65536,
    clientTracking: true, skipUTF8Validation: false
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.method !== 'GET' || req.url !== wsPath || wss.clients.size >= maxConnections) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Only the local OpenSSH daemon can be reached; not an open TCP proxy.
    const upstream = net.createConnection({host: '127.0.0.1', port: sshPort});
    upstream.setNoDelay(true);
    upstream.setKeepAlive(true, 30000);
    upstream.setTimeout(10000, () => upstream.destroy(new Error('SSH upstream timeout')));
    const stream = createWebSocketStream(ws, {highWaterMark: 64 * 1024});
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      upstream.pipe(stream).pipe(upstream);
    });
    upstream.on('error', () => ws.terminate());
    upstream.on('close', () => {if (ws.readyState === ws.OPEN) ws.close(1000);});
    stream.on('error', () => upstream.destroy());
    stream.on('close', () => upstream.destroy());
    ws.on('error', () => upstream.destroy());
    ws.on('close', () => upstream.destroy());
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {ws.terminate(); continue;}
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    clearInterval(heartbeat);
    throw error;
  }
  return {
    port: server.address().port, server, wss,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
async function main() {
  const gateway = await startGateway();
  process.stdout.write('[SSH-WS] loopback gateway active on 127.0.0.1:' + gateway.port + '\n');
  const stop = async () => {await gateway.close(); process.exitCode = 0;};
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {console.error('[SSH-WS] Startup failed'); process.exitCode = 1;});
}

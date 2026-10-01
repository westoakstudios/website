
import net from 'node:net';
import { config } from './config.js';
import * as protocol from './protocol.js';
import * as state from './state.js';
import * as ratelimit from './ratelimit.js';

function attachReader(socket, onLine, maxBytes) {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    if (buf.length > maxBytes) {
      socket.destroy();
      return;
    }
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      onLine(line);
    }
  });
}

function handleAuth(socket, ip, msg) {
  // 10 auth attempts per 5 min per IP
  const rl = ratelimit.hit('tcp-auth', ip, 10, 5 * 60 * 1000);
  if (!rl.ok) {
    console.log(`[reject] ${ip} ratelimited`);
    socket.destroy();
    return false;
  }
  if (msg.password !== config.clientPassword) {
    console.log(`[reject] ${ip} bad-auth`);
    socket.destroy();
    return false;
  }
  const prev = state.get(ip);
  const keepQueue = config.preserveQueueOnReconnect && prev ? prev.queue : [];
  state.upsert(ip, {
    socket,
    name: msg.name,
    online: true,
    lastSeen: Date.now(),
    queue: keepQueue,
  });
  socket.write(protocol.encodeOk());
  ratelimit.reset('tcp-auth', ip);
  return true;
}

function replyToHeartbeat(socket, ip) {
  state.touch(ip);
  const cmds = state.drainQueue(ip);
  if (cmds.length === 0) {
    socket.write(protocol.encodeNone());
    return;
  }
  for (const cmd of cmds) socket.write(protocol.encodeCommand(cmd));
  socket.write(protocol.encodeNone());
}

function onConnection(socket) {
  const ip = socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown';
  let authed = false;

  socket.setNoDelay(true);
  attachReader(
    socket,
    (line) => {
      const msg = protocol.decodeLine(line);
      if (!authed) {
        if (msg.type !== 'auth') {
          socket.destroy();
          return;
        }
        authed = handleAuth(socket, ip, msg);
        return;
      }
      if (msg.type === 'heartbeat') replyToHeartbeat(socket, ip);
    },
    config.maxLineBytes,
  );

  socket.on('error', () => {});
  socket.on('close', () => {
    const c = state.get(ip);
    if (c && c.socket === socket) c.online = false;
  });
}

export function startTcpServer() {
  const server = net.createServer(onConnection);
  server.listen(config.tcpPort, () => {
    console.log(`[tcp] listening on :${config.tcpPort}`);
  });
  return server;
}
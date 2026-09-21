const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

const stats = {
  activeHubs: 0,
  totalCamsConnected: 0,
  totalViewersConnected: 0,
  bytesIn: 0,
  bytesOut: 0,
  startTime: Date.now()
};

const hubs = new Map();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>...`); // Keep your existing dashboard HTML or stats view here
  } else if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('E-Baboyan Relay Server is up and running v1.0\n');
  }
});

const wss = new WebSocket.Server({ server });

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const role = urlParams.get('role');
  const pairId = urlParams.get('pair_id');

  if (!pairId) {
    ws.close();
    return;
  }

  if (!hubs.has(pairId)) {
    hubs.set(pairId, { camSocket: null, viewers: new Set() });
  }
  const hub = hubs.get(pairId);

  if (role === 'cam') {
    if (hub.camSocket && hub.camSocket !== ws) {
      hub.camSocket.terminate();
    }
    hub.camSocket = ws;
    stats.totalCamsConnected = 1;
    stats.activeHubs = hubs.size;
    console.log(`[+] ESP32-CAM Connected for Hub: ${pairId}`);
    
    if (hub.viewers.size > 0 && hub.camSocket.readyState === WebSocket.OPEN) {
      hub.camSocket.send("START_STREAM");
    }

    for (const viewer of hub.viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(JSON.stringify({ status: 'cam_online' }));
      }
    }
  } else {
    hub.viewers.add(ws);
    stats.totalViewersConnected = hub.viewers.size;
    console.log(`[+] Dashboard Viewer Connected for Hub: ${pairId}`);
    
    if (hub.viewers.size === 1 && hub.camSocket && hub.camSocket.readyState === WebSocket.OPEN) {
      hub.camSocket.send("START_STREAM");
    }

    ws.send(JSON.stringify({ status: hub.camSocket ? 'cam_online' : 'cam_offline' }));
  }

  ws.on('message', (data) => {
    if (ws === hub.camSocket) {
      stats.bytesIn += data.length || data.byteLength || 0;
      for (const viewer of hub.viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data);
          stats.bytesOut += data.length || data.byteLength || 0;
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws === hub.camSocket) {
      hub.camSocket = null;
      stats.totalCamsConnected = 0;
      console.log(`[-] ESP32-CAM Disconnected for Hub: ${pairId}`);
      for (const viewer of hub.viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ status: 'cam_offline' }));
        }
      }
    } else {
      hub.viewers.delete(ws);
      stats.totalViewersConnected = hub.viewers.size;
      console.log(`[-] Viewer Disconnected from Hub: ${pairId}`);

      if (hub.viewers.size === 0 && hub.camSocket && hub.camSocket.readyState === WebSocket.OPEN) {
        hub.camSocket.send("STOP_STREAM");
      }
    }
    stats.activeHubs = hubs.size;
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err.message);
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 25000); // 25-second server heartbeat ping

server.listen(PORT, () => {
  console.log(`HTTP and WebSocket Relay Server running on port ${PORT}`);
});

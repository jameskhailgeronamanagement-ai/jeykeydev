const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

// Create a standard HTTP server to handle UptimeRobot health-check pings
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('E-Baboyan Relay Server is up and running v1.0\n');
});

// Attach the WebSocket server to the same HTTP server instance
const wss = new WebSocket.Server({ server });

// Store cameras and viewers mapped by pair_id
const hubs = new Map(); // pair_id -> { camSocket: ws, viewers: Set }

wss.on('connection', (ws, req) => {
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
    hub.camSocket = ws;
    console.log(`[+] ESP32-CAM Connected for Hub: ${pairId}`);
    
    // If viewers are already waiting, tell the camera to start streaming immediately
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
    console.log(`[+] Dashboard Viewer Connected for Hub: ${pairId}`);
    
    // Tell camera to start streaming because a viewer joined
    if (hub.viewers.size === 1 && hub.camSocket && hub.camSocket.readyState === WebSocket.OPEN) {
      hub.camSocket.send("START_STREAM");
      console.log(`[->] Sent START_STREAM to camera for Hub: ${pairId}`);
    }

    ws.send(JSON.stringify({ status: hub.camSocket ? 'cam_online' : 'cam_offline' }));
  }

  ws.on('message', (data) => {
    if (ws === hub.camSocket) {
      for (const viewer of hub.viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data);
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws === hub.camSocket) {
      hub.camSocket = null;
      console.log(`[-] ESP32-CAM Disconnected for Hub: ${pairId}`);
      for (const viewer of hub.viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ status: 'cam_offline' }));
        }
      }
    } else {
      hub.viewers.delete(ws);
      console.log(`[-] Viewer Disconnected from Hub: ${pairId}`);

      // If no viewers are left, pause camera stream to save bandwidth
      if (hub.viewers.size === 0 && hub.camSocket && hub.camSocket.readyState === WebSocket.OPEN) {
        hub.camSocket.send("STOP_STREAM");
        console.log(`[->] Sent STOP_STREAM to camera for Hub: ${pairId}`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`HTTP and WebSocket Relay Server running on port ${PORT}`);
});

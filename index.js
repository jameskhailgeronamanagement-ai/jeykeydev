const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

// Create a standard HTTP server to handle UptimeRobot pings and browser landing page visits
const server = http.createServer((req, res) => {
  // If someone visits the root URL via a web browser, serve a proper HTML page
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html lang="en" class="h-full bg-[#080c14]">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>E-Baboyan Relay Server</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
          <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
              body { font-family: 'Plus Jakarta Sans', sans-serif; }
              .glass { background: linear-gradient(135deg, rgba(17, 24, 39, 0.9) 0%, rgba(11, 15, 25, 0.95) 100%); border: 1px solid rgba(255, 255, 255, 0.05); }
          </style>
      </head>
      <body class="h-full flex items-center justify-center text-slate-200 antialiased p-4">
          <div class="glass max-w-md w-full p-8 rounded-3xl text-center shadow-2xl relative overflow-hidden">
              <div class="absolute -top-16 -right-16 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl"></div>
              <div class="h-14 w-14 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-4 text-xl">
                  <i class="fa-solid fa-server"></i>
              </div>
              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-3">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Relay Node Active
              </span>
              <h1 class="text-xl font-bold text-white mb-1">E-Baboyan WebSocket Hub</h1>
              <p class="text-xs text-slate-400 mb-6">ESP32-CAM live video relay backend is up and running successfully.</p>
              <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 font-mono">
                Status: Online & Ready for Connections
              </div>
          </div>
      </body>
      </html>
    `);
  } else {
    // Fallback plain text response for standard health check pings (like UptimeRobot)
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('E-Baboyan Relay Server is up and running v1.0\n');
  }
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

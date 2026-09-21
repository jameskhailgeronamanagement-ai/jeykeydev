const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

// Track global relay statistics for the dashboard
const stats = {
  activeHubs: 0,
  totalCamsConnected: 0,
  totalViewersConnected: 0,
  bytesIn: 0,
  bytesOut: 0,
  startTime: Date.now()
};

// Store cameras and viewers mapped by pair_id
const hubs = new Map(); // pair_id -> { camSocket: ws, viewers: Set }

// Create HTTP server for UptimeRobot health checks and the live status dashboard
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html lang="en" class="h-full bg-[#080c14]">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>E-Baboyan Relay Dashboard</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
          <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
              .glass { background: linear-gradient(135deg, rgba(17, 24, 39, 0.9) 0%, rgba(11, 15, 25, 0.95) 100%); border: 1px solid rgba(255, 255, 255, 0.05); font-family: 'Plus Jakarta Sans', sans-serif; }
          </style>
          <script>
              async function fetchStats() {
                  try {
                      const res = await fetch('/stats');
                      const data = await res.json();
                      document.getElementById('active-hubs').innerText = data.activeHubs;
                      document.getElementById('cams-online').innerText = data.totalCamsConnected;
                      document.getElementById('viewers-online').innerText = data.totalViewersConnected;
                      document.getElementById('bytes-in').innerText = (data.bytesIn / (1024 * 1024)).toFixed(2) + ' MB';
                      document.getElementById('bytes-out').innerText = (data.bytesOut / (1024 * 1024)).toFixed(2) + ' MB';
                  } catch (e) { console.error('Failed to update stats', e); }
              }
              setInterval(fetchStats, 2000);
          </script>
      </head>
      <body class="h-full flex flex-col text-slate-200 antialiased p-4 sm:p-8 justify-between max-w-5xl mx-auto bg-[#080c14]">
          <header class="flex justify-between items-center pb-6 border-b border-slate-800">
              <div class="flex items-center space-x-3">
                  <div class="h-10 w-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/20">
                      <i class="fa-solid fa-server text-sm"></i>
                  </div>
                  <div>
                      <h1 class="text-base font-bold text-white tracking-tight">E-Baboyan Relay Hub</h1>
                      <span class="text-xs font-mono text-emerald-400">Live Traffic & Telemetry Monitor</span>
                  </div>
              </div>
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Relay Active
              </div>
          </header>
          <main class="py-6 space-y-6">
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div class="glass p-4 rounded-2xl"><p class="text-xs text-slate-400 mb-1">Active Hubs</p><h3 id="active-hubs" class="text-2xl font-extrabold font-mono text-white">0</h3></div>
                  <div class="glass p-4 rounded-2xl"><p class="text-xs text-slate-400 mb-1">Connected Cameras</p><h3 id="cams-online" class="text-2xl font-extrabold font-mono text-emerald-400">0</h3></div>
                  <div class="glass p-4 rounded-2xl"><p class="text-xs text-slate-400 mb-1">Active Viewers</p><h3 id="viewers-online" class="text-2xl font-extrabold font-mono text-cyan-400">0</h3></div>
                  <div class="glass p-4 rounded-2xl"><p class="text-xs text-slate-400 mb-1">Status</p><h3 class="text-sm font-bold font-mono text-emerald-400 mt-1">Healthy</h3></div>
              </div>
              <div class="glass p-6 rounded-3xl">
                  <h2 class="text-sm font-bold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-chart-line text-emerald-400"></i> Data Throughput</h2>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800"><span class="text-xs text-slate-400 block mb-1">Incoming (ESP32-CAM)</span><span id="bytes-in" class="text-xl font-mono font-bold text-white">0.00 MB</span></div>
                      <div class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800"><span class="text-xs text-slate-400 block mb-1">Outgoing (Dashboard)</span><span id="bytes-out" class="text-xl font-mono font-bold text-white">0.00 MB</span></div>
                  </div>
              </div>
          </main>
      </body>
      </html>
    `);
  } else if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('E-Baboyan Relay Server is up and running v1.0\n');
  }
});

// Attach WebSocket Server
const wss = new WebSocket.Server({ server });

// Heartbeat function to drop dead sockets and prevent proxy timeouts
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
    // If a camera already exists, terminate the old socket cleanly
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
      console.log(`[->] Sent START_STREAM to camera for Hub: ${pairId}`);
    }

    ws.send(JSON.stringify({ status: hub.camSocket ? 'cam_online' : 'cam_offline' }));
  }

  // Handle binary data routing
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
        console.log(`[->] Sent STOP_STREAM to camera for Hub: ${pairId}`);
      }
    }
    stats.activeHubs = hubs.size;
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err.message);
  });
});

// Periodic ping interval to detect dropped connections and keep Render sockets open
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`HTTP and WebSocket Relay Server running on port ${PORT}`);
});

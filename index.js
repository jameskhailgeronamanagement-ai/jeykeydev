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
const hubs = new Map(); // pair_id -> { camSocket: ws, viewers: Set, bytesIn: 0, bytesOut: 0 }

// Create a standard HTTP server to handle health checks and render the live status dashboard
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
          <script>
              tailwind.config = {
                  theme: {
                      extend: {
                          fontFamily: {
                              sans: ['"Plus Jakarta Sans"', 'sans-serif'],
                              mono: ['"JetBrains Mono"', 'monospace'],
                          }
                      }
                  }
              }
          </script>
          <style>
              .glass { background: linear-gradient(135deg, rgba(17, 24, 39, 0.9) 0%, rgba(11, 15, 25, 0.95) 100%); border: 1px solid rgba(255, 255, 255, 0.05); }
          </style>
          <script>
              // Auto-refresh metrics every 2 seconds via a simple fetch API or polling
              async function fetchStats() {
                  try {
                      const res = await fetch('/stats');
                      const data = await res.json();
                      document.getElementById('active-hubs').innerText = data.activeHubs;
                      document.getElementById('cams-online').innerText = data.totalCamsConnected;
                      document.getElementById('viewers-online').innerText = data.totalViewersConnected;
                      document.getElementById('bytes-in').innerText = (data.bytesIn / (1024 * 1024)).toFixed(2) + ' MB';
                      document.getElementById('bytes-out').innerText = (data.bytesOut / (1024 * 1024)).toFixed(2) + ' MB';
                      
                      const uptimeSec = Math.floor((Date.now() - data.startTime) / 1000);
                      const hrs = Math.floor(uptimeSec / 3600);
                      const mins = Math.floor((uptimeSec % 3600) / 60);
                      const secs = uptimeSec % 60;
                      document.getElementById('uptime').innerText = \`\${hrs}h \${mins}m \${secs}s\`;
                  } catch (e) {
                      console.error('Failed to update stats', e);
                  }
              }
              setInterval(fetchStats, 2000);
          </script>
      </head>
      <body class="h-full flex flex-col text-slate-200 antialiased p-4 sm:p-8 justify-between max-w-5xl mx-auto">
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
              <!-- Grid Metrics Cards -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div class="glass p-4 rounded-2xl">
                      <p class="text-xs text-slate-400 mb-1">Active Hubs</p>
                      <h3 id="active-hubs" class="text-2xl font-extrabold font-mono text-white">${stats.activeHubs}</h3>
                  </div>
                  <div class="glass p-4 rounded-2xl">
                      <p class="text-xs text-slate-400 mb-1">Connected Cameras</p>
                      <h3 id="cams-online" class="text-2xl font-extrabold font-mono text-emerald-400">${stats.totalCamsConnected}</h3>
                  </div>
                  <div class="glass p-4 rounded-2xl">
                      <p class="text-xs text-slate-400 mb-1">Active Viewers</p>
                      <h3 id="viewers-online" class="text-2xl font-extrabold font-mono text-cyan-400">${stats.totalViewersConnected}</h3>
                  </div>
                  <div class="glass p-4 rounded-2xl">
                      <p class="text-xs text-slate-400 mb-1">Server Uptime</p>
                      <h3 id="uptime" class="text-lg font-bold font-mono text-slate-300 mt-1">0h 0m 0s</h3>
                  </div>
              </div>

              <!-- Data Throughput Panel -->
              <div class="glass p-6 rounded-3xl">
                  <h2 class="text-sm font-bold text-white mb-4 flex items-center gap-2">
                      <i class="fa-solid fa-chart-line text-emerald-400"></i> Network Data Throughput (Bandwidth Relay)
                  </h2>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                          <div>
                              <span class="text-xs text-slate-400 block mb-1"><i class="fa-solid fa-arrow-down text-emerald-400 mr-1"></i> Incoming Data (From ESP32-CAM)</span>
                              <span id="bytes-in" class="text-xl font-mono font-bold text-white">0.00 MB</span>
                          </div>
                      </div>
                      <div class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                          <div>
                              <span class="text-xs text-slate-400 block mb-1"><i class="fa-solid fa-arrow-up text-cyan-400 mr-1"></i> Outgoing Data (To Dashboard Viewer)</span>
                              <span id="bytes-out" class="text-xl font-mono font-bold text-white">0.00 MB</span>
                          </div>
                      </div>
                  </div>
              </div>
          </main>

          <footer class="pt-4 border-t border-slate-800 text-center text-xs text-slate-500 font-mono">
              Admin: jeykey.developer@gmail.com &bull; Render WebSocket Gateway
          </footer>
      </body>
      </html>
    `);
  } else if (req.method === 'GET' && req.url === '/stats') {
    // JSON endpoint for real-time dashboard updates
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else {
    // Fallback health check plain text for UptimeRobot
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('E-Baboyan Relay Server is up and running v1.0\n');
  }
});

// Attach the WebSocket server to the same HTTP server instance
const wss = new WebSocket.Server({ server });

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

  // Handle incoming binary frame data from camera and route to viewers
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

server.listen(PORT, () => {
  console.log(`HTTP and WebSocket Relay Server running on port ${PORT}`);
});

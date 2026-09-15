const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let cameraSocket = null;
const viewers = new Set();

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const role = urlParams.get('role');

  if (role === 'cam') {
    cameraSocket = ws;
    console.log('[+] ESP32-CAM Connected');
    // Notify all viewers that camera is now online
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(JSON.stringify({ status: 'cam_online' }));
      }
    }
  } else {
    viewers.add(ws);
    console.log('[+] Dashboard Viewer Connected');
    // Send initial status to new viewer
    ws.send(JSON.stringify({ status: cameraSocket ? 'cam_online' : 'cam_offline' }));
  }

  // Handle incoming data
  ws.on('message', (data) => {
    if (ws === cameraSocket) {
      // Forward binary JPEG frames to all dashboard viewers
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data);
        }
      }
    }
  });

  // Handle disconnects cleanly
  ws.on('close', () => {
    if (ws === cameraSocket) {
      cameraSocket = null;
      console.log('[-] ESP32-CAM Disconnected');
      // Broadcast offline status to all viewers immediately
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ status: 'cam_offline' }));
        }
      }
    } else {
      viewers.delete(ws);
      console.log('[-] Viewer Disconnected');
    }
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err.message);
  });
});

console.log(`WebSocket Relay Server running on port ${PORT}`);

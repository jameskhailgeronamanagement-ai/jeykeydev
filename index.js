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
  } else {
    viewers.add(ws);
    console.log('[+] Dashboard Viewer Connected');
  }

  ws.on('message', (data) => {
    if (ws === cameraSocket) {
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data);
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws === cameraSocket) {
      cameraSocket = null;
      console.log('[-] ESP32-CAM Disconnected');
    } else {
      viewers.delete(ws);
      console.log('[-] Viewer Disconnected');
    }
  });
});

console.log(`WebSocket Relay Server running on port ${PORT}`);

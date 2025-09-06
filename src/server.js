const express = require('express');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const basicAuth = require('express-basic-auth');

// --- DÉFINITION DES PORTS ---
const WSS_PORT = 8080; // Port pour le serveur WebSocket
const HTTP_PORT = 4001; // Port pour le serveur Express (admin)

// ==================================================================
// SERVEUR WEBSOCKET (comme dans drawlima)
// ==================================================================
const wss = new WebSocketServer({ port: WSS_PORT, host: '127.0.0.1' });

let state = {
  compteurs: { 'on va dire': 0, 'notamment': 0 },
  lastScorer: { pseudo: null, phrase: null },
  isLiveMode: true,
};
const phraseLocks = { 'on va dire': false, 'notamment': false };
const rateLimiter = new Map();

function broadcastState() {
  const message = JSON.stringify({ type: 'updateState', payload: state });
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'];
  console.log(`[WSS] Un utilisateur s'est connecté: ${clientId}`);
  ws.send(JSON.stringify({ type: 'updateState', payload: state }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const pseudo = ws.pseudo || 'Anonyme';
      switch (data.type) {
        case 'setPseudo':
          ws.pseudo = data.payload.substring(0, 15);
          break;
        case 'incrementCounter':
          const { phrase } = data.payload;
          if (!state.isLiveMode || phraseLocks[phrase]) return;
          const now = Date.now();
          const userTimestamps = rateLimiter.get(clientId) || [];
          const recentTimestamps = userTimestamps.filter(ts => now - ts < 10000);
          if (recentTimestamps.length >= 5) return;
          rateLimiter.set(clientId, [...recentTimestamps, now]);
          phraseLocks[phrase] = true;
          state.compteurs[phrase]++;
          state.lastScorer = { pseudo, phrase };
          broadcastState();
          setTimeout(() => { phraseLocks[phrase] = false; }, 2500);
          break;
      }
    } catch (error) {
      console.error('[WSS] Erreur de message WebSocket:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[WSS] L'utilisateur s'est déconnecté: ${clientId}`);
    rateLimiter.delete(clientId);
  });
  ws.on('error', console.error);
});

console.log(`🚀 Le serveur WebSocket du Compteur MIAGE écoute sur le port ${WSS_PORT} (IPv4)`);

// --- Logique Cron (inchangée) ---
cron.schedule('55-59 * * * *', () => {
  console.log('[CRON] Passage en mode Scoreboard.');
  state.isLiveMode = false;
  broadcastState();
});
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Réinitialisation des compteurs.');
  state.compteurs = { 'on va dire': 0, 'notamment': 0 };
  state.lastScorer = { pseudo: null, phrase: null };
  state.isLiveMode = true;
  broadcastState();
});


// ==================================================================
// SERVEUR EXPRESS POUR L'ADMIN (sur un autre port)
// ==================================================================
const app = express();
app.use('/admin', basicAuth({ users: { 'admin': 'supersecret' }, challenge: true }));
app.get('/admin/logs', (req, res) => res.json({ message: "TODO: Renvoyer les logs de la BDD" }));

app.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`🚀 Le serveur Admin (Express) écoute sur le port ${HTTP_PORT} (IPv4)`);
});
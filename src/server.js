const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws'); // On importe depuis 'ws'
const cron = require('node-cron');
const basicAuth = require('express-basic-auth');

const app = express();
const server = http.createServer(app);

// On crée le serveur WebSocket et on lui dit d'utiliser le même serveur HTTP/S
// Le `path` est crucial pour qu'il ne réponde que sur /com/
const wss = new WebSocketServer({ server, path: '/com/' });

const PORT = process.env.PORT || 4000;

// L'état de l'application reste le même
let state = {
  compteurs: { 'on va dire': 0, 'notamment': 0 },
  lastScorer: { pseudo: null, phrase: null },
  isLiveMode: true,
};

const phraseLocks = { 'on va dire': false, 'notamment': false };
const rateLimiter = new Map();

// --- Logique Cron (inchangée) ---
cron.schedule('55-59 * * * *', () => {
  console.log('[CRON] Passage en mode Scoreboard.');
  state.isLiveMode = false;
  broadcastState(); // On diffuse le nouvel état
});

cron.schedule('0 * * * *', () => {
  console.log('[CRON] Réinitialisation des compteurs.');
  state.compteurs = { 'on va dire': 0, 'notamment': 0 };
  state.lastScorer = { pseudo: null, phrase: null };
  state.isLiveMode = true;
  broadcastState(); // On diffuse le nouvel état
});

// --- Helper pour diffuser l'état à tous les clients connectés ---
function broadcastState() {
  // Avec 'ws', on doit créer notre propre logique de diffusion
  const message = JSON.stringify({ type: 'updateState', payload: state });
  wss.clients.forEach(client => {
    // On vérifie que le client est bien prêt à recevoir des messages
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

// --- Gestion des connexions WebSocket ---
wss.on('connection', (ws, req) => {
  // `ws` représente la connexion d'un client unique
  const clientId = req.headers['sec-websocket-key']; // Un identifiant unique pour la connexion
  console.log(`Un utilisateur s'est connecté: ${clientId}`);

  // 1. Envoyer l'état actuel au nouveau client
  ws.send(JSON.stringify({ type: 'updateState', payload: state }));

  // 2. Écouter les messages entrants de ce client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const pseudo = ws.pseudo || 'Anonyme'; // Le pseudo est stocké sur l'objet de connexion

      // On utilise un `switch` pour gérer les différents types de messages
      switch (data.type) {
        case 'setPseudo':
          ws.pseudo = data.payload.substring(0, 15);
          break;

        case 'incrementCounter':
          const { phrase } = data.payload;

          if (!state.isLiveMode) return;
          
          // Logique de Rate Limiting (adaptée)
          const now = Date.now();
          const userTimestamps = rateLimiter.get(clientId) || [];
          const recentTimestamps = userTimestamps.filter(ts => now - ts < 10000);
          if (recentTimestamps.length >= 5) return;
          rateLimiter.set(clientId, [...recentTimestamps, now]);

          // Logique de "Buzz" (inchangée)
          if (phraseLocks[phrase]) return;
          phraseLocks[phrase] = true;

          state.compteurs[phrase]++;
          state.lastScorer = { pseudo, phrase };
          
          broadcastState(); // On diffuse le nouvel état à tout le monde

          setTimeout(() => { phraseLocks[phrase] = false; }, 2500);
          break;
      }
    } catch (error) {
      console.error('Erreur de message WebSocket:', error);
    }
  });

  // 3. Gérer la déconnexion
  ws.on('close', () => {
    console.log(`L'utilisateur s'est déconnecté: ${clientId}`);
    rateLimiter.delete(clientId); // Nettoyer le rate limiter
  });
  
  ws.on('error', console.error);
});


// --- Routes Admin Express (inchangées) ---
app.use('/admin', basicAuth({ users: { 'admin': 'supersecret' }, challenge: true }));
app.get('/admin/logs', (req, res) => res.json({ message: "TODO: Renvoyer les logs de la BDD" }));

// On lance le serveur HTTP (qui héberge aussi le serveur WebSocket)
server.listen(PORT, '127.0.0.1', () => console.log(`🚀 Le serveur (HTTP + WS) du Compteur MIAGE écoute sur le port ${PORT} (IPv4)`));
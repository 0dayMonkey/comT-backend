const express = require('express');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const basicAuth = require('express-basic-auth');

// --- DÉFINITION DES PORTS ---
const WSS_PORT = 4000; // Port pour le serveur WebSocket
const HTTP_PORT = 4001; // Port pour le serveur Express (admin)

// ==================================================================
// SERVEUR WEBSOCKET
// ==================================================================
const wss = new WebSocketServer({ 
    port: WSS_PORT, 
    host: '127.0.0.1'
});

let state = {
  compteurs: { 'on va dire': 0, 'notamment': 0 },
  lastScorer: { pseudo: null, phrase: null },
  isLiveMode: true,
};

const phraseLocks = { 'on va dire': false, 'notamment': false };
const rateLimiter = new Map();

function broadcastState() {
  const message = JSON.stringify({ type: 'updateState', payload: state });
  console.log(`[WSS] Broadcast état vers ${wss.clients.size} clients`);
  
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[WSS] Erreur envoi message:', error);
      }
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'] || `client_${Math.random().toString(36).substring(7)}`;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  console.log(`[WSS] 🔌 Nouvelle connexion: ${clientId}`);
  console.log(`[WSS] User-Agent: ${userAgent}`);
  console.log(`[WSS] URL: ${req.url}`);
  console.log(`[WSS] Total connexions: ${wss.clients.size}`);
  
  // Envoyer l'état immédiatement à la connexion
  try {
    ws.send(JSON.stringify({ type: 'updateState', payload: state }));
    console.log(`[WSS] État initial envoyé à ${clientId}`);
  } catch (error) {
    console.error(`[WSS] Erreur envoi état initial à ${clientId}:`, error);
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const pseudo = ws.pseudo || 'Anonyme';
      
      console.log(`[WSS] 📨 Message de ${pseudo} (${clientId}):`, data);
      
      switch (data.type) {
        case 'setPseudo':
          const newPseudo = data.payload.substring(0, 15).trim();
          ws.pseudo = newPseudo;
          console.log(`[WSS] 👤 Pseudo défini pour ${clientId}: "${newPseudo}"`);
          break;
          
        case 'incrementCounter':
          const { phrase } = data.payload;
          console.log(`[WSS] 🎯 Tentative d'incrément pour "${phrase}" par ${pseudo} (${clientId})`);
          
          // Vérification mode live
          if (!state.isLiveMode) {
            console.log(`[WSS] ❌ Mode non-live, incrément refusé`);
            return;
          }
          
          // Vérification verrou phrase
          if (phraseLocks[phrase]) {
            console.log(`[WSS] 🔒 Phrase "${phrase}" verrouillée, incrément refusé`);
            return;
          }
          
          // Rate limiting
          const now = Date.now();
          const userTimestamps = rateLimiter.get(clientId) || [];
          const recentTimestamps = userTimestamps.filter(ts => now - ts < 10000);
          
          if (recentTimestamps.length >= 5) {
            console.log(`[WSS] ⚠️ Rate limit atteint pour ${clientId} (${recentTimestamps.length}/5)`);
            return;
          }
          
          rateLimiter.set(clientId, [...recentTimestamps, now]);
          
          // Incrément autorisé
          phraseLocks[phrase] = true;
          state.compteurs[phrase]++;
          state.lastScorer = { pseudo, phrase };
          
          console.log(`[WSS] ✅ Compteur "${phrase}" incrémenté à ${state.compteurs[phrase]} par ${pseudo}`);
          
          broadcastState();
          
          // Déverrouillage après 2.5 secondes
          setTimeout(() => { 
            phraseLocks[phrase] = false; 
            console.log(`[WSS] 🔓 Déverrouillage de "${phrase}"`);
          }, 2500);
          break;
          
        default:
          console.log(`[WSS] ❓ Type de message inconnu: ${data.type}`);
      }
    } catch (error) {
      console.error('[WSS] ❌ Erreur parsing message:', error);
      console.error('[WSS] Message reçu:', message.toString());
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WSS] 🔌 Déconnexion ${clientId}: Code ${code}, Raison: ${reason}`);
    console.log(`[WSS] Total connexions restantes: ${wss.clients.size - 1}`);
    rateLimiter.delete(clientId);
  });
  
  ws.on('error', (error) => {
    console.error(`[WSS] ❌ Erreur WebSocket pour ${clientId}:`, error);
  });

  // Ping/pong pour maintenir la connexion
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Nettoyage des connexions mortes toutes les 30 secondes
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('[WSS] 💀 Fermeture connexion morte');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Gestion des erreurs du serveur WebSocket
wss.on('error', (error) => {
  console.error('[WSS] ❌ Erreur du serveur WebSocket:', error);
});

// Gestion de la fermeture propre
wss.on('close', () => {
  console.log('[WSS] 🔴 Serveur WebSocket fermé');
  clearInterval(interval);
});

console.log(`🚀 Le serveur WebSocket du Compteur MIAGE écoute sur 127.0.0.1:${WSS_PORT}`);
console.log(`📊 État initial des compteurs:`, state.compteurs);

// --- Logique Cron ---
cron.schedule('55-59 * * * *', () => {
  console.log('[CRON] 📊 Passage en mode Scoreboard (minutes 55-59)');
  state.isLiveMode = false;
  broadcastState();
});

cron.schedule('0 * * * *', () => {
  console.log('[CRON] 🔄 Réinitialisation des compteurs (minute 0)');
  state.compteurs = { 'on va dire': 0, 'notamment': 0 };
  state.lastScorer = { pseudo: null, phrase: null };
  state.isLiveMode = true;
  console.log('[CRON] 📊 Nouveaux compteurs:', state.compteurs);
  broadcastState();
});

// ==================================================================
// SERVEUR EXPRESS POUR L'ADMIN
// ==================================================================
const app = express();

// Middleware de base
app.use(express.json());
app.use(express.static('public')); // Si vous avez des fichiers statiques

// Protection basique pour l'admin
app.use('/admin', basicAuth({ 
  users: { 'admin': 'supersecret' }, 
  challenge: true,
  realm: 'Compteur MIAGE Admin'
}));

// Routes admin
app.get('/admin', (req, res) => {
  res.json({
    message: "Interface d'administration du Compteur MIAGE",
    state: state,
    connections: wss.clients.size,
    uptime: process.uptime()
  });
});

app.get('/admin/state', (req, res) => {
  res.json({
    state: state,
    connections: wss.clients.size,
    locks: phraseLocks
  });
});

app.post('/admin/reset', (req, res) => {
  console.log('[ADMIN] 🔄 Réinitialisation manuelle des compteurs');
  state.compteurs = { 'on va dire': 0, 'notamment': 0 };
  state.lastScorer = { pseudo: null, phrase: null };
  broadcastState();
  res.json({ success: true, message: 'Compteurs réinitialisés' });
});

app.post('/admin/toggle-mode', (req, res) => {
  state.isLiveMode = !state.isLiveMode;
  console.log(`[ADMIN] 🎚️ Mode changé vers: ${state.isLiveMode ? 'LIVE' : 'SCOREBOARD'}`);
  broadcastState();
  res.json({ success: true, mode: state.isLiveMode ? 'live' : 'scoreboard' });
});

app.get('/admin/logs', (req, res) => {
  res.json({ 
    message: "Logs du système",
    state: state,
    rateLimiterSize: rateLimiter.size,
    connections: wss.clients.size
  });
});

// Gestion des erreurs Express
app.use((error, req, res, next) => {
  console.error('[EXPRESS] ❌ Erreur:', error);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Démarrage du serveur Express
const server = app.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`🚀 Le serveur Admin (Express) écoute sur 127.0.0.1:${HTTP_PORT}`);
  console.log(`🔐 Interface admin: https://miaou.vps.webdock.cloud/admin/`);
});

// Gestion de l'arrêt propre
process.on('SIGTERM', () => {
  console.log('🔴 SIGTERM reçu, arrêt en cours...');
  server.close(() => {
    console.log('🔴 Serveur Express fermé');
  });
  wss.close(() => {
    console.log('🔴 Serveur WebSocket fermé');
  });
});

process.on('SIGINT', () => {
  console.log('🔴 SIGINT reçu, arrêt en cours...');
  server.close(() => {
    console.log('🔴 Serveur Express fermé');
  });
  wss.close(() => {
    console.log('🔴 Serveur WebSocket fermé');
  });
  process.exit(0);
});
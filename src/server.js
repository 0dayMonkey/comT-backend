const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');
const basicAuth = require('express-basic-auth');

const app = express();
const server = http.createServer(app);

// --- MODIFICATION ICI : Spécifier l'URL du frontend ---
const io = new Server(server, {
  cors: {
    origin: "https://teamcrouton.com", // REMPLACEZ PAR L'URL DE VOTRE FRONTEND
    methods: ["GET", "POST"]
  }
});

// On applique aussi la restriction CORS pour les requêtes HTTP (pour l'admin panel)
app.use(cors({ origin: "https://teamcrouton.com" })); // REMPLACEZ PAR L'URL DE VOTRE FRONTEND

const PORT = process.env.PORT || 4000;

let state = {
  compteurs: { 'on va dire': 0, 'notamment': 0 },
  lastScorer: { pseudo: null, phrase: null },
  pseudos: {},
  isLiveMode: true,
};

const phraseLocks = { 'on va dire': false, 'notamment': false };
const rateLimiter = new Map();

cron.schedule('55-59 * * * *', () => {
  console.log('[CRON] Passage en mode Scoreboard.');
  state.isLiveMode = false;
  io.emit('updateState', state);
});

cron.schedule('0 * * * *', () => {
  console.log('[CRON] Réinitialisation des compteurs.');
  state.compteurs = { 'on va dire': 0, 'notamment': 0 };
  state.lastScorer = { pseudo: null, phrase: null };
  state.isLiveMode = true;
  io.emit('updateState', state);
});

io.on('connection', (socket) => {
  console.log(`Un utilisateur s'est connecté: ${socket.id}`);
  socket.emit('updateState', state);

  socket.on('setPseudo', (pseudo) => {
    state.pseudos[socket.id] = pseudo.substring(0, 15);
    console.log(`L'utilisateur ${socket.id} a choisi le pseudo: ${pseudo}`);
  });

  socket.on('incrementCounter', (data) => {
    const { phrase } = data;
    const pseudo = state.pseudos[socket.id] || 'Anonyme';
    
    if (!state.isLiveMode) return;

    const now = Date.now();
    const userTimestamps = rateLimiter.get(socket.id) || [];
    const recentTimestamps = userTimestamps.filter(ts => now - ts < 10000);
    if (recentTimestamps.length >= 5) return;
    rateLimiter.set(socket.id, [...recentTimestamps, now]);

    if (phraseLocks[phrase]) return;

    phraseLocks[phrase] = true;
    state.compteurs[phrase]++;
    state.lastScorer = { pseudo, phrase };
    
    io.emit('updateState', state);

    setTimeout(() => { phraseLocks[phrase] = false; }, 2500);
  });

  socket.on('disconnect', () => {
    console.log(`L'utilisateur s'est déconnecté: ${socket.id}`);
    delete state.pseudos[socket.id];
  });
});

app.use('/admin', basicAuth({ users: { 'admin': 'supersecret' }, challenge: true }));
app.get('/admin/logs', (req, res) => res.json({ message: "TODO: Renvoyer les logs de la BDD" }));
app.delete('/admin/logs/:id', (req, res) => res.json({ success: true, message: `Log ${req.params.id} supprimé.` }));

server.listen(PORT, () => console.log(`🚀 Le serveur écoute sur le port ${PORT}`));
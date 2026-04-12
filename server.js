// ── Sentry — DOIT être initialisé avant tous les autres imports ────────────
// Permet l'instrumentation automatique d'Express, Stripe, fetch, etc.
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.0, // Pas de tracing perf (économies Railway)
    beforeSend(event) {
      // Ne jamais logger de données sensibles
      if (event.request) {
        if (event.request.headers) {
          ['authorization', 'Authorization', 'cookie', 'Cookie'].forEach(h => delete event.request.headers[h]);
        }
        // Supprimer le corps (tokens, mots de passe, CNI, IBAN)
        delete event.request.data;
      }
      return event;
    },
  });
}
// ──────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const compression = require('compression');
const { Resend } = require('resend');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');


const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['https://courspool.vercel.app', 'capacitor://localhost'];
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });
app.set('io', io);

// ── Auth middleware Socket.io ─────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
    let userId;
    if (SUPABASE_JWT_SECRET) {
      const payload = jwt.verify(token, SUPABASE_JWT_SECRET.trim());
      if (!payload?.sub) return next(new Error('unauthorized'));
      userId = payload.sub;
    } else {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return next(new Error('unauthorized'));
      userId = data.user.id;
    }
    // Vérification bloqué avec cache
    const cached = _blockedCache.get(userId);
    if (cached && Date.now() - cached.ts < BLOCKED_CACHE_TTL) {
      if (cached.blocked) return next(new Error('blocked'));
    } else {
      const { data: profile } = await supabase.from('profiles').select('statut_compte,role').eq('id', userId).single();
      const blocked = profile?.statut_compte === 'bloqué';
      _blockedCache.set(userId, { blocked, role: profile?.role, ts: Date.now() });
      if (blocked) return next(new Error('blocked'));
    }
    socket.userId = userId;
    next();
  } catch(e) { next(new Error('unauthorized')); }
});

// ── Tableau blanc collaboratif — rooms en mémoire ────────────
// { ops:[], snapshot:null, editors:Set<userId>, ownerId, participants:Map<userId,name>, lastActivity:ts }
const boardRooms = new Map();
// socketId → Set<roomId> — pour nettoyage sur disconnect
const socketBoardRooms = new Map();
// Purge des rooms inactives depuis plus de 2h (abandon sans disconnect propre)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [roomId, room] of boardRooms) {
    if ((room.lastActivity || 0) < cutoff && room.participants.size === 0) {
      boardRooms.delete(roomId);
    }
  }
}, 30 * 60 * 1000);

// ── Chaque client rejoint sa propre room ─────────────────────
io.on('connection', (socket) => {
  socket.join(socket.userId);
  socketBoardRooms.set(socket.id, new Set());

  // ── Board: prof initialise la room ──────────────────────────
  socket.on('board_init', ({roomId, userName}) => {
    if (!roomId) return;
    if (!boardRooms.has(roomId)) {
      boardRooms.set(roomId, {
        ops: [], snapshot: null,
        editors: new Set([socket.userId]),
        ownerId: socket.userId,
        participants: new Map([[socket.userId, userName || '?']])
      });
    }
    socket.join('board_' + roomId);
    const sRooms = socketBoardRooms.get(socket.id);
    if (sRooms) sRooms.add(roomId);
  });

  // ── Board: élève ou retardataire rejoint ─────────────────────
  socket.on('board_join', ({roomId, userName}) => {
    if (!roomId) return;
    socket.join('board_' + roomId);
    const sRooms = socketBoardRooms.get(socket.id);
    if (sRooms) sRooms.add(roomId);
    const room = boardRooms.get(roomId);
    if (!room) return;
    room.participants.set(socket.userId, userName || '?');
    // Demander un snapshot frais au propriétaire plutôt qu'envoyer le snapshot stocké
    const ownerSocketId = [...(io.sockets.sockets.values() || [])].find(s => s.userId === room.ownerId)?.id;
    if (ownerSocketId) {
      // Le propriétaire est connecté — lui demander un snapshot ciblé
      io.to(ownerSocketId).emit('board_sync_request', {
        roomId, targetSocketId: socket.id,
        ops: room.ops,
        editors: [...room.editors],
        participants: [...room.participants.entries()].map(([id, name]) => ({id, name}))
      });
    } else {
      // Propriétaire déconnecté — envoyer ce qu'on a (ops + snapshot stocké)
      socket.emit('board_sync', {
        snapshot: room.snapshot,
        ops: room.ops,
        editors: [...room.editors],
        participants: [...room.participants.entries()].map(([id, name]) => ({id, name}))
      });
    }
    // Prévenir les autres
    socket.to('board_' + roomId).emit('board_participant_joined', {
      userId: socket.userId, userName: userName || '?'
    });
  });

  // ── Board: début de trait (temps réel) ───────────────────────
  socket.on('board_stroke_start', ({roomId, tool, color, size}) => {
    const room = boardRooms.get(roomId);
    if (!room || !room.editors.has(socket.userId)) return;
    socket.to('board_' + roomId).emit('board_stroke_start', {
      userId: socket.userId, tool, color, size
    });
  });

  // ── Board: point en cours (temps réel, ~50ms) ─────────────────
  socket.on('board_pt', ({roomId, pt}) => {
    const room = boardRooms.get(roomId);
    if (!room || !room.editors.has(socket.userId)) return;
    socket.to('board_' + roomId).emit('board_pt', {userId: socket.userId, pt});
  });

  // ── Board: fin de trait ───────────────────────────────────────
  socket.on('board_stroke_end', ({roomId}) => {
    const room = boardRooms.get(roomId);
    if (!room || !room.editors.has(socket.userId)) return;
    socket.to('board_' + roomId).emit('board_stroke_end', {userId: socket.userId});
  });

  // ── Board: op committé (forme, texte, gomme complète) ────────
  socket.on('board_op', ({roomId, op}) => {
    const room = boardRooms.get(roomId);
    if (!room || !room.editors.has(socket.userId)) return;
    op.userId = socket.userId;
    room.ops.push(op);
    room.lastActivity = Date.now();
    socket.to('board_' + roomId).emit('board_op', op);
  });

  // ── Board: snapshot canvas (stockage serveur) ────────────────
  socket.on('board_snapshot', ({roomId, snapshot}) => {
    const room = boardRooms.get(roomId);
    if (!room || !room.editors.has(socket.userId)) return;
    room.snapshot = snapshot;
    room.ops = []; // snapshot remplace le log d'ops
  });

  // ── Board: snapshot ciblé vers un retardataire précis ────────
  socket.on('board_snapshot_for', ({roomId, targetSocketId, snapshot}) => {
    const room = boardRooms.get(roomId);
    if (!room || room.ownerId !== socket.userId) return;
    room.snapshot = snapshot; // mettre à jour le snapshot stocké aussi
    room.ops = [];
    io.to(targetSocketId).emit('board_sync', {
      snapshot,
      ops: [],
      editors: [...room.editors],
      participants: [...room.participants.entries()].map(([id, name]) => ({id, name}))
    });
  });

  // ── Board: accorder le droit de dessiner ─────────────────────
  socket.on('board_grant', ({roomId, userId}) => {
    const room = boardRooms.get(roomId);
    if (!room || room.ownerId !== socket.userId) return;
    room.editors.add(userId);
    io.to('board_' + roomId).emit('board_perm', {userId, canEdit: true});
  });

  // ── Board: révoquer le droit de dessiner ─────────────────────
  socket.on('board_revoke', ({roomId, userId}) => {
    const room = boardRooms.get(roomId);
    if (!room || room.ownerId !== socket.userId) return;
    room.editors.delete(userId);
    io.to('board_' + roomId).emit('board_perm', {userId, canEdit: false});
  });

  // ── Board: quitter ───────────────────────────────────────────
  socket.on('board_leave', ({roomId}) => {
    socket.leave('board_' + roomId);
    const room = boardRooms.get(roomId);
    if (!room) return;
    room.participants.delete(socket.userId);
    room.editors.delete(socket.userId);
    socket.to('board_' + roomId).emit('board_participant_left', {userId: socket.userId});
    if (room.ownerId === socket.userId) boardRooms.delete(roomId);
    const sRooms = socketBoardRooms.get(socket.id);
    if (sRooms) sRooms.delete(roomId);
  });

  // ── Nettoyage sur déconnexion ─────────────────────────────────
  socket.on('disconnect', () => {
    const sRooms = socketBoardRooms.get(socket.id);
    if (sRooms) {
      for (const roomId of sRooms) {
        const room = boardRooms.get(roomId);
        if (!room) continue;
        room.participants.delete(socket.userId);
        room.editors.delete(socket.userId);
        socket.to('board_' + roomId).emit('board_participant_left', {userId: socket.userId});
        // Supprimer la room si le propriétaire part
        if (room.ownerId === socket.userId) boardRooms.delete(roomId);
      }
      socketBoardRooms.delete(socket.id);
    }
  });
});
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Compression gzip — réduit la taille des réponses de 70%
app.use(compression());

// ── Headers de sécurité HTTP ──────────────────────────────────
app.use(function(req, res, next) {
  // Empêche le clickjacking (l'app ne peut pas être chargée dans un iframe)
  res.setHeader('X-Frame-Options', 'DENY');
  // Désactive la détection automatique de type MIME (évite les attaques MIME sniffing)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Active la protection XSS du navigateur (legacy, mais utile sur anciens navigateurs)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Force HTTPS pendant 1 an (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Masque la technologie utilisée
  res.removeHeader('X-Powered-By');
  // Contrôle les infos envoyées dans le header Referer
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Désactive les fonctionnalités sensibles du navigateur non utilisées par l'app
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Content Security Policy — liste blanche des ressources autorisées
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Scripts : app locale + Sentry + Stripe
    "script-src 'self' 'unsafe-inline' https://browser.sentry-cdn.com https://js.stripe.com",
    // Styles : app locale + inline (requis par Stripe Elements)
    "style-src 'self' 'unsafe-inline'",
    // Images : app locale + data URIs (avatars) + Supabase storage (photos profils)
    "img-src 'self' data: blob: https://*.supabase.co",
    // Connexions réseau autorisées
    "connect-src 'self' https://devoted-achievement-production-fdfa.up.railway.app wss://devoted-achievement-production-fdfa.up.railway.app https://*.supabase.co https://o4511145728737280.ingest.de.sentry.io",
    // Frames : Stripe uniquement (pour le formulaire de paiement)
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    // Fonts : app locale
    "font-src 'self' data:",
    // Workers : Sentry utilise un worker
    "worker-src blob:"
  ].join('; '));
  next();
});

app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origin (mobile natif Capacitor, Postman en dev)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origine non autorisée'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));
app.use(express.json({limit: '10mb', verify: (req, res, buf) => { if (req.path === '/stripe/webhook') req.rawBody = buf; }}));
app.use(express.urlencoded({limit: '10mb', extended: true}));

// Rate limiting simple — max 100 requêtes par minute par IP
const rateLimitMap = new Map();
// Nettoyage toutes les 10 min — supprime les entrées > 1h
setInterval(function() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  rateLimitMap.forEach(function(data, ip) { if (data.start < cutoff) rateLimitMap.delete(ip); });
}, 10 * 60 * 1000);
app.use(function(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 100;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }
  
  const data = rateLimitMap.get(ip);
  if (now - data.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }
  
  if (data.count >= maxRequests) {
    // Alerte Discord si l'IP dépasse 3x la limite (attaque probable)
    if (data.count === maxRequests * 3 && !data.alerted) {
      data.alerted = true;
      const ua = (req.headers?.['user-agent'] || '').slice(0, 120);
      discordAlert(
        `⚡ **Abus de rate limit détecté**\n` +
        `> **IP :** \`${ip}\`\n` +
        `> **Requêtes :** ${data.count} en 1 min (limite : ${maxRequests})\n` +
        `> **Route :** ${req.method} ${req.path}\n` +
        `> **User-Agent :** ${ua || '?'}`
      );
    }
    return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });
  }
  
  data.count++;
  next();
});

// ── Alertes Discord ───────────────────────────────────────────
async function discordAlert(message, webhook) {
  const url = webhook || process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch(e) {}
}

async function discordStripeAlert(message) {
  await discordAlert(message, process.env.DISCORD_WEBHOOK_STRIPE || process.env.DISCORD_WEBHOOK_URL);
}

// ── Log de sécurité structuré ─────────────────────────────────
function _secLog(event, req, extra = {}) {
  const ip = req?.ip || req?.connection?.remoteAddress || '?';
  const ua = (req?.headers?.['user-agent'] || '').slice(0, 150);
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, event, ip, ua, ...extra }));
}

// Compteur de tentatives échouées par IP (fenêtre 5 min)
const failedLoginMap = new Map();
setInterval(function() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  failedLoginMap.forEach(function(data, ip) { if (data.firstFail < cutoff) failedLoginMap.delete(ip); });
}, 5 * 60 * 1000);

function recordFailedLogin(ip, email, req) {
  const now = Date.now();
  const cutoff = now - 5 * 60 * 1000;
  if (!failedLoginMap.has(ip) || failedLoginMap.get(ip).firstFail < cutoff) {
    failedLoginMap.set(ip, { count: 1, firstFail: now, alerted: false });
  } else {
    const d = failedLoginMap.get(ip);
    d.count++;
    // Alerte à partir de 5 échecs en 5 min, une seule fois par fenêtre
    if (d.count >= 5 && !d.alerted) {
      d.alerted = true;
      const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      const ua = (req?.headers?.['user-agent'] || '').slice(0, 120);
      discordAlert(
        `🚨 **Tentatives de connexion suspectes**\n` +
        `> **IP :** \`${ip}\`\n` +
        `> **Dernier email :** \`${email}\`\n` +
        `> **Tentatives :** ${d.count} échecs en moins de 5 min\n` +
        `> **User-Agent :** ${ua || '?'}\n` +
        `> **Heure :** ${time}`
      );
    }
  }
}

// ── Mutex par cours — sérialise les réservations simultanées ─────
// Évite la race condition entre check places_max et INSERT
const _coursLocks = new Map();
async function withCoursLock(cours_id, fn) {
  while (_coursLocks.has(cours_id)) { await _coursLocks.get(cours_id); }
  let resolve;
  _coursLocks.set(cours_id, new Promise(r => { resolve = r; }));
  try { return await fn(); }
  finally { _coursLocks.delete(cours_id); resolve(); }
}

// ── Verrous temporaires de places (10 min) ────────────────────
// clé : `${cours_id}:${user_id}` → { payment_intent_id, expiresAt }
const placeLocks = new Map();
const LOCK_TTL = 5 * 60 * 1000; // 5 minutes

setInterval(function() {
  const now = Date.now();
  placeLocks.forEach(function(lock, key) { if (lock.expiresAt < now) placeLocks.delete(key); });
}, 60 * 1000);

function lockPlace(cours_id, user_id, payment_intent_id) {
  placeLocks.set(`${cours_id}:${user_id}`, { payment_intent_id, expiresAt: Date.now() + LOCK_TTL });
}

function unlockPlace(cours_id, user_id) {
  placeLocks.delete(`${cours_id}:${user_id}`);
}

// Nombre de places verrouillées pour un cours (hors l'utilisateur lui-même)
function lockedPlacesCount(cours_id, exclude_user_id) {
  let count = 0;
  const now = Date.now();
  placeLocks.forEach(function(lock, key) {
    if (key.startsWith(cours_id + ':') && lock.expiresAt > now) {
      const uid = key.slice(cours_id.length + 1);
      if (uid !== exclude_user_id) count++;
    }
  });
  return count;
}

// Rate limiting strict pour les routes auth — 5 req/min par IP
const authRateLimitMap = new Map();
// Rate limiting par email — 8 tentatives / 15 min (contre brute-force par rotation d'IP)
const authEmailLimitMap = new Map();
setInterval(function() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  authRateLimitMap.forEach(function(data, ip) { if (data.start < cutoff) authRateLimitMap.delete(ip); });
  authEmailLimitMap.forEach(function(data, email) { if (data.start < cutoff) authEmailLimitMap.delete(email); });
}, 10 * 60 * 1000);
function authRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 5;
  if (!authRateLimitMap.has(ip)) { authRateLimitMap.set(ip, { count: 1, start: now }); return next(); }
  const data = authRateLimitMap.get(ip);
  if (now - data.start > windowMs) { authRateLimitMap.set(ip, { count: 1, start: now }); return next(); }
  if (data.count >= maxRequests) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
  data.count++;
  next();
}
// Middleware spécifique login — ajoute limite par email (résiste aux proxies/VPN)
function loginRateLimit(req, res, next) {
  const email = (req.body && req.body.email) ? req.body.email.toLowerCase().trim() : null;
  if (email) {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 min
    const maxAttempts = 8;
    const entry = authEmailLimitMap.get(email);
    if (!entry || now - entry.start > windowMs) {
      authEmailLimitMap.set(email, { count: 1, start: now });
    } else {
      if (entry.count >= maxAttempts) {
        return res.status(429).json({ error: 'Trop de tentatives pour cet email. Réessayez dans 15 minutes.' });
      }
      entry.count++;
    }
  }
  authRateLimit(req, res, next);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── DAILY.CO HELPER ──────────────────────────────────────────
async function createDailyRoom() {
  const key = process.env.DAILY_API_KEY;
  if (!key) return null;
  const name = 'courspool-' + Math.random().toString(36).slice(2, 10);
  try {
    const resp = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        privacy: 'public',
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          max_participants: 20,
          start_video_off: false,
          start_audio_off: false
        }
      })
    });
    if (!resp.ok) { console.error('[Daily] room creation failed', await resp.text()); return null; }
    const data = await resp.json();
    return data.url || null;
  } catch (e) { console.error('[Daily] fetch error', e); return null; }
}

// ── MIDDLEWARES AUTH ──────────────────────────────────────────
// Cache "bloqué" en mémoire — évite 1 requête Supabase par appel authentifié
const _blockedCache = new Map(); // uid → { blocked: bool, ts: number }
const BLOCKED_CACHE_TTL = 60000; // 1 minute

// Blacklist de sessions révoquées — clé: "${sub}:${iat}", valeur: timestamp d'expiration
const _revokedSessions = new Map();
// Nettoyage automatique toutes les 15 min — supprime les entrées expirées
setInterval(() => {
  const now = Date.now();
  for (const [key, exp] of _revokedSessions) {
    if (now > exp) _revokedSessions.delete(key);
  }
}, 15 * 60 * 1000);
// Nettoyage du cache "bloqué" toutes les 5 min — évite la croissance infinie
setInterval(() => {
  const cutoff = Date.now() - BLOCKED_CACHE_TTL;
  for (const [uid, entry] of _blockedCache) {
    if (entry.ts < cutoff) _blockedCache.delete(uid);
  }
}, 5 * 60 * 1000);

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  const token = auth.slice(7);
  try {
    // Vérification JWT locale — pas d'aller-retour réseau
    const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
    let payload;
    if (SUPABASE_JWT_SECRET) {
      try {
        payload = jwt.verify(token, SUPABASE_JWT_SECRET.trim());
      } catch(jwtErr) {
        console.error('[Auth] jwt.verify failed:', jwtErr.name, jwtErr.message);
        return res.status(401).json({ error: 'Token invalide' });
      }
    } else {
      // Fallback si secret absent : vérification via API Supabase
      const { data: { user: u }, error } = await supabase.auth.getUser(token);
      if (error || !u) return res.status(401).json({ error: 'Token invalide' });
      payload = { sub: u.id, email: u.email };
    }
    if (!payload?.sub) return res.status(401).json({ error: 'Token invalide' });

    // Vérification blacklist session révoquée (logout explicite)
    const sessionKey = `${payload.sub}:${payload.iat}`;
    if (_revokedSessions.has(sessionKey)) return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });

    req.user = { id: payload.sub, email: payload.email };

    // Vérification "bloqué" avec cache 1 minute — on récupère aussi le role
    const cached = _blockedCache.get(payload.sub);
    if (cached && Date.now() - cached.ts < BLOCKED_CACHE_TTL) {
      if (cached.blocked) return res.status(403).json({ error: 'Compte bloqué' });
      req.user.role = cached.role;
      return next();
    }
    const { data: profile } = await supabase.from('profiles').select('statut_compte,role').eq('id', payload.sub).single();
    const blocked = profile?.statut_compte === 'bloqué';
    _blockedCache.set(payload.sub, { blocked, role: profile?.role, ts: Date.now() });
    if (blocked) return res.status(403).json({ error: 'Compte bloqué' });
    req.user.role = profile?.role;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Erreur d\'authentification' });
  }
}

function requireAdmin(req, res, next) {
  // Vérifier d'abord que l'utilisateur est authentifié
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'Non authentifié' });
  if (!isAdmin(req.user.id)) {
    const ip = req.ip || req.connection.remoteAddress;
    const ua = (req.headers?.['user-agent'] || '').slice(0, 120);
    _secLog('admin_unauthorized', req, { userId: req.user.id, route: `${req.method} ${req.path}` });
    discordAlert(`🚨 **Tentative d'accès admin non autorisé**\n> **User ID :** \`${req.user.id}\`\n> **IP :** \`${ip}\`\n> **Route :** ${req.method} ${req.path}\n> **User-Agent :** ${ua || '?'}`);
    return res.status(403).json({ error: 'Accès admin requis' });
  }
  next();
}

function isAdmin(userId) {
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminIds.length > 0 && adminIds.includes(userId);
}

// ── Audit log actions admin ───────────────────────────────────
async function logAdminAction(adminId, action, targetId, details = {}) {
  try {
    await supabase.from('admin_logs').insert({
      admin_id: adminId, action, target_id: targetId, details
    });
  } catch(e) { console.error('[AdminLog]', e.message); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Helpers de validation
function isValidUUID(id) { return UUID_RE.test(id); }
function requireUUID(param, res) {
  if (!isValidUUID(param)) { res.status(400).json({ error: 'ID invalide' }); return false; }
  return true;
}
function safePage(val, max = 100) { const n = parseInt(val) || 1; return Math.min(Math.max(n, 1), max); }
function safeLimit(val, max = 50) { const n = parseInt(val) || 20; return Math.min(Math.max(n, 1), max); }

// Validation automatique des params UUID via app.param()
// S'applique à toutes les routes qui utilisent ces noms de paramètres
['id', 'user_id', 'prof_id', 'cours_id', 'ann_id', 'cid', 'res_id', 'student_id'].forEach(function(param) {
  app.param(param, function(req, res, next, val) {
    if (!isValidUUID(val)) return res.status(400).json({ error: 'ID invalide' });
    next();
  });
});

// ============================================================
// EMAILS — domaine vérifié Resend
// ============================================================
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const FROM_EMAIL = 'CoursPool <hello@courspool.com>'; // ← ton domaine vérifié Resend

// Template de base partagé
function emailBase(headerBg, headerContent, bodyContent) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F4F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <!-- HEADER -->
  <tr><td style="background:${headerBg};padding:36px 32px;position:relative">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td>
        <div style="display:inline-block;background:rgba(255,255,255,.2);border-radius:10px;padding:8px 14px;margin-bottom:16px">
          <span style="color:#fff;font-weight:800;font-size:15px;letter-spacing:-.01em">CoursPool</span>
        </div>
        ${headerContent}
      </td>
    </tr></table>
  </td></tr>
  <!-- BODY -->
  <tr><td style="padding:32px 32px 24px">${bodyContent}</td></tr>
  <!-- FOOTER -->
  <tr><td style="padding:20px 32px;border-top:1px solid #F0EDE8;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
      CoursPool · Plateforme de cours partagés<br>
      <a href="https://courspool.vercel.app" style="color:#FF6B2B;text-decoration:none">courspool.vercel.app</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Email 1 : Bienvenue à l'inscription ──────────────────────
async function sendEmailWelcome(userEmail, userName, role) {
  const isProf = role === 'professeur';
  const header = `
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff;line-height:1.2">
      Bienvenue sur<br>CoursPool ! 👋
    </h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">
      ${isProf ? 'Votre compte professeur est créé' : 'Votre compte élève est prêt'}
    </p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${userName} !</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">
      ${isProf
        ? "Bienvenue dans la communauté CoursPool. Pour commencer à proposer des cours, vérifiez d'abord votre identité depuis l'application."
        : "Bienvenue sur CoursPool ! Explorez les cours disponibles près de chez vous et réservez votre première session."
      }
    </p>
    <div style="background:#FFF7F3;border-radius:14px;padding:20px;margin-bottom:24px">
      ${isProf ? `
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div style="width:28px;height:28px;background:#FF6B2B;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#fff;font-size:12px;font-weight:800">1</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Envoyer votre CNI ou passeport</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Vérification sous 5 min à 2 heures</p></div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div style="width:28px;height:28px;background:#E8E3DC;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#999;font-size:12px;font-weight:800">2</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Compte activé par email</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Vous recevrez un email de confirmation</p></div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="width:28px;height:28px;background:#E8E3DC;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#999;font-size:12px;font-weight:800">3</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Publiez votre premier cours</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Et accueillez vos premiers élèves !</p></div>
        </div>
      ` : `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111">Avec CoursPool vous pouvez :</p>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.8">
          🔍 Explorer des cours près de chez vous<br>
          📅 Réserver en quelques secondes<br>
          💬 Contacter les professeurs directement<br>
          ⭐ Laisser des avis après vos cours
        </p>
      `}
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      ${isProf ? "Ouvrir l'application →" : "Découvrir les cours →"}
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: `Bienvenue sur CoursPool, ${userName} ! 🎉`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email welcome error:', e.message); }
}

// ── Email 2 : Confirmation de réservation (élève) ────────────
async function sendEmailReservation(eleveEmail, eleveName, coursTitle, coursDate, coursLieu, montant) {
  const dateFormatted = coursDate ? new Date(coursDate).toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : coursDate;
  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">
      Réservation confirmée !
    </h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">
      Votre place est assurée 🎓
    </p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${eleveName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">Votre inscription est confirmée pour le cours suivant :</p>
    <div style="background:#FFF7F3;border:1px solid #FFD9C8;border-radius:16px;padding:22px;margin-bottom:24px">
      <p style="margin:0 0 14px;font-size:18px;font-weight:800;color:#111">${coursTitle}</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0">
          <span style="font-size:13px;color:#888;display:inline-block;width:20px">📅</span>
          <span style="font-size:13px;color:#555;font-weight:500">${dateFormatted}</span>
        </td></tr>
        <tr><td style="padding:6px 0">
          <span style="font-size:13px;color:#888;display:inline-block;width:20px">📍</span>
          <span style="font-size:13px;color:#555;font-weight:500">${coursLieu}</span>
        </td></tr>
        <tr><td style="padding:12px 0 0">
          <div style="display:inline-block;background:linear-gradient(135deg,#FF8C55,#E04E10);border-radius:10px;padding:8px 16px">
            <span style="font-size:20px;font-weight:800;color:#fff">${montant}€</span>
            <span style="font-size:12px;color:rgba(255,255,255,.8);margin-left:4px">payé</span>
          </div>
        </td></tr>
      </table>
    </div>
    <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.6">
      Retrouvez toutes vos réservations dans la section <strong>Mon profil</strong> de l'application.
    </p>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      Voir dans l'application →
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: eleveEmail,
      subject: `✅ Réservation confirmée — ${coursTitle}`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email reservation error:', e.message); }
}

// ── Email 3 : Nouvelle inscription (prof) ──────────────────
async function sendEmailProfNewEleve(profEmail, profName, eleveName, coursTitle, montant) {
  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">Nouvel élève inscrit !</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">Votre cours fait des heureux</p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      <strong>${eleveName}</strong> vient de réserver une place dans votre cours.
    </p>
    <div style="background:#FFF7F3;border:1px solid #FFD9C8;border-radius:16px;padding:22px;margin-bottom:24px">
      <p style="margin:0 0 10px;font-size:17px;font-weight:800;color:#111">${coursTitle}</p>
      <div style="display:inline-block;background:linear-gradient(135deg,#22C069,#16A34A);border-radius:10px;padding:8px 16px">
        <span style="font-size:18px;font-weight:800;color:#fff">+${montant}€</span>
        <span style="font-size:12px;color:rgba(255,255,255,.8);margin-left:4px">encaissé</span>
      </div>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      Voir mes élèves →
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: profEmail,
      subject: `Nouvelle inscription — ${coursTitle}`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email prof error:', e.message); }
}

// ── Email 4b : Vérification diplôme ─────────────────────────
// status: 'approved' | 'rejected'
async function sendEmailDiplomeVerification(profEmail, profName, status) {
  const isApproved = status === 'approved';
  const isRetry    = status === 'rejected_retry';
  const headerBg = isApproved ? 'linear-gradient(135deg,#22C069,#16A34A)' : 'linear-gradient(135deg,#EF4444,#DC2626)';
  const headerTitle = isApproved ? 'Diplôme vérifié !' : isRetry ? 'Document à renvoyer' : 'Vérification du diplôme refusée';
  const headerSub   = isApproved ? 'Badge "Diplôme vérifié" activé sur votre profil' : isRetry ? 'Le document reçu n\'est pas lisible ou incomplet' : 'Le document soumis n\'a pas pu être validé';
  const body = isApproved
    ? `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Votre diplôme a été vérifié avec succès. Le badge <strong>Diplôme vérifié</strong> est maintenant affiché sur votre profil et sur vos cours, renforçant la confiance des élèves et des parents.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#22C069,#16A34A);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Voir mon profil →</a>`
    : isRetry
    ? `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Le document que vous avez envoyé est illisible, flou ou incomplet. Merci de renvoyer un scan ou une photo nette de votre diplôme officiel depuis l'application.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer mon diplôme →</a>`
    : `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Nous n'avons pas pu vérifier le document soumis. Assurez-vous que le fichier est lisible et correspond bien à un diplôme officiel, puis renvoyez votre document depuis l'application.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer mon diplôme →</a>`;
  const subject = isApproved ? `Votre diplôme est vérifié, ${profName} !` : isRetry ? `Diplôme — nouveau document requis` : `Vérification du diplôme — Action requise`;
  const header = `<h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">${headerTitle}</h1><p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">${headerSub}</p>`;
  try {
    await resend.emails.send({ from: FROM_EMAIL, to: profEmail, subject, html: emailBase(headerBg, header, body) });
  } catch(e) { console.log('Email diplome verification error:', e.message); }
}

async function sendEmailCasierVerification(profEmail, profName, status) {
  const isApproved = status === 'approved';
  const isRetry    = status === 'rejected_retry';
  const headerBg = isApproved ? 'linear-gradient(135deg,#10B981,#065F46)' : 'linear-gradient(135deg,#EF4444,#DC2626)';
  const headerTitle = isApproved ? 'Profil de confiance activé !' : isRetry ? 'Document à renvoyer' : 'Document refusé';
  const headerSub   = isApproved ? 'Badge "Profil de confiance" visible sur votre profil' : isRetry ? 'Le document reçu n\'est pas lisible ou incomplet' : 'L\'attestation soumise n\'a pas pu être validée';
  const body = isApproved
    ? `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Votre attestation de moralité a été vérifiée. Le badge <strong>Profil de confiance</strong> est maintenant affiché sur votre profil, rassurant élèves et parents sur votre fiabilité.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#10B981,#065F46);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Voir mon profil →</a>`
    : isRetry
    ? `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Le document que vous avez envoyé est illisible, flou ou incomplet. Merci de renvoyer une photo nette de votre attestation de moralité depuis l'application.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer mon attestation →</a>`
    : `<p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Nous n'avons pas pu valider l'attestation soumise. Assurez-vous que le document est lisible et à jour, puis renvoyez-le depuis l'application.</p>
       <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer mon attestation →</a>`;
  const subject = isApproved ? `Votre profil de confiance est activé, ${profName} !` : isRetry ? `Attestation — nouveau document requis` : `Vérification — Action requise`;
  const header = `<h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">${headerTitle}</h1><p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">${headerSub}</p>`;
  try {
    await resend.emails.send({ from: FROM_EMAIL, to: profEmail, subject, html: emailBase(headerBg, header, body) });
  } catch(e) { console.log('Email casier verification error:', e.message); }
}

// ── Email 4 : Vérification compte prof ──────────────────────
// status: 'approved' | 'rejected_retry' | 'rejected_final'
async function sendEmailProfVerification(profEmail, profName, status, raison = '') {
  const isApproved = status === 'approved';
  const isRetry   = status === 'rejected_retry';
  const isFinal   = status === 'rejected_final';

  const headerBg = isApproved
    ? 'linear-gradient(135deg,#22C069,#16A34A)'
    : isFinal
      ? 'linear-gradient(135deg,#1F2937,#374151)'
      : 'linear-gradient(135deg,#EF4444,#DC2626)';

  const headerTitle = isApproved ? 'Compte activé !'
    : isFinal ? 'Compte non éligible'
    : 'Vérification refusée — Action requise';

  const headerSub = isApproved ? 'Vous êtes prêt à enseigner'
    : isFinal ? 'Votre demande a été définitivement refusée'
    : 'Vous pouvez renvoyer votre document';

  const raisonBlock = raison ? `
    <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:16px;margin-bottom:20px">
      <p style="margin:0;font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Message de l'équipe CoursPool</p>
      <p style="margin:0;font-size:14px;color:#78350F;line-height:1.6">${raison}</p>
    </div>` : '';

  let body;
  if (isApproved) {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">Votre identité a été vérifiée. Vous pouvez dès maintenant publier vos cours et accueillir vos premiers élèves.</p>
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#166534;line-height:1.8;font-weight:500">
        ✓ Votre profil est maintenant visible<br>✓ Vous pouvez créer et publier des cours<br>✓ Vous pouvez recevoir des paiements
      </p>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Proposer mon premier cours →</a>`;
  } else if (isRetry) {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.7">Votre demande de vérification n'a pas pu être acceptée en l'état.</p>
    ${raisonBlock}
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.8;font-weight:500">Ce qu'il faut vérifier :<br>· Photo nette, bien éclairée, sans reflet<br>· Document entier et non expiré<br>· Nom et prénom correspondant à votre profil</p>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer ma pièce d'identité →</a>`;
  } else {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.7">Après examen de votre dossier, nous ne sommes malheureusement pas en mesure de valider votre compte professeur sur CoursPool.</p>
    ${raisonBlock}
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.8">Si vous pensez qu'il s'agit d'une erreur, vous pouvez nous contacter à <a href="mailto:hello@courspool.com" style="color:#FF6B2B">hello@courspool.com</a></p>
    </div>`;
  }

  const subject = isApproved
    ? `Votre compte CoursPool est activé, ${profName} !`
    : isFinal
      ? `Votre compte CoursPool — Décision finale`
      : `Vérification d'identité — Action requise`;

  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">${headerTitle}</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">${headerSub}</p>`;

  try {
    await resend.emails.send({ from: FROM_EMAIL, to: profEmail, subject, html: emailBase(headerBg, header, body) });
  } catch(e) { console.log('Email verification error:', e.message); }
}


// ── ADMIN HTML — protégé par requireAdmin ───────────────────
// Bloquer accès direct à admin.html avant le middleware static
app.use((req, res, next) => {
  if (req.path === '/admin.html' || req.path === '/admin.html/') {
    return res.redirect(301, '/admin');
  }
  next();
});
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── CONTRÔLE D'ACCÈS GLOBAL ──────────────────────────────────
// Routes publiques — pas de token requis
app.use(function(req, res, next) {
  if (req.method === 'GET'  && req.path === '/') return next();
  if (req.method === 'GET'  && req.path === '/health') return next();
  if (req.method === 'POST' && req.path === '/auth/register') return next();
  if (req.method === 'POST' && req.path === '/auth/login') return next();
  if (req.method === 'POST' && req.path === '/auth/refresh') return next();
  if (req.method === 'GET'  && req.path === '/cours') return next();
  if (req.method === 'GET'  && req.path.startsWith('/cours/code/')) return next();
  if (req.method === 'GET'  && req.path.startsWith('/profiles/')) return next();
  if (req.method === 'GET'  && req.path.startsWith('/notations/')) return next();
  if (req.method === 'GET'  && req.path.startsWith('/follows/')) return next();
  if (req.method === 'GET'  && req.path.match(/^\/teacher\/[^/]+\/resources$/)) return next();
  if (req.method === 'GET'  && req.path === '/stripe/success') return next();
  if (req.method === 'POST' && req.path === '/stripe/webhook') return next();
  if (req.method === 'POST' && req.path === '/contact') return next();
  if (req.method === 'GET'  && req.path === '/auth/config') return next();
  return requireAuth(req, res, next);
});

// TEST
app.get('/', (req, res) => {
  res.json({ message: 'CoursPool API fonctionne !' });
});

// HEALTH CHECK — monitoring Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// AUTH — config publique (URL + clé anon pour le client Supabase)
app.get('/auth/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// AUTH — créer/compléter profil OAuth (token Supabase OAuth requis)
app.post('/auth/oauth-profile', requireAuth, async (req, res) => {
  const { role, prenom, nom } = req.body;
  if (!role || !['eleve', 'professeur'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (prenom && prenom.length > 50) return res.status(400).json({ error: 'Prénom trop long' });
  if (nom && nom.length > 50) return res.status(400).json({ error: 'Nom trop long' });
  try {
    const userId = req.user.id;
    const email = req.user.email || '';
    const meta = req.user.user_metadata || {};
    const finalPrenom = prenom || meta.given_name || meta.full_name || email.split('@')[0];
    const finalNom = nom || meta.family_name || '';
    // Upsert du profil (crée si n'existe pas, ignore les champs déjà définis)
    const { data: existing } = await supabase.from('profiles').select('id,role').eq('id', userId).single();
    let profile;
    if (!existing) {
      const { data, error } = await supabase.from('profiles')
        .insert({ id: userId, email, prenom: finalPrenom, nom: finalNom, role })
        .select().single();
      if (error) return res.status(500).json({ error: error.message });
      profile = data;
    } else if (!existing.role) {
      const { data, error } = await supabase.from('profiles')
        .update({ role, prenom: finalPrenom, nom: finalNom })
        .eq('id', userId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      profile = data;
    } else {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      profile = data || existing;
    }
    res.json({ success: true, profile });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// AUTH — inscription
app.post('/auth/register', authRateLimit, async (req, res) => {
  const { email, password, prenom, nom, role } = req.body;
  if (!email || !password || !prenom || !role) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  // Whitelist des rôles autorisés — empêche role:'admin' ou valeur arbitraire
  if (!['eleve', 'professeur'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  // Validation format email basique
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });
  if (prenom.length > 50) return res.status(400).json({ error: 'Prénom trop long (50 max)' });
  if (nom && nom.length > 50) return res.status(400).json({ error: 'Nom trop long (50 max)' });
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { prenom, nom, role }
    });
    if (error) return res.status(400).json({ error: error.message });
    await supabase.from('profiles').insert([{
      id: data.user.id, prenom, nom, email, role,
      // statut et verified fixés côté serveur — jamais depuis le body client
      statut: null,
      niveau: req.body.niveau || null,
      matieres: req.body.matieres || null,
      verified: role === 'eleve' ? true : false
    }]);
    _secLog('register', req, { email, role, userId: data.user.id });
    // Email de bienvenue
    const userName = (prenom + ' ' + (nom||'')).trim();
    sendEmailWelcome(email, prenom || userName, role).catch(() => {});
    res.json({ user: data.user });
  } catch (e) {
    console.error('[register] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// AUTH — refresh token
app.post('/auth/refresh', authRateLimit, async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token manquant' });
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error || !data.session) return res.status(401).json({ error: 'Token invalide ou expiré' });
  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at
  });
});

// AUTH — connexion
app.post('/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const ip = req.ip || req.connection.remoteAddress;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      _secLog('login_fail', req, { email, reason: error.message });
      recordFailedLogin(ip, email, req);
      return res.status(400).json({ error: error.message });
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (profile?.statut_compte === 'bloqué') {
      _secLog('login_blocked', req, { email, userId: data.user.id });
      return res.status(403).json({ error: 'Compte bloqué' });
    }
    _secLog('login_ok', req, { email, userId: data.user.id });
    res.json({ user: data.user, session: data.session, profile });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// AUTH — déconnexion (révocation de la session courante)
app.post('/auth/logout', requireAuth, (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.slice(7);
  if (token) {
    try {
      const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
      if (SUPABASE_JWT_SECRET) {
        const payload = jwt.decode(token); // déjà vérifié par requireAuth, decode suffit
        if (payload?.sub && payload?.iat) {
          const sessionKey = `${payload.sub}:${payload.iat}`;
          // Blacklister jusqu'à l'expiration naturelle du token (+ 60s de marge)
          const expMs = payload.exp ? payload.exp * 1000 : Date.now() + 3600000;
          _revokedSessions.set(sessionKey, expMs + 60000);
        }
      }
    } catch(e) { /* ignore — le token est déjà invalide */ }
  }
  // Invalider aussi le cache "bloqué" pour forcer une re-vérification si reconnexion
  _blockedCache.delete(req.user.id);
  res.json({ ok: true });
});

// COURS — récupérer tous
app.get('/cours', async (req, res) => {
  const page = safePage(req.query.page);
  const limit = safeLimit(req.query.limit);
  const offset = (page - 1) * limit;
  const sujet = req.query.sujet || null;
  const search = req.query.search || null;

  let query = supabase.from('cours').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const niveau_filter = req.query.niveau || null;
  if (sujet && sujet !== 'tous') {
    const safeSubjet = sujet.slice(0, 100).replace(/[%_\\]/g, c => '\\' + c);
    query = query.ilike('sujet', '%' + safeSubjet + '%');
  }
  if (search) {
    // Échappe les wildcards LIKE + retire les caractères spéciaux PostgREST (),(). pour éviter l'injection de filtre
    const s = search.slice(0, 100)
      .replace(/[%_\\]/g, c => '\\' + c)
      .replace(/[(),."']/g, '');
    if (s) query = query.or(`titre.ilike.%${s}%,sujet.ilike.%${s}%,lieu.ilike.%${s}%,prof_nom.ilike.%${s}%`);
  }
  if (niveau_filter) query = query.eq('niveau', niveau_filter);

  try {
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error });
    const cours = (data || []).map(function(c) { const r = Object.assign({}, c); delete r.code_acces; return r; });
    res.json({ cours, total: count, page, limit, pages: Math.ceil(count / limit) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// COURS — créer
app.post('/cours', requireAuth, async (req, res) => {
  if (req.user.role !== 'professeur') return res.status(403).json({ error: 'Seuls les professeurs peuvent créer des cours' });
  const professeur_id = req.user.id;
  const { titre, sujet, couleur_sujet, background, date_heure, date_iso, lieu, prix_total, places_max, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description, niveau, mode, prive, code_acces, visio_url } = req.body;
  if (!titre || !date_heure || !lieu || !prix_total) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (!places_max || parseInt(places_max) < 1 || parseInt(places_max) > 50) {
    return res.status(400).json({ error: 'places_max doit être entre 1 et 50' });
  }
  if (parseFloat(prix_total) < 1) {
    return res.status(400).json({ error: 'prix_total doit être >= 1' });
  }
  if (visio_url && !/^https?:\/\//i.test(visio_url)) {
    return res.status(400).json({ error: 'visio_url doit commencer par http:// ou https://' });
  }
  const safeMode = (mode === 'visio' || mode === 'presentiel') ? mode : 'presentiel';
  try {
    // Lire nom/photo depuis la DB — ne pas faire confiance au body (anti-spoofing)
    const { data: profData } = await supabase.from('profiles').select('prenom,nom,photo_url').eq('id', professeur_id).single();
    const safeProfNom = profData ? ((profData.prenom||'') + ' ' + (profData.nom||'')).trim() : (prof_nom || '');
    const safeProfPhoto = profData?.photo_url || prof_photo || null;
    // Créer une room Daily.co si mode visio (ignore le visio_url du client)
    const safeVisioUrl = safeMode === 'visio' ? (await createDailyRoom() || visio_url || null) : null;
    const { data, error } = await supabase.from('cours')
      .insert([{ titre, sujet, couleur_sujet, background, date_heure, date_iso: date_iso || null, lieu, prix_total, places_max, places_prises: 0, professeur_id, emoji, prof_nom: safeProfNom, prof_photo: safeProfPhoto, prof_initiales, prof_couleur, description, niveau: niveau || null, mode: safeMode, prive: !!prive, code_acces: prive ? (code_acces || null) : null, visio_url: safeVisioUrl }])
      .select();
    if (error) {
      console.error('[POST /cours] Supabase error:', JSON.stringify(error));
      return res.status(500).json({ error: error.message || error.details || 'Erreur base de données' });
    }
    // Push aux élèves qui suivent ce prof
    if (data && data[0]) {
      const titreNotif = data[0].titre || titre;
      (async () => {
        try {
          const { data: follows } = await supabase.from('follows').select('user_id').eq('professeur_id', professeur_id);
          if (!follows || !follows.length) return;
          const { data: profP } = await supabase.from('profiles').select('prenom,nom').eq('id', professeur_id).single();
          const profNom = profP ? (profP.prenom + ' ' + (profP.nom||'')).trim() : 'Un professeur';
          await pushToUsers(follows.map(f => f.user_id), {
            title: `📚 Nouveau cours de ${profNom}`,
            body: `"${titreNotif}" est disponible — réservez avant que les places partent !`,
            tag: 'new-cours', icon: '/icon-192.png',
            data: { url: 'https://courspool.vercel.app' }
          });
        } catch(e) {}
      })();
    }
    io.emit('cours_update', { action: 'create', cours: data[0] }); // broadcast public
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// COURS — accès par code privé
app.get('/cours/code/:code', async (req, res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: 'Code manquant' });
  try {
    const { data, error } = await supabase
      .from('cours')
      .select('*')
      .eq('code_acces', code.toUpperCase())
      .eq('prive', true)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Cours introuvable' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// COURS — export calendrier .ics
app.get('/cours/:id/ics', requireAuth, async (req, res) => {
  if (!requireUUID(req.params.id, res)) return;
  try {
    const { data: cours, error } = await supabase.from('cours')
      .select('id,titre,sujet,date_heure,lieu,description,professeur_id,prof_nom')
      .eq('id', req.params.id).single();
    if (error || !cours) return res.status(404).json({ error: 'Cours introuvable' });
    // Vérifier accès : professeur du cours OU a une réservation
    const isProf = cours.professeur_id === req.user.id;
    if (!isProf) {
      const { data: resa } = await supabase.from('reservations')
        .select('id').eq('cours_id', req.params.id).eq('user_id', req.user.id).maybeSingle();
      if (!resa) return res.status(403).json({ error: 'Accès refusé' });
    }
    // Générer le .ics (RFC 5545)
    const dtStart = new Date(cours.date_heure);
    const dtEnd = new Date(dtStart.getTime() + 60 * 60 * 1000); // +1h
    function toIcsDate(d) {
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const uid = 'cours-' + cours.id + '@courspool.app';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CoursPool//CoursPool//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTART:' + toIcsDate(dtStart),
      'DTEND:' + toIcsDate(dtEnd),
      'SUMMARY:' + esc(cours.titre || cours.sujet),
      'LOCATION:' + esc(cours.lieu),
      'DESCRIPTION:' + esc(cours.description || ('Cours avec ' + (cours.prof_nom || ''))),
      'ORGANIZER;CN=' + esc(cours.prof_nom || 'Professeur') + ':mailto:noreply@courspool.app',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const filename = encodeURIComponent((cours.titre || 'cours').replace(/[^a-zA-Z0-9\-_]/g, '_')) + '.ics';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(ics);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// COURS — supprimer
app.delete('/cours/:id', requireAuth, async (req, res) => {
  try {
    const { data: cours } = await supabase.from('cours').select('professeur_id').eq('id', req.params.id).single();
    if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
    if (cours.professeur_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    const { error } = await supabase.from('cours').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error });
    io.emit('cours_update', { action: 'delete', cours_id: req.params.id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// COURS — modifier (champs autorisés uniquement)
app.patch('/cours/:id', requireAuth, async (req, res) => {
  try {
    const { data: cours } = await supabase.from('cours').select('professeur_id').eq('id', req.params.id).single();
    if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
    if (cours.professeur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    const allowed = ['visio_url', 'titre', 'description', 'lieu', 'date_heure', 'places_max', 'prix_total', 'niveau', 'mode', 'prive'];
    const updates = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }
    if ('visio_url' in updates) {
      const u = updates.visio_url;
      if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'visio_url doit commencer par http:// ou https://' });
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ valide' });
    const { data, error } = await supabase.from('cours').update(updates).eq('id', req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0] || {});
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// RESERVATIONS — créer
app.post('/reservations', requireAuth, async (req, res) => {
  const user_id = req.user.id;
  const { cours_id, montant_paye, type_paiement } = req.body;
  if (!cours_id) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const result = await withCoursLock(cours_id, async () => {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).maybeSingle();
      if (existing) return { status: 400, body: { error: 'Vous avez déjà réservé ce cours' } };
      // Vérifier les places disponibles (inclut les verrous Stripe en cours)
      const { data: coursInfo } = await supabase.from('cours').select('places_max,places_prises').eq('id', cours_id).single();
      if (coursInfo) {
        const lockedCount = lockedPlacesCount(cours_id, user_id);
        if (coursInfo.places_prises + lockedCount >= coursInfo.places_max) {
          return { status: 409, body: { error: 'Ce cours est complet' } };
        }
      }
      const { data, error } = await supabase.from('reservations')
        .insert([{ cours_id, user_id, montant_paye: montant_paye||0, type_paiement: type_paiement||'total' }])
        .select();
      if (error) {
        if (error.code === '23505') return { status: 400, body: { error: 'Vous avez déjà réservé ce cours' } };
        return { status: 500, body: { error: error.message } };
      }
      const { count: resCount } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
      await supabase.from('cours').update({ places_prises: resCount || 0 }).eq('id', cours_id);
      io.emit('reservation_update', { cours_id, places_prises: resCount || 0 });
      return { status: 200, body: data[0] };
    });
    return res.status(result.status).json(result.body);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// RESERVATIONS — réserver pour un ami
app.post('/reservations/ami', requireAuth, async (req, res) => {
  const { cours_id } = req.body;
  if (!cours_id) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const { count: resCountAmi } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
    await supabase.from('cours').update({ places_prises: resCountAmi || 0 }).eq('id', cours_id);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// RESERVATIONS — récupérer par user
app.get('/reservations/:user_id', requireAuth, async (req, res) => {
  if (req.user.id !== req.params.user_id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const { data, error } = await supabase.from('reservations').select('*, cours(*)').eq('user_id', req.params.user_id);
    if (error) return res.status(500).json({ error });
    res.json(data);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// VISIO — créer ou récupérer une room Daily.co + retourner le token en une seule requête
// - cours_id fourni : room cours-{id}, vérifie que l'user est inscrit ou prof
// - cours_id absent  : quick room cp-{random}, pas de restriction
app.post('/visio/room', requireAuth, async (req, res) => {
  const key = process.env.DAILY_API_KEY;
  if (!key) return res.status(503).json({ error: 'Visio non configurée' });
  const { cours_id } = req.body;
  const userId = req.user.id;
  const isProf = req.user.role === 'professeur';
  try {
    let roomName, roomUrl;
    if (cours_id) {
      // Vérifier accès : prof du cours ou élève inscrit
      const { data: cours } = await supabase.from('cours').select('id,professeur_id,titre').eq('id', cours_id).single();
      if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
      const isProfOfCours = cours.professeur_id === userId;
      if (!isProfOfCours) {
        const { data: resa } = await supabase.from('reservations').select('id').eq('cours_id', cours_id).eq('user_id', userId).maybeSingle();
        if (!resa) return res.status(403).json({ error: 'Non inscrit à ce cours' });
      }
      roomName = 'cours-' + cours_id;
      // Get or create — gère la race condition si deux personnes cliquent en même temps
      const getResp = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (getResp.ok) {
        roomUrl = (await getResp.json()).url;
      } else {
        const createResp = await fetch('https://api.daily.co/v1/rooms', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName, properties: { idle_timeout: 1800, enable_chat: true, enable_screenshare: true, max_participants: 20 } })
        });
        const created = await createResp.json();
        // Race condition : si quelqu'un d'autre a créé entre le GET et le POST
        if (!createResp.ok && created.error === 'room already exists') {
          const retry = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, { headers: { 'Authorization': `Bearer ${key}` } });
          roomUrl = (await retry.json()).url;
        } else if (!createResp.ok) {
          console.error('[Daily] create room failed', created);
          return res.status(500).json({ error: 'Erreur création room' });
        } else {
          roomUrl = created.url;
        }
      }
    } else {
      // Quick room : pas de restriction, nom aléatoire
      roomName = 'cp-' + Math.random().toString(36).slice(2, 9);
      const createResp = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName, properties: { exp: Math.floor(Date.now()/1000) + 7200, idle_timeout: 300, enable_chat: true, enable_screenshare: true, max_participants: 20 } })
      });
      const created = await createResp.json();
      if (!createResp.ok) { console.error('[Daily] quick room failed', created); return res.status(500).json({ error: 'Erreur création room' }); }
      roomUrl = created.url;
    }
    // Générer le token meeting
    const { data: prof } = await supabase.from('profiles').select('prenom,nom').eq('id', userId).single();
    const userName = prof ? ((prof.prenom||'') + ' ' + (prof.nom||'')).trim() : (req.user.email || 'Participant');
    const isProfOfRoom = isProf;
    const tokenResp = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { room_name: roomName, user_name: userName, is_owner: isProfOfRoom, start_audio_off: !isProfOfRoom, start_video_off: false } })
    });
    if (!tokenResp.ok) { console.error('[Daily token]', await tokenResp.text()); return res.status(500).json({ error: 'Erreur token' }); }
    const tokenData = await tokenResp.json();
    res.json({ url: roomUrl, room_name: roomName, token: tokenData.token, user_name: userName, is_owner: isProfOfRoom });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// VISIO — générer un meeting token Daily.co
app.post('/visio/token', requireAuth, async (req, res) => {
  const key = process.env.DAILY_API_KEY;
  if (!key) return res.status(503).json({ error: 'Visio non configurée' });
  const { room_name } = req.body;
  if (!room_name || !/^[a-z0-9\-]+$/.test(room_name)) {
    return res.status(400).json({ error: 'room_name invalide' });
  }
  try {
    const { data: prof } = await supabase.from('profiles').select('prenom,nom').eq('id', req.user.id).single();
    const userName = prof ? ((prof.prenom||'') + ' ' + (prof.nom||'')).trim() : (req.user.email || 'Participant');
    const isOwner = req.user.role === 'professeur';
    const resp = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: {
        room_name,
        user_name: userName,
        is_owner: isOwner,
        start_audio_off: !isOwner,
        start_video_off: false
      }})
    });
    if (!resp.ok) { console.error('[Daily token]', await resp.text()); return res.status(500).json({ error: 'Erreur Daily' }); }
    const data = await resp.json();
    res.json({ token: data.token, user_name: userName, is_owner: isOwner });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// STRIPE — créer une session de paiement
app.post('/stripe/checkout', requireAuth, async (req, res) => {
  const { cours_id, cours_titre, pour_ami } = req.body;
  const user_id = pour_ami ? req.body.user_id : req.user.id;
  if (!cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });

  try {
    // Prix depuis la BDD — ne jamais faire confiance au client
    const { data: cours } = await supabase.from('cours').select('prix_total,places_max,places_prises,titre,professeur_id').eq('id', cours_id).single();
    if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
    // Vérifier que le cours n'est pas complet
    if (!pour_ami && cours.places_prises >= cours.places_max) {
      return res.status(400).json({ error: 'Ce cours est complet' });
    }
    const montant = Math.round((cours.prix_total / (cours.places_max || 1)) * 100) / 100;

    const baseUrl = 'https://courspool.vercel.app';
    const successUrl = `https://devoted-achievement-production-fdfa.up.railway.app/stripe/success?session_id={CHECKOUT_SESSION_ID}&pour_ami=${pour_ami?'1':'0'}&redirect=${encodeURIComponent(baseUrl)}`;
    const cancelUrl = baseUrl + '?cancelled=1';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: cours.titre || cours_titre || 'Réservation CoursPool' },
          unit_amount: Math.round(montant * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { cours_id, user_id, montant: montant.toString(), pour_ami: pour_ami ? '1' : '0', prof_id: cours.professeur_id || '' },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.log('Stripe error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// STRIPE — PaymentIntent in-app (Stripe Elements)
app.post('/stripe/payment-intent', requireAuth, async (req, res) => {
  const { cours_id, cours_titre, pour_ami } = req.body;
  const user_id = pour_ami ? req.body.user_id : req.user.id;
  if (!cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });
  try {
    // Prix depuis la BDD — ne jamais faire confiance au client
    const { data: cours } = await supabase.from('cours').select('prix_total,places_max,places_prises,titre,professeur_id').eq('id', cours_id).single();
    if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
    // Vérifier que le cours n'est pas complet (places réelles + verrous temporaires)
    if (!pour_ami) {
      const locked = lockedPlacesCount(cours_id, user_id);
      if (cours.places_prises >= cours.places_max) {
        return res.status(400).json({ error: 'Ce cours est complet', full: true });
      }
      if (cours.places_prises + locked >= cours.places_max) {
        return res.status(400).json({ error: 'Une réservation est en cours, réessayez dans quelques minutes.', locking: true });
      }
    }
    const montant = Math.round((cours.prix_total / (cours.places_max || 1)) * 100) / 100;
    // Vérifier si déjà réservé
    if (!pour_ami) {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).maybeSingle();
      if (existing) return res.json({ already_reserved: true });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(montant * 100),
      currency: 'eur',
      description: cours.titre || cours_titre || 'Réservation CoursPool',
      metadata: { cours_id, user_id, montant: montant.toString(), pour_ami: pour_ami ? '1' : '0', prof_id: cours.professeur_id || '' },
      automatic_payment_methods: { enabled: true },
    });
    // Poser le verrou temporaire — cette place est réservée 10 min pour cet utilisateur
    if (!pour_ami) lockPlace(cours_id, user_id, paymentIntent.id);
    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id, montant });
  } catch (e) {
    console.log('PaymentIntent error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// STRIPE — libérer le verrou de place (utilisateur annule le paiement)
app.post('/stripe/cancel-lock', requireAuth, async (req, res) => {
  const { payment_intent_id } = req.body;
  if (!payment_intent_id) return res.status(400).json({ error: 'payment_intent_id manquant' });
  // Retrouver le verrou correspondant à ce PI et cet utilisateur
  const user_id = req.user.id;
  placeLocks.forEach(function(lock, key) {
    if (lock.payment_intent_id === payment_intent_id && key.endsWith(':' + user_id)) {
      placeLocks.delete(key);
    }
  });
  res.json({ success: true });
});

// STRIPE — confirmer paiement in-app et créer réservation
app.post('/stripe/confirm-payment', requireAuth, async (req, res) => {
  const { payment_intent_id } = req.body;
  if (!payment_intent_id) return res.status(400).json({ error: 'payment_intent_id manquant' });
  try {
    // Vérifier le statut côté Stripe
    const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (pi.status !== 'succeeded') return res.status(400).json({ error: 'Paiement non confirmé', status: pi.status });

    // IDs depuis les métadonnées Stripe — ne jamais faire confiance au body
    const cours_id = pi.metadata?.cours_id;
    const user_id = pi.metadata?.user_id;
    const montant = pi.metadata?.montant;
    const pour_ami = pi.metadata?.pour_ami === '1';
    if (!cours_id || !user_id) return res.status(400).json({ error: 'Métadonnées payment intent manquantes' });
    if (user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });

    // Vérification croisée du montant — ce que Stripe a encaissé doit correspondre aux métadonnées
    const expectedAmount = Math.round(parseFloat(montant) * 100);
    if (pi.amount !== expectedAmount) {
      console.error(`[STRIPE] Montant incohérent — pi.amount: ${pi.amount} | attendu: ${expectedAmount} | payment_intent: ${payment_intent_id}`);
      discordStripeAlert(`⚠️ **Montant Stripe incohérent**\n> **PI :** \`${payment_intent_id}\`\n> **Encaissé :** ${pi.amount/100}€ | **Attendu :** ${expectedAmount/100}€`);
      return res.status(400).json({ error: 'Montant incohérent' });
    }

    // Idempotence par stripe_payment_intent_id — check rapide hors mutex
    const { data: existingByPi } = await supabase.from('reservations')
      .select('id').eq('stripe_payment_intent_id', payment_intent_id).maybeSingle();
    if (existingByPi) return res.json({ success: true, already_existed: true });

    // Section critique sérialisée par cours — empêche le double-booking concurrent
    const lockResult = await withCoursLock(cours_id, async () => {
      // Re-vérifier l'idempotence dans le mutex (une autre req peut avoir commité entre-temps)
      const { data: existingByPi2 } = await supabase.from('reservations')
        .select('id').eq('stripe_payment_intent_id', payment_intent_id).maybeSingle();
      if (existingByPi2) return { already_existed: true };

      if (!pour_ami) {
        const { data: existing } = await supabase.from('reservations')
          .select('id').eq('cours_id', cours_id).eq('user_id', user_id).maybeSingle();
        if (existing) return { already_existed: true };
      }

      // Vérification places disponibles — anti-surbooking
      if (!pour_ami) {
        const { data: coursCheck } = await supabase.from('cours').select('places_max,places_prises,titre').eq('id', cours_id).single();
        if (coursCheck && coursCheck.places_prises >= coursCheck.places_max) {
          return { complet: true, titre: coursCheck.titre };
        }
      }

      // Créer la réservation
      await supabase.from('reservations').insert([{
        cours_id, user_id,
        montant_paye: parseFloat(montant) || 0,
        stripe_payment_intent_id: payment_intent_id,
        type_paiement: pour_ami ? 'stripe_ami' : 'stripe'
      }]);

      unlockPlace(cours_id, user_id);

      const { data: coursData } = await supabase.from('cours')
        .select('titre,date_heure,lieu,professeur_id').eq('id', cours_id).single();
      const { count: resCountPI } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
      await supabase.from('cours').update({ places_prises: resCountPI || 0 }).eq('id', cours_id);
      io.emit('reservation_update', { cours_id, places_prises: resCountPI || 0 });
      return { ok: true, coursData };
    });

    if (lockResult.already_existed) return res.json({ success: true, already_existed: true });

    if (lockResult.complet) {
      console.warn(`[STRIPE] Cours complet — remboursement auto — cours_id: ${cours_id} | user_id: ${user_id}`);
      try { await stripe.refunds.create({ payment_intent: payment_intent_id }); }
      catch(refundErr) {
        console.error(`[STRIPE] Échec remboursement auto: ${refundErr.message}`);
        discordStripeAlert(`🚨 **Échec remboursement auto**\n> **PI :** \`${payment_intent_id}\`\n> **Élève :** \`${user_id}\`\n> **Montant :** ${montant}€\n> Remboursement manuel requis.`);
      }
      discordStripeAlert(`ℹ️ **Surbooking évité — remboursement auto**\n> **Cours :** ${lockResult.titre}\n> **Élève :** \`${user_id}\`\n> **Montant remboursé :** ${montant}€`);
      return res.status(409).json({ error: 'Ce cours est complet. Vous allez être remboursé sous 5-10 jours ouvrés.' });
    }

    const coursData = lockResult.coursData;

    // Emails (hors mutex — pas critique)
    try {
      const { data: eleve } = await supabase.from('profiles').select('email,prenom,nom').eq('id', user_id).single();
      const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', coursData?.professeur_id).single();
      if (eleve?.email) await sendEmailReservation(eleve.email, (eleve.prenom+' '+eleve.nom).trim(), coursData?.titre, coursData?.date_heure, coursData?.lieu, montant);
      if (prof?.email) await sendEmailProfNewEleve(prof.email, (prof.prenom+' '+prof.nom).trim(), (eleve?.prenom+' '+(eleve?.nom||'')).trim(), coursData?.titre, montant);
    } catch(e) {}

    // Push prof (hors mutex)
    if (coursData?.professeur_id) {
      const { data: eleve2 } = await supabase.from('profiles').select('prenom,nom').eq('id', user_id).single().catch(()=>({data:null}));
      pushToUser(coursData.professeur_id, {
        title: '🎉 Nouvelle réservation !',
        body: `${((eleve2?.prenom||'')+' '+(eleve2?.nom||'')).trim() || 'Un élève'} a réservé "${coursData?.titre}" (+${montant}€)`,
        tag: 'new-eleve', icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e) {
    console.log('Confirm payment error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// STRIPE — page de succès qui crée la réservation et redirige
app.get('/stripe/success', async (req, res) => {
  const { session_id, pour_ami, redirect } = req.query;
  const _allowedRedirect = 'https://courspool.vercel.app';
  const baseRedirect = (redirect && redirect.startsWith(_allowedRedirect)) ? redirect : _allowedRedirect;
  if (!session_id) return res.redirect(baseRedirect);

  try {
    // Récupérer et vérifier la session Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || session.payment_status !== 'paid') {
      return res.redirect(baseRedirect + '?error=payment_failed');
    }

    const cours_id = session.metadata?.cours_id;
    const user_id = session.metadata?.user_id;
    const montant = session.metadata?.montant;
    const pour_ami_meta = session.metadata?.pour_ami || pour_ami;

    if (!cours_id || !user_id) return res.redirect(baseRedirect);

    // Idempotence par session_id (couvre les deux cas : normal et pour_ami)
    const { data: existingBySession } = await supabase.from('reservations')
      .select('id').eq('stripe_session_id', session_id).maybeSingle();
    if (existingBySession) {
      return res.redirect(baseRedirect + '?paid=1&cours_id=' + cours_id);
    }
    // Vérifier si déjà réservé par cours+user (sauf pour ami)
    if (pour_ami_meta !== '1') {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).single();
      if (existing) {
        return res.redirect(baseRedirect + '?paid=1&cours_id=' + cours_id);
      }
    }

    // Créer la réservation
    await supabase.from('reservations').insert([{
      cours_id, user_id,
      montant_paye: parseFloat(montant) || 0,
      stripe_session_id: session_id,
      type_paiement: pour_ami_meta === '1' ? 'stripe_ami' : 'stripe'
    }]);

    // Recalculer places_prises depuis la source de vérité
    const { data: coursData } = await supabase.from('cours').select('titre,date_heure,lieu,professeur_id').eq('id', cours_id).single();
    const { count: resCountSuc } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
    await supabase.from('cours').update({ places_prises: resCountSuc || 0 }).eq('id', cours_id);
    io.emit('reservation_update', { cours_id, places_prises: resCountSuc || 0 });

    // Envoyer emails
    let eleve = null;
    try {
      const { data: eleveData } = await supabase.from('profiles').select('email,prenom,nom').eq('id', user_id).single();
      eleve = eleveData;
      const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', coursData?.professeur_id).single();
      if (eleve?.email) await sendEmailReservation(eleve.email, (eleve.prenom+' '+eleve.nom).trim(), coursData?.titre, coursData?.date_heure, coursData?.lieu, montant);
      if (prof?.email) await sendEmailProfNewEleve(prof.email, (prof.prenom+' '+prof.nom).trim(), (eleve?.prenom+' '+eleve?.nom||'').trim(), coursData?.titre, montant);
    } catch(e) {}
    // Push prof : nouvelle réservation
    if (coursData?.professeur_id) {
      const eleveName = (eleve?.prenom||'') + ' ' + (eleve?.nom||'');
      pushToUser(coursData.professeur_id, {
        title: '🎉 Nouvelle réservation !',
        body: `${eleveName.trim() || 'Un élève'} a réservé "${coursData?.titre}" (+${montant}€)`,
        tag: 'new-eleve', icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      }).catch(() => {});
    }

    // Rediriger vers le site avec paramètre de succès
    res.redirect(baseRedirect + '?paid=1&cours_id=' + cours_id + (pour_ami_meta==='1'?'&ami=1':''));
  } catch (e) {
    console.log('Stripe success error:', e.message);
    res.redirect(baseRedirect);
  }
});

// STRIPE — confirmer paiement après redirect
app.post('/stripe/confirm', requireAuth, async (req, res) => {
  const { session_id, cours_id, user_id, pour_ami } = req.body;
  if (!session_id || !cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });
  if (req.user && user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') return res.status(400).json({ error: 'Paiement non complété' });

    const montant = parseFloat(session.metadata?.montant || 0);

    // Vérifier si déjà réservé (seulement si pas pour ami)
    if (!pour_ami) {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).single();
      if (existing) return res.json({ success: true, already: true });
    }

    // Créer la réservation
    const { error } = await supabase.from('reservations')
      .insert([{ cours_id, user_id, montant_paye: montant, type_paiement: pour_ami ? 'stripe_ami' : 'stripe' }]);
    if (error) return res.status(500).json({ error: error.message });

    // Recalculer places_prises depuis la source de vérité
    const { data: coursData2 } = await supabase.from('cours').select('titre,date_heure,lieu,professeur_id,prof_nom').eq('id', cours_id).single();
    const { count: resCountConf } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
    await supabase.from('cours').update({ places_prises: resCountConf || 0 }).eq('id', cours_id);
    io.emit('reservation_update', { cours_id, places_prises: resCountConf || 0 });

    // Envoyer emails
    try {
      const { data: eleveProfile } = await supabase.from('profiles').select('email,prenom,nom').eq('id', user_id).single();
      const { data: profProfile } = await supabase.from('profiles').select('email,prenom,nom').eq('id', coursData2?.professeur_id).single();
      const eleveName = eleveProfile ? (eleveProfile.prenom + ' ' + eleveProfile.nom).trim() : 'Élève';
      const profName = profProfile ? (profProfile.prenom + ' ' + profProfile.nom).trim() : 'Professeur';
      if (eleveProfile?.email) await sendEmailReservation(eleveProfile.email, eleveName, coursData2?.titre, coursData2?.date_heure, coursData2?.lieu, montant);
      if (profProfile?.email) await sendEmailProfNewEleve(profProfile.email, profName, eleveName, coursData2?.titre, montant);
    } catch(e) { console.log('Email error:', e.message); }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.post('/follows', requireAuth, async (req, res) => {
  const user_id = req.user.id;
  const { professeur_id } = req.body;
  if (!professeur_id) return res.status(400).json({ error: 'professeur_id manquant' });
  try {
    const { error } = await supabase.from('follows').upsert({ user_id, professeur_id }, { onConflict: 'user_id,professeur_id' });
    if (error) return res.status(500).json({ error });
    const { count } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('professeur_id', professeur_id);
    const nb_eleves = count || 0;
    io.to(professeur_id).emit('follow_update', { professeur_id, action: 'follow', nb_eleves });
    res.json({ success: true, nb_eleves });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// FOLLOWS — supprimer (désabonnement)
app.delete('/follows', requireAuth, async (req, res) => {
  const user_id = req.user.id;
  const { professeur_id } = req.body;
  if (!professeur_id) return res.status(400).json({ error: 'professeur_id manquant' });
  try {
    const { error } = await supabase.from('follows').delete().eq('user_id', user_id).eq('professeur_id', professeur_id);
    if (error) return res.status(500).json({ error });
    const { count } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('professeur_id', professeur_id);
    const nb_eleves = count || 0;
    io.to(professeur_id).emit('follow_update', { professeur_id, action: 'unfollow', nb_eleves });
    res.json({ success: true, nb_eleves });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// FOLLOWS — vérifier si un élève suit un prof (doit être avant /:user_id)
app.get('/follows/check', async (req, res) => {
  const { professeur_id, eleve_id } = req.query;
  if (!professeur_id || !eleve_id) return res.status(400).json({ error: 'Données manquantes' });
  const { data } = await supabase.from('follows').select('id').eq('user_id', eleve_id).eq('professeur_id', professeur_id).maybeSingle();
  res.json({ isFollowing: !!data });
});

// FOLLOWS — récupérer tous les follows d'un user
app.get('/follows/:user_id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('follows').select('*').eq('user_id', req.params.user_id);
    if (error) return res.status(500).json({ error });
    res.json(data);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// EMAIL — vérification prof
// CONTACT — formulaire utilisateur → dashboard admin + email
app.post('/contact', authRateLimit, async (req, res) => {
  const { email, nom, role, sujet, message, photo_base64 } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'Données manquantes' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message trop long' });
  let photo_url = null;
  if (photo_base64 && photo_base64.startsWith('data:image/')) {
    try {
      const base64Data = photo_base64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const rawExt = photo_base64.split(';')[0].split('/')[1] || 'jpg';
      const ext = ['jpg','jpeg','png','webp'].includes(rawExt) ? rawExt : 'jpg';
      const filename = 'support-' + Date.now() + '.' + ext;
      const { error: uploadErr } = await supabase.storage.from('support').upload(filename, buffer, { contentType: 'image/' + ext, upsert: false });
      if (!uploadErr) {
        const { data: pubData } = supabase.storage.from('support').getPublicUrl(filename);
        photo_url = pubData?.publicUrl || null;
      }
    } catch(e) { /* ignore photo error, still send message */ }
  }
  try {
    // 1. Stocker en base Supabase
    const { error: dbErr } = await supabase.from('contacts').insert([{
      email, sujet: sujet || 'Question générale', message,
      nom: nom || '', role: role || 'inconnu',
      user_id: req.body.user_id || null,
      photo_url: photo_url,
      lu: false,
      created_at: new Date().toISOString()
    }]);
    if (dbErr) console.log('Contact DB error:', dbErr.message);

    // 2. Email de notification vers l'admin
    await resend.emails.send({
      from: FROM_EMAIL,
      to: 'avantgardepopup@gmail.com', // email admin
      replyTo: email,
      subject: `[Contact] ${sujet || 'Question'} — ${nom || email}`,
      html: emailBase(
        'linear-gradient(135deg,#6366F1,#4F46E5)',
        `<h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">Nouveau message</h1>
         <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px">${sujet || 'Question générale'}</p>`,
        `<table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
          <tr><td style="padding:6px 0;font-size:13px;color:#888;width:80px">De</td><td style="font-size:13px;font-weight:600;color:#111">${nom || 'Anonyme'} &lt;${email}&gt;</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#888">Rôle</td><td style="font-size:13px;color:#555">${role || '—'}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#888">Sujet</td><td style="font-size:13px;font-weight:600;color:#111">${sujet || '—'}</td></tr>
        </table>
        <div style="background:#F8F7F5;border-radius:14px;padding:18px;margin-bottom:24px;border-left:3px solid #6366F1">
          <p style="margin:0;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${escHtml(message)}</p>
        </div>
        <a href="mailto:${email}" style="display:block;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center">Répondre à ${nom || email} →</a>`
      )
    }).catch(e => console.log('Contact email admin error:', e.message));

    // 3. Email de confirmation à l'utilisateur
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Nous avons bien reçu votre message — CoursPool',
      html: emailBase(
        'linear-gradient(135deg,#FF8C55,#E04E10)',
        `<h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">Message reçu !</h1>
         <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px">On vous répond dans les 24h</p>`,
        `<p style="margin:0 0 16px;font-size:15px;color:#111;font-weight:600">Bonjour ${nom || ''} !</p>
         <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">Votre message a bien été transmis à notre équipe. Nous vous répondrons sous 24h, du lundi au samedi.</p>
         <div style="background:#F8F7F5;border-radius:14px;padding:16px;margin-bottom:24px">
           <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em">Votre message</p>
           <p style="margin:0;font-size:13px;color:#555;line-height:1.6;white-space:pre-wrap">${escHtml(message)}</p>
         </div>
         <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center">Retour à l'application →</a>`
      )
    }).catch(e => console.log('Contact email user error:', e.message));

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE user — suppression complète (profil + auth)
app.delete('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  console.log('[DELETE /users] début suppression:', id);
  try {
    // Récupérer les infos du profil avant suppression pour l'alerte Discord
    const { data: deletedProfile } = await supabase.from('profiles').select('prenom,nom,email,role').eq('id', id).single();

    // 1. Rembourser et annuler tous les cours du prof
    const { data: profCours } = await supabase.from('cours').select('id').eq('professeur_id', id);
    for (const cours of (profCours || [])) {
      const { data: reservations } = await supabase.from('reservations')
        .select('id,stripe_payment_intent_id').eq('cours_id', cours.id);
      for (const r of (reservations || [])) {
        if (r.stripe_payment_intent_id) {
          try { await stripe.refunds.create({ payment_intent: r.stripe_payment_intent_id }); }
          catch(e) { console.log(`[DELETE /users] refund ${r.stripe_payment_intent_id} error:`, e.message); }
        }
        await supabase.from('reservations').delete().eq('id', r.id);
      }
      await supabase.from('cours').delete().eq('id', cours.id);
      io.emit('cours_update', { action: 'delete', cours_id: cours.id });
      console.log(`[DELETE /users] cours ${cours.id} annulé + remboursé`);
    }

    // 2. Données liées restantes — colonnes réelles en BDD
    const tables = [
      ['reservations',      'user_id'],       // réservations du prof en tant qu'élève
      ['follows',           'user_id'],
      ['follows',           'professeur_id'],
      ['push_subscriptions','user_id'],
      ['contacts',          'user_id'],
      ['notations',         'eleve_id'],
      ['notations',         'professeur_id'],
      ['messages',          'sender_id'],
      ['messages',          'receiver_id'],
    ];
    for (const [table, col] of tables) {
      const { error } = await supabase.from(table).delete().eq(col, id);
      if (error) console.log(`[DELETE /users] ${table}.${col} error:`, error.message);
      else console.log(`[DELETE /users] ${table}.${col} OK`);
    }

    // 3. Profil
    const { error: profErr } = await supabase.from('profiles').delete().eq('id', id);
    if (profErr) {
      console.log('[DELETE /users] profiles error:', profErr.message);
      return res.status(500).json({ error: 'Échec suppression profil: ' + profErr.message });
    }
    console.log('[DELETE /users] profile OK');

    // 4. Compte Auth Supabase
    const { error: authErr } = await supabase.auth.admin.deleteUser(id);
    if (authErr) {
      // Non bloquant — le profil est déjà supprimé
      console.log('[DELETE /users] auth.admin.deleteUser error (ignoré):', authErr.message);
    } else {
      console.log('[DELETE /users] auth user OK');
    }

    await logAdminAction(req.user.id, 'delete_user', id, {});
    const nom = deletedProfile ? `${deletedProfile.prenom || ''} ${deletedProfile.nom || ''}`.trim() : '?';
    const email = deletedProfile?.email || '?';
    const role = deletedProfile?.role || '?';
    discordAlert(
      `🗑️ **Compte supprimé**\n` +
      `> **Nom :** ${nom}\n` +
      `> **Email :** \`${email}\`\n` +
      `> **Rôle :** ${role}\n` +
      `> **Supprimé par admin :** \`${req.user.id}\`\n` +
      `> **ID :** \`${id}\``
    );
    res.json({ success: true });
  } catch(e) {
    console.log('[DELETE /users] exception:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// EXPORT RGPD — téléchargement de toutes les données de l'utilisateur (droit à la portabilité)
app.get('/users/me/export', requireAuth, async (req, res) => {
  const id = req.user.id;
  try {
    const [
      { data: profile },
      { data: cours },
      { data: reservations },
      { data: follows },
      { data: notations },
      { data: messages_sent },
      { data: messages_received },
      { data: contacts },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('cours').select('*').eq('professeur_id', id),
      supabase.from('reservations').select('*').eq('user_id', id),
      supabase.from('follows').select('*').eq('user_id', id),
      supabase.from('notations').select('*').eq('eleve_id', id),
      supabase.from('messages').select('*').eq('sender_id', id),
      supabase.from('messages').select('*').eq('receiver_id', id),
      supabase.from('contacts').select('*').eq('user_id', id),
    ]);

    // Retirer les champs sensibles internes du profil
    if (profile) {
      delete profile.stripe_account_id;
      delete profile.stripe_customer_id;
    }

    const exportData = {
      exported_at: new Date().toISOString(),
      user_id: id,
      profile: profile || {},
      cours: cours || [],
      reservations: reservations || [],
      follows: follows || [],
      notations: notations || [],
      messages_sent: messages_sent || [],
      messages_received: messages_received || [],
      contacts: contacts || [],
    };

    _secLog('data_export', req, { userId: id });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="courspool-mes-donnees-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(exportData);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH profil — mise à jour par l'utilisateur lui-même (champs autorisés uniquement)
app.patch('/profiles/:id', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { id } = req.params;
  // Seul l'utilisateur lui-même peut modifier son profil
  if (req.user.id !== id) return res.status(403).json({ error: 'Non autorisé' });
  // Nouvelles colonnes Supabase requises :
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pour_enfant BOOLEAN DEFAULT false;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS niveau_enfant TEXT;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS age_enfant INTEGER;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_mineur BOOLEAN DEFAULT false;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mode_cours TEXT;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS niveau_etudes TEXT;
  // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ville_visible BOOLEAN DEFAULT false;
  const userFields = ['prenom', 'nom', 'matieres', 'niveau', 'statut', 'bio', 'ville', 'photo_url',
    'pour_enfant', 'niveau_enfant', 'age_enfant', 'is_mineur', 'mode_cours', 'niveau_etudes', 'ville_visible',
    'lieu', 'lieu_visible', 'contact_pref', 'search_visible', 'adresse_auto', 'is_tuteur',
    'formations', 'experiences'];
  const updates = {};
  userFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Aucun champ valide' });
  if (updates.bio && updates.bio.length > 500) return res.status(400).json({ error: 'Bio trop longue (500 max)' });
  if (updates.ville && updates.ville.length > 100) return res.status(400).json({ error: 'Ville trop longue (100 max)' });
  if (updates.prenom && updates.prenom.length > 50) return res.status(400).json({ error: 'Prénom trop long (50 max)' });
  if (updates.nom && updates.nom.length > 50) return res.status(400).json({ error: 'Nom trop long (50 max)' });
  try {
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, profile: data });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/email/verification', requireAdmin, async (req, res) => {
  const { prof_id, status, raison } = req.body;
  if (!prof_id || !status) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', prof_id).single();
    if (!prof) return res.status(404).json({ error: 'Prof introuvable' });
    const profName = ((prof.prenom||'') + ' ' + (prof.nom||'')).trim();
    await sendEmailProfVerification(prof.email, profName, status, raison || '');
    // Mettre à jour le statut + raison en base selon le résultat
    if (status === 'approved') {
      await supabase.from('profiles').update({ verified: true, statut_compte: 'actif', rejection_reason: '' }).eq('id', prof_id);
      await logAdminAction(req.user.id, 'approve_cni', prof_id, {});
    } else if (status === 'rejected_retry') {
      await supabase.from('profiles').update({ statut_compte: 'rejeté', cni_uploaded: false, rejection_reason: raison||'', can_retry_cni: true }).eq('id', prof_id);
      await logAdminAction(req.user.id, 'reject_cni_retry', prof_id, { raison });
    } else if (status === 'rejected_final') {
      await supabase.from('profiles').update({ statut_compte: 'bloqué', rejection_reason: raison||'', can_retry_cni: false }).eq('id', prof_id);
      await logAdminAction(req.user.id, 'reject_cni_final', prof_id, { raison });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DIPLÔME — vérification admin (email + update)
app.post('/email/diplome-verification', requireAdmin, async (req, res) => {
  const { prof_id, status } = req.body;
  if (!prof_id || !status) return res.status(400).json({ error: 'Données manquantes' });
  if (!['approved', 'rejected', 'rejected_retry'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  try {
    const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', prof_id).single();
    if (!prof) return res.status(404).json({ error: 'Prof introuvable' });
    const profName = ((prof.prenom||'') + ' ' + (prof.nom||'')).trim();
    await sendEmailDiplomeVerification(prof.email, profName, status);
    if (status === 'approved') {
      await supabase.from('profiles').update({ diplome_verifie: true }).eq('id', prof_id);
      await logAdminAction(req.user.id, 'approve_diplome', prof_id, {});
      req.app.get('io').to(prof_id).emit('diplome_update', { professeur_id: prof_id, diplome_verifie: true });
    } else {
      // rejected ou rejected_retry : reset upload pour permettre un renvoi
      await supabase.from('profiles').update({ diplome_uploaded: false, diplome_verifie: false }).eq('id', prof_id);
      await logAdminAction(req.user.id, status === 'rejected_retry' ? 'retry_diplome' : 'reject_diplome', prof_id, {});
      req.app.get('io').to(prof_id).emit('diplome_update', { professeur_id: prof_id, diplome_verifie: false });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PROFIL DE CONFIANCE — vérification admin
app.post('/email/casier-verification', requireAdmin, async (req, res) => {
  const { prof_id, status } = req.body;
  if (!prof_id || !status) return res.status(400).json({ error: 'Données manquantes' });
  if (!['approved', 'rejected', 'rejected_retry'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  try {
    const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', prof_id).single();
    if (!prof) return res.status(404).json({ error: 'Prof introuvable' });
    const profName = ((prof.prenom||'') + ' ' + (prof.nom||'')).trim();
    await sendEmailCasierVerification(prof.email, profName, status);
    if (status === 'approved') {
      await supabase.from('profiles').update({ casier_verifie: true }).eq('id', prof_id);
      await logAdminAction(req.user.id, 'approve_casier', prof_id, {});
      req.app.get('io').to(prof_id).emit('casier_update', { professeur_id: prof_id, casier_verifie: true });
    } else {
      await supabase.from('profiles').update({ casier_uploaded: false, casier_verifie: false }).eq('id', prof_id);
      await logAdminAction(req.user.id, status === 'rejected_retry' ? 'retry_casier' : 'reject_casier', prof_id, {});
      req.app.get('io').to(prof_id).emit('casier_update', { professeur_id: prof_id, casier_verifie: false });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// STRIPE — récupérer les paiements réels (paginé, max 500)
app.get('/stripe/payments', requireAdmin, async (req, res) => {
  try {
    const all = [];
    let lastId = undefined;
    for (let page = 0; page < 5; page++) { // max 5 pages × 100 = 500
      const params = { limit: 100 };
      if (lastId) params.starting_after = lastId;
      const payments = await stripe.paymentIntents.list(params);
      all.push(...payments.data);
      if (!payments.has_more || !payments.data.length) break;
      lastId = payments.data[payments.data.length - 1].id;
    }
    const result = all.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      created: new Date(p.created * 1000).toISOString(),
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// SUPABASE — webhook (événements base de données → Discord)
// Configuré dans Supabase Dashboard → Database → Webhooks
app.post('/webhooks/supabase', express.json(), async (req, res) => {
  // Vérification du secret partagé (header custom configuré dans Supabase)
  const secret = req.headers['x-webhook-secret'];
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    console.warn('[Supabase Webhook] Secret invalide ou manquant');
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { type, table, record, old_record } = req.body;

  try {
    // Changement de statut de compte (blocage, rejet, activation)
    if (table === 'profiles' && type === 'UPDATE') {
      const oldStatut = old_record?.statut_compte;
      const newStatut = record?.statut_compte;
      if (oldStatut !== newStatut && newStatut) {
        const nom = `${record.prenom || ''} ${record.nom || ''}`.trim() || '?';
        discordAlert(
          `🔄 **Changement statut compte**\n` +
          `> **Utilisateur :** ${nom}\n` +
          `> **Email :** \`${record.email || '?'}\`\n` +
          `> **Avant :** ${oldStatut || '?'} → **Après :** ${newStatut}`,
          process.env.DISCORD_WEBHOOK_SUPABASE
        );
      }

      // Changement de rôle (très suspect si non initié par l'app)
      const oldRole = old_record?.role;
      const newRole = record?.role;
      if (oldRole !== newRole && newRole) {
        const nom = `${record.prenom || ''} ${record.nom || ''}`.trim() || '?';
        discordAlert(
          `⚠️ **Changement de rôle détecté**\n` +
          `> **Utilisateur :** ${nom} (\`${record.id}\`)\n` +
          `> **Avant :** ${oldRole || '?'} → **Après :** ${newRole}\n` +
          `> Si ce changement n'a pas été initié par l'app, vérifiez immédiatement.`,
          process.env.DISCORD_WEBHOOK_SUPABASE
        );
      }
    }

    // Nouveau cours créé (pour info — pas d'alerte par défaut, logué seulement)
    if (table === 'cours' && type === 'INSERT') {
      console.log(`[Supabase Webhook] Nouveau cours: ${record?.id} — prof: ${record?.professeur_id}`);
    }

    res.json({ ok: true });
  } catch(e) {
    console.error('[Supabase Webhook] Erreur:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// STRIPE — webhook (signature vérifiée, route publique)
app.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET non configuré' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch(e) {
    console.warn('[Webhook] signature invalide:', e.message);
    discordStripeAlert(`🚨 **Webhook Stripe — signature invalide**\n> Quelqu'un envoie de faux événements Stripe.\n> **Erreur :** ${e.message}`);
    return res.status(400).send('Webhook signature invalide');
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const { cours_id, user_id, montant, pour_ami } = pi.metadata || {};
    if (cours_id && user_id) {
      try {
        // Idempotence — ne pas créer de doublon
        const { data: existing } = await supabase.from('reservations')
          .select('id').eq('stripe_payment_intent_id', pi.id).maybeSingle();
        if (!existing) {
          await supabase.from('reservations').insert([{
            cours_id, user_id,
            montant_paye: parseFloat(montant) || 0,
            stripe_payment_intent_id: pi.id,
            type_paiement: pour_ami === '1' ? 'stripe_ami' : 'stripe'
          }]);
          const { count } = await supabase.from('reservations').select('*', { count: 'exact', head: true }).eq('cours_id', cours_id);
          await supabase.from('cours').update({ places_prises: count || 0 }).eq('id', cours_id);
          io.emit('reservation_update', { cours_id, places_prises: count || 0 });
          console.log('[Webhook] payment_intent.succeeded → réservation créée', cours_id, user_id);
        } else {
          console.log('[Webhook] payment_intent.succeeded → réservation déjà existante, ignoré');
        }
      } catch(e) {
        console.log('[Webhook] erreur création réservation:', e.message);
      }
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    console.log('[Webhook] payment_intent.payment_failed — pi:', pi.id, '— raison:', pi.last_payment_error?.message);
  } else if (event.type === 'charge.dispute.created') {
    // Chargeback — un élève conteste le paiement auprès de sa banque
    const dispute = event.data.object;
    const amount = (dispute.amount / 100).toFixed(2);
    console.warn('[Webhook] Chargeback reçu — dispute:', dispute.id, '— montant:', amount, '€');
    discordStripeAlert(
      `🚨 **Chargeback (contestation de paiement)**\n` +
      `> **Dispute ID :** \`${dispute.id}\`\n` +
      `> **Montant contesté :** ${amount}€\n` +
      `> **Raison :** ${dispute.reason || 'non précisée'}\n` +
      `> Action requise dans le dashboard Stripe sous 7 jours.`
    );
  }

  res.json({ received: true });
});

// RESERVATIONS — liste élèves inscrits à un cours (une seule requête avec JOIN)
app.get('/reservations/cours/:cours_id', requireAuth, async (req, res) => {
  try{
    // Vérifier que le demandeur est le prof du cours ou admin
    const {data:cours}=await supabase.from('cours').select('professeur_id').eq('id',req.params.cours_id).single();
    if(!cours)return res.status(404).json({error:'Cours introuvable'});
    if(cours.professeur_id!==req.user.id&&!isAdmin(req.user.id))return res.status(403).json({error:'Non autorisé'});

    const {data,error}=await supabase.from('reservations')
      .select('id,user_id,cours_id,montant_paye,created_at,profiles!user_id(prenom,nom,email)')
      .eq('cours_id',req.params.cours_id)
      .order('created_at',{ascending:true});
    if(error)return res.status(500).json({error});
    const enriched=(data||[]).map(r=>({
      reservation_id:r.id,user_id:r.user_id,cours_id:r.cours_id,montant_paye:r.montant_paye,created_at:r.created_at,
      prenom:r.profiles?.prenom||'',nom:r.profiles?.nom||'',email:r.profiles?.email||''
    }));
    res.json(enriched);
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// RESERVATIONS — annuler une réservation élève
app.post('/reservations/:id/cancel', requireAuth, async (req, res) => {
  const {cours_id}=req.body;
  try{
    const {data:reservation}=await supabase.from('reservations').select('*').eq('id',req.params.id).single();
    if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
    if (reservation.user_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    const resolvedCours = reservation.cours_id;
    await supabase.from('reservations').delete().eq('id',req.params.id);
    const {count:resCountCancel}=await supabase.from('reservations').select('*',{count:'exact',head:true}).eq('cours_id',resolvedCours);
    await supabase.from('cours').update({places_prises:resCountCancel||0}).eq('id',resolvedCours);
    io.emit('reservation_update',{cours_id:resolvedCours,places_prises:resCountCancel||0});
    let rembourse=false;
    if(reservation?.stripe_payment_intent_id){
      try{await stripe.refunds.create({payment_intent:reservation.stripe_payment_intent_id});rembourse=true;}catch(e){console.log('Refund error:',e.message);}
    }
    res.json({success:true,rembourse});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// COURS — annuler cours complet + rembourser tous les élèves
app.post('/cours/:id/cancel', requireAuth, async (req, res) => {
  try{
    const {data:cours}=await supabase.from('cours').select('professeur_id').eq('id',req.params.id).single();
    if(!cours)return res.status(404).json({error:'Cours introuvable'});
    if(cours.professeur_id!==req.user.id&&!isAdmin(req.user.id))return res.status(403).json({error:'Non autorisé'});
    const {data:reservations}=await supabase.from('reservations').select('*').eq('cours_id',req.params.id);
    let remboursements=0;
    for(const r of(reservations||[])){
      await supabase.from('reservations').delete().eq('id',r.id);
      if(r.stripe_payment_intent_id){
        try{await stripe.refunds.create({payment_intent:r.stripe_payment_intent_id});remboursements++;}catch(e){console.log('Refund error:',e.message);}
      }else{remboursements++;}
    }
    await supabase.from('cours').delete().eq('id',req.params.id);
    io.emit('cours_update', { action: 'cancel', cours_id: req.params.id });
    res.json({success:true,remboursements});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE — paiements d'un prof
app.get('/stripe/payments/prof/:prof_id', requireAuth, async (req, res) => {
  if (req.user.id !== req.params.prof_id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try{
    const {data:cours}=await supabase.from('cours').select('id,titre').eq('professeur_id',req.params.prof_id);
    if(!cours||!cours.length)return res.json([]);
    const coursIds=cours.map(c=>c.id);
    const coursMap={};cours.forEach(c=>{coursMap[c.id]=c.titre;});
    const {data:reservations}=await supabase.from('reservations').select('cours_id,montant_paye,created_at').in('cours_id',coursIds).order('created_at',{ascending:false});
    if(!reservations)return res.json([]);
    const result=reservations.map(r=>({id:r.cours_id+'_'+r.created_at,amount:r.montant_paye||0,currency:'eur',status:'succeeded',created:r.created_at,cours_titre:coursMap[r.cours_id]||'Cours'}));
    res.json(result);
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE — remboursements émis par un prof
app.get('/stripe/refunds/prof/:prof_id', requireAuth, async (req, res) => {
  if (req.user.id !== req.params.prof_id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const refunds = await stripe.refunds.list({ limit: 100, expand: ['data.payment_intent'] });
    const result = refunds.data
      .filter(r => r.payment_intent && r.payment_intent.metadata && r.payment_intent.metadata.prof_id === req.params.prof_id)
      .map(r => ({
        id: r.id,
        amount: r.amount / 100,
        currency: r.currency,
        status: r.status,
        created: new Date(r.created * 1000).toISOString(),
        cours_id: r.payment_intent.metadata.cours_id || null,
        user_id: r.payment_intent.metadata.user_id || null,
        cours_titre: r.payment_intent.description || 'Cours CoursPool',
      }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GROUPE — envoyer un message à plusieurs élèves d'un cours
app.post('/messages/groupe', requireAuth, async (req, res) => {
  const expediteur_id = req.user.id; // toujours l'utilisateur connecté
  const { cours_id, contenu, cours_titre } = req.body;
  if (!cours_id || !contenu) return res.status(400).json({ error: 'Données manquantes' });
  if (contenu.length > 2000) return res.status(400).json({ error: 'Message trop long (2000 caractères max)' });
  try {
    // Vérifier droits d'écriture si l'expéditeur est un élève
    const { data: coursInfo } = await supabase.from('cours').select('professeur_id,eleves_peuvent_ecrire').eq('id', cours_id).single();
    if (!coursInfo) return res.status(404).json({ error: 'Cours introuvable' });
    if (coursInfo.professeur_id !== expediteur_id) {
      // Vérifier que l'expéditeur est bien inscrit au cours
      const { data: inscrit } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', expediteur_id).maybeSingle();
      if (!inscrit) return res.status(403).json({ error: 'Non autorisé' });
      if (!coursInfo.eleves_peuvent_ecrire) {
        return res.status(403).json({ error: 'Les élèves ne peuvent pas écrire dans ce groupe' });
      }
    }
    // Récupérer tous les inscrits au cours
    const { data: reservations, error } = await supabase
      .from('reservations').select('user_id').eq('cours_id', cours_id);
    if (error) return res.status(500).json({ error: error.message });
    const eleves = [...new Set(reservations.map(r => r.user_id).filter(id => id && id !== expediteur_id))];
    if (!eleves.length) return res.json({ success: true, sent: 0 });
    // Récupérer le nom de l'expéditeur depuis les profiles (source de vérité)
    const { data: senderProfile } = await supabase.from('profiles').select('prenom, nom').eq('id', expediteur_id).single();
    const senderNom = senderProfile ? ((senderProfile.prenom || '') + ' ' + (senderProfile.nom || '')).trim() : '';
    const msgs = eleves.map(dest => ({
      sender_id: expediteur_id,
      receiver_id: dest,
      contenu: contenu,
      groupe_cours_id: cours_id,
      groupe_cours_titre: cours_titre || 'Cours',
      sender_nom: senderNom
    }));
    const { error: insertErr } = await supabase.from('messages').insert(msgs);
    if (insertErr) {
      // Fallback sans colonnes groupe (si pas encore migrées)
      const msgsFallback = eleves.map(dest => ({
        sender_id: expediteur_id, receiver_id: dest, contenu: '[Groupe] ' + contenu
      }));
      await supabase.from('messages').insert(msgsFallback);
    }
    // Notifier chaque élève en temps réel
    eleves.forEach(eleveId => {
      io.to(eleveId).emit('new_message', {
        expediteur_id,
        destinataire_id: eleveId,
        contenu,
        groupe: true,
        cours_id
      });
    });
    res.json({ success: true, sent: eleves.length });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GROUPE — récupérer messages d'un cours
app.get('/messages/groupe/:cours_id', requireAuth, async (req, res) => {
  const { cours_id } = req.params;
  try {
    // Vérifier accès : prof du cours, inscrit, ou admin
    if (!isAdmin(req.user.id)) {
      const { data: coursData } = await supabase.from('cours').select('professeur_id').eq('id', cours_id).single();
      if (!coursData) return res.status(404).json({ error: 'Cours introuvable' });
      if (coursData.professeur_id !== req.user.id) {
        const { data: inscrit } = await supabase.from('reservations')
          .select('id').eq('cours_id', cours_id).eq('user_id', req.user.id).maybeSingle();
        if (!inscrit) return res.status(403).json({ error: 'Non autorisé' });
      }
    }
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('groupe_cours_id', cours_id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.json([]);
    // Enrichir avec sender_nom depuis profiles si manquant
    const senderIds = [...new Set(data.map(m => m.sender_id).filter(Boolean))];
    const { data: profiles } = await supabase.from('profiles').select('id, prenom, nom').in('id', senderIds);
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = ((p.prenom || '') + ' ' + (p.nom || '')).trim(); });
    const enriched = data.map(m => ({
      ...m,
      sender_nom: m.sender_nom || profileMap[m.sender_id] || 'Utilisateur'
    }));
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GROUPE — liste des conversations groupe pour un user
app.get('/groupe-conversations/:user_id', requireAuth, async (req, res) => {
  const uid = req.params.user_id;
  if (!UUID_RE.test(uid)) return res.status(400).json({ error: 'ID invalide' });
  if (req.user.id !== uid && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const [{ data: resv }, { data: ownedCours }] = await Promise.all([
      supabase.from('reservations').select('cours_id').eq('user_id', uid),
      supabase.from('cours').select('id,titre,professeur_id').eq('professeur_id', uid)
    ]);
    const allCoursIds = [...new Set([
      ...(ownedCours || []).map(c => c.id),
      ...(resv || []).map(r => r.cours_id)
    ])];
    if (!allCoursIds.length) return res.json([]);

    const { data: msgs } = await supabase.from('messages')
      .select('*').in('groupe_cours_id', allCoursIds)
      .order('created_at', { ascending: false }).limit(500);

    const lastMsg = {}, unreadCount = {};
    (msgs || []).forEach(m => {
      const gid = m.groupe_cours_id;
      if (!lastMsg[gid]) lastMsg[gid] = m;
      if (!m.lu && m.receiver_id === uid) unreadCount[gid] = (unreadCount[gid] || 0) + 1;
    });

    const activeGroupIds = Object.keys(lastMsg);
    if (!activeGroupIds.length) return res.json([]);

    const { data: coursData } = await supabase.from('cours')
      .select('id,titre,professeur_id').in('id', activeGroupIds);
    const coursMap = {};
    (coursData || []).forEach(c => { coursMap[c.id] = c; });

    const results = await Promise.all(activeGroupIds.map(async (cid) => {
      const cours = coursMap[cid] || {};
      const { data: members } = await supabase.from('reservations')
        .select('user_id').eq('cours_id', cid);
      const totalMembers = (members || []).length + 1; // +1 pour le prof
      const memberIds = [...new Set([cours.professeur_id, ...(members || []).map(m => m.user_id)].filter(Boolean))];
      const { data: profiles } = memberIds.length
        ? await supabase.from('profiles').select('id,prenom,photo_url').in('id', memberIds.slice(0, 2))
        : { data: [] };
      return {
        cours_id: cid,
        cours_title: cours.titre || 'Cours',
        last_message: lastMsg[cid],
        unread: unreadCount[cid] || 0,
        total_membres: totalMembers,
        membres: (profiles || []).map(p => ({ id: p.id, nom: p.prenom || '?', photo: p.photo_url || null }))
      };
    }));

    res.json(results.sort((a, b) => new Date(b.last_message.created_at) - new Date(a.last_message.created_at)));
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GROUPE — marquer messages comme lus
app.put('/messages/groupe/lu/:cours_id', requireAuth, async (req, res) => {
  try {
    await supabase.from('messages').update({ lu: true })
      .eq('groupe_cours_id', req.params.cours_id)
      .eq('receiver_id', req.user.id).eq('lu', false);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GROUPE — toggle autorisation élèves d'écrire
app.patch('/cours/:id/groupe', requireAuth, async (req, res) => {
  const { eleves_peuvent_ecrire } = req.body;
  try {
    const { data: cours } = await supabase.from('cours').select('professeur_id').eq('id', req.params.id).single();
    if (!cours) return res.status(404).json({ error: 'Cours introuvable' });
    if (cours.professeur_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    await supabase.from('cours').update({ eleves_peuvent_ecrire }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});


// STRIPE CONNECT — créer compte
app.post('/stripe/connect/create', requireAuth, async (req, res) => {
  const {prof_id,email}=req.body;
  if(!prof_id||!email)return res.status(400).json({error:'Données manquantes'});
  if(prof_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({error:'Non autorisé'});
  try{
    const {data:prof}=await supabase.from('profiles').select('stripe_account_id').eq('id',prof_id).single();
    if(prof?.stripe_account_id)return res.json({account_id:prof.stripe_account_id,already_exists:true});
    const account=await stripe.accounts.create({type:'express',email,capabilities:{transfers:{requested:true},card_payments:{requested:true}},business_type:'individual',metadata:{prof_id}});
    await supabase.from('profiles').update({stripe_account_id:account.id}).eq('id',prof_id);
    res.json({account_id:account.id});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE CONNECT — setup intent IBAN
app.post('/stripe/connect/setup-intent', requireAuth, async (req, res) => {
  const {stripe_account_id}=req.body;
  if(!stripe_account_id)return res.status(400).json({error:'stripe_account_id manquant'});
  try{
    const setupIntent=await stripe.setupIntents.create({payment_method_types:['sepa_debit'],usage:'off_session'},{stripeAccount:stripe_account_id});
    res.json({client_secret:setupIntent.client_secret});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE CONNECT — IBAN sauvegardé
app.post('/stripe/connect/iban-saved', requireAuth, async (req, res) => {
  const {prof_id,stripe_account_id}=req.body;
  if(!prof_id)return res.status(400).json({error:'prof_id manquant'});
  if(prof_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({error:'Non autorisé'});
  try{
    await supabase.from('profiles').update({stripe_account_id,iban_configured:true}).eq('id',prof_id);
    res.json({success:true});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE CONNECT — statut par prof_id
app.get('/stripe/connect/status-prof/:prof_id', async (req, res) => {
  try{
    const {data:prof}=await supabase.from('profiles').select('stripe_account_id').eq('id',req.params.prof_id).single();
    if(!prof?.stripe_account_id)return res.json({stripe_account_id:null,charges_enabled:false,details_submitted:false});
    const account=await stripe.accounts.retrieve(prof.stripe_account_id);
    res.json({stripe_account_id:prof.stripe_account_id,charges_enabled:account.charges_enabled,payouts_enabled:account.payouts_enabled,details_submitted:account.details_submitted});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur serveur'});}
});

// STRIPE CONNECT — historique des virements (payouts)
app.get('/stripe/connect/payouts/:prof_id', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.prof_id) return res.status(403).json({ error: 'Non autorisé' });
    const { data: prof } = await supabase.from('profiles').select('stripe_account_id').eq('id', req.params.prof_id).single();
    if (!prof?.stripe_account_id) return res.json([]);
    const payouts = await stripe.payouts.list({ limit: 20 }, { stripeAccount: prof.stripe_account_id });
    res.json(payouts.data.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      arrival_date: p.arrival_date * 1000,
      description: p.description,
    })));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PROFILES — récupérer profil par ID
app.get('/profiles/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const PUBLIC_COLS = 'id,prenom,nom,photo_url,bio,ville,matieres,niveau,statut,role,verified,statut_compte,note_moyenne,created_at,diplome_verifie,casier_verifie';
  try {
    const {data,error}=await supabase.from('profiles').select(PUBLIC_COLS).eq('id',req.params.id).single();
    if(error){const status=error.code==='PGRST116'?404:500;return res.status(status).json({error:error.message});}
    const {count}=await supabase.from('follows').select('*',{count:'exact',head:true}).eq('professeur_id',req.params.id);
    const {count:coursDonnes}=await supabase.from('cours').select('*',{count:'exact',head:true}).eq('professeur_id',req.params.id).lt('date_heure',new Date().toISOString());
    const profile = data || {};
    profile.nb_eleves = count || 0;
    profile.cours_donnes = coursDonnes || 0;
    res.json(profile);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// MESSAGES — envoyer
// Rate limiting messages — 20 messages par minute par user
const msgRateLimitMap = new Map();
setInterval(function() {
  const cutoff = Date.now() - 60 * 1000;
  msgRateLimitMap.forEach(function(d, k) { if (d.start < cutoff) msgRateLimitMap.delete(k); });
}, 60 * 1000);

app.post('/messages', requireAuth, async (req, res) => {
  const expediteur_id = req.user.id;
  // Rate limiting par user (pas par IP — un user = une identité)
  const now = Date.now();
  if (!msgRateLimitMap.has(expediteur_id)) {
    msgRateLimitMap.set(expediteur_id, { count: 1, start: now });
  } else {
    const d = msgRateLimitMap.get(expediteur_id);
    if (now - d.start > 60 * 1000) {
      msgRateLimitMap.set(expediteur_id, { count: 1, start: now });
    } else if (d.count >= 20) {
      return res.status(429).json({ error: 'Trop de messages envoyés. Réessayez dans une minute.' });
    } else {
      d.count++;
    }
  }
  const { destinataire_id, contenu } = req.body;
  if (!destinataire_id || !contenu) return res.status(400).json({ error: 'Données manquantes' });
  if (contenu.length > 2000) return res.status(400).json({ error: 'Message trop long (2000 caractères max)' });
  try {
    const { data, error } = await supabase.from('messages')
      .insert([{ sender_id: expediteur_id, receiver_id: destinataire_id, contenu }])
      .select();
    if (error) return res.status(500).json({ error: error.message });
    const msg = data[0];
    io.to(destinataire_id).emit('new_message', { expediteur_id, destinataire_id, id: msg.id, contenu: msg.contenu, created_at: msg.created_at });
    res.json(msg);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// MESSAGES — compteur non lus (léger, pour le badge)
app.get('/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const { count, error } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('receiver_id', req.user.id).eq('lu', false);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ count: count || 0 });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// MESSAGES — récupérer conversation
app.get('/messages/:user1/:user2', requireAuth, async (req, res) => {
  const { user1, user2 } = req.params;
  if (!UUID_RE.test(user1) || !UUID_RE.test(user2)) return res.status(400).json({ error: 'ID invalide' });
  if (req.user.id !== user1 && req.user.id !== user2 && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const { data, error } = await supabase.from('messages').select('*')
      .or(`and(sender_id.eq.${user1},receiver_id.eq.${user2}),and(sender_id.eq.${user2},receiver_id.eq.${user1})`)
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error });
    res.json((data || []).reverse());
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// MESSAGES — toutes conversations d'un user (limité + enrichi avec profils)
app.get('/conversations/:user_id', requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.user_id)) return res.status(400).json({ error: 'ID invalide' });
  if (req.user.id !== req.params.user_id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const { data, error } = await supabase.from('messages').select('*')
      .or(`sender_id.eq.${req.params.user_id},receiver_id.eq.${req.params.user_id}`)
      .order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error });
    const otherIds = [...new Set((data || []).map(m =>
      m.sender_id === req.params.user_id ? m.receiver_id : m.sender_id
    ).filter(Boolean))];
    const { data: profiles } = otherIds.length
      ? await supabase.from('profiles').select('id, prenom, nom, photo_url').in('id', otherIds)
      : { data: [] };
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p; });
    const enriched = (data || []).map(m => {
      const otherId = m.sender_id === req.params.user_id ? m.receiver_id : m.sender_id;
      const p = profileMap[otherId] || {};
      return { ...m, other_nom: ((p.prenom || '') + ' ' + (p.nom || '')).trim() || null, other_photo: p.photo_url || null };
    });
    res.json(enriched);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// MESSAGES — marquer comme lu
app.put('/messages/lu/:user_id', requireAuth, async (req, res) => {
  const { expediteur_id } = req.body;
  if (!expediteur_id) return res.status(400).json({ error: 'expediteur_id manquant' });
  if (req.params.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const { error } = await supabase.from('messages').update({ lu: true })
      .eq('receiver_id', req.params.user_id).eq('sender_id', expediteur_id).eq('lu', false);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// UPLOAD PHOTO PROFIL
const _ALLOWED_DOC_EXTS = ['jpg','jpeg','png','webp','pdf'];
function _validateStoragePath(storagePath) {
  const ext = (storagePath.split('.').pop() || '').toLowerCase();
  return _ALLOWED_DOC_EXTS.includes(ext);
}

// CNI — upload pièce d'identité
app.post('/upload/cni', requireAuth, async (req, res) => {
  const { storagePath, userId, filename } = req.body;
  if (!storagePath || !userId) return res.status(400).json({ error: 'Données manquantes' });
  if (req.user.id !== userId) return res.status(403).json({ error: 'Non autorisé' });
  if (!_validateStoragePath(storagePath)) return res.status(400).json({ error: 'Type de fichier non autorisé' });
  try {
    const { data: urlData } = supabase.storage.from('verification').getPublicUrl(storagePath);
    const cniUrl = urlData.publicUrl;
    await supabase.from('profiles').update({
      cni_uploaded: true,
      cni_url: cniUrl,
      statut_compte: 'en_attente_verification'
    }).eq('id', userId);
    res.json({ success: true, url: cniUrl });
  } catch(e) {
    console.log('CNI upload error:', e.message);
    await supabase.from('profiles').update({ cni_uploaded: true }).eq('id', userId).catch(()=>{});
    res.json({ success: true });
  }
});

// DIPLÔME — upload diplôme
app.post('/upload/diplome', requireAuth, async (req, res) => {
  const { storagePath, userId } = req.body;
  if (!storagePath || !userId) return res.status(400).json({ error: 'Données manquantes' });
  if (req.user.id !== userId) return res.status(403).json({ error: 'Non autorisé' });
  if (req.user.role !== 'professeur') return res.status(403).json({ error: 'Réservé aux professeurs' });
  if (!_validateStoragePath(storagePath)) return res.status(400).json({ error: 'Type de fichier non autorisé' });
  try {
    const { data: urlData } = supabase.storage.from('verification').getPublicUrl(storagePath);
    const diplomeUrl = urlData.publicUrl;
    await supabase.from('profiles').update({ diplome_uploaded: true, diplome_url: diplomeUrl, diplome_verifie: false }).eq('id', userId);
    res.json({ success: true, url: diplomeUrl });
  } catch(e) {
    console.log('Diplome upload error:', e.message);
    await supabase.from('profiles').update({ diplome_uploaded: true }).eq('id', userId).catch(()=>{});
    res.json({ success: true });
  }
});

// PROFIL DE CONFIANCE — upload attestation
app.post('/upload/casier', requireAuth, async (req, res) => {
  const { storagePath, userId } = req.body;
  if (!storagePath || !userId) return res.status(400).json({ error: 'Données manquantes' });
  if (req.user.id !== userId) return res.status(403).json({ error: 'Non autorisé' });
  if (req.user.role !== 'professeur') return res.status(403).json({ error: 'Réservé aux professeurs' });
  if (!_validateStoragePath(storagePath)) return res.status(400).json({ error: 'Type de fichier non autorisé' });
  try {
    const { data: urlData } = supabase.storage.from('verification').getPublicUrl(storagePath);
    const casierUrl = urlData.publicUrl;
    await supabase.from('profiles').update({ casier_uploaded: true, casier_url: casierUrl, casier_verifie: false }).eq('id', userId);
    res.json({ success: true, url: casierUrl });
  } catch(e) {
    console.log('Casier upload error:', e.message);
    await supabase.from('profiles').update({ casier_uploaded: true }).eq('id', userId).catch(()=>{});
    res.json({ success: true });
  }
});

app.post('/upload/photo', requireAuth, async (req, res) => {
  const { base64, userId, filename } = req.body;
  if (!base64 || !userId) return res.status(400).json({ error: 'Données manquantes' });
  if (req.user.id !== userId) return res.status(403).json({ error: 'Non autorisé' });
  // Valider le préfixe MIME du base64 — bloque les fichiers non-image déguisés
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(base64)) {
    return res.status(400).json({ error: 'Format d\'image non autorisé (JPG, PNG ou WEBP uniquement)' });
  }
  // Limiter la taille du base64 (500 Ko binary ≈ ~680 Ko base64)
  if (base64.length > 700 * 1024) {
    return res.status(400).json({ error: 'Image trop lourde (500 Ko max)' });
  }
  try {
    const buffer = Buffer.from(base64.split(',')[1], 'base64');
    // Vérification magic bytes — bloque les fichiers déguisés en image
    const magic = buffer.slice(0, 4);
    const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8;
    const isPng  = magic[0] === 0x89 && magic[1] === 0x50;
    const isWebp = magic.toString('ascii', 0, 4) === 'RIFF';
    if (!isJpeg && !isPng && !isWebp) {
      return res.status(400).json({ error: 'Format d\'image invalide' });
    }
    const ext = (filename ? filename.split('.').pop().toLowerCase() : 'jpg').replace('jpeg','jpg');
    const validExt = ['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg';
    const path = userId + '/avatar.' + validExt;
    const contentType = 'image/' + (validExt === 'jpg' ? 'jpeg' : validExt);
    // Essayer d'uploader
    const { error: uploadError } = await supabase.storage.from('photos').upload(path, buffer, { contentType, upsert: true });
    if (uploadError) {
      // Si bucket n'existe pas, sauvegarder en base64 directement dans le profil
      console.log('Storage error:', uploadError.message);
      await supabase.from('profiles').update({ photo_url: base64 }).eq('id', userId);
      return res.json({ url: base64 });
    }
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
    const publicUrl = urlData.publicUrl + '?t=' + Date.now();
    await supabase.from('profiles').update({ photo_url: publicUrl }).eq('id', userId);
    res.json({ url: publicUrl });
  } catch(e) {
    console.log('Upload error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// NOTATIONS — noter un cours
app.post('/notations', requireAuth, async (req, res) => {
  const eleve_id = req.user.id;
  const { professeur_id, cours_id, note, commentaire } = req.body;
  if (!professeur_id || !cours_id || !note) return res.status(400).json({ error: 'Données manquantes' });
  if (parseInt(note) < 1 || parseInt(note) > 5) return res.status(400).json({ error: 'La note doit être entre 1 et 5' });
  try {
    const { data, error } = await supabase.from('notations')
      .upsert([{ eleve_id, professeur_id, cours_id, note, commentaire }], { onConflict: 'eleve_id,cours_id' })
      .select();
    if (error) return res.status(500).json({ error });
    const { data: notes } = await supabase.from('notations').select('note').eq('professeur_id', professeur_id);
    if (notes && notes.length > 0) {
      const moyenne = (notes.reduce((a, b) => a + b.note, 0) / notes.length).toFixed(1);
      await supabase.from('profiles').update({ note_moyenne: moyenne }).eq('id', professeur_id);
      io.to(professeur_id).emit('note_update', { professeur_id, note_moyenne: moyenne });
    }
    res.json(data[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// NOTATIONS — récupérer par prof
app.get('/notations/:professeur_id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('notations').select('*')
      .eq('professeur_id', req.params.professeur_id).order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ============================================================
// PUSH NOTIFICATIONS — web-push VAPID
// ============================================================
let webpush;
try {
  webpush = require('web-push');
  webpush.setVapidDetails(
    'mailto:hello@courspool.com',
    process.env.VAPID_PUBLIC_KEY  || 'BDyXpxjqx8h9llIzLNcaYdMpEX_jbkqEt4fjXOV_bSgENcpW7KaPFUHEjk0uXKT--ZajXK_zAJwgplwNz3j4jA8',
    process.env.VAPID_PRIVATE_KEY
  );
} catch(e) { console.log('web-push non installé:', e.message); }

// Helper : envoyer une notif à un abonnement, silencieux en cas d'erreur
async function sendPushToSub(sub, payload) {
  if (!webpush || !sub) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch(e) {
    // Abonnement expiré → supprimer
    if (e.statusCode === 410 || e.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).catch(() => {});
    }
  }
}

// Helper : envoyer à tous les users d'un rôle
async function broadcastToRole(role, payload) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('role', role);
  if (!subs || !subs.length) return 0;
  await Promise.all(subs.map(s => sendPushToSub({
    endpoint: s.endpoint,
    keys: { auth: s.auth, p256dh: s.p256dh }
  }, payload)));
  return subs.length;
}

// Helper : envoyer à un user spécifique
async function pushToUser(userId, payload) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs || !subs.length) return;
  await Promise.all(subs.map(s => sendPushToSub({
    endpoint: s.endpoint,
    keys: { auth: s.auth, p256dh: s.p256dh }
  }, payload)));
}

// Helper : envoyer à plusieurs users en une seule query (évite N+1)
// Envoie par chunks de 25 pour ne pas saturer webpush
async function pushToUsers(userIds, payload) {
  if (!userIds || !userIds.length) return;
  const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', userIds);
  if (!subs || !subs.length) return;
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(subs.slice(i, i + 25).map(s => sendPushToSub({
      endpoint: s.endpoint,
      keys: { auth: s.auth, p256dh: s.p256dh }
    }, payload)));
  }
}

// PUSH — s'abonner (requireAuth via middleware global)
app.post('/push/subscribe', requireAuth, async (req, res) => {
  const { subscription, role } = req.body;
  const user_id = req.user.id; // toujours l'utilisateur connecté
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Abonnement invalide' });
  try {
    await supabase.from('push_subscriptions').upsert([{
      endpoint: subscription.endpoint,
      auth: subscription.keys?.auth,
      p256dh: subscription.keys?.p256dh,
      user_id,
      role: role || 'inconnu',
      updated_at: new Date().toISOString()
    }], { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUSH — se désabonner
app.delete('/push/subscribe', requireAuth, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id manquant' });
  if (user_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    await supabase.from('push_subscriptions').delete().eq('user_id', user_id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUSH — notif prof : un élève a réservé son cours (admin seulement — l'appel interne est direct via pushToUser)
app.post('/push/prof-new-eleve', requireAdmin, async (req, res) => {
  const { prof_id, eleve_nom, cours_titre, montant } = req.body;
  if (!prof_id) return res.status(400).json({ error: 'prof_id manquant' });
  await pushToUser(prof_id, {
    title: '🎉 Nouvelle réservation !',
    body: `${eleve_nom || 'Un élève'} vient de réserver "${cours_titre}" (+${montant}€)`,
    tag: 'new-eleve',
    icon: '/icon-192.png',
    data: { url: 'https://courspool.vercel.app' }
  });
  res.json({ success: true });
});

// PUSH — notif élève : un prof suivi publie un cours (prof concerné ou admin)
app.post('/push/new-cours', requireAuth, async (req, res) => {
  const { prof_id, cours_titre, cours_id } = req.body;
  if (!prof_id) return res.status(400).json({ error: 'prof_id manquant' });
  if (prof_id !== req.user.id && !isAdmin(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
  try {
    // Récupérer tous les élèves qui suivent ce prof
    const { data: follows } = await supabase.from('follows').select('user_id').eq('professeur_id', prof_id);
    if (!follows || !follows.length) return res.json({ success: true, sent: 0 });
    const { data: profProfile } = await supabase.from('profiles').select('prenom,nom').eq('id', prof_id).single();
    const profNom = profProfile ? (profProfile.prenom + ' ' + (profProfile.nom||'')).trim() : 'Un prof';
    let sent = 0;
    await Promise.all(follows.map(async f => {
      await pushToUser(f.user_id, {
        title: `📚 Nouveau cours de ${profNom}`,
        body: `"${cours_titre}" est disponible — réservez avant que les places partent !`,
        tag: 'new-cours-' + cours_id,
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUSH — broadcast admin → tous les profs ou tous les élèves
app.post('/push/broadcast', requireAdmin, async (req, res) => {
  const { role, title, body, url } = req.body;
  if (!role || !title || !body) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const payload = {
      title,
      body,
      tag: 'broadcast-' + Date.now(),
      icon: '/icon-192.png',
      data: { url: url || 'https://courspool.vercel.app' }
    };
    const sent = await broadcastToRole(role, payload);
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUSH — relance profs inactifs (cron ou manuel via admin)
app.post('/push/relance-profs', requireAdmin, async (req, res) => {
  try {
    // Profs vérifiés qui n'ont pas publié de cours depuis 14 jours
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: profs } = await supabase.from('profiles').select('id').eq('role', 'professeur').eq('verified', true);
    if (!profs || !profs.length) return res.json({ success: true, sent: 0 });
    const { data: recentCours } = await supabase.from('cours').select('professeur_id').gte('created_at', cutoff);
    const activeProfs = new Set((recentCours || []).map(c => c.professeur_id));
    const inactiveProfs = profs.filter(p => !activeProfs.has(p.id));
    let sent = 0;
    await Promise.all(inactiveProfs.map(async p => {
      await pushToUser(p.id, {
        title: '👋 Des élèves vous attendent !',
        body: "Vous n'avez pas publié de cours depuis un moment. Créez un nouveau cours et accueillez de nouveaux élèves.",
        tag: 'relance-prof',
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUSH — relance élèves inactifs
app.post('/push/relance-eleves', requireAdmin, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const { data: eleves } = await supabase.from('profiles').select('id').eq('role', 'eleve');
    if (!eleves || !eleves.length) return res.json({ success: true, sent: 0 });
    const { data: recentRes } = await supabase.from('reservations').select('user_id').gte('created_at', cutoff);
    const activeEleves = new Set((recentRes || []).map(r => r.user_id));
    const inactiveEleves = eleves.filter(e => !activeEleves.has(e.id));
    let sent = 0;
    await Promise.all(inactiveEleves.map(async e => {
      await pushToUser(e.id, {
        title: '📚 De nouveaux cours vous attendent',
        body: "Des professeurs ont publié de nouveaux cours. Explorez les cours disponibles près de chez vous !",
        tag: 'relance-eleve',
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ============================================================
// ROUTES ADMIN — accès restreint (requireAuth + requireAdmin)
// ============================================================

// ADMIN — liste de tous les utilisateurs
app.get('/admin/users', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ADMIN — liste de toutes les réservations
app.get('/admin/reservations', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('reservations').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ADMIN — liste des contacts / messages de support
app.get('/admin/contacts', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ADMIN — marquer un contact comme lu / mettre à jour
app.patch('/admin/contacts/:id', requireAdmin, async (req, res) => {
  const allowed = ['lu'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Aucun champ valide' });
  const { error } = await supabase.from('contacts').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ADMIN — supprimer un contact
app.delete('/admin/contacts/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('contacts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ADMIN — mettre à jour un profil (champs admin uniquement)
app.patch('/admin/users/:id', requireAdmin, async (req, res) => {
  const adminFields = ['verified', 'statut_compte', 'rejection_reason', 'can_retry_cni', 'cni_uploaded', 'diplome_verifie', 'diplome_uploaded', 'casier_verifie', 'casier_uploaded', 'casier_url', 'prenom', 'nom', 'matieres', 'niveau', 'statut', 'bio', 'ville', 'photo_url'];
  const validStatuts = ['actif', 'bloqué', 'rejeté', 'en_attente_verification'];
  const updates = {};
  adminFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (updates.statut_compte && !validStatuts.includes(updates.statut_compte)) {
    return res.status(400).json({ error: 'statut_compte invalide' });
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Aucun champ valide' });
  try {
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Audit log
    const action = updates.verified === true ? 'verify_cni'
      : updates.statut_compte === 'bloqué' ? 'block_user'
      : updates.statut_compte === 'rejeté' ? 'reject_cni'
      : 'update_profile';
    await logAdminAction(req.user.id, action, req.params.id, updates);
    res.json({ success: true, profile: data });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ADMIN — statistiques push subscriptions
app.get('/admin/push-stats', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('push_subscriptions').select('role');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ADMIN — réinitialiser les données de test
app.post('/admin/reset-test-data', requireAdmin, async (req, res) => {
  try {
    await supabase.from('reservations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('cours').update({ places_prises: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Sentry error handler — AVANT le middleware d'erreur custom ────────────
// Capture les erreurs Express transmises via next(err) ou throws non catchés
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Global error middleware — dernier recours pour les routes sans try/catch ──
app.use((err, req, res, next) => {
  console.error('[Express error]', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
});

// Empêcher Railway de redémarrer sur une rejection non gérée
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  if (process.env.SENTRY_DSN) Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

// ── CRON VISIO NOTIFICATIONS ─────────────────────────────────
const _visoNotifSent = new Set();
setInterval(async () => {
  try {
    const now = Date.now();
    const { data: visCours } = await supabase
      .from('cours').select('id,titre,date_iso,professeur_id,visio_url')
      .eq('mode', 'visio').not('date_iso', 'is', null)
      .gte('date_iso', new Date(now - 2 * 60 * 60 * 1000).toISOString())
      .lte('date_iso', new Date(now + 25 * 60 * 60 * 1000).toISOString());
    if (!visCours || !visCours.length) return;
    for (const c of visCours) {
      const start = new Date(c.date_iso).getTime();
      const diff = start - now;
      const heure = new Date(c.date_iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      const { data: resas } = await supabase.from('reservations').select('user_id').eq('cours_id', c.id);
      const studentIds = (resas || []).map(r => r.user_id);
      const allIds = [c.professeur_id, ...studentIds];
      // H-24 : entre 23h50 et 24h10
      if (diff > 23 * 60 * 60 * 1000 + 50 * 60 * 1000 && diff < 24 * 60 * 60 * 1000 + 10 * 60 * 1000) {
        const key = `${c.id}:h24`;
        if (!_visoNotifSent.has(key)) {
          _visoNotifSent.add(key);
          await Promise.all(allIds.map(id => pushToUser(id, {
            title: '📅 Cours en visio demain', body: `"${c.titre}" commence demain à ${heure}`,
            tag: `visio-h24-${c.id}`, icon: '/icon-192.png', data: { url: 'https://courspool.vercel.app' }
          })));
        }
      }
      // H-5 : entre 4m30 et 5m30
      if (diff > 4 * 60 * 1000 + 30 * 1000 && diff < 5 * 60 * 1000 + 30 * 1000) {
        const key = `${c.id}:h5`;
        if (!_visoNotifSent.has(key)) {
          _visoNotifSent.add(key);
          await Promise.all(allIds.map(id => pushToUser(id, {
            title: '🎥 Cours dans 5 minutes !', body: `"${c.titre}" commence dans 5 minutes`,
            tag: `visio-h5-${c.id}`, icon: '/icon-192.png', data: { url: c.visio_url || 'https://courspool.vercel.app' }
          })));
          if (c.visio_url && studentIds.length > 0) {
            const contenu = `🎥 Votre cours "${c.titre}" commence dans 5 minutes !\n\n👉 Rejoindre : ${c.visio_url}`;
            for (const studentId of studentIds) {
              const { data: msg } = await supabase.from('messages')
                .insert({ expediteur_id: c.professeur_id, destinataire_id: studentId, contenu })
                .select().single().catch(() => ({ data: null }));
              if (msg) io.to(studentId).emit('new_message', {
                expediteur_id: c.professeur_id, destinataire_id: studentId,
                id: msg.id, contenu: msg.contenu, created_at: msg.created_at
              });
            }
          }
        }
      }
      // H+0 : entre -60s et +60s
      if (diff > -60 * 1000 && diff < 60 * 1000) {
        const key = `${c.id}:h0`;
        if (!_visoNotifSent.has(key)) {
          _visoNotifSent.add(key);
          await Promise.all(allIds.map(id => pushToUser(id, {
            title: '🎥 Le cours a commencé !', body: `"${c.titre}" est en cours — Rejoignez maintenant !`,
            tag: `visio-h0-${c.id}`, icon: '/icon-192.png', data: { url: c.visio_url || 'https://courspool.vercel.app' }
          })));
        }
      }
    }
  } catch(e) { console.error('[Visio cron]', e.message); }
}, 60 * 1000);

// ── TEACHER ANNOUNCEMENTS ─────────────────────────────────────────────────────
app.get('/teacher/:id/announcements', async (req, res) => {
  try {
    const isFollower = req.user && req.user.id;
    if (!isFollower) return res.status(401).json({ error: 'Non autorisé' });
    const { data, error } = await supabase.from('teacher_announcements')
      .select('*').eq('teacher_id', req.params.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/:id/announcements', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { content, type, title, access_type } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Contenu manquant' });
    const row = { teacher_id: req.params.id, content: content.trim() };
    if (type) row.type = type;
    if (title) row.title = title.trim();
    if (access_type) row.access_type = access_type;
    const { data, error } = await supabase.from('teacher_announcements')
      .insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/teacher/:id/announcements/:ann_id', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { access_type, title, content } = req.body;
    const updates = {};
    if (access_type !== undefined) {
      if (!['enrolled','private','public'].includes(access_type)) return res.status(400).json({ error: 'Valeur invalide' });
      updates.access_type = access_type;
    }
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    const { data, error } = await supabase.from('teacher_announcements')
      .update(updates).eq('id', req.params.ann_id).eq('teacher_id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/teacher/:id/announcements/:ann_id', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { error } = await supabase.from('teacher_announcements')
      .delete().eq('id', req.params.ann_id).eq('teacher_id', req.params.id);
    if (error) return res.status(500).json({ error });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/:id/announcements/:ann_id/vote', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const { option_index } = req.body;
    if (option_index === undefined || typeof option_index !== 'number') return res.status(400).json({ error: 'option_index manquant' });
    const { data: ann, error: fetchErr } = await supabase.from('teacher_announcements')
      .select('content,type').eq('id', req.params.ann_id).single();
    if (fetchErr || !ann) return res.status(404).json({ error: 'Introuvable' });
    if (ann.type !== 'poll') return res.status(400).json({ error: 'Pas un sondage' });
    let poll;
    try { poll = JSON.parse(ann.content); } catch(e) { return res.status(400).json({ error: 'Format invalide' }); }
    if (option_index < 0 || option_index >= (poll.options||[]).length) return res.status(400).json({ error: 'Option invalide' });
    if (!poll.votes) poll.votes = {};
    poll.votes[req.user.id] = option_index;
    const { data, error } = await supabase.from('teacher_announcements')
      .update({ content: JSON.stringify(poll) }).eq('id', req.params.ann_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── TEACHER RESOURCES ─────────────────────────────────────────────────────────
app.get('/teacher/:id/resources', async (req, res) => {
  try {
    const isOwner = req.user && req.user.id === req.params.id;
    let query = supabase.from('teacher_resources').select('*').eq('teacher_id', req.params.id).order('created_at', { ascending: false });
    if (isOwner) {
      // Le prof voit tout
    } else if (req.user && req.user.id) {
      // Élève connecté : voit public + followers, pas private
      query = query.in('access_level', ['public', 'followers']);
    } else {
      // Non connecté : voit uniquement public
      query = query.eq('access_level', 'public');
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/:id/resources', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { title, url, type, access_level } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'Titre et URL requis' });
    const { data, error } = await supabase.from('teacher_resources')
      .insert({ teacher_id: req.params.id, title: title.trim(), url: url.trim(), type: type || 'article', access_level: access_level || 'followers' })
      .select().single();
    if (error) return res.status(500).json({ error });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/teacher/:id/resources/:res_id', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { access_level, title } = req.body;
    const updates = {};
    if (access_level !== undefined) {
      if (!['public','followers','private'].includes(access_level)) return res.status(400).json({ error: 'Valeur invalide' });
      updates.access_level = access_level;
    }
    if (title !== undefined) updates.title = title.trim();
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    const { data, error } = await supabase.from('teacher_resources')
      .update(updates).eq('id', req.params.res_id).eq('teacher_id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/teacher/:id/resources/:res_id', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { error } = await supabase.from('teacher_resources')
      .delete().eq('id', req.params.res_id).eq('teacher_id', req.params.id);
    if (error) return res.status(500).json({ error });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── TEACHER ENROLLMENT ────────────────────────────────────────────────────────
app.get('/teacher/:id/is-enrolled', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const { data, error } = await supabase.from('teacher_students')
      .select('id').eq('teacher_id', req.params.id).eq('student_id', req.user.id).maybeSingle();
    if (error) return res.status(500).json({ error });
    res.json({ enrolled: !!data });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/enroll', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const { teacher_id, code } = req.body;
    if (!code) return res.status(400).json({ error: 'Données manquantes' });
    // Vérifier le code du professeur — résolution par code seul si teacher_id absent
    let prof, profErr;
    if (teacher_id) {
      ({ data: prof, error: profErr } = await supabase.from('profiles')
        .select('id, teacher_code').eq('id', teacher_id).maybeSingle());
    } else {
      ({ data: prof, error: profErr } = await supabase.from('profiles')
        .select('id, teacher_code').eq('teacher_code', code.trim().toUpperCase()).maybeSingle());
    }
    if (profErr || !prof) return res.status(404).json({ error: 'Code introuvable' });
    if (!prof.teacher_code || prof.teacher_code.trim().toUpperCase() !== code.trim().toUpperCase()) {
      return res.status(400).json({ error: 'Code incorrect' });
    }
    const resolvedTeacherId = prof.id;
    // Inscrire l'élève
    const { error: insErr } = await supabase.from('teacher_students')
      .upsert({ teacher_id: resolvedTeacherId, student_id: req.user.id }, { onConflict: 'teacher_id,student_id' });
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.json({ success: true, teacher_id: resolvedTeacherId });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── STUDENT NOTES ─────────────────────────────────────────────────────────────
app.get('/teacher/:id/student-notes/:student_id', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    // accessible par le prof (teacher_id) ou l'élève concerné (student_id)
    if (req.user.id !== req.params.id && req.user.id !== req.params.student_id) return res.status(403).json({ error: 'Non autorisé' });
    const { data, error } = await supabase.from('student_notes')
      .select('*').eq('teacher_id', req.params.id).eq('student_id', req.params.student_id).maybeSingle();
    if (error) return res.status(500).json({ error });
    res.json(data || null);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/:id/student-notes', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorisé' });
    const { student_id, content } = req.body;
    if (!student_id || !content) return res.status(400).json({ error: 'Données manquantes' });
    const { data, error } = await supabase.from('student_notes')
      .upsert({ teacher_id: req.params.id, student_id, content }, { onConflict: 'teacher_id,student_id' })
      .select().single();
    if (error) return res.status(500).json({ error });
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── ESPACE PROFESSEUR — code d'accès + élèves ─────────────────────────────
app.get('/teacher/my-code', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const { data, error } = await supabase.from('profiles')
      .select('teacher_code').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ teacher_code: data?.teacher_code || null });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/teacher/generate-code', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
    const { error } = await supabase.from('profiles').update({ teacher_code: code }).eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ teacher_code: code });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/teacher/my-students', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non autorisé' });
    const { data: rows, error } = await supabase.from('teacher_students')
      .select('student_id, created_at').eq('teacher_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    if (!rows || !rows.length) return res.json([]);
    const ids = rows.map(r => r.student_id);
    const { data: profs } = await supabase.from('profiles')
      .select('id, prenom, nom, photo_url').in('id', ids);
    const profMap = {};
    (profs || []).forEach(p => { profMap[p.id] = p; });
    res.json(rows.map(r => ({
      id: r.student_id,
      prenom: profMap[r.student_id]?.prenom || '',
      nom: profMap[r.student_id]?.nom || '',
      photo_url: profMap[r.student_id]?.photo_url || null,
      enrolled_at: r.created_at,
    })));
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

const PORT = process.env.PORT || 3000;
// ── KEEP-ALIVE anti-cold-start Railway ──
const SELF_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : process.env.SELF_URL || null;
if (SELF_URL) {
  setInterval(async () => {
    try {
      const https = require('https');
      const lib = SELF_URL.startsWith('https') ? https : http;
      lib.get(SELF_URL + '/', () => {}).on('error', () => {});
    } catch(e) {}
  }, 10 * 60 * 1000); // toutes les 10 minutes
  console.log('Keep-alive actif:', SELF_URL);
}

// Timeouts HTTP — protection contre les attaques Slowloris
// (connexions lentes qui gardent le serveur occupé indéfiniment)
server.setTimeout(30000);        // 30s max pour recevoir une requête complète
server.keepAliveTimeout = 65000; // 65s > load balancer Railway (60s) — évite les connexions zombies
server.headersTimeout = 66000;   // légèrement supérieur à keepAliveTimeout

server.listen(PORT, () => {
  console.log('CoursPool API + Socket.io sur le port ' + PORT);
  const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  discordAlert(
    `🟢 **Serveur démarré**\n` +
    `> **Heure :** ${time}\n` +
    `> La blacklist de sessions et les place locks ont été réinitialisés.\n` +
    `> Surveille les 5 prochaines minutes.`
  );
});

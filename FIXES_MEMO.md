# FIXES_MEMO — Audit final CoursPool
Date : 2026-03-26

## 🔴 P1 — CRITIQUES (commit f18a6da)

### Fix 1 — Socket.io auth middleware
**server.js** après ligne 14 (`const io = new Server(...)`)
- Ajout `io.use(async (socket, next) => {...})` qui valide le Bearer token via `supabase.auth.getUser()`
- Chaque connexion non authentifiée est rejetée avec `new Error('unauthorized')`
- `socket.userId` stocke l'ID de l'utilisateur vérifié

### Fix 2 — Socket.io rooms par utilisateur
**server.js** — `io.on('connection', ...)` + remplacement de tous les `io.emit()`
- `socket.join(socket.userId)` à la connexion
- `follow_update` → `io.to(professeur_id).emit()`
- `note_update` → `io.to(professeur_id).emit()`
- `new_message` (direct) → `io.to(destinataire_id).emit()`
- `new_message` (groupe) → `io.to(eleveId).emit()` dans la boucle forEach
- `reservation_update` → gardé `io.emit()` (toutes les vues du cours ont besoin)
- `cours_update` create/delete → gardé `io.emit()` (broadcast public)

**socket.js** client
- Ajout `auth: { token: user.token }` dans les options `io(SOCKET_URL, {...})`

### Fix 3 — /auth/oauth-profile rôle immuable
✅ Déjà correct — le code vérifiait déjà `!existing.role` avant update (ligne 416)

### Fix 4 — admin.html protection
**server.js**
- `const path = require('path')` ajouté
- Middleware bloquer `/admin.html` → redirect 301 vers `/admin`
- Route `GET /admin` avec `requireAuth + requireAdmin` → `res.sendFile('admin.html')`

### Fix 5 — POST /push/subscribe ownership
**server.js**
- `user_id` n'est plus pris du body client
- Forcé à `req.user.id` (utilisateur authentifié via token)
- Route déjà protégée par le middleware global requireAuth

---

## 🟠 P2 (commit e98919f)

### Fix 6 — Calcul prix équitable
**server.js** — lignes `/stripe/checkout` et `/stripe/payment-intent`
- `Math.ceil(prix/places)` → `Math.round((prix/places)*100)/100`
- Le prof absorbe les éventuels centimes de différence

### Fix 7 — Validation longueur inputs
**server.js**
- `POST /auth/register` : prenom max 50 chars, nom max 50 chars
- `POST /messages` : contenu max 2000 chars
- `POST /messages/groupe` : contenu max 2000 chars
- `PATCH /profiles` : bio max 500, ville max 100, prenom max 50, nom max 50

### Fix 8 — /reservations/ami ownership
**server.js** endpoint `POST /reservations/ami`
- `user_id` du body ignoré → forcé à `req.user.id`

### Fix 9 — PUT /messages/lu vérification receiver
**server.js** endpoint `PUT /messages/lu/:user_id`
- Ajout check `req.params.user_id !== req.user.id → 403`

### Fix 10 — eleves_peuvent_ecrire dans groupe
**server.js** endpoint `POST /messages/groupe`
- Récupère `cours.professeur_id` et `cours.eleves_peuvent_ecrire`
- Si l'expéditeur n'est pas le prof ET `eleves_peuvent_ecrire` est false → 403

### Fix 11 — XSS photo_url
**www/app.js** (aussi app.js racine)
- Toutes les injections directes `tav.innerHTML='<img src="'+user.photo+'"...'`
  remplacées par `setAvatar(el, photo, ini, col)` qui utilise `esc()` en interne
- Lignes concernées : applyUser (tav + tavMob), navTo (tavMob), goAccount (accAv),
  updateProfileUI (accAv), saveProfileChanges (tav + tavMob + accAv)

---

## 🟡 P3 (commit 09d23db)

### Fix 12 — Infinite scroll
**www/app.js** — dans `initLargeTitle()` scroll listener
- Ajout détection : `scrollTop + clientHeight >= scrollHeight - 200`
- Appelle `loadMore()` si `!_allLoaded && !_loadingMore`
- `loadMore()` et `_allLoaded` existaient déjà, manquait uniquement le trigger auto

### Fix 13 — Audit log admin
**server.js**
- Fonction `logAdminAction(adminId, action, targetId, details)` insère dans `admin_logs`
- Appelée après : `DELETE /users` (delete_user), `PATCH /admin/users` (verify_cni / block_user / reject_cni / update_profile), endpoint reject CNI (rejected_retry / rejected_final)

### Fix 14 — Confirmation suppression admin
✅ Déjà implémenté — `deleteUser()` dans admin.html utilisait déjà `confirm()` (ligne 1123)

### Fix 15 — Cache profils invalidation socket
**socket.js**
- Event `follow_update` : `delete P[pid]` avant mise à jour UI
- Event `note_update` : `delete P[pid]` avant mise à jour UI

### Fix 16 — Splash screen timing iOS
**www/app.js** — DOMContentLoaded handler
- Remplacé `setTimeout(_hideSplash, 800)` par un wrapper sur `loadData()`
- `_hideSplash()` appelée dans `.finally()` après le premier `loadData()`
- Fallback `setTimeout(_hideSplash, 3000)` pour éviter tout blocage

### Fix 17 — Clavier iOS
**capacitor.config.json**
- Ajout plugin Keyboard : `resize: "body"`, `style: "dark"`, `resizeOnFullScreen: true`

---

## ⚠️ ACTIONS MANUELLES REQUISES

### 1. Créer la table admin_logs dans Supabase
Le fix 13 écrit dans `admin_logs` — la table doit exister :
```sql
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
→ Supabase Dashboard → SQL Editor → coller et exécuter

### 2. Déployer server.js sur Railway
Tous les fixes P1/P2/P3 côté serveur sont dans `server.js`.
Le code est pushé sur GitHub. Si Railway est branché sur le repo :
déploiement automatique. Sinon, trigger manuel depuis Railway Dashboard.

### 3. Vérifier Google OAuth (non résolu)
Le titre OAuth affiche l'URL Supabase au lieu de "CoursPool".
Cause probable : app en mode Test dans Google Cloud Console.
→ Google Cloud Console → OAuth consent screen → vérifier "Publishing status" = Production

### 4. SUPABASE_ANON_KEY sur Railway
Si l'OAuth n'est pas encore fonctionnel :
→ Railway Dashboard → Variables → ajouter `SUPABASE_ANON_KEY` avec la clé "anon public"
   (Supabase Dashboard → Settings → API → Project API keys)

---

## COMMITS

| Hash | Description |
|------|-------------|
| `f18a6da` | fix(p1): socket.io auth+rooms, admin protection, push ownership |
| `e98919f` | fix(p2): pricing, validation, ownership, groupe, XSS photo |
| `09d23db` | fix(p3): audit log, socket cache, splash timing, keyboard, infinite scroll |

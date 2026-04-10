# Plan de réponse à incident — CoursPool

## Détection (automatique)

Les alertes Discord arrivent en temps réel sur :
- `#security-alertes` — tentatives de login bloquées, accès admin non autorisé, abus rate limit
- `#stripe-alertes` — échec paiement, webhook invalide, remboursement
- `#supabase-alertes` — changement de rôle ou statut compte suspect
- `#vercel` — déploiement échoué
- `#uptime` — site down

---

## Procédure selon le type d'incident

### Breach de données (accès non autorisé à la BDD)

1. **Dans l'heure** — Révoquer la `service_role` key Supabase et en générer une nouvelle
2. **Dans l'heure** — Changer les variables d'env Railway (SUPABASE_SECRET_KEY, JWT_SECRET)
3. **Dans les 24h** — Identifier quelles données ont été exposées (logs Railway)
4. **Dans les 72h** — Notifier la CNIL (voir section CNIL ci-dessous)
5. **Dans les 72h** — Notifier les utilisateurs concernés par email

### Clé API / token exposé dans le code

1. **Immédiatement** — Révoquer la clé sur la plateforme concernée (Stripe, Supabase, etc.)
2. **Dans l'heure** — Générer une nouvelle clé, mettre à jour Railway env vars
3. **Redéployer** Railway pour prendre en compte les nouvelles variables
4. Vérifier dans git log que la clé n'est plus présente (`git log -S "sk_live_..."`)

### Paiement frauduleux / compte compromis

1. Suspendre le compte via dashboard admin (changer `statut_compte` → `suspendu`)
2. Rembourser manuellement les transactions suspectes depuis le dashboard Stripe
3. Contacter l'utilisateur concerné

### Site down (Railway)

1. Vérifier les logs Railway → onglet Deployments
2. Si redéploiement nécessaire : trigger manual deploy depuis Railway
3. En dernier recours : rollback vers le dernier déploiement stable

---

## Contacts d'urgence

| Plateforme | Action urgente |
|---|---|
| Supabase | dashboard.supabase.com → Settings → API → Regenerate |
| Railway | railway.app → Variables → modifier |
| Stripe | dashboard.stripe.com → Developers → API keys → Roll |
| Vercel | vercel.com → Settings → Environment Variables |
| GitHub | github.com → Settings → Secrets → Update |

---

## Notification CNIL (point 25)

**Obligation légale** : tout breach affectant des données personnelles doit être notifié à la CNIL **dans les 72h**.

- Portail de notification : **notifications.cnil.fr**
- Informations à préparer : nature des données exposées, nombre d'utilisateurs concernés, mesures prises
- Si le risque pour les personnes est élevé : notifier aussi les utilisateurs directement

Seuil : si < 100 utilisateurs affectés et données non sensibles → notification CNIL suffit, pas d'obligation de notifier les utilisateurs. Au-delà ou si données sensibles (CNI, données bancaires) → double notification obligatoire.

// ── Sentry — monitoring des erreurs frontend ─────────────────────────────
// DSN défini via window.SENTRY_DSN dans index.html.
// Ne jamais hardcoder le DSN dans ce fichier.
(function() {
  'use strict';
  var dsn = window.SENTRY_DSN;
  if (!dsn || typeof Sentry === 'undefined') return;

  Sentry.init({
    dsn: dsn,
    environment: window.location.hostname === 'courspool.vercel.app' ? 'production' : 'development',
    tracesSampleRate: 0.0, // Pas de tracing perf côté frontend
    beforeSend: function(event) {
      // Masquer les headers sensibles
      if (event.request) {
        if (event.request.headers) {
          ['authorization', 'Authorization', 'cookie', 'Cookie'].forEach(function(h) {
            delete event.request.headers[h];
          });
        }
        // Ne jamais envoyer le corps de requête (tokens, mots de passe, CNI, IBAN)
        delete event.request.data;
      }
      return event;
    },
    // Ignorer les erreurs bénignes ou injectées par extensions navigateur
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Loading chunk/,
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
    ],
  });

  // Tag plateforme : web ou iOS (Capacitor WebView)
  Sentry.setTag(
    'platform',
    (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
      ? 'ios'
      : 'web'
  );

  window._sentryReady = true;
})();

// ── Contexte utilisateur ──────────────────────────────────────────────────
// Appeler après login / logout. Ne jamais passer email, token ni CNI.
function setSentryUser(userData) {
  if (typeof Sentry === 'undefined' || !window._sentryReady) return;
  if (!userData) { Sentry.setUser(null); return; }
  Sentry.setUser({
    id:   userData.id   || null,
    role: userData.role || null,
  });
}

// ── Capture explicite ─────────────────────────────────────────────────────
// Utiliser dans les catch blocks critiques (paiement, login, annulation…).
function sentryCaptureException(err, extras) {
  if (typeof Sentry === 'undefined' || !window._sentryReady) return;
  var error = err instanceof Error ? err : new Error(String(err));
  if (extras && typeof extras === 'object') {
    Sentry.withScope(function(scope) {
      Object.keys(extras).forEach(function(k) { scope.setExtra(k, extras[k]); });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

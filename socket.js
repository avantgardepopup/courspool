// ── Socket.io client — connexion unique ──────────────────────────────────────
var _socket = null;
var SOCKET_URL = 'https://devoted-achievement-production-fdfa.up.railway.app';
var _socketRefreshing = false;    // guard : un seul refresh à la fois
var _socketUnauthorized = 0;      // compteur d'échecs unauthorized consécutifs

function initSocket() {
  // Déjà connecté ou en cours de connexion
  if (_socket && (_socket.connected || _socket.connecting)) return;

  // Bibliothèque pas encore chargée — retry dans 2s
  if (typeof io === 'undefined') {
    console.warn('[Socket] io non disponible, retry dans 2s…');
    setTimeout(initSocket, 2000);
    return;
  }

  // Si ancien socket déconnecté, le nettoyer
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); _socket = null; }

  _socketUnauthorized = 0;
  _socketRefreshing = false;

  _socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 15000,
    reconnectionAttempts: 10,
    timeout: 10000,
    // Fonction évaluée à chaque tentative → utilise toujours le token courant
    auth: function(cb) {
      cb({ token: (typeof user !== 'undefined' && user && user.token) ? user.token : '' });
    }
  });

  _socket.on('connect', function() {
    console.log('[Socket] ✅ connecté — id:', _socket.id);
    _socketUnauthorized = 0;
    _socketRefreshing = false;
  });

  _socket.on('disconnect', function(reason) {
    console.log('[Socket] ❌ déconnecté — raison:', reason);
    // socket.io se reconnecte automatiquement selon reconnectionAttempts
  });

  _socket.on('connect_error', function(err) {
    console.warn('[Socket] ⚠️ erreur connexion:', err.message);
    if (err.message === 'unauthorized') {
      _socketUnauthorized++;
      // Après 3 échecs consecutifs, arrêter définitivement pour éviter le flood
      if (_socketUnauthorized >= 3) {
        _socket.io.reconnection(false);
        console.warn('[Socket] arrêt reconnexion — trop d\'échecs unauthorized');
        return;
      }
      // Un seul refresh en cours à la fois — évite le flood de requêtes Supabase
      if (_socketRefreshing) return;
      _socketRefreshing = true;
      if (typeof _refreshToken === 'function') {
        _refreshToken().then(function() {
          _socketRefreshing = false;
          // Le socket.io retente automatiquement avec la fonction auth()
          // qui retournera le nouveau token mis à jour par _refreshToken
        }).catch(function() {
          _socketRefreshing = false;
        });
      } else {
        _socketRefreshing = false;
      }
    }
  });

  _socket.on('reconnect', function(attempt) {
    console.log('[Socket] 🔄 reconnecté après', attempt, 'tentative(s)');
  });

  // ── follow_update : nb_eleves en temps réel ──────────────────────────────
  _socket.on('follow_update', function(data) {
    console.log('[Socket] follow_update reçu:', data);
    var pid = data.professeur_id;
    if (!pid) return;
    // Mettre à jour le count sans effacer nm/photo (évite les "undefined" dans la liste suivi)
    if (typeof P !== 'undefined') {
      if (!P[pid]) P[pid] = { n: '—', e: 0, col: 'linear-gradient(135deg,#FF8C55,#E04E10)' };
      P[pid].e = data.nb_eleves;
      delete P[pid]._fresh; // invalide le cache → prochain _fetchProf ira chercher les données
    }
    // Modal profil prof ouverte sur ce prof (affichage visiteur)
    if (typeof curProf !== 'undefined' && curProf == pid) {
      var mpE = document.getElementById('mpE');
      if (mpE) mpE.textContent = data.nb_eleves;
    }
    // Mise à jour directe de la stat sur la page profil du prof lui-même
    if (user && user.id === pid) {
      user.nbEleves = data.nb_eleves;
      // Mise à jour chirurgicale — fonctionne même si pgAcc est partiellement hors-écran
      var statEl = document.getElementById('accStatElevesVal');
      if (statEl) {
        statEl.textContent = data.nb_eleves;
        console.log('[Socket] accStatElevesVal mis à jour →', data.nb_eleves);
      }
      // Rebuild complet uniquement si la page est active (màj les autres sections aussi)
      var pgAcc = document.getElementById('pgAcc');
      if (pgAcc && pgAcc.classList.contains('on') && typeof buildAccLists === 'function') buildAccLists();
    }
    if (typeof _saveFollowCount === 'function') _saveFollowCount(pid, data.nb_eleves);
  });

  // ── cours_update : ajout / suppression en temps réel ────────────────────
  _socket.on('cours_update', function(data) {
    console.log('[Socket] cours_update reçu:', data.action, data.cours_id || (data.cours && data.cours.id));
    if (data.action === 'create' && data.cours) {
      var c = data.cours;
      if (!C.find(function(x) { return x.id == c.id; })) {
        C.unshift({
          id: c.id, subj: c.sujet || 'Autre', title: c.titre || '',
          dt: c.date_heure || '', dt_iso: c.date_iso || '', lc: c.lieu || '',
          tot: c.prix_total || 0, sp: c.places_max || 5, fl: 0,
          pr: c.professeur_id, prof_ini: c.prof_initiales || '?',
          prof_nm: c.prof_nom || '', prof_photo: c.prof_photo || null,
          niveau: c.niveau || '', mode: c.mode || '', emoji: c.emoji || ''
        });
      }
    } else if (data.action === 'delete' || data.action === 'cancel') {
      var idx = C.findIndex(function(x) { return x.id == data.cours_id; });
      if (idx !== -1) C.splice(idx, 1);
      if (typeof curId !== 'undefined' && curId == data.cours_id && typeof closeM === 'function') {
        closeM('bdR');
      }
    }
    if (typeof applyFilter === 'function') applyFilter();
    if (typeof buildAccLists === 'function') buildAccLists();
  });

  // ── reservation_update : places restantes en temps réel ─────────────────
  _socket.on('reservation_update', function(data) {
    console.log('[Socket] reservation_update reçu:', data.cours_id, '→', data.places_prises, 'places');
    var c = C.find(function(x) { return x.id == data.cours_id; });
    if (!c) return;
    c.fl = data.places_prises;
    // Mise à jour ciblée des cercles places sur la card (évite le re-render complet)
    var cardEl = document.querySelector('[data-cours-id="' + data.cours_id + '"]');
    if (cardEl) {
      var circlesWrap = cardEl.querySelector('.card-circles-wrap');
      if (circlesWrap && typeof buildPlacesCircles === 'function') {
        circlesWrap.innerHTML = buildPlacesCircles(c.fl, c.sp);
      }
    }
    if (typeof curId !== 'undefined' && curId == data.cours_id) {
      var restant = c.sp - c.fl;
      var rPlaces = document.getElementById('rPlaces');
      if (rPlaces) rPlaces.textContent = restant > 0
        ? restant + ' place' + (restant > 1 ? 's' : '') + ' restante' + (restant > 1 ? 's' : '')
        : 'Complet';
      var rFull = document.getElementById('rFull');
      if (rFull) rFull.style.display = (c.fl >= c.sp) ? 'block' : 'none';
      var rConfBtn = document.getElementById('rConfBtn');
      if (rConfBtn) rConfBtn.disabled = (c.fl >= c.sp);
    }
  });

  // ── new_message : injection DOM directe ou badge non lu ─────────────────
  _socket.on('new_message', function(data) {
    console.log('[Socket] new_message reçu:', data.expediteur_id, '→', data.destinataire_id);
    if (!user || !user.id) return;
    var isForMe = data.destinataire_id === user.id;
    var isFromMe = data.expediteur_id === user.id;
    if (!isForMe && !isFromMe) return;

    var pgMsg = document.getElementById('pgMsg');
    var convOpen = pgMsg && pgMsg.classList.contains('on');
    var otherId = isFromMe ? data.destinataire_id : data.expediteur_id;
    var inCurrentConv = typeof msgDestId !== 'undefined' && msgDestId === otherId;

    // Injection directe dans le DOM si la conversation est ouverte et le payload est complet
    if (convOpen && inCurrentConv && data.id && data.contenu && data.created_at) {
      var box = document.getElementById('msgMessages');
      if (box) {
        var wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        var isMe = data.expediteur_id === user.id;
        var d = new Date(data.created_at);
        var time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        var txt = data.contenu || '';
        var safe = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var avHtml = '';
        if (!isMe) {
          var op = (typeof P !== 'undefined' && P[msgDestId]) || {};
          var oPhoto = op.photo || null;
          var oIni = op.i || (typeof msgDestinataire !== 'undefined' && msgDestinataire && msgDestinataire[0]) || '?';
          var oCol = op.col || 'linear-gradient(135deg,#FF8C55,var(--ord))';
          avHtml = '<div class="msg-bubble-av" style="background:' + oCol + '">'
            + (oPhoto ? '<img src="' + oPhoto + '" style="width:100%;height:100%;object-fit:cover">' : oIni)
            + '</div>';
        }
        var bubble = '<div class="msg-bubble-row ' + (isMe ? 'me' : 'them') + '">'
          + (isMe ? '' : avHtml)
          + '<div class="msg-bubble ' + (isMe ? 'me' : 'them') + '">'
          + '<div style="white-space:pre-wrap">' + safe + '</div>'
          + '<div class="msg-bubble-time ' + (isMe ? 'me' : 'them') + '">' + time + '</div>'
          + '</div>'
          + '</div>';
        box.insertAdjacentHTML('beforeend', bubble);
        if (wasAtBottom) box.scrollTop = box.scrollHeight;
        return; // badge inutile, message visible
      }
    }

    // Fallback : badge si la conversation n'est pas ouverte
    if (isForMe) {
      if (!convOpen || !inCurrentConv) {
        var badge = document.getElementById('bnavBadge');
        if (badge) { badge.classList.add('on'); badge.textContent = ''; }
        var msgBadge = document.getElementById('msgBadge');
        if (msgBadge) msgBadge.style.display = 'flex';
      }
    }
  });

  // ── diplome_update : validation diplôme en temps réel ───────────────────
  _socket.on('diplome_update', function(data) {
    console.log('[Socket] diplome_update reçu:', data.professeur_id, '→', data.diplome_verifie);
    if (!user || user.id !== data.professeur_id) return;
    user.diplome_verifie = data.diplome_verifie;
    if (!data.diplome_verifie) user.diplome_uploaded = false;
    try { localStorage.setItem('cp_user', JSON.stringify(user)); } catch(e) {}
    // Badge sur la page profil du prof
    var dvB = document.getElementById('mpDiplomeBadge');
    if (dvB) dvB.style.display = data.diplome_verifie ? 'block' : 'none';
    // Bloc statut diplôme dans les paramètres
    if (typeof updateDiplomeStatusBlock === 'function') updateDiplomeStatusBlock();
    if (typeof updateVerifBand === 'function') updateVerifBand();
    if (data.diplome_verifie) {
      if (typeof toast === 'function') toast('Diplôme vérifié !', 'Le badge est maintenant visible sur votre profil');
      if (typeof haptic === 'function') haptic([10, 50, 100, 50, 10]);
    }
  });

  // ── casier_update : validation profil de confiance en temps réel ────────
  _socket.on('casier_update', function(data) {
    console.log('[Socket] casier_update reçu:', data.professeur_id, '→', data.casier_verifie);
    if (!user || user.id !== data.professeur_id) return;
    user.casier_verifie = data.casier_verifie;
    if (!data.casier_verifie) user.casier_uploaded = false;
    try { localStorage.setItem('cp_user', JSON.stringify(user)); } catch(e) {}
    var cvB = document.getElementById('mpCasierBadge');
    if (cvB) cvB.style.display = data.casier_verifie ? 'block' : 'none';
    if (typeof updateCasierStatusBlock === 'function') updateCasierStatusBlock();
    if (data.casier_verifie) {
      if (typeof toast === 'function') toast('Profil de confiance !', 'Le badge est maintenant visible sur votre profil');
      if (typeof haptic === 'function') haptic([10, 50, 100, 50, 10]);
    }
  });

  // ── Tableau blanc collaboratif ───────────────────────────────────────────
  // Temps réel : trait en cours d'un autre utilisateur
  _socket.on('board_stroke_start', function(d) {
    if (typeof _brdOnRemoteStrokeStart === 'function') _brdOnRemoteStrokeStart(d);
  });
  _socket.on('board_pt', function(d) {
    if (typeof _brdOnRemotePt === 'function') _brdOnRemotePt(d);
  });
  _socket.on('board_stroke_end', function(d) {
    if (typeof _brdOnRemoteStrokeEnd === 'function') _brdOnRemoteStrokeEnd(d);
  });
  _socket.on('board_op', function(op) {
    if (typeof _brdApplyRemoteOp === 'function') _brdApplyRemoteOp(op);
  });
  _socket.on('board_sync', function(data) {
    if (typeof _brdOnSync === 'function') _brdOnSync(data);
  });
  _socket.on('board_perm', function(data) {
    if (typeof _brdOnPerm === 'function') _brdOnPerm(data);
  });
  _socket.on('board_participant_joined', function(data) {
    if (typeof _brdOnParticipantJoined === 'function') _brdOnParticipantJoined(data);
  });
  _socket.on('board_participant_left', function(data) {
    if (typeof _brdOnParticipantLeft === 'function') _brdOnParticipantLeft(data);
  });

  // ── note_update : note moyenne en temps réel ────────────────────────────
  _socket.on('note_update', function(data) {
    console.log('[Socket] note_update reçu:', data.professeur_id, '→', data.note_moyenne);
    var pid = data.professeur_id;
    // Invalider le cache profil
    if (typeof P !== 'undefined' && P[pid]) delete P[pid];
    var nm = data.note_moyenne ? parseFloat(data.note_moyenne).toFixed(1) : null;
    if (!pid || !nm) return;
    // Modal profil prof ouverte (visiteur)
    if (typeof curProf !== 'undefined' && curProf == pid) {
      var mpN = document.getElementById('mpN');
      if (mpN) mpN.textContent = '★ ' + nm;
    }
    // Mise à jour directe sur la page profil du prof lui-même
    if (user && user.id === pid) {
      user.noteMoyenne = nm;
      var noteEl = document.getElementById('accStatNoteVal');
      if (noteEl) noteEl.textContent = '★\u00a0' + nm;
      var pgAcc = document.getElementById('pgAcc');
      if (pgAcc && pgAcc.classList.contains('on') && typeof buildAccLists === 'function') buildAccLists();
    }
  });
}

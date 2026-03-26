// ============================================================
// ONBOARDING — une seule fois à la première visite
// ============================================================
var obCurrent=0,obTotal=4,obTouchStartX=0;

function obShow(){
  try{
    var seen=localStorage.getItem('cp_onboarding_done');
    if(seen) return; // déjà vu, on skip
  }catch(e){}
  var ob=g('onboarding');
  if(ob){ob.classList.remove('hidden');ob.classList.add('active');}
  obRender();
  // Swipe support mobile
  var track=g('obTrack');
  if(track){
    track.addEventListener('touchstart',function(e){obTouchStartX=e.touches[0].clientX;},{passive:true});
    track.addEventListener('touchend',function(e){
      var dx=e.changedTouches[0].clientX-obTouchStartX;
      if(Math.abs(dx)>50){if(dx<0)obNext();else if(obCurrent>0){obCurrent--;obRender();}}
    },{passive:true});
  }
}

function obRender(){
  var track=g('obTrack');
  if(track) track.style.transform='translateX(-'+(obCurrent*100)+'vw)';
  var dots=g('obDots');
  if(dots){
    var ds=dots.querySelectorAll('.ob-dot');
    ds.forEach(function(d,i){d.classList.toggle('on',i===obCurrent);});
  }
  var btn=g('obBtn');
  if(btn) btn.textContent=obCurrent===obTotal-1?'Commencer 🎉':'Continuer';
  var skip=g('obSkip');
  if(skip) skip.style.opacity=obCurrent===obTotal-1?'0':'1';
}

function obNext(){
  if(obCurrent<obTotal-1){
    obCurrent++;obRender();
  } else {
    obDone();
  }
}

function obSkip(){
  obDone();
}

function obDone(){
  try{localStorage.setItem('cp_onboarding_done','1');}catch(e){}
  var ob=g('onboarding');
  if(ob){
    ob.style.transition='opacity .4s ease';
    ob.style.opacity='0';
    setTimeout(function(){ob.classList.add('hidden');ob.classList.remove('active');ob.style.opacity='';ob.style.transition='';},400);
  }
  // Tuto spotlight pour visiteurs sans compte
  setTimeout(function(){
    if(!user||user.guest){
      _tutoSteps=TUTO_ELEVE_STEPS;
      // Reprendre au step sauvegardé si existe
      try{
        var saved=localStorage.getItem('cp_tuto_step_guest');
        _tutoIdx=saved?Math.min(parseInt(saved),_tutoSteps.length-1):0;
      }catch(e){_tutoIdx=0;}
      _tutoShow();
    }
  },700);
}

var _isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
// Détection synchrone du retour OAuth (avant tout init async)
var _isOAuthReturn=window.location.hash.indexOf('access_token')!==-1||window.location.search.indexOf('code=')!==-1;

// Lancer l'onboarding au chargement
function _hideSplash(){
  var sp=document.getElementById('splash');
  if(sp){sp.style.opacity='0';setTimeout(function(){sp.style.display='none';},500);}
}
window.addEventListener('DOMContentLoaded',function(){
  initDarkMode();
  initLargeTitle();
  if(!_isOAuthReturn)_initSupabase(); // déjà appelé dans le IIFE si retour OAuth
  // Masquer le splash après loadData (ou max 3s pour éviter blocage)
  var _splashTimer=setTimeout(_hideSplash,3000);
  var _origLoadData=loadData;
  loadData=function(){
    return _origLoadData.apply(this,arguments).finally(function(){
      clearTimeout(_splashTimer);_hideSplash();
      loadData=_origLoadData; // restaurer après premier appel
    });
  };
});

// Bouton retour Android / browser — naviguer à l'onglet précédent
window.addEventListener('popstate',function(e){
  var tab=(e.state&&e.state.tab)||'exp';
  navTo(tab,true);
});

var API='https://devoted-achievement-production-fdfa.up.railway.app';

// En-têtes API — injecte le token Bearer si l'utilisateur est connecté
function apiH(extra){
  var h=Object.assign({'Content-Type':'application/json'},extra||{});
  if(user&&user.token)h['Authorization']='Bearer '+user.token;
  return h;
}

// ── Refresh token automatique ──────────────────────────────
var _refreshTimer=null;
function _scheduleTokenRefresh(){
  if(_refreshTimer){clearTimeout(_refreshTimer);_refreshTimer=null;}
  if(!user||!user.refresh_token||!user.token_exp)return;
  var msLeft=(user.token_exp-Math.floor(Date.now()/1000)-120)*1000; // 2 min avant expiry
  if(msLeft<0)msLeft=0;
  _refreshTimer=setTimeout(_refreshToken,msLeft);
}
async function _refreshToken(){
  if(!user||!user.refresh_token)return;
  try{
    var r=await fetch(API+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:user.refresh_token})});
    if(!r.ok)return;
    var d=await r.json();
    if(d.access_token){
      user.token=d.access_token;
      if(d.refresh_token)user.refresh_token=d.refresh_token;
      if(d.expires_at)user.token_exp=d.expires_at;
      try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
      _scheduleTokenRefresh();
      console.log('[Auth] token rafraîchi, expire à',new Date(user.token_exp*1000).toLocaleTimeString());
    }
  }catch(e){console.warn('[Auth] refresh échoué:',e.message);}
}

// Échappement HTML — protège tous les innerHTML contre les injections XSS
function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmtDt(dt){
  if(!dt)return'';
  if(dt.indexOf('T')<0)return dt;
  try{
    var d=new Date(dt);
    if(isNaN(d.getTime()))return dt;
    var days=['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
    var months=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    var h=('0'+d.getHours()).slice(-2),m=('0'+d.getMinutes()).slice(-2);
    return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' · '+h+':'+m;
  }catch(e){return dt;}
}

// Avatar — affiche une photo ou un rond avec initiales (évite la duplication)
function setAvatar(el,photo,ini,col){
  if(!el)return;
  if(photo){el.style.background='none';el.innerHTML='<img src="'+esc(photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';}
  else{el.style.background=col||'linear-gradient(135deg,#FF8C55,var(--ord))';el.textContent=ini||'?';}
}

// Badge sera mis à jour après chargement des follows
var C=[],P={},res={},fol=new Set(),favCours=new Set();
// Charger les favoris cours depuis localStorage dès le démarrage (APRÈS l'init de favCours)
loadFavCours();
// Pré-charger les réservations depuis localStorage pour éviter le flash "Réserver" au rendu initial
(function(){try{var _sr=JSON.parse(localStorage.getItem('cp_res')||'[]');_sr.forEach(function(id){res[id]=true;});}catch(e){}})();
// Pré-peupler P[] avec les profils mis en cache pour éviter le flash au chargement
// NE PAS mettre _fresh=true ici : _fetchProf doit toujours tourner pour vérifier les données
(function(){
  try{
    var _pc=JSON.parse(localStorage.getItem('cp_profs')||'{}');
    var _now=Date.now();
    Object.keys(_pc).forEach(function(pid){
      var e=_pc[pid];
      if(_now-e.ts<3600000){
        P[pid]=P[pid]||{n:'—',e:0};
        if(e.nm)P[pid].nm=e.nm;
        if(e.i)P[pid].i=e.i;
        if(e.photo)P[pid].photo=e.photo;
        if(e.e)P[pid].e=e.e;
        // _fresh intentionnellement absent : _fetchProf vérifiera et mettra à jour si besoin
      }
    });
  }catch(ex){}
  // Restaurer les compteurs de suivis (clé sans TTL — persiste même si cp_profs expire)
  try{
    var _fc=JSON.parse(localStorage.getItem('cp_follow_counts')||'{}');
    Object.keys(_fc).forEach(function(pid){
      if(_fc[pid]>0){P[pid]=P[pid]||{n:'—',e:0};if(!P[pid].e||P[pid].e<_fc[pid])P[pid].e=_fc[pid];}
    });
  }catch(ex){}
})();

// ── FAVORIS COURS — persistance localStorage ──
// Sauvegarder le compteur de suivis d'un prof — clé sans TTL pour persister même après expiration de cp_profs
function _saveFollowCount(pid,n){try{var _fc=JSON.parse(localStorage.getItem('cp_follow_counts')||'{}');_fc[pid]=n||0;localStorage.setItem('cp_follow_counts',JSON.stringify(_fc));}catch(ex){}}

function loadFavCours(){
  try{
    var saved=localStorage.getItem('cp_fav_cours');
    if(saved){JSON.parse(saved).forEach(function(id){favCours.add(id);});}
  }catch(e){}
}
function saveFavCours(){
  try{localStorage.setItem('cp_fav_cours',JSON.stringify(Array.from(favCours)));}catch(e){}
  updateFavBadge();
}

function updateFavBadge(){
  var total=favCours.size;
  var badge=g('bnavFavBadge');
  if(!badge)return;
  if(total>0){badge.style.display='flex';badge.textContent=total>9?'9+':String(total);}
  else{badge.style.display='none';}
}
function toggleFavCours(coursId,btn){
  if(!user||user.guest){
    toast('Connectez-vous pour sauvegarder des cours','');
    setTimeout(scrollToLogin,800);
    return;
  }
  var wasSaved=favCours.has(coursId);
  if(wasSaved){
    favCours.delete(coursId);
    toast('Retiré des favoris','');
  } else {
    favCours.add(coursId);
    toast('Cours sauvegardé','Retrouvez-le dans vos favoris');
  }
  saveFavCours();
  haptic(wasSaved?4:12);
  // Animate button
  if(btn){
    btn.classList.toggle('saved',!wasSaved);
    btn.classList.add('popping');
    setTimeout(function(){btn.classList.remove('popping');},400);
  }
  // Update all heart buttons for this course across all cards
  document.querySelectorAll('[data-cours-id="'+coursId+'"] .card-heart-btn').forEach(function(b){
    b.classList.toggle('saved',!wasSaved);
  });
}

// ── BUILD PAGE FAVORIS ──
function buildFavPage(){
  var favIds=Array.from(favCours);
  var folIds=Array.from(fol);
  var hasAny=favIds.length||folIds.length;

  var emptyAll=g('favEmptyAll');
  var coursSection=g('favCoursSection');
  var profsSection=g('favProfsSection');
  if(!hasAny){
    if(emptyAll){emptyAll.style.display='flex';emptyAll.style.flexDirection='column';emptyAll.style.alignItems='center';emptyAll.style.justifyContent='center';emptyAll.style.minHeight='60vh';}
    if(coursSection)coursSection.style.display='none';
    if(profsSection)profsSection.style.display='none';
    return;
  }
  if(emptyAll)emptyAll.style.display='none';

  // ── Carrousel cours sauvegardés ──
  var carousel=g('favCoursCarousel');
  if(carousel){
    if(!favIds.length){
      if(coursSection)coursSection.style.display='none';
    } else {
      if(coursSection)coursSection.style.display='block';
      carousel.innerHTML=favIds.map(function(id){
        var c=C.find(function(x){return x.id==id;});
        if(!c){
          // Si C[] pas encore chargé, ne rien afficher (skeleton) pour éviter les faux positifs
          if(!C.length)return'<div class="fav-cours-card skeleton" style="min-height:140px"></div>';
          return'<div class="fav-cours-card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:var(--bg);padding:24px 16px;text-align:center">'
            +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--bdr)" stroke-width="2" stroke-linecap="round" width="32" height="32"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'
            +'<div style="font-size:12px;color:var(--mid);font-weight:600;line-height:1.4">Cours supprimé</div>'
            +'<button onclick="event.stopPropagation();favCours.delete(\''+id+'\');saveFavCours();buildFavPage();" style="background:var(--orp);color:var(--or);border:none;border-radius:50px;padding:6px 14px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">Retirer</button>'
            +'</div>';
        }
        var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
        var mat=MATIERES.find(function(m){return c.subj&&c.subj.toLowerCase().includes(m.key);})||MATIERES[MATIERES.length-1];
        var bg=mat?mat.bg:'linear-gradient(135deg,var(--orp),#FFE8DC)';
        return'<div class="fav-cours-card" onclick="openR(\''+c.id+'\')">'
          +'<div class="fav-cours-card-top" style="background:'+bg+'">'
          +'<span style="background:rgba(0,0,0,.18);backdrop-filter:blur(6px);color:#fff;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">'+esc(c.subj)+'</span>'
          +'<button class="fav-remove-btn" onclick="event.stopPropagation();toggleFavCours(\''+c.id+'\',null);buildFavPage();" title="Retirer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
          +'</div>'
          +'<div class="fav-cours-card-body">'
          +'<div class="fav-cours-card-title">'+esc(c.title)+'</div>'
          +'<div class="fav-cours-card-meta">📅 '+esc(c.dt)+'</div>'
          +'<div class="fav-cours-card-meta" style="margin-bottom:8px">📍 '+esc(c.lc)+'</div>'
          +'<div class="fav-cours-card-price">'+pp+'€<span> / élève</span></div>'
          +'</div>'
          +'</div>';
      }).join('');
    }
  }

  // ── Carrousel profs suivis ──
  var profsCarousel=g('favProfsCarousel');
  if(profsCarousel){
    if(!folIds.length){
      if(profsSection)profsSection.style.display='none';
    } else {
      if(profsSection)profsSection.style.display='block';
      profsCarousel.innerHTML=folIds.map(function(pid){
        var p=P[pid]||{};
        // Trouver depuis les cours si pas en cache
        var cours=C.filter(function(x){return x.pr===pid;});
        if(cours.length&&!p.nm){
          p={nm:cours[0].prof_nm||'Professeur',i:cours[0].prof_ini||'?',col:cours[0].prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:cours[0].prof_photo||null,rl:cours[0].niveau||'',e:0};
          P[pid]=p;
        }
        // Fetch frais du profil si pas encore fait cette session
        _fetchProf(pid);
        var nm=p.nm||'Professeur';
        var av=p.photo?'<img src="'+esc(p.photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':((p.i||nm[0]||'?').toUpperCase());
        var nbCours=cours.filter(function(c){return c.fl<c.sp;}).length;
        return'<div class="fav-prof-card" data-fav-pid="'+pid+'">'
          +'<button class="fav-remove-btn" onclick="event.stopPropagation();var _c=this.closest(\'.fav-prof-card\');_c.style.transition=\'all .18s\';_c.style.opacity=\'0\';_c.style.transform=\'scale(.88)\';unfollowProf(\''+pid+'\');setTimeout(function(){buildFavPage();},180);" title="Ne plus suivre" style="top:8px;right:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
          +'<div class="fav-prof-av" data-prof="'+pid+'" style="background:'+(p.photo?'none':(p.col||'linear-gradient(135deg,#FF8C55,#E04E10))'))+'">'+av+'</div>'
          +'<div class="fav-prof-name" data-profnm="'+pid+'">'+esc(nm)+'</div>'
          +'<div class="fav-prof-role">'+esc(p.rl||'Professeur')+(nbCours?' · '+nbCours+' cours dispo':'')+'</div>'
          +'<button class="fav-prof-btn" onclick="event.stopPropagation();openPr(\''+pid+'\')">Voir le profil</button>'
          +'</div>';
      }).join('');
    }
  }
}

function unfollowProf(pid){
  fol.delete(pid);
  _syncFollowBtns(pid,false);
  if(user&&user.id){
    fetch(API+'/follows',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})}).catch(function(){});
  }
  toast('Professeur retiré des suivis','');
  haptic(4);
  updateFavBadge();
}
var curId=null,curProf=null,folPr=null,actF='tous',user=null;
var geoMode=false,userCoords=null,_geoActive=false,_geoCoords=null,_geoDist=10;
var PAGE_SIZE=6,currentPage=1,filteredCards=[];
var msgBadgePollTimer=null;
var _searchTimer=null;
var _autoRefreshTimer=null;

function _startAutoRefresh(){
  _stopAutoRefresh();
  _autoRefreshTimer=setInterval(function(){
    if(document.hidden)return; // pause si app en arrière-plan
    if(!user||user.guest)return;
    loadData(1,true).then(function(){
      // Réappliquer le filtre actif sans changer la page ni réinitialiser le scroll
      applyFilter();
    }).catch(function(){});
  },30000);
}
function _stopAutoRefresh(){
  if(_autoRefreshTimer){clearInterval(_autoRefreshTimer);_autoRefreshTimer=null;}
}

// LOAD DATA
function showSkeletons(){
  var grid=g('grid');
  if(!grid)return;
  grid.innerHTML=Array(6).fill(0).map(function(){
    return'<div class="skel-card"><div class="skeleton skel-top"></div><div class="skel-body"><div class="skeleton skel-line w80"></div><div class="skeleton skel-line w60"></div><div class="skeleton skel-line w40"></div></div></div>';
  }).join('');
}

var _allLoaded=false,_totalCours=0,_currentPage=1,_loadingMore=false;

async function loadData(page,silent){
  page=page||1;
  if(page===1&&!silent)showSkeletonsV2();
  try{
    var r=await fetch(API+'/cours?page='+page+'&limit=20');
    var json=await r.json();
    // Support ancien format (array) et nouveau (objet paginé)
    var cours=Array.isArray(json)?json:(json.cours||[]);
    _totalCours=json.total||cours.length;
    _allLoaded=cours.length<20||(_currentPage*20)>=_totalCours;
    if(!cours.length&&page===1){
      // Serveur qui se réveille : garder les skeletons et réessayer après 5s
      setTimeout(function(){loadData(1).then(function(){buildCards();});},5000);
      return; // ne pas appeler buildCards, laisser les skeletons visibles
    }
    var mapped=cours.map(function(c){
      return{
        id:c.id,
        t:((c.titre||'')+' '+(c.sujet||'')+' '+(c.prof_nom||'')+' '+(c.lieu||'')).toLowerCase(),
        subj:c.sujet||'Autre',
        sc:(function(){var m=findMatiere(c.sujet||'');return m?m.color:(c.couleur_sujet||'#7C3AED');}()),
        bg:(function(){var m=findMatiere(c.sujet||'');return m?m.bg:(c.background||'linear-gradient(135deg,#F5F3FF,#DDD6FE)');}()),
        bgDark:(function(){var m=findMatiere(c.sujet||'');return m&&m.bgDark?m.bgDark:'linear-gradient(135deg,#1A1A2E,#16213E)';}()),
        title:c.titre||'',dt:c.date_heure||'',lc:c.lieu||'',mode:c.mode||'presentiel',visio_url:c.visio_url||'',code:c.code_acces||'',prive:c.prive||false,
        tot:c.prix_total||0,sp:c.places_max||5,fl:c.places_prises||0,
        pr:c.professeur_id,em:c.emoji||'📚',
        prof_ini:c.prof_initiales||'?',
        prof_col:c.prof_couleur||'linear-gradient(135deg,#FF8C55,#E04E10)',
        prof_nm:c.prof_nom||'Professeur',
        prof_photo:c.prof_photo||null,
        description:c.description||'',
        prive:c.prive||false,
        code:c.code_acces||'',
        niveau:c.niveau||''
      };
    });
    if(page===1){C=mapped;}else{C=C.concat(mapped);}
    // Si le prof connecté a une photo locale, l'injecter dans ses cours
    // (la table cours peut avoir une ancienne photo_url)
    if(user&&user.id&&user.photo){
      C.forEach(function(c){if(c.pr===user.id)c.prof_photo=user.photo;});
    }
    mapped.forEach(function(c){
      var isMe = user&&user.id&&c.pr===user.id;
      var bestPhoto = isMe ? (user.photo||c.prof_photo) : c.prof_photo;
      if(c.pr&&!P[c.pr]){
        P[c.pr]={i:c.prof_ini,col:c.prof_col,nm:c.prof_nm,rl:'',bd:'',c:0,n:'—',e:0,bio:'',tags:[],crs:[],photo:bestPhoto};
      } else if(c.pr){
        // Ne pas écraser les données fraîches venues de l'API profil
        if(!P[c.pr]._fresh)P[c.pr].nm=c.prof_nm||P[c.pr].nm;
        P[c.pr].col=c.prof_col||P[c.pr].col;
        // Priorité : photo locale (user.photo) > photo serveur > photo cache
        if(isMe)P[c.pr].photo=user.photo||c.prof_photo||P[c.pr].photo;
        else if(c.prof_photo&&!P[c.pr].photo&&!P[c.pr]._fresh)P[c.pr].photo=c.prof_photo;
      }
    });
    // Lancer les fetches de profils frais dès maintenant (avant renderPage)
    // Quand ils reviennent ils patchent P[], C[], et le DOM via _fetchProf
    if(page===1){var _fpSeen={};mapped.forEach(function(c){if(c.pr&&user&&c.pr!==user.id&&!_fpSeen[c.pr]){_fpSeen[c.pr]=true;_fetchProf(c.pr);}});}
    // Après traitement des cours, écraser P[user.id] avec les données fraîches du user connecté
    // (bio/statut/niveau/matieres/nom ne viennent pas des cours)
    if(user&&user.id&&page===1){
      if(!P[user.id])P[user.id]={n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
      var _pu=P[user.id];
      var _fn=(user.pr||'')+(user.nm?' '+user.nm:'');
      if(_fn)_pu.nm=_fn;
      if(user.ini)_pu.i=user.ini;
      if(user.photo)_pu.photo=user.photo;
      _pu.bio=user.bio||_pu.bio||'';
      if(user.statut)_pu.statut=user.statut;
      if(user.niveau)_pu.niveau=user.niveau;
      if(user.matieres)_pu.matieres=user.matieres;
    }
  }catch(e){
    console.log('loadData err',e);
    if(page===1)showNetworkError();
  }
}

// ═══════════════════════════════════════════════════════
// AUTH — INSCRIPTION + COMPLÉTION PROFIL
// ═══════════════════════════════════════════════════════
var _regRole='eleve'; // 'eleve'|'professeur'

// ── Navigation login/register ──
function showLogin(){
  var s=g('lsReg');if(s)s.style.display='none';
  var l=g('lsLogin');if(l){l.style.display='flex';l.scrollTop=0;}
}
function showReg(){
  var l=g('lsLogin');if(l)l.style.display='none';
  var r=g('lsReg');if(r){r.style.display='flex';r.scrollTop=0;}
  _checkRegBtn();
}

// ── Rôle cards ──
function pickRegRole(r){
  _regRole=r;
  ['rcEl','rcPf'].forEach(function(id){var el=g(id);if(el)el.classList.remove('on');});
  var map={eleve:'rcEl',professeur:'rcPf'};
  var el=g(map[r]);if(el)el.classList.add('on');
  _checkRegBtn();
}

// ── Bouton "Créer mon compte" — actif seulement si tout est rempli ──
function _checkRegBtn(){
  var btn=g('regCreateBtn');if(!btn)return;
  var pr=(g('rPr')&&g('rPr').value||'').trim();
  var em=(g('rEm')&&g('rEm').value||'').trim();
  var pw=(g('rPw')&&g('rPw').value||'');
  var ok=pr.length>0&&em.indexOf('@')>0&&pw.length>=6&&_regRole!=='';
  btn.disabled=!ok;
}

// ── Indicateur force mot de passe ──
function updatePwStrength(pw){
  var score=0;
  if(pw.length>=6)score++;if(pw.length>=10)score++;
  if(/[A-Z]/.test(pw)||/[0-9]/.test(pw))score++;
  if(/[^a-zA-Z0-9]/.test(pw))score++;
  var colors=['var(--bdr)','#EF4444','#F97316','#22C55E','#22C55E'];
  var labels=['','Trop court','Faible','Correct','Fort'];
  for(var i=1;i<=4;i++){var b=g('pwBar'+i);if(b)b.style.background=i<=score?colors[score]:'var(--bdr)';}
  var lbl=g('pwStrengthLabel');if(lbl){lbl.textContent=labels[score]||'';lbl.style.color=colors[score]||'';}
}

// ── Supabase client init + OAuth ──
var _oauthSession=null;
var _pcIsOAuth=false;

async function _initSupabase(){
  try{
    var r=await fetch(API+'/auth/config');
    var data=await r.json();
    if(!data.supabaseUrl||!data.supabaseAnonKey){
      console.warn('[OAuth] SUPABASE_ANON_KEY manquant sur le serveur — OAuth désactivé');
      return;
    }
    if(!window.supabase){
      console.warn('[OAuth] Supabase CDN non chargé');
      return;
    }
    window._supabase=window.supabase.createClient(data.supabaseUrl,data.supabaseAnonKey);
    _setupAuthStateChange();
  }catch(e){console.warn('[OAuth] Erreur init Supabase:',e);}
}

function _setupAuthStateChange(){
  if(!window._supabase)return;
  // Fallback : si la session OAuth n'est pas détectée après 8s, ré-afficher le login
  if(_isOAuthReturn){
    setTimeout(function(){
      if(!user){
        var spinner=document.getElementById('oauthLoading');
        if(spinner){
          spinner.remove();
          var lsLogin=document.getElementById('lsLogin');
          if(lsLogin)lsLogin.style.display='';
        }
        window.history.replaceState({},'',window.location.pathname);
      }
    },8000);
  }
  // Vérifier s'il y a déjà une session (retour OAuth — hash traité avant la subscription)
  window._supabase.auth.getSession().then(function(result){
    var session=result&&result.data&&result.data.session;
    if(session&&!user){
      var provider=session.user&&session.user.app_metadata&&session.user.app_metadata.provider;
      if(provider&&provider!=='email')_handleOAuthSignIn(session);
    }
  });
  // Écouter les changements futurs (SIGNED_IN + INITIAL_SESSION pour Supabase v2)
  window._supabase.auth.onAuthStateChange(function(event,session){
    if((event==='SIGNED_IN'||event==='INITIAL_SESSION')&&session&&!user){
      var provider=session.user&&session.user.app_metadata&&session.user.app_metadata.provider;
      if(provider&&provider!=='email')_handleOAuthSignIn(session);
    }
  });
}

async function _handleOAuthSignIn(session){
  // Retirer le spinner de chargement OAuth si présent
  var spinner=document.getElementById('oauthLoading');
  if(spinner)spinner.remove();
  // Masquer l'écran login
  var loginEl=g('login');
  if(loginEl){loginEl.style.display='none';loginEl.style.zIndex='-1';}
  var token=session.access_token;
  var sbUser=session.user||{};
  var meta=sbUser.user_metadata||{};
  // Vérifier si profil existant avec rôle
  try{
    var r=await fetch(API+'/profiles/'+sbUser.id);
    var data=await r.json();
    if(data&&data.role){
      // Utilisateur existant — connexion directe
      var p=data;
      var pr=p.prenom||(meta.given_name||meta.name||(sbUser.email||'').split('@')[0]);
      var nm=p.nom||(meta.family_name||'');
      user={pr:pr,nm:nm,em:sbUser.email||'',role:p.role,id:sbUser.id,
        ini:((pr[0]||'')+(nm[0]||'')).toUpperCase()||'U',
        photo:p.photo_url||null,verified:p.verified,
        statut:p.statut||'',niveau:p.niveau||'',matieres:p.matieres||'',bio:p.bio||'',
        token:token,refresh_token:session.refresh_token,token_exp:session.expires_at};
      try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
      _scheduleTokenRefresh();
      applyUser();
      loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
      toast('Bienvenue '+pr+' !','Connecté à CoursPool');
      return;
    }
  }catch(e){}
  // Nouvel utilisateur OAuth — afficher sélection du rôle
  _pcIsOAuth=true;
  _oauthSession=session;
  _regRole='eleve';
  _pcPour='moi';_pcNivEleve='';_pcNivEtudes='';_pcMatieres=[];_pcMode='';
  _pcHistory=[];
  var pc=g('profCompletion');if(pc){pc.style.display='block';pc.scrollTop=0;}
  _pcShowSlide('pcOAuthRole',false);
}

async function doOAuthGoogle(){
  if(!window._supabase){toast('Erreur','OAuth non disponible');return;}
  var redirectTo=_isIOS?'com.courspool.app://login-callback':'https://courspool.vercel.app';
  try{
    await window._supabase.auth.signInWithOAuth({
      provider:'google',
      options:{redirectTo:redirectTo,queryParams:{access_type:'offline',prompt:'consent'}}
    });
  }catch(e){toast('Erreur','Impossible de continuer avec Google');}
}
async function doOAuthApple(){
  if(!window._supabase){toast('Erreur','OAuth non disponible');return;}
  var redirectTo=_isIOS?'com.courspool.app://login-callback':'https://courspool.vercel.app';
  try{
    await window._supabase.auth.signInWithOAuth({
      provider:'apple',
      options:{redirectTo:redirectTo}
    });
  }catch(e){toast('Erreur','Impossible de continuer avec Apple');}
}

function pickOAuthRole(r){
  _regRole=r;
  ['oauthRcEl','oauthRcPf'].forEach(function(id){var el=g(id);if(el)el.classList.remove('on');});
  var map={eleve:'oauthRcEl',professeur:'oauthRcPf'};
  var el=g(map[r]);if(el)el.classList.add('on');
  var btn=g('oauthRoleNextBtn');if(btn)btn.disabled=false;
}

async function pcOAuthRoleNext(){
  if(!_pcIsOAuth||!_oauthSession)return;
  var btn=g('oauthRoleNextBtn');if(btn){btn.disabled=true;btn.textContent='Chargement...';}
  var session=_oauthSession;
  var sbUser=session.user||{};
  var meta=sbUser.user_metadata||{};
  try{
    var r=await fetch(API+'/auth/oauth-profile',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({
        role:_regRole,
        prenom:meta.given_name||meta.name||(sbUser.email||'').split('@')[0],
        nom:meta.family_name||''
      })
    });
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);if(btn){btn.disabled=false;btn.textContent='Continuer';}return;}
    var p=data.profile||{};
    var pr=p.prenom||(meta.given_name||(sbUser.email||'').split('@')[0]);
    var nm=p.nom||meta.family_name||'';
    user={pr:pr,nm:nm,em:sbUser.email||'',role:p.role||_regRole,id:sbUser.id,
      ini:((pr[0]||'')+(nm[0]||'')).toUpperCase()||'U',
      photo:p.photo_url||null,verified:p.verified,
      statut:p.statut||'',niveau:p.niveau||'',matieres:p.matieres||'',bio:p.bio||'',
      token:session.access_token,refresh_token:session.refresh_token,token_exp:session.expires_at};
    try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
    _scheduleTokenRefresh();
    applyUser();
    loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
    // Avancer vers les slides spécifiques au rôle
    _pcHistory.push('pcOAuthRole');
    var nextSlide=(user.role==='professeur')?'pcPfA':'pcElA';
    _pcShowSlide(nextSlide,false);
  }catch(e){
    toast('Erreur','Problème de connexion');
    if(btn){btn.disabled=false;btn.textContent='Continuer';}
  }
}

// ── Legacy stubs ──
function switchLT(t){}
function pickRole(r){}
function updateNiveaux(v){}
function showRegSlide(n){showReg();}
function regNext(){}
function regBack(){showLogin();}

// ═══════════════════════════════════════════════════════
// PROFILE COMPLETION (après inscription, avant tutoriel)
// ═══════════════════════════════════════════════════════
var _pcPour='moi';
var _pcNivEleve='';
var _pcNivEtudes='';
var _pcMatieres=[];
var _pcMode='';
var _pcCurrentSlide='';
var _pcHistory=[];

function showProfCompletion(){
  var pc=g('profCompletion');if(!pc)return;
  pc.style.display='block';
  _pcIsOAuth=false;_oauthSession=null;
  _pcPour='moi';_pcNivEleve='';_pcNivEtudes='';_pcMatieres=[];_pcMode='';
  _pcHistory=[];
  var first=(user&&user.role==='professeur')?'pcPfA':'pcElA';
  _pcShowSlide(first,false);
}

function _pcAllSlides(){return['pcOAuthRole','pcElA','pcElBmoi','pcElBenf','pcPfA','pcPfB','pcPfC'];}

function _pcOrderedSlides(){
  if(_pcIsOAuth){
    if(!user)return['pcOAuthRole'];
    if(user.role==='professeur')return['pcOAuthRole','pcPfA','pcPfB','pcPfC'];
    return _pcPour==='enfant'?['pcOAuthRole','pcElA','pcElBenf']:['pcOAuthRole','pcElA','pcElBmoi'];
  }
  if(user&&user.role==='professeur')return['pcPfA','pcPfB','pcPfC'];
  return _pcPour==='enfant'?['pcElA','pcElBenf']:['pcElA','pcElBmoi'];
}

function _pcShowSlide(id,isBack){
  _pcAllSlides().forEach(function(sid){var el=g(sid);if(el){el.style.display='none';el.classList.remove('pc-back');}});
  var el=g(id);if(!el)return;
  el.style.display='block';
  if(isBack)el.classList.add('pc-back');
  _pcCurrentSlide=id;
  var pc=g('profCompletion');if(pc)pc.scrollTop=0;
  _pcUpdateProgress();
}

function _pcUpdateProgress(){
  var slides=_pcOrderedSlides();
  var idx=slides.indexOf(_pcCurrentSlide);if(idx<0)idx=0;
  var total=slides.length;
  var pct=Math.round(((idx+1)/total)*100);
  var bar=g('pcBar');if(bar)bar.style.width=pct+'%';
  var lbl=g('pcStepLabel');if(lbl)lbl.textContent=(idx+1)+' / '+total;
  var back=g('pcBackBtn');if(back)back.style.visibility=_pcHistory.length>0?'visible':'hidden';
}

function pcNext(){
  var slides=_pcOrderedSlides();
  var idx=slides.indexOf(_pcCurrentSlide);
  if(idx<0||idx>=slides.length-1)return;
  _pcHistory.push(_pcCurrentSlide);
  _pcShowSlide(slides[idx+1],false);
}

function pcBack(){
  if(_pcHistory.length===0)return;
  var prev=_pcHistory.pop();
  _pcShowSlide(prev,true);
}

// ── Sélections ──
function pickPour(v){
  _pcPour=v;
  ['pcMoi','pcEnfant'].forEach(function(id){var el=g(id);if(el)el.classList.remove('on');});
  var el=g(v==='moi'?'pcMoi':'pcEnfant');if(el)el.classList.add('on');
}

function pickPcNiv(el,v){
  _pcNivEleve=v;
  var grid=el.parentNode;
  [].forEach.call(grid.querySelectorAll('.lniv-chip'),function(c){c.classList.remove('on');});
  el.classList.add('on');
}

function pickPcNivEtudes(el,v){
  _pcNivEtudes=v;
  var grid=el.parentNode;
  [].forEach.call(grid.querySelectorAll('.lniv-chip'),function(c){c.classList.remove('on');});
  el.classList.add('on');
}

function pcToggleMat(el,mat){
  var idx=_pcMatieres.indexOf(mat);
  if(idx>=0){_pcMatieres.splice(idx,1);el.classList.remove('on');}
  else{_pcMatieres.push(mat);el.classList.add('on');}
  _pcUpdateMatSelected();
}

function _pcUpdateMatSelected(){
  var wrap=g('pcMatSelected');var chips=g('pcMatSelectedChips');
  if(!wrap||!chips)return;
  if(_pcMatieres.length===0){wrap.style.display='none';return;}
  wrap.style.display='block';
  chips.innerHTML=_pcMatieres.map(function(m){
    return '<span class="pc-mat-chip-tag" onclick="pcRemoveMat(\''+m.replace(/'/g,"\\'")+'\')">'
      +m+' \u00d7</span>';
  }).join('');
}

function pcRemoveMat(mat){
  var idx=_pcMatieres.indexOf(mat);if(idx>=0)_pcMatieres.splice(idx,1);
  var pb=g('pcPfB');
  if(pb){[].forEach.call(pb.querySelectorAll('.lniv-chip'),function(c){
    if((c.getAttribute('onclick')||'').indexOf("'"+mat+"'")>=0||(c.getAttribute('onclick')||'').indexOf('"'+mat+'"')>=0)c.classList.remove('on');
  });}
  _pcUpdateMatSelected();
}

function pcMatSearchInput(val){
  var sug=g('pcMatAlias');if(!sug)return;
  if(typeof resolveAlias==='function'&&val.length>=2){
    var alias=resolveAlias(val);
    if(alias&&alias.toLowerCase()!==val.toLowerCase()){sug.style.display='block';sug.textContent='Vous cherchez : '+alias+' ?';sug._val=alias;}
    else{sug.style.display='none';}
  }else{sug.style.display='none';}
}

function pcMatAliasAccept(){
  var sug=g('pcMatAlias');var inp=g('pcMatSearch');
  if(!sug||!inp||!sug._val)return;
  var mat=sug._val;inp.value='';sug.style.display='none';
  if(_pcMatieres.indexOf(mat)<0){_pcMatieres.push(mat);_pcUpdateMatSelected();}
}

function pickPcMode(v){
  _pcMode=v;
  ['pcModePres','pcModeVis','pcModeBoth'].forEach(function(id){var el=g(id);if(el)el.classList.remove('on');});
  var map={presentiel:'pcModePres',visio:'pcModeVis',les_deux:'pcModeBoth'};
  var el=g(map[v]);if(el)el.classList.add('on');
}

async function saveProfCompletion(){
  var payload={};
  if(!user||!user.id||user.guest){_hideProfCompletion();return;}
  if(user.role==='professeur'){
    if(_pcNivEtudes)payload.statut=_pcNivEtudes;
    if(_pcMatieres.length>0)payload.matieres=_pcMatieres.join(', ');
    var ville=(g('pcVille')&&g('pcVille').value||'').trim();
    if(ville)payload.ville=ville;
    if(_pcMode)payload.mode_cours=_pcMode;
  }else{
    payload.pour_enfant=(_pcPour==='enfant');
    if(_pcNivEleve&&_pcNivEleve!=='no_answer'){
      if(_pcPour==='enfant')payload.niveau_enfant=_pcNivEleve;
      else payload.niveau=_pcNivEleve;
    }
    var age=parseInt((g('pcEnfantAge')&&g('pcEnfantAge').value)||'0')||0;
    if(age>0){payload.age_enfant=age;if(age<13)payload.is_mineur=true;}
  }
  if(Object.keys(payload).length>0){
    try{
      await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify(payload)});
    }catch(e){}
  }
  try{localStorage.setItem('cp_profile_done_'+user.id,'1');}catch(e){}
  _hideProfCompletion();
}

function _hideProfCompletion(){
  var pc=g('profCompletion');
  if(pc){
    pc.style.opacity='0';pc.style.transition='opacity .25s';
    setTimeout(function(){pc.style.display='none';pc.style.opacity='';pc.style.transition='';},260);
  }
  setTimeout(tutoStart,350);
}

async function doLogin(){
  var em=g('lEm').value.trim(),pw=g('lPw').value;
  if(!em||!pw){shake('lsLogin');return;}
  g('lEm').disabled=true;g('lPw').disabled=true;
  try{
    var r=await fetch(API+'/auth/login',{method:'POST',headers:apiH(),body:JSON.stringify({email:em,password:pw})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);shake('lfC');return;}
    var p=data.profile||{};
    // Vérifier si compte bloqué
    if(p.statut_compte==='bloqué'){
      toast('Compte suspendu','Votre compte a été suspendu. Contactez le support CoursPool.');
      g('lEm').disabled=false;g('lPw').disabled=false;
      return;
    }
    var pr=p.prenom||em.split('@')[0];
    var nm=p.nom||'';
    var role=p.role||'eleve';
    var uid=data.user.id;
    var photo=p.photo_url||null;
    user={pr:pr,nm:nm,em:em,role:role,id:uid,
      ini:((pr[0]||'')+(nm[0]||'')).toUpperCase()||'U',
      photo:photo,
      verified:p.verified!=null?p.verified:undefined,
      statut:p.statut||'',
      niveau:p.niveau||'',
      matieres:p.matieres||'',
      bio:p.bio||'',
      token:data.session&&data.session.access_token?data.session.access_token:undefined,
      refresh_token:data.session&&data.session.refresh_token?data.session.refresh_token:undefined,
      token_exp:data.session&&data.session.expires_at?data.session.expires_at:undefined
    };
    try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
    _scheduleTokenRefresh();
    applyUser();
    // Vider toute la session précédente (profils, follows, résa, favoris)
    Object.keys(P).forEach(function(k){delete P[k]});
    try{localStorage.removeItem('cp_follow_counts');}catch(e){}
    try{localStorage.removeItem('cp_profs');}catch(e){}
    Object.keys(res).forEach(function(k){delete res[k];});
    fol.clear();
    favCours.clear();try{localStorage.removeItem('cp_fav_cours');}catch(e){};
    if(uid){
      Promise.all([
        fetch(API+'/reservations/'+uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
        fetch(API+'/follows/'+uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];})
      ]).then(function(results){
        var resData=results[0],folData=results[1];
        if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}}
        if(Array.isArray(folData)){folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});}
        loadData().then(function(){restoreFilters();buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
      }).catch(function(){loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});});
    } else {
      loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
    }
    toast('Bienvenue '+pr+' !','Connecté à CoursPool');
    // Lancer tuto — si prof sans CNI, délégué à après la modal CNI
    if(role!=='professeur'){setTimeout(tutoStart,1200);}
  }catch(e){toast('Erreur','Impossible de se connecter');}
  finally{g('lEm').disabled=false;g('lPw').disabled=false;}
}

async function doReg(){
  var pr=(g('rPr')&&g('rPr').value||'').trim();
  var nm=(g('rNm')&&g('rNm').value||'').trim();
  var em=(g('rEm')&&g('rEm').value||'').trim();
  var pw=(g('rPw')&&g('rPw').value||'');
  var role=_regRole||'eleve';
  if(!pr||!em||!pw){toast('Champs manquants','Prénom, email et mot de passe requis');return;}
  if(pw.length<6){toast('Erreur','Mot de passe trop court (6 min)');return;}
  var btn=g('regCreateBtn');if(btn){btn.disabled=true;btn.textContent='Création...';}
  try{
    var body={email:em,password:pw,prenom:pr,nom:nm,role:role};
    var r=await fetch(API+'/auth/register',{method:'POST',headers:apiH(),body:JSON.stringify(body)});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    // Auto-login
    var loginR=await fetch(API+'/auth/login',{method:'POST',headers:apiH(),body:JSON.stringify({email:em,password:pw})});
    var loginData=await loginR.json();
    var sess=loginData.session||{};
    var token=sess.access_token||undefined;
    var rtok=sess.refresh_token||undefined;
    var texp=sess.expires_at||undefined;
    // Afficher l'app (cache le login overlay)
    go(pr,nm,em,role,data.user.id,null,token,rtok,texp);
    // Lancer la complétion de profil (avant tutoriel)
    setTimeout(showProfCompletion,300);
  }catch(e){toast('Erreur','Impossible de créer le compte');}
  finally{if(btn){btn.disabled=false;btn.textContent='Créer mon compte';}}
}

function doGuest(){
  // Mode visiteur : pas de bnav, pas de stockage localStorage
  user={pr:'Invité',nm:'',em:'',role:'eleve',id:null,ini:'I',photo:null,guest:true};
  var _l=g('login');
  if(_l){_l.style.display='none';_l.style.zIndex='-1';}  // pas de pointerEvents:none pour pouvoir revenir
  g('app').style.display='block';
  // Bnav réduite pour les invités : pas de "Profil", juste Explorer
  var bnav=g('bnav');
  if(bnav)bnav.classList.add('on');
  var bniMsg=g('bniMsg'),bniAcc=g('bniAcc'),bniAdd=g('bniAdd'),bniFavG=g('bniFav');
  if(bniMsg)bniMsg.style.display='none';
  if(bniAcc)bniAcc.style.display='flex';
  if(bniAdd)bniAdd.style.display='none';
  if(bniFavG)bniFavG.style.display='none';
  var bniMesG=g('bniMes');if(bniMesG)bniMesG.style.display='flex';
  // Header invité
  var mobT=g('mobTitle'),mobS=g('mobSub');
  if(mobT)mobT.textContent='Explorer';
  if(mobS)mobS.textContent='Trouvez un cours près de vous';
  var tav=g('tav');if(tav){tav.style.background='var(--bdr)';tav.textContent='?';}
  var tavMob=g('tavMob');if(tavMob){tavMob.style.background='var(--bdr)';tavMob.textContent='?';}
  loadData().then(function(){buildCards();});
  // Synchro nav
  navTo('exp');
  // Onboarding + tuto
  setTimeout(obShow, 500);
}

function go(pr,nm,em,role,uid,photoUrl,token,refreshToken,tokenExp){
  user={pr:pr,nm:nm,em:em,role:role||'eleve',id:uid,ini:((pr&&pr[0]?pr[0]:'')+(nm&&nm[0]?nm[0]:'')).toUpperCase()||'U',photo:photoUrl||null,token:token||undefined,refresh_token:refreshToken||undefined,token_exp:tokenExp||undefined};
  try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
  _scheduleTokenRefresh();
  applyUser();
  loadData().then(function(){buildCards();});
  toast('Bienvenue '+pr+' !','Connecté à CoursPool');
}

function applyUser(){
  var _l=g('login');if(_l){_l.style.display='none';_l.style.pointerEvents='none';_l.style.zIndex='-1';}g('app').style.display='block';
  // Greeting dynamique
  try{
    var h=new Date().getHours();
    var greet=h<6?'Bonne nuit':h<12?'Bonjour':h<18?'Bonjour':h<22?'Bonsoir':'Bonne nuit';
    var mobT=g('mobTitle'),mobS=g('mobSub');
    if(mobT)mobT.textContent=user&&user.pr?greet+' '+user.pr+' 👋':greet+' 👋';
    if(mobS){var msgs=['Cours près de vous','Que voulez-vous apprendre ?','Trouvez votre prochain cours'];if(msgs&&msgs.length)mobS.textContent=msgs[Math.floor(Math.random()*msgs.length)];}
  }catch(e){}
  setAvatar(g('tav'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
  g('btnProposer').style.display=user.role==='professeur'?'flex':'none';
  // Banner géré par updateVerifBand() uniquement
  // Bottom nav — restaurer tous les items avant d'appliquer le rôle
  var bniMsg2=g('bniMsg'),bniAcc2=g('bniAcc'),bniFav2=g('bniFav');
  if(bniMsg2)bniMsg2.style.display=(user&&!user.guest)?'flex':'none';
  if(bniAcc2)bniAcc2.style.display='flex';
  if(bniFav2)bniFav2.style.display=(user&&!user.guest)?'flex':'none';
  g('bnav').classList.add('on');
  var bniAdd=g('bniAdd');if(bniAdd)bniAdd.style.display=user.role==='professeur'?'flex':'none';
  // Sync mobile header
  setAvatar(g('tavMob'),user.photo,user.ini||'?','linear-gradient(135deg,#FF8C55,var(--ord))');
  var bp=g('btnProposerMob');
  if(bp)bp.style.display=user.role==='professeur'?'flex':'none';
  updateMobHeader('exp');
  // Vérifier si première connexion prof pour CNI
  checkFirstProfLogin();
  updateVerifBand();
  // Rappel cours à venir
  setTimeout(checkUpcomingReminder, 2000);
  // Vérification périodique que le compte est toujours actif
  startAccountCheck();
  // Polling badge messages non lus
  if(user&&user.id&&!user.guest){
    clearInterval(msgBadgePollTimer);
    msgBadgePollTimer=setInterval(function(){
      if(!user||!user.id)return;
      fetch(API+'/messages/unread-count',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
        if(data&&typeof data.count==='number')updateMsgBadge(data.count);
      }).catch(function(){});
    },30000);
  }
  // Swipe to dismiss sur les principales bottom sheets
  setTimeout(function(){
    initSwipeDismiss(g('bdR'), function(){closeM('bdR');});
    initSwipeDismiss(g('bdCni'), cniLater);
    initSwipeDismiss(g('bdNote'), function(){closeM('bdNote');});
    initSwipeDismiss(g('bdPreview'), function(){g('bdPreview').style.display='none';});
  },500);
  // Forcer la synchro complète de la nav et du header
  navTo('exp');
}

// Titres et sous-titres par page
var MOB_TITLES={
  exp:{title:'Accueil',sub:'Cours près de vous'},
  fav:{title:'Mes favoris',sub:'Cours & professeurs sauvegardés'},
  mes:{title:'Mes cours',sub:'Réservations & historique'},
  msg:{title:'Messages',sub:'Vos conversations'},
  acc:{title:'Mon profil',sub:'Paramètres & réservations'}
};

function getGreeting(){
  var h=new Date().getHours();
  if(h>=5&&h<12)return'Bonjour';
  if(h>=12&&h<18)return'Bon après-midi';
  if(h>=18&&h<22)return'Bonsoir';
  return'Bonne nuit';
}


// ── Sync topbar nav desktop ──
function updateTopbarNav(tab){
  ['tnavExp','tnavMsg','tnavMes'].forEach(function(id){
    var el=g(id);if(el)el.classList.remove('active');
  });
  var map={exp:'tnavExp',msg:'tnavMsg',mes:'tnavMes'};
  var active=g(map[tab]);if(active)active.classList.add('active');
  // bniMes / tnavMes visible seulement pour élèves
  var tme=g('tnavMes');
  if(tme)tme.style.display=(user&&user.id&&user.role!=='professeur')?'flex':'none';
}

function updateMobHeader(tab){
  var t=MOB_TITLES[tab]||{title:'CoursPool',sub:''};
  var mt=g('mobTitle'),ms=g('mobSub');
  if(tab==='exp'&&user){
    if(mt)mt.textContent=getGreeting()+' '+user.pr+' 👋';
    if(ms)ms.textContent=t.sub;
  } else {
    if(mt)mt.textContent=t.title;
    if(ms)ms.textContent=t.sub;
  }
  // Recherche visible seulement sur Explorer
  var ms2=g('mobSearch');if(ms2)ms2.style.display=tab==='exp'?'block':'none';
  // Bouton proposer mobile
  var bp=g('btnProposerMob');
  if(bp)bp.style.display=(tab==='exp'&&user&&user.role==='professeur')?'flex':'none';
  // Avatar mobile sync
  if(user)setAvatar(g('tavMob'),user.photo,user.ini||'?','linear-gradient(135deg,#FF8C55,var(--ord))');
  // Cacher mob-header sur la page messages (la conv a son propre header)
  var mh=g('mobHeader');
  if(mh)mh.style.display=tab==='msg'?'none':'block';
}

function navTo(tab,_skipHistory){
  // Mettre à jour l'historique du navigateur pour le bouton retour Android/browser
  if(!_skipHistory){try{history.pushState({tab:tab},'',' ');}catch(e){}}
  // Toujours fermer la conv active et s'assurer que la nav est visible
  var convPane=g('msgConvPane');
  if(convPane&&tab!=='msg')convPane.style.display='none';
  var pgMsgEl=g('pgMsg');
  if(pgMsgEl&&tab!=='msg'){
    pgMsgEl.classList.remove('conv-open');
    var _bnavEl=g('bnav');if(_bnavEl)_bnavEl.classList.remove('ipad-back');
    var _bbEl=g('bnavIpadBack');if(_bbEl)_bbEl.classList.remove('visible');
  }
  clearInterval(msgPollTimer);if(tab!=='msg'){msgPollTimer=null;}

  ['bniExp','bniFav','bniMsg','bniAcc'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
  var appEl=g('app');if(appEl)appEl.scrollTop=0;
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg'),pgFav=g('pgFav');
  if(pgExp)pgExp.classList.remove('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  if(pgFav)pgFav.classList.remove('on');
  updateMobHeader(tab);
  updateTopbarNav(tab);

  if(tab==='exp'){
    if(pgExp)pgExp.classList.add('on');
    var bExp=g('bniExp');if(bExp)bExp.classList.add('on');
    var br=g('btnRefresh');if(br)br.style.display=user?'flex':'none';
    restoreNav();
    _syncAllFollowBtns();
  } else if(tab==='fav'){
    if(!user||user.guest){
      toast('Connectez-vous pour accéder à vos favoris','');
      setTimeout(scrollToLogin,800);
      return;
    }
    if(pgFav)pgFav.classList.add('on');
    var bFav=g('bniFav');if(bFav){bFav.classList.add('on');_springIcon(bFav);}
    var brF=g('btnRefresh');if(brF)brF.style.display='none';
    restoreNav();
    buildFavPage();
  } else if(tab==='msg'){
    if(!user){navTo('exp');return;}
    if(user.guest){
      toast('Connectez-vous pour accéder aux messages','');
      setTimeout(scrollToLogin, 800);
      return;
    }
    if(pgMsg)pgMsg.classList.add('on');
    restoreNav();
    var bMsg=g('bniMsg');if(bMsg)bMsg.classList.add('on');
    var br3=g('btnRefresh');if(br3)br3.style.display='none';
    loadConversations();
  } else if(tab==='acc'){
    if(!user){navTo('exp');return;}
    if(user.guest){
      var bd=g('bdLoginPrompt');
      if(bd){
        var t=bd.querySelector('[style*="font-size:21px"]');
        var s=bd.querySelector('[style*="font-size:14px"][style*="color:var(--lite)"]');
        if(t)t.textContent='Créez votre compte gratuit';
        if(s)s.innerHTML='Rejoignez CoursPool pour réserver des cours,<br>suivre des professeurs et gérer votre profil.';
        bd.style.display='flex';
      } else {
        toast('Connectez-vous pour accéder à votre profil','');
        setTimeout(scrollToLogin, 800);
      }
      return;
    }
    if(pgAcc)pgAcc.classList.add('on');
    var bAcc=g('bniAcc');if(bAcc){bAcc.classList.add('on');_springIcon(bAcc);}
    var br2=g('btnRefresh');if(br2)br2.style.display='none';
    restoreNav();
    goAccount();
  }
}

function _springIcon(el){
  if(!el)return;
  var ico=el.querySelector('.bni-ico-on')||el.querySelector('svg')||el.querySelector('div');
  if(!ico)return;
  ico.style.animation='none';
  ico.offsetHeight;
  ico.style.animation='bniSpring .4s cubic-bezier(.34,1.56,.64,1)';
  haptic(4);
}

function restoreNav(){
  var nav=g('bnav');
  if(nav&&user)nav.style.display='flex';

  // Restaurer le bouton Explorer
  var bniExp=g('bniExp');
  if(bniExp){
    bniExp.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="24" height="24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span class="bni-lbl">Explorer</span>';
    bniExp.onclick=function(){navTo('exp');};
  }
  // Favoris — visible pour les utilisateurs connectés non-invités
  var bniFavEl=g('bniFav');
  if(bniFavEl)bniFavEl.style.display=(user&&!user.guest)?'flex':'none';
  // Messages
  var bniMsg=g('bniMsg');
  if(bniMsg)bniMsg.style.display=(user&&!user.guest)?'flex':'none';
  // Profil
  var bniAcc=g('bniAcc');if(bniAcc)bniAcc.style.display='flex';
  // Mes cours — élèves seulement
  var bniMesR=g('bniMes');
  if(bniMesR)bniMesR.style.display=(user&&user.role==='professeur')?'none':'flex';
  // Créer — profs seulement
  if(user&&user.role==='professeur'){
    var bniAdd=g('bniAdd');if(bniAdd)bniAdd.style.display='flex';
  }
}

function goExplore(){
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg'),pgFav=g('pgFav');
  if(pgExp)pgExp.classList.add('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  if(pgFav)pgFav.classList.remove('on');
  ['bniExp','bniFav','bniMsg','bniAcc'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
  var b=g('bniExp');if(b)b.classList.add('on');
  restoreNav();
}

// Démarrage
(function(){
  try{
    var saved=localStorage.getItem('cp_user');
    if(saved){
      var parsedUser=JSON.parse(saved);
      // Guest = pas de session persistante → ramener à l'écran login
      if(parsedUser.guest){
        localStorage.removeItem('cp_user');
        loadData().then(function(){buildCards();});
        return;
      }
      // Session sans token JWT (avant mise à jour sécurité) → forcer reconnexion
      if(!parsedUser.token){
        localStorage.removeItem('cp_user');
        loadData().then(function(){buildCards();});
        return;
      }
      // Utilisateur connecté → restaurer la session
      user=parsedUser;
      _scheduleTokenRefresh();
      applyUser();
      if(user.id){
        Promise.all([
          fetch(API+'/reservations/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
          fetch(API+'/follows/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];})
        ]).then(function(results){
          var resData=results[0],folData=results[1];
          Object.keys(res).forEach(function(k){delete res[k];});
          if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}}
          // Vider le cache P{} pour éviter les données fantômes d'une ancienne session
          Object.keys(P).forEach(function(k){delete P[k]});
          fol.clear();
          favCours.clear();try{localStorage.removeItem('cp_fav_cours');}catch(e){};
          if(Array.isArray(folData)){folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});}
          updateFavBadge();
          // Si l'onglet Suivis est actif, re-render maintenant que fol est chargé
          if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
          // Toujours re-render après chargement (peu importe l'onglet actif)
          setTimeout(function(){
            if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
          },200);
          loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();checkProfDeepLink();setTimeout(checkCoursANoter,3000);if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
        }).catch(function(){loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();});});
      } else {
        loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();});
      }
    } else {
      // Pas de session → si retour OAuth attendre la session; sinon écran login
      if(_isOAuthReturn){
        // Masquer login, afficher spinner pendant le traitement OAuth
        var _lel=document.getElementById('login');
        if(_lel){
          var _lsL=document.getElementById('lsLogin'),_lsR=document.getElementById('lsReg');
          if(_lsL)_lsL.style.display='none';
          if(_lsR)_lsR.style.display='none';
          var _sp=document.createElement('div');
          _sp.id='oauthLoading';
          _sp.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px"><div style="width:36px;height:36px;border:3px solid #eee;border-top-color:#FF6B2B;border-radius:50%;animation:cpSpin .8s linear infinite"></div><p style="font-size:14px;color:#888;font-family:inherit;margin:0">Connexion en cours...</p></div>';
          _lel.appendChild(_sp);
        }
        _initSupabase(); // lancer immédiatement sans attendre DOMContentLoaded
      }
      loadData().then(function(){buildCards();});
    }
  }catch(e){loadData().then(function(){buildCards();});}
})();

async function checkStripeReturn(){
  try{
    var params=new URLSearchParams(window.location.search);
    var paid=params.get('paid');
    var cancelled=params.get('cancelled');
    var coursId=params.get('cours_id');
    var pourAmi=params.get('ami')==='1';
    window.history.replaceState({},'',window.location.pathname);

    if(cancelled){
      setTimeout(function(){
        var p=document.getElementById('popupFailed');
        if(p)p.style.display='flex';
      },400);
      return;
    }

    // Retour configuration bancaire
    if(params.get('stripe_connected')){
      window.history.replaceState({},'',window.location.pathname);
      toast('Paiements activés ✓','Vous allez recevoir vos virements automatiquement');
      setTimeout(function(){navTo('acc');if(user&&user.role==='professeur'){var tabRev=g('aTabRev');if(tabRev)tabRev.click();}},800);
      return;
    }
    if(params.get('stripe_refresh')){
      window.history.replaceState({},'',window.location.pathname);
      toast('Configuration requise','Finalisez votre configuration bancaire pour recevoir les paiements');
      return;
    }
    // Deep link ?cours=ID — ouvrir directement la fiche du cours
    var directProf = params.get('prof');
    if(directProf){
      window.history.replaceState({},'',window.location.pathname);
      setTimeout(function(){openPr(directProf);},600);
    }
    var directCours = params.get('cours');
    if(directCours && !paid){
      window.history.replaceState({},'',window.location.pathname);
      // Attendre que les cours soient chargés
      function tryOpenCours(){
        var c=C.find(function(x){return x.id==directCours;});
        if(c){openR(c.id);}
        else{toast('Cours introuvable','Ce lien n\'est plus valide');}
      }
      if(C.length){tryOpenCours();}
      else{setTimeout(tryOpenCours,1200);}
      return;
    }
    if(!paid||!coursId){checkPrivateCoursAccess();return;}
    localStorage.removeItem('cp_stripe_pending');
    if(!pourAmi){res[coursId]=true;try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}}
    await loadData();
    buildCards();
    setTimeout(function(){
      var p=document.getElementById('popupPaid');
      var msg=document.getElementById('popupPaidMsg');
      if(msg)msg.textContent=pourAmi?'La place supplémentaire a été réservée. Un email de confirmation a été envoyé.':'Votre place est réservée. Un email de confirmation vous a été envoyé.';
      window._paidCoursId=coursId;
      var calBtn=document.getElementById('popupPaidCalBtn');
      if(calBtn)calBtn.style.display=pourAmi?'none':'flex';
      if(p){p.style.display='flex';haptic(40);}
      var icon=p?p.querySelector('div[style*="F0FDF4"]'):null;
      if(icon){icon.style.transform='scale(0)';icon.style.transition='transform .5s cubic-bezier(.34,1.56,.64,1)';requestAnimationFrame(function(){requestAnimationFrame(function(){icon.style.transform='scale(1)';});});}
    },400);
  }catch(e){console.log('Payment return error:',e);}
}

function shake(id){var e=g(id);e.style.animation='shake .3s';setTimeout(function(){e.style.animation=''},400);}

// PAGES
function goAccount(){
  if(!user)return;
  g('pgExp').classList.remove('on');
  g('pgMsg').classList.remove('on');
  var pgFavEl=g('pgFav');if(pgFavEl)pgFavEl.classList.remove('on');
  g('pgAcc').classList.add('on');
  setAvatar(g('accAv'),user.photo,user.ini,'rgba(255,255,255,.25)');
  var accName=g('accName'); if(accName)accName.textContent=user.pr+(user.nm?' '+user.nm:'');
  var accEmail=g('accEmail'); if(accEmail)accEmail.textContent=user.em;
  var pfPr=g('pfPr'),pfNm=g('pfNm'),pfEm=g('pfEm'),pfVille=g('pfVille'),pfBio=g('pfBio');
  if(pfPr)pfPr.value=user.pr||'';if(pfNm)pfNm.value=user.nm||'';if(pfEm)pfEm.value=user.em||'';
  if(pfVille)pfVille.value=user.ville||'';if(pfBio)pfBio.value=user.bio||'';
  var roleDisplay=g('pfRoleDisplay');
  if(roleDisplay)roleDisplay.textContent=user.role==='professeur'?'👨‍🏫 Professeur':'🎓 Élève';
  var pfProfExtra=g('pfProfExtra');
  if(user.role==='professeur'){
    if(pfProfExtra)pfProfExtra.style.display='block';
    var pfSt=g('pfStatut'),pfNiv=g('pfNiveau'),pfMat=g('pfMatieres');
    if(user.statut){
      var stInp=g('pfStatut');if(stInp)stInp.value=user.statut;
      var stLbl=g('pfStatutLabel');
      if(stLbl){var stOpt=_STATUT_OPTIONS.filter(function(o){return o.val===user.statut;})[0];if(stOpt)stLbl.textContent=stOpt.label;}
      updateNiveauxPf(user.statut);
      if(user.niveau){
        var nivInp=g('pfNiveau');if(nivInp)nivInp.value=user.niveau;
        var nivLbl=g('pfNiveauValLabel');if(nivLbl)nivLbl.textContent=user.niveau;
      }
    }
    // Initialiser les chips matières
    initMatieresChips(user.matieres||'');
    if(pfMat&&user.matieres)pfMat.value=user.matieres;
  } else {
    if(pfProfExtra)pfProfExtra.style.display='none';
  }
  buildAccLists();
  // Refresh stats depuis le serveur (background) — données fraîches à chaque visite
  if(user&&user.id&&!user.guest){
    Promise.all([
      fetch(API+'/profiles/'+user.id+'?t='+Date.now(),{cache:'no-store',headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}),
      fetch(API+'/reservations/'+user.id,{cache:'no-store',headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}),
      fetch(API+'/follows/'+user.id,{cache:'no-store',headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;})
    ]).then(function(results){
      var prof=results[0],resData=results[1],folData=results[2];
      if(prof&&prof.id){
        // Sync TOUS les champs (fix : données stales depuis localStorage sur autre appareil)
        if(prof.prenom)user.pr=prof.prenom;
        if(prof.nom!==undefined)user.nm=prof.nom||'';
        if(prof.photo_url)user.photo=prof.photo_url;
        if(prof.bio!==undefined)user.bio=prof.bio||'';
        if(prof.ville!==undefined)user.ville=prof.ville||'';
        if(prof.statut!==undefined)user.statut=prof.statut||'';
        if(prof.niveau!==undefined)user.niveau=prof.niveau||'';
        if(prof.matieres!==undefined)user.matieres=prof.matieres||'';
        user.nbEleves=prof.nb_eleves||0;
        user.noteMoyenne=prof.note_moyenne?parseFloat(prof.note_moyenne).toFixed(1):null;
        user.ini=((user.pr&&user.pr[0]?user.pr[0]:'')+(user.nm&&user.nm[0]?user.nm[0]:'')).toUpperCase()||'U';
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Re-rendre le header avatar + nom (maintenant à jour depuis BDD)
        var _accName=g('accName');if(_accName)_accName.textContent=user.pr+(user.nm?' '+user.nm:'');
        var _accAv=g('accAv');
        setAvatar(_accAv,user.photo,user.ini,'rgba(255,255,255,.25)');
      }
      if(Array.isArray(resData)){
        Object.keys(res).forEach(function(k){delete res[k];});
        resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});
        try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}
      }
      if(Array.isArray(folData)){
        fol.clear();
        folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});
      }
      buildAccLists();
    }).catch(function(){});
  }
  // Onglet et carte Revenus visibles uniquement pour les profs
  var tabRev = g('aTabRev');
  if(tabRev)tabRev.style.display=(user&&user.role==='professeur')?'flex':'none';
  var cr=g('accCardRev');
  if(cr)cr.style.display=(user&&user.role==='professeur')?'block':'none';
  // Afficher le statut des notifications push
  setTimeout(renderNotifStatus, 100);
  // Statut vérification
  updateVerifStatusBlock();
  // Afficher les préférences notif si push actif
  var notifTypes = g('notifTypes');
  if (notifTypes) notifTypes.style.display = (_pushSubscription) ? 'block' : 'none';
  // Rôle pill
  var rp = g('accRolePill');
  if (rp) rp.textContent = (user.role==='professeur') ? '👨‍🏫 Professeur' : '👤 Élève';
  // Sync bouton dark mode
  updateDarkBtn();
}

function switchATab(s,el){
  ['R','F','H','P','Rev'].forEach(function(x){
    var sec=g('asec'+x),tab=g('aTab'+x);
    if(sec)sec.classList.remove('on');
    if(tab)tab.classList.remove('on');
  });
  var sec=g('asec'+s);
  if(sec){
    sec.style.animation='none';
    sec.classList.add('on');
    // Force reflow pour relancer l'animation
    void sec.offsetWidth;
    sec.style.animation='';
  }
  el.classList.add('on');
  // Vibration légère
  if(navigator.vibrate)navigator.vibrate(6);
  if(s==='Rev'){loadRevenues();loadStripeConnectStatus();}
  if(s==='P'){setTimeout(renderNotifStatus,100);updateVerifStatusBlock();}
  if(s==='H'){buildHistorique();}
  if(s==='R'){ buildAccLists(); }
  if(s==='F'){ buildAccLists(); }
}

function buildAccLists(){
  var rIds=Object.keys(res),fIds=Array.from(fol);
  // Stats dans le hero
  var isProf=user&&user.role==='professeur';
  var stats=g('accStats');
  if(stats){
    var nbCours=isProf?C.filter(function(c){return c.pr===user.id;}).length:0;
    if(isProf){
      stats.innerHTML=
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div id="accStatCoursVal" style="font-size:22px;font-weight:800;color:var(--or)">'+nbCours+'</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Cours</div></div>'+
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div id="accStatElevesVal" style="font-size:22px;font-weight:800;color:var(--or)">'+(user.nbEleves!==undefined?user.nbEleves:0)+'</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Élèves</div></div>'+
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div id="accStatNoteVal" style="font-size:22px;font-weight:800;color:var(--or)">'+(user.noteMoyenne?'★\u00a0'+user.noteMoyenne:'—')+'</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Note</div></div>';
    } else {
      stats.innerHTML=
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="font-size:22px;font-weight:800;color:var(--or)">'+rIds.length+'</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Réservés</div></div>'+
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="font-size:22px;font-weight:800;color:var(--or)">'+fIds.length+'</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Suivis</div></div>'+
        '<div style="background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="font-size:22px;font-weight:800;color:var(--or)">0</div><div style="font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Total</div></div>';
    }
  }
  // Rôle pill
  var rp=g('accRolePill');
  if(rp)rp.textContent=isProf?'👨‍🏫 Professeur':'👤 Élève';
  var lr=g('listR');
  // ── Section "Mes cours créés" pour les professeurs ──
  var profCoursHtml='';
  if(isProf){
    var myC=C.filter(function(c){return c.pr===user.id;});
    profCoursHtml='<div style="padding:20px 20px 0">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      +'<div style="width:28px;height:28px;background:rgba(255,107,43,.1);border-radius:8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg></div>'
      +'<div style="font-size:13px;font-weight:800;color:var(--ink)">Mes cours créés</div>'
      +'</div>';
    if(!myC.length){
      profCoursHtml+='<div style="background:var(--bg);border-radius:16px;padding:20px;text-align:center">'
        +'<div style="font-size:13px;color:var(--lite);margin-bottom:12px">Vous n\'avez pas encore créé de cours</div>'
        +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:10px 20px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer">Créer un cours →</button>'
        +'</div>';
    } else {
      profCoursHtml+='<div style="display:flex;gap:12px;overflow-x:auto;padding:8px 10px 18px;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:-8px -10px -18px;">';
      myC.forEach(function(c){
        var mat=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
        var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
        var pct=c.sp>0?Math.round(c.fl/c.sp*100):0;
        var isFull=c.fl>=c.sp;
        profCoursHtml+='<div class="fav-cours-card" onclick="openR(\''+esc(c.id)+'\')">'
          +'<div class="fav-cours-card-top" style="background:'+mat.bg+'">'
          +'<span style="background:rgba(0,0,0,.18);backdrop-filter:blur(6px);color:#fff;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">'+esc(c.subj)+'</span>'
          +(isFull?'<span style="background:rgba(34,192,105,.25);color:#22C069;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:700">Complet</span>':'<span style="background:rgba(0,0,0,.15);color:#fff;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:600">'+c.fl+'/'+c.sp+'</span>')
          +'</div>'
          +'<div class="fav-cours-card-body">'
          +'<div class="fav-cours-card-title">'+esc(c.title)+'</div>'
          +'<div class="fav-cours-card-meta">📅 '+esc(c.dt)+'</div>'
          +'<div class="fav-cours-card-price">'+pp+'€<span> / élève</span></div>'
          +'<div style="margin-top:8px;height:4px;background:var(--bg);border-radius:4px;overflow:hidden">'
          +'<div style="height:100%;width:'+pct+'%;background:'+(isFull?'#22C069':'var(--or)')+';border-radius:4px"></div>'
          +'</div>'
          +'<button onclick="event.stopPropagation();addToCalendar(\''+esc(c.id)+'\')" style="margin-top:10px;width:100%;padding:7px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:10px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>Calendrier</button>'
          +'</div>'
          +'</div>';
      });
      profCoursHtml+='</div>';
    }
    profCoursHtml+='</div>'
      +'<div style="display:flex;align-items:center;gap:8px;padding:20px 20px 10px">'
      +'<div style="width:28px;height:28px;background:rgba(59,130,246,.1);border-radius:8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg></div>'
      +'<div style="font-size:13px;font-weight:800;color:var(--ink)">Mes réservations</div>'
      +'</div>';
  }
  lr.innerHTML=profCoursHtml;
  if(!rIds.length){lr.innerHTML+=isProf
    ?'<div style="padding:0 20px 20px;font-size:13px;color:var(--lite)">Aucune réservation à venir</div>'
    :'<div style="text-align:center;padding:40px 20px">'
    +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="30" height="30"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'
    +'</div>'
    +'<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun cours à venir</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:20px">Réservez votre premier cours<br>et retrouvez-le ici</div>'
    +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
    +'</div>';}
  else{
    var now=new Date();
    lr.innerHTML+=rIds.map(function(id){
      var c=C.find(function(x){return x.id==id});if(!c)return'';
      var isPast=false;
      try{
        var _dtParsed=new Date(c.dt_iso||c.dt);
        if(!isNaN(_dtParsed))isPast=_dtParsed<now;
        else{var diffMs=now-new Date(c.created_at||now);isPast=diffMs>24*60*60*1000;}
      }catch(e){}
      var noteBtn=isPast&&user&&user.role!=='professeur'?
        '<button onclick="event.stopPropagation();openNote(C.find(function(x){return x.id==\''+c.id+'\'}))" style="background:var(--orp);color:var(--or);border:none;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit">⭐ Noter</button>':'';
      var _mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
      var _isDk=document.documentElement.classList.contains('dk');
      var _bg=_isDk?_mf.bgDark:_mf.bg;
      var _color=_mf.color;
      var _ph=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;
      var _ini=c.prof_ini||(c.prof_nm?c.prof_nm[0]:'?');
      var _phHtml=_ph?'<img src="'+esc(_ph)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':'<span style="font-size:9px;font-weight:700;color:#fff">'+esc(_ini)+'</span>';
      var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
      var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
      return'<div onclick="openR(\''+c.id+'\')" style="background:var(--wh);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);border:1px solid var(--bdr);margin:0 20px 12px;cursor:pointer;transition:opacity .15s;active:opacity:.8" onmousedown="this.style.opacity=\'.85\'" onmouseup="this.style.opacity=\'1\'" onmouseleave="this.style.opacity=\'1\'">'
        // Bande colorée + matière + titre
        +'<div style="background:'+_bg+';padding:14px 16px 12px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:'+_color+'">'+esc(c.subj)+'</span>'
        +(isPast?'<span class="rbadge bdone" style="font-size:10px">Terminé</span>':'<span class="rbadge bup" style="font-size:10px">À venir</span>')
        +'</div>'
        +'<div style="font-size:15px;font-weight:800;color:var(--ink);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+esc(c.title)+'</div>'
        +'</div>'
        // Corps : date + lieu + prof + prix
        +'<div style="padding:10px 16px 14px">'
        +'<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap">'
        +'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(c.dt)+'</span>'
        +(_isVisio?'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Visio</span>':'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(c.lc)+'</span>')
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:8px">'
        +'<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#FF8C55,var(--ord));display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0" data-prof="'+c.pr+'">'+_phHtml+'</div>'
        +'<span data-profnm="'+c.pr+'" style="font-size:12px;color:var(--mid);font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc((P[c.pr]&&P[c.pr].nm)||c.prof_nm||'Professeur')+'</span>'
        +(pp?'<span style="font-size:13px;font-weight:800;color:var(--or)">'+pp+'€<span style="font-size:10px;font-weight:500;color:var(--lite)"> / élève</span></span>':'')
        +(noteBtn?'<span>'+noteBtn+'</span>':'')
        +'</div>'
        +'</div>'
        +'</div>';
    }).join('');
  }
  // Swipe sur les cours à venir
  setTimeout(function(){
    if(g('listR'))g('listR').querySelectorAll('.rrow').forEach(function(el){
      initSwipeCancel(el,function(){toast('Réservation annulée','Contactez le professeur pour confirmation');});
    });
  },200);
  var lf=g('listF');
  if(!lf) return;
  // Forcer la visibilité même si parent est display:none
  lf.style.display='block';
  lf.style.minHeight='10px';
  if(!fIds.length){
    lf.innerHTML='<div style="text-align:center;padding:48px 24px">'
      +'<div style="position:relative;width:80px;height:80px;margin:0 auto 20px">'
      +'<div style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.6" stroke-linecap="round" width="36" height="36"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
      +'</div>'
      +'<div style="position:absolute;bottom:0;right:0;width:26px;height:26px;background:var(--or);border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid var(--bg)">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'
      +'</div></div>'
      +'<div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em">Aucun professeur suivi</div>'
      +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px">Suivez vos profs préférés pour être<br>alert\u00e9 d\u00e8s qu\'un nouveau cours est publi\u00e9.</div>'
      +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
      +'</div>';
  } else {
    var folRows=fIds.map(function(id,i){
      var p=P[id];
      if(!p){
        // Construire un profil minimal depuis les cours pour éviter les "fantômes"
        var _cc=C.filter(function(x){return x.pr===id;});
        if(_cc.length){
          p={nm:_cc[0].prof_nm||'Professeur',i:_cc[0].prof_ini||'?',col:'linear-gradient(135deg,#FF8C55,#E04E10)',e:0,photo:_cc[0].prof_photo||null};
        } else {
          p={nm:'Professeur',i:'?',col:'linear-gradient(135deg,#FF8C55,#E04E10)',e:0};
        }
        P[id]=p;
        _fetchProf(id);
      }
      var cours=C.filter(function(c){return c.pr===id;});
      var matieres=cours.length?[...new Set(cours.map(function(c){return c.subj;}))].slice(0,2).join(', '):'';
      var prochainCours=cours.filter(function(c){return c.fl<c.sp;}).length;
      var av=p.photo?'<img src="'+p.photo+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=1">':
        '<span style="font-size:15px;font-weight:800;color:var(--or)">'+p.i+'</span>';
      var border=i<fIds.length-1?'border-bottom:1px solid var(--bdr)':'';
      var dispoLabel=prochainCours?' · <span style="color:var(--or);font-weight:600">'+prochainCours+' cours dispo</span>':'';
      return'<div onclick="openPr(\''+id+'\')" class="fol-row" data-prof-id="'+id+'" style="'+border+'">'
        +'<div style="width:46px;height:46px;border-radius:50%;background:'+p.col+';display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">'+av+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:15px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.nm+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+(matieres||'Professeur')+dispoLabel+'</div>'
        +'</div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--bdr)" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
    }).join('');
    if(!folRows.trim()){
      // Tous les P[id] sont null — afficher empty state via innerHTML
      lf.innerHTML='<div style="text-align:center;padding:48px 24px">'
        +'<div style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.6" stroke-linecap="round" width="36" height="36"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
        +'</div>'
        +'<div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em">Aucun professeur suivi</div>'
        +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px">Suivez vos profs préférés pour être<br>alerté dès qu\'un nouveau cours est publié.</div>'
        +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
        +'</div>';
    } else {
      lf.innerHTML='<div style="background:var(--wh);border-radius:16px;overflow:hidden">'+folRows+'</div>';
    }
  }
}

function setPfRole(role){
  g('pfRolEl').classList.toggle('on',role==='eleve');
  g('pfRolPf').classList.toggle('on',role==='professeur');
  g('pfProfExtra').style.display=role==='professeur'?'block':'none';
}

function saveProf(){
  if(!user)return;
  user.pr=g('pfPr').value||user.pr;user.nm=g('pfNm').value||'';
  user.em=g('pfEm').value||user.em;user.ville=g('pfVille').value||'';
  user.bio=g('pfBio').value||'';
  // Ne pas changer le rôle
  user.ini=((user.pr&&user.pr[0]?user.pr[0]:'')+(user.nm&&user.nm[0]?user.nm[0]:'')).toUpperCase()||'U';
  if(user.role==='professeur'){
    if(g('pfStatut'))user.statut=g('pfStatut').value;
    if(g('pfNiveau'))user.niveau=g('pfNiveau').value;
    // Lire les matières depuis les chips (source de vérité = _matieres[])
    user.matieres=_matieres.join(', ');
    var matHid=g('pfMatieresVal');if(matHid)matHid.value=user.matieres;
  }
  // Sync P[] et C[] immédiatement pour que openPr() reflète les changements sans rechargement
  if(user.id){
    var _fullNm=(user.pr||'')+(user.nm?' '+user.nm:'');
    if(!P[user.id])P[user.id]={};
    if(_fullNm)P[user.id].nm=_fullNm;
    P[user.id].i=user.ini||P[user.id].i;
    P[user.id].bio=user.bio||'';
    if(user.statut!==undefined)P[user.id].statut=user.statut;
    if(user.niveau!==undefined)P[user.id].niveau=user.niveau;
    if(user.matieres!==undefined)P[user.id].matieres=user.matieres;
    if(user.photo)P[user.id].photo=user.photo;
    // Sync C[] pour que dernierCours.prof_nm soit à jour dans openPr()
    C.forEach(function(c){
      if(c.pr===user.id){
        if(_fullNm)c.prof_nm=_fullNm;
        c.prof_ini=user.ini;
        if(user.photo)c.prof_photo=user.photo;
      }
    });
  }
  try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
  // Pousser vers le serveur (Supabase via Railway)
  if(user.id){
    var payload={prenom:user.pr,nom:user.nm,bio:user.bio||'',ville:user.ville||''};
    if(user.role==='professeur'){
      payload.statut=user.statut||'';
      payload.niveau=user.niveau||'';
      payload.matieres=user.matieres||'';
    }
    fetch(API+'/profiles/'+user.id,{
      method:'PATCH',
      headers:apiH(),
      body:JSON.stringify(payload)
    }).then(function(r){return r.json();}).then(function(data){
      // Resync user depuis la réponse serveur pour éviter désync
      if(data&&data.profile){
        if(data.profile.matieres!==undefined)user.matieres=data.profile.matieres;
        if(data.profile.statut!==undefined)user.statut=data.profile.statut;
        if(data.profile.niveau!==undefined)user.niveau=data.profile.niveau;
        if(data.profile.bio!==undefined)user.bio=data.profile.bio;
        if(data.profile.ville!==undefined)user.ville=data.profile.ville;
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Re-render les chips avec la valeur confirmée par le serveur
        if(user.role==='professeur') initMatieresChips(user.matieres||'');
      }
    }).catch(function(){toast('Erreur réseau','Profil non sauvegardé sur le serveur');});
  }
  // Mettre à jour UI sans quitter la page profil
  setAvatar(g('tav'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
  setAvatar(g('tavMob'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
  var an=g('accName');if(an)an.textContent=user.pr+(user.nm?' '+user.nm:'');
  var ae=g('accEmail');if(ae)ae.textContent=user.em;
  setAvatar(g('accAv'),user.photo,user.ini,'rgba(255,255,255,.2)');
  toast('Profil sauvegardé ✓','');
  // Sync photo partout si présente
  if(user&&user.photo) _applyPhotoPartout(user.photo);
}

function doLogout(){
  user=null;
  _tutoLaunched=false;
  clearInterval(msgBadgePollTimer);msgBadgePollTimer=null;
  _stopAutoRefresh();
  try{localStorage.removeItem('cp_user');}catch(e){}
  try{localStorage.removeItem('cp_res');}catch(e){}
  try{localStorage.removeItem('cp_fav_cours');}catch(e){}
  try{localStorage.removeItem('cp_profs');}catch(e){}
  try{localStorage.removeItem('cp_follow_counts');}catch(e){}
  Object.keys(res).forEach(function(k){delete res[k]});fol.clear();favCours.clear();Object.keys(P).forEach(function(k){delete P[k]});
  // Cacher la bnav immédiatement
  var bnav=g('bnav');if(bnav)bnav.classList.remove('on');
  // Restaurer les items bnav pour la prochaine connexion
  var bniMsg=g('bniMsg'),bniAcc=g('bniAcc'),bniAdd=g('bniAdd');
  if(bniMsg)bniMsg.style.display='';
  if(bniAcc)bniAcc.style.display='';
  if(bniAdd)bniAdd.style.display='none';
  // Reset avatar
  var tav=g('tav');if(tav){tav.style.background='linear-gradient(135deg,#FF8C55,var(--ord))';tav.textContent='?';}
  var tavM=g('tavMob');if(tavM){tavM.style.background='linear-gradient(135deg,#FF8C55,var(--ord))';tavM.textContent='?';}
  // Reset état nav
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg');
  if(pgExp)pgExp.classList.add('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  // Afficher login, cacher app
  g('app').style.display='none';
  var login=g('login');
  if(login){login.style.display='flex';login.style.zIndex='999';login.style.pointerEvents='';}
  // Supprimer le spinner OAuth si présent (connexion OAuth précédente)
  var oauthSpinner=document.getElementById('oauthLoading');
  if(oauthSpinner)oauthSpinner.remove();
  // S'assurer que l'écran de connexion est visible (peut être caché après un OAuth)
  showLogin();
  // Sign out Supabase si OAuth actif
  if(window._supabase)window._supabase.auth.signOut().catch(function(){});
  // Nettoyer l'URL si retour OAuth
  if(window.location.search||window.location.hash){
    window.history.replaceState({},'',window.location.pathname);
  }
  toast('Déconnecté','À bientôt !');
}

// PHOTO - Upload vers Supabase Storage
function compressImage(file,maxSizeMB,cb){
  var maxBytes=maxSizeMB*1024*1024;
  if(file.size<=maxBytes){cb(file);return;}
  var reader=new FileReader();
  reader.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var canvas=document.createElement('canvas');
      var ratio=Math.sqrt(maxBytes/file.size);
      canvas.width=Math.round(img.width*ratio);
      canvas.height=Math.round(img.height*ratio);
      var ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      canvas.toBlob(function(blob){
        cb(new File([blob],file.name,{type:'image/jpeg'}));
      },'image/jpeg',0.85);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

// Applique une photo partout dans le DOM sans reconstruire les cards
function _applyPhotoPartout(url){
  if(!user||!user.id||!url)return;
  // 1. Avatars header
  var imgRound='<img src="'+url+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  var imgSquare='<img src="'+url+'" style="width:100%;height:100%;object-fit:cover">';
  var tav=g('tav');if(tav){tav.style.background='none';tav.innerHTML=imgRound;}
  var tavM=g('tavMob');if(tavM){tavM.style.background='none';tavM.innerHTML=imgRound;}
  var accAv=g('accAv');if(accAv){accAv.style.background='none';accAv.innerHTML=imgRound;}
  // 2. TOUS les éléments [data-prof] dans le DOM (cards, fol-row, rrow, etc.)
  document.querySelectorAll('[data-prof="'+user.id+'"]').forEach(function(el){
    el.style.background='none';
    el.innerHTML=el.classList.contains('pbub')?imgSquare:imgSquare;
  });
  // 3. Cache P[] et C[] pour que buildCards() utilise la bonne photo
  if(!P[user.id])P[user.id]={};
  P[user.id].photo=url;
  C.forEach(function(cours){if(cours.pr===user.id)cours.prof_photo=url;});
  // 4. Avatar dans la fiche prof ouverte (bdPr) si c'est le même prof
  var mpav=g('mpav');
  if(mpav&&curProf===user.id){mpav.style.background='none';mpav.innerHTML=imgSquare;}
  // 5. Avatar dans le modal réservation si c'est le prof du cours courant
  var rAv=g('rProfAv');
  if(rAv&&curId){var cc=C.find(function(x){return x.id==curId;});if(cc&&cc.pr===user.id){rAv.style.background='none';rAv.innerHTML=imgSquare;}}
  // 6. Avatars dans la liste de conversations
  document.querySelectorAll('[data-uid="'+user.id+'"] .msg-av').forEach(function(el){
    el.style.background='none';el.innerHTML=imgSquare;
  });
  // 7. Avatar dans la conversation active
  var convAv=g('msgConvAv');
  if(convAv&&msgDestId===user.id){convAv.style.background='none';convAv.innerHTML=imgRound;}
}

function previewPhoto(input){
  if(input.files&&input.files[0]){
    var file=input.files[0];
    if(file.size>2*1024*1024){
      toast('Photo trop lourde','Maximum 2MB. Compressez votre image.');
      input.value='';return;
    }
    var reader=new FileReader();
    reader.onload=function(e){
      var src=e.target.result;
      // Appliquer la preview base64 immédiatement partout
      _applyPhotoPartout(src);
      // Uploader vers Supabase
      if(user&&user.id){
        fetch(API+'/upload/photo',{
          method:'POST',
          headers:apiH(),
          body:JSON.stringify({base64:src,userId:user.id,filename:file.name})
        }).then(function(r){return r.json();}).then(function(data){
          if(data.url){
            user.photo=data.url;
            try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
            // Remplacer la base64 par l'URL Supabase définitive
            _applyPhotoPartout(data.url);
            toast('Photo mise à jour ✓','');
          }
        }).catch(function(){toast('Erreur','Impossible d\'uploader la photo');});
      }
    };
    reader.readAsDataURL(file);
  }
}

// CARDS
// ── Fetch frais d'un profil (une seule fois par session via _fresh) ──
// Met à jour P[], C[], et tous les éléments DOM portant data-prof / data-profnm
function _fetchProf(pid){
  if(!pid)return;
  if(P[pid]&&P[pid]._fresh)return;
  fetch(API+'/profiles/'+pid+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(prof){
    if(!prof||!prof.id)return;
    var pr2=prof.prenom||'';var no2=prof.nom||'';
    var nm2=(pr2+(no2?' '+no2:'')).trim();
    if(!P[pid])P[pid]={n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
    P[pid]._fresh=true;
    if(nm2){
      P[pid].nm=nm2;
      P[pid].i=((pr2[0]||'')+(no2[0]||'')).toUpperCase()||'?';
      C.forEach(function(c){if(c.pr===pid)c.prof_nm=nm2;});
      document.querySelectorAll('[data-profnm="'+pid+'"]').forEach(function(el){el.textContent=nm2;});
    }
    if(prof.photo_url){
      P[pid].photo=prof.photo_url;
      C.forEach(function(c){if(c.pr===pid)c.prof_photo=prof.photo_url;});
      document.querySelectorAll('[data-prof="'+pid+'"]').forEach(function(el){
        el.style.background='none';
        el.innerHTML='<img src="'+esc(prof.photo_url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      });
    }
    // Mettre à jour le compteur d'abonnés depuis l'API (synchronisation inter-comptes)
    var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
    if(_nbE!==undefined&&_nbE>0){
      P[pid].e=Math.max(_nbE,P[pid].e||0);
      _saveFollowCount(pid,P[pid].e);
    }
    // Persister dans localStorage pour que le prochain chargement démarre avec des données fraîches
    try{
      var _pc=JSON.parse(localStorage.getItem('cp_profs')||'{}');
      _pc[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||'',e:P[pid].e||0};
      localStorage.setItem('cp_profs',JSON.stringify(_pc));
    }catch(ex){}
    // Mettre à jour le header de conversation si c'est l'interlocuteur actif
    if(pid===msgDestId){
      var _hn=g('msgConvName');if(_hn&&nm2)_hn.textContent=nm2;
      var _hav=g('msgConvAv');
      if(_hav&&prof.photo_url&&!_hav.querySelector('img')){_hav.style.background='none';_hav.innerHTML='<img src="'+esc(prof.photo_url)+'" style="width:100%;height:100%;object-fit:cover">';}
    }
    // Rafraîchir la liste des suivis si l'onglet est visible (profs fantômes)
    if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
  }).catch(function(){});
}
function buildCards(){
  currentPage=1;
  var nc=g('nocard'),lmw=g('loadMoreWrap'),gr=g('grid');
  if(!C.length){
    // Éviter de re-render si nocard est déjà affiché (évite les sauts visuels)
    if(nc&&nc.style.display==='block')return;
    if(nc)nc.style.display='block';
    var nt=g('nocardTitle'),ns=g('nocardSub');
    if(nt)nt.textContent='Aucun cours disponible';
    if(ns)ns.textContent='Soyez le premier à proposer un cours !';
    if(lmw)lmw.style.display='none';
    if(gr)gr.innerHTML='';
    return;
  }
  if(nc)nc.style.display='none';
  applyFilter();
}

function applyFilter(){
  var mobInp=document.getElementById('mobSearchInput');
  var srchInp=document.getElementById('srch');
  var raw='';
  if(mobInp&&mobInp.value)raw=mobInp.value;
  else if(srchInp)raw=srchInp.value;
  raw=raw.trim();
  var q=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  filteredCards=C.filter(function(c){
    // Cours privés cachés sauf si propriétaire ou déjà réservé
    if(c.prive&&!(user&&c.pr===user.id)&&!res[c.id])return false;
    var title=(c.title||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var subj=(c.subj||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var loc=(c.lc||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var prof=(c.prof_nm||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var desc=(c.description||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var matchFilter=(FM[actF]||FM.tous)(c.t||'');
    // Recherche dans le nom du prof + toutes les données du cours
    var matchSearch=!q||(title.includes(q)||subj.includes(q)||loc.includes(q)||prof.includes(q)||desc.includes(q));
    // Si la recherche ne matche pas un cours, chercher aussi les profs par nom
    if(!matchSearch&&q.length>1){
      var profFull=(c.prof_nm||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      matchSearch=profFull.includes(q);
    }
    // Filtre localisation
    var matchLoc=true;
    if(geoMode&&_geoCoords&&c.lat&&c.lon){
      var dist=haversine(_geoCoords.lat,_geoCoords.lon,parseFloat(c.lat),parseFloat(c.lon));
      matchLoc=dist<=_geoDist;
    } else if(actLoc){
      matchLoc=loc.includes(actLoc);
    }
    var matchNiv=!actNiv||(c.niveau||'')=== actNiv;
    var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
    var matchMode=!actMode||(actMode==='visio'?_isVisio:!_isVisio);
    return matchFilter&&matchSearch&&matchLoc&&matchNiv&&matchMode;
  });
  updateResetBtn();
  renderPage();
}

function toggleFollowCard(pid,btn){
  if(!user||user.guest){toast('Connectez-vous pour suivre un professeur','');return;}
  if(!pid)return;
  var isFollowing=fol.has(pid);
  if(isFollowing){
    fol.delete(pid);
    _syncFollowBtns(pid,false);
    P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[pid].e=Math.max(0,(P[pid].e||1)-1);
    toast('Retiré des suivis','');
    fetch(API+'/follows',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data&&data.nb_eleves!==undefined){
          P[pid].e=data.nb_eleves;
          if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid].e;
          _saveFollowCount(pid,P[pid].e);
        }
      })
      .catch(function(){
        fol.add(pid);_syncFollowBtns(pid,true);
        P[pid]=P[pid]||{};P[pid].e=(P[pid].e||0)+1;
        if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
        _saveFollowCount(pid,P[pid].e||0);
        toast('Erreur réseau','Impossible de modifier le suivi');
      });
  } else {
    fol.add(pid);
    _syncFollowBtns(pid,true);
    P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[pid].e=(P[pid].e||0)+1;
    toast('Vous suivez ce professeur','Notifié dès son prochain cours');
    fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
      .then(function(r){return r.json();})
      .then(function(data){
        // Utiliser le vrai count serveur (source de vérité)
        if(data&&data.nb_eleves!==undefined){
          P[pid].e=data.nb_eleves;
          if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid].e;
          _saveFollowCount(pid,P[pid].e);
        }
      })
      .catch(function(){
        fol.delete(pid);_syncFollowBtns(pid,false);
        P[pid]=P[pid]||{};P[pid].e=Math.max(0,(P[pid].e||1)-1);
        if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
        _saveFollowCount(pid,P[pid].e||0);
        toast('Erreur réseau','Impossible de modifier le suivi');
      });
  }
  // Mettre à jour mpE immédiatement (valeur optimiste)
  if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
  // Persister le compteur dans le cache localStorage
  if(P[pid]){try{var _pc3=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc3[pid])_pc3[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||''};_pc3[pid].e=P[pid].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc3));}catch(ex){}_saveFollowCount(pid,P[pid].e||0);}
  updateFavBadge();
  haptic(8);
}

function renderPage(){
  var grid=g('grid');if(!grid)return;grid.innerHTML='';
  var sorted=sortCourses(filteredCards);
  var toShow=sorted.slice(0,currentPage*PAGE_SIZE);
  var sc=g('sortResultCount');if(sc)sc.textContent=filteredCards.length+' cours';
  var _nc=g('nocard'),_lmw=g('loadMoreWrap');
  if(!toShow.length){
    if(_nc)_nc.style.display='block';
    var _nt=g('nocardTitle'),_ns=g('nocardSub');
    if(_nt)_nt.textContent='Aucun cours trouvé';
    if(_ns)_ns.textContent='Essayez un autre filtre ou une autre ville';
    if(_lmw)_lmw.style.display='none';
    return;
  }
  // Compteur de résultats dans le sous-titre du header
  // result count removed
  if(_nc)_nc.style.display='none';
  toShow.forEach(function(c,i){
    var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
    var pct=c.sp>0?Math.round(c.fl/c.sp*100):0;
    var pleft=c.sp-c.fl;
    var bc=c.fl>=c.sp?'#ccc':pleft<=1?'#EF4444':pleft<=2?'var(--or)':'#22C069';
    var isR=!!res[c.id],isFull=c.fl>=c.sp;
    var isOwner=user&&c.pr===user.id;
    var btn;
    if(isOwner) btn='<button class="btnr" onclick="event.stopPropagation();openR(\''+c.id+'\')">Consulter</button>';
    else if(isR&&isFull) btn='<button class="btnres" onclick="event.stopPropagation();openO(\''+c.id+'\')" style="font-size:11px">Inscrit · Complet</button>';
    else if(isR) btn='<button class="btnres" onclick="event.stopPropagation();openO(\''+c.id+'\')" style="font-size:11.5px">Inscrit · Ajouter</button>';
    else if(isFull) btn='<button class="btnfull" onclick="event.stopPropagation();openF(\''+c.pr+'\',\''+c.title+'\')">Complet</button>';
    else btn='<button class="btnr" onclick="event.stopPropagation();openR(\''+c.id+'\')">Réserver</button>';
    var _isDark=document.documentElement.classList.contains('dk');
    var _pPhoto=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;
    var profAv=_pPhoto?'<img src="'+esc(_pPhoto)+'" style="width:100%;height:100%;object-fit:cover">':esc(c.prof_ini);
    var _mFound=findMatiere(c.subj||'');
    var _cardBg=_isDark?((_mFound&&_mFound.bgDark?_mFound.bgDark:c.bgDark)||c.bg):((_mFound?_mFound.bg:null)||c.bg);
    var d=document.createElement('div');
    d.className='card'+(c.prive?' card-prive':'');d.dataset.id=c.id;d.dataset.t=c.t;d.dataset.coursId=c.id;d.style.animationDelay=(i*.04)+'s';
    d.onclick=function(){if(isFull&&!isR){openF(c.pr,c.title);return;}openR(c.id);};
    var nivBadge=c.niveau?'<span style="display:inline-flex;align-items:center;background:rgba(0,0,0,.22);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.2);border-radius:50px;padding:3px 9px;font-size:9.5px;font-weight:700;color:#fff;margin-left:4px;letter-spacing:.03em;text-transform:uppercase">'+c.niveau+'</span>':'';
    var isNew=c.created_at&&(Date.now()-new Date(c.created_at).getTime()<86400000);
    var newBadge=isNew?'<span style="display:inline-flex;align-items:center;background:#FF6B2B;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:800;color:#fff;margin-left:6px;letter-spacing:.04em;animation:pulse 1.5s infinite">NOUVEAU</span>':'';
    var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
    var modeBadge=_isVisio
      ?'<span class="card-mode-badge visio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="9" height="9"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Visio</span>'
      :'<span class="card-mode-badge presentiel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="9" height="9"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Présentiel</span>';
    var descLine=c.description?'<div style="font-size:12px;color:var(--lite);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4">'+esc(c.description)+'</div>':'';
    var profData=P[c.pr]||{};
    var noteProf=profData.n&&profData.n!=='—'?profData.n:null;
    var ratingBadge=noteProf?'<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,0,0,.1);border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#fff;margin-left:6px">★ '+esc(noteProf)+'</span>':'';
    var heartHtml='';
    if(user&&!user.guest){
      var isSaved=favCours.has(c.id);
      heartHtml='<button class="card-heart-btn'+(isSaved?' saved':'')+'" onclick="event.stopPropagation();toggleFavCours(\''+c.id+'\',this)" title="Sauvegarder" aria-label="Sauvegarder ce cours"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></button>';
    }
    d.innerHTML='<div class="ctop" style="background:'+_cardBg+'"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:2px"><span class="chip" style="color:'+c.sc+'">'+esc(c.subj)+'</span>'+modeBadge+nivBadge+newBadge+'</div><div class="pbub" data-prof="'+c.pr+'" style="background:'+(_pPhoto?'none':c.prof_col)+'" onclick="event.stopPropagation();openPr(\''+c.pr+'\')">'+profAv+'</div>'+(user&&!user.guest&&!isOwner?'<button class="card-follow-btn" data-pid="'+c.pr+'" data-fol="'+(fol.has(c.pr)?'1':'0')+'" onclick="event.stopPropagation();toggleFollowCard(\''+c.pr+'\',this)" title="'+(fol.has(c.pr)?'Ne plus suivre':'Suivre ce professeur')+'" style="position:absolute;bottom:8px;right:8px;z-index:2;width:28px;height:28px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,'+(fol.has(c.pr)?'0.95':'0.85')+');color:'+(fol.has(c.pr)?'#FF6B2B':'var(--lite)')+'">'+( fol.has(c.pr)?'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>' )+'</button>':'')+'</div><div class="cbody"><div class="ctitle-row"><div class="ctitle">'+esc(c.title)+'</div>'+heartHtml+'</div>'+descLine+'<div class="cmeta"><div class="mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(fmtDt(c.dt))+'</div></div>'+(_isVisio?'':'<div class="ltag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(c.lc)+'</div>')+'<div class="cf"><div><div style="font-size:10px;color:var(--lite)">Prix / élève</div><div class="pm" style="font-size:22px;font-weight:800">'+pp+'€</div></div><div class="sw2"><div class="st"><span>Places</span><span style="color:'+bc+'">'+pleft+'/'+c.sp+'</span></div><div class="bar" style="height:5px"><div class="bf" style="width:'+pct+'%;background:'+bc+'">'+(pleft===1&&!isFull?'<div style="font-size:10px;color:#EF4444;font-weight:600">⚠ Dernière place !</div>':'')+'</div></div></div>'+btn+'</div></div>';
    grid.appendChild(d);
  });
  g('loadMoreWrap').style.display=filteredCards.length>currentPage*PAGE_SIZE?'block':'none';
  if(filteredCards.length>currentPage*PAGE_SIZE)g('loadMoreCount').textContent=(filteredCards.length-currentPage*PAGE_SIZE)+' cours restants';
}

function loadMore(){
  if(_allLoaded){currentPage++;renderPage();return;}
  if(_loadingMore)return;
  _loadingMore=true;
  _currentPage++;
  loadData(_currentPage).then(function(){
    _loadingMore=false;
    currentPage=1;
    renderPage();
  });
}

// ============================================================
// RÉFÉRENTIEL MATIÈRES — partagé formulaire + filtres
// ============================================================
var MATIERES = [
  {label:'Maths',          key:'maths',        color:'#3B82F6', bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)',         bgDark:'linear-gradient(135deg,#0F1F3D,#1E3A5F)'},
  {label:'Physique',       key:'physique',      color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)',         bgDark:'linear-gradient(135deg,#1A1035,#2D1F5E)'},
  {label:'Chimie',         key:'chimie',        color:'#34D399', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)',         bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'SVT / Biologie', key:'svt',           color:'#4ADE80', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)',         bgDark:'linear-gradient(135deg,#052E16,#0F4A24)'},
  {label:'Informatique',   key:'informatique',  color:'#FBBF24', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)',         bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Python',         key:'python',        color:'#FBBF24', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)',         bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Anglais',        key:'anglais',       color:'#F87171', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)',         bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Espagnol',       key:'espagnol',      color:'#F87171', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)',         bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Français',       key:'francais',      color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)',         bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Histoire-Géo',   key:'histoire',      color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)',         bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Philosophie',    key:'philo',         color:'#818CF8', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)',         bgDark:'linear-gradient(135deg,#0F1235,#1A1F5E)'},
  {label:'Économie',       key:'economie',      color:'#34D399', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)',         bgDark:'linear-gradient(135deg,#062318,#0A3D25)'},
  {label:'Droit',          key:'droit',         color:'#F87171', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)',         bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Musique',        key:'musique',       color:'#FCD34D', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)',         bgDark:'linear-gradient(135deg,#2D1F00,#4A3300)'},
  {label:'Arts plastiques',key:'arts',          color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)',         bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Sport / EPS',    key:'sport',         color:'#4ADE80', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)',         bgDark:'linear-gradient(135deg,#052E16,#0A3D20)'},
  {label:'Architecture',   key:'architecture',  color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)',         bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  {label:'Comptabilité',   key:'compta',        color:'#22D3EE', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)',         bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Marketing',      key:'marketing',     color:'#FB923C', bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)',         bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Statistiques',   key:'stats',         color:'#60A5FA', bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)',         bgDark:'linear-gradient(135deg,#0F1F3D,#1A3560)'},
  {label:'Autre',          key:'autre',         color:'#9CA3AF', bg:'linear-gradient(135deg,#F9FAFB,#F3F4F6)',         bgDark:'linear-gradient(135deg,#1A1A1A,#2A2A2A)'},
];

// Fonction pour normaliser une chaîne
function normStr(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

// Trouver la matière standardisée depuis un texte libre
function findMatiere(txt){
  var n=normStr(txt);
  return MATIERES.find(function(m){
    return n.includes(normStr(m.label))||n.includes(m.key)||normStr(m.label).includes(n);
  });
}

// Autocomplétion matière
function openMatFilter(){
  var bd=g('bdMatFilter');
  if(!bd)return;
  // Déplacer en fin de body pour éviter les problèmes de overflow parent
  if(bd.parentNode!==document.body)document.body.appendChild(bd);
  // Construire la liste
  var list=g('matFilterList');
  if(list){
    list.innerHTML=MATIERES.map(function(m,i){
      var isOn=(g('crSubjHidden')&&g('crSubjHidden').value===m.key);
      var border=i<MATIERES.length-1?'border-bottom:1px solid var(--bdr)':'';
      return'<div onclick="pickMatFromSheet(\''+m.key+'\',\''+m.label+'\',\''+m.color+'\')" style="display:flex;align-items:center;gap:12px;padding:13px 16px;cursor:pointer;transition:background .12s;'+border+'">'
        +'<div style="width:10px;height:10px;border-radius:50%;background:'+m.color+';flex-shrink:0"></div>'
        +'<span style="flex:1;font-size:15px;font-weight:'+(isOn?'700':'500')+';color:'+(isOn?'var(--or)':'var(--ink)')+'">'+m.label+'</span>'
        +(isOn?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>':'')
        +'</div>';
    }).join('');
  }
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}

function closeMatFilter(){
  var bd=g('bdMatFilter');
  if(bd)bd.style.display='none';
  document.body.style.overflow='';
}

function pickMatFromSheet(key, label, color){
  var hidden=g('crSubjHidden');if(hidden)hidden.value=key;
  var lbl=g('crMatLabel');if(lbl){lbl.textContent=label;lbl.style.color='var(--ink)';}
  var dot=g('crMatDot');if(dot)dot.style.background=color;
  var btn=g('crMatBtn');if(btn)btn.style.borderColor='var(--or)';
  closeMatFilter();
  if(navigator.vibrate)navigator.vibrate(6);
}

function onMatInput(val, dropdownId, hiddenId){
  var box=g(dropdownId);
  if(!box)return;
  var n=normStr(val);
  // Filtrer les matières
  var matches=val.length===0?MATIERES:MATIERES.filter(function(m){
    return normStr(m.label).includes(n)||m.key.includes(n);
  });
  if(!matches.length){box.style.display='none';return;}
  box.innerHTML=matches.map(function(m){
    return'<div class="mat-item" onclick="pickMatiere(\''
      +m.key+'\',\''+m.label+'\',\''+dropdownId+'\',\''+hiddenId+'\',this)">'
      +'<div class="mat-dot" style="background:'+m.color+'"></div>'
      +'<span>'+m.label+'</span>'
      +'</div>';
  }).join('');
  box.style.display='block';
}

function pickMatiere(key, label, dropdownId, hiddenId, el){
  var inp=el.closest('[style*=relative]').querySelector('input[type=text]');
  if(inp)inp.value=label;
  var hidden=g(hiddenId);if(hidden)hidden.value=key;
  var box=g(dropdownId);if(box)box.style.display='none';
  if(navigator.vibrate)navigator.vibrate(6);
}

// Fermer dropdown au clic extérieur
document.addEventListener('click',function(e){
  document.querySelectorAll('.mat-dropdown').forEach(function(d){
    if(!d.closest('[style*=relative]').contains(e.target))d.style.display='none';
  });
});

var FM={
  tous:function(){return true;},
  maths:function(t){return /math|alg.bre|statist|analyse|g.om.trie|arithm/.test(t);},
  physique:function(t){return /physique|electro|mecanique|thermodynamique/.test(t);},
  informatique:function(t){return /informatique|python|data|react|javascript|sql|code|algorith/.test(t);},
  langues:function(t){return /anglais|espagnol|allemand|langue|toefl|ielts|fle/.test(t);},
  economie:function(t){return /econom|macro|finance|compta|gestion|marketing/.test(t);},
  soir:function(t){return /18h|19h|20h|21h|soir/.test(t);},
  weekend:function(t){return /sam|dim|week/.test(t);}
};
function doFilter(){
  // Récupérer la valeur depuis l'un ou l'autre des champs de recherche
  var mobInp=document.getElementById('mobSearchInput');
  var srchInp=document.getElementById('srch');
  var val='';
  if(mobInp&&mobInp.value){
    val=mobInp.value;
    if(srchInp)srchInp.value=val;
  } else if(srchInp){
    val=srchInp.value;
  }
  val=val.trim();
  if(checkCodeInSearch(val))return;
  if(typeof resolveAlias==='function')showAliasSuggestion(val);
  clearTimeout(_searchTimer);
  _searchTimer=setTimeout(function(){currentPage=1;applyFilter();},250);
}

// ── Alias recherche ──
var _pendingAlias=null;

function showAliasSuggestion(val){
  var box=g('searchAliasSuggestion');
  if(!box)return;
  if(!val||val.length<2){box.style.display='none';_pendingAlias=null;return;}
  var resolved=resolveAlias(val);
  if(!resolved||normalizeText(resolved)===normalizeText(val)){box.style.display='none';_pendingAlias=null;return;}
  _pendingAlias=resolved;
  var lbl=box.querySelector('.alias-label');
  if(lbl)lbl.innerHTML='Vous cherchez : <strong style="color:var(--ink)">'+esc(resolved)+'</strong>\u202f?';
  box.style.display='flex';
}

function acceptAlias(){
  if(!_pendingAlias)return;
  var box=g('searchAliasSuggestion');if(box)box.style.display='none';
  var mobInp=g('mobSearchInput');if(mobInp){mobInp.value=_pendingAlias;var cb=g('searchClearBtn');if(cb)cb.style.display='flex';}
  var srch=g('srch');if(srch)srch.value=_pendingAlias;
  _pendingAlias=null;
  currentPage=1;applyFilter();
}

function denyAlias(){
  _pendingAlias=null;
  var box=g('searchAliasSuggestion');if(box)box.style.display='none';
}

// ── Alias filtre personnalisé ──
var _pendingFilterAlias=null;

function previewCustomFilter(val){
  var box=g('filterAliasSuggestion');
  if(!box)return;
  if(!val||val.length<2){box.style.display='none';_pendingFilterAlias=null;return;}
  if(typeof resolveAlias!=='function'){box.style.display='none';return;}
  var resolved=resolveAlias(val);
  if(!resolved||normalizeText(resolved)===normalizeText(val)){box.style.display='none';_pendingFilterAlias=null;return;}
  _pendingFilterAlias=resolved;
  var lbl=box.querySelector('.filter-alias-label');
  if(lbl)lbl.innerHTML='→ <strong style="color:var(--ink)">'+esc(resolved)+'</strong>\u202f?';
  box.style.display='flex';
}

function acceptFilterAlias(){
  if(!_pendingFilterAlias)return;
  var box=g('filterAliasSuggestion');if(box)box.style.display='none';
  var inp=g('filterInput');if(inp)inp.value=_pendingFilterAlias;
  addFilterQuick(_pendingFilterAlias);
  var key=_pendingFilterAlias.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  _pendingFilterAlias=null;
  selectCustomFilter(key);
}

function denyFilterAlias(){
  _pendingFilterAlias=null;
  var box=g('filterAliasSuggestion');if(box)box.style.display='none';
}
function setPill(el){haptic(4);document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on')});el.classList.add('on');actF=el.dataset.f;doFilter();try{sessionStorage.setItem('cp_filter',actF);}catch(e){}}
function restoreFilters(){
  try{
    // Réinjecter dans la barre tous les filtres custom sauvegardés
    var _addBtn=g('pillAdd');
    if(_addBtn){
      customFilters.forEach(function(f){
        if(!document.querySelector('[data-f="custom_'+f.key+'"]')){
          var pill=document.createElement('button');
          pill.className='filter-pill-btn pill';
          pill.dataset.f='custom_'+f.key;
          pill.innerHTML=esc(f.label)+' <span onclick="event.stopPropagation();removeCustomFilter(\''+f.key+'\');" style="margin-left:4px;opacity:.5;font-size:11px">✕</span>';
          pill.onclick=function(){setPill(pill);};
          _addBtn.parentNode.insertBefore(pill,_addBtn);
        }
      });
    }
    var f=sessionStorage.getItem('cp_filter');
    if(f&&f!=='tous'){
      var el=document.querySelector('[data-f="'+f+'"]');
      if(el){el.classList.add('on');var tous=g('pillTous');if(tous)tous.classList.remove('on','active');actF=f;}
    }
    var niv=sessionStorage.getItem('cp_niv');
    if(niv){actNiv=niv;var lbl=g('pillNivLabel');if(lbl)lbl.textContent=niv;var pn=g('pillNiv');if(pn)pn.classList.add('on');}
  }catch(e){}
}

// RÉSERVATION
function showLoginPrompt(){
  haptic(10);
  var bd=g('bdLoginPrompt');
  if(bd)bd.style.display='flex';
}

function scrollToLogin(){
  var app=g('app'),login=g('login');
  if(app)app.style.display='none';
  if(login){
    login.style.display='flex';
    login.style.zIndex='999';
    login.style.pointerEvents='';  // réactiver les clics
    login.style.opacity='1';
  }
  // Aussi réinitialiser le formulaire sur Se connecter
  var ltC=g('ltC');if(ltC&&!ltC.classList.contains('on'))switchLT('C');
}

// Ouvrir la fiche complète d'un cours depuis un message — sans redirection bdO/bdF
function viewCoursCard(id){
  haptic(4);
  if(!user||!user.id){showLoginPrompt();return;}
  // Comparaison loose pour gérer string vs number
  var c=C.find(function(x){return x.id==id});
  if(!c){
    // Cours absent du cache local — le charger depuis l'API
    fetch(API+'/cours/'+id).then(function(r){return r.json();}).then(function(cd){
      if(!cd||!cd.id){toast('Cours introuvable','Ce cours n\'est plus disponible');return;}
      C.push(cd);viewCoursCard(cd.id);
    }).catch(function(){toast('Cours introuvable','Ce cours n\'est plus disponible');});
    return;
  }
  curId=c.id;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  g('rTit').textContent=c.title;g('rSbj').textContent=c.subj;
  var rAv=g('rProfAv'),rNm=g('rProfNm');
  if(rAv){var _pp=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;setAvatar(rAv,_pp,c.prof_ini||'?','rgba(255,255,255,.25)');}
  if(rNm)rNm.textContent=(P[c.pr]&&P[c.pr].nm)||c.prof_nm||'Professeur';
  var rHeader=document.querySelector('#bdR .modal>div:first-child');
  if(rHeader&&c.bg){rHeader.style.background=c.bg;rHeader.style.borderRadius='20px 20px 0 0';}
  var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  g('rDt').textContent=fmtDt(c.dt);
  var rLcEl=g('rLc');if(rLcEl){rLcEl.textContent=_isVisio?'':c.lc;rLcEl.style.display=_isVisio?'none':'';}
  var rDescEl=g('rDesc');
  if(rDescEl){if(c.description){rDescEl.textContent=c.description;rDescEl.style.display='block';}else{rDescEl.style.display='none';}}
  g('rTot').textContent=c.tot+'€';g('rCnt').textContent=c.sp+' places max';
  g('rFin').textContent=pp+'€';g('rFinB').textContent=pp+'€';
  g('rInf').textContent='Prix fixe de '+pp+'€ par élève. Confirmez pour réserver votre place.';
  var isOwner=user&&c.pr===user.id;
  var btnConf=document.querySelector('#bdR .pb.pri');
  var btnContact=document.querySelector('#bdR .pb.sec');
  var btnDel=g('btnDelCours');
  var btnEleves=g('btnVoirEleves');
  if(isOwner){
    if(btnConf)btnConf.style.display='none';
    if(btnContact)btnContact.style.display='none';
    if(btnDel)btnDel.style.display='flex';
    if(btnEleves)btnEleves.style.display='flex';
  }else{
    if(btnConf){btnConf.style.display='flex';btnConf.onclick=confR;}
    if(btnContact)btnContact.style.display='flex';
    if(btnDel)btnDel.style.display='none';
    if(btnEleves)btnEleves.style.display='none';
  }
  openM('bdR');
}

function openR(id){haptic(4);
  if(!user||!user.id){showLoginPrompt();return;}
  var _rBtn=document.querySelector('[data-id="'+id+'"] .btnr');
  if(_rBtn&&_rBtn.textContent==='Réserver'){_rBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13" style="animation:cpSpin .6s linear infinite"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';_rBtn.disabled=true;setTimeout(function(){if(_rBtn){_rBtn.innerHTML='Réserver';_rBtn.disabled=false;}},5000);}
  var c=C.find(function(x){return x.id==id});
  if(!c)return;
  var isOwner=user&&c.pr===user.id;
  // Si c'est le prof qui consulte son propre cours, ne pas bloquer
  if(!isOwner&&res[id]){openO(id);return;}
  if(!isOwner&&c.fl>=c.sp){openF(c.pr,c.title);return;}
  curId=id;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  g('rTit').textContent=c.title;g('rSbj').textContent=c.subj;
  var rAv=g('rProfAv'),rNm=g('rProfNm');
  if(rAv){var _pp=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;setAvatar(rAv,_pp,c.prof_ini||'?','rgba(255,255,255,.25)');}
  if(rNm)rNm.textContent=(P[c.pr]&&P[c.pr].nm)||c.prof_nm||'Professeur';
  // Coloriser le header de la fiche selon la matière
  var rHeader=document.querySelector('#bdR .modal>div:first-child');
  if(rHeader&&c.bg){
    rHeader.style.background=c.bg;
    rHeader.style.borderRadius='20px 20px 0 0';
    // En dark mode le fond pastel clair rend le texte illisible → forcer couleur sombre
    var isDark=document.documentElement.classList.contains('dk');
    var rTitEl=g('rTit');
    if(rTitEl)rTitEl.style.color=isDark?'#111':'var(--ink)';
    var mhdEl=rHeader.querySelector('.mhd');
    if(mhdEl){
      mhdEl.style.color=isDark?'#111':'';
      var subEl=mhdEl.querySelector('[style*="color:var(--lite)"]');
      if(subEl)subEl.style.color=isDark?'#555':'';
    }
  }
  var _oIsVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  g('rDt').textContent=fmtDt(c.dt);
  var rLcEl=g('rLc');if(rLcEl){rLcEl.textContent=_oIsVisio?'':c.lc;rLcEl.style.display=_oIsVisio?'none':'';}
  var rDescEl=g('rDesc');
  if(rDescEl){if(c.description){rDescEl.textContent=c.description;rDescEl.style.display='block';}else{rDescEl.style.display='none';}}
  g('rTot').textContent=c.tot+'€';g('rCnt').textContent=c.sp+' places max';
  g('rFin').textContent=pp+'€';g('rFinB').textContent=pp+'€';
  g('rInf').textContent='Prix fixe de '+pp+'€ par élève. Confirmez pour réserver votre place.';
  var isOwner=user&&c.pr===user.id;
  var btnConf=document.querySelector('#bdR .pb.pri');
  var btnContact=document.querySelector('#bdR .pb.sec');
  var btnDel=g('btnDelCours');
  var btnEleves=g('btnVoirEleves');
  if(isOwner){
    // Prof consulte son propre cours
    if(btnConf)btnConf.style.display='none';
    if(btnContact)btnContact.style.display='none';
    if(btnDel)btnDel.style.display='flex';
    if(btnEleves)btnEleves.style.display='flex';
  } else {
    if(btnConf){btnConf.style.display='flex';btnConf.onclick=confR;}
    if(btnContact)btnContact.style.display='flex';
    if(btnDel)btnDel.style.display='none';
    if(btnEleves)btnEleves.style.display='none';
  }
  openM('bdR');
}
function closeR(){closeM('bdR');}

async function openEleves(id){
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  g('elevesTitre').textContent=c.title+' — '+c.fl+' inscrit'+(c.fl>1?'s':'');
  var list=g('elevesList');
  list.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>Chargement</div>';
  openM('bdEleves');
  if(c.fl===0){list.innerHTML='<div class="bempty"><p>Aucun élève inscrit pour l\'instant.</p></div>';return;}
  try{
    var r=await fetch(API+'/reservations/cours/'+id,{headers:apiH()});
    var data=await r.json();
    if(!Array.isArray(data)||!data.length){list.innerHTML='<div class="bempty"><p>Aucun élève inscrit pour l\'instant.</p></div>';return;}
    list.innerHTML='<div style="margin-bottom:12px;background:var(--orp);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--mid)">📋 <strong>'+data.length+' élève'+(data.length>1?'s':'')+' inscrit'+(data.length>1?'s':'')+'</strong> sur '+c.sp+' places</div>'
      +data.map(function(res){
        var nom=((res.prenom||'')+(res.nom?' '+res.nom:'')).trim()||'Élève';
        var email=res.email||'';
        var montant=res.montant_paye||0;
        var date=res.created_at?new Date(res.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'';
        var ini=nom[0]||'?';
        return'<div style="display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--bdr)">'
          +'<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#FF8C55,var(--ord));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0">'+esc(ini)+'</div>'
          +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:var(--ink)">'+esc(nom)+'</div>'
          +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+esc(email)+(date?' · '+esc(date):'')+'</div></div>'
          +'<div style="text-align:right;flex-shrink:0">'
          +'<div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:4px">'+montant+'€</div>'
          +('<button onclick="cancelEleveReservation('+JSON.stringify(res.reservation_id)+','+JSON.stringify(res.user_id)+','+JSON.stringify(id)+','+montant+')" style="background:#FEF2F2;color:#EF4444;border:none;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Annuler</button>')
          +'</div></div>';
      }).join('');
  }catch(e){
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">Impossible de charger.<br><a onclick="openEleves(\''+id+'\')" style="color:var(--or);cursor:pointer">Réessayer</a></div>';
  }
}

async function cancelEleveReservation(reservationId,userId,coursId,montant){
  if(!confirm('Annuler et rembourser cet élève ?'))return;
  try{
    var r=await fetch(API+'/reservations/'+reservationId+'/cancel',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:userId,cours_id:coursId,montant:montant})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    toast('Annulé','L\'élève a été remboursé automatiquement ✓');
    openEleves(coursId);
    var c=C.find(function(x){return x.id==coursId;});
    if(c&&c.fl>0)c.fl--;
    buildCards();
  }catch(e){toast('Erreur réseau','Impossible d\'annuler');}
}
async function confR(){haptic(15);
  var id=curId;
  if(!id){toast('Erreur','Veuillez réessayer');return;}
  var c=C.find(function(x){return x.id==id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  if(!user||!user.id){toast('Connexion requise','Connectez-vous pour réserver');return;}
  if(res[id]){toast('Déjà réservé','Vous avez déjà une place pour ce cours');return;}
  var btn=document.querySelector('#bdR .pb.pri');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="cp-loader"></span>Redirection…';}
  try{
    var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
    // Sauvegarder les infos avant paiement
    try{localStorage.setItem('cp_stripe_pending',JSON.stringify({cours_id:id,user_id:user.id,montant:pp,pour_ami:false}));}catch(e){}
    var r=await fetch(API+'/stripe/checkout',{method:'POST',headers:apiH(),body:JSON.stringify({
      cours_id:id,
      user_id:user.id,
      montant:pp,
      cours_titre:c.title
    })});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    // Rediriger vers paiement
    window.location.href=data.url;
  }catch(e){toast('Erreur réseau','Impossible de lancer le paiement');}
  finally{if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Confirmer — <strong>'+( g('rFinB')?g('rFinB').textContent:'')+'</strong>';}}
}
function contR(){
  var c=C.find(function(x){return x.id==curId});
  var pid=c?c.pr:null;
  var nm=c?((P[pid]&&P[pid].nm)||c.prof_nm):'le professeur';
  var photo=c?(P[pid]&&P[pid].photo)||c.prof_photo:null;
  closeM('bdR');
  if(pid)openMsg(nm,pid,photo);
}

// AUTRE PERSONNE
function openO(id){
  curId=id;var c=C.find(function(x){return x.id==id});
  if(!c)return;
  g('oTit').textContent=c.title;g('oPrc').textContent=(c.sp>0?Math.ceil(c.tot/c.sp):0)+'€';
  openM('bdO');
}
function closeO(){closeM('bdO');}
function confO(){
  var id=curId;closeM('bdO');
  var c=C.find(function(x){return x.id==id});
  if(!c||c.fl>=c.sp){if(c)openF(c.pr,c.title);return;}
  // Afficher la modal de paiement pour une autre personne
  curId=id;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  g('rTit').textContent=c.title+' · Place supplémentaire';
  g('rSbj').textContent=c.subj;
  g('rDt').textContent=c.dt;
  g('rLc').textContent=c.lc;
  g('rTot').textContent=c.tot+'€';
  g('rCnt').textContent=c.sp+' places max';
  g('rFin').textContent=pp+'€';
  g('rFinB').textContent=pp+'€';
  g('rInf').textContent='Réservation d\'une place supplémentaire · '+pp+'€ par personne.';
  var btnDup=g('btnDupCours');if(btnDup)btnDup.style.display=(user&&c.pr===user.id)?'block':'none';
  var btnDel=g('btnDelCours'),btnEleves=g('btnVoirEleves'),btnConf=document.querySelector('#bdR .pb.pri'),btnContact=document.querySelector('#bdR .pb.sec');
  if(btnDel)btnDel.style.display='none';
  if(btnEleves)btnEleves.style.display='none';
  if(btnConf){btnConf.style.display='flex';btnConf.onclick=function(){confAmi(id);};}
  if(btnContact)btnContact.style.display='flex';
  openM('bdR');
}

async function confAmi(id){
  var c=C.find(function(x){return x.id==id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  var btn=document.querySelector('#bdR .pb.pri');
  if(btn){btn.disabled=true;btn.textContent='⏳ Redirection vers le paiement…';}
  try{
    var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
    try{localStorage.setItem('cp_stripe_pending',JSON.stringify({cours_id:id,user_id:user.id,montant:pp,pour_ami:true}));}catch(e){}
    var r=await fetch(API+'/stripe/checkout',{method:'POST',headers:apiH(),body:JSON.stringify({
      cours_id:id,
      user_id:user.id,
      montant:pp,
      cours_titre:c.title+' · Place supplémentaire',
      pour_ami:true
    })});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    window.location.href=data.url;
  }catch(e){toast('Erreur réseau','Impossible de lancer le paiement');}
  finally{if(btn){btn.disabled=false;btn.onclick=function(){confAmi(id);};}}
}

function shareCoursLink(){
  var co=C.find(function(x){return x.id==curId});
  if(!co)return;
  var base='https://courspool.vercel.app';
  var url=base+(co.prive&&co.code?'?code='+co.code:'?cours='+curId);
  if(navigator.share){navigator.share({title:'CoursPool',text:co.title,url:url});return;}
  var ta=document.createElement('textarea');
  ta.value=url;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();document.execCommand('copy');
  document.body.removeChild(ta);
  toast('Lien copié !','Partagez ce lien pour inviter quelqu\'un');
}

// SUIVRE
function openF(pid,title){folPr=pid;var p=P[pid]||{};g('fNm').textContent=p.nm||'ce prof';g('fCr').textContent=title||'';openM('bdF');}
function closeF(){closeM('bdF');folPr=null;}
function confF(){
  if(!folPr)return;
  var pid=folPr;
  var p=P[pid]||{};
  fol.add(pid);
  _syncFollowBtns(pid,true);
  closeM('bdF');
  toast('Vous suivez '+(p.nm||'ce prof'),'Notifié dès son prochain cours');
  folPr=null;
  updateFavBadge();
  // Sauvegarder le follow en base
  if(user&&user.id){
    fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})}).catch(function(){});
    // Incrémenter le compteur d'élèves du prof (toujours créer P[pid] d'abord)
    P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
    P[pid].e=(P[pid].e||0)+1;
  }
  if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
  if(P[pid]){try{var _pc4=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc4[pid])_pc4[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||''};_pc4[pid].e=P[pid].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc4));}catch(ex){}_saveFollowCount(pid,P[pid].e||0);}
}

// PROFIL PROF
function openPr(pid){
  curProf=pid;
  var _ts=g('mpTagsSection');if(_ts)_ts.style.display='none';
  var cours=C.filter(function(x){return x.pr===pid;});
  var dernierCours=cours[0]||null;
  // Toujours créer P[pid] pour que togFP/toggleFollowCard puissent l'incrémenter
  if(!P[pid])P[pid]={n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
  var p=P[pid];
  var pCache=P[pid];
  var STATUT={'etudiant':'Étudiant','prof_ecole':'Prof des écoles','prof_college':'Prof collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Professionnel'};
  // Alimenter P[pid] depuis les cours si champs manquants (sans écraser les données fraîches)
  if(dernierCours){
    if(!P[pid])P[pid]={n:'—',e:0};
    p=P[pid];
    if(!p.nm&&dernierCours.prof_nm)p.nm=dernierCours.prof_nm;
    if(!p.i)p.i=dernierCours.prof_ini||'?';
    if(!p.col)p.col=dernierCours.prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)';
    if(!p.photo&&dernierCours.prof_photo)p.photo=dernierCours.prof_photo;
  }
  var displayNm=p.nm||'Professeur';
  var displayIni=p.i||'?';
  var displayCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var displayPhoto=p.photo||null;
  if(!displayNm){toast('Profil introuvable','');return;}

  // Sujets uniques extraits des cours (dispo immédiatement)
  var subjSet={};cours.forEach(function(c){if(c.subj)subjSet[c.subj]=true;});
  var immediateTags=Object.keys(subjSet);

  // ── Remplissage immédiat (0 latence) ──
  var av=g('mpav');
  setAvatar(av,displayPhoto,displayIni,displayCol);
  var hero=g('mpHero');if(hero)hero.style.background=displayCol;
  g('mpnm').textContent=displayNm;
  g('mprl').textContent=pCache.statut?STATUT[pCache.statut]||pCache.statut:'Professeur';
  g('mpbd').textContent=pCache.niveau||'';
  var vBadge=g('mpVerifiedBadge');if(vBadge)vBadge.style.display=(pCache.verified===true||pCache.verified==='true')?'block':'none';
  g('mpC').textContent=cours.length;
  g('mpN').textContent=p.n&&p.n!=='—'?'★ '+p.n:'—';
  g('mpE').textContent=p.e||0;
  var mpD=g('mpD');if(mpD)mpD.textContent=pCache.cours_donnes||0;

  // Bio : cache ou placeholder discret
  var bioEl=g('mpBio');
  if(bioEl)bioEl.textContent=pCache.bio||'';

  // Matières : depuis cache P[] ou depuis les cours en attente API
  var tagsEl=g('mpTags');
  var tagsSect=g('mpTagsSection');
  var MAT_ICONS={
    'maths':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="13" height="13"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
    'physique':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
    'chimie':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M9 3h6M10 9l-5 9a2 2 0 001.7 3h10.6A2 2 0 0019 18l-5-9V3"/></svg>',
    'svt':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M12 22V12M12 12C12 7 7 3 3 3c0 4 2.5 9 9 9zM12 12c0-5 5-9 9-9-1 5-4 9-9 9"/></svg>',
    'informatique': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'python':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'anglais':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
    'espagnol':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
    'francais':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'histoire':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'philo':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/></svg>',
    'economie':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    'droit':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    'musique':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    'arts':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M2 13.5V19a2 2 0 002 2h3.5M2 8.5V5a2 2 0 012-2h3.5M13.5 2H19a2 2 0 012 2v3.5M20 13.5V19a2 2 0 01-2 2h-3.5"/></svg>',
    'sport':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    'architecture': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    'compta':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    'marketing':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    'stats':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    'autre':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>'
  };
  function _renderTags(list){
    if(!tagsEl||!list.length){if(tagsSect)tagsSect.style.display='none';return;}
    if(tagsSect)tagsSect.style.display='block';
    tagsEl.innerHTML=list.map(function(m){
      var mat=findMatiere(m);
      var col=mat?mat.color:'var(--or)';
      var key=mat?mat.key:'autre';
      var icon=MAT_ICONS[key]||MAT_ICONS['autre'];
      return'<div style="display:inline-flex;align-items:center;gap:7px;background:var(--bg);border-radius:50px;padding:5px 12px 5px 5px;border:1.5px solid '+col+'30">'
        +'<div style="width:24px;height:24px;border-radius:50%;background:'+col+'18;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:'+col+'">'+icon+'</div>'
        +'<span style="font-size:12.5px;font-weight:600;color:var(--ink);white-space:nowrap">'+esc(m)+'</span>'
        +'</div>';
    }).join('');
  }
  if(pCache.matieres){_renderTags(pCache.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean));}
  else if(immediateTags.length){_renderTags(immediateTags);}
  else{if(tagsSect)tagsSect.style.display='none';}

  // Prochains cours — belle carte avec date formatée
  var prochains=cours.filter(function(c){return c.fl<c.sp;});
  var mpCrs=g('mpCrs');
  if(mpCrs){
    mpCrs.innerHTML=prochains.length
      ?prochains.map(function(c){
        var isV=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
        var mat=findMatiere(c.subj||'')||{color:'var(--or)',bg:'var(--orp)'};
        return'<div onclick="closePr();openR(\''+escH(c.id)+'\')" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg);border-radius:14px;margin-bottom:8px;cursor:pointer;transition:opacity .15s" onmouseenter="this.style.opacity=\'.75\'" onmouseleave="this.style.opacity=\'1\'">'
          +'<div style="width:40px;height:40px;border-radius:10px;background:'+mat.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:8px;height:8px;border-radius:50%;background:'+mat.color+'"></div></div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(c.title)+'</div>'
          +'<div style="font-size:11.5px;color:var(--mid);margin-top:2px">'+esc(fmtDt(c.dt))+'</div>'
          +'</div>'
          +'<span style="font-size:11px;font-weight:700;background:'+(isV?'rgba(0,113,227,.1)':'rgba(0,177,79,.1)')+';color:'+(isV?'#0055B3':'#007A38')+';border-radius:50px;padding:3px 9px;flex-shrink:0">'+(isV?'Visio':'Présentiel')+'</span>'
          +'</div>';
      }).join('')
      :'<div style="font-size:13px;color:var(--lite);padding:10px 0">Aucun cours disponible</div>';
  }

  // Avis
  var avisBlock=g('mpAvisBlock'),avisContainer=g('mpAvis');
  if(avisBlock)avisBlock.style.display='none';
  fetch(API+'/notations/'+pid).then(function(r){return r.json();}).then(function(notes){
    if(!notes||!notes.length)return;
    if(avisBlock)avisBlock.style.display='block';
    var stars=function(n){var s='';for(var i=0;i<5;i++)s+=i<n?'★':'☆';return s;};
    if(avisContainer)avisContainer.innerHTML=notes.slice(0,3).map(function(a){
      return'<div style="background:var(--bg);border-radius:12px;padding:12px 14px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:'+(a.commentaire?'6':'0')+'px">'
        +'<span style="font-size:13px;color:#F59E0B;letter-spacing:2px">'+stars(a.note)+'</span>'
        +'<span style="font-size:11px;color:var(--lite)">'+(a.created_at?new Date(a.created_at).toLocaleDateString('fr-FR',{month:'short',year:'numeric'}):'')+'</span>'
        +'</div>'
        +(a.commentaire?'<div style="font-size:13px;color:var(--mid);line-height:1.5">'+esc(a.commentaire)+'</div>':'')
        +'</div>';
    }).join('');
  }).catch(function(){});

  var fb=g('bFP');
  fb.style.display=(user&&pid===user.id)?'none':'flex';
  _setFollowBtn(fol.has(pid));
  var bdPrEl=g('bdPr');if(bdPrEl)bdPrEl.style.display='flex';

  // Mise à jour silencieuse depuis l'API (tous les champs du modal)
  fetch(API+'/profiles/'+pid+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(prof){
    if(!prof||!prof.id)return;
    if(!P[pid])P[pid]={};
    P[pid]._fresh=true;
    ['bio','matieres','niveau','statut'].forEach(function(k){if(prof[k]!==undefined)P[pid][k]=prof[k];});
    var _pr2=prof.prenom||'';var _no2=prof.nom||'';
    var _apiNm=(_pr2+(_no2?' '+_no2:'')).trim();
    if(_apiNm){
      P[pid].nm=_apiNm;
      P[pid].i=((_pr2[0]||'')+(_no2[0]||'')).toUpperCase()||displayIni;
      if(g('mpnm'))g('mpnm').textContent=_apiNm;
      C.forEach(function(cx){if(cx.pr===pid)cx.prof_nm=_apiNm;});
      document.querySelectorAll('[data-profnm="'+pid+'"]').forEach(function(el){el.textContent=_apiNm;});
    }
    if(prof.photo_url){
      P[pid].photo=prof.photo_url;
      setAvatar(g('mpav'),prof.photo_url,P[pid].i||displayIni,displayCol);
      C.forEach(function(cx){if(cx.pr===pid)cx.prof_photo=prof.photo_url;});
      document.querySelectorAll('[data-prof="'+pid+'"]').forEach(function(el){
        el.style.background='none';
        el.innerHTML='<img src="'+esc(prof.photo_url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      });
    }
    if(bioEl&&prof.bio!==undefined)bioEl.textContent=prof.bio;
    if(prof.matieres){_renderTags(prof.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean));}
    if(prof.niveau&&g('mpbd'))g('mpbd').textContent=prof.niveau;
    if(prof.statut&&g('mprl'))g('mprl').textContent=STATUT[prof.statut]||prof.statut;
    // Nombre d'élèves/abonnés depuis l'API si disponible
    var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
    if(_nbE!==undefined && _nbE>0){
      // L'API retourne parfois 0 (délai backend) — ignorer si 0, sinon prendre le max
      _nbE=Math.max(_nbE,P[pid].e||0);
      P[pid].e=_nbE;if(g('mpE'))g('mpE').textContent=_nbE;
      // Persister le compteur frais dans cp_follow_counts (valeur API confirmée > 0)
      _saveFollowCount(pid,_nbE);
    }
    // Cours donnés
    if(prof.cours_donnes!==undefined){pCache.cours_donnes=prof.cours_donnes;var mpD=g('mpD');if(mpD)mpD.textContent=prof.cours_donnes;}
    // Sauvegarder en cache
    var _eSave=P[pid].e||0;
    try{var _pc=JSON.parse(localStorage.getItem('cp_profs')||'{}');_pc[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||'',e:_eSave};localStorage.setItem('cp_profs',JSON.stringify(_pc));}catch(ex){}
  }).catch(function(){});
}
function closePr(){var el=g('bdPr');if(el)el.style.display='none';}
function contPr(){
  var p=P[curProf]||{};
  var pid=curProf;
  closePr();
  openMsg(p.nm||'le professeur',pid,p.photo||null);
}
/* ── sync tous les card-follow-btn au retour sur Explorer ── */
function _syncAllFollowBtns(){
  var svgOn='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
  var svgOff='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
  document.querySelectorAll('.card-follow-btn[data-pid]').forEach(function(btn){
    var pid=btn.getAttribute('data-pid');
    var on=fol.has(pid);
    btn.setAttribute('data-fol',on?'1':'0');
    btn.title=on?'Ne plus suivre':'Suivre ce professeur';
    btn.innerHTML=on?svgOn:svgOff;
    btn.style.background=on?'rgba(255,107,43,0.12)':'rgba(255,255,255,0.85)';
    btn.style.color=on?'#FF6B2B':'var(--lite)';
  });
}
/* ── sync tous les card-follow-btn d'un prof sur les cards explorer ── */
function _syncFollowBtns(pid,isFollowing){
  var svgOn='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
  var svgOff='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
  document.querySelectorAll('.card-follow-btn[data-pid="'+pid+'"]').forEach(function(btn){
    btn.setAttribute('data-fol',isFollowing?'1':'0');
    btn.title=isFollowing?'Ne plus suivre':'Suivre ce professeur';
    btn.innerHTML=isFollowing?svgOn:svgOff;
    btn.style.background=isFollowing?'rgba(255,107,43,0.12)':'rgba(255,255,255,0.85)';
    btn.style.color=isFollowing?'#FF6B2B':'var(--lite)';
  });
}
/* ── helper pour l'état du bouton Suivre/Suivi — UN SEUL endroit ── */
function _setFollowBtn(isFollowed){
  var fb=g('bFP'),ft=g('bFPt');
  if(!fb||!ft)return;
  if(isFollowed){
    fb.style.background='rgba(255,107,43,0.1)';
    fb.style.borderColor='rgba(255,107,43,0.3)';
    fb.style.color='#FF6B2B';
    ft.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> Suivi';
  }else{
    fb.style.background='';
    fb.style.borderColor='';
    fb.style.color='';
    ft.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Suivre';
  }
}

function togFP(){
  haptic(6);
  var id=curProf,p=P[id]||{nm:'ce prof'};
  if(user&&id===user.id){toast('Action impossible','Vous ne pouvez pas vous suivre vous-même');return;}
  if(fol.has(id)){
    fol.delete(id);
    _setFollowBtn(false);
    _syncFollowBtns(id,false);
    toast('Désabonné','Vous ne suivez plus '+p.nm);
    P[id]=P[id]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[id].e=Math.max(0,(P[id].e||1)-1);
    var row=document.querySelector('#listF [data-prof-id="'+id+'"]');
    if(row){
      row.style.transition='all .35s cubic-bezier(.4,0,.2,1)';
      row.style.opacity='0';row.style.transform='translateX(60px)';row.style.maxHeight=row.offsetHeight+'px';
      setTimeout(function(){row.style.maxHeight='0';row.style.padding='0';row.style.margin='0';row.style.overflow='hidden';setTimeout(function(){row.remove();},200);},300);
    }
    if(user&&user.id){
      fetch(API+'/follows',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:id})})
        .then(function(r){return r.json();})
        .then(function(data){
          if(data&&data.nb_eleves!==undefined){
            P[id].e=data.nb_eleves;
            if(g('mpE'))g('mpE').textContent=P[id].e;
            _saveFollowCount(id,P[id].e);
          }
        })
        .catch(function(){
          fol.add(id);_setFollowBtn(true);_syncFollowBtns(id,true);
          if(P[id])P[id].e=(P[id].e||0)+1;
          if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
          _saveFollowCount(id,P[id].e||0);
          toast('Erreur réseau','Impossible de modifier le suivi');
        });
    }
  } else {
    fol.add(id);
    _setFollowBtn(true);
    _syncFollowBtns(id,true);
    toast('Vous suivez '+p.nm,'Notifié dès son prochain cours');
    P[id]=P[id]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[id].e=(P[id].e||0)+1;
    if(user&&user.id){
      fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:id})})
        .then(function(r){return r.json();})
        .then(function(data){
          if(data&&data.nb_eleves!==undefined){
            P[id].e=data.nb_eleves;
            if(g('mpE'))g('mpE').textContent=P[id].e;
            _saveFollowCount(id,P[id].e);
          }
        })
        .catch(function(){
          fol.delete(id);_setFollowBtn(false);_syncFollowBtns(id,false);
          if(P[id])P[id].e=Math.max(0,(P[id].e||1)-1);
          if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
          _saveFollowCount(id,P[id].e||0);
          toast('Erreur réseau','Impossible de modifier le suivi');
        });
    }
  }
  if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
  if(P[id]){try{var _pc2=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc2[id])_pc2[id]={ts:Date.now(),nm:P[id].nm||'',i:P[id].i||'',photo:P[id].photo||''};_pc2[id].e=P[id].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc2));}catch(ex){}_saveFollowCount(id,P[id].e||0);}
  var pfav=g('pgFav');if(pfav&&pfav.classList.contains('on'))buildFavPage();
  updateFavBadge();
  // Fetch différé supprimé — le count serveur est maintenant retourné directement par POST/DELETE /follows
  setTimeout(function(){
    fetch(API+'/profiles/'+id).then(function(r){return r.json();}).then(function(prof){
      if(!prof||!prof.id)return;
      var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
      if(_nbE!==undefined&&_nbE>0){
        P[id]=P[id]||{};
        P[id].e=Math.max(_nbE,P[id].e||0);
        if(g('mpE')&&curProf===id)g('mpE').textContent=P[id].e;
        _saveFollowCount(id,P[id].e);
      }
    }).catch(function(){});
  },1500);
}

// CRÉER COURS
function openCr(){
  if(!user||user.role!=='professeur'){toast('Accès refusé','Seuls les professeurs peuvent proposer des cours');return;}
  if(user.verified===false){
    if(getCniStatus()==='none'){toast('Pièce d\'identité requise','Envoyez votre CNI depuis votre profil pour publier des cours');openCniSheet();}
    else{toast('Vérification en cours','Votre identité est en cours de vérification. Vous pourrez publier des cours sous 24h.');}
    return;
  }
  var today=new Date().toLocaleDateString('fr-CA',{timeZone:'Europe/Paris'});
  g('crDate').min=today;openM('bdCr');
}
function closeCr(){closeM('bdCr');}
function shakeField(el){
  if(!el)return;
  el.style.borderColor='#EF4444';
  el.style.animation='shake .4s ease';
  setTimeout(function(){el.style.animation='';el.style.borderColor='';},600);
}

async function subCr(){
  if(window._publishing){toast('En cours...','Publication déjà en cours');return;}
  window._publishing=true;
  var btn=document.querySelector('#bdCr .pb.pri');
  if(btn){btn.textContent='⏳ Publication…';btn.disabled=true;}
  var titre=g('crTitre').value.trim(),date=g('crDate').value,heure=g('crHeure').value;
  // Validation
  if(!titre){shakeField(g('crTitre'));toast('Titre manquant','Donnez un titre à votre cours',true);return;}
  var crSubjH=g('crSubjHidden');
  if(!crSubjH||!crSubjH.value){var crMB=g('crMatBtn');if(crMB){crMB.style.borderColor='#EF4444';setTimeout(function(){crMB.style.borderColor='';},600);}toast('Matière manquante','Choisissez une matière',true);return;}
  if(!date){shakeField(g('crDate'));toast('Date manquante','Choisissez une date',true);return;}
  if(!heure){shakeField(g('crHeure'));toast('Heure manquante','Choisissez une heure',true);return;}
  var lieu=g('crLieu').value.trim(),places=parseInt(g('cPl').value)||5,prix=parseInt(g('cPr').value)||0;
  var desc=g('crDesc')?g('crDesc').value.trim():'';
  // Matière depuis le sélecteur natif
  var crSubjH=g('crSubjHidden');
  var subjKey=crSubjH?crSubjH.value:'';
  var matFound=MATIERES.find(function(m){return m.key===subjKey;});
  var sujet=matFound?matFound.label:'Autre';
  if(!titre||!date||!heure||!lieu||!prix){
    toast('Champs manquants','Remplissez tous les champs obligatoires');
    window._publishing=false;if(btn){btn.textContent='Publier le cours';btn.disabled=false;}return;
  }
  var dateObj=new Date(date+'T'+heure);
  if(dateObj<=new Date()){
    toast('Date invalide','Choisissez une date future');
    window._publishing=false;if(btn){btn.textContent='Publier le cours';btn.disabled=false;}return;
  }
  var dateFormatee=dateObj.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'long',timeZone:'Europe/Paris'})+' · '+heure;
  var colors={'📐 Maths':'#16A34A','⚗️ Physique':'#BE185D','💻 Info':'#2563EB','🌍 Langues':'#059669','📊 Éco':'#D97706','✨ Autre':'#7C3AED'};
  var bgs={'📐 Maths':'linear-gradient(135deg,#F0FDF4,#BBF7D0)','⚗️ Physique':'linear-gradient(135deg,#FDF2F8,#F9A8D4)','💻 Info':'linear-gradient(135deg,#EFF6FF,#BFDBFE)','🌍 Langues':'linear-gradient(135deg,#ECFDF5,#A7F3D0)','📊 Éco':'linear-gradient(135deg,#FFFBEB,#FDE68A)','✨ Autre':'linear-gradient(135deg,#F5F3FF,#DDD6FE)'};
  var sc=colors[sujet]||'#7C3AED',bg=bgs[sujet]||bgs['✨ Autre'];
  var payload={
    titre,sujet,couleur_sujet:sc,background:bg,
    date_heure:dateFormatee,lieu,prix_total:prix,places_max:places,
    professeur_id:user.id,emoji:isCoursPrivé?'🔒':'📚',
    prof_initiales:user.ini||'?',
    prof_couleur:'linear-gradient(135deg,#FF8C55,#E04E10)',
    prof_nom:user.pr+(user.nm?' '+user.nm:''),
    description:desc,
    prive:isCoursPrivé,
    code_acces:isCoursPrivé?codePrivé:null
  };
  if(user.photo)payload.prof_photo=user.photo;
  try{
    var r=await fetch(API+'/cours',{method:'POST',headers:apiH(),body:JSON.stringify(payload)});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error.message||'Impossible de publier');return;}
    g('crTitre').value='';
  var crSH=g('crSubjHidden');if(crSH)crSH.value='';
  var crML=g('crMatLabel');if(crML){crML.textContent='Choisir une matière…';crML.style.color='var(--lite)';}
  var crMD=g('crMatDot');if(crMD)crMD.style.background='var(--bdr)';
  var crMB=g('crMatBtn');if(crMB)crMB.style.borderColor='var(--bdr)';g('crDate').value='';g('crHeure').value='';
    g('crLieu').value='';g('cPr').value='';g('cH').textContent='';
    if(g('crDesc'))g('crDesc').value='';
    document.querySelectorAll('#bdCr .so').forEach(function(s){s.classList.remove('on');});
    // Reset cours privé
    isCoursPrivé=false;codePrivé='';
    var tog=g('togglePrive');var knob=g('togglePriveKnob');var box=g('codePriveBox');
    if(tog)tog.style.background='var(--bdr)';if(knob)knob.style.transform='translateX(0)';if(box)box.style.display='none';
    closeM('bdCr');await loadData();buildCards();buildAccLists();
    var isFirstCours=C.filter(function(c){return c.pr===user.id;}).length<=1;
    toast(isFirstCours?'Premier cours publié 🎉':'Cours publié ✓',isFirstCours?'Félicitations ! Vos élèves peuvent maintenant vous trouver.':'Visible pour tous les élèves');
  }catch(e){toast('Erreur réseau','Vérifiez votre connexion');}
  finally{window._publishing=false;if(btn){btn.textContent='Publier le cours';btn.disabled=false;}}
}

// TOGGLE MOT DE PASSE
function togglePw(id,btn){
  var input=g(id);
  var isHidden=input.type==='password';
  input.type=isHidden?'text':'password';
  btn.innerHTML=isHidden?
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

// SUPPRIMER SON COURS avec confirmation
function dupCours(id){
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  // Pré-remplir le formulaire avec les données du cours
  closeR();
  setTimeout(function(){
    openCr();
    setTimeout(function(){
      var titre=g('crTitre'),lieu=g('crLieu'),cPl=g('cPl'),cPr=g('cPr');
      var crSubjH=g('crSubjHidden'),crMatLbl=g('crMatLabel'),crMatDot=g('crMatDot'),crMatBtn=g('crMatBtn');
      if(titre)titre.value=c.title;
      if(lieu)lieu.value=c.lc;
      if(cPl)cPl.value=c.sp;
      if(cPr)cPr.value=c.tot;
      // Restaurer la matiere
      var mat=MATIERES.find(function(m){return c.subj&&c.subj.toLowerCase().includes(m.key);});
      if(mat&&crSubjH){
        crSubjH.value=mat.key;
        if(crMatLbl){crMatLbl.textContent=mat.label;crMatLbl.style.color='var(--ink)';}
        if(crMatDot)crMatDot.style.background=mat.color;
        if(crMatBtn)crMatBtn.style.borderColor='var(--or)';
      }
      if(typeof calcH==='function')calcH();
      var _niv=g('crNiveau');if(_niv&&c.niveau){_niv.value=c.niveau;document.querySelectorAll('#crNiveauChips .crn-chip').forEach(function(ch){ch.classList.toggle('on',ch.dataset.n===(c.niveau||''));});}
      var _dsc=g('crDesc');if(_dsc&&c.description)_dsc.value=c.description;
      var _df=g('crDate');if(_df){_df.value='';_df.style.borderColor='var(--or)';_df.style.boxShadow='0 0 0 3px rgba(255,107,43,.15)';setTimeout(function(){_df.scrollIntoView({behavior:'smooth',block:'center'});_df.focus();},350);}
      toast('Cours dupliqué','Changez la date et l\'heure puis publiez');
    },200);
  },300);
}

function confirmDeleteCoursNative(id){
  // ActionSheet natif sur iOS/Android, confirm() sinon
  if(window.confirm('Annuler ce cours ? Tous les élèves inscrits seront notifiés.')){
    deleteCours(id);
  }
}

async function deleteCours(id){
  openConfirmDelete(id);
}

function openConfirmDelete(id){
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  window._deleteId=id;
  g('confirmDelTitre').textContent=c.title;
  g('confirmDelDate').textContent=c.dt;
  openM('bdConfirmDel');
}

async function confirmDeleteCours(){
  var id=window._deleteId;
  if(!id)return;
  closeM('bdConfirmDel');
  closeM('bdR');
  try{
    var r=await fetch(API+'/cours/'+id+'/cancel',{method:'POST',headers:apiH(),body:JSON.stringify({professeur_id:user.id})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    await loadData();buildCards();buildAccLists();
    var nb=data.remboursements||0;
    toast('Cours annul\u00e9',nb>0?nb+' \u00e9l\u00e8ve'+(nb>1?'s':'')+' rembours\u00e9'+(nb>1?'s':'')+' automatiquement \u2713':'Cours supprim\u00e9');
  }catch(e){toast('Erreur réseau','Impossible d\'annuler ce cours');}
  window._deleteId=null;
}
function calcH(){
  var p=parseInt(g('cPr').value)||0,pl=parseInt(g('cPl').value)||1;
  var pp=p>0?Math.ceil(p/pl):0;
  var ch=g('cH');
  if(!ch)return;
  if(p>0){
    var txt='Soit '+pp+'€ par élève pour '+pl+' place'+(pl>1?'s':'');
    if(ch.textContent!==txt){
      ch.style.animation='none';ch.offsetHeight;ch.style.animation='priceFlip .35s ease';
      ch.textContent=txt;
    }
  } else {
    ch.textContent='';
  }
}

function toggleMoreMat(){
  var extras=document.querySelectorAll('.so-extra');
  var btn=document.getElementById('btnVoirPlusMat');
  var hidden=extras[0]&&extras[0].style.display==='none';
  extras.forEach(function(e){e.style.display=hidden?'flex':'none';});
  if(btn)btn.textContent=hidden?'− Moins':'+ Voir plus';
}
function pickS(el){document.querySelectorAll('#bdCr .so').forEach(function(s){s.classList.remove('on');});el.classList.add('on');}

// MESSAGERIE
var msgDestinataire=null,msgDestId=null,msgPollTimer=null;

function openMsg(profNm,destId,avatar){
  if(!user||!user.id){toast('Connexion requise','Connectez-vous pour envoyer des messages');return;}
  if(!destId){toast('Erreur','Destinataire introuvable');return;}
  if(destId===user.id){toast('Action impossible','Vous ne pouvez pas vous écrire à vous-même');return;}
  msgDestinataire=profNm;msgDestId=destId;
  var _b=g('bnavBadge');if(_b){_b.classList.remove('on');_b.textContent='';}

  // Go to messages tab first
  navTo('msg');

  // Fill conv header
  // If no avatar passed, check P cache (photo may have arrived since onclick was rendered)
  if((!avatar||avatar==='null'||avatar==='')&&P[destId]&&P[destId].photo){
    avatar=P[destId].photo;
  }
  var av=g('msgConvAv');
  if(avatar&&avatar!=='null'&&avatar!==''){
    av.style.background='none';
    av.innerHTML='<img src="'+avatar+'" style="width:100%;height:100%;object-fit:cover">';
  } else {
    av.style.background='linear-gradient(135deg,#FF8C55,#E04E10)';
    av.textContent=(profNm&&profNm[0])||'?';
  }
  var _isPlaceholder=!profNm||profNm==='·\u200B·\u200B·'||profNm==='Contact';
  g('msgConvName').textContent=_isPlaceholder?'…':profNm;
  // Si nom inconnu, charger le profil pour mettre à jour la topbar
  if(_isPlaceholder&&destId){
    (function(uid){
      // Check P[] cache first
      if(P[uid]&&P[uid].nm){g('msgConvName').textContent=P[uid].nm;return;}
      // Try to find in C[]
      var _cc=C.find(function(x){return x.pr===uid;});
      if(_cc&&_cc.prof_nm){g('msgConvName').textContent=_cc.prof_nm;return;}
      fetch(API+'/profiles/'+uid).then(function(r){return r.json();}).then(function(prof){
        if(!prof||!prof.id)return;
        var nm2=((prof.prenom||'')+(prof.nom?' '+prof.nom:'')).trim();
        if(nm2){
          if(!P[uid])P[uid]={};P[uid].nm=nm2;
          if(g('msgConvName'))g('msgConvName').textContent=nm2;
        }
      }).catch(function(){});
    })(destId);
  }
  var _mm=g('msgMessages');if(_mm)_mm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">Chargement…</div>';
  var inp=g('msgInput');if(inp){inp.value='';inp.style.height='auto';}

  // Show conv pane + collapse nav (iPad: animation → bouton rond ; mobile: cacher)
  var convPane=g('msgConvPane');
  if(convPane)convPane.style.display='flex';
  var pgMsg=g('pgMsg');
  if(pgMsg)pgMsg.classList.add('conv-open');
  var bnav=g('bnav');
  var _isIpad=window.innerWidth>=768&&document.documentElement.classList.contains('cap-ios');
  if(_isIpad){
    if(bnav)bnav.classList.add('ipad-back');
    var _bb=g('bnavIpadBack');if(_bb)_bb.classList.add('visible');
  }else{
    if(bnav)bnav.classList.add('conv-mode');
  }
  var _cp=g('msgConvPane');if(_cp)_cp.classList.remove('empty-state');
  var sb=g('btnShareCours');if(sb)sb.style.display=(user&&user.role==='professeur')?'flex':'none';

  // Mark active row
  document.querySelectorAll('.msg-row').forEach(function(r){r.classList.remove('active');});
  var activeRow=document.querySelector('[data-uid="'+msgDestId+'"]');
  if(activeRow)activeRow.classList.add('active');

  loadMessages();
  clearInterval(msgPollTimer);
  var pollDelay=3000;
  function schedulePoll(){
    msgPollTimer=setTimeout(function(){
      loadMessages();
      if(msgDestId)schedulePoll();
    },pollDelay);
    pollDelay=Math.min(pollDelay+500,8000);
  }
  schedulePoll();
}

function closeMsgConv(){
  // Hide conv pane, stay on messages list
  var convPane=g('msgConvPane');
  if(convPane)convPane.style.display='none';
  var pgMsg=g('pgMsg');
  if(pgMsg)pgMsg.classList.remove('conv-open');
  // Restaurer la nav (iPad: retirer ipad-back + cacher bouton rond ; mobile: retirer conv-mode)
  var bnav=g('bnav');
  if(bnav){bnav.classList.remove('conv-mode');bnav.classList.remove('ipad-back');}
  var _bb=g('bnavIpadBack');if(_bb)_bb.classList.remove('visible');
  // Restore normal nav state for messages page (bniMsg highlighted)
  restoreNav();
  var bMsg=g('bniMsg');if(bMsg)bMsg.classList.add('on');
  clearInterval(msgPollTimer);msgPollTimer=null;msgDestId=null;
  document.querySelectorAll('.msg-row').forEach(function(r){r.classList.remove('active');});
}

async function loadMessages(){
  if(!user||!msgDestId)return;
  try{
    var r=await fetch(API+'/messages/'+user.id+'/'+msgDestId+'?limit=50',{headers:apiH()});
    var msgs=await r.json();
    if(!Array.isArray(msgs))return;
    var box=g('msgMessages');
    if(!box)return;
    // Mémoriser si l'utilisateur était en bas pour décider du scroll après rendu
    var _wasAtBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    if(!msgs.length){
      box.innerHTML='<div style="text-align:center;padding:40px;color:var(--lite);font-size:14px">Aucun message. Dites bonjour !</div>';
      return;
    }
    updateMsgBadge(0);
    var h='';
    var lastDate='';
    msgs.forEach(function(m){
      var d=new Date(m.created_at);
      var dk=d.toDateString();
      if(dk!==lastDate){
        lastDate=dk;
        var today=new Date();today.setHours(0,0,0,0);
        var diff=Math.round((today-new Date(dk))/(864e5));
        var lbl=diff===0?"Aujourd'hui":diff===1?'Hier':d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
        h+='<div class="msg-date-sep"><span>'+lbl.charAt(0).toUpperCase()+lbl.slice(1)+'</span></div>';
      }
      var isMe=m.sender_id===user.id;
      var time=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      var txt=m.contenu||'';
      // Masquer JSON brut
      if(txt.includes('"mode":"presentiel"')||txt.includes('prof_couleur'))return;
      // Détecter card cours — normaliser l'ancien openR vers viewCoursCard
      if(txt.includes('class="chat-cours-card"'))txt=txt.replace(/onclick="openR\(/g,'onclick="viewCoursCard(');
      var isCard=txt.trimStart().startsWith('<');
      var op=P[msgDestId]||{};
      var oPhoto=op.photo||null;
      var oIni=(op.i||(msgDestinataire&&msgDestinataire[0])||'?');
      var oCol=op.col||'linear-gradient(135deg,#FF8C55,var(--ord))';
      var avHtml='';
      if(!isMe){
        avHtml='<div class="msg-bubble-av" style="background:'+oCol+'">'+(oPhoto?'<img src="'+oPhoto+'" style="width:100%;height:100%;object-fit:cover">':oIni)+'</div>';
      }
      if(isCard){
        // Card cours
        h+='<div class="msg-bubble-row '+(isMe?'me':'them')+'">'
          +(isMe?'':avHtml)
          +'<div class="msg-card-wrap">'
          +txt
          +'<div class="msg-card-time" style="text-align:'+(isMe?'right':'left')+'">'+time+'</div>'
          +'</div>'
          +'</div>';
      } else {
        // Bulle texte
        var safe=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        h+='<div class="msg-bubble-row '+(isMe?'me':'them')+'">'
          +(isMe?'':avHtml)
          +'<div class="msg-bubble '+(isMe?'me':'them')+'">'
          +'<div style="white-space:pre-wrap">'+safe+'</div>'
          +'<div class="msg-bubble-time '+(isMe?'me':'them')+'">'+time+'</div>'
          +'</div>'
          +'</div>';
      }
    });
    box.innerHTML=h||'<div style="text-align:center;padding:40px;color:var(--lite)">Aucun message</div>';
    if(_wasAtBottom)box.scrollTop=box.scrollHeight;
    if(msgDestId)fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:apiH(),body:JSON.stringify({expediteur_id:msgDestId})}).catch(function(){});
  }catch(e){console.log('loadMessages err',e);}
}

async function sendMsg(){
  var txt=(g('msgInput').value||'').trim();
  if(!txt)return;
  if(!user){toast('Connexion requise','Reconnectez-vous pour envoyer des messages');return;}
  if(user.role==='professeur'&&!user.verified){toast('Compte non vérifié','Votre compte doit être vérifié pour envoyer des messages');return;}
  if(!msgDestId){toast('Erreur','Aucun destinataire sélectionné');return;}
  var inp=g('msgInput');
  inp.value='';inp.style.height='auto';
  var btn=document.querySelector('#msgConvPane button[onclick*="sendMsg"]');
  if(btn)btn.disabled=true;
  try{
    var r=await fetch(API+'/messages',{method:'POST',headers:apiH(),body:JSON.stringify({
      expediteur_id:user.id,
      destinataire_id:msgDestId,
      contenu:txt
    })});
    if(!r.ok){var err=await r.json().catch(function(){return{};});toast('Erreur',err.error||'Message non envoyé');inp.value=txt;return;}
    // Marquer comme lu immédiatement dans l'UI
    var activeRow=document.querySelector('[data-uid="'+msgDestId+'"]');
    if(activeRow){activeRow.classList.remove('msg-unread');var dot=activeRow.querySelector('div[style*="border-radius:50%"]');if(dot)dot.remove();}
    // Mettre à jour badge nav
    var badge=g('bnavBadge');if(badge)badge.classList.remove('on');
    var msgBadge=g('msgBadge');if(msgBadge)msgBadge.style.display='none';
    // Appeler l'API pour marquer comme lu en base
    if(user&&msgDestId){
      fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:apiH(),body:JSON.stringify({expediteur_id:msgDestId})}).catch(function(){});
    }

    loadMessages();
  }catch(e){inp.value=txt;toast('Erreur','Message non envoyé — vérifiez votre connexion');}
  finally{if(btn)btn.disabled=false;}
}

function closeMsg(){
  clearInterval(msgPollTimer);msgPollTimer=null;
  msgDestId=null;
  closeM('bdMsg');
}

async function sendModalMsg(){
  var txt=g('modalMsgInput').value.trim();
  if(!txt||!msgDestId||!user)return;
  if(user.role==='professeur'&&!user.verified){
    toast('Compte non vérifié','Votre compte doit être vérifié pour envoyer des messages');
    return;
  }
  g('modalMsgInput').value='';
  try{
    await fetch(API+'/messages',{method:'POST',headers:apiH(),body:JSON.stringify({
      expediteur_id:user.id,
      destinataire_id:msgDestId,
      contenu:txt
    })});
    var badge=g('bnavBadge');if(badge)badge.classList.remove('on');
    var msgBadge=g('msgBadge');if(msgBadge)msgBadge.style.display='none';
    if(user&&msgDestId){
      fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:apiH(),body:JSON.stringify({expediteur_id:msgDestId})}).catch(function(){});
    }
    var container=g('modalMsgMessages');
    if(!container)return;
    var r=await fetch(API+'/messages/'+user.id+'/'+msgDestId,{headers:apiH()});
    var msgs=await r.json();
    if(!Array.isArray(msgs)||!msgs.length)return;
    var html='';
    msgs.forEach(function(m){
      var isMe=m.sender_id===user.id;
      var d=new Date(m.created_at);
      var time=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      html+='<div style="display:flex;justify-content:'+(isMe?'flex-end':'flex-start')+'"><div style="max-width:75%;background:'+(isMe?'var(--or)':'var(--bg)')+';color:'+(isMe?'#fff':'var(--ink)')+';border-radius:'+(isMe?'16px 16px 4px 16px':'16px 16px 16px 4px')+';padding:10px 13px;font-size:13.5px;line-height:1.5"><div>'+esc(m.contenu)+'</div><div style="font-size:10px;opacity:.6;margin-top:3px;text-align:right">'+time+'</div></div></div>';
    });
    container.innerHTML=html;
    container.scrollTop=container.scrollHeight;
  }catch(e){toast('Erreur','Message non envoyé');}
}

var _convLoading=false;
async function loadConversations(){
  if(!user)return;
  if(_convLoading)return;
  _convLoading=true;
  // Timeout de sécurité : libérer après 8s max
  var _convTimeout=setTimeout(function(){_convLoading=false;},8000);
  var lm=g('listM');
  if(!lm){_convLoading=false;return;}
  lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>Chargement</div>';
  try{
    var r=await fetch(API+'/conversations/'+user.id,{headers:apiH()});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var msgs=await r.json();
    if(!Array.isArray(msgs)||!msgs.length){
      var _isProf=user&&user.role==='professeur';
      var _emptyDesc=_isProf?'Entamez une conversation ou attendez qu\'un élève vous contacte':'Contactez un professeur depuis un cours';
      lm.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="width:48px;height:48px;margin:0 auto 12px;display:block;color:var(--bdr)"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div style="font-size:14px;font-weight:600">Aucune conversation</div><div style="font-size:12px;margin-top:6px">'+_emptyDesc+'</div></div>';
      _convLoading=false;return;
    }
    // Grouper par interlocuteur
    var convs={};
    msgs.forEach(function(m){
      var otherId=m.sender_id===user.id?m.receiver_id:m.sender_id;
      if(!otherId||otherId===user.id)return;
      if(!convs[otherId]||new Date(m.created_at)>new Date(convs[otherId].created_at))convs[otherId]=m;
    });
    var nonLus=0;
    var html=Object.keys(convs).map(function(otherId,_idx){
      var m=convs[otherId];
      var isMe=m.sender_id===user.id;
      var nonLu=!isMe&&!m.lu;
      if(nonLu)nonLus++;
      // Source 1 : données enrichies renvoyées directement par le backend
      if(!P[otherId])P[otherId]={n:'—',e:0};
      if(m.other_nom&&!P[otherId].nm){P[otherId].nm=m.other_nom;}
      if(m.other_photo&&!P[otherId].photo){P[otherId].photo=m.other_photo;}
      // Source 2 : cache P[]
      var p=P[otherId];
      var nm=p?p.nm:'';
      var col=p?p.col:'linear-gradient(135deg,#FF8C55,#E04E10)';
      var photo=p?p.photo:null;
      var ini=p?p.i:'';
      // Source 3 : fallback cours C[] si P encore incomplet
      if(!nm||!photo){
        var _cByProf=C.find(function(x){return x.pr===otherId;});
        if(_cByProf){
          if(!nm){nm=_cByProf.prof_nm||'';if(nm)P[otherId].nm=nm;}
          if(!ini){ini=_cByProf.prof_ini||'';if(ini)P[otherId].i=ini;}
          if(!col||col==='linear-gradient(135deg,#FF8C55,#E04E10)'){col=_cByProf.prof_col||col;if(col)P[otherId].col=col;}
          if(!photo){photo=_cByProf.prof_photo||null;if(photo)P[otherId].photo=photo;}
        }
      }
      // Fetch profil en arrière-plan uniquement si encore incomplet
      if(!nm||!photo)_fetchProf(otherId);
      if(!nm)nm='·\u200B·\u200B·';
      if(!ini)ini=nm[0]&&nm[0]!=='·'?nm[0].toUpperCase():'?';
      var av=photo?'<img src="'+photo+'" style="width:100%;height:100%;object-fit:cover">':ini;
      var time=new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      var _pc=m.contenu||'';
      var preview=_pc.includes('chat-cours-card')||_pc.includes('"mode":"')?'📚 A partagé un cours':(esc(_pc.slice(0,35))+(_pc.length>35?'…':''));
      var unreadDot=nonLu?'<div style="width:10px;height:10px;min-width:10px;border-radius:50%;background:var(--or);flex-shrink:0;align-self:center;box-shadow:0 0 0 3px rgba(255,107,43,.15)"></div>':'';
      return'<div class="msg-row'+(nonLu?' msg-unread':'')+'" data-uid="'+otherId+'" style="animation-delay:'+(_idx*0.055)+'s" onclick="openMsg(\''+nm.replace(/'/g,"\\'")+'\'\,\''+otherId+'\',\''+(photo||'')+'\')"><div class="msg-av" data-prof="'+otherId+'" style="background:'+col+'">'+av+'</div><div class="msg-info"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><div class="msg-name" data-profnm="'+otherId+'">'+nm+'</div><div style="font-size:11px;color:'+(nonLu?'var(--or)':'var(--lite)')+';font-weight:'+(nonLu?'700':'400')+'">'+time+'</div></div><div class="msg-preview">'+(isMe?'Vous · ':'')+preview+'</div></div>'+unreadDot+'</div>';
    }).join('');
    lm.innerHTML=html||'<div style="text-align:center;padding:20px;color:var(--lite)">Aucune conversation</div>';
    var badge=g('msgBadge');
    if(badge){if(nonLus>0){badge.style.display='inline-flex';badge.textContent=nonLus;}else{badge.style.display='none';}}
    var bnavBadge=g('bnavBadge');
    if(bnavBadge){if(nonLus>0){bnavBadge.classList.add('on');bnavBadge.textContent=nonLus;}else{bnavBadge.classList.remove('on');}}
  }catch(e){
    _convLoading=false;
    if(lm)lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">Erreur de chargement. <a onclick="loadConversations()" style="color:var(--or);cursor:pointer">Réessayer</a></div>';
  }finally{
    clearTimeout(_convTimeout);_convLoading=false;
    // Desktop : montrer placeholder si pas de conv active
    if(window.innerWidth>=769){
      var cp=g('msgConvPane');
      if(cp&&!msgDestId){cp.classList.add('empty-state');}
    }
  }
}


// ============================================================
// LOCALISATION — filtre par ville
// ============================================================
var locFilterTimer=null;
var actLoc='';

var _geoActive=false;
var _geoCoords=null;
var _geoDist=10;

function requestGeoloc(){
  // Toggle : si déjà actif → désactiver
  if(_geoActive){
    _geoActive=false;_geoCoords=null;
    var btn=g('locGeoBtn'),lbl=g('geoBtnLabel'),distBtn=g('geoDistBtn');
    if(btn){btn.style.background='var(--orp)';btn.style.color='var(--or)';btn.style.padding='5px 8px';}
    if(lbl){lbl.textContent='Autour de moi';lbl.style.display='';}
    if(distBtn)distBtn.style.display='none';
    var inp=g('locInput');if(inp)inp.value='';
    var cb=g('locClearBtn');if(cb)cb.style.display='none';
    actLoc='';geoMode=false;userCoords=null;
    applyFilter();
    return;
  }
  if(!navigator.geolocation){toast('Non supporté','Géolocalisation non disponible');return;}
  var btn=g('locGeoBtn'),lbl=g('geoBtnLabel');
  if(lbl)lbl.textContent='…';
  if(btn)btn.style.opacity='.6';
  navigator.geolocation.getCurrentPosition(
    function(pos){
      _geoActive=true;
      _geoCoords={lat:pos.coords.latitude,lon:pos.coords.longitude};
      userCoords=_geoCoords;geoMode=true;
      // Afficher immédiatement sans attendre le reverse geocoding
      var inp=g('locInput');if(inp)inp.value='📍 Autour de moi';
      var cb=g('locClearBtn');if(cb)cb.style.display='block';
      if(btn){btn.style.background='var(--or)';btn.style.color='#fff';btn.style.opacity='1';btn.style.padding='5px 7px';}
      if(lbl)lbl.style.display='none'; // masquer le texte, garder juste l'icône
      var distBtn=g('geoDistBtn');if(distBtn)distBtn.style.display='block';
      applyFilter();
      toast('Position détectée 📍','');
      // Reverse geocoding en arrière-plan (non bloquant)
      fetch('https://nominatim.openstreetmap.org/reverse?lat='+pos.coords.latitude+'&lon='+pos.coords.longitude+'&format=json&accept-language=fr')
        .then(function(r){return r.json();})
        .then(function(d){
          var ville=d.address.city||d.address.town||d.address.village||'';
          var inp2=g('locInput');
          if(inp2&&ville)inp2.value='📍 '+ville;
          actLoc=ville.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        }).catch(function(){});
    },
    function(err){
      if(btn){btn.style.opacity='1';}
      if(lbl)lbl.textContent='Autour de moi';
      if(err.code===1)toast('Refusé','Activez la localisation dans vos réglages');
      else toast('Erreur','Impossible de détecter la position');
    },
    {enableHighAccuracy:false,timeout:5000,maximumAge:30000}
  );
}

function openDistFilter(){
  var bd=g('bdDistFilter');
  if(bd)bd.style.display='flex';
}
function closeDistFilter(){
  var bd=g('bdDistFilter');
  if(bd)bd.style.display='none';
}
function setDistFilter(km,el){
  _geoDist=km;
  document.querySelectorAll('#distFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var lbl=g('geoDistLabel');
  if(lbl)lbl.textContent=km+' km';
  closeDistFilter();
  applyFilter();
  if(navigator.vibrate)navigator.vibrate(6);
}

function filterByLoc(val){
  var btn=g('locClearBtn');
  if(btn)btn.style.display=val.trim()?'block':'none';
  clearTimeout(locFilterTimer);
  locFilterTimer=setTimeout(function(){
    actLoc=val.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    applyFilter();
  },300);
}

function locInputClear(){
  var inp=g('locInput');
  if(inp)inp.value='';
  var btn=g('locClearBtn');
  if(btn)btn.style.display='none';
  actLoc='';
  applyFilter();
}

// ============================================================
// FILTRES CUSTOM
// ============================================================
var customFilters=(function(){try{return JSON.parse(localStorage.getItem('cp_custom_filters')||'[]');}catch(e){return[];}})();
// Reconstruire FM pour les filtres restaurés depuis localStorage
customFilters.forEach(function(f){FM['custom_'+f.key]=function(t){return t.includes(f.key);};});

function openAddFilter(){
  var bd=g('bdFilter');
  if(!bd)return;
  // Déplacer dans body pour éviter le clipping par overflow:hidden du parent
  if(bd.parentNode!==document.body)document.body.appendChild(bd);
  g('filterInput').value='';
  renderCustomPills();
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeAddFilter(){
  var bd=g('bdFilter');
  if(bd)bd.style.display='none';
  document.body.style.overflow='';
}

function addCustomFilter(){
  var val=g('filterInput').value.trim();
  if(!val)return;
  addFilterQuick(val);
  g('filterInput').value='';
}

// Ajoute la matière dans le popup (liste de sélection) — PAS dans la barre
function addFilterQuick(val){
  var key=val.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(customFilters.find(function(f){return f.key===key;}))return;
  customFilters.push({label:val,key:key});
  try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
  renderCustomPills();
}

// Appelé quand l'user clique sur un chip dans le popup → ajoute à la barre et active
function selectCustomFilter(key){
  var f=customFilters.find(function(cf){return cf.key===key;});
  if(!f)return;
  var existing=document.querySelector('[data-f="custom_'+key+'"]');
  if(!existing){
    var addBtn=g('pillAdd');
    var pill=document.createElement('button');
    pill.className='filter-pill-btn pill';
    pill.dataset.f='custom_'+key;
    pill.innerHTML=esc(f.label)+' <span onclick="event.stopPropagation();removeCustomFilter(\''+key+'\');" style="margin-left:4px;opacity:.5;font-size:11px">✕</span>';
    pill.onclick=function(){setPill(pill);};
    addBtn.parentNode.insertBefore(pill,addBtn);
    FM['custom_'+key]=function(t){return t.includes(key);};
    existing=pill;
  }
  closeAddFilter();
  setPill(existing);
}

function removeCustomFilter(key){
  customFilters=customFilters.filter(function(f){return f.key!==key;});
  try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
  var pill=document.querySelector('[data-f="custom_'+key+'"]');
  if(pill){
    if(pill.classList.contains('on')){var _tous=g('pillTous')||document.querySelector('[data-f="tous"]');if(_tous)setPill(_tous);}
    pill.remove();
  }
  delete FM['custom_'+key];
  applyFilter();
  renderCustomPills();
}

function renderCustomPills(){
  var box=g('customPillsList');
  if(!box)return;
  if(!customFilters.length){box.innerHTML='';return;}
  box.innerHTML='<div style="font-size:12px;font-weight:600;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Mes matières — appuie pour filtrer</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:8px">'
    +customFilters.map(function(f){
      var isActive=!!document.querySelector('[data-f="custom_'+f.key+'"].on');
      return'<span onclick="selectCustomFilter(\''+f.key+'\')" style="display:inline-flex;align-items:center;gap:6px;'
        +(isActive?'background:var(--or);color:#fff;border:1.5px solid var(--or)':'background:var(--orp);color:var(--or);border:1.5px solid var(--or)')
        +';border-radius:50px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">'+esc(f.label)
        +'<span onclick="event.stopPropagation();removeCustomFilter(\''+f.key+'\');" style="cursor:pointer;opacity:.6;font-size:12px;font-weight:700;line-height:1;margin-left:2px">✕</span></span>';
    }).join('')
    +'</div>';
}

// ============================================================
// ============================================================
// VÉRIFICATION IDENTITÉ — chronologie propre
// ============================================================

function getCniStatus(){
  if(!user)return 'none';
  // Statut depuis DB (prioritaire sur localStorage)
  if(user.verified)return 'verified';
  if(user.statut_compte==='bloqué'&&user.can_retry_cni===false)return 'rejected_final';
  if(user.statut_compte==='rejeté')return 'rejected_retry';
  if(user.cni_uploaded)return 'pending';
  return 'none';
}

// ============================================================
// GROUPE DE COURS
// ============================================================
var _groupeCoursId = null;
var _groupeElevesPermis = false;
var _groupePollTimer = null;
var _groupeIsProf = false;

function openGroupeMsg(coursId){
  _groupeCoursId = coursId;
  var c = C.find(function(x){return x.id==coursId;});
  if(!c) return;
  _groupeIsProf = user && user.id === c.pr;
  _groupeElevesPermis = c.eleves_peuvent_ecrire || false;

  var gt = g('groupeTitle'); if(gt) gt.textContent = c.title;
  var gs = g('groupeSubtitle'); if(gs) gs.textContent = c.fl + ' inscrit' + (c.fl>1?'s':'') + ' · ' + c.dt;

  // Toggle permission visible seulement pour le prof
  var pw = g('groupePermWrap'); if(pw) pw.style.display = _groupeIsProf ? 'flex' : 'none';
  _updateGroupeToggle();
  _updateGroupeInput();

  var gm = g('groupeMsg'); if(gm){gm.value='';gm.style.height='auto';}
  var bd = g('bdGroupe'); if(bd) bd.style.display = 'flex';
  haptic(4);

  _loadGroupeMsgs();
  clearInterval(_groupePollTimer);
  _groupePollTimer = setInterval(_loadGroupeMsgs, 4000);
}

function closeGroupe(){
  clearInterval(_groupePollTimer); _groupePollTimer = null;
  var bd = g('bdGroupe');
  if(bd){bd.style.opacity='0';bd.style.transition='opacity .2s';setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},200);}
}

function _updateGroupeToggle(){
  var tog = g('groupeToggle'), knob = g('groupeToggleKnob'), lbl = g('groupePermLabel');
  if(tog) tog.style.background = _groupeElevesPermis ? 'var(--green)' : 'var(--bdr)';
  if(knob) knob.style.transform = _groupeElevesPermis ? 'translateX(18px)' : 'translateX(0)';
  if(lbl) lbl.textContent = _groupeElevesPermis ? 'Élèves actifs' : 'Élèves muets';
}

function _updateGroupeInput(){
  var muet = g('groupeMuetMsg'), inp = g('groupeMsg'), btn = g('groupeSubmitBtn');
  var canWrite = _groupeIsProf || _groupeElevesPermis;
  if(inp) inp.style.display = canWrite ? '' : 'none';
  if(btn) btn.style.display = canWrite ? '' : 'none';
  if(muet) muet.style.display = canWrite ? 'none' : 'block';
}

function toggleGroupePerm(){
  _groupeElevesPermis = !_groupeElevesPermis;
  _updateGroupeToggle();
  _updateGroupeInput();
  haptic(6);
  if(_groupeCoursId){
    fetch(API+'/cours/'+_groupeCoursId+'/groupe',{
      method:'PATCH',
      headers:apiH(),
      body:JSON.stringify({eleves_peuvent_ecrire:_groupeElevesPermis})
    }).catch(function(){});
    var c = C.find(function(x){return x.id==_groupeCoursId;});
    if(c) c.eleves_peuvent_ecrire = _groupeElevesPermis;
  }
  toast(_groupeElevesPermis ? 'Élèves peuvent écrire' : 'Élèves mis en lecture seule', '');
}

async function _loadGroupeMsgs(){
  if(!_groupeCoursId) return;
  try{
    var r = await fetch(API+'/messages/groupe/'+_groupeCoursId,{headers:apiH()});
    var msgs = await r.json();
    var container = g('groupeMsgList');
    if(!container) return;
    if(!Array.isArray(msgs)||!msgs.length){
      container.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--lite);font-size:13px">Aucun message pour l\'instant.<br>Soyez le premier à écrire !</div>';
      return;
    }
    var wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    var html='';
    var lastDate='';
    msgs.forEach(function(m){
      var d = new Date(m.created_at);
      var dateKey = d.toDateString();
      if(dateKey !== lastDate){
        lastDate = dateKey;
        var today = new Date(); today.setHours(0,0,0,0);
        var diff = Math.round((today.getTime() - new Date(dateKey).getTime())/(1000*60*60*24));
        var label = diff===0?"Aujourd'hui":diff===1?'Hier':d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
        html+='<div style="text-align:center;margin:10px 0 6px"><span style="background:var(--wh);color:var(--lite);font-size:11px;font-weight:600;padding:3px 10px;border-radius:50px;box-shadow:0 1px 4px rgba(0,0,0,.07)">'+label+'</span></div>';
      }
      var isMe = m.sender_id === (user&&user.id);
      var time = d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      var nm = m.sender_nom || 'Utilisateur';
      var ini = nm[0]||'?';
      var avHtml = isMe ? '' : '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF8C55,var(--ord));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;align-self:flex-end">'+ini+'</div>';
      var nameHtml = isMe ? '' : '<div style="font-size:11px;color:var(--lite);margin-bottom:2px;padding-left:34px">'+nm+'</div>';
      var bg = isMe ? 'linear-gradient(135deg,var(--or),var(--ord))' : 'var(--wh)';
      var col = isMe ? '#fff' : 'var(--ink)';
      var br = isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px';
      html+='<div style="display:flex;flex-direction:column;margin-bottom:2px">'+nameHtml
        +'<div style="display:flex;justify-content:'+(isMe?'flex-end':'flex-start')+';align-items:flex-end;gap:6px">'
        +avHtml
        +'<div style="max-width:75%;background:'+bg+';color:'+col+';border-radius:'+br+';padding:9px 13px;font-size:14px;line-height:1.5;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
        +esc(m.contenu)
        +'<div style="font-size:10px;opacity:.5;margin-top:3px;text-align:'+(isMe?'right':'left')+'">'+time+'</div>'
        +'</div></div></div>';
    });
    container.innerHTML = html;
    if(wasAtBottom) container.scrollTop = container.scrollHeight;
  }catch(e){}
}

async function sendGroupeMsg(){
  if(!user) return;
  var canWrite = _groupeIsProf || _groupeElevesPermis;
  if(!canWrite){ toast('Lecture seule',"Le professeur n'a pas activé les réponses"); return; }
  var inp = g('groupeMsg');
  var contenu = inp ? inp.value.trim() : '';
  if(!contenu) return;
  var btn = g('groupeSubmitBtn'); if(btn) btn.disabled = true;
  inp.value = ''; inp.style.height = 'auto';
  try{
    var c = C.find(function(x){return x.id==_groupeCoursId;});
    await fetch(API+'/messages/groupe',{
      method:'POST',
      headers:apiH(),
      body:JSON.stringify({
        cours_id:_groupeCoursId,
        expediteur_id:user.id,
        expediteur_nom:((user.pr||'')+(user.nm?' '+user.nm:'')).trim()||'Utilisateur',
        contenu:contenu,
        cours_titre:c?c.title:'Cours'
      })
    });
    await _loadGroupeMsgs();
    var container = g('groupeMsgList');
    if(container) container.scrollTop = container.scrollHeight;
    haptic(6);
  }catch(e){ toast('Erreur','Message non envoyé'); }
  finally{ if(btn) btn.disabled = false; }
}

// ============================================================
// PICKER NATIF — bottom sheet liste d'options
// ============================================================
var _pickerType = null;
var _STATUT_OPTIONS = [
  {val:'etudiant', label:'Étudiant'},
  {val:'prof_ecole', label:'Prof des écoles'},
  {val:'prof_college', label:'Collège / lycée'},
  {val:'prof_universite', label:'Enseignant-chercheur'},
  {val:'auto', label:'Auto-entrepreneur'},
  {val:'autre', label:'Autre'}
];

function openPicker(type){
  _pickerType = type;
  var bd = g('bdPicker');
  var title = g('pickerTitle');
  var opts = g('pickerOptions');
  if(!bd||!opts)return;

  var options = [];
  var currentVal = '';

  if(type === 'statut'){
    title.textContent = 'Statut professionnel';
    options = _STATUT_OPTIONS;
    currentVal = g('pfStatut') ? g('pfStatut').value : '';
  } else if(type === 'niveau'){
    var statut = g('pfStatut') ? g('pfStatut').value : '';
    var n = NIVEAUX[statut];
    if(!n)return;
    title.textContent = n.label;
    options = n.options.map(function(o){return{val:o,label:o};});
    currentVal = g('pfNiveau') ? g('pfNiveau').value : '';
  }

  opts.innerHTML = options.map(function(o){
    var isActive = o.val === currentVal;
    var bg = isActive ? 'var(--orp)' : 'transparent';
    return '<div class="picker-opt" data-val="'+o.val+'" data-label="'+o.label+'" style="display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-radius:14px;cursor:pointer;margin-bottom:2px;background:'+bg+';-webkit-tap-highlight-color:transparent;transition:background .12s">'
      +'<span style="font-size:16px;color:'+(isActive?'var(--or)':'var(--ink)')+';font-weight:'+(isActive?'700':'400')+'">'+o.label+'</span>'
      +(isActive?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>':'')
      +'</div>';
  }).join('');
  opts.querySelectorAll('.picker-opt').forEach(function(el){
    el.addEventListener('click',function(){selectPicker(this.dataset.val,this.dataset.label);});
    el.addEventListener('touchstart',function(){this.style.background='var(--orp)';},{passive:true});
    el.addEventListener('touchend',function(){this.style.background=this.dataset.val===currentVal?'var(--orp)':'transparent';},{passive:true});
  });

  bd.style.display = 'flex';
  haptic(4);
}

function selectPicker(val, label){
  haptic(6);
  if(_pickerType === 'statut'){
    var inp = g('pfStatut');
    var lbl = g('pfStatutLabel');
    if(inp) inp.value = val;
    if(lbl) lbl.textContent = label;
    updateNiveauxPf(val);
  } else if(_pickerType === 'niveau'){
    var inp2 = g('pfNiveau');
    var lbl2 = g('pfNiveauValLabel');
    if(inp2) inp2.value = val;
    if(lbl2) lbl2.textContent = label;
  }
  closePicker();
}

function closePicker(){
  var bd = g('bdPicker');
  if(bd){
    bd.style.opacity='0';
    bd.style.transition='opacity .2s';
    setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},200);
  }
}

function openCniSheet(){
  var bd=g('bdCni');if(!bd)return;
  var status=getCniStatus();
  if(status==='pending'){
    cniGoStep3(true); // déjà envoyé → aller direct à la confirmation (mode retour)
  } else if(status==='verified'){
    bd.style.display='none';return; // rien à faire
  } else {
    cniGoStep1();
  }
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}

function cniGoStep1(){
  var s1=g('cniStep1'),s2=g('cniStep2'),s3=g('cniStep3');
  if(s1)s1.style.display='block';
  if(s2)s2.style.display='none';
  if(s3)s3.style.display='none';
}
function cniGoStep2(){
  var s1=g('cniStep1'),s2=g('cniStep2'),s3=g('cniStep3');
  if(s1)s1.style.display='none';
  if(s2)s2.style.display='block';
  if(s3)s3.style.display='none';
}
function cniGoStep3(isReturn){
  var s1=g('cniStep1'),s2=g('cniStep2'),s3=g('cniStep3');
  if(s1)s1.style.display='none';
  if(s2)s2.style.display='none';
  if(s3)s3.style.display='block';
  // Texte différent si on revient consulter l'état
  var t=g('cniStep3Title'),sub=g('cniStep3Sub');
  if(isReturn){
    if(t)t.textContent='Vérification en cours ⏳';
    if(sub)sub.innerHTML='Votre document a bien été reçu.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.';
  } else {
    if(t)t.textContent='Document envoyé ✓';
    if(sub)sub.innerHTML='Nous vérifions votre identité.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.';
    haptic(20);
  }
}

function cniLater(){
  var bd=g('bdCni');if(bd)bd.style.display='none';
  document.body.style.overflow='';
  toast('À compléter','Vous pourrez envoyer votre document depuis votre profil');
  setTimeout(function(){if(typeof tutoStart==='function')tutoStart();},600);
}

function cniDone(){
  var bd=g('bdCni');if(bd)bd.style.display='none';
  document.body.style.overflow='';
  // Mettre à jour les deux indicateurs de statut
  updateVerifStatusBlock();
  updateVerifBand();
  setTimeout(function(){if(typeof tutoStart==='function')tutoStart();},400);
}

function cniPreview(input){
  if(!input.files||!input.files[0])return;
  var zone=g('cniDropZone'),lbl=g('cniUploadLabel'),icon=g('cniUploadIcon');
  if(zone){zone.style.borderColor='var(--green)';zone.style.background='#F0FDF4';}
  if(lbl)lbl.textContent=input.files[0].name;
  if(icon)icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="48" height="48" style="margin:0 auto;display:block"><polyline points="20 6 9 17 4 12"/></svg>';
}

async function submitCni(){
  var finput=g('cniFileInput');
  var file=finput&&finput.files&&finput.files[0];
  if(!file){
    var zone=g('cniDropZone');
    if(zone){zone.style.borderColor='#EF4444';setTimeout(function(){zone.style.borderColor='var(--bdr)';},600);}
    toast('Document manquant','Choisissez votre CNI ou passeport');return;
  }
  if(file.size>5*1024*1024){toast('Fichier trop lourd','La taille maximale est 5 Mo');return;}
  var btn=g('cniSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent='Envoi...';}
  try{
    var reader=new FileReader();
    reader.onload=async function(e){
      try{await fetch(API+'/upload/cni',{method:'POST',headers:apiH(),body:JSON.stringify({base64:e.target.result,userId:user.id,filename:file.name})});}catch(err){}
      user.cni_uploaded=true;
      cniGoStep3();
      if(btn){btn.disabled=false;btn.textContent='Envoyer pour vérification';}
    };
    reader.readAsDataURL(file);
  }catch(e){
    toast('Erreur',"Impossible d'envoyer le fichier");
    if(btn){btn.disabled=false;btn.textContent='Envoyer pour vérification';}
  }
}

async function checkFirstProfLogin(){
  if(!user||user.role!=='professeur')return;
  var status=getCniStatus();
  if(status!=='none')return;
  try{
    var r=await fetch(API+'/profiles/'+user.id,{headers:apiH()});
    var p=await r.json();
    if(p&&p.verified){user.verified=true;return;}
    if(p&&p.cni_uploaded){user.cni_uploaded=true;return;}
  }catch(e){}
  setTimeout(openCniSheet, 1000);
}

function updateVerifStatusBlock(){
  var block=g('verifStatusBlock');
  if(!block)return;
  if(!user||user.role!=='professeur'){block.style.display='none';return;}
  var status=getCniStatus();
  if(status==='none'){
    var html='<div style="background:var(--orp);border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:var(--or)">Vérification d\'identité requise</span>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--lite);line-height:1.5;margin-bottom:12px">Envoyez votre pièce d\'identité pour activer votre compte et publier des cours.</div>'
      +'<button onclick="openCniSheet()" style="width:100%;background:var(--or);color:#fff;border:none;border-radius:10px;padding:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer">Envoyer ma pièce d\'identité</button>'
      +'</div>';
    block.style.display='block';
    block.innerHTML=html;
    return;
  }
  var html='';
  if(status==='verified'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#F0FDF4;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2.5" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#15803D">Identité vérifiée — Compte certifié</span>'
      +'</div>';
  } else if(status==='pending'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#FFFBEB;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#92400E">Vérification en cours — Réponse sous 24h</span>'
      +'</div>';
  } else if(status==='rejected_retry'){
    var raison=user.rejection_reason||'';
    html='<div style="background:#FEF2F2;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+(raison?'10':'0')+'px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#991B1B">Vérification refusée — Vous pouvez renvoyer votre document</span>'
      +'</div>'
      +(raison?'<div style="font-size:12px;color:#B91C1C;background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.5">'+raison+'</div>':'')
      +'<button onclick="openCniSheet()" style="width:100%;background:#EF4444;color:#fff;border:none;border-radius:10px;padding:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer">Renvoyer ma pièce d’identité</button>'
      +'</div>';
    // Réinitialiser le statut local pour permettre le renvoi
    if(user)user.cni_uploaded=false;
  } else if(status==='rejected_final'){
    var raison=user.rejection_reason||'';
    html='<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+(raison?'10':'0')+'px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#374151">Compte non éligible</span>'
      +'</div>'
      +(raison?'<div style="font-size:12px;color:#6B7280;line-height:1.5">'+raison+'</div>':'')
      +'</div>';
  }
  block.style.display='block';
  block.innerHTML=html;
}


// ============================================================
// COURS PRIVÉ
// ============================================================
var isCoursPrivé=false;
var codePrivé='';

function genCode(){
  var chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code='';
  for(var i=0;i<6;i++)code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function regenCode(){
  codePrivé=genCode();
  g('codePriveVal').textContent=codePrivé;
}

function toggleCoursPrivé(){
  isCoursPrivé=!isCoursPrivé;
  var tog=g('togglePrive');
  var knob=g('togglePriveKnob');
  var box=g('codePriveBox');
  if(isCoursPrivé){
    tog.style.background='var(--or)';
    knob.style.transform='translateX(18px)';
    box.style.display='block';
    if(!codePrivé){codePrivé=genCode();g('codePriveVal').textContent=codePrivé;}
  } else {
    tog.style.background='var(--bdr)';
    knob.style.transform='translateX(0)';
    box.style.display='none';
  }
}

// ============================================================
// ACCÈS COURS PRIVÉ — barre de recherche + URL
// ============================================================
function checkProfDeepLink(){
  try{
    var params=new URLSearchParams(window.location.search);
    var profId=params.get('prof');
    if(profId){
      window.history.replaceState({},'',window.location.pathname);
      setTimeout(function(){openPr(profId);},800);
    }
  }catch(e){}
}

function checkPrivateCoursAccess(){
  // Vérifier si URL contient ?code=XXXX
  try{
    var params=new URLSearchParams(window.location.search);
    var code=params.get('code');
    if(code){
      window.history.replaceState({},'',window.location.pathname);
      openPrivateCours(code.toUpperCase());
    }
  }catch(e){}
}

function openPrivateCours(code){
  // Chercher le cours avec ce code dans C
  var c=C.find(function(x){return x.code&&x.code.toUpperCase()===code.toUpperCase();});
  if(c){
    openR(c.id);
    toast('Cours trouvé !',c.title);
  } else {
    // Essayer en fetch direct
    fetch(API+'/cours/code/'+code).then(function(r){return r.json();}).then(function(data){
      if(data&&data.id){
        // Ajouter dans C temporairement
        var nc={
          id:data.id,t:((data.titre||'')+' '+(data.sujet||'')).toLowerCase(),
          subj:data.sujet||'Autre',sc:data.couleur_sujet||'#7C3AED',
          bg:data.background||'linear-gradient(135deg,#F5F3FF,#DDD6FE)',
          title:data.titre||'',dt:data.date_heure||'',lc:data.lieu||'',
          tot:data.prix_total||0,sp:data.places_max||5,fl:data.places_prises||0,
          pr:data.professeur_id,em:data.emoji||'🔒',
          prof_ini:data.prof_initiales||'?',prof_col:data.prof_couleur||'linear-gradient(135deg,#FF8C55,#E04E10)',
          prof_nm:data.prof_nom||'Professeur',prof_photo:data.prof_photo||null,
          description:data.description||'',code:data.code_acces||''
        };
        C.unshift(nc);
        openR(nc.id);
        toast('Cours privé trouvé !',nc.title);
      } else {
        toast('Code invalide','Aucun cours trouvé avec ce code');
      }
    }).catch(function(){toast('Code invalide','Aucun cours trouvé avec ce code');});
  }
}

// Taper un code dans la recherche
function checkCodeInSearch(val){
  var clean=val.trim().toUpperCase();
  // Format code: 6 caractères alphanumériques sans espace
  if(/^[A-Z0-9]{6}$/.test(clean)){
    openPrivateCours(clean);
    return true;
  }
  return false;
}


// ============================================================
// TUTORIEL PREMIÈRE CONNEXION — adapté prof/élève
// ============================================================



// ============================================================
// TUTORIEL v3 — slides centrées, fiables sur tous les devices
// ============================================================

var TUTO_ELEVE = [
  {
    bg: 'linear-gradient(135deg,var(--or),var(--ord))',
    emoji: '👋',
    title: 'Bienvenue sur CoursPool !',
    desc: 'La plateforme qui divise le coût d\'un cours entre plusieurs élèves. Un prof, plusieurs places, un prix juste pour tout le monde.',
    tip: null
  },
  {
    bg: 'linear-gradient(135deg,#EFF6FF,#BFDBFE)',
    emoji: '🔍',
    title: 'Explore les cours près de toi',
    desc: 'Tape ta ville dans la barre de localisation. Les cours s\'affichent par matière, date et distance. Filtre par Maths, Langues, Info… ou ajoute tes propres matières avec le bouton "+".',
    tip: 'Tu peux aussi entrer un code privé dans la barre de recherche si un prof te l\'a partagé.'
  },
  {
    bg: 'linear-gradient(135deg,#F0FDF4,#BBF7D0)',
    emoji: '💳',
    title: 'Réserve et paie ta part',
    desc: 'Clique sur un cours puis "Réserver". Le paiement est sécurisé. Tu ne paies que ta part — le reste est partagé entre tous les élèves inscrits.',
    tip: 'Tu peux aussi réserver une place pour quelqu\'un d\'autre, ou partager le lien du cours.'
  },
  {
    bg: 'linear-gradient(135deg,#FFF7ED,#FED7AA)',
    emoji: '💬',
    title: 'Contacte le professeur',
    desc: 'Une question avant de réserver ? Clique sur l\'onglet Messages pour écrire directement au prof. Tu peux aussi accéder à la messagerie depuis la carte d\'un cours.',
    tip: null
  },
  {
    bg: 'linear-gradient(135deg,#F5F3FF,#DDD6FE)',
    emoji: '👤',
    title: 'Ton espace personnel',
    desc: 'Dans l\'onglet Profil : retrouve tes réservations à venir, les profs que tu suis (tu seras notifié de leurs prochains cours), et ton historique. Après un cours tu peux laisser un avis ⭐ — ça aide les profs et les futurs élèves !',
    tip: null
  }
];

var TUTO_PROF = [
  {
    bg: 'linear-gradient(135deg,var(--or),var(--ord))',
    emoji: '👋',
    title: 'Bienvenue sur CoursPool !',
    desc: 'Tu vas pouvoir proposer tes cours à plusieurs élèves et partager les frais entre eux. CoursPool gère tout : inscriptions, paiements, messagerie.',
    tip: null,
    ui: null
  },
  {
    bg: 'linear-gradient(135deg,#F0FDF4,#BBF7D0)',
    emoji: null,
    title: 'Crée ton premier cours',
    desc: 'Appuie sur le bouton orange ci-dessous pour créer ton premier cours. Choisis la matière, la date, le lieu et ton prix total. CoursPool divise le coût entre tous tes élèves.',
    tip: 'Tu peux aussi rendre un cours privé en activant l\'option en bas du formulaire. Un code d\'accès unique sera généré.',
    ui: 'add_button'
  },
  {
    bg: 'linear-gradient(135deg,#FFF7ED,#FED7AA)',
    emoji: null,
    title: 'Tes paiements',
    desc: 'Dès qu\'un élève réserve, le paiement est encaissé automatiquement. Dans ton espace Profil tu retrouves tout l\'historique et le total de tes revenus.',
    tip: 'Renseigne ton IBAN dans l\'onglet Paiements pour recevoir tes virements automatiquement.',
    ui: 'profile_tab'
  },
  {
    bg: 'linear-gradient(135deg,#EFF6FF,#BFDBFE)',
    emoji: null,
    title: 'Messages avec tes élèves',
    desc: 'Les élèves peuvent te contacter avant de réserver. Réponds vite depuis l\'onglet Messages pour maximiser tes inscriptions.',
    tip: null,
    ui: 'messages_tab'
  },
  {
    bg: 'linear-gradient(135deg,#F5F3FF,#DDD6FE)',
    emoji: null,
    title: 'Ton espace professeur',
    desc: 'Dans Profil retrouve la liste des élèves inscrits à chaque cours, les avis laissés et toutes tes informations. Tu peux aussi annuler un cours et les élèves sont remboursés automatiquement.',
    tip: null,
    ui: 'profile_tab'
  }
];

// ============================================================
// TUTORIEL INTERACTIF — SPOTLIGHT sur les vrais éléments
// ============================================================
var _tutoSteps=[], _tutoIdx=0;
var _tutoLaunched=false;

// Définir les étapes avec sélecteur CSS de l'élément ciblé
var _TUTO_SVG={
  logo:'<div style="width:72px;height:72px;background:rgba(255,255,255,.2);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.03em">CoursPool</div>',
  locbar:'<div style="background:rgba(255,255,255,.15);border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:10px;max-width:260px;margin:0 auto;border:1.5px solid rgba(255,255,255,.3)"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="color:rgba(255,255,255,.85);font-size:13px;flex:1">Ville, code postal...</span><div style="background:rgba(255,255,255,.25);border-radius:8px;padding:4px 10px;display:flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span style="color:#fff;font-size:11px;font-weight:700">Autour de moi</span></div></div>',
  card:'<div style="background:rgba(255,255,255,.12);border-radius:16px;overflow:hidden;max-width:230px;margin:0 auto;border:1.5px solid rgba(255,255,255,.25)"><div style="background:var(--wh);padding:10px 14px"><span style="background:rgba(255,255,255,.2);border-radius:50px;padding:3px 10px;font-size:11px;font-weight:700;color:#fff">Maths</span></div><div style="padding:12px 14px"><div style="color:#fff;font-weight:700;font-size:14px;margin-bottom:4px">Algèbre niveau terminale</div><div style="color:rgba(255,255,255,.65);font-size:11px;margin-bottom:10px">Sam. 22 mars · 14h00 · Paris</div><div style="display:flex;justify-content:space-between;align-items:center"><div style="color:#fff;font-weight:800;font-size:18px">8€<span style="font-size:11px;font-weight:400;opacity:.7"> /élève</span></div><div style="background:#fff;color:#22C069;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700">Réserver</div></div></div></div>',
  msg:'<div style="display:flex;flex-direction:column;gap:8px;max-width:240px;margin:0 auto"><div style="background:rgba(255,255,255,.9);border-radius:14px 14px 4px 14px;padding:10px 14px;align-self:flex-start;max-width:85%"><span style="font-size:12px;color:#4338CA;font-weight:500">Bonjour, le cours est encore disponible ?</span></div><div style="background:rgba(255,255,255,.2);border-radius:14px 14px 14px 4px;padding:10px 14px;align-self:flex-end;border:1.5px solid rgba(255,255,255,.3);max-width:75%"><span style="font-size:12px;color:#fff">Oui, il reste 2 places !</span></div></div>',
  plus:'<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><div style="background:rgba(0,0,0,.15);border-radius:24px;padding:16px 24px;display:flex;align-items:center;gap:16px;border:1.5px solid rgba(255,255,255,.2)"><div style="display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.5"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" width="20" height="20"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span style="color:#fff;font-size:9px;font-weight:600">EXPLORER</span></div><div style="width:44px;height:26px;border-radius:14px;background:#FF6B2B;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(255,107,43,.5)"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div><div style="display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.5"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span style="color:#fff;font-size:9px;font-weight:600">PROFIL</span></div></div><span style="color:rgba(255,255,255,.7);font-size:11px;font-weight:600">Appuyez sur + pour créer</span></div>',
  profil:'<div style="background:rgba(255,255,255,.12);border-radius:16px;padding:14px;max-width:210px;margin:0 auto;border:1.5px solid rgba(255,255,255,.2)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#FF8C55,#E04E10);display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div><div style="color:#fff;font-weight:700;font-size:13px">Mon compte</div><div style="color:rgba(255,255,255,.55);font-size:11px">Réservations · Suivis</div></div></div><div style="display:flex;gap:6px"><div style="flex:1;background:rgba(255,255,255,.12);border-radius:8px;padding:8px;text-align:center"><div style="color:#fff;font-weight:800;font-size:15px">3</div><div style="color:rgba(255,255,255,.55);font-size:10px">Réservés</div></div><div style="flex:1;background:rgba(255,255,255,.12);border-radius:8px;padding:8px;text-align:center"><div style="color:#fff;font-weight:800;font-size:15px">2</div><div style="color:rgba(255,255,255,.55);font-size:10px">Suivis</div></div></div></div>',
  revenus:'<div style="background:rgba(255,255,255,.12);border-radius:16px;padding:14px;max-width:210px;margin:0 auto;border:1.5px solid rgba(255,255,255,.2)"><div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Revenus du mois</div><div style="color:#fff;font-size:26px;font-weight:800;margin-bottom:10px">240€</div><div style="display:flex;flex-direction:column;gap:5px"><div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.1);border-radius:8px;padding:7px 10px"><span style="color:#fff;font-size:12px">Cours de Maths</span><span style="color:#4ADE80;font-size:12px;font-weight:700">+80€</span></div><div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.1);border-radius:8px;padding:7px 10px"><span style="color:#fff;font-size:12px">Cours Anglais</span><span style="color:#4ADE80;font-size:12px;font-weight:700">+160€</span></div></div></div>'
};

var TUTO_ELEVE_STEPS=[
  {bg:'linear-gradient(135deg,#FF8C55,#E04E10)',illu:'logo',title:'Bienvenue sur CoursPool !',desc:'La plateforme qui partage le coût d un cours entre élèves. Un prof, plusieurs places, un prix juste pour tous.'},
  {bg:'linear-gradient(135deg,#3B82F6,#1D4ED8)',illu:'locbar',title:'Trouvez des cours près de vous',desc:'Tapez votre ville ou appuyez sur Autour de moi. Filtrez par matière, niveau ou distance.'},
  {bg:'linear-gradient(135deg,#22C069,#16A34A)',illu:'card',title:'Réservez votre place',desc:'Appuyez sur un cours puis Réserver. Vous ne payez que votre part — le reste est partagé entre les élèves.'},
  {bg:'linear-gradient(135deg,#8B5CF6,#6D28D9)',illu:'msg',title:'Contactez le professeur',desc:'Avant de réserver, écrivez au professeur depuis l onglet Messages.'},
  {bg:'linear-gradient(135deg,#F59E0B,#D97706)',illu:'profil',title:'Prêt à découvrir ?',desc:'Créez un compte gratuit pour réserver votre premier cours.'}
];
var TUTO_PROF_STEPS=[
  {bg:'linear-gradient(135deg,#FF8C55,#E04E10)',illu:'logo',title:'Bienvenue professeur !',desc:'Proposez vos cours à plusieurs élèves. CoursPool gère tout : inscriptions, paiements et messagerie.'},
  {bg:'linear-gradient(135deg,#22C069,#16A34A)',illu:'plus',title:'Créez votre premier cours',desc:'Appuyez sur le bouton + orange en bas de l ecran.'},
  {bg:'linear-gradient(135deg,#3B82F6,#1D4ED8)',illu:'card',title:'Vos cours visibles par tous',desc:'Dès la publication, vos cours sont visibles par tous les élèves.'},
  {bg:'linear-gradient(135deg,#8B5CF6,#6D28D9)',illu:'msg',title:'Messagerie directe',desc:'Les élèves vous contactent avant de réserver. Répondre vite aide.'},
  {bg:'linear-gradient(135deg,#F59E0B,#D97706)',illu:'revenus',title:'Paiements sécurisés',desc:'Renseignez votre IBAN dans Revenus pour recevoir vos virements automatiquement. Bonne aventure !'}
];

function tutoStart(){
  if(!user)return;
  if(_tutoLaunched)return;
  try{if(localStorage.getItem('cp_tuto_done_'+user.id))return;}catch(e){}
  _tutoLaunched=true;
  _tutoSteps=user.role==='professeur'?TUTO_PROF_STEPS:TUTO_ELEVE_STEPS;
  // Reprendre au step sauvegardé si existe
  try{
    var saved=localStorage.getItem('cp_tuto_step_'+user.id);
    _tutoIdx=saved?Math.min(parseInt(saved),_tutoSteps.length-1):0;
  }catch(e){_tutoIdx=0;}
  setTimeout(_tutoShow,800);
}

function _tutoShow(){
  var step=_tutoSteps[_tutoIdx];
  if(!step){tutoDone();return;}
  var root=g('tutoRoot');if(!root)return;
  root.style.display='flex';
  var card=g('tutoCard');
  if(card){card.style.animation='none';void card.offsetHeight;card.style.animation='mi .3s ease';}
  // Fond coloré + emoji
  var illu=g('tutoIllu');
  if(illu&&step.bg)illu.style.background=step.bg;
  var em=g('tutoEmoji');
  if(em){
    if(step.illu&&_TUTO_SVG[step.illu]){
      em.innerHTML=_TUTO_SVG[step.illu];
      em.style.fontSize='0';
    } else {
      em.innerHTML='';
      em.textContent=step.emoji||'\u2728';
      em.style.fontSize='64px';
    }
  }
  // Texte
  var tt=g('tutoTitle'),td=g('tutoDesc');
  if(tt)tt.textContent=step.title||'';
  if(td)td.textContent=step.desc||'';
  // Dots blancs sur fond coloré
  var dots=g('tutoDots');
  if(dots)dots.innerHTML=_tutoSteps.map(function(_,i){
    var a=i===_tutoIdx;
    return'<div style="height:5px;border-radius:3px;background:'+(a?'#fff':'rgba(255,255,255,.4)')+';width:'+(a?'22px':'5px')+';transition:all .3s cubic-bezier(.34,1.56,.64,1)"></div>';
  }).join('');
  // Bouton
  var btn=g('tutoBtn');
  var isLast=_tutoIdx===_tutoSteps.length-1;
  var isGuestLast=(!user||user.guest)&&isLast;
  if(btn){
    btn.textContent=isLast?(isGuestLast?'Cr\u00e9er un compte':'C\u2019est parti !'):('Continuer');
    btn.style.background=isLast?'#22C069':'var(--or)';
    btn.style.boxShadow=isLast?'0 4px 16px rgba(34,192,105,.35)':'0 4px 16px rgba(255,107,43,.35)';
  }
  var skip=g('tutoSkipBtn');
  if(skip)skip.style.opacity=isLast?'0':'1';
  haptic(4);
}

function tutoNext(){
  if(_tutoIdx<_tutoSteps.length-1){
    _tutoIdx++;
    _tutoShow();
    // Sauvegarder la progression
    try{
      var key=user&&user.id?'cp_tuto_step_'+user.id:'cp_tuto_step_guest';
      localStorage.setItem(key,String(_tutoIdx));
    }catch(e){}
  } else {
    tutoDone();
    // Si visiteur sans compte → rediriger vers inscription
    if(!user||user.guest){
      setTimeout(function(){
        scrollToLogin();
        setTimeout(function(){var t=g('ltI');if(t)t.click();},300);
      },400);
    }
  }
}

function tutoPrev(){
  if(_tutoIdx>0){_tutoIdx--;_tutoShow();}
}

function tutoSkip(){
  // Passer = marquer comme terminé + effacer progression
  try{
    var doneKey=user&&user.id?'cp_tuto_done_'+user.id:'cp_tuto_done_guest';
    var stepKey=user&&user.id?'cp_tuto_step_'+user.id:'cp_tuto_step_guest';
    localStorage.setItem(doneKey,'1');
    localStorage.removeItem(stepKey);
  }catch(e){}
  tutoDone();
}

function tutoDone(){
  try{
    var doneKey=user&&user.id?'cp_tuto_done_'+user.id:'cp_tuto_done_guest';
    var stepKey=user&&user.id?'cp_tuto_step_'+user.id:'cp_tuto_step_guest';
    localStorage.setItem(doneKey,'1');
    localStorage.removeItem(stepKey); // effacer la progression
  }catch(e){}
  var root=g('tutoRoot');
  if(root){
    root.style.opacity='0';root.style.transition='opacity .3s';
    setTimeout(function(){root.style.display='none';root.style.opacity='';root.style.transition='';},300);
  }
}


// ============================================================
// REVENUS PROF — lié à Stripe via /stripe/payments
// ============================================================
var _revLoaded = false;

async function loadRevenues() {
  if (!user || user.role !== 'professeur') return;
  var list = g('revList');
  if (!list) return;

  list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>Chargement</div>';

  // Récupérer les paiements depuis le serveur
  try {
    var r = await fetch(API + '/stripe/payments/prof/' + user.id, {headers:apiH()});
    var data = await r.json();
    if (!Array.isArray(data)) throw new Error('Format invalide');

    // Tous les paiements (status succeeded ou pas de filtre strict)
    var paid = data.filter(function(p) { return p.status === 'succeeded' || p.status === 'paid' || !p.status; });
    if (!paid.length && data.length) paid = data; // fallback si aucun succeeded

    // KPIs
    var now = new Date();
    var thisMonth = paid.filter(function(p) {
      var d = new Date(p.created);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    var moisTotal = thisMonth.reduce(function(a, p) { return a + p.amount; }, 0);
    var total = paid.reduce(function(a, p) { return a + p.amount; }, 0);

    // Montants en attente (requires_capture ou processing)
    var pending = data.filter(function(p) { return p.status === 'processing'; });
    var pendingAmt = pending.reduce(function(a, p) { return a + p.amount; }, 0);

    g('revMois').textContent = moisTotal.toFixed(2) + '€';
    g('revMoisNb').textContent = thisMonth.length + ' paiement' + (thisMonth.length > 1 ? 's' : '');
    g('revTotal').textContent = total.toFixed(2) + '€';
    g('revTotalNb').textContent = paid.length + ' paiement' + (paid.length > 1 ? 's' : '');

    var pendingBar = g('revPendingBar');
    if (pendingAmt > 0 && pendingBar) {
      g('revPendingAmt').textContent = pendingAmt.toFixed(2) + '€ en attente de virement';
      pendingBar.style.display = 'flex';
    } else if (pendingBar) {
      pendingBar.style.display = 'none';
    }

    // Liste des paiements
    if (!paid.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px 20px"><div style="width:52px;height:52px;background:var(--orp);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="26" height="26"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Aucun paiement</div><div style="font-size:13px;color:var(--lite);line-height:1.6">Vos revenus apparaîtront ici<br>dès qu’un élève réserve un cours.</div></div>';
      return;
    }

    // Grouper par mois pour un affichage plus lisible
    var grouped = {};
    paid.forEach(function(p){
      var d=new Date(p.created);
      var key=d.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
      if(!grouped[key])grouped[key]=[];
      grouped[key].push(p);
    });
    var html='';
    Object.keys(grouped).slice(0,6).forEach(function(month){
      html+='<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;padding:16px 16px 8px">'+month+'</div>';
      grouped[month].forEach(function(p){
        var d=new Date(p.created);
        var dateStr=d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
        var timeStr=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
        var cours=p.cours_titre||'Cours CoursPool';
        var montant=typeof p.amount==='number'?p.amount:(parseFloat(p.amount)||0);
        var montantNet=(montant*0.85).toFixed(2);
        var statusColor=p.status==='succeeded'||p.status==='paid'?'var(--green)':'var(--amber)';
        var statusLabel=p.status==='succeeded'||p.status==='paid'?'Payé':'En attente';
        html+='<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bdr)">'
          +'<div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--orp),#FFE8DC);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>'
          +'</div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+cours+'</div>'
          +'<div style="display:flex;align-items:center;gap:6px;margin-top:3px">'
          +'<span style="font-size:11px;color:var(--lite)">'+dateStr+' · '+timeStr+'</span>'
          +'<span style="font-size:10px;font-weight:700;color:'+statusColor+';background:'+statusColor+'1a;border-radius:4px;padding:1px 6px">'+statusLabel+'</span>'
          +'</div>'
          +'</div>'
          +'<div style="text-align:right;flex-shrink:0">'
          +'<div style="font-size:16px;font-weight:800;color:var(--green)">+'+montantNet+'€</div>'
          +'<div style="font-size:10px;color:var(--lite);margin-top:1px">net · '+montant.toFixed(2)+'€ brut</div>'
          +'</div>'
          +'</div>';
      });
    });
    if(paid.length>30)html+='<div style="text-align:center;padding:14px;font-size:13px;color:var(--lite)">+ '+(paid.length-30)+' paiements plus anciens</div>';
    list.innerHTML=html;

  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px">Impossible de charger les revenus.<br><a onclick="loadRevenues()" style="color:var(--or);cursor:pointer">Réessayer</a></div>';
  }
}





// ============================================================
// PAIEMENTS PROF — IBAN via Stripe.js (tokenisation côté client)
// Le prof reste sur CoursPool, l'IBAN ne passe jamais par notre serveur
// ============================================================

var _stripeInstance = null;
var _ibanElement = null;
var STRIPE_PK = 'pk_live_51TB9Am3FNybFliKQGUpI1uSMheaSyFV0TwgRoAfmgRJtLtxAujacxrLJqM5zaOdLa0EuZNLJe7HOXKSZWmwZHyR500YZcvAF6h';

function initStripeIban() {
  if (!window.Stripe) return; // lib paiement
  if (_stripeInstance) return;
  _stripeInstance = Stripe(STRIPE_PK);
  var elements = _stripeInstance.elements();
  _ibanElement = elements.create('iban', {
    supportedCountries: ['SEPA'],
    style: {
      base: {
        fontSize: '14px',
        fontFamily: '"Plus Jakarta Sans", sans-serif',
        color: '#111',
        '::placeholder': { color: '#aaa' }
      },
      invalid: { color: '#EF4444' }
    },
    placeholderCountry: 'FR'
  });
  var container = g('ibanElement');
  if (container) {
    _ibanElement.mount('#ibanElement');
    // Focus styling
    _ibanElement.on('focus', function() { container.style.borderColor = 'var(--or)'; });
    _ibanElement.on('blur', function() { container.style.borderColor = 'var(--bdr)'; });
  }
}

async function loadStripeConnectStatus() {
  if (!user || user.role !== 'professeur') return;
  var notConn = g('stripeNotConnected');
  var pending = g('stripePending');
  var connected = g('stripeConnected');

  try {
    var r = await fetch(API + '/stripe/connect/status-prof/' + user.id, {headers:apiH()});
    var data = await r.json();

    if (!data.stripe_account_id) {
      // Pas encore configuré — afficher le formulaire IBAN
      if (notConn) notConn.style.display = 'block';
      if (pending) pending.style.display = 'none';
      if (connected) connected.style.display = 'none';
      // Initialiser Stripe.js pour le champ IBAN
      setTimeout(initStripeIban, 100);
    } else if (!data.charges_enabled) {
      // IBAN soumis mais pas encore vérifié
      if (notConn) notConn.style.display = 'none';
      if (pending) pending.style.display = 'block';
      if (connected) connected.style.display = 'none';
      user.stripe_account_id = data.stripe_account_id;
    } else {
      // Compte actif — virements activés
      if (notConn) notConn.style.display = 'none';
      if (pending) pending.style.display = 'none';
      if (connected) connected.style.display = 'block';
      user.stripe_account_id = data.stripe_account_id;
    }
  } catch(e) {
    if (notConn) notConn.style.display = 'block';
    setTimeout(initStripeIban, 100);
  }
}

async function saveIban() {
  var btn = g('btnSaveIban');
  var name = (g('ibanName') && g('ibanName').value.trim()) || (user.pr + ' ' + user.nm).trim();

  if (!name) { toast('Champ manquant', 'Entrez le titulaire du compte'); return; }
  if (!_ibanElement) { toast('Erreur', 'Chargement en cours, réessayez'); return; }
  if (!_stripeInstance) { toast('Erreur', 'Service de paiement non disponible'); return; }

  btn.disabled = true; btn.textContent = '⏳ Enregistrement…';

  try {
    // 1. Créer le compte Connect côté serveur si pas encore fait
    var accountId = user.stripe_account_id;
    if (!accountId) {
      var r1 = await fetch(API + '/stripe/connect/create', {
        method: 'POST',
        headers: apiH(),
        body: JSON.stringify({ prof_id: user.id, email: user.em })
      });
      var d1 = await r1.json();
      if (d1.error) { toast('Erreur', d1.error); return; }
      accountId = d1.account_id;
      user.stripe_account_id = accountId;
      try { localStorage.setItem('cp_user', JSON.stringify(user)); } catch(e) {}
    }

    // 2. Récupérer le client_secret pour enregistrer l'IBAN
    var r2 = await fetch(API + '/stripe/connect/setup-intent', {
      method: 'POST',
      headers: apiH(),
      body: JSON.stringify({ stripe_account_id: accountId })
    });
    var d2 = await r2.json();
    if (d2.error) { toast('Erreur', d2.error); return; }

    // 3. Confirmer avec Stripe.js — l'IBAN ne passe JAMAIS par notre serveur
    var result = await _stripeInstance.confirmSepaDebitSetup(d2.client_secret, {
      payment_method: {
        sepa_debit: _ibanElement,
        billing_details: { name: name, email: user.em }
      }
    });

    if (result.error) {
      toast('IBAN invalide', result.error.message);
      return;
    }

    // 4. Notifier notre serveur que l'IBAN est enregistré
    await fetch(API + '/stripe/connect/iban-saved', {
      method: 'POST',
      headers: apiH(),
      body: JSON.stringify({ prof_id: user.id, stripe_account_id: accountId })
    });

    toast('IBAN enregistré !', 'Vos paiements seront virés automatiquement ✓');

    // Mettre à jour l'UI
    var notConn = g('stripeNotConnected');
    var connected = g('stripeConnected');
    if (notConn) notConn.style.display = 'none';
    if (connected) connected.style.display = 'block';

  } catch(e) {
    toast('Erreur', 'Impossible d\'enregistrer l\'IBAN');
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer mon IBAN';
  }
}

function showChangeIban() {
  var notConn = g('stripeNotConnected');
  var connected = g('stripeConnected');
  if (notConn) notConn.style.display = 'block';
  if (connected) connected.style.display = 'none';
  setTimeout(initStripeIban, 100);
}

// Legacy — plus utilisé mais gardé pour compatibilité
function setupStripeConnect() { loadStripeConnectStatus(); }


function closeMatieres(){var m=document.getElementById("bdMatieres");if(m)m.remove();}
function showMoreMatieres(){
  var matieres=['Chimie','Biologie','SVT','Histoire','Géographie','Philosophie',
    'Français','Littérature','Musique','Arts','Sport','Droit','Médecine','Architecture',
    'Marketing','Comptabilité','Statistiques','Algorithmique','Design','Cinéma'];
  var html='<div style="padding:20px"><div style="font-size:16px;font-weight:800;margin-bottom:16px">Choisir une matière</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +matieres.map(function(m){
      return'<div onclick="pickSCustom(this)" class="so" style="justify-content:center" data-m="'+m+'">'+m+'</div>';
    }).join('')
    +'</div></div>';
  var modal=document.createElement('div');
  modal.id='bdMatieres';
  modal.className='bd';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:flex-end;';
  modal.innerHTML='<div style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-height:70vh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom,20px)">'+html
    +'<div style="padding:0 20px 20px"><button onclick="closeMatieres()" style="width:100%;padding:13px;background:var(--bg);border:1.5px solid var(--bdr);border-radius:12px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;color:var(--mid)">Fermer</button></div></div>';
  modal.onclick=function(e){if(e.target===modal)closeMatieres();};
  document.body.appendChild(modal);
}

function pickSCustom(el){
  var matiere=el.getAttribute('data-m')||el.textContent;
  document.querySelectorAll('#bdCr .so').forEach(function(s){s.classList.remove('on');});
  el.classList.add('on');
  var modal=document.getElementById('bdMatieres');
  if(modal)modal.remove();
}

// NOTATION
var noteVal=0,noteCours=null;
var LABELS=['','Décevant 😕','Peut mieux faire 😐','Bien 🙂','Très bien 😊','Excellent ! 🌟'];

function openNote(cours){
  if(!cours||!user||user.role==='professeur')return;
  if(!res[cours.id]){toast('Réservation requise','Vous devez avoir réservé ce cours pour le noter');return;}
  var isPastNow=false;try{var diffMs2=Date.now()-new Date(cours.created_at||0);isPastNow=diffMs2>24*60*60*1000;}catch(e){}
  if(!isPastNow){toast('Cours à venir','Vous pourrez noter ce cours une fois qu\'il est terminé');return;}
  noteCours=cours;noteVal=0;
  updateStars(0);
  var np=g('noteProf');
  if(np&&cours)np.textContent=(P[cours.pr]&&P[cours.pr].nm)||cours.prof_nm||'';
  g('noteTitre').textContent=cours.title;
  g('noteComment').value='';
  g('noteLabel').textContent='';
  updateStars(0);
  openM('bdNote');
}

function setNote(n){
  noteVal=n;
  g('noteLabel').textContent=LABELS[n]||'';
  updateStars(n);
}

function updateStars(n){
  var stars=g('noteStars').querySelectorAll('span');
  stars.forEach(function(s,i){
    s.style.filter=i<n?'none':'grayscale(1)';
    s.style.transform=i<n?'scale(1.15)':'scale(1)';
  });
}

async function submitNote(){
  if(!noteVal){toast('Note manquante','Choisissez une note entre 1 et 5',true);return;}
  if(!noteCours||!user){return;}
  var comment=g('noteComment').value.trim();
  try{
    var r=await fetch(API+'/notations',{method:'POST',headers:apiH(),body:JSON.stringify({
      eleve_id:user.id,professeur_id:noteCours.pr,cours_id:noteCours.id,note:noteVal,commentaire:comment
    })});
    var data=await r.json();
    if(data.error){toast('Erreur','Impossible d\'envoyer la note');return;}
    closeM('bdNote');
    try{if(noteCours)localStorage.setItem('cp_noted_'+noteCours.id,'1');}catch(e){}
    toast('Merci pour votre avis !','Votre note a été enregistrée ⭐');
    noteCours=null;noteVal=0;
  }catch(e){toast('Erreur réseau','Impossible d\'envoyer la note');}
}

// LIEU SEARCH
var lieuTimer=null;
function searchLieu(q){
  var box=g('lieuSuggestions');
  if(!q||q.length<3){box.style.display='none';return;}
  clearTimeout(lieuTimer);
  lieuTimer=setTimeout(async function(){
    try{
      var r=await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q+', France')+'&format=json&limit=5&countrycodes=fr',{headers:{'Accept-Language':'fr'}});
      var data=await r.json();
      if(!data.length){box.style.display='none';return;}
      box.innerHTML=data.map(function(d){
        var name=d.display_name.split(',').slice(0,3).join(', ');
        return'<div style="padding:10px 13px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--bdr)" onmouseover="this.style.background=\'var(--orp)\'" onmouseout="this.style.background=\'\'" onclick="pickLieu(\''+name.replace(/'/g,"\\'")+'\')" >📍 '+name+'</div>';
      }).join('');
      box.style.display='block';
    }catch(e){box.style.display='none';}
  },400);
}
function pickLieu(name){g('crLieu').value=name;g('lieuSuggestions').style.display='none';}
document.addEventListener('click',function(e){
  if(!e.target.closest||(!e.target.closest('#crLieu')&&!e.target.closest('#lieuSuggestions'))){var box=g('lieuSuggestions');if(box)box.style.display='none';}
});

// NIVEAUX
var NIVEAUX={
  etudiant:{label:'Votre niveau actuel',options:['Baccalauréat','BTS / BUT','Licence (L1-L3)','Master (M1-M2)','Doctorat']},
  prof_ecole:{label:'Niveau enseigné',options:['Maternelle (TPS-GS)','CP - CE1','CE2 - CM1','CM2']},
  prof_college:{label:'Niveau enseigné',options:['6ème - 5ème','4ème - 3ème','Seconde','Première','Terminale']},
  prof_universite:{label:'Niveau enseigné',options:['Licence (L1-L3)','Master (M1-M2)','Doctorat']}
};
function updateNiveaux(statut){
  var nf=g('niveauField'),sel=g('rNiveau'),lbl=g('niveauLabel');
  if(!statut||!NIVEAUX[statut]){if(nf)nf.style.display='none';return;}
  var n=NIVEAUX[statut];nf.style.display='block';
  if(lbl)lbl.textContent=n.label;
  sel.innerHTML='<option value="">Choisir...</option>'+n.options.map(function(o){return'<option value="'+o+'">'+o+'</option>';}).join('');
}
function updateNiveauxPf(statut){
  var nf=g('pfNiveauField'),lbl=g('pfNiveauLabel'),valLbl=g('pfNiveauValLabel');
  if(!statut||!NIVEAUX[statut]){if(nf)nf.style.display='none';return;}
  var n=NIVEAUX[statut];
  if(nf)nf.style.display='';
  if(lbl)lbl.textContent=n.label;
  // Reset le niveau si le statut change
  var pfNiv=g('pfNiveau');
  if(pfNiv)pfNiv.value='';
  if(valLbl)valLbl.textContent='Choisir…';
}

// ============================================================
// CHIPS MATIÈRES — système de tags natif
// ============================================================
var _matieres = [];
var _SUGG_MATIERES = ['Maths','Physique','Anglais','Français','Histoire','SVT','Chimie','Informatique','Espagnol','Allemand','Philosophie','Économie','Musique','Art'];

function initMatieresChips(valStr){
  _matieres = valStr ? valStr.split(',').map(function(m){return m.trim();}).filter(Boolean) : [];
  renderMatieresChips();
  renderMatieresSugg();
}

function renderMatieresChips(){
  var wrap=g('matieresChips');
  if(!wrap)return;
  wrap.innerHTML=_matieres.map(function(m,i){
    return '<div style="display:inline-flex;align-items:center;gap:6px;background:var(--or);color:#fff;border-radius:50px;padding:6px 10px 6px 12px;font-size:13px;font-weight:600;animation:popIn .2s cubic-bezier(.34,1.56,.64,1)">'
      +m
      +'<button onclick="removeMatiere('+i+')" style="background:rgba(255,255,255,.25);border:none;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      +'</button></div>';
  }).join('');
  // Mettre à jour la valeur cachée
  var hid=g('pfMatieresVal');if(hid)hid.value=_matieres.join(', ');
  renderMatieresSugg();
}

function renderMatieresSugg(){
  var wrap=g('matieresSugg');
  if(!wrap)return;
  var restants=_SUGG_MATIERES.filter(function(m){return _matieres.indexOf(m)===-1;});
  if(!restants.length){wrap.innerHTML='';return;}
  var html='<span style="font-size:11px;color:var(--lite);align-self:center;margin-right:2px">Suggestions :</span>';
  restants.slice(0,6).forEach(function(m){
    html+='<button data-m="'+m+'" class="sugg-btn" style="background:var(--bg);border:1.5px solid var(--bdr);border-radius:50px;padding:5px 12px;font-family:inherit;font-size:12px;font-weight:600;color:var(--mid);cursor:pointer">'+m+'</button>';
  });
  wrap.innerHTML=html;
  wrap.querySelectorAll('.sugg-btn').forEach(function(btn){
    btn.addEventListener('click',function(){addMatiereDirecte(this.dataset.m);});
  });
}

function addMatiere(){
  var inp=g('pfMatieres');if(!inp)return;
  var val=inp.value.trim().replace(/,$/,'');
  if(!val)return;
  // Gérer plusieurs matières séparées par virgule
  val.split(',').forEach(function(m){
    var t=m.trim();
    if(t&&_matieres.indexOf(t)===-1){_matieres.push(t);}
  });
  inp.value='';
  haptic(4);
  renderMatieresChips();
}

function addMatiereDirecte(m){
  if(_matieres.indexOf(m)===-1){_matieres.push(m);haptic(4);renderMatieresChips();}
}

function removeMatiere(i){
  _matieres.splice(i,1);haptic([10,30]);renderMatieresChips();
}

// CNI
function previewCni(input){
  if(input.files&&input.files[0]){
    g('cniLabel').textContent='✅ '+input.files[0].name;
    g('cniDrop').style.borderColor='var(--green)';g('cniDrop').style.background='#F0FDF4';
  }
}

// UTILS
function g(id){return document.getElementById(id);}
function openM(id){var _m=g(id);if(_m)_m.classList.add('on');document.body.style.overflow='hidden';}
function closeM(id){var _m=g(id);if(_m)_m.classList.remove('on');document.body.style.overflow='';}
function setR(el){document.querySelectorAll('.ro').forEach(function(r){r.classList.remove('on')});el.classList.add('on');}
function toast(t,s,isError){
  if(isError&&navigator.vibrate)navigator.vibrate([10,50,10]);
  var e=g('toast');
  if(e){e.classList.remove('on');}
  var _tT=g('tT'),_tS=g('tS');if(_tT)_tT.textContent=t;if(_tS)_tS.textContent=s;e=g('toast');if(e){e.classList.add('on');setTimeout(function(){e.classList.remove('on')},3200);}}

// Niveau cours
function pickNiveau(el){
  document.querySelectorAll('#crNiveauChips .crn-chip').forEach(function(c){c.classList.remove('on');});
  el.classList.add('on');
  var inp=g('crNiveau');if(inp)inp.value=el.dataset.n||'';
}

// ============================================================
// FILTRE NIVEAU + MODE
// ============================================================
var actNiv = '';
var actMode = '';

function updateResetBtn(){
  var btn=g('pillReset');if(!btn)return;
  var active=actF!=='tous'||!!actNiv||!!actMode||!!actLoc||geoMode;
  btn.style.display=active?'inline-flex':'none';
}

function openNivFilter(){
  var el=g('bdNivFilter');
  if(!el)return;
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeNivFilter(){
  var el=g('bdNivFilter');
  if(el){el.style.display='none';document.body.style.overflow='';}
}
function setNivFilter(niv, el){
  actNiv=niv;try{sessionStorage.setItem('cp_niv',niv);}catch(e){}
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var lbl=g('pillNivLabel');
  var pill=g('pillNiv');
  if(lbl){lbl.textContent=niv||'Niveau';}
  if(pill){pill.classList.toggle('on',!!niv);}
  closeNivFilter();
  applyFilter();
}

function openModeFilter(){
  var el=g('bdModeFilter');
  if(!el)return;
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeModeFilter(){
  var el=g('bdModeFilter');
  if(el){el.style.display='none';document.body.style.overflow='';}
}
function setModeFilter(mode, el){
  actMode=mode;
  document.querySelectorAll('#modeFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var labels={'':'Mode','presentiel':'Présentiel','visio':'Visio'};
  var lbl=g('pillModeLabel');if(lbl)lbl.textContent=labels[mode]||'Mode';
  var pill=g('pillMode');if(pill)pill.classList.toggle('on',!!mode);
  closeModeFilter();
  applyFilter();
}

// Niveau cours
function pickNiveau(el){
  document.querySelectorAll('#crNiveauChips .crn-chip').forEach(function(c){c.classList.remove('on');});
  el.classList.add('on');
  var inp=g('crNiveau');if(inp)inp.value=el.dataset.n||'';
}

// ============================================================
// CONTACT
// ============================================================
// ============================================================
// DARK MODE TOGGLE
// ============================================================
var _darkMode = false;

function updateMsgBadge(n){
  var b=g('bnavBadge');
  if(!b)return;
  if(n>0){b.textContent=n>9?'9+':String(n);b.classList.add('on');try{sessionStorage.setItem('cp_unread',String(n));}catch(e){};}
  else{b.classList.remove('on');try{sessionStorage.removeItem('cp_unread');}catch(e){};}
}

function initDarkMode(){
  var saved=null;
  try{saved=localStorage.getItem('cp_dark');}catch(e){}
  if(saved==='1'){
    _darkMode=true;
  } else if(saved==='0'){
    _darkMode=false;
  } else {
    _darkMode=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
  }
  document.documentElement.classList.toggle('dk',_darkMode);
  updateDarkBtn();
  var spb=g('shareProfBtn');if(spb)spb.style.display=(user&&user.role==='professeur')?'block':'none';
}

function toggleDarkMode(){
  _darkMode=!_darkMode;
  document.documentElement.classList.toggle('dk',_darkMode);
  try{localStorage.setItem('cp_dark',_darkMode?'1':'0');}catch(e){}
  updateDarkBtn();
  var tm=document.getElementById('themeColorMeta');
  if(tm)tm.content=_darkMode?'#131110':'#ffffff';
  haptic([10,40,10]);
  // Rebuild cards so bg colors update instantly
  if(C&&C.length)buildCards();
}

function updateDarkBtn(){
  var tog=g('darkModeToggle');
  var lbl=g('darkModeSubLabel');
  if(tog)tog.classList.toggle('on',_darkMode);
  if(lbl){
    var saved=null;try{saved=localStorage.getItem('cp_dark');}catch(e){}
    lbl.textContent=saved===null?'Suit le système':(_darkMode?'Activé':'Désactivé');
  }
}

function shareProfil(){
  if(!user)return;
  var url=window.location.origin+'?prof='+user.id;
  if(navigator.share){
    navigator.share({
      title:'Mes cours sur CoursPool',
      text:'Retrouvez mes cours sur CoursPool — partagez les frais à plusieurs !',
      url:url
    }).catch(function(){});
  } else {
    try{navigator.clipboard.writeText(url);toast('Lien copié ✓','Partagez votre profil avec vos élèves');}
    catch(e){toast(url,'Copiez ce lien');}
  }
}

function shareApp(){
  var data={title:'CoursPool',text:"Découvrez CoursPool — partagez les frais d'un cours particulier entre étudiants !",url:'https://courspool.vercel.app'};
  if(navigator.share){navigator.share(data).catch(function(){});}
  else{
    try{navigator.clipboard.writeText(data.url);toast('Lien copié ✓','Partagez-le avec vos amis');}
    catch(e){toast('courspool.vercel.app','Copiez ce lien pour partager');}
  }
}

function openContact(){
  // Pré-remplir l'email si connecté
  var bd=g('bdContact');
  if(!bd)return;
  var emailInput=g('contactEmail');
  if(emailInput&&user&&user.em)emailInput.value=user.em;
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeContact(){
  var bd=g('bdContact');
  if(bd)bd.style.display='none';
  document.body.style.overflow='';
}
function pickSubj(el){
  document.querySelectorAll('.contact-subj').forEach(function(s){
    s.classList.remove('on');
    s.style.background='var(--bg)';
    s.style.borderColor='var(--bdr)';
    s.style.color='var(--mid)';
  });
  el.classList.add('on');
  el.style.background='var(--orp)';
  el.style.borderColor='var(--or)';
  el.style.color='var(--or)';
  haptic(4);
}
// ---- Comment ça marche ----
function openHow(){
  var pg=g('pgHow');if(!pg)return;
  pg.style.display='block';
  requestAnimationFrame(function(){pg.style.opacity='1';});
}
function closeHow(){
  var pg=g('pgHow');if(!pg)return;
  pg.style.display='none';
}
function toggleFaq(btn){
  var item=btn.parentElement;
  var body=item.querySelector('.faq-body');
  var chevron=btn.querySelector('.faq-chevron');
  var isOpen=body.style.display!=='none';
  body.style.display=isOpen?'none':'block';
  if(chevron)chevron.style.transform=isOpen?'':'rotate(180deg)';
}
async function submitContact(){
  var email=g('contactEmail').value.trim();
  var msg=g('contactMsg').value.trim();
  var sujet=document.querySelector('.contact-subj.on');
  if(!email||!msg){toast('Champs manquants','Remplissez votre email et votre message',true);return;}
  var btn=g('contactSubmitBtn');
  btn.disabled=true;btn.textContent='Envoi…';
  try{
    var photoFile=g('contactPhoto')&&g('contactPhoto').files&&g('contactPhoto').files[0];
    var photoB64=null;
    if(photoFile&&photoFile.size<5*1024*1024){
      photoB64=await new Promise(function(resolve){
        var reader=new FileReader();
        reader.onload=function(e){resolve(e.target.result);};
        reader.readAsDataURL(photoFile);
      });
    }
    var r=await fetch(API+'/contact',{
      method:'POST',headers:apiH(),
      body:JSON.stringify({
        email:email,
        sujet:sujet?sujet.dataset.s:'Question générale',
        message:msg,
        nom:user?(user.pr+' '+user.nm).trim():'',
        role:user?user.role:'visiteur',
        user_id:user?user.id:null,
        photo_base64:photoB64
      })
    });
    if(r.ok){
      closeContact();
      g('contactMsg').value='';
      if(g('contactPhoto'))g('contactPhoto').value='';
      var lbl=g('contactPhotoTxt');if(lbl)lbl.textContent='Ajouter une capture d\'écran…';
      document.querySelectorAll('.contact-subj').forEach(function(s){s.classList.remove('on');});
      toast('Message envoyé ✓','On vous répond sous 24h');
    } else {
      toast('Erreur',"Impossible d'envoyer, réessayez");
    }
  }catch(e){toast('Erreur',"Impossible d'envoyer",true);}
  finally{btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Envoyer le message';}
}
function previewContactPhoto(input){
  var f=input.files&&input.files[0];
  var lbl=g('contactPhotoTxt');
  if(f&&lbl)lbl.textContent=f.name;
}

// ============================================================
// RESET FILTRES
// ============================================================
var sortMode='date';
function setSortMode(mode){
  sortMode=mode;
  applyFilter();
}

function sortCourses(arr){
  if(sortMode==='prix'){
    return arr.slice().sort(function(a,b){
      var pa=a.sp>0?Math.ceil(a.tot/a.sp):9999;
      var pb=b.sp>0?Math.ceil(b.tot/b.sp):9999;
      return pa-pb;
    });
  }
  if(sortMode==='recent'){
    return arr.slice().sort(function(a,b){
      return new Date(b.created_at||0)-new Date(a.created_at||0);
    });
  }
  // Par date (default) — extraire heure du string dt
  return arr.slice().sort(function(a,b){
    var da=new Date(a.created_at||0),db=new Date(b.created_at||0);
    return da-db;
  });
}

function resetFilters(){
  actF='tous';actLoc='';actNiv='';actMode='';
  var inp=g('locInput');if(inp)inp.value='';
  var cb=g('locClearBtn');if(cb)cb.style.display='none';
  var gb=g('locGeoBtn');if(gb){gb.style.background='';gb.style.color='';}
  document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});
  var tous=g('pillTous');if(tous)tous.classList.add('on');
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var fn=document.querySelector('#nivFilterList .niv-fchip');if(fn)fn.classList.add('on');
  var lbl=g('pillNivLabel');if(lbl)lbl.textContent='Niveau';
  var pn=g('pillNiv');if(pn)pn.classList.remove('on');
  document.querySelectorAll('#modeFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var fm=document.querySelector('#modeFilterList .niv-fchip');if(fm)fm.classList.add('on');
  var lm=g('pillModeLabel');if(lm)lm.textContent='Mode';
  var pm=g('pillMode');if(pm)pm.classList.remove('on');
  var pr=g('pillReset');if(pr)pr.style.display='none';
  if(g('srch'))g('srch').value='';
  if(g('mobSearchInput'))g('mobSearchInput').value='';
  applyFilter();
}

// ============================================================
// HAPTIC FEEDBACK
// ============================================================
function haptic(ms){try{if(navigator.vibrate)navigator.vibrate(ms||8);}catch(e){}}

// ============================================================
// 7. SKELETON LOADING fidèle
// ============================================================
function showNetworkError(){
  var grid=g('grid');if(!grid)return;
  grid.innerHTML='<div style="text-align:center;padding:60px 24px">'
    +'<div style="width:72px;height:72px;background:#FEF2F2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" width="32" height="32"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>'
    +'</div>'
    +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em">Connexion perdue</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px">Impossible de charger les cours.<br>Vérifiez votre connexion internet.</div>'
    +'<button onclick="loadData(1).then(buildCards)" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3);margin-bottom:12px;display:block;width:100%;max-width:220px;margin:0 auto 12px">Réessayer</button>'
    +'<button onclick="openContact()" style="background:none;border:none;color:var(--or);font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;padding:8px">Nous contacter</button>'
    +'</div>';
  g('nocard').style.display='none';
}

function showSkeletonsV2(){
  var grid=g('grid');if(!grid)return;
  var skel='';
  for(var i=0;i<6;i++){
    skel+='<div class="skel-card" style="animation-delay:'+(i*.06)+'s">'
      +'<div class="skel-top skeleton" style="height:72px"></div>'
      +'<div class="skel-body">'
      +'<div class="skel-line skeleton w80" style="height:14px;margin-bottom:10px;border-radius:7px"></div>'
      +'<div class="skel-line skeleton w60" style="height:11px;margin-bottom:16px;border-radius:7px"></div>'
      +'<div style="display:flex;gap:8px;margin-bottom:10px">'
      +'<div class="skeleton" style="height:11px;width:90px;border-radius:6px"></div>'
      +'<div class="skeleton" style="height:11px;width:70px;border-radius:6px"></div>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;align-items:center">'
      +'<div class="skeleton" style="height:22px;width:60px;border-radius:6px"></div>'
      +'<div class="skeleton" style="height:32px;width:80px;border-radius:10px"></div>'
      +'</div>'
      +'</div>'
      +'</div>';
  }
  grid.innerHTML=skel;
  g('nocard').style.display='none';
}

// ============================================================
// NOTIFICATIONS — sync avec le système push existant
// ============================================================
function renderNotifStatus(){
  var block=g('notifStatus');
  if(!block)return;
  // Montrer/cacher les préférences selon l'état push
  var types=g('notifTypes');
  if(types)types.style.display=(_pushSubscription)?'block':'none';
  if(!('Notification' in window)){
    block.innerHTML='<div style="font-size:13px;color:var(--lite)">Les notifications ne sont pas supportées sur cet appareil.</div>';
    return;
  }
  var perm=Notification.permission;
  if(perm==='denied'){
    block.innerHTML='<div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:#FEF2F2;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div><div style="font-size:14px;font-weight:600;color:var(--ink)">Notifications bloquées</div><div style="font-size:12px;color:var(--lite);margin-top:1px">Activez-les dans les réglages de votre appareil</div></div></div>';
    return;
  }
  if(perm==='granted'&&_pushSubscription){
    block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:#F0FDF4;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg></div><div><div style="font-size:14px;font-weight:600;color:var(--ink)">Notifications activées</div><div style="font-size:12px;color:var(--lite);margin-top:1px">Vous recevez les alertes en temps réel</div></div></div><button onclick="unsubscribePush()" style="background:none;border:none;font-size:12px;color:var(--lite);cursor:pointer;font-family:inherit;padding:4px 8px">Désactiver</button></div>';
    return;
  }
  block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:var(--orp);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div><div><div style="font-size:14px;font-weight:600;color:var(--ink)">Notifications désactivées</div><div style="font-size:12px;color:var(--lite);margin-top:1px">Activez pour ne rien manquer</div></div></div><button onclick="subscribePush()" style="background:var(--or);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer">Activer</button></div>';
}

// ============================================================
// PUSH — subscribe / unsubscribe
// ============================================================
var VAPID_PUBLIC_KEY='BDyXpxjqx8h9llIzLNcaYdMpEX_jbkqEt4fjXOV_bSgENcpW7KaPFUHEjk0uXKT--ZajXK_zAJwgplwNz3j4jA8';
var _swReg=null,_pushSubscription=null;

async function subscribePush(){
  try{
    var perm=await Notification.requestPermission();
    if(perm!=='granted'){toast('Refusé','Activez les notifications dans vos réglages');return;}
    // Attendre le SW si pas encore prêt
    if(!_swReg&&'serviceWorker' in navigator){
      try{
        var reg=await navigator.serviceWorker.ready;
        _swReg=reg;
        var existingSub=await reg.pushManager.getSubscription();
        if(existingSub)_pushSubscription=existingSub;
      }catch(e){console.log('SW ready error:',e);}
    }
    if(!_swReg){
      // Fallback sans push : juste stocker la préférence localement
      toast('Notifications activées ✓','Vous recevrez les alertes');
      try{localStorage.setItem('cp_notif_pref','1');}catch(e){}
      renderNotifStatus();
      return;
    }
    var sub=await _swReg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    _pushSubscription=sub;
    var key=sub.getKey('p256dh'),auth=sub.getKey('auth');
    await fetch(API+'/push/subscribe',{
      method:'POST',headers:apiH(),
      body:JSON.stringify({
        endpoint:sub.endpoint,
        p256dh:btoa(String.fromCharCode.apply(null,new Uint8Array(key))),
        auth:btoa(String.fromCharCode.apply(null,new Uint8Array(auth))),
        user_id:user?user.id:null,
        role:user?user.role:null
      })
    });
    renderNotifStatus();
    haptic(10);
    toast('Notifications activées ✓','');
  }catch(e){toast('Erreur',"Impossible d'activer les notifications");}
}

async function unsubscribePush(){
  try{
    if(_pushSubscription){
      await _pushSubscription.unsubscribe();
      if(user)await fetch(API+'/push/subscribe',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id})});
      _pushSubscription=null;
    }
    renderNotifStatus();
    toast('Notifications désactivées','');
  }catch(e){toast('Erreur','Impossible de désactiver');}
}

function urlBase64ToUint8Array(base64String){
  var padding='='.repeat((4-base64String.length%4)%4);
  var base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  var rawData=window.atob(base64);
  var outputArray=new Uint8Array(rawData.length);
  for(var i=0;i<rawData.length;++i)outputArray[i]=rawData.charCodeAt(i);
  return outputArray;
}

// ============================================================
// 3. HISTORIQUE
// ============================================================
function buildHistorique(){
  var lr=g('listH');if(!lr)return;
  var rIds=Object.keys(res);
  if(!rIds.length){
    lr.innerHTML='<div style="text-align:center;padding:40px 20px">'
      +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="30" height="30"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'</div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun cours pass\u00e9</div>'
      +'<div style="font-size:14px;color:var(--lite)">Vos cours termin\u00e9s apparaissent ici</div></div>';
    return;
  }
  var now=new Date();
  var past=rIds.map(function(id){return C.find(function(x){return x.id==id;});}).filter(function(c){
    if(!c||!c.dt)return false;
    try{return(now-new Date(c.dt))>3*60*60*1000;}catch(e){return false;}
  });
  if(!past.length){
    lr.innerHTML='<div style="text-align:center;padding:32px;font-size:14px;color:var(--lite)">Aucun cours pass\u00e9 pour le moment</div>';
    return;
  }
  var rows=past.map(function(c,i){
    var mat=MATIERES.find(function(m){return c.subj&&c.subj.toLowerCase().includes(m.key);})||MATIERES[MATIERES.length-1];
    return{id:c.id,title:c.title,dt:c.dt,color:mat.color,border:i<past.length-1?'border-bottom:1px solid var(--bdr)':''};
  });
  lr.innerHTML='<div style="background:var(--wh);border-radius:16px;overflow:hidden">'
    +rows.map(function(r){
      return'<div class="hrow" style="display:flex;align-items:center;gap:12px;padding:13px 16px;cursor:pointer;'+r.border+'">'
        +'<div style="width:42px;height:42px;border-radius:12px;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
        +'<div style="width:10px;height:10px;border-radius:50%;background:'+r.color+'"></div></div>'
        +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+r.title+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+r.dt+'</div></div>'
        +'<span style="font-size:11px;font-weight:600;background:var(--bg);color:var(--lite);border-radius:6px;padding:3px 8px">Termin\u00e9</span>'
        +'</div>';
    }).join('')+'</div>';
  lr.querySelectorAll('.hrow').forEach(function(el,i){
    el.onclick=function(){openR(rows[i].id);};
  });
}

// ============================================================
// 4. APERCU COURS
// ============================================================
function previewCours(){
  var titre=g('crTitre').value.trim()||'Titre du cours';
  var subjKey=(g('crSubjHidden')||{}).value||'';
  var mat=MATIERES.find(function(m){return m.key===subjKey;})||MATIERES[MATIERES.length-1];
  var lieu=g('crLieu').value.trim()||'Lieu \u00e0 d\u00e9finir';
  var date=g('crDate').value,heure=g('crHeure').value;
  var places=parseInt(g('cPl').value)||5,prix=parseInt(g('cPr').value)||0;
  var pp=prix>0?Math.ceil(prix/places):0;
  var dt=date&&heure?new Date(date+'T'+heure).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})+' \u00b7 '+heure:'Date \u00e0 d\u00e9finir';
  var card=g('previewCard');if(!card)return;
  card.innerHTML='<div style="background:'+mat.bg+';padding:14px 16px 10px">'
    +'<span style="background:rgba(255,255,255,.7);border-radius:50px;padding:3px 10px;font-size:11.5px;font-weight:600;color:'+mat.color+'">'+mat.label+'</span></div>'
    +'<div style="padding:14px 16px"><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:10px">'+titre+'</div>'
    +'<div style="font-size:13px;color:var(--mid);margin-bottom:4px">&#128336; '+dt+'</div>'
    +'<div style="font-size:13px;color:var(--mid);margin-bottom:12px">&#128205; '+lieu+'</div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center">'
    +'<div><div style="font-size:12px;color:var(--lite)">Total '+prix+'\u20ac</div>'
    +'<div style="font-size:20px;font-weight:800;color:var(--or)">'+pp+'\u20ac<span style="font-size:12px;font-weight:500;color:var(--lite)"> / \u00e9l\u00e8ve</span></div></div>'
    +'<div style="background:var(--or);color:#fff;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:700">R\u00e9server</div>'
    +'</div></div>';
  g('bdPreview').style.display='flex';haptic(6);
}

// ============================================================
// 7. RAPPEL COURS
// ============================================================
var _reminderCoursId=null;
function updateVerifBand(){
  var band=g('verifBand');
  if(!band)return;
  // Pas prof = caché
  if(!user||user.role!=='professeur'){band.style.display='none';return;}
  var status=getCniStatus();
  if(status==='none'){
    band.style.display='flex';
    var t=g('verifBandTitle'),s=g('verifBandSub');
    if(t)t.textContent='Vérification d\'identité requise';
    if(s)s.textContent='Appuyez pour envoyer votre document';
    band.style.background='var(--orp)';
    band.style.borderColor='#FED7AA';
    return;
  }
  if(status==='verified'){band.style.display='none';return;}
  if(status==='pending'||status==='rejected_retry'){
    band.style.display='flex';
    var t=g('verifBandTitle'),s=g('verifBandSub');
    if(status==='pending'){
      if(t)t.textContent='V\u00e9rification en cours';
      if(s)s.textContent='R\u00e9ponse par email sous 24h';
      band.style.background='#FFFBEB';
      band.style.borderColor='#FDE68A';
    } else {
      if(t)t.textContent='Document refus\u00e9 \u2014 renvoyer';
      if(s)s.textContent='Appuyez pour soumettre \u00e0 nouveau';
      band.style.background='#FEF2F2';
      band.style.borderColor='#FECACA';
    }
  }
}

// ============================================================
// 3. LARGE TITLE — scroll detection
// ============================================================
function initLargeTitle(){
  var app=g('app');
  if(!app)return;
  var header=g('mobHeader');
  var lastY=0;
  app.addEventListener('scroll',function(){
    var y=app.scrollTop;
    if(header){if(y>40){header.classList.add('scrolled');}else{header.classList.remove('scrolled');}}
    var tm=document.getElementById('themeColorMeta');
    if(tm)tm.content=_darkMode?'#131110':'#ffffff';
    // Infinite scroll — charger la page suivante si on approche du bas
    if(!_allLoaded&&!_loadingMore&&(app.scrollTop+app.clientHeight>=app.scrollHeight-200)){
      if(typeof loadMore==='function')loadMore();
    }
  },{passive:true});
}

function expandSearch(){
  var srch=g('srch');if(!srch)return;
  var wrap=srch.parentElement;
  if(!wrap)return;
  wrap.style.cssText='position:fixed;top:0;left:0;right:0;z-index:200;padding:max(56px,calc(env(safe-area-inset-top,0px)+56px)) 16px 12px;background:var(--wh);box-shadow:0 2px 20px rgba(0,0,0,.1);animation:pgIn .2s ease';
  var cancel=g('srchCancel');
  if(!cancel){
    cancel=document.createElement('button');
    cancel.id='srchCancel';
    cancel.textContent='Annuler';
    cancel.style.cssText='position:fixed;top:max(14px,calc(env(safe-area-inset-top,0px)+14px));right:16px;background:none;border:none;color:var(--or);font-family:inherit;font-weight:600;font-size:15px;cursor:pointer;z-index:201;padding:8px 0';
    cancel.onclick=function(){srch.blur();collapseSearch();srch.value='';applyFilter();};
    document.body.appendChild(cancel);
  }
  cancel.style.display='block';
}
function collapseSearch(){
  var srch=g('srch');if(!srch)return;
  var wrap=srch.parentElement;
  if(wrap)wrap.style.cssText='';
  var cancel=g('srchCancel');
  if(cancel)cancel.style.display='none';
}
function checkCoursANoter(){
  if(!user||!user.id||user.role==='professeur')return;
  var now=new Date();
  // Cours passés depuis plus de 1h et pas encore notés (pas de notation dans localStorage)
  var aNoter=Object.keys(res).map(function(id){return C.find(function(x){return x.id==id;});}).filter(function(c){
    if(!c||!c.dt)return false;
    var diff=now-new Date(c.dt);
    if(diff<3600000)return false; // moins d'1h après la date du cours
    try{if(localStorage.getItem('cp_noted_'+c.id))return false;}catch(e){}
    return true;
  });
  if(!aNoter.length)return;
  // Proposer de noter le premier cours non noté
  var c=aNoter[0];
  setTimeout(function(){
    openNote(c);
  },1500);
}

function checkUpcomingReminder(){
  if(!user||!Object.keys(res).length)return;
  var now=new Date();
  var upcoming=Object.keys(res).map(function(id){return C.find(function(x){return x.id==id;});}).filter(Boolean).filter(function(c){
    try{var d=new Date(c.dt||now);var diff=d.getTime()-now.getTime();return diff>0&&diff<3*3600000;}catch(e){return false;}
  });
  var rb=g('reminderBand');
  if(!upcoming.length){if(rb)rb.style.display='none';return;}
  var c=upcoming[0];_reminderCoursId=c.id;
  if(!rb)return;
  rb.style.display='flex';
  var rt=g('reminderTitle');if(rt)rt.textContent=c.title;
  var rs=g('reminderSub');
  if(rs){try{var d=new Date(c.dt||now);var diff=Math.round((d.getTime()-now.getTime())/60000);rs.textContent='Dans '+diff+' min \u00b7 '+c.lc;}catch(e){rs.textContent=c.dt;}}
}
function openReminderCours(){if(_reminderCoursId)openR(_reminderCoursId);}

// ============================================================
// 8. FADE-IN images
// ============================================================
function fadeInImg(img){
  img.style.opacity='0';img.style.transition='opacity .3s';
  if(img.complete){img.style.opacity='1';}else{img.onload=function(){img.style.opacity='1';};}
}

// ============================================================
// 9. SWIPE ANNULER
// ============================================================
// ============================================================
// 10. SWIPE TO DISMISS — bottom sheets natifs
// ============================================================
function initSwipeDismiss(sheetEl, onClose){
  if(!sheetEl)return;
  var inner=sheetEl.querySelector('[style*="border-radius:24px"],[style*="border-radius:28px"],.modal');
  if(!inner)return;
  var startY=0,dy=0,sw=false;
  inner.addEventListener('touchstart',function(e){
    if(e.touches[0].clientY<inner.getBoundingClientRect().top+30){
      startY=e.touches[0].clientY;sw=true;dy=0;
    }
  },{passive:true});
  inner.addEventListener('touchmove',function(e){
    if(!sw)return;
    dy=e.touches[0].clientY-startY;
    if(dy<0){dy=0;return;}
    inner.style.transform='translateY('+dy+'px)';
    inner.style.transition='none';
    sheetEl.style.background='rgba(0,0,0,'+(0.55-dy/600)+')';
  },{passive:true});
  inner.addEventListener('touchend',function(){
    if(!sw)return;sw=false;
    if(dy>100){
      inner.style.transition='transform .3s cubic-bezier(.4,0,.2,1)';
      inner.style.transform='translateY(100%)';
      sheetEl.style.transition='background .3s';
      sheetEl.style.background='rgba(0,0,0,0)';
      setTimeout(function(){
        inner.style.transform='';inner.style.transition='';
        sheetEl.style.background='';sheetEl.style.transition='';
        if(onClose)onClose();
      },280);
      haptic([10,20]);
    } else {
      inner.style.transition='transform .25s cubic-bezier(.34,1.56,.64,1)';
      inner.style.transform='translateY(0)';
      sheetEl.style.background='';
      setTimeout(function(){inner.style.transition='';},260);
    }
    dy=0;
  },{passive:true});
}

function initSwipeCancel(el,onConfirm){
  var sx=0,dx=0,sw=false;
  el.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sw=true;dx=0;},{passive:true});
  el.addEventListener('touchmove',function(e){if(!sw)return;dx=e.touches[0].clientX-sx;if(dx>0)return;el.style.transform='translateX('+Math.max(dx,-80)+'px)';el.style.transition='none';},{passive:true});
  el.addEventListener('touchend',function(){
    sw=false;
    if(dx<-60){
      el.style.transition='transform .2s';el.style.transform='translateX(-80px)';
      if(!el.querySelector('.swipe-del')){
        var btn=document.createElement('div');
        btn.className='swipe-del';
        btn.style.cssText='position:absolute;right:0;top:0;bottom:0;width:80px;background:#EF4444;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:11px;font-weight:700';
        btn.textContent='Annuler';el.style.position='relative';el.style.overflow='hidden';el.appendChild(btn);
        btn.onclick=function(){if(window.confirm('Annuler cette r\u00e9servation ?')){onConfirm();}else{el.style.transition='transform .2s';el.style.transform='translateX(0)';}};
      }
    }else{el.style.transition='transform .2s';el.style.transform='translateX(0)';}
  },{passive:true});
}

// ============================================================
// 10. EMPTY STATE ANIME
// ============================================================
function showEmptyAnimated(el,title,sub){
  if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:50px 24px">'
    +'<svg viewBox="0 0 72 72" width="72" height="72" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin:0 auto 20px;display:block">'
    +'<rect x="12" y="20" width="48" height="40" rx="6" fill="var(--orp)" stroke="var(--or)" stroke-width="2"/>'
    +'<path d="M12 30h48" stroke="var(--or)" stroke-width="2"/>'
    +'<line x1="22" y1="42" x2="50" y2="42" stroke="var(--bdr)" stroke-width="2.5" stroke-linecap="round" style="animation:lineGrow 2s ease infinite"/>'
    +'<line x1="22" y1="51" x2="40" y2="51" stroke="var(--bdr)" stroke-width="2.5" stroke-linecap="round" style="animation:lineGrow 2s ease .4s infinite"/>'
    +'</svg>'
    +'<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">'+title+'</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6">'+sub+'</div></div>';
}

// ============================================================
// VÉRIFICATION COMPTE ACTIF — déconnecte si supprimé
// ============================================================
function startAccountCheck(){
  if(!user||!user.id||user.guest)return;
  setInterval(async function(){
    if(!user||!user.id)return;
    try{
      var r=await fetch(API+'/profiles/'+user.id,{headers:apiH()});
      if(r.status>=500)return; // erreur serveur temporaire — ne pas déconnecter
      var p=await r.json();
      if(r.status===404&&p&&p.error){
        toast('Votre compte a été désactivé','Vous allez être déconnecté');
        setTimeout(doLogout,2000);return;
      }
      if(!p||!p.id)return; // réponse inattendue — ignorer
      if(p.statut_compte==='bloqué'&&user.statut_compte!=='bloqué'){
        toast('Votre compte a été bloqué','Vous allez être déconnecté');
        setTimeout(doLogout,2000);return;
      }
      // Mettre à jour le statut si changé (ex: vérifié par admin)
      if(p.statut_compte!==user.statut_compte||p.verified!==user.verified){
        user.statut_compte=p.statut_compte;
        user.verified=p.verified;
        user.can_retry_cni=p.can_retry_cni;
        user.rejection_reason=p.rejection_reason;
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Mettre à jour la bannière de vérification
        updateVerifBand();
        // Notifier si compte maintenant vérifié
        if(user.role==='professeur'&&(p.statut_compte==='verified'||p.verified)){
          toast('Compte vérifié !','Vous pouvez maintenant publier des cours');
          haptic([10,50,100,50,10]);
        } else if(user.role==='professeur'&&p.statut_compte==='rejeté'){
          toast('Document refusé','Vérifiez votre email pour plus d\'informations');
        }
      }
    }catch(e){}
  }, 30000);
}

// SERVICE WORKER PWA
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      _swReg=reg;
      return reg.pushManager.getSubscription();
    }).then(function(sub){
      _pushSubscription=sub||null;
      renderNotifStatus();
    }).catch(function(err){console.log('SW erreur:',err);});
  });
}
// ============================================================
// COURSPOOL — Feature additions (safe, non-destructive)
// ============================================================
var escH=function(s){return (s||'').replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};

// Step form with SVG illustrations
var STEP_DEFS=[
  {id:'mode',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="8" y="14" width="32" height="22" rx="4" fill="#FF8A5530" stroke="#FF6B2B" stroke-width="2"/><line x1="8" y1="21" x2="40" y2="21" stroke="#FF6B2B" stroke-width="2"/><circle cx="24" cy="31" r="3" fill="#FF6B2B"/></svg>',q:'Type de cours',h:'Pr\u00e9sentiel en personne ou visio en ligne'},
  {id:'prive',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="10" y="18" width="28" height="20" rx="3" fill="#FF8A5530" stroke="#FF6B2B" stroke-width="2"/><path d="M16 18v-5a8 8 0 0116 0v5" stroke="#FF6B2B" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="28" r="3" fill="#FF6B2B"/><line x1="24" y1="31" x2="24" y2="33" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round"/></svg>',q:'Visibilit\u00e9 du cours',h:'Un cours priv\u00e9 n\'est pas visible publiquement — acc\u00e8s par code unique'},
  {id:'titre',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="12" y="12" width="24" height="28" rx="3" fill="#FF8A5520" stroke="#FF6B2B" stroke-width="2"/><line x1="17" y1="19" x2="31" y2="19" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="24" x2="31" y2="24" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" opacity=".5"/><line x1="17" y1="29" x2="24" y2="29" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" opacity=".3"/></svg>',q:'Titre du cours',h:'Donnez un titre clair et accrocheur'},
  {id:'matiere',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="10" y="9" width="14" height="30" rx="2" fill="#FF8A5530" stroke="#FF6B2B" stroke-width="2"/><rect x="18" y="12" width="18" height="26" rx="2" fill="#FFF4EE" stroke="#FF6B2B" stroke-width="2"/><line x1="22" y1="18" x2="32" y2="18" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round"/><line x1="22" y1="22" x2="32" y2="22" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round" opacity=".5"/><line x1="22" y1="26" x2="28" y2="26" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round" opacity=".3"/></svg>',q:'Quelle mati\u00e8re\u00a0?',h:'Choisissez la discipline'},
  {id:'niveau',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><path d="M24 9l4 8.5 9 1.3-6.5 6.4 1.5 9L24 29.7 16 34.2l1.5-9L11 18.8l9-1.3L24 9z" fill="#FF8A5530" stroke="#FF6B2B" stroke-width="2" stroke-linejoin="round"/></svg>',q:'Niveau vis\u00e9',h:'Quel public ciblez-vous\u00a0?'},
  {id:'datetime',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="8" y="13" width="32" height="28" rx="3" fill="#FF8A5520" stroke="#FF6B2B" stroke-width="2"/><line x1="8" y1="22" x2="40" y2="22" stroke="#FF6B2B" stroke-width="2"/><line x1="16" y1="9" x2="16" y2="17" stroke="#FF6B2B" stroke-width="2.5" stroke-linecap="round"/><line x1="32" y1="9" x2="32" y2="17" stroke="#FF6B2B" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="32" r="5" fill="#FF6B2B"/></svg>',q:'Quand\u00a0?',h:'Date et heure du cours'},
  {id:'lieu',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><path d="M24 40s-14-10.5-14-21a14 14 0 0128 0c0 10.5-14 21-14 21z" fill="#FF8A5530" stroke="#FF6B2B" stroke-width="2"/><circle cx="24" cy="19" r="5" fill="#FF6B2B"/></svg>',q:'O\u00f9\u00a0?',h:'Ville, adresse \u2014 ou lien g\u00e9n\u00e9r\u00e9 pour la visio'},
  {id:'prix',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><circle cx="24" cy="24" r="15" fill="#FF8A5520" stroke="#FF6B2B" stroke-width="2"/><line x1="24" y1="14" x2="24" y2="16" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round"/><line x1="24" y1="32" x2="24" y2="34" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round"/><path d="M20 20.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5c0 4-8 4-8 7.5 0 2.2 1.8 3.5 4 3.5s4-1.3 4-3.5" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round"/></svg>',q:'Prix &amp; places',h:'Prix total que vous souhaitez recevoir'},
  {id:'desc',em:'<svg viewBox="0 0 48 48" fill="none" width="56" height="56"><rect width="48" height="48" rx="16" fill="#FFF4EE"/><rect x="10" y="10" width="28" height="32" rx="3" fill="#FF8A5520" stroke="#FF6B2B" stroke-width="2"/><line x1="16" y1="18" x2="32" y2="18" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="23" x2="32" y2="23" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round" opacity=".6"/><line x1="16" y1="28" x2="28" y2="28" stroke="#FF6B2B" stroke-width="1.5" stroke-linecap="round" opacity=".4"/></svg>',q:'Description',h:'D\u00e9tails sur votre cours (optionnel)'},
];

var _sd={mode:'presentiel',prive:false,code_acces:'',titre:'',matiere:'',matiere_key:'',niveau:'',date:'',heure:'',duree:60,places:5,prix:0,lieu:'',desc:''};
var _sc=0;

function openCrStep(){
  if(!user||!user.id){showLoginPrompt();return;}
  if(user.role!=='professeur'){toast('Acc\u00e8s refus\u00e9','Seuls les professeurs peuvent proposer des cours');return;}
  if(user.verified===false){
    if(getCniStatus()==='none'){toast('Pi\u00e8ce d\'identit\u00e9 requise','Envoyez votre CNI depuis votre profil pour publier des cours');openCniSheet();}
    else{toast('V\u00e9rification en cours','Votre identit\u00e9 est en cours de v\u00e9rification. Vous pourrez publier des cours sous 24h.');}
    return;
  }
  _sd={mode:'presentiel',prive:false,code_acces:'',titre:'',matiere:'',matiere_key:'',niveau:'',date:'',heure:'',duree:60,places:5,prix:0,lieu:'',desc:''};
  _sc=0;
  if(!g('bdCrStep'))buildStepDOM();
  stepRender(0);
  g('bdCrStep').classList.add('active');
  haptic(10);
}
function closeCrStep(){var el=g('bdCrStep');if(el)el.classList.remove('active');}

function buildStepDOM(){
  var div=document.createElement('div');div.id='bdCrStep';
  var style=document.createElement('style');
  style.textContent='#bdCrStep{position:fixed;inset:0;z-index:2001;background:var(--wh);display:none;flex-direction:column;overflow:hidden;}#bdCrStep.active{display:flex!important;}';
  document.head.appendChild(style);
  div.innerHTML=
    '<div style="padding:max(20px,env(safe-area-inset-top,20px)) 20px 16px;display:flex;align-items:center;gap:14px;flex-shrink:0;border-bottom:1px solid var(--bdr);background:var(--wh)">'
    +'<button id="stepBackBtn" onclick="stepBack()" style="width:36px;height:36px;border-radius:50%;background:var(--bg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mid);flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>'
    +'<div style="flex:1;height:4px;background:var(--bdr);border-radius:50px;overflow:hidden"><div id="stepFill" style="height:100%;background:var(--or);border-radius:50px;transition:width .4s cubic-bezier(.22,.61,.36,1);width:0%"></div></div>'
    +'<button id="stepCloseBtn" onclick="closeCrStep()" style="width:36px;height:36px;border-radius:50%;background:var(--bg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mid);font-size:16px;flex-shrink:0">&#x2715;</button>'
    +'</div>'
    +'<div id="stepBody" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:32px 24px;display:flex;flex-direction:column;align-items:center;max-width:480px;margin:0 auto;width:100%"></div>'
    +'<div style="padding:16px 24px;padding-bottom:max(24px,env(safe-area-inset-bottom,24px));flex-shrink:0;background:var(--wh);border-top:1px solid var(--bdr);max-width:480px;margin:0 auto;width:100%"><button id="stepCta" style="width:100%;background:var(--or);color:#fff;border:none;border-radius:50px;padding:16px;font-family:inherit;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 4px 16px rgba(255,107,43,.28);display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s">Continuer</button></div>';
  document.body.appendChild(div);
  g('stepBackBtn').onclick=stepBack;
  g('stepCloseBtn').onclick=closeCrStep;
  g('stepCta').onclick=stepNext;
}

function stepRender(idx){
  _sc=idx;
  var step=STEP_DEFS[idx];
  var _totalSteps=_sd.mode==='visio'?STEP_DEFS.length-1:STEP_DEFS.length;
  var _visioOffset=(_sd.mode==='visio'&&idx>STEP_DEFS.findIndex(function(s){return s.id==='lieu';}))&&idx>0?1:0;
  var _dispIdx=idx-_visioOffset;
  var fill=g('stepFill');if(fill)fill.style.width=Math.round(_dispIdx/_totalSteps*100)+'%';
  var backBtn=g('stepBackBtn');if(backBtn)backBtn.style.opacity=idx===0?'0.3':'1';
  var cta=g('stepCta');if(cta){cta.textContent=idx===STEP_DEFS.length-1?'Publier':'Continuer';cta.disabled=false;}
  var body=g('stepBody');if(!body)return;

  var html='<div style="margin-bottom:20px;display:flex;justify-content:center">'+step.em+'</div>'
    +'<div style="font-size:clamp(22px,6vw,28px);font-weight:800;letter-spacing:-.05em;color:var(--ink);margin-bottom:8px;text-align:center;line-height:1.2">'+step.q+'</div>'
    +'<div style="font-size:14px;color:var(--lite);text-align:center;margin-bottom:28px;line-height:1.5">'+step.h+'</div>';

  if(step.id==='mode'){
    html+='<div style="display:flex;flex-direction:column;gap:12px;width:100%">'
      +sOpt('mode','presentiel','Pr\u00e9sentiel','En personne',_sd.mode==='presentiel','rgba(0,177,79,.1)')
      +sOpt('mode','visio','Visio','En ligne',_sd.mode==='visio','rgba(0,113,227,.1)')
      +'</div>';

  }else if(step.id==='prive'){
    html+='<div style="display:flex;flex-direction:column;gap:12px;width:100%">'
      +sOpt('prive','public','Cours public','Visible dans les r\u00e9sultats de recherche',!_sd.prive,'rgba(0,177,79,.1)')
      +sOpt('prive','prive','Cours priv\u00e9','Invisible au public \u2014 acc\u00e8s par code unique',_sd.prive,'rgba(255,107,43,.1)')
      +'</div>';
    if(_sd.prive){
      html+='<div style="margin-top:16px;width:100%;background:var(--orp);border-radius:14px;padding:14px 16px">'
        +'<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Code d\'acc\u00e8s g\u00e9n\u00e9r\u00e9</div>'
        +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div id="stepCodeDisp" style="flex:1;background:var(--wh);border-radius:10px;padding:10px 14px;font-size:22px;font-weight:800;letter-spacing:.22em;color:var(--ink);text-align:center">'+escH(_sd.code_acces)+'</div>'
        +'<button id="stepCodeRegen" style="background:var(--wh);border:none;border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--mid);font-size:15px;transition:all .15s">&#x21BA;</button>'
        +'</div></div>';
    }

  }else if(step.id==='titre'){
    html+='<div style="width:100%"><input id="stepTitre" style="width:100%;border:2px solid var(--bdr);border-radius:16px;padding:16px 18px;font-family:inherit;font-size:18px;font-weight:600;color:var(--ink);background:var(--wh);outline:none;transition:border-color .2s;-webkit-appearance:none;box-sizing:border-box" type="text" placeholder="Ex: Alg\u00e8bre pour d\u00e9butants..." value="'+escH(_sd.titre)+'"></div>';

  }else if(step.id==='matiere'){
    var topM=['Maths','Physique','Chimie','SVT / Biologie','Anglais','Espagnol','Fran\u00e7ais','Histoire-G\u00e9o','Philosophie','Informatique','\u00c9conomie','Droit','Comptabilit\u00e9','Marketing','Architecture','Statistiques','Musique','Arts plastiques','Sport / EPS','Autre'];
    html+='<div style="display:flex;flex-direction:column;gap:10px;width:100%">';
    topM.forEach(function(m){
      var mo=MATIERES.find(function(x){return x.label===m;})||{bg:'linear-gradient(135deg,#F9FAFB,#F3F4F6)'};
      html+=sOpt('matiere',m,m,'',_sd.matiere===m,mo.bg,'padding:13px 16px');
    });
    html+='</div>';

  }else if(step.id==='niveau'){
    var nivs=[['','Tous niveaux'],['Primaire','Primaire'],['Coll\u00e8ge','Coll\u00e8ge'],['Lyc\u00e9e','Lyc\u00e9e'],['Bac+1/2','Bac\u00a0+1/2'],['Bac+3/4','Bac\u00a0+3/4'],['Bac+5','Bac\u00a0+5+']];
    html+='<div style="display:flex;flex-direction:column;gap:10px;width:100%">';
    nivs.forEach(function(nv){html+=sOpt('niveau',nv[0],nv[1],'',_sd.niveau===nv[0],'var(--orp)','padding:12px 16px');});
    html+='</div>';

  }else if(step.id==='datetime'){
    var today=new Date().toISOString().split('T')[0];
    var fi='width:100%;border:2px solid var(--bdr);border-radius:14px;padding:14px 16px;font-family:inherit;font-size:17px;outline:none;-webkit-appearance:none;box-sizing:border-box;background:var(--wh);color:var(--ink)';
    var lbl='font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:8px';
    html+='<div style="width:100%;display:flex;flex-direction:column;gap:14px">'
      +'<div><label style="'+lbl+'">Date</label><input id="stepDate" style="'+fi+'" type="date" min="'+today+'" value="'+escH(_sd.date)+'"></div>'
      +'<div><label style="'+lbl+'">Heure</label><input id="stepHeure" style="'+fi+'" type="time" value="'+escH(_sd.heure)+'"></div>'
      +'<div><label style="'+lbl+'">Dur\u00e9e (min)</label><input id="stepDuree" style="'+fi+'" type="number" value="'+_sd.duree+'" min="30"></div>'
      +'</div>';

  }else if(step.id==='lieu'){
    if(_sd.mode==='visio'){
      html+='<div style="width:100%;display:flex;flex-direction:column;gap:14px">'
        +'<div style="background:var(--orp);border-radius:18px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">'
        +'<div style="width:52px;height:52px;background:rgba(0,113,227,.12);border-radius:50%;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="#0071E3" stroke-width="2" stroke-linecap="round" width="26" height="26"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>'
        +'<div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Lien généré automatiquement</div>'
        +'<div style="font-size:13.5px;color:var(--lite);line-height:1.5">Un lien Jitsi sera créé pour votre cours. Vous pourrez le modifier depuis <strong>Mes cours</strong> après publication.</div></div>'
        +'</div></div>';
    }else{
      html+='<div style="width:100%">'
        +'<input id="stepLieu" style="width:100%;border:2px solid var(--bdr);border-radius:16px;padding:16px 18px;font-family:inherit;font-size:18px;font-weight:600;color:var(--ink);background:var(--wh);outline:none;transition:border-color .2s;-webkit-appearance:none;box-sizing:border-box" type="text" placeholder="Ville ou adresse..." value="'+escH(_sd.lieu)+'">'
        +'<div id="stepLieuSug" style="margin-top:8px;display:none;background:var(--wh);border:1px solid var(--bdr);border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)"></div>'
        +'</div>';
    }

  }else if(step.id==='prix'){
    html+='<div style="width:100%;display:flex;flex-direction:column;gap:18px">'
      +'<div><label style="font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:10px">Prix total (&euro;)</label>'
      +'<div style="display:flex;align-items:center;gap:14px;justify-content:center">'
      +'<button type="button" id="btnPrixM" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--bdr);background:var(--bg);font-size:22px;cursor:pointer;color:var(--mid);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s">&#8722;</button>'
      +'<input id="stepPrix" style="width:130px;border:2px solid var(--bdr);border-radius:16px;padding:14px;font-family:inherit;font-size:32px;font-weight:800;text-align:center;outline:none;-webkit-appearance:none;box-sizing:border-box;background:var(--wh);color:var(--ink);flex-shrink:0" type="number" placeholder="60" value="'+(_sd.prix||'')+'">'
      +'<button type="button" id="btnPrixP" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--or);background:var(--orp);font-size:22px;cursor:pointer;color:var(--or);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s">+</button>'
      +'</div></div>'
      +'<div><label style="font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:10px">Places max</label>'
      +'<div style="display:flex;align-items:center;gap:14px;justify-content:center">'
      +'<button type="button" id="btnPlcM" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--bdr);background:var(--bg);font-size:22px;cursor:pointer;color:var(--mid);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s">&#8722;</button>'
      +'<input id="stepPlaces" style="width:130px;border:2px solid var(--bdr);border-radius:16px;padding:14px;font-family:inherit;font-size:28px;font-weight:800;text-align:center;outline:none;-webkit-appearance:none;box-sizing:border-box;background:var(--wh);color:var(--ink);flex-shrink:0" type="number" value="'+_sd.places+'" min="1" max="20">'
      +'<button type="button" id="btnPlcP" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--or);background:var(--orp);font-size:22px;cursor:pointer;color:var(--or);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s">+</button>'
      +'</div></div>'
      +'<div id="stepPrixCalc" style="background:var(--orp);border-radius:14px;padding:14px;text-align:center;display:none"><div style="font-size:12px;color:var(--mid);margin-bottom:4px">Prix par \u00e9l\u00e8ve</div><div id="stepPrixCalcVal" style="font-size:30px;font-weight:800;color:var(--or)">-</div></div>'
      +'</div>';

  }else if(step.id==='desc'){
    html+='<div style="width:100%;display:flex;flex-direction:column;gap:14px">'
      +'<textarea id="stepDesc" rows="4" placeholder="D\u00e9crivez votre cours : niveau requis, programme, mat\u00e9riel..." style="resize:none;font-size:15px;font-weight:400;min-height:130px;width:100%;line-height:1.6;border:2px solid var(--bdr);border-radius:16px;padding:14px 16px;font-family:inherit;color:var(--ink);background:var(--wh);outline:none;transition:border-color .2s;box-sizing:border-box">'+escH(_sd.desc)+'</textarea>'
      +'<div id="stepDescCount" style="font-size:12px;color:var(--lite);text-align:right">'+(_sd.desc?_sd.desc.length:0)+'/400</div>'
      +'</div>';
  }

  body.innerHTML=html;

  // Wire options
  body.querySelectorAll('[data-sa]').forEach(function(el){
    el.addEventListener('click',function(){
      var a=el.dataset.sa,v=el.dataset.sv;
      if(a==='mode'){_sd.mode=v;}
      else if(a==='prive'){
        _sd.prive=(v==='prive');
        if(_sd.prive&&!_sd.code_acces){_sd.code_acces=genCode();}
        // Re-render to show/hide code box
        stepRender(idx);return;
      }
      else if(a==='matiere'){_sd.matiere=v;var mo=MATIERES.find(function(x){return x.label===v;});_sd.matiere_key=mo?mo.key:v.toLowerCase();}
      else if(a==='niveau'){_sd.niveau=v;}
      body.querySelectorAll('[data-sa="'+a+'"]').forEach(function(o){o.classList.remove('selected');});
      el.classList.add('selected');haptic(8);
    });
  });

  // Wire inputs
  function wire(id,fn){var e=g(id);if(e)e.addEventListener('input',fn);}
  wire('stepTitre',function(){_sd.titre=this.value;});
  wire('stepDate',function(){_sd.date=this.value;});
  wire('stepHeure',function(){_sd.heure=this.value;});
  wire('stepDuree',function(){_sd.duree=parseInt(this.value)||60;});
  wire('stepLieu',function(){_sd.lieu=this.value;stepLieuSearch(this.value);});
  wire('stepPrix',function(){_sd.prix=parseInt(this.value)||0;stepPxCalc();});
  wire('stepPlaces',function(){_sd.places=parseInt(this.value)||5;stepPxCalc();});
  wire('stepDesc',function(){if(this.value.length>400)this.value=this.value.slice(0,400);_sd.desc=this.value;var cnt=g('stepDescCount');if(cnt)cnt.textContent=this.value.length+'/400';});

  // +/- buttons
  var bpm=g('btnPrixM'),bpp=g('btnPrixP'),bplm=g('btnPlcM'),bplp=g('btnPlcP');
  if(bpm)bpm.onclick=function(){var e=g('stepPrix');var v=Math.max(0,(parseInt(e.value)||0)-5);e.value=v;_sd.prix=v;stepPxCalc();haptic(4);};
  if(bpp)bpp.onclick=function(){var e=g('stepPrix');var v=(parseInt(e.value)||0)+5;e.value=v;_sd.prix=v;stepPxCalc();haptic(4);};
  if(bplm)bplm.onclick=function(){var e=g('stepPlaces');var v=Math.max(1,(parseInt(e.value)||1)-1);e.value=v;_sd.places=v;stepPxCalc();haptic(4);};
  if(bplp)bplp.onclick=function(){var e=g('stepPlaces');var v=Math.min(20,(parseInt(e.value)||5)+1);e.value=v;_sd.places=v;stepPxCalc();haptic(4);};

  // Code regen
  var srg=g('stepCodeRegen');
  if(srg)srg.onclick=function(){_sd.code_acces=genCode();var cd=g('stepCodeDisp');if(cd)cd.textContent=_sd.code_acces;haptic(8);};

  setTimeout(function(){var inp=body.querySelector('input[type="text"],input[type="number"],textarea');if(inp)inp.focus();},300);
}

function sOpt(a,v,l,s,sel,bg,ex){
  return '<div class="step-option'+(sel?' selected':'')+'" data-sa="'+a+'" data-sv="'+escH(v)+'" onclick="_stepOptClick(this)" style="background:var(--wh);border:2px solid '+(sel?'var(--or)':'var(--bdr)')+';border-radius:18px;padding:16px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;'+(ex||'')+';box-shadow:0 1px 3px rgba(0,0,0,.05)">'
    +'<div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:'+bg+'"></div>'
    +'<div><div style="font-size:16px;font-weight:700;color:var(--ink);letter-spacing:-.02em">'+l+'</div>'+(s?'<div style="font-size:12.5px;color:var(--lite);margin-top:2px">'+s+'</div>':'')+'</div>'
    +'</div>';
}

function stepPxCalc(){
  var el=g('stepPrixCalc'),val=g('stepPrixCalcVal');
  if(!el)return;
  if(_sd.prix>0){el.style.display='block';if(val)val.textContent=Math.ceil(_sd.prix/Math.max(1,_sd.places))+'\u20ac';}
  else el.style.display='none';
}

var _sLT=null;
function stepLieuSearch(q){
  if(_sd.mode==='visio')return;
  var box=g('stepLieuSug');if(!box)return;
  if(!q||q.length<3){box.style.display='none';return;}
  clearTimeout(_sLT);
  _sLT=setTimeout(async function(){
    try{
      var r=await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q+', France')+'&format=json&limit=5&countrycodes=fr',{headers:{'Accept-Language':'fr'}});
      var d=await r.json();
      if(!d.length){box.style.display='none';return;}
      box.innerHTML='';
      d.forEach(function(p){
        var name=p.display_name.split(',').slice(0,3).join(', ');
        var div=document.createElement('div');
        div.style.cssText='padding:12px 16px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--bdr)';
        div.textContent=name;
        div.onmouseenter=function(){this.style.background='var(--bg)';};
        div.onmouseleave=function(){this.style.background='';};
        div.onclick=function(){_sd.lieu=name;var inp=g('stepLieu');if(inp)inp.value=name;box.style.display='none';};
        box.appendChild(div);
      });
      box.style.display='block';
    }catch(e){box.style.display='none';}
  },350);
}

function stepNext(){
  var step=STEP_DEFS[_sc];
  if(step.id==='titre'){if(g('stepTitre'))_sd.titre=g('stepTitre').value.trim();if(!_sd.titre){toast('Titre manquant','Donnez un titre');return;}}
  if(step.id==='matiere'&&!_sd.matiere){toast('Mati\u00e8re manquante','Choisissez une mati\u00e8re');return;}
  if(step.id==='datetime'){
    if(g('stepDate'))_sd.date=g('stepDate').value;
    if(g('stepHeure'))_sd.heure=g('stepHeure').value;
    if(g('stepDuree'))_sd.duree=parseInt(g('stepDuree').value)||60;
    if(!_sd.date){toast('Date manquante','Choisissez une date');return;}
    if(!_sd.heure){toast('Heure manquante','Choisissez une heure');return;}
  }
  if(step.id==='lieu'){
    if(g('stepLieu'))_sd.lieu=g('stepLieu').value.trim();
    if(!_sd.lieu&&_sd.mode!=='visio'){toast('Lieu manquant','Entrez le lieu');return;}
  }
  if(step.id==='prix'){
    if(g('stepPrix'))_sd.prix=parseInt(g('stepPrix').value)||0;
    if(g('stepPlaces'))_sd.places=parseInt(g('stepPlaces').value)||5;
    if(!_sd.prix){toast('Prix manquant','Entrez le prix');return;}
  }
  if(step.id==='desc'&&g('stepDesc'))_sd.desc=g('stepDesc').value.trim();
  var total=STEP_DEFS.length;
  if(_sc<total-1){
    _sc++;
    if(STEP_DEFS[_sc]&&STEP_DEFS[_sc].id==='lieu'&&_sd.mode==='visio')_sc++;
    stepRender(_sc);haptic(8);
  }else subCrStep();
}

function stepBack(){
  if(_sc===0){closeCrStep();return;}
  _sc--;
  if(STEP_DEFS[_sc]&&STEP_DEFS[_sc].id==='lieu'&&_sd.mode==='visio')_sc--;
  stepRender(_sc);haptic(6);
}

async function subCrStep(){
  var cta=g('stepCta');if(cta){cta.disabled=true;cta.textContent='Publication...';}
  try{
    var dt=new Date(_sd.date+'T'+_sd.heure+':00');
    var y=dt.getFullYear(),mo=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');
    var H=String(dt.getHours()).padStart(2,'0'),mi=String(dt.getMinutes()).padStart(2,'0');
    var _mat=MATIERES.find(function(m){return m.key===(_sd.matiere_key||_sd.matiere.toLowerCase());});
    var _sc2=_mat?_mat.color:'#7C3AED';
    var _bg=_mat?_mat.bg:'linear-gradient(135deg,#F5F3FF,#DDD6FE)';
    var p={titre:_sd.titre,sujet:_sd.matiere_key||_sd.matiere,niveau:_sd.niveau||'',
      date_heure:y+'-'+mo+'-'+d+'T'+H+':'+mi+':00',
      lieu:_sd.mode==='visio'?'Visio':_sd.lieu,
      prix_total:_sd.prix,places_max:_sd.places,duree:_sd.duree||60,
      description:_sd.desc||'',
      prof_id:user.id,professeur_id:user.id,
      mode:_sd.mode||'presentiel',
      visio_url:_sd.mode==='visio'?('https://meet.jit.si/CoursPool-'+Math.random().toString(36).slice(2,8).toUpperCase()):'',
      prive:_sd.prive||false,code_acces:_sd.prive?(_sd.code_acces||''):null,
      couleur_sujet:_sc2,background:_bg,
      emoji:_sd.prive?'\uD83D\uDD12':'\uD83D\uDCDA',
      prof_initiales:user.ini||'?',
      prof_couleur:user.col||'linear-gradient(135deg,#FF8C55,#E04E10)',
      prof_nom:(user.pr+(user.nm?' '+user.nm:'')).trim()};
    if(user.photo)p.prof_photo=user.photo;
    var r=await fetch(API+'/cours',{method:'POST',headers:apiH(),body:JSON.stringify(p)});
    var data=await r.json();
    if(!r.ok||data.error)throw new Error(data.error||'Erreur serveur');
    haptic([10,50,100,50,10]);closeCrStep();
    toast('Cours publi\u00e9\u00a0!','Votre cours est maintenant visible');
    await loadData();buildCards();buildAccLists();
  }catch(e){toast('Erreur',e.message||'Impossible de publier');if(cta){cta.disabled=false;cta.textContent='Publier';}}
}

// ---- Override openCr ----
(function(){
  var _oc=openCr;
  openCr=function(){
    if(!user||!user.id){showLoginPrompt();return;}
    if(user.role!=='professeur'){toast('Acc\u00e8s refus\u00e9','Seuls les professeurs peuvent proposer des cours');return;}
    if(user.verified===false){
      if(getCniStatus()==='none'){toast('Pi\u00e8ce d\'identit\u00e9 requise','Envoyez votre CNI depuis votre profil pour publier des cours');openCniSheet();}
      else{toast('V\u00e9rification en cours','Votre identit\u00e9 est en cours de v\u00e9rification. Vous pourrez publier des cours sous 24h.');}
      return;
    }
    openCrStep();
  };

  // navTo — add 'mes' tab
  var _nt=navTo;
  navTo=function(tab){
    if(tab==='mes'){
      // Masquer toutes les pages
      ['pgExp','pgMsg','pgAcc','pgFav','pgMes'].forEach(function(id){
        var el=g(id);if(el)el.classList.remove('on');
      });
      // Activer pgMes
      var pgMesEl=g('pgMes');if(pgMesEl)pgMesEl.classList.add('on');
      // Désactiver tous les items nav
      ['bniExp','bniFav','bniMsg','bniAcc','bniMes'].forEach(function(id){
        var b=g(id);if(b)b.classList.remove('on');
      });
      // Activer bniMes
      var bm=g('bniMes');if(bm)bm.classList.add('on');
      // Header : titre correct, pas de barre de recherche, header visible
      updateMobHeader('mes');
      // Refresh nav
      restoreNav();
      buildMesCours();
      return;
    }
    // Pour tous les autres tabs, enlever pgMes et bniMes
    var pm=g('pgMes'),bm=g('bniMes');
    if(pm)pm.classList.remove('on');
    if(bm)bm.classList.remove('on');
    _nt(tab);
  };

  // applyUser
  var _au=applyUser;
  applyUser=function(){
    _au();
    // Show "Mes cours" nav for students
    var bm=g('bniMes');if(bm)bm.style.display=(user&&user.role==='professeur')?'none':'flex';
    // Show share button for profs
    var sb=g('btnShareCours');
    if(sb)sb.style.display=(user&&user.role==='professeur')?'flex':'none';
  };

  // openR — mode badge + visio join
  var _or=openR;
  openR=function(id){
    _or(id);
    setTimeout(function(){
      var c=C.find(function(x){return x.id==id;});if(!c)return;
      var rmb=g('rModeBadge');
      if(rmb){var _rVis=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;rmb.innerHTML='<span class="mode-badge '+(_rVis?'visio':'presentiel')+'">'+(_rVis?'Visio':'Présentiel')+'</span>';}
      var rvj=g('rVisioJoin');
      if(rvj){var show=c.mode==='visio'&&c.visio_url&&(res[c.id]||(user&&c.pr===user.id));rvj.style.display=show?'flex':'none';if(show)rvj.href=c.visio_url;}
    },50);
  };

  // checkStripeReturn
  var _cs=checkStripeReturn;
  checkStripeReturn=function(){
    var params=new URLSearchParams(window.location.search);
    if(params.get('cancelled')){var cid=params.get('cours_id')||null;if(!cid){try{var pr=localStorage.getItem('cp_stripe_pending');if(pr){var pd=JSON.parse(pr);cid=pd.cours_id||null;}}catch(e){}}if(cid)window._lastCancelledCoursId=cid;}
    return _cs();
  };

  // openMsg/closeMsgConv — handled directly in functions above
  var _om=openMsg; // keep reference for compatibility

  // buildCards — mode badge on visio cards
  var _bc=buildCards;
  buildCards=function(){
    _bc.apply(this,arguments);
    document.querySelectorAll('.card').forEach(function(card){
      var id=card.dataset.id;var c=C.find(function(x){return x.id==id;});
      if(!c||c.mode!=='visio')return;
      var ctopDiv=card.querySelector('.ctop>div');
      if(ctopDiv&&!ctopDiv.querySelector('.mode-badge')){
        var sp=document.createElement('span');sp.className='mode-badge visio';sp.textContent='Visio';sp.style.marginLeft='4px';ctopDiv.appendChild(sp);
      }
    });
  };
})();

// ---- Retry payment ----
function retryPayment(){
  var p=g('popupFailed');if(p)p.style.display='none';
  var cid=window._lastCancelledCoursId||null;
  if(!cid){try{var r=localStorage.getItem('cp_stripe_pending');if(r){var d=JSON.parse(r);cid=d.cours_id||null;}}catch(e){}}
  if(!cid){toast('Cours introuvable','Selectionnez le cours');return;}
  if(!user||!user.id){showLoginPrompt();return;}
  setTimeout(function(){openR(cid);},200);
}

// ---- Filter conversations ----
function filterConversations(q){
  document.querySelectorAll('#listM .msg-row').forEach(function(r){
    if(!q){r.style.display='';return;}
    var n=r.querySelector('.msg-name'),p=r.querySelector('.msg-preview');
    var m=(n&&n.textContent.toLowerCase().includes(q.toLowerCase()))||(p&&p.textContent.toLowerCase().includes(q.toLowerCase()));
    r.style.display=m?'':'none';
  });
}

// ---- Mes cours ----
function buildMesCours(){
  var el=g('pgMesCnt');if(!el)return;
  if(!user||!user.id){
    el.innerHTML='<div style="text-align:center;padding:60px 24px"><div class="bempty-icon" style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 28px rgba(255,107,43,.22)"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.6" width="36" height="36"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px">Connexion requise</div></div>';
    return;
  }
  var isProf=user&&user.role==='professeur';
  var myCours=isProf
    ?C.filter(function(c){return c.pr===user.id;})
    :Object.keys(res).map(function(id){return C.find(function(c){return c.id===id;});}).filter(Boolean);

  if(!myCours.length){
    var eL=isProf?'Aucun cours publi\u00e9':'Aucun cours r\u00e9serv\u00e9';
    var eS=isProf?'Cr\u00e9ez votre premier cours':'Explorez et r\u00e9servez votre premier cours';
    el.innerHTML='<div style="text-align:center;padding:60px 24px"><div class="bempty-icon" style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 28px rgba(255,107,43,.22)"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.6" width="36" height="36"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg></div><div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:6px">'+eL+'</div><div style="font-size:14px;color:var(--lite);margin-bottom:20px">'+eS+'</div><button onclick="navTo(\'exp\')" class="pb pri" style="margin:0 auto">Explorer</button></div>';
    return;
  }
  var now=new Date(),upcoming=[],past=[];
  myCours.forEach(function(c){
    // c.dt is French string "dim. 22 mars · 14:00" — unparseable
    // Use created_at to distinguish old from new (>7 days = past)
    var isPast=false;
    try{
      if(c.created_at){var d=new Date(c.created_at);isPast=(now-d)>7*24*3600*1000;}
    }catch(e){}
    (isPast?past:upcoming).push(c);
  });
  var h='<div style="padding-bottom:120px">';
  if(upcoming.length){h+='<div class="mes-section-title">A venir &middot; '+upcoming.length+'</div>';upcoming.forEach(function(c){h+=buildMesCard(c,false,isProf);});}
  if(past.length){h+='<div class="mes-section-title">Pass\u00e9s &middot; '+past.length+'</div>';past.forEach(function(c){h+=buildMesCard(c,true,isProf);});}
  h+='</div>';
  el.innerHTML=h;
  el.querySelectorAll('.mes-card').forEach(function(card){card.onclick=function(){openR(card.dataset.cid);};});
  el.querySelectorAll('.mes-code-copy').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();var code=btn.dataset.code;if(navigator.clipboard)navigator.clipboard.writeText(code).then(function(){toast('Copi\u00e9\u00a0!','');});};});
  el.querySelectorAll('.mes-visio-add').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();openAddVisioLink(btn.dataset.cid);};});
  el.querySelectorAll('.mes-link-copy').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();var link=btn.dataset.link;if(navigator.share){navigator.share({title:'CoursPool',url:link}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(link).then(function(){toast('Lien copi\u00e9\u00a0!','');});}else{toast('Lien copi\u00e9\u00a0!','');}};});
}

function buildMesCard(c,isPast,isProf){
  var mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  var mL=c.mode==='visio'?'Visio':'Pr\u00e9sentiel';
  var mC=c.mode==='visio'?'visio':'presentiel';
  var visio='';
  if(c.mode==='visio'){
    if(c.visio_url&&(isProf||!!res[c.id])){visio='<a href="'+escH(c.visio_url)+'" target="_blank" class="btn-visio" style="margin-top:10px;width:100%;justify-content:center;text-decoration:none" onclick="event.stopPropagation()">Rejoindre</a>';}
    if(isProf&&!c.visio_url){visio='<button class="mes-visio-add" data-cid="'+escH(c.id)+'" style="margin-top:10px;width:100%;padding:10px;background:rgba(0,113,227,.08);color:#0055B3;border:1.5px dashed rgba(0,113,227,.3);border-radius:12px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">+ Ajouter le lien visio</button>';}
    else if(isProf&&c.visio_url){visio='<div style="margin-top:10px;display:flex;gap:8px"><a href="'+escH(c.visio_url)+'" target="_blank" class="btn-visio" style="flex:1;justify-content:center;text-decoration:none" onclick="event.stopPropagation()">Rejoindre</a><button class="mes-visio-add" data-cid="'+escH(c.id)+'" style="padding:9px 14px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:50px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer">Modifier</button></div>';}
  }
  var code='';
  if(isProf&&c.prive&&c.code){code='<div style="margin-top:10px;background:var(--bg);border-radius:12px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px"><div><div style="font-size:10px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">Code d&#39;acc\u00e8s</div><div style="font-size:18px;font-weight:800;letter-spacing:.18em;color:var(--ink)">'+escH(c.code)+'</div></div><button class="mes-code-copy" data-code="'+escH(c.code)+'" style="background:var(--wh);border:1.5px solid var(--bdr);border-radius:10px;padding:8px 12px;font-family:inherit;font-size:12px;font-weight:600;color:var(--mid);cursor:pointer">Copier</button></div>';}
  var shareLink='';
  if(isProf){var sUrl='https://courspool.vercel.app/?cours='+escH(c.id);shareLink='<div style="margin-top:10px;background:var(--bg);border-radius:12px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px"><div style="min-width:0"><div style="font-size:10px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">Lien partageable</div><div style="font-size:12px;color:var(--mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">courspool.vercel.app/?cours='+escH(c.id)+'</div></div><button class="mes-link-copy" data-link="'+sUrl+'" style="flex-shrink:0;background:var(--wh);border:1.5px solid var(--bdr);border-radius:10px;padding:8px 12px;font-family:inherit;font-size:12px;font-weight:600;color:var(--mid);cursor:pointer;display:flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>Copier</button></div>';}
  var heartBtn='';
  if(!isProf){
    var isFavMes=favCours.has(c.id);
    heartBtn='<button class="card-heart-btn'+(isFavMes?' saved':'')+'" onclick="event.stopPropagation();toggleFavCours(\''+escH(c.id)+'\',this)" title="Sauvegarder" style="position:static;width:34px;height:34px;border-radius:50%;background:'+(isFavMes?'rgba(255,60,100,.12)':'var(--bg)')+';border:1.5px solid '+(isFavMes?'#FFB3CB':'var(--bdr)')+';backdrop-filter:none;-webkit-backdrop-filter:none;color:'+(isFavMes?'#E01060':'var(--lite)')+';flex-shrink:0"><svg viewBox="0 0 24 24" fill="'+(isFavMes?'#E01060':'none')+'" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></button>';
  }
  return '<div class="mes-card" data-cid="'+escH(c.id)+'"'+(isPast?' style="opacity:.65"':'')+' >'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
    +'<div style="width:44px;height:44px;border-radius:14px;background:'+mf.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:10px;height:10px;border-radius:50%;background:'+mf.color+'"></div></div>'
    +'<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(c.title)+'</div>'
    +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+escH(c.subj)+' &middot; '+escH(c.dt)+'</div></div>'
    +'<div style="font-size:18px;font-weight:800;color:var(--or);flex-shrink:0">'+pp+'&euro;</div>'
    +heartBtn
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<span class="mode-badge '+mC+'">'+mL+'</span>'
    +(c.prive?'<span style="background:var(--bg);border:1px solid var(--bdr);border-radius:50px;padding:3px 8px;font-size:10.5px;font-weight:600;color:var(--mid)">Priv\u00e9</span>':'')
    +'</div>'+code+shareLink+visio
    +'<button class="mes-cal-btn" data-cid="'+escH(c.id)+'" onclick="event.stopPropagation();addToCalendar(\''+escH(c.id)+'\')" style="margin-top:10px;width:100%;padding:9px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:12px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>Ajouter au calendrier</button>'
    +'</div>';
}

function openAddVisioLink(coursId){
  var c=C.find(function(x){return x.id==coursId;});if(!c)return;
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px;padding-bottom:max(32px,env(safe-area-inset-bottom,32px))';
  var handle=document.createElement('div');handle.style.cssText='width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:0 auto 20px';sheet.appendChild(handle);
  var title=document.createElement('div');title.style.cssText='font-size:18px;font-weight:800;margin-bottom:4px;letter-spacing:-.03em';title.textContent=c.visio_url?'Modifier le lien visio':'Ajouter un lien visio';sheet.appendChild(title);
  var sub=document.createElement('div');sub.style.cssText='font-size:13px;color:var(--lite);margin-bottom:20px';sub.textContent='Zoom, Google Meet, Jitsi ou tout autre lien';sheet.appendChild(sub);
  var inp=document.createElement('input');inp.type='url';inp.placeholder='https://meet.google.com/...';inp.value=c.visio_url||'';inp.style.cssText='width:100%;border:1.5px solid var(--bdr);border-radius:12px;padding:12px 14px;font-family:inherit;font-size:16px;outline:none;margin-bottom:20px;box-sizing:border-box;transition:border-color .2s';inp.addEventListener('focus',function(){inp.style.borderColor='var(--or)';});inp.addEventListener('blur',function(){inp.style.borderColor='var(--bdr)';});sheet.appendChild(inp);
  var btnS=document.createElement('button');btnS.style.cssText='width:100%;background:var(--or);color:#fff;border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.28);margin-bottom:10px';btnS.textContent='Enregistrer';
  btnS.onclick=async function(){
    var url=inp.value.trim();btnS.disabled=true;btnS.textContent='Enregistrement...';
    try{var r=await fetch(API+'/cours/'+coursId,{method:'PATCH',headers:apiH(),body:JSON.stringify({visio_url:url})});var d=await r.json();if(!r.ok||d.error){toast('Erreur',d.error||'Impossible');btnS.disabled=false;btnS.textContent='Enregistrer';return;}if(c)c.visio_url=url;bd.remove();toast(url?'Lien enregistr\u00e9':'Lien supprim\u00e9','');buildMesCours();}catch(e){toast('Erreur r\u00e9seau','');btnS.disabled=false;btnS.textContent='Enregistrer';}
  };
  sheet.appendChild(btnS);
  if(c.visio_url){var btnCl=document.createElement('button');btnCl.style.cssText='width:100%;background:none;border:none;color:#EF4444;font-family:inherit;font-size:14px;cursor:pointer;padding:6px;margin-bottom:4px';btnCl.textContent='Supprimer le lien';btnCl.onclick=async function(){if(!confirm('Supprimer\u00a0?'))return;try{await fetch(API+'/cours/'+coursId,{method:'PATCH',headers:apiH(),body:JSON.stringify({visio_url:''})});if(c)c.visio_url='';bd.remove();buildMesCours();}catch(e){}};sheet.appendChild(btnCl);}
  var btnC=document.createElement('button');btnC.style.cssText='width:100%;background:none;border:none;color:var(--lite);font-family:inherit;font-size:14px;cursor:pointer;padding:6px';btnC.textContent='Annuler';btnC.onclick=function(){bd.remove();};sheet.appendChild(btnC);
  bd.appendChild(sheet);document.body.appendChild(bd);
  setTimeout(function(){inp.focus();},200);
}

// ---- Ajouter au calendrier ----
function addToCalendar(coursId){
  var c=C.find(function(x){return x.id==coursId;});
  if(!c){toast('Erreur','Cours introuvable');return;}

  function icsEsc(s){return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');}
  function toIcsDate(d){return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');}
  var dtStart=new Date(c.dt);
  if(isNaN(dtStart)){toast('Erreur','Date du cours introuvable');return;}
  var dtEnd=new Date(dtStart.getTime()+60*60*1000);
  var icsText=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CoursPool//CoursPool//FR',
    'CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    'UID:cours-'+c.id+'@courspool.app',
    'DTSTART:'+toIcsDate(dtStart),'DTEND:'+toIcsDate(dtEnd),
    'SUMMARY:'+icsEsc(c.title),'LOCATION:'+icsEsc(c.lc),
    'DESCRIPTION:'+icsEsc(c.description||('Cours avec '+c.prof_nm)),
    'END:VEVENT','END:VCALENDAR'].join('\r\n');

  var gcUrl='https://calendar.google.com/calendar/render?action=TEMPLATE'
    +'&text='+encodeURIComponent(c.title)
    +'&dates='+toIcsDate(dtStart)+'/'+toIcsDate(dtEnd)
    +'&details='+encodeURIComponent(c.description||('Cours avec '+c.prof_nm))
    +'&location='+encodeURIComponent(c.lc);

  var isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(window.Capacitor&&window.Capacitor.getPlatform()==='ios');
  var isAndroid=/Android/.test(navigator.userAgent)||(window.Capacitor&&window.Capacitor.getPlatform()==='android');
  var isCap=!!(window.Capacitor);

  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:1200;display:flex;align-items:flex-end;justify-content:center';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:20px;padding-bottom:max(28px,env(safe-area-inset-bottom,28px))';
  sheet.innerHTML='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:0 auto 20px"></div>'
    +'<div style="font-size:16px;font-weight:800;color:var(--ink);margin-bottom:16px">Ajouter au calendrier</div>';

  function addBtn(iconSvg,label,action){
    var btn=document.createElement('button');
    btn.style.cssText='width:100%;background:var(--bg);border:1.5px solid var(--bdr);border-radius:14px;padding:14px 16px;font-family:inherit;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:10px;text-align:left';
    btn.innerHTML=iconSvg+'<span>'+label+'</span>';
    btn.onclick=function(){bd.remove();action();};
    sheet.appendChild(btn);
  }

  var calIco='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>';
  var gcIco='<svg viewBox="0 0 24 24" width="20" height="20"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>';
  var dlIco='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  if(isIOS){
    addBtn(calIco,'Calendrier Apple',function(){
      var dataUrl='data:text/calendar;charset=utf-8,'+encodeURIComponent(icsText);
      if(isCap){window.open(dataUrl,'_system');}else{window.location.href=dataUrl;}
    });
  }
  addBtn(gcIco,'Google Agenda',function(){
    if(isCap){window.open(gcUrl,'_system');}else{window.open(gcUrl,'_blank');}
  });
  if(!isIOS&&!isAndroid){
    addBtn(dlIco,'Télécharger .ics (Outlook, Apple…)',function(){
      var blob=new Blob([icsText],{type:'text/calendar;charset=utf-8'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download='cours.ics';
      document.body.appendChild(a);a.click();
      setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
    });
  }

  var btnC=document.createElement('button');
  btnC.style.cssText='width:100%;background:none;border:none;color:var(--lite);font-family:inherit;font-size:14px;cursor:pointer;padding:8px;margin-top:4px';
  btnC.textContent='Annuler';btnC.onclick=function(){bd.remove();};
  sheet.appendChild(btnC);
  bd.appendChild(sheet);document.body.appendChild(bd);
  haptic(10);
}

// ---- Share cours in messagerie ----
function openShareCoursSheet(){
  var myC=C.filter(function(c){return user&&c.pr===user.id;});
  if(!myC.length){toast('Aucun cours','Publiez un cours pour commencer');return;}
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:20px;padding-bottom:max(28px,env(safe-area-inset-bottom,28px));max-height:80vh;display:flex;flex-direction:column';
  var handle=document.createElement('div');handle.style.cssText='width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:0 auto 16px';sheet.appendChild(handle);
  var title=document.createElement('div');title.style.cssText='font-size:17px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px';title.textContent='Partager un cours';sheet.appendChild(title);
  var sub=document.createElement('div');sub.style.cssText='font-size:13px;color:var(--lite);margin-bottom:16px';sub.textContent='La carte s\'affichera dans la conversation.';sheet.appendChild(sub);
  var list=document.createElement('div');list.style.cssText='overflow-y:auto;flex:1';
  myC.forEach(function(c){
    var mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
    var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--bdr);cursor:pointer;transition:opacity .15s';
    row.innerHTML='<div style="width:44px;height:44px;border-radius:12px;background:'+mf.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:10px;height:10px;border-radius:50%;background:'+mf.color+'"></div></div>'
      +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(c.title)+'</div>'
      +'<div style="font-size:12px;color:var(--lite);margin-top:1px">'+escH(c.subj)+' &middot; '+pp+'&euro;/\u00e9l\u00e8ve</div></div>'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>';
    row.onmouseenter=function(){this.style.opacity='.7';};
    row.onmouseleave=function(){this.style.opacity='1';};
    row.onclick=function(){bd.remove();sendCoursCardMsg(c);};
    list.appendChild(row);
  });
  sheet.appendChild(list);bd.appendChild(sheet);document.body.appendChild(bd);
}

async function sendCoursCardMsg(c){
  if(!user||!msgDestId)return;
  var mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  // Build native HTML card
  var _cIsVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  var cardHtml='<div class="chat-cours-card" onclick="viewCoursCard(\''+escH(c.id)+'\')" style="max-width:260px">'
    +'<div class="chat-cours-card-header" style="background:'+mf.bg+'"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:rgba(0,0,0,.18);color:#fff;border-radius:50px;padding:3px 8px">'+escH(c.subj)+'</span>'
    +'<span style="margin-left:auto;font-size:15px;font-weight:800;color:#fff">'+pp+'&euro;</span></div>'
    +'<div class="chat-cours-card-body"><div class="chat-cours-card-title">'+escH(c.title)+'</div>'
    +'<div class="chat-cours-card-meta">'+escH(c.dt)+(_cIsVisio?' &middot; Visio':'')+'</div>'
    +'<div style="margin-top:6px"><span class="mode-badge '+(_cIsVisio?'visio':'presentiel')+'">'+(_cIsVisio?'Visio':'Pr\u00e9sentiel')+'</span></div>'
    +'</div></div>';
  try{
    await fetch(API+'/messages',{method:'POST',headers:apiH(),body:JSON.stringify({expediteur_id:user.id,destinataire_id:msgDestId,contenu:cardHtml,type:'cours_card'})});
    loadMessages();toast('Cours partag\u00e9\u00a0!','La carte est dans la conversation');
  }catch(e){toast('Erreur','Envoi impossible');}
}

// ---- Visual viewport keyboard — colle la barre de saisie au-dessus du clavier ----
(function(){
  if(!window.visualViewport)return;
  function _onVpResize(){
    var conv=g('msgConvPane');if(!conv||conv.style.display==='none')return;
    var kbH=Math.max(0,window.innerHeight-window.visualViewport.height-window.visualViewport.offsetTop);
    // Réduire la hauteur du panneau depuis le bas pour que la barre remonte avec le clavier
    conv.style.bottom=kbH>50?kbH+'px':'0';
    // Scroll vers le bas après l'animation clavier
    var msgs=g('msgMessages');
    if(msgs)setTimeout(function(){msgs.scrollTop=msgs.scrollHeight;},100);
  }
  window.visualViewport.addEventListener('resize',_onVpResize,{passive:true});
  window.visualViewport.addEventListener('scroll',_onVpResize,{passive:true});
})();

// ============================================================
// PROFILE — Home grid + Detail view navigation
// ============================================================
var ACC_TITLES={'R':'Mes cours','F':'Suivis','H':'Historique','P':'Mon profil','Rev':'Revenus'};

function showAccHome(){
  var pg=g('pgAcc');
  if(pg){pg.classList.remove('detail-mode');pg.classList.add('home-mode');}
  // Always explicitly hide the detail header (CSS can't beat inline style)

  ['R','F','H','P','Rev'].forEach(function(x){
    var t=g('aTab'+x),s=g('asec'+x);
    if(t)t.classList.remove('on');
    if(s)s.classList.remove('on');
  });
  var pgEl=g('pgAcc');if(pgEl)pgEl.scrollTop=0;
}

// Override switchATab to show detail view + update topbar title + animate icon
(function(){
  var _tabTitles={R:'Mes cours',F:'Suivis',H:'Historique',P:'Mon profil',Rev:'Revenus'};
  var _animTabs={R:true,H:true,F:true,P:true,Rev:true};
  // Animer toutes les icônes à l'ouverture de la page profil
  function animAllAccIcons(){
    var icons=document.querySelectorAll('#accHome .acc-card div[style*="border-radius:14px"]');
    icons.forEach(function(ico,i){
      setTimeout(function(){
        ico.classList.remove('acc-card-icon-anim');void ico.offsetWidth;ico.classList.add('acc-card-icon-anim');
      },i*70);
    });
  }
  var _orig=switchATab;
  switchATab=function(s,el){
    _orig(s,el);
    var pg=g('pgAcc');
    if(pg){pg.classList.remove('home-mode');pg.classList.add('detail-mode');}
    var mt=g('mobTitle');if(mt&&_tabTitles[s])mt.textContent=_tabTitles[s];
    var mh=g('mobHeader');if(mh)mh.style.display='block';
    var ms=g('mobSearch');if(ms)ms.style.display='none';
    // Animer l'icône de la card cliquée (Mes cours + Historique)
    if(_animTabs[s]){
      var cards=document.querySelectorAll('#accHome .acc-card');
      cards.forEach(function(card){
        if(card.getAttribute('onclick')&&card.getAttribute('onclick').includes("'"+s+"'")){
          var ico=card.querySelector('div[style*="border-radius:14px"]');
          if(ico){ico.classList.remove('acc-card-icon-anim');void ico.offsetWidth;ico.classList.add('acc-card-icon-anim');}
        }
      });
    }
    var body=document.querySelector('#pgAcc .acc-body');
    if(body)body.scrollTop=0;
  };
})();

// Override navTo to reset to home when going to acc tab
(function(){
  var _nt2=navTo;
  navTo=function(tab){
    _nt2(tab);
    if(tab==='acc'){setTimeout(showAccHome,20);setTimeout(animAllAccIcons,80);}
  };
})();

// applyUser — show revenue card for profs
(function(){
  var _au2=applyUser;
  applyUser=function(){
    _au2();
    var cr=g('accCardRev');
    if(cr)cr.style.display=(user&&user.role==='professeur')?'block':'none';
    var bm=g('bniMes');if(bm)bm.style.display=(user&&user.role==='professeur')?'none':'flex';
    var sb=g('btnShareCours');
    if(sb)sb.style.display=(user&&user.role==='professeur')?'flex':'none';
    var pg=g('pgAcc');
    if(pg&&!pg.classList.contains('detail-mode'))pg.classList.add('home-mode');
  };
})();

// Init
(function(){
  var pg=g('pgAcc');if(pg)pg.classList.add('home-mode');
  // Also style accStats cells dynamically
  var _orig2=buildAccLists;
  buildAccLists=function(){
    _orig2.apply(this,arguments);
    var stats=g('accStats');
    if(stats){
      stats.querySelectorAll('div').forEach(function(cell){
        if(!cell.style.background){cell.style.cssText+='background:var(--wh);border-radius:16px;padding:16px;text-align:center;';}
      });
    }
  };
})();

// ---- setPill compat for new fchip ----
(function(){
  var _sp=setPill;
  setPill=function(el){
    haptic(4);
    // Support .filter-pill-btn, .fchip, .pill
    document.querySelectorAll('.filter-pill-btn[data-f],.fchip[data-f],.pill[data-f]').forEach(function(p){
      p.classList.remove('on','active');
    });
    el.classList.add('on','active');
    actF=el.dataset.f;
    doFilter();
    try{sessionStorage.setItem('cp_filter',actF);}catch(e){}
  };
})();

// ---- Cycle sort ----
var _sortModes=['date','prix','recent'];
var _sortLabels=['Date','Prix','Récents'];
var _sortIdx=0;
function cycleSort(el){
  _sortIdx=(_sortIdx+1)%_sortModes.length;
  sortMode=_sortModes[_sortIdx];
  var lbl=document.getElementById('sortLabel');
  if(lbl)lbl.textContent=_sortLabels[_sortIdx];
  el.style.background=_sortIdx===0?'var(--bg)':'var(--orp)';
  el.style.color=_sortIdx===0?'var(--mid)':'var(--or)';
  applyFilter();
  haptic(6);
}

// ---- Message edit ----
function editMsg(msgId, btn){
  var wrap=btn.closest('.msg-bubble-wrap');
  if(!wrap)return;
  var contentEl=wrap.querySelector('.msg-content[data-id="'+msgId+'"]');
  if(!contentEl)return;
  var oldText=contentEl.textContent;
  // Hide actions, show inline editor
  var actions=wrap.querySelector('.msg-actions');
  if(actions)actions.style.display='none';
  var editWrap=document.createElement('div');
  editWrap.className='msg-edit-wrap';
  editWrap.innerHTML='<input class="msg-edit-input" value="'+oldText.replace(/"/g,'&quot;')+'" maxlength="1000">'
    +'<button onclick="submitEditMsg(\''+msgId+'\',this)" style="background:var(--or);color:#fff;border:none;border-radius:10px;padding:7px 12px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer">OK</button>'
    +'<button onclick="cancelEditMsg(this,\''+oldText.replace(/'/g,"\'")+'\',\''+msgId+'\')" style="background:var(--bg);color:var(--mid);border:none;border-radius:10px;padding:7px 10px;font-family:inherit;font-size:13px;cursor:pointer">✕</button>';
  wrap.appendChild(editWrap);
  var inp=editWrap.querySelector('input');
  if(inp){inp.focus();inp.select();}
}
function cancelEditMsg(btn, oldText, msgId){
  var wrap=btn.closest('.msg-bubble-wrap');if(!wrap)return;
  var ew=wrap.querySelector('.msg-edit-wrap');if(ew)ew.remove();
  var ac=wrap.querySelector('.msg-actions');if(ac)ac.style.display='';
}
async function submitEditMsg(msgId, btn){
  var wrap=btn.closest('.msg-bubble-wrap');if(!wrap)return;
  var inp=wrap.querySelector('.msg-edit-input');if(!inp)return;
  var newText=inp.value.trim();if(!newText)return;
  btn.disabled=true;btn.textContent='...';
  try{
    var r=await fetch(API+'/messages/'+msgId,{method:'PATCH',headers:apiH(),body:JSON.stringify({contenu:newText,user_id:user.id})});
    if(r.ok){
      var contentEl=wrap.querySelector('.msg-content[data-id="'+msgId+'"]');
      if(contentEl)contentEl.textContent=newText;
      var ew=wrap.querySelector('.msg-edit-wrap');if(ew)ew.remove();
      var ac=wrap.querySelector('.msg-actions');if(ac)ac.style.display='';
      haptic(6);
    }else{toast('Erreur','Impossible de modifier');}
  }catch(e){toast('Erreur réseau','');}
  finally{btn.disabled=false;btn.textContent='OK';}
}

// ---- Message delete ----
async function deleteMsg(msgId){
  if(!confirm('Supprimer ce message ?'))return;
  try{
    var r=await fetch(API+'/messages/'+msgId,{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id})});
    if(r.ok){
      var el=document.querySelector('.msg-content[data-id="'+msgId+'"]');
      if(el){
        var wrap=el.closest('.msg-bubble-wrap');
        var row=wrap?wrap.closest('[style*="display:flex"]'):null;
        if(row){row.style.transition='opacity .25s,max-height .3s';row.style.opacity='0';row.style.maxHeight='0';row.style.overflow='hidden';setTimeout(function(){row.remove();},300);}
        else if(wrap)wrap.remove();
      }
      haptic([10,30]);toast('Message supprimé','');
    }else{toast('Erreur','Impossible de supprimer');}
  }catch(e){toast('Erreur réseau','');}
}

// Touch-hold on mobile to show msg actions
document.addEventListener('touchstart',function(e){
  var wrap=e.target.closest('.msg-bubble-wrap');
  if(!wrap)return;
  wrap._holdTimer=setTimeout(function(){
    document.querySelectorAll('.msg-bubble-wrap.touched').forEach(function(w){if(w!==wrap)w.classList.remove('touched');});
    wrap.classList.toggle('touched');
    haptic(10);
  },450);
},{passive:true});
document.addEventListener('touchend',function(e){
  var wrap=e.target.closest('.msg-bubble-wrap');
  if(wrap)clearTimeout(wrap._holdTimer);
},{passive:true});
document.addEventListener('click',function(e){
  if(!e.target.closest('.msg-actions')&&!e.target.closest('.msg-bubble-wrap')){
    document.querySelectorAll('.msg-bubble-wrap.touched').forEach(function(w){w.classList.remove('touched');});
  }
});


// ---- Settings sheet ----
function openSettings(){
  var bd=document.getElementById('bdSettings');
  if(bd){bd.classList.add('on');document.body.style.overflow='hidden';}
  updateDarkBtn();
  haptic(6);
}
function closeSettings(){
  var bd=document.getElementById('bdSettings');
  if(bd){bd.classList.remove('on');document.body.style.overflow='';}
}
// ---- Search clear ----
function clearSearch(){
  var inp=document.getElementById('mobSearchInput');
  var srch=document.getElementById('srch');
  var btn=document.getElementById('searchClearBtn');
  if(inp)inp.value='';if(srch)srch.value='';
  if(btn)btn.style.display='none';
  var _sas=g('searchAliasSuggestion');if(_sas)_sas.style.display='none';
  _pendingAlias=null;
  doFilter();if(inp)inp.focus();
}
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var inp=document.getElementById('mobSearchInput');
    var btn=document.getElementById('searchClearBtn');
    if(!inp||!btn)return;
    inp.addEventListener('input',function(){btn.style.display=this.value?'flex':'none';});
  });
})();
// ---- Swipe to close settings ----
(function(){
  var startY=0,dragging=false;
  document.addEventListener('touchstart',function(e){
    if(e.target.closest('.settings-sheet')){startY=e.touches[0].clientY;dragging=true;}
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!dragging)return;dragging=false;
    var dy=e.changedTouches[0].clientY-startY;
    if(dy>80)closeSettings();
  },{passive:true});
})();

// Global handler for step options (onclick attribute, mobile-safe)
function _stepOptClick(el){
  var a=el.dataset.sa, v=el.dataset.sv;
  if(!a)return;
  var body=g('stepBody');
  if(a==='mode'){_sd.mode=v;}
  else if(a==='prive'){
    _sd.prive=(v==='prive');
    if(_sd.prive&&!_sd.code_acces){_sd.code_acces=genCode();}
    stepRender(_sc);return;
  }
  else if(a==='matiere'){_sd.matiere=v;var mo=MATIERES.find(function(x){return x.label===v;});_sd.matiere_key=mo?mo.key:v.toLowerCase();}
  else if(a==='niveau'){_sd.niveau=v;}
  if(body){body.querySelectorAll('[data-sa="'+a+'"]').forEach(function(o){o.classList.remove('selected');o.style.borderColor='var(--bdr)';});}
  el.classList.add('selected');
  el.style.borderColor='var(--or)';
  haptic(8);
}

// ── Drag & drop bnav sur desktop ──
(function(){
  var nav = null;
  var dragging = false;
  var ox = 0, oy = 0; // offset souris par rapport au coin du nav

  function initNavDrag(){
    nav = document.getElementById('bnav');
    if(!nav) return;

    nav.addEventListener('mousedown', function(e){
      // Ignorer si clic sur un bouton
      if(e.target.closest('button,a,[onclick]') && e.target !== nav) return;
      if(window.innerWidth < 769) return; // mobile : pas de drag
      dragging = true;
      var rect = nav.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      nav.style.transition = 'none';
      nav.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e){
      if(!dragging || !nav) return;
      var x = e.clientX - ox;
      var y = e.clientY - oy;
      // Garder dans la fenêtre
      var rect = nav.getBoundingClientRect();
      x = Math.max(0, Math.min(window.innerWidth - rect.width, x));
      y = Math.max(0, Math.min(window.innerHeight - rect.height, y));
      nav.style.left = x + 'px';
      nav.style.top = y + 'px';
      nav.style.bottom = 'auto';
      nav.style.transform = 'none';
    });

    document.addEventListener('mouseup', function(){
      if(!dragging || !nav) return;
      dragging = false;
      nav.style.cursor = '';
      nav.style.transition = '';
      // Sauvegarder position
      try{
        localStorage.setItem('cp_nav_pos', JSON.stringify({
          left: nav.style.left,
          top: nav.style.top,
          bottom: nav.style.bottom,
          transform: nav.style.transform
        }));
      }catch(e){}
    });

    // Restaurer position sauvegardée
    try{
      var saved = localStorage.getItem('cp_nav_pos');
      if(saved && window.innerWidth >= 769){
        var pos = JSON.parse(saved);
        if(pos.left) nav.style.left = pos.left;
        if(pos.top) nav.style.top = pos.top;
        if(pos.bottom !== undefined) nav.style.bottom = pos.bottom;
        if(pos.transform !== undefined) nav.style.transform = pos.transform;
      }
    }catch(e){}

    // Curseur grab sur desktop
    if(window.innerWidth >= 769){
      nav.style.cursor = 'grab';
    }
  }

  // Attendre que le DOM soit prêt
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initNavDrag);
  } else {
    setTimeout(initNavDrag, 500);
  }
})();

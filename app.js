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
  if(btn) btn.textContent=obCurrent===obTotal-1?t('ob_commencer'):t('ob_continuer');
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
  applyLangDOM();
  initDarkMode();
  initLargeTitle();
  initSwipeNav();
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

// Prefetch cours dès le chargement du script — endpoint public, pas besoin d'auth
// Le fetch démarre pendant que le JS vérifie la session, économise ~300-500ms
var _prefetchP=fetch(API+'/cours?page=1&limit=12').then(function(r){return r.json();}).catch(function(){return null;});
// Ping warm-up séparé — réveille Railway sans bloquer le prefetch cours
// (ignoré si serveur déjà chaud ; utile après une période d'inactivité)
fetch(API+'/health',{method:'HEAD',cache:'no-store'}).catch(function(){});

// En-têtes API — injecte le token Bearer si l'utilisateur est connecté
function apiH(extra){
  var h=Object.assign({'Content-Type':'application/json'},extra||{});
  if(user&&user.token)h['Authorization']='Bearer '+user.token;
  return h;
}

// ── Refresh token automatique ──────────────────────────────
var _refreshTimer=null;
var _refreshPromise=null; // Promise partagée — évite les appels concurrents avec le même refresh_token
function _scheduleTokenRefresh(){
  if(_refreshTimer){clearTimeout(_refreshTimer);_refreshTimer=null;}
  if(!user||!user.refresh_token||!user.token_exp)return;
  var msLeft=(user.token_exp-Math.floor(Date.now()/1000)-120)*1000; // 2 min avant expiry
  if(msLeft<0)msLeft=0;
  _refreshTimer=setTimeout(_refreshToken,msLeft);
}
function _refreshToken(){
  if(!user||!user.refresh_token)return Promise.resolve();
  // Si un refresh est déjà en cours, tous les appelants attendent le même résultat
  // (le refresh_token Supabase est à usage unique — deux appels simultanés = logout)
  if(_refreshPromise)return _refreshPromise;
  _refreshPromise=(async function(){
    try{
      var r=await fetch(API+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:user.refresh_token})});
      if(!r.ok){
        console.warn('[Auth] refresh échoué: HTTP',r.status);
        if(r.status===400||r.status===401){toast(t('t_session_exp'),t('t_reconnect'));setTimeout(doLogout,2000);}
        return;
      }
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
    finally{_refreshPromise=null;}
  })();
  return _refreshPromise;
}

// Échappement HTML — protège tous les innerHTML contre les injections XSS
function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmtDt(dt){
  if(!dt)return'';
  if(dt.indexOf('T')<0)return dt;
  try{
    var d=new Date(dt);
    if(isNaN(d.getTime()))return dt;
    var _t=typeof t==='function'?t:function(k){return k;};
    var months=[_t('month_0'),_t('month_1'),_t('month_2'),_t('month_3'),_t('month_4'),_t('month_5'),_t('month_6'),_t('month_7'),_t('month_8'),_t('month_9'),_t('month_10'),_t('month_11')];
    var days=[_t('day_0'),_t('day_1'),_t('day_2'),_t('day_3'),_t('day_4'),_t('day_5'),_t('day_6')];
    var h=('0'+d.getHours()).slice(-2),m=('0'+d.getMinutes()).slice(-2);
    var hm=h+'h'+m;
    var now=new Date();
    var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    var dDay=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    var diff=Math.round((dDay-today)/86400000);
    if(diff===0)return'Aujourd\'hui à '+hm;
    if(diff===1)return'Demain à '+hm;
    if(diff>1&&diff<7)return days[d.getDay()]+' à '+hm;
    var dateStr=d.getDate()+' '+months[d.getMonth()];
    if(d.getFullYear()!==now.getFullYear())dateStr+=' '+d.getFullYear();
    return dateStr+' à '+hm;
  }catch(e){return dt;}
}
// Retourne true si le cours est terminé (date passée)
function _isCoursPass(c){
  if(!c||!c.dt)return false;
  try{return new Date(c.dt)<new Date();}catch(e){return false;}
}
// Retourne l'état d'un cours par son ID : 'active', 'past', ou 'deleted'
function getCourseState(id){
  var c=C.find(function(x){return String(x.id)===String(id);});
  if(c)return _isCoursPass(c)?'past':'active';
  if(_histCache&&_histCache[String(id)])return'past';
  return'deleted';
}

// Avatar — affiche une photo ou un rond avec initiales (évite la duplication)
function setAvatar(el,photo,ini,col){
  if(!el)return;
  var _col=col||'linear-gradient(135deg,#FF8C55,var(--ord))';
  var _ini=ini||'?';
  if(photo){
    var _ex=el.querySelector('img');
    if(_ex&&_ex.src===photo){return;} // même URL déjà affichée → pas de re-flash
    el.style.background='none';
    var img=document.createElement('img');
    img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .35s';
    img.onload=function(){this.style.opacity='1';};
    img.onerror=function(){
      var p=this.parentNode;if(!p)return;
      p.removeChild(this);
      p.style.background=_col;p.textContent=_ini;
    };
    img.src=esc(photo);
    el.innerHTML='';el.appendChild(img);
  }else{el.style.background=_col;el.textContent=_ini;}
}

// Badge sera mis à jour après chargement des follows
var C=[],P={},res={},fol=new Set(),favCours=new Set();
var _followInFlight=new Set(); // guard anti-spam follow/unfollow
var _followsInitialized=false; // true dès que fol a été chargé depuis le serveur (n'importe quel chemin)
// Charger les favoris cours depuis localStorage dès le démarrage (APRÈS l'init de favCours)
loadFavCours();
// Pré-charger les réservations depuis localStorage (toujours, pour éviter le flash à 0 dans le profil)
(function(){
  try{
    var _sr=JSON.parse(localStorage.getItem('cp_res')||'[]');
    _sr.forEach(function(id){res[id]=true;});
  }catch(e){}
})();
// Pré-peupler P[] avec les profils mis en cache pour éviter le flash au chargement
// NE PAS mettre _fresh=true ici : _fetchProf doit toujours tourner pour vérifier les données
(function(){
  try{
    var _pc=JSON.parse(localStorage.getItem('cp_profs')||'{}');
    var _now=Date.now();
    Object.keys(_pc).forEach(function(pid){
      var e=_pc[pid];
      if(_now-e.ts<900000){ // 15 min — au-delà, données trop stale
        P[pid]=P[pid]||{n:'—',e:0};
        if(e.nm)P[pid].nm=e.nm;
        if(e.i)P[pid].i=e.i;
        if(e.photo)P[pid].photo=e.photo;
        if(e.e)P[pid].e=e.e;
        // _fresh intentionnellement absent : _fetchProf vérifiera et mettra à jour si besoin
      }
    });
  }catch(ex){}
  // Restaurer les compteurs de suivis (TTL 24h)
  try{
    var _fc=JSON.parse(localStorage.getItem('cp_follow_counts')||'{}');
    var _fcNow=Date.now();
    Object.keys(_fc).forEach(function(pid){
      var entry=_fc[pid];
      var count=typeof entry==='object'?entry.n:entry;
      var ts=typeof entry==='object'?entry.ts:0;
      if(ts&&(_fcNow-ts>86400000))return; // expirer après 24h
      if(count>0){P[pid]=P[pid]||{n:'—',e:0};if(!P[pid].e||P[pid].e<count)P[pid].e=count;}
    });
  }catch(ex){}
})();

// ── FAVORIS COURS — persistance localStorage ──
// Sauvegarder le compteur de suivis d'un prof — clé sans TTL pour persister même après expiration de cp_profs
function _saveFollowCount(pid,n){try{var _fc=JSON.parse(localStorage.getItem('cp_follow_counts')||'{}');_fc[pid]={n:n||0,ts:Date.now()};localStorage.setItem('cp_follow_counts',JSON.stringify(_fc));}catch(ex){}}

function _favKey(){return(user&&user.id)?'cp_fav_cours_'+user.id:'cp_fav_cours';}
function loadFavCours(){
  try{
    var saved=localStorage.getItem(_favKey());
    if(!saved&&user&&user.id)saved=localStorage.getItem('cp_fav_cours');
    if(saved){JSON.parse(saved).forEach(function(id){favCours.add(id);});}
  }catch(e){}
}
function saveFavCours(){
  try{localStorage.setItem(_favKey(),JSON.stringify(Array.from(favCours)));}catch(e){}
  updateFavBadge();
}

// ── Persistance des profils suivis (fol) ──────────────────────────────────
function _folKey(){return(user&&user.id)?'cp_fol_'+user.id:null;}
function _loadFol(){
  try{
    var k=_folKey();if(!k)return;
    var saved=localStorage.getItem(k);
    if(saved){JSON.parse(saved).forEach(function(id){fol.add(id);});}
  }catch(e){}
}
function _saveFol(){
  try{var k=_folKey();if(k)localStorage.setItem(k,JSON.stringify(Array.from(fol)));}catch(e){}
}

function updateFavBadge(){
  var total;
  if(C.length){
    // C[] chargé : ne compter que les cours à venir
    total=Array.from(favCours).filter(function(id){
      var c=C.find(function(x){return String(x.id)===String(id);});
      return c&&!_isCoursPass(c);
    }).length;
  } else {
    // C[] pas encore chargé : masquer le badge (évite les counts stale)
    total=0;
  }
  var badge=g('bnavFavBadge');
  if(!badge)return;
  if(total>0){badge.style.display='flex';badge.textContent=total>9?'9+':String(total);}
  else{badge.style.display='none';}
}
function toggleFavCours(coursId,btn){
  if(!user||user.guest){
    toast(t('t_save_login'),'');
    setTimeout(scrollToLogin,800);
    return;
  }
  var wasSaved=favCours.has(coursId);
  if(wasSaved){
    favCours.delete(coursId);
    toast(t('t_fav_removed'),'');
  } else {
    favCours.add(coursId);
    toast(t('t_fav_saved'),t('t_fav_saved_sub'));
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
  document.querySelectorAll('[data-cours-id="'+coursId+'"] .card-fav-btn').forEach(function(b){
    b.classList.toggle('saved',!wasSaved);
  });
}

// ── SWIPE-TO-DELETE (fav cards) ──
function _initFav2Swipe(card,coursId,wrap){
  var THRESHOLD=90;
  var startX,startY,startTime,curX=0,committed=false,passed=false;
  var action=wrap.querySelector('.fav2-swipe-action');
  function _snapBack(){
    card.style.transition='transform .35s cubic-bezier(.34,1.56,.64,1)';
    card.style.transform='translateX(0)';
    if(action)action.style.opacity='0';
    committed=false;curX=0;
  }
  if(action)action.style.opacity='0';
  // passive:false + preventDefault dès touchstart → iOS ne peut pas démarrer son geste de retour
  // Le tap est géré manuellement dans touchend (onClick ne se déclenche plus avec preventDefault)
  card.addEventListener('touchstart',function(e){
    e.preventDefault();
    var t=e.touches[0];startX=t.clientX;startY=t.clientY;startTime=Date.now();
    curX=0;committed=false;passed=false;
    card.style.transition='none';card.style.transform='translateX(0)';
    if(action)action.style.opacity='0';
    card.classList.add('tapped');
  },{passive:false});
  card.addEventListener('touchmove',function(e){
    e.preventDefault();
    card.classList.remove('tapped');
    var t=e.touches[0];
    var dx=t.clientX-startX,dy=t.clientY-startY;
    if(Math.abs(dy)>Math.abs(dx)+8)return; // clairement vertical, on ignore
    if(Math.abs(dx)>6)committed=true;
    if(!committed)return;
    curX=Math.min(0,dx);
    card.style.transform='translateX('+curX+'px)';
    if(action)action.style.opacity=Math.min(1,Math.abs(curX)/THRESHOLD)+'';
    if(!passed&&curX<=-THRESHOLD){
      passed=true;
      try{if(window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.Haptics)Capacitor.Plugins.Haptics.impact({style:'MEDIUM'});}catch(_){}
    }else if(passed&&curX>-THRESHOLD){passed=false;}
  },{passive:false});
  card.addEventListener('touchend',function(e){
    card.classList.remove('tapped');
    if(!committed){
      // Tap : ouvrir le cours si déplacement minime + durée courte
      var dx2=e.changedTouches&&e.changedTouches[0]?Math.abs(e.changedTouches[0].clientX-startX):99;
      if(dx2<10&&(Date.now()-startTime)<300){haptic(4);openR(coursId);}
      card.style.transform='translateX(0)';
      if(action)action.style.opacity='0';
      return;
    }
    if(curX<=-THRESHOLD){
      card.style.transition='transform .22s cubic-bezier(.4,0,.6,1)';
      card.style.transform='translateX(-110%)';
      setTimeout(function(){
        favCours.delete(coursId);saveFavCours();
        document.querySelectorAll('[data-cours-id="'+coursId+'"] .card-fav-btn').forEach(function(b){b.classList.remove('saved');});
        buildFavPage();
      },210);
    }else{_snapBack();}
  },{passive:true});
  card.addEventListener('touchcancel',function(){card.classList.remove('tapped');_snapBack();},{passive:true});
}

// ── CARD FAVORIS 2-COL masonry (Pinterest) ──
function _buildFavCard2Col(c,idx){
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  var isV=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  var mat=findMatiere(c.subj||'')||{color:'#7C3AED',bg:'var(--orp)'};
  var dt=fmtDt(c.dt_iso||c.dt||'');
  var profNm=c.prof_nm||t('reg_prof');var profIni=(profNm[0]||'?').toUpperCase();
  var profCol=c.prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var profPhoto=c.prof_photo||null;
  var modeBg=isV?'rgba(0,113,227,.1)':'rgba(0,177,79,.1)';
  var modeCo=isV?'#0055B3':'#007A38';
  // Variable height image zone (cycles for masonry rhythm)
  var imgH=[90,120,100][(idx||0)%3];
  // Wrapper (clips swipe animation + carries shadow/border)
  var wrap=document.createElement('div');
  wrap.className='fav2-swipe-wrap';
  // Red action behind the card
  var action=document.createElement('div');
  action.className='fav2-swipe-action';
  action.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  wrap.appendChild(action);
  var div=document.createElement('div');
  div.className='fav2-card';
  div.onclick=function(){openR(c.id);};
  var avInner=profPhoto?('<img src="'+esc(profPhoto)+'" style="width:100%;height:100%;object-fit:cover">')
    :esc(profIni);
  var modeIco=isV
    ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="10" height="10"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="10" height="10"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var modeSolid=isV?'#0071E3':'#00A550';
  div.innerHTML='<div class="fav2-img" style="height:'+imgH+'px;background:linear-gradient(135deg,'+mat.color+'55,'+mat.color+'22);position:relative;overflow:hidden">'
    +'<div style="position:absolute;top:9px;left:9px;right:44px;z-index:2;display:flex;flex-direction:column;align-items:flex-start;gap:5px">'
    +'<span class="fav2-subj" style="background:'+mat.color+';position:static;max-width:100%">'+esc(c.subj||'Cours')+'</span>'
    +'<span style="display:inline-flex;align-items:center;gap:4px;background:#fff;color:'+modeSolid+';font-size:9px;font-weight:700;border-radius:50px;padding:3px 7px 3px 5px;box-shadow:0 1px 4px rgba(0,0,0,.15)">'+modeIco+(isV?'Visio':'Présentiel')+'</span>'
    +'</div>'
    +'<div class="fav2-av-wrap" style="background:'+profCol+'">'+avInner+'</div>'
    +'</div>'
    +'<div class="fav2-body">'
    +'<div class="fav2-title">'+esc(c.title)+'</div>'
    +(dt?'<div class="fav2-sched"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'+esc(dt)+'</div>':'')
    +'<div class="fav2-sep"></div>'
    +'<div class="fav2-foot">'
    +(pp?'<div class="fav2-price">'+pp+'€</div>':'<div class="fav2-price">—</div>')
    +'<div style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--lite)">Voir<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg></div>'
    +'</div>'
    +'</div>';
  wrap.appendChild(div);
  _initFav2Swipe(div,c.id,wrap);
  return wrap;
}

// ── BUILD PAGE FAVORIS ──
function buildFavPage(){
  var favIds=Array.from(favCours);
  var hasAny=favIds.length;

  var emptyAll=g('favEmptyAll');
  var coursSection=g('favCoursSection');
  if(!hasAny){
    if(emptyAll){emptyAll.style.display='flex';emptyAll.style.flexDirection='column';emptyAll.style.alignItems='center';emptyAll.style.justifyContent='center';emptyAll.style.minHeight='60vh';}
    if(coursSection)coursSection.style.display='none';
    return;
  }
  if(emptyAll)emptyAll.style.display='none';

  // ── Grille compacte 2 colonnes ──
  var carousel=g('favCoursCarousel');
  if(carousel){
    if(!favIds.length){
      if(coursSection)coursSection.style.display='none';
    } else {
      if(coursSection)coursSection.style.display='block';
      var _favActive=favIds.filter(function(id){
        var c=C.find(function(x){return x.id==id;});
        return!c||!_isCoursPass(c);
      });
      if(!_favActive.length&&C.length){
        if(coursSection)coursSection.style.display='none';
        if(emptyAll){emptyAll.style.display='flex';emptyAll.style.flexDirection='column';emptyAll.style.alignItems='center';emptyAll.style.justifyContent='center';emptyAll.style.minHeight='60vh';}
        return;
      }
      carousel.innerHTML='';
      // Masonry: two columns, right column offset by 20px
      var colL=document.createElement('div');colL.className='fav2-col';
      var colR=document.createElement('div');colR.className='fav2-col';colR.style.marginTop='20px';
      var _cardIdx=0;
      _favActive.forEach(function(id){
        var c=C.find(function(x){return x.id==id;});
        var el;
        if(!c){
          if(!C.length){
            el=document.createElement('div');el.className='fav2-card';el.style.cssText='min-height:120px;background:var(--bdr);animation:shimmer 1.4s infinite;background-size:200% 100%';
          } else {
            var _state=getCourseState(id);
            el=document.createElement('div');
            el.className='fav2-swipe-wrap';
            el.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px 12px;text-align:center;border:1.5px dashed var(--bdr);min-height:120px;border-radius:18px;';
            el.innerHTML='<div style="font-size:11px;font-weight:600;color:var(--lite)">'+(_state==='past'?t('fav_cours_termine'):t('fav_cours_supprime'))+'</div>'
              +'<button onclick="event.stopPropagation();favCours.delete(\''+id+'\');saveFavCours();buildFavPage();" style="background:var(--orp);color:var(--or);border:none;border-radius:50px;padding:4px 10px;font-family:inherit;font-size:10px;font-weight:600;cursor:pointer;margin-top:4px">'+t('fav_retirer')+'</button>';
          }
        } else {
          el=_buildFavCard2Col(c,_cardIdx);
        }
        (_cardIdx%2===0?colL:colR).appendChild(el);
        _cardIdx++;
      });
      carousel.appendChild(colL);
      carousel.appendChild(colR);
    }
  }

}

// ── BUILD PAGE MES PROFS ──
var _mpfAutoSwitchEspace=false;

function _getEnrolledProfs(){
  try{return JSON.parse(localStorage.getItem('cp_enrolled_profs')||'[]');}catch(e){return[];}
}
function _saveEnrolledProf(pid,profData){
  try{
    var list=_getEnrolledProfs();
    if(!list.find(function(p){return p.id===pid;})){
      list.push({id:pid,nm:profData.nm||'',ini:profData.ini||'?',col:profData.col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:profData.photo||null});
      localStorage.setItem('cp_enrolled_profs',JSON.stringify(list));
    }
  }catch(e){}
}
function _removeEnrolledProf(pid){
  try{
    var list=_getEnrolledProfs().filter(function(p){return p.id!==String(pid);});
    localStorage.setItem('cp_enrolled_profs',JSON.stringify(list));
  }catch(e){}
}
function _confirmUnenroll(pid){
  var ep=_getEnrolledProfs().find(function(p){return p.id===String(pid);});
  var nm=(ep&&ep.nm)||(P[pid]&&P[pid].nm)||'ce professeur';
  showQuickSheet(
    '<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:20px 20px 8px;text-align:center">'
    +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em">Se désinscrire ?</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6">Tu vas quitter l\'espace de <strong style="color:var(--ink)">'+esc(nm)+'</strong>. Tu perdras l\'accès à son contenu privé.</div>'
    +'</div>'
    +'<div style="padding:8px 20px max(20px,calc(env(safe-area-inset-bottom,0px) + 16px));display:flex;flex-direction:column;gap:10px">'
    +'<button onclick="_doUnenrollProf(\''+String(pid)+'\')" style="width:100%;background:#EF4444;color:#fff;border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer">Se désinscrire</button>'
    +'<button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Annuler</button>'
    +'</div>'
  );
}
function _doUnenrollProf(pid){
  closeQuickSheet();
  _removeEnrolledProf(String(pid));
  haptic(6);
  toast('Désinscription effectuée','');
  buildMesProfs();
}
function _initProfCardSwipe(cardEl,type,pid){
  var sx=0,sy=0,swiping=false,acted=false;
  var indicator=cardEl.previousElementSibling;// red zone sibling before card
  cardEl.addEventListener('touchstart',function(e){
    if(acted)return;
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;swiping=false;
  },{passive:true});
  cardEl.addEventListener('touchmove',function(e){
    if(acted)return;
    var dx=e.touches[0].clientX-sx;
    var dy=Math.abs(e.touches[0].clientY-sy);
    if(!swiping&&Math.abs(dx)>8&&Math.abs(dx)>dy)swiping=true;
    if(swiping&&dx<0){
      e.preventDefault();
      var t=Math.max(dx,-88);
      cardEl.style.transform='translateX('+t+'px)';
      cardEl.style.transition='none';
      // reveal indicator proportionally
      if(indicator){var ratio=Math.min(Math.abs(t)/88,1);indicator.style.opacity=String(ratio);}
    }
  },{passive:false});
  cardEl.addEventListener('touchend',function(e){
    if(acted||!swiping)return;
    var dx=e.changedTouches[0].clientX-sx;
    swiping=false;
    if(dx<-60){
      if(type==='enrolled'){
        cardEl.style.transform='';cardEl.style.transition='transform .2s';
        if(indicator){indicator.style.opacity='0';}
        _confirmUnenroll(pid);
      }else{
        acted=true;
        cardEl.style.transform='translateX(-110%)';cardEl.style.transition='transform .25s ease';cardEl.style.opacity='0';
        setTimeout(function(){unfollowProf(pid);buildMesProfs();},260);
      }
    }else{
      cardEl.style.transform='';cardEl.style.transition='transform .2s';
      if(indicator){indicator.style.opacity='0';indicator.style.transition='opacity .2s';}
    }
  },{passive:true});
}

function buildMesProfs(){
  var empty=g('mesProfsEmpty');
  var carousel=g('mesProfsCarousel');
  // Combiner inscrits (code) + suivis
  var enrolledProfs=_getEnrolledProfs();
  var enrolledIds=enrolledProfs.map(function(p){return p.id;});
  var folIds=Array.from(fol).filter(function(id){return!enrolledIds.includes(id);});
  var hasAny=enrolledProfs.length||folIds.length;
  if(!hasAny){
    if(empty){empty.style.display='flex';empty.style.flexDirection='column';empty.style.alignItems='center';empty.style.justifyContent='center';}
    if(carousel)carousel.innerHTML='';
    checkMesProfsTuto();
    return;
  }
  if(empty)empty.style.display='none';
  if(!carousel)return;
  var _STATUT_LBL={'etudiant':'Étudiant(e)','prof_ecole':'Professeur des écoles','prof_college':'Professeur collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Autre'};
  var _trashSvg='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  var _delZone='<div style="position:absolute;right:0;top:0;bottom:0;width:88px;background:#FF3B30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:0 20px 20px 0;opacity:0;pointer-events:none">'+_trashSvg+'<span style="font-size:10px;font-weight:700;color:#fff;letter-spacing:.01em">Retirer</span></div>';
  function _profCardWrap(cardHtml){
    // Couche externe : ombre (pas overflow:hidden pour ne pas clipper l'ombre)
    // Couche interne : overflow:hidden pour clipper la zone rouge
    return '<div style="margin:0 16px 10px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.07)">'
      +'<div style="position:relative;overflow:hidden;border-radius:20px">'+_delZone+cardHtml+'</div>'
      +'</div>';
  }
  var html='';
  // Section : inscrits via code
  if(enrolledProfs.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;padding:16px 20px 8px">Espaces rejoints</div>';
    enrolledProfs.forEach(function(ep){
      var p=P[ep.id]||{};
      var nm=p.nm||ep.nm||'Professeur';
      var ini=(p.i||ep.ini||nm[0]||'?').toUpperCase();
      var col=p.col||ep.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
      var photo=p.photo||ep.photo||null;
      var av=photo?'<img src="'+esc(photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=\'1\'">':ini;
      var avBg=photo?'none':col;
      var statut=_STATUT_LBL[p.statut]||null;
      var subLine='<span style="color:var(--or);font-weight:600">Espace inscrit</span>'+(statut?'<span style="color:var(--lite)"> · '+esc(statut)+'</span>':'');
      var card='<div onclick="openProfEspace(\''+ep.id+'\')" class="cp-prof-card" data-pid="'+ep.id+'" data-type="enrolled" style="background:var(--wh);border-radius:20px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:14px;-webkit-tap-highlight-color:transparent">'
        +'<div style="width:50px;height:50px;border-radius:50%;flex-shrink:0;background:'+avBg+';display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;overflow:hidden">'+av+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:15px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(nm)+'</div>'
        +'<div style="font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+subLine+'</div>'
        +'</div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
      html+=_profCardWrap(card);
      _fetchProf(ep.id);
    });
  }
  // Section : suivis (sans espace)
  if(folIds.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;padding:16px 20px 8px">Suivis</div>';
    folIds.forEach(function(pid){
      var p=P[pid]||{};
      var cours=C.filter(function(x){return x.pr===pid;});
      if(cours.length&&!p.nm){p={nm:cours[0].prof_nm||'Professeur',i:cours[0].prof_ini||'?',col:cours[0].prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:cours[0].prof_photo||null};P[pid]=p;}
      var fresh=p._fresh===true;
      var col=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
      var ini=(p.i||(p.nm?p.nm[0]:'?')||'?').toUpperCase();
      var av=(fresh&&p.photo)?'<img src="'+esc(p.photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=\'1\'">':ini;
      var avBg=(fresh&&p.photo)?'none':col;
      var statut=fresh?(_STATUT_LBL[p.statut]||p.rl||'Professeur'):'';
      var card='<div onclick="openPrFull(\''+pid+'\')" class="cp-prof-card" data-pid="'+pid+'" data-type="followed" style="background:var(--wh);border-radius:20px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:14px;-webkit-tap-highlight-color:transparent">'
        +'<div style="width:50px;height:50px;border-radius:50%;flex-shrink:0;background:'+avBg+';display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;overflow:hidden">'+av+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:15px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(fresh?esc(p.nm||'Professeur'):'<span class="skeleton" style="display:inline-block;height:14px;width:110px;border-radius:4px"></span>')+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:3px">'+(fresh?esc(statut):'<span class="skeleton" style="display:inline-block;height:11px;width:70px;border-radius:4px"></span>')+'</div>'
        +'</div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
      html+=_profCardWrap(card);
      _fetchProf(pid);
    });
  }
  carousel.innerHTML=html;
  carousel.querySelectorAll('.cp-prof-card[data-type]').forEach(function(card){
    _initProfCardSwipe(card,card.dataset.type,card.dataset.pid);
  });
}

function openProfEspace(pid){
  _mpfAutoSwitchEspace=true;
  openPrFull(pid);
}

var _eleveEspPid=null;

function openEspaceEleve(pid){
  _eleveEspPid=pid;
  haptic(4);
  // Reset cards
  ['eleveCard1','eleveCard2','eleveCard3'].forEach(function(id){var c=g(id);if(c)c.classList.remove('open');});
  // Prof header
  var p=P[pid]||{};
  var nm=p.nm||'Professeur';
  var ini=(p.i||nm[0]||'?').toUpperCase();
  var col=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var photo=p.photo||null;
  var avHtml=photo?'<img src="'+esc(photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':ini;
  var avBg=photo?'none':col;
  var nmEl=g('eleveEspNm');if(nmEl)nmEl.textContent=nm;
  var hdEl=g('eleveEspProfHd');
  if(hdEl){
    hdEl.innerHTML='<div style="width:52px;height:52px;border-radius:50%;background:'+avBg+';display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;overflow:hidden;flex-shrink:0">'+avHtml+'</div>'
      +'<div><div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.02em">'+esc(nm)+'</div>'
      +'<div style="font-size:13px;color:var(--or);font-weight:600;margin-top:2px">Espace inscrit</div></div>';
  }
  // Show page
  var bd=g('bdEspaceEleve');if(bd){bd.style.display='flex';}
  _fetchProf(pid);
}

function closeEspaceEleve(){
  var bd=g('bdEspaceEleve');
  if(bd){bd.style.opacity='0';bd.style.transition='opacity .2s';setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},200);}
}

function toggleEleveCard(id,section){
  var card=g(id);if(!card)return;
  var opening=!card.classList.contains('open');
  card.classList.toggle('open',opening);
  haptic(4);
  var pid=_eleveEspPid;if(!pid)return;
  if(opening){
    if(section==='cours')_loadEleveEspCours(pid);
    if(section==='pubs')_loadEleveEspPubs(pid);
    if(section==='fiches')_loadEleveEspFiches(pid);
  }
}

function _loadEleveEspCours(pid){
  var el=g('eleveEspCours');if(!el)return;
  var cours=C.filter(function(c){return c.pr===pid&&!_isCoursPass(c)&&c.fl<c.sp;});
  if(!cours.length){el.innerHTML='<div style="text-align:center;padding:20px 0;color:var(--lite);font-size:13px">Aucun cours disponible pour le moment</div>';return;}
  el.innerHTML=cours.map(function(c){
    var mat=findMatiere(c.subj||'')||{color:'var(--or)',bg:'var(--orp)'};
    var isV=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
    var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
    var spots=c.sp-c.fl;
    var spotsHtml=spots<=3&&spots>0?'<span style="font-size:10px;font-weight:700;background:#FFF0E8;color:#E04E10;border-radius:50px;padding:2px 7px">'+spots+' place'+(spots>1?'s':'')+' restante'+(spots>1?'s':'')+'</span>':'';
    return'<div onclick="closeEspaceEleve();setTimeout(function(){openR(\''+escH(c.id)+'\');},250);"'
      +' style="background:var(--wh);border-radius:16px;padding:14px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.07);border:1px solid rgba(0,0,0,.04);cursor:pointer;-webkit-tap-highlight-color:transparent">'
      +'<div style="display:flex;align-items:flex-start;gap:12px">'
      +'<div style="width:44px;height:44px;border-radius:14px;background:'+mat.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'
      +'<div style="width:10px;height:10px;border-radius:50%;background:'+mat.color+'"></div></div>'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">'+esc(c.title)+'</div>'
      +'<div style="font-size:12px;color:var(--mid);margin-bottom:6px">'+esc(c.dt)+'</div>'
      +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
      +'<span style="font-size:10px;font-weight:700;background:'+(isV?'rgba(0,113,227,.1)':'rgba(0,177,79,.1)')+';color:'+(isV?'#0055B3':'#007A38')+';border-radius:50px;padding:3px 8px">'+(isV?'Visio':'Présentiel')+'</span>'
      +spotsHtml
      +'</div></div>'
      +'<div style="font-size:17px;font-weight:800;color:var(--or);flex-shrink:0;padding-top:2px">'+pp+'€</div>'
      +'</div></div>';
  }).join('');
}

function _loadEleveEspPubs(pid){
  var el=g('eleveEspPubs');if(!el)return;
  var p=P[pid]||{};
  var profNm=p.nm||'Prof';
  var profIni=(profNm[0]||'?').toUpperCase();
  var profCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var profPhoto=p.photo||null;
  var avInner=profPhoto?'<img src="'+esc(profPhoto)+'" alt="">':'<span>'+profIni+'</span>';
  el.innerHTML='<div class="skeleton" style="height:70px;border-radius:12px;margin-bottom:8px"></div>';
  var ONE_WEEK=7*24*60*60*1000;
  fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    if(_eleveEspPid!==pid)return;
    var pubs=(list||[]).filter(function(a){return a.type!=='fiche'&&(Date.now()-new Date(a.created_at))<ONE_WEEK;});
    if(!pubs.length){el.innerHTML='<div style="text-align:center;padding:20px 0;color:var(--lite);font-size:13px">Aucune publication récente</div>';return;}
    var lastDay='';
    el.innerHTML=pubs.map(function(a){
      var d=new Date(a.created_at);var dayKey=d.toISOString().slice(0,10);
      var sep=dayKey!==lastDay?'<div class="ann-day-sep">'+_annDayLabel(d)+'</div>':'';lastDay=dayKey;
      var time=_annTimeStr(a.created_at);
      var hd='<div class="forum-post-hd"><div class="forum-post-av" style="background:'+profCol+'">'+avInner+'</div>'
        +'<div><div class="forum-post-nm">'+esc(profNm)+'</div><div class="forum-post-date">'+time+'</div></div></div>';
      if(a.type==='poll'){
        var poll;try{poll=JSON.parse(a.content);}catch(e){poll=null;}
        if(!poll)return sep;
        return sep+'<div class="forum-post" style="margin-bottom:8px">'+hd
          +'<div style="padding:0 0 4px">'+_renderPollHtml(poll,a.id,true,pid)+'</div></div>';
      }
      var body=a.content&&a.content.trim().startsWith('<')?a.content:'<p>'+esc(a.content)+'</p>';
      return sep+'<div class="forum-post" style="margin-bottom:8px">'+hd+'<div class="forum-post-body">'+body+'</div></div>';
    }).join('');
  }).catch(function(){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:8px 0">Erreur de chargement</div>';});
}

function _loadEleveEspFiches(pid){
  var el=g('eleveEspFiches');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:50px;border-radius:12px;margin-bottom:8px"></div>';
  fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    if(_eleveEspPid!==pid)return;
    var _fIds;try{_fIds=new Set(JSON.parse(localStorage.getItem('cp_fiche_ids')||'[]'));}catch(e){_fIds=new Set();}
    var fiches=(list||[]).filter(function(a){return a.type==='fiche'||_fIds.has(String(a.id));});
    if(!fiches.length){el.innerHTML='<div style="text-align:center;padding:20px 0;color:var(--lite);font-size:13px">Aucune fiche disponible</div>';return;}
    el.innerHTML=fiches.map(function(f){
      var titre=f.title||'Fiche de cours';
      return'<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.05);cursor:pointer;-webkit-tap-highlight-color:transparent" onclick="espOpenFicheEleve(\''+pid+'\',\''+escH(f.id)+'\')">'
        +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(34,192,105,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
        +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(titre)+'</div></div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
    }).join('');
  }).catch(function(){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:8px 0">Erreur de chargement</div>';});
}

function espOpenFicheEleve(pid,id){
  haptic(4);
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:28px 28px 0 0;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;animation:mi .28s cubic-bezier(.32,1,.6,1)';
  sheet.innerHTML='<div style="padding:12px 16px 0;text-align:center"><div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;display:inline-block"></div></div>'
    +'<div style="padding:16px 20px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(0,0,0,.06);flex-shrink:0">'
    +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(34,192,105,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
    +'<div id="_ficheELTitle" style="flex:1;font-size:16px;font-weight:800;color:var(--ink)">Chargement\u2026</div>'
    +'<button onclick="this.closest(\'[style*=inset:0]\').remove()" style="width:32px;height:32px;border-radius:50%;background:var(--bg);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'</div>'
    +'<div id="_ficheELBody" style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch"><div style="display:flex;justify-content:center;padding:40px"><div class="cp-loader"></div></div></div>'
    +'<div style="padding:12px 16px;padding-bottom:max(16px,env(safe-area-inset-bottom,0px));flex-shrink:0"></div>';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  bd.appendChild(sheet);document.body.appendChild(bd);
  fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    var f=(list||[]).find(function(a){return String(a.id)===String(id);});
    var titleEl=document.getElementById('_ficheELTitle');
    var bodyEl=document.getElementById('_ficheELBody');
    if(!f){if(bodyEl)bodyEl.innerHTML='<div style="text-align:center;padding:32px;color:var(--lite)">Fiche introuvable</div>';return;}
    if(titleEl)titleEl.textContent=f.title||'Fiche de cours';
    if(bodyEl)bodyEl.innerHTML=f.content||'<div style="text-align:center;padding:32px;color:var(--lite)">Fiche vide</div>';
  }).catch(function(){var bodyEl=document.getElementById('_ficheELBody');if(bodyEl)bodyEl.innerHTML='<div style="text-align:center;padding:32px;color:var(--lite)">Erreur</div>';});
}

var _enrollBd=null;

function openEnrollSheet(){
  haptic(4);
  if(_enrollBd){if(_enrollBd._cleanupKb)_enrollBd._cleanupKb();_enrollBd.remove();_enrollBd=null;}
  var isDk=document.documentElement.classList.contains('dk');
  var cardBg=isDk?'#1C1C1E':'#ffffff';
  var cardShadow=isDk?'0 3px 16px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.07)':'0 3px 14px rgba(0,0,0,.11),0 0 0 .5px rgba(0,0,0,.06)';
  var inpColor=isDk?'#ffffff':'#111111';
  // Placeholder très clair pour bien distinguer texte saisi vs placeholder
  var phColor=isDk?'#48484A':'#C7C7CC';
  var bd=document.createElement('div');
  _enrollBd=bd;
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.52);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg);border-radius:28px 28px 0 0;width:100%;max-width:480px;padding:20px 20px;padding-bottom:max(36px,env(safe-area-inset-bottom,36px));animation:mi .28s cubic-bezier(.32,1,.6,1);box-sizing:border-box';
  sheet.innerHTML=
    '<style>#_enrollCodeInp::placeholder{color:'+phColor+' !important;-webkit-text-fill-color:'+phColor+' !important;opacity:1;letter-spacing:.04em;font-family:inherit;font-size:16px;font-weight:400;text-transform:none;}</style>'
    +'<div style="text-align:center;margin-bottom:20px"><div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;display:inline-block"></div></div>'
    +'<div style="font-size:19px;font-weight:800;color:var(--ink);letter-spacing:-.03em;margin-bottom:4px">Rejoindre un espace</div>'
    +'<div style="font-size:13px;color:var(--lite);margin-bottom:22px">Entre le code partagé par ton professeur</div>'
    // Carte code — style ss-card, clean et premium
    +'<div style="background:'+cardBg+';border-radius:20px;box-shadow:'+cardShadow+';display:flex;align-items:center;padding:17px 18px;margin-bottom:10px;box-sizing:border-box">'
      +'<input id="_enrollCodeInp" type="text" placeholder="Code d\'accès" maxlength="12" enterkeyhint="go" autocomplete="off" spellcheck="false" oninput="this.value=this.value.toUpperCase()" style="flex:1;border:none;outline:none;background:transparent;-webkit-appearance:none;font-family:\'SF Mono\',Menlo,Monaco,Courier,monospace;font-size:18px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:'+inpColor+';-webkit-text-fill-color:'+inpColor+';padding:0;margin:0;min-width:0;height:auto;caret-color:var(--or)">'
    +'</div>'
    +'<div id="_enrollErr" style="display:none;font-size:12px;color:#EF4444;line-height:1.5;padding:0 4px;margin-bottom:8px"></div>'
    +'<button id="_enrollBtn" onclick="submitEnrollSheet()" style="width:100%;background:var(--or);color:#fff;border:none;border-radius:16px;padding:15px;font-family:inherit;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.28);margin-top:4px">Rejoindre</button>'
    +'<button onclick="if(_enrollBd){if(_enrollBd._cleanupKb)_enrollBd._cleanupKb();_enrollBd.remove();_enrollBd=null;}" style="width:100%;background:none;border:none;color:var(--lite);font-family:inherit;font-size:14px;cursor:pointer;padding:12px;margin-top:2px">Annuler</button>';
  bd.appendChild(sheet);document.body.appendChild(bd);
  bd.onclick=function(e){if(e.target===bd){if(bd._cleanupKb)bd._cleanupKb();bd.remove();_enrollBd=null;}};
  var codeInp=document.getElementById('_enrollCodeInp');
  if(codeInp){
    codeInp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();submitEnrollSheet();}});
  }
  setTimeout(function(){if(codeInp)codeInp.focus();},320);
  var _ekbShow=function(e){
    var h=(e&&e.keyboardHeight)||0;
    if(h>0){sheet.style.paddingBottom=(h+16)+'px';sheet.style.transition='padding-bottom .22s ease';}
  };
  var _ekbHide=function(){
    sheet.style.paddingBottom='max(32px,env(safe-area-inset-bottom,32px))';
    sheet.style.transition='padding-bottom .18s ease';
  };
  window.addEventListener('keyboardWillShow',_ekbShow);
  window.addEventListener('keyboardWillHide',_ekbHide);
  bd._cleanupKb=function(){window.removeEventListener('keyboardWillShow',_ekbShow);window.removeEventListener('keyboardWillHide',_ekbHide);};
}

function submitEnrollSheet(){
  var inp=document.getElementById('_enrollCodeInp');
  var errEl=document.getElementById('_enrollErr');
  var btn=document.getElementById('_enrollBtn');
  var code=(inp?inp.value.trim().toUpperCase():'');
  if(!code){if(errEl){errEl.textContent='Veuillez entrer un code.';errEl.style.display='block';}return;}
  if(!user||user.guest){toast('Connecte-toi d\'abord','');return;}
  if(btn)btn.disabled=true;
  if(errEl)errEl.style.display='none';
  function _safeJson(r){try{return r.json();}catch(e){return Promise.resolve(null);}}
  function _onOk(d){
    if(btn)btn.disabled=false;
    var pid=d&&(d.teacher_id||d.professeur_id||d.id)||null;
    if(pid){
      var p=P[pid]||{};
      _saveEnrolledProf(String(pid),{nm:d.prof_nm||d.teacher_name||p.nm||'',ini:d.prof_ini||p.i||'?',col:d.prof_col||p.col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:d.prof_photo||p.photo||null});
      if(!P[pid])P[pid]={};
      if(d.prof_nm||d.teacher_name)P[pid].nm=d.prof_nm||d.teacher_name;
    }
    haptic(4);toast('Espace rejoint !','');
    if(_enrollBd){_enrollBd.remove();_enrollBd=null;}
    buildMesProfs();
    if(pid)setTimeout(function(){openProfEspace(String(pid));},300);
  }
  function _onErr(msg){
    // Fallback : tenter d'ouvrir le cours privé avec ce code (code_acces de cours)
    if(btn)btn.disabled=false;
    fetch(API+'/cours/code/'+code).then(function(r){return r.json();}).then(function(data){
      if(data&&data.id){
        // C'est un code de cours privé
        if(_enrollBd){if(_enrollBd._cleanupKb)_enrollBd._cleanupKb();_enrollBd.remove();_enrollBd=null;}
        var nc={id:data.id,t:((data.titre||'')+' '+(data.sujet||'')).toLowerCase(),
          subj:data.sujet||'Autre',sc:data.couleur_sujet||'#7C3AED',
          bg:data.background||'linear-gradient(135deg,#F5F3FF,#DDD6FE)',bgDark:data.bg_dark||'',
          title:data.titre||'',dt:data.date_heure||'',dt_iso:data.date_iso||'',lc:data.lieu||'',
          mode:data.mode||'presentiel',visio_url:data.visio_url||'',
          tot:data.prix_total||0,sp:data.places_max||5,fl:data.places_prises||0,
          pr:data.professeur_id,prof_ini:data.prof_initiales||'?',
          prof_col:data.prof_couleur||'linear-gradient(135deg,#FF8C55,#E04E10)',
          prof_nm:data.prof_nom||'',prof_photo:data.prof_photo||null,
          description:data.description||'',code:data.code_acces||'',prive:true};
        if(!C.find(function(x){return x.id==nc.id;}))C.unshift(nc);
        openR(nc.id);
        toast('Cours trouvé !',nc.title);
      } else {
        if(errEl){errEl.textContent=msg||'Code incorrect ou expiré.';errEl.style.display='block';}
      }
    }).catch(function(){if(errEl){errEl.textContent=msg||'Code incorrect ou expiré.';errEl.style.display='block';}});
  }
  fetch(API+'/teacher/enroll',{method:'POST',headers:apiH(),body:JSON.stringify({code:code})})
    .then(function(r){var ok=r.ok;return _safeJson(r).then(function(d){return{ok:ok,d:d||{}};});})
    .then(function(res){
      if(res.ok&&res.d&&res.d.success){_onOk(res.d);return;}
      _onErr((res.d&&(res.d.error||res.d.message))||'Code incorrect ou expiré.');
    }).catch(function(){_onErr('Code incorrect ou expiré.');});
}

// ── TUTO ÉLÈVE (Mes Profs) ──────────────────────────────────────────────────
var _mptStep=0;
var _mptSteps=[
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    bg:'rgba(255,107,43,.08)',
    title:'Bienvenue dans Mes Profs !',
    sub:'Retrouve ici les profs dont tu as rejoint l\'espace privé, et ceux que tu suis depuis l\'explorateur.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    bg:'rgba(99,102,241,.08)',
    title:'Suis un prof',
    sub:'Depuis l\'explorateur, ouvre le profil d\'un prof et appuie sur "Suivre". Il apparaît ici dans "Suivis" pour ne rater aucun de ses prochains cours.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>',
    bg:'rgba(255,107,43,.08)',
    title:'Rejoins l\'espace d\'un prof',
    sub:'Appuie sur "+ Rejoindre" et entre le code fourni par ton prof. Il apparaît dans "Espaces rejoints" : tu accèdes alors à ses cours, fiches et annonces privées.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>',
    bg:'rgba(99,102,241,.08)',
    title:'Cours à venir',
    sub:'Accède aux prochains cours de ton prof, réserve ta place et rejoins les sessions visio directement depuis l\'app.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
    bg:'rgba(34,192,105,.08)',
    title:'Fiches & Publications',
    sub:'Consulte les fiches de cours et les annonces publiées par ton professeur, accessibles depuis son espace.'
  }
];

function checkMesProfsTuto(){
  try{if(localStorage.getItem('cp_profs_tuto'))return;}catch(e){}
  openMesProfsTuto();
}

function openMesProfsTuto(){
  _mptStep=0;
  var bd=g('bdMesProfsTuto');if(!bd)return;
  _mptRender();
  bd.style.display='flex';
  var nav=g('bnav');if(nav)nav.style.display='none';
  var sheet=g('mptSheet');if(sheet)_mptInitSwipe(sheet);
  haptic(4);
}

function _mptRender(){
  var s=_mptSteps[_mptStep];if(!s)return;
  var track=g('mptTrack');var dots=g('mptDots');var skipBtn=g('mptSkipBtn');
  var isLast=_mptStep===_mptSteps.length-1;
  if(track){track.innerHTML='<div style="text-align:center;padding:28px 0 20px">'
    +'<div style="width:96px;height:96px;border-radius:50%;background:'+s.bg+';display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 28px rgba(255,107,43,.15)">'+s.svg+'</div>'
    +'<div style="font-size:20px;font-weight:800;color:var(--ink);margin-bottom:10px;letter-spacing:-.03em;line-height:1.25">'+s.title+'</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.7">'+s.sub+'</div>'
    +'</div>';}
  if(dots){dots.innerHTML=_mptSteps.map(function(_,i){return'<div onclick="mptGoTo('+i+')" style="width:'+(i===_mptStep?'20':'8')+'px;height:8px;border-radius:4px;background:'+(i===_mptStep?'var(--or)':'var(--bdr)')+';transition:all .25s;cursor:pointer"></div>';}).join('');}
  if(skipBtn)skipBtn.textContent=isLast?'Terminer':'Passer';
}

function _mptInitSwipe(sheet){
  if(!sheet||sheet._mptSwipe)return;sheet._mptSwipe=true;
  var sx=0,sy=0;
  sheet.addEventListener('touchstart',function(e){e.stopPropagation();sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  sheet.addEventListener('touchmove',function(e){e.stopPropagation();},{passive:true});
  sheet.addEventListener('touchend',function(e){
    e.stopPropagation();
    var dx=e.changedTouches[0].clientX-sx;var dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){if(dx<0)mptNext();else if(_mptStep>0){_mptStep--;_mptRender();}}
  },{passive:true});
}

function mptGoTo(i){_mptStep=i;haptic(4);_mptRender();}
function mptPrev(){if(_mptStep>0){_mptStep--;haptic(4);_mptRender();}}
function mptNext(){haptic(4);if(_mptStep<_mptSteps.length-1){_mptStep++;_mptRender();}else{mptDone();}}
function mptSkip(){mptDone();}
function mptDone(){
  try{localStorage.setItem('cp_profs_tuto','1');}catch(e){}
  var bd=g('bdMesProfsTuto');
  if(bd){bd.style.opacity='0';bd.style.transition='opacity .2s';setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},200);}
  var nav=g('bnav');if(nav)nav.style.display='';
}

function unfollowProf(pid){
  fol.delete(pid);_saveFol();
  _syncFollowBtns(pid,false);
  if(user&&user.id){
    fetch(API+'/follows',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})}).catch(function(){});
  }
  toast(t('t_prof_removed'),'');
  haptic(4);
  updateFavBadge();
}
var curId=null,curProf=null,folPr=null,actF='tous',user=null;
var _mesViewMode='liste';
var _calWeekOffset=0;
var _calSelDay=null;
var _mesSeg='upcoming';
var geoMode=false,userCoords=null,_geoActive=false,_geoCoords=null,_geoDist=10;
var PAGE_SIZE=6,currentPage=1,filteredCards=[];
var msgBadgePollTimer=null;
var _searchTimer=null;
var _autoRefreshTimer=null;
var _accountCheckTimer=null;

function _cSnapshot(){return C.map(function(c){return c.id+':'+c.fl+':'+c.tot;}).join('|');}
function _startAutoRefresh(){
  _stopAutoRefresh();
  _autoRefreshTimer=setInterval(function(){
    if(document.hidden)return;
    if(!user||user.guest)return;
    var _before=_cSnapshot();
    loadData(1,true).then(function(){
      // Ne re-rendre que si les données ont réellement changé
      if(_cSnapshot()!==_before)applyFilter();
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

// ── Cache cours (stale-while-revalidate) ──────────────────────────────────
var _COURS_CACHE_KEY='cp_cours_v1';
var _COURS_CACHE_TTL=5*60*1000; // 5 minutes
function _saveCoursCache(){
  try{localStorage.setItem(_COURS_CACHE_KEY,JSON.stringify({ts:Date.now(),data:C}));}catch(e){}
}
function _loadCoursCache(){
  // Retourne true si un cache valide a été chargé dans C[] et affiché
  try{
    var raw=localStorage.getItem(_COURS_CACHE_KEY);
    if(!raw)return false;
    var parsed=JSON.parse(raw);
    if(!parsed||!Array.isArray(parsed.data)||!parsed.data.length)return false;
    if(Date.now()-parsed.ts>_COURS_CACHE_TTL)return false; // expiré
    C=parsed.data;
    return true;
  }catch(e){return false;}
}

async function loadData(page,silent){
  page=page||1;
  if(page===1&&!silent)showSkeletonsV2();
  try{
    // Page 1 : utiliser le prefetch déjà en vol si disponible (évite un aller-retour réseau)
    var json;
    if(page===1&&_prefetchP){
      json=await _prefetchP;
      _prefetchP=null; // consommer une seule fois
      if(!json)json=await fetch(API+'/cours?page=1&limit=12').then(function(r){return r.json();});
    } else {
      var _ldCtrl=new AbortController();var _ldTid=setTimeout(function(){_ldCtrl.abort();},15000);
      json=await fetch(API+'/cours?page='+page+'&limit=12',{signal:_ldCtrl.signal}).then(function(r){clearTimeout(_ldTid);return r.json();});
    }
    // Support ancien format (array) et nouveau (objet paginé)
    var cours=Array.isArray(json)?json:(json.cours||[]);
    _totalCours=json.total||cours.length;
    _allLoaded=cours.length<12||(_currentPage*12)>=_totalCours;
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
        title:c.titre||'',dt:c.date_heure||'',dt_iso:c.date_iso||'',lc:c.lieu||'',mode:c.mode||'presentiel',visio_url:c.visio_url||'',code:c.code_acces||'',prive:c.prive||false,
        tot:c.prix_total||0,sp:c.places_max||5,fl:c.places_prises||0,
        pr:c.professeur_id,em:c.emoji||'📚',
        prof_ini:c.prof_initiales||'?',
        prof_col:c.prof_couleur||'linear-gradient(135deg,#FF8C55,#E04E10)',
        prof_nm:c.prof_nom||t('reg_prof'),
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
    // _fetchProf différé : ne pas saturer la connexion au démarrage
    // Les profils sont chargés à la demande (openPr) ou via _fetchProf dans buildFavPage
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
    // Sauvegarder le cache après chaque chargement page 1 réussi
    if(page===1)_saveCoursCache();
  }catch(e){
    if(e.name==='AbortError'){
      var _gr=g('grid');if(_gr)_gr.innerHTML='';
      var _nc=g('nocard');if(_nc){_nc.style.display='block';var _nt=g('nocardTitle');if(_nt)_nt.textContent='Chargement...';}
      setTimeout(function(){loadData(1,true).then(function(){buildCards();});},5000);
    } else {
      console.log('loadData err',e);
      if(page===1)showNetworkError();
    }
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
  var labels=['',t('pw_too_short'),t('pw_weak'),t('pw_ok'),t('pw_strong')];
  for(var i=1;i<=4;i++){var b=g('pwBar'+i);if(b)b.style.background=i<=score?colors[score]:'var(--bdr)';}
  var lbl=g('pwStrengthLabel');if(lbl){lbl.textContent=labels[score]||'';lbl.style.color=colors[score]||'';}
}

// ── Supabase client init + OAuth ──
var _oauthSession=null;
var _pcIsOAuth=false;
var _oauthProcessing=false;

function _oauthRestoreLogin(msg){
  var loginEl=document.getElementById('login');
  if(loginEl){loginEl.style.display='';loginEl.style.zIndex='';}
  var sp=document.getElementById('oauthLoading');if(sp)sp.remove();
  var lsL=document.getElementById('lsLogin');if(lsL)lsL.style.display='';
  window.history.replaceState({},'',window.location.pathname);
  if(msg)toast(t('t_login_fail'),msg);
}
async function _initSupabase(){
  try{
    var _cfCtrl=new AbortController();var _cfTid=setTimeout(function(){_cfCtrl.abort();},15000);
    var r=await fetch(API+'/auth/config',{signal:_cfCtrl.signal});
    clearTimeout(_cfTid);
    var data=await r.json();
    if(!data.supabaseUrl||!data.supabaseAnonKey){
      console.warn('[OAuth] SUPABASE_ANON_KEY manquant sur le serveur — OAuth désactivé');
      if(_isOAuthReturn)_oauthRestoreLogin('OAuth non disponible');
      return;
    }
    if(!window.supabase){
      console.warn('[OAuth] Supabase CDN non chargé');
      if(_isOAuthReturn)_oauthRestoreLogin('Réessaie dans quelques instants');
      return;
    }
    window._supabase=window.supabase.createClient(data.supabaseUrl,data.supabaseAnonKey);
    window._supabaseOrigin=data.supabaseUrl;
    _setupAuthStateChange();
  }catch(e){
    console.warn('[OAuth] Erreur init Supabase:',e);
    if(_isOAuthReturn)_oauthRestoreLogin('Réessaie ou utilise email / mot de passe');
  }
}

function _setupCapacitorDeepLink(){
  if(!_isIOS||!window.Capacitor||!window.Capacitor.Plugins||!window.Capacitor.Plugins.App)return;
  window.Capacitor.Plugins.App.addListener('appUrlOpen',function(event){
    var url=event&&event.url||'';
    if(!url.startsWith('com.courspool.app://'))return;
    if(window.Capacitor.Plugins.Browser)window.Capacitor.Plugins.Browser.close();
    if(!window._supabase)return;
    // Flow implicite : #access_token= dans le hash
    var hashPart=url.split('#')[1]||'';
    if(hashPart.indexOf('access_token=')!==-1){
      var p=new URLSearchParams(hashPart);
      var at=p.get('access_token'),rt=p.get('refresh_token')||'';
      if(at){
        window._supabase.auth.setSession({access_token:at,refresh_token:rt}).then(function(result){
          if(result&&result.data&&result.data.session)_handleOAuthSignIn(result.data.session);
          else toast(t('t_login_fail'),t('t_retry'));
        }).catch(function(err){console.warn('[OAuth] setSession:',err);toast(t('t_login_fail'),t('t_retry'));});
        return;
      }
    }
    // Flow PKCE : ?code= dans la query
    window._supabase.auth.exchangeCodeForSession(url).then(function(result){
      if(result&&result.data&&result.data.session){
        _handleOAuthSignIn(result.data.session);
      }else{
        console.warn('[OAuth] exchangeCodeForSession: pas de session',result);
        toast(t('t_login_fail'),t('t_retry'));
      }
    }).catch(function(err){
      console.warn('[OAuth] exchangeCodeForSession:',err);
      toast(t('t_login_fail'),t('t_retry'));
    });
  });
}

function _setupAuthStateChange(){
  if(!window._supabase)return;
  _setupCapacitorDeepLink();
  // Fallback : si la session OAuth n'est pas détectée après 30s, ré-afficher le login
  if(_isOAuthReturn){
    setTimeout(function(){
      if(!user){
        var loginEl=document.getElementById('login');
        if(loginEl){loginEl.style.display='';loginEl.style.zIndex='';}
        var spinner=document.getElementById('oauthLoading');
        if(spinner)spinner.remove();
        var lsLogin=document.getElementById('lsLogin');
        if(lsLogin)lsLogin.style.display='';
        window.history.replaceState({},'',window.location.pathname);
        toast(t('t_login_fail'),t('t_retry'));
      }
    },30000);
  }
  // Vérifier s'il y a déjà une session (retour OAuth — hash traité avant la subscription)
  window._supabase.auth.getSession().then(function(result){
    var session=result&&result.data&&result.data.session;
    if(session&&!user&&_isOAuthReturn){
      _handleOAuthSignIn(session);
    }
  });
  // Écouter les changements futurs (SIGNED_IN + INITIAL_SESSION pour Supabase v2)
  window._supabase.auth.onAuthStateChange(function(event,session){
    if((event==='SIGNED_IN'||event==='INITIAL_SESSION')&&session&&!user&&_isOAuthReturn){
      _handleOAuthSignIn(session);
    }
  });
}

async function _handleOAuthSignIn(session){
  if(_oauthProcessing)return;
  _oauthProcessing=true;
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
    if(!r.ok&&r.status!==404){_oauthProcessing=false;_oauthRestoreLogin('Erreur serveur — réessaie');return;}
    var data=await r.json();
    if(data&&data.role){
      // Utilisateur existant — connexion directe
      var p=data;
      var pr=p.prenom||(meta.given_name||meta.name||(sbUser.email||'').split('@')[0]);
      var nm=p.nom||(meta.family_name||'');
      user={pr:pr,nm:nm,em:sbUser.email||'',role:p.role,id:sbUser.id,
        ini:((pr[0]||'')+(nm[0]||'')).toUpperCase()||'U',
        photo:p.photo_url||null,verified:p.verified,diplome_verifie:p.diplome_verifie,statut_compte:p.statut_compte||'',
        statut:p.statut||'',niveau:p.niveau||'',matieres:p.matieres||'',bio:p.bio||'',lieu:p.lieu||'',lieu_visible:p.lieu_visible||false,
        token:token,refresh_token:session.refresh_token,token_exp:session.expires_at};
      try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
      _scheduleTokenRefresh();
      _followsInitialized=false;
      _loadFol();
      favCours.clear();loadFavCours();
      applyUser();
      var _oauthUid=user.id;
      var _oauthFolP=fetch(API+'/follows/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;});
      loadData().then(function(){
        buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();
        _oauthFolP.then(function(fd){
          if(!Array.isArray(fd)||!user||user.id!==_oauthUid)return;
          _followsInitialized=true;
          var _r=new Set();fd.forEach(function(f){if(f.professeur_id)_r.add(f.professeur_id);});
          fol=_r;_saveFol();if(C.length)buildCards();
        }).catch(function(){});
      });
      toast(t('t_welcome')+' '+pr+' !',t('t_welcome_sub'));
      _oauthProcessing=false;
      return;
    }
  }catch(e){
    _oauthProcessing=false;
    // Restaurer le login et informer l'utilisateur (échec réseau ou Railway froid)
    var _lel=document.getElementById('login');
    if(_lel){_lel.style.display='';_lel.style.zIndex='';}
    var _sp2=document.getElementById('oauthLoading');if(_sp2)_sp2.remove();
    var _lsL2=document.getElementById('lsLogin');if(_lsL2)_lsL2.style.display='';
    window.history.replaceState({},'',window.location.pathname);
    toast(t('t_login_fail'),t('t_retry'));
    return;
  }
  // Nouvel utilisateur OAuth — afficher sélection du rôle
  _pcIsOAuth=true;
  _oauthSession=session;
  _regRole='eleve';
  _pcPour='moi';_pcNivEleve='';_pcNivEtudes='';_pcStatut='';_pcMatieres=[];_pcMode='';
  _pcHistory=[];
  var pc=g('profCompletion');if(pc){pc.style.display='block';pc.scrollTop=0;}
  _pcShowSlide('pcOAuthRole',false);
  _oauthProcessing=false;
}

async function doOAuthGoogle(){
  if(!window._supabase){toast(t('t_error'),t('t_oauth_unavail'));return;}
  var isCap=_isIOS&&window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Browser;
  var redirectTo=isCap?'com.courspool.app://login-callback':'https://courspool.vercel.app';
  try{
    if(isCap){
      var res=await window._supabase.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:redirectTo,skipBrowserRedirect:true,queryParams:{access_type:'offline',prompt:'consent'}}
      });
      if(res.data&&res.data.url){
        var _oauthUrl=res.data.url;
        if(!window._supabaseOrigin||!_oauthUrl.startsWith(window._supabaseOrigin)){toast(t('t_error'),t('t_oauth_unavail'));return;}
        try{await window.Capacitor.Plugins.Browser.open({url:_oauthUrl});}
        catch(be){window.location.href=_oauthUrl;}
      }
    }else{
      await window._supabase.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:redirectTo,queryParams:{access_type:'offline',prompt:'consent'}}
      });
    }
  }catch(e){if(typeof sentryCaptureException==='function')sentryCaptureException(e,{action:'oauth_google'});toast(t('t_error'),t('t_google_fail'));}
}
async function doOAuthApple(){
  if(!window._supabase){toast(t('t_error'),t('t_oauth_unavail'));return;}
  var isCap=_isIOS&&window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Browser;
  var redirectTo=isCap?'com.courspool.app://login-callback':'https://courspool.vercel.app';
  try{
    if(isCap){
      var res=await window._supabase.auth.signInWithOAuth({
        provider:'apple',
        options:{redirectTo:redirectTo,skipBrowserRedirect:true}
      });
      if(res.data&&res.data.url){
        var _oauthUrlA=res.data.url;
        if(!window._supabaseOrigin||!_oauthUrlA.startsWith(window._supabaseOrigin)){toast(t('t_error'),t('t_oauth_unavail'));return;}
        try{await window.Capacitor.Plugins.Browser.open({url:_oauthUrlA});}
        catch(be){window.location.href=_oauthUrlA;}
      }
    }else{
      await window._supabase.auth.signInWithOAuth({
        provider:'apple',
        options:{redirectTo:redirectTo}
      });
    }
  }catch(e){toast(t('t_error'),t('t_apple_fail'));}
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
    if(data.error){toast(t('t_error'),data.error);if(btn){btn.disabled=false;btn.textContent=t('pc_continue');}return;}
    var p=data.profile||{};
    var pr=p.prenom||(meta.given_name||(sbUser.email||'').split('@')[0]);
    var nm=p.nom||meta.family_name||'';
    user={pr:pr,nm:nm,em:sbUser.email||'',role:p.role||_regRole,id:sbUser.id,
      ini:((pr[0]||'')+(nm[0]||'')).toUpperCase()||'U',
      photo:p.photo_url||null,verified:p.verified,diplome_verifie:p.diplome_verifie,statut_compte:p.statut_compte||'',
      statut:p.statut||'',niveau:p.niveau||'',matieres:p.matieres||'',bio:p.bio||'',
      token:session.access_token,refresh_token:session.refresh_token,token_exp:session.expires_at};
    try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
    _scheduleTokenRefresh();
    applyUser();
    loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
    // Avancer vers la collecte d'âge (RGPD) avant les slides spécifiques au rôle
    _pcHistory.push('pcOAuthRole');
    _pcShowSlide('pcAge',false);
  }catch(e){
    toast(t('t_error'),t('t_try_again'));
    if(btn){btn.disabled=false;btn.textContent=t('pc_continue');}
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
var _pcStatut='';
var _pcMatieres=[];
var _pcMode='';
var _pcCurrentSlide='';
var _pcHistory=[];

function showProfCompletion(){
  var pc=g('profCompletion');if(!pc)return;
  pc.style.display='block';
  _pcIsOAuth=false;_oauthSession=null;
  _pcPour='moi';_pcNivEleve='';_pcNivEtudes='';_pcStatut='';_pcMatieres=[];_pcMode='';
  _pcHistory=[];
  _pcShowSlide('pcAge',false);
}

function _pcAllSlides(){return['pcOAuthRole','pcAge','pcElA','pcElBmoi','pcElBenf','pcPf0','pcPfA','pcPfB','pcPfC'];}

function _pcProfSlides(){
  // pcPfA (niveau d'études) uniquement si statut = étudiant ou non encore sélectionné
  var inclNiv=(!_pcStatut||_pcStatut==='etudiant');
  return inclNiv?['pcPf0','pcPfA','pcPfB','pcPfC']:['pcPf0','pcPfB','pcPfC'];
}

function _pcOrderedSlides(){
  if(_pcIsOAuth){
    if(!user)return['pcOAuthRole'];
    if(user.role==='professeur')return['pcOAuthRole','pcAge'].concat(_pcProfSlides());
    return _pcPour==='enfant'?['pcOAuthRole','pcAge','pcElA','pcElBenf']:['pcOAuthRole','pcAge','pcElA','pcElBmoi'];
  }
  if(user&&user.role==='professeur')return['pcAge'].concat(_pcProfSlides());
  return _pcPour==='enfant'?['pcAge','pcElA','pcElBenf']:['pcAge','pcElA','pcElBmoi'];
}

function _pcShowSlide(id,isBack){
  _pcAllSlides().forEach(function(sid){var el=g(sid);if(el){el.style.display='none';el.classList.remove('pc-back');}});
  var el=g(id);if(!el)return;
  el.style.display='block';
  if(isBack)el.classList.add('pc-back');
  _pcCurrentSlide=id;
  // Adapter la question du lieu selon le statut du prof
  if(id==='pcPfC'){
    var _villeTitle=g('pcVilleTitle');
    var _etabLabel=g('pcEtabLabel');
    if(_villeTitle){
      if(_pcStatut==='etudiant'){
        _villeTitle.textContent=t('pc_ou_etudiez');
        if(_etabLabel)_etabLabel.innerHTML=t('pc_univ_ecole')+' <span style="font-weight:400;color:var(--lite)">(optionnel)</span>';
      } else if(_pcStatut==='auto'||_pcStatut==='autre'){
        _villeTitle.textContent=t('pc_ou_travaillez');
        if(_etabLabel)_etabLabel.innerHTML=t('lieu_activite')+' <span style="font-weight:400;color:var(--lite)">(optionnel)</span>';
      } else {
        _villeTitle.textContent=t('pc_ou_enseignez');
        if(_etabLabel)_etabLabel.innerHTML=t('pc_etab_opt')+' <span style="font-weight:400;color:var(--lite)">(optionnel)</span>';
      }
    }
  }
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
// ── Âge / RGPD ──
var _pcBirthYear=0;

function pcAgeCheck(){
  var yr=parseInt((g('pcBirthYear')&&g('pcBirthYear').value)||'0');
  var curYear=new Date().getFullYear();
  var age=curYear-yr;
  var msg=g('pcAgeMsg'),consent=g('pcParentalConsent'),btn=g('pcAgeBtn');
  if(!yr||yr<1920||yr>curYear-3){
    if(msg){msg.style.display='none';}
    if(consent)consent.style.display='none';
    if(btn){btn.disabled=true;btn.style.opacity='.5';}
    return;
  }
  var isProf=user&&user.role==='professeur';
  // Bloquant
  if(isProf&&age<18){
    if(msg){msg.style.display='block';msg.style.cssText='display:block;background:#FEF2F2;border-radius:12px;padding:13px 14px;font-size:13px;line-height:1.6;margin-top:12px;color:#EF4444'
      ;msg.textContent=t('age_18_requis');}
    if(consent)consent.style.display='none';
    if(btn){btn.disabled=true;btn.style.opacity='.5';}
    return;
  }
  if(!isProf&&age<13){
    if(msg){msg.style.display='block';msg.style.cssText='display:block;background:#FEF2F2;border-radius:12px;padding:13px 14px;font-size:13px;line-height:1.6;margin-top:12px;color:#EF4444'
      ;msg.textContent=t('age_13_requis');}
    if(consent)consent.style.display='none';
    if(btn){btn.disabled=true;btn.style.opacity='.5';}
    return;
  }
  // Consentement parental 13–14 ans
  if(!isProf&&age>=13&&age<15){
    if(msg){msg.style.display='block';msg.style.cssText='display:block;background:#FFF7ED;border-radius:12px;padding:13px 14px;font-size:13px;line-height:1.6;margin-top:12px;color:#92400E'
      ;msg.textContent=t('age_15_accord');}
    if(consent)consent.style.display='block';
    var chk=g('pcConsentCheck');
    if(btn){btn.disabled=!chk||!chk.checked;btn.style.opacity=(!chk||!chk.checked)?'.5':'1';}
    return;
  }
  // Tout bon
  if(msg)msg.style.display='none';
  if(consent)consent.style.display='none';
  if(btn){btn.disabled=false;btn.style.opacity='1';}
}

function pcAgeNext(){
  var yr=parseInt((g('pcBirthYear')&&g('pcBirthYear').value)||'0');
  var age=new Date().getFullYear()-yr;
  var isProf=user&&user.role==='professeur';
  if(!yr||yr<1920||(isProf&&age<18)||(!isProf&&age<13))return;
  if(!isProf&&age>=13&&age<15){
    var chk=g('pcConsentCheck');
    if(!chk||!chk.checked){toast(t('t_consent'),t('t_consent_check'));return;}
  }
  _pcBirthYear=yr;
  if(user){
    user.birth_year=yr;
    user.is_mineur=(age<18);
    if(age>=13&&age<15)user.is_tuteur=false;
  }
  _pcHistory.push('pcAge');
  var nextSlide=(user&&user.role==='professeur')?'pcPf0':'pcElA';
  _pcShowSlide(nextSlide,false);
}

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

function pickPcStatut(el,v){
  _pcStatut=v;
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
  if(_pcBirthYear>0)payload.birth_year=_pcBirthYear;
  if(user.role==='professeur'){
    if(_pcStatut)payload.statut=_pcStatut;
    if(_pcNivEtudes)payload.niveau_etudes=_pcNivEtudes;
    if(_pcMatieres.length>0)payload.matieres=_pcMatieres.join(', ');
    var ville=(g('pcVille')&&g('pcVille').value||'').trim();
    if(ville)payload.ville=ville;
    var etab=(g('pcEtablissement')&&g('pcEtablissement').value||'').trim();
    if(etab)payload.etablissement=etab;
    if(_pcMode)payload.mode_cours=_pcMode;
  }else{
    payload.pour_enfant=(_pcPour==='enfant');
    if(_pcPour==='enfant'){
      payload.is_tuteur=true;
      if(user)user.is_tuteur=true;
      try{localStorage.setItem('cp_is_tuteur','1');}catch(e){}
      var enfPrenom=(g('pcEnfantPrenom')&&g('pcEnfantPrenom').value||'').trim();
      if(enfPrenom){payload.enfant_prenom=enfPrenom;if(user)user.enfant_prenom=enfPrenom;try{localStorage.setItem('cp_enfant_prenom',enfPrenom);}catch(e){}}
    }
    if(_pcNivEleve&&_pcNivEleve!=='no_answer'){
      if(_pcPour==='enfant')payload.niveau_enfant=_pcNivEleve;
      else payload.niveau=_pcNivEleve;
    }
    var age=parseInt((g('pcEnfantAge')&&g('pcEnfantAge').value)||'0')||0;
    if(age>0){payload.age_enfant=age;if(age<13)payload.is_mineur=true;}
  }
  if(Object.keys(payload).length>0){
    try{
      var _pcResp=await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify(payload)});
      var _pcData=await _pcResp.json().catch(function(){return null;});
      // Sync depuis réponse serveur si disponible, sinon depuis payload
      var _pcProf=(_pcData&&_pcData.profile)||payload;
      if(user.role==='professeur'){
        if(_pcProf.statut!==undefined)user.statut=_pcProf.statut;
        if(_pcProf.matieres!==undefined)user.matieres=_pcProf.matieres;
        if(_pcProf.niveau_etudes!==undefined)user.niveau_etudes=_pcProf.niveau_etudes;
        if(_pcProf.ville!==undefined)user.ville=_pcProf.ville;
        if(_pcProf.mode_cours!==undefined)user.mode_cours=_pcProf.mode_cours;
      } else {
        if(_pcProf.pour_enfant!==undefined)user.pour_enfant=_pcProf.pour_enfant;
        if(_pcProf.niveau!==undefined)user.niveau=_pcProf.niveau;
        if(_pcProf.niveau_enfant!==undefined)user.niveau_enfant=_pcProf.niveau_enfant;
      }
    }catch(e){
      // Fallback sync depuis payload si fetch échoue
      if(user.role==='professeur'){
        if(payload.statut)user.statut=payload.statut;
        if(payload.matieres)user.matieres=payload.matieres;
        if(payload.niveau_etudes)user.niveau_etudes=payload.niveau_etudes;
        if(payload.ville)user.ville=payload.ville;
        if(payload.mode_cours)user.mode_cours=payload.mode_cours;
      } else {
        if(payload.pour_enfant!==undefined)user.pour_enfant=payload.pour_enfant;
        if(payload.niveau)user.niveau=payload.niveau;
        if(payload.niveau_enfant)user.niveau_enfant=payload.niveau_enfant;
      }
    }
    try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
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
  var _lbtn=g('loginSubmitBtn');
  if(_lbtn){_lbtn.disabled=true;_lbtn.innerHTML='<span style="display:inline-block;width:16px;height:16px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:cpSpin .8s linear infinite;vertical-align:middle"></span>';}
  try{
    var _ctrl=new AbortController();var _tId=setTimeout(function(){_ctrl.abort();},20000);
    var r=await fetch(API+'/auth/login',{method:'POST',headers:apiH(),body:JSON.stringify({email:em,password:pw}),signal:_ctrl.signal});
    clearTimeout(_tId);
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);shake('lfC');return;}
    var p=data.profile||{};
    // Vérifier si compte bloqué
    if(p.statut_compte==='bloqué'){
      toast(t('t_account_suspended'),t('t_account_suspended_msg'));
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
      diplome_verifie:p.diplome_verifie!=null?p.diplome_verifie:undefined,
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
    _loadFol(); // fallback localStorage si GET /follows échoue plus bas
    favCours.clear();loadFavCours();
    _convCache='';
    if(uid){
      // loadData ET res+follows EN PARALLÈLE
      var _folDone2=false;
      var _dataP2=loadData();
      var _rfP2=Promise.all([
        fetch(API+'/reservations/'+uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
        fetch(API+'/follows/'+uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}) // null = échec réseau → ne pas écraser fol
      ]);
      // Afficher les cours dès qu'ils arrivent
      _dataP2.then(function(){
        restoreFilters();buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();
        // Sync follow buttons dès que les follows arrivent (courses ont chargé en premier)
        // Retry follows si pas encore arrivés après 5s (Railway cold start / fetch bloqué)
        setTimeout(function(){
          if(_folDone2||!user||user.id!==uid)return;
          fetch(API+'/follows/'+uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}).then(function(fd){
            _folDone2=true;
            if(!Array.isArray(fd))return;
            var _r=new Set();fd.forEach(function(f){if(f.professeur_id)_r.add(f.professeur_id);});
            fol=_r;_saveFol();_followsInitialized=true;if(C.length)buildCards();
          });
        },5000);
      });
      // Appliquer res+follows quand ils arrivent, puis reconstruire
      _rfP2.then(function(results){
        _folDone2=true;
        var resData=results[0],folData=results[1];
        Object.keys(res).forEach(function(k){delete res[k];});
        Object.keys(P).forEach(function(k){delete P[k];});
        if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}}
        // Ne remplacer fol QUE si le fetch a réussi (folData=null = échec réseau → garder fol du localStorage)
        if(Array.isArray(folData)){var _newFol2=new Set();folData.forEach(function(f){if(f.professeur_id)_newFol2.add(f.professeur_id);});fol=_newFol2;_saveFol();_followsInitialized=true;}
        if(C.length)buildCards();
        _syncAllFollowBtns();
        updateFavBadge();
        var _pfav3=g('pgFav');if(_pfav3&&_pfav3.classList.contains('on'))buildFavPage();
        var _pmp3=g('pgMesProfs');if(_pmp3&&_pmp3.classList.contains('on'))buildMesProfs();
      }).catch(function(){});
    } else {
      loadData().then(function(){buildCards();_startAutoRefresh();if(typeof initSocket==='function')initSocket();});
    }
    toast(t('t_welcome')+' '+pr+' !',t('t_welcome_sub'));
    // Lancer tuto — si prof sans CNI, délégué à après la modal CNI
    if(role!=='professeur'){setTimeout(tutoStart,1200);}
  }catch(e){
    if(e.name==='AbortError'){toast(t('t_timeout'),t('t_timeout_msg'));}
    else{toast(t('t_error'),t('t_login_fail_msg'));}
  }
  finally{
    g('lEm').disabled=false;g('lPw').disabled=false;
    var _lb=g('loginSubmitBtn');if(_lb){_lb.disabled=false;_lb.textContent=t('txt_login_btn');}
  }
}

async function doReg(){
  var pr=(g('rPr')&&g('rPr').value||'').trim();
  var nm=(g('rNm')&&g('rNm').value||'').trim();
  var em=(g('rEm')&&g('rEm').value||'').trim();
  var pw=(g('rPw')&&g('rPw').value||'');
  var role=_regRole||'eleve';
  if(!pr||!em||!pw){toast(t('t_fields_miss'),'');return;}
  if(pw.length<6){toast(t('t_error'),t('t_pw_short'));return;}
  var btn=g('regCreateBtn');if(btn){btn.disabled=true;btn.textContent=t('txt_creating');}
  try{
    var body={email:em,password:pw,prenom:pr,nom:nm,role:role};
    var r=await fetch(API+'/auth/register',{method:'POST',headers:apiH(),body:JSON.stringify(body)});
    var data=await r.json();
    if(data.error){toast(t('t_error'),data.error);return;}
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
  }catch(e){toast(t('t_error'),t('t_signup_fail'));}
  finally{if(btn){btn.disabled=false;btn.textContent=t('txt_create_btn');}}
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
  var bniMesG=g('bniMes');if(bniMesG)bniMesG.style.display='none';
  // Header invité
  var mobT=g('mobTitle'),mobS=g('mobSub');
  if(mobT)mobT.textContent=t('exp_explore_title');
  if(mobS)mobS.textContent=t('exp_near_you');
  var tav=g('tav');if(tav){tav.style.background='var(--bdr)';tav.textContent='?';}
  var tavMob=g('tavMob');if(tavMob){tavMob.style.background='var(--bdr)';tavMob.textContent='?';}
  loadData().then(function(){buildCards();});
  // Synchro nav
  navTo('exp');
  // Onboarding + tuto
  setTimeout(obShow, 500);
}

function go(pr,nm,em,role,uid,photoUrl,token,refreshToken,tokenExp){
  // Clear enrolled profs if switching to a different user account
  try{var _prev=JSON.parse(localStorage.getItem('cp_user')||'{}');if(_prev.id&&String(_prev.id)!==String(uid))localStorage.removeItem('cp_enrolled_profs');}catch(e){}
  user={pr:pr,nm:nm,em:em,role:role||'eleve',id:uid,ini:((pr&&pr[0]?pr[0]:'')+(nm&&nm[0]?nm[0]:'')).toUpperCase()||'U',photo:photoUrl||null,token:token||undefined,refresh_token:refreshToken||undefined,token_exp:tokenExp||undefined};
  try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
  _scheduleTokenRefresh();
  favCours.clear();loadFavCours();
  applyUser();
  loadData().then(function(){buildCards();});
  toast('Bienvenue '+pr+' !',t('t_welcome_sub'));
}

function applyUser(){
  var _l=g('login');if(_l){_l.style.display='none';_l.style.pointerEvents='none';_l.style.zIndex='-1';}g('app').style.display='block';
  // Restaurer is_tuteur et enfant_prenom depuis localStorage si non fournis par le backend
  if(user&&user.is_tuteur===undefined){try{user.is_tuteur=localStorage.getItem('cp_is_tuteur')==='1';}catch(e){}}
  if(user&&!user.enfant_prenom){try{user.enfant_prenom=localStorage.getItem('cp_enfant_prenom')||'';}catch(e){}}
  // Greeting dynamique
  try{
    var h=new Date().getHours();
    var greet=h<6?t('greet_night'):h<12?t('greet_morning'):h<18?t('greet_morning'):h<22?t('greet_evening'):t('greet_night');
    var mobT=g('mobTitle'),mobS=g('mobSub');
    if(mobT)mobT.textContent=user&&user.pr?greet+' '+user.pr+' 👋':greet+' 👋';
    if(mobS){var msgs=[t('exp_subtitle'),t('explore_sub1'),t('explore_sub2')];if(msgs&&msgs.length)mobS.textContent=msgs[Math.floor(Math.random()*msgs.length)];}
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
  // Contexte utilisateur pour le monitoring d'erreurs (id + rôle uniquement, jamais l'email)
  if(typeof setSentryUser==='function')setSentryUser(user);
  // Forcer la synchro complète de la nav et du header
  navTo('exp');
}

// Titres et sous-titres par page
var MOB_TITLES={
  exp:{titleKey:'exp_title',subKey:'exp_subtitle'},
  fav:{titleKey:'bnav_favoris',subKey:'fav_saved'},
  profs:{titleKey:'bnav_mes_profs',subKey:null},
  mes:{titleKey:'acc_mes_cours',subKey:'acc_reservations'},
  msg:{titleKey:'msg_title',subKey:'msg_title'},
  acc:{titleKey:'acc_mon_profil',subKey:'acc_parametres'}
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
  var entry=MOB_TITLES[tab]||{titleKey:null,subKey:null};
  var title=entry.titleKey?t(entry.titleKey):'CoursPool';
  var sub=entry.subKey?t(entry.subKey):'';
  var mt=g('mobTitle'),ms=g('mobSub');
  if(tab==='exp'&&user){
    if(mt)mt.textContent=getGreeting()+' '+user.pr+' 👋';
    if(ms)ms.textContent=sub;
  } else {
    if(mt)mt.textContent=title;
    if(ms)ms.textContent=sub;
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
  if(mh)mh.style.display=(tab==='msg'||tab==='mes')?'none':'block';
}

function navTo(tab,_skipHistory){
  // ── Gardes : vérification avant tout changement DOM ─────────────────────
  if(tab==='fav'&&(!user||user.guest)){
    toast(t('t_fav_login'),'');
    setTimeout(scrollToLogin,800);
    return;
  }
  if(tab==='msg'){
    if(!user){navTo('exp');return;}
    if(user.guest){
      toast(t('t_msg_login'),'');
      setTimeout(scrollToLogin,800);
      return;
    }
  }
  if(tab==='acc'){
    if(!user){navTo('exp');return;}
    if(user.guest){
      var bd=g('bdLoginPrompt');
      if(bd){
        var _bdT=bd.querySelector('[style*="font-size:21px"]');
        var s=bd.querySelector('[style*="font-size:14px"][style*="color:var(--lite)"]');
        if(_bdT)_bdT.textContent=window.t('exp_guest_title');
        if(s)s.innerHTML=window.t('exp_guest_sub');
        bd.style.display='flex';
      }else{
        toast(t('t_acc_login'),'');
        setTimeout(scrollToLogin,800);
      }
      return;
    }
  }
  // ── Mise à jour historique + nettoyage DOM ───────────────────────────────
  if(!_skipHistory){try{history.pushState({tab:tab},'',' ');}catch(e){}}
  var convPane=g('msgConvPane');
  if(convPane&&tab!=='msg')convPane.style.display='none';
  var pgMsgEl=g('pgMsg');
  if(pgMsgEl&&tab!=='msg'){
    pgMsgEl.classList.remove('conv-open');
    var _bnavEl=g('bnav');if(_bnavEl)_bnavEl.classList.remove('ipad-back');
    var _bbEl=g('bnavIpadBack');if(_bbEl)_bbEl.classList.remove('visible');
  }
  clearTimeout(msgPollTimer);if(tab!=='msg'){msgPollTimer=null;}

  ['bniExp','bniFav','bniMsg','bniProfs','bniMes','bniEsp'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
  var appEl=g('app');if(appEl)appEl.scrollTop=0;
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg'),pgFav=g('pgFav'),pgMes=g('pgMes'),pgMesProfs=g('pgMesProfs');
  if(pgExp)pgExp.classList.remove('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  if(pgFav)pgFav.classList.remove('on');
  if(pgMes)pgMes.classList.remove('on');
  if(pgMesProfs)pgMesProfs.classList.remove('on');
  updateMobHeader(tab);
  updateTopbarNav(tab);

  if(tab==='exp'){
    if(pgExp)pgExp.classList.add('on');
    var bExp=g('bniExp');if(bExp)bExp.classList.add('on');
    var br=g('btnRefresh');if(br)br.style.display=user?'flex':'none';
    restoreNav();
    _syncAllFollowBtns();
    // Si les follows ne sont pas encore initialisés (ex: connexion OAuth), les charger maintenant
    if(!_followsInitialized&&user&&user.id&&!user.guest){
      var _navFolUid=user.id;
      fetch(API+'/follows/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}).then(function(fd){
        if(!Array.isArray(fd)||!user||user.id!==_navFolUid)return;
        _followsInitialized=true;
        var _r=new Set();fd.forEach(function(f){if(f.professeur_id)_r.add(f.professeur_id);});
        fol=_r;_saveFol();
        _syncAllFollowBtns();
        if(C.length&&pgExp&&pgExp.classList.contains('on'))buildCards();
      });
    }
  } else if(tab==='fav'){
    if(pgFav)pgFav.classList.add('on');
    var bFav=g('bniFav');if(bFav){bFav.classList.add('on');_springIcon(bFav);}
    var brF=g('btnRefresh');if(brF)brF.style.display='none';
    restoreNav();
    buildFavPage();
  } else if(tab==='msg'){
    if(pgMsg)pgMsg.classList.add('on');
    restoreNav();
    var bMsg=g('bniMsg');if(bMsg)bMsg.classList.add('on');
    var br3=g('btnRefresh');if(br3)br3.style.display='none';
    clearTimeout(_convRetryTimer);_convRetryTimer=null;_convRetries=0;_convLoading=false;
    loadConversations();
  } else if(tab==='acc'){
    if(pgAcc)pgAcc.classList.add('on');
    var br2=g('btnRefresh');if(br2)br2.style.display='none';
    restoreNav();
    goAccount();
  } else if(tab==='profs'){
    if(pgMesProfs)pgMesProfs.classList.add('on');
    var bProfs=g('bniProfs');if(bProfs){bProfs.classList.add('on');_springIcon(bProfs);}
    var br4=g('btnRefresh');if(br4)br4.style.display='none';
    restoreNav();
    buildMesProfs();
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
  // Nettoyer les classes iPad messaging (sécurité si restoreNav appelé sans closeMsgConv)
  if(nav){nav.classList.remove('ipad-back');nav.classList.remove('conv-mode');}
  var _bbR=g('bnavIpadBack');if(_bbR)_bbR.classList.remove('visible');

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
  // Mes Profs — élèves seulement
  var bniProfsEl=g('bniProfs');if(bniProfsEl)bniProfsEl.style.display=(user&&!user.guest&&user.role!=='professeur')?'flex':'none';
  // Mon Espace — profs seulement
  var bniEspEl=g('bniEsp');if(bniEspEl)bniEspEl.style.display=(user&&user.role==='professeur')?'flex':'none';
  // Mes cours — élèves seulement
  var bniMesR=g('bniMes');
  if(bniMesR)bniMesR.style.display=(user&&user.role==='professeur')?'none':'flex';
  // Créer — profs seulement
  var bniAdd=g('bniAdd');
  if(bniAdd)bniAdd.style.display=(user&&user.role==='professeur')?'flex':'none';
}

function goEspProf(){
  goAccount();
  var tab=g('aTabEsp');
  if(tab)switchATab('Esp',tab);
  var be=g('bniEsp');if(be)be.classList.add('on');
}

function goExplore(){
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg'),pgFav=g('pgFav'),pgMes=g('pgMes'),pgMesProfs=g('pgMesProfs');
  if(pgExp)pgExp.classList.add('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  if(pgFav)pgFav.classList.remove('on');
  if(pgMes)pgMes.classList.remove('on');
  if(pgMesProfs)pgMesProfs.classList.remove('on');
  ['bniExp','bniFav','bniMsg','bniProfs','bniMes','bniEsp'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
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
      // Fetch profil en background dès le démarrage — corrige les données stales sans attendre goAccount()
      if(user.id&&!user.guest){
        fetch(API+'/profiles/'+user.id+'?t='+Date.now(),{cache:'no-store',headers:apiH()})
          .then(function(r){return r.json();})
          .then(function(prof){
            if(!prof||!prof.id)return;
            var _chg=false;
            if(prof.prenom&&prof.prenom!==user.pr){user.pr=prof.prenom;_chg=true;}
            if(prof.nom!==undefined&&(prof.nom||'')!==(user.nm||'')){user.nm=prof.nom||'';_chg=true;}
            if(prof.photo_url&&prof.photo_url!==user.photo){user.photo=prof.photo_url;_chg=true;}
            if(!_chg)return; // pas de changement, rien à faire
            user.ini=((user.pr&&user.pr[0]?user.pr[0]:'')+(user.nm&&user.nm[0]?user.nm[0]:'')).toUpperCase()||'U';
            try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
            // Mettre à jour tous les avatars + nom dans l'UI
            setAvatar(g('tav'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
            setAvatar(g('tavMob'),user.photo,user.ini||'?','linear-gradient(135deg,#FF8C55,var(--ord))');
            var _mt=g('mobTitle');if(_mt&&g('pgExp')&&g('pgExp').classList.contains('on'))_mt.textContent=getGreeting()+' '+user.pr+' 👋';
            var _accAv2=g('accAv');if(_accAv2)setAvatar(_accAv2,user.photo,user.ini,'rgba(255,255,255,.25)');
            var _accNm2=g('accName');if(_accNm2)_accNm2.textContent=user.pr+(user.nm?' '+user.nm:'');
          }).catch(function(){});
      }
      // Affichage instantané depuis le cache si disponible
      var _hadCache=_loadCoursCache();
      _loadFol(); // restaurer les profils suivis depuis localStorage (affichage immédiat dans fav)
      favCours.clear();loadFavCours(); // recharger avec user.id défini — évite page Favoris vide en cold start
      if(_hadCache)buildCards();
      if(user.id){
        // Lancer loadData ET res+follows EN PARALLÈLE — ne pas attendre l'un pour l'autre
        // silent=true si cache déjà affiché (évite de remplacer le contenu par des skeletons)
        var _folDone=false;
        var _uid=user.id;
        var _dataP=loadData(1,_hadCache);
        var _rfP=Promise.all([
          fetch(API+'/reservations/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
          fetch(API+'/follows/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}) // null = échec réseau → on garde fol du localStorage
        ]);
        // Afficher les cours dès qu'ils arrivent (sans attendre res+follows)
        // loadData(1) avec silent=true si cache déjà affiché pour éviter les skeletons
        _dataP.then(function(){
          buildCards();checkStripeReturn();checkPrivateCoursAccess();checkProfDeepLink();setTimeout(checkCoursANoter,3000);_startAutoRefresh();if(typeof initSocket==='function')initSocket();
          // Sync follow buttons dès que les follows arrivent
          _rfP.then(function(){if(C.length&&user)_syncAllFollowBtns();}).catch(function(){});
          // Retry follows si pas encore arrivés après 5s (Railway cold start / fetch bloqué)
          setTimeout(function(){
            if(_folDone||!user||user.id!==_uid)return;
            fetch(API+'/follows/'+_uid,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;}).then(function(fd){
              _folDone=true;
              if(!Array.isArray(fd))return;
              var _r=new Set();fd.forEach(function(f){if(f.professeur_id)_r.add(f.professeur_id);});
              fol=_r;_saveFol();if(C.length)buildCards();
            });
          },5000);
        }).catch(function(){});
        // Appliquer res+follows quand ils arrivent, puis reconstruire
        _rfP.then(function(results){
          _folDone=true;
          var resData=results[0],folData=results[1];
          Object.keys(res).forEach(function(k){delete res[k];});
          if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}}
          Object.keys(P).forEach(function(k){delete P[k];});
          // Ne remplacer fol QUE si le fetch a réussi (folData=null = timeout/erreur réseau)
          if(Array.isArray(folData)){var _newFol=new Set();folData.forEach(function(f){if(f.professeur_id)_newFol.add(f.professeur_id);});fol=_newFol;_saveFol();_followsInitialized=true;}
          // sinon on garde fol chargé depuis localStorage par _loadFol() au démarrage
          favCours.clear();loadFavCours();
          updateFavBadge();
          if(C.length)buildCards();
          _syncAllFollowBtns();
          if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
          var _pfav2=g('pgFav');if(_pfav2&&_pfav2.classList.contains('on'))buildFavPage();
          var _pmp2=g('pgMesProfs');if(_pmp2&&_pmp2.classList.contains('on'))buildMesProfs();
        }).catch(function(){});
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
          _sp.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px"><div style="width:36px;height:36px;border:3px solid #eee;border-top-color:#FF6B2B;border-radius:50%;animation:cpSpin .8s linear infinite"></div><p style="font-size:14px;color:#888;font-family:inherit;margin:0">'+window.t('oauth_loading')+'</p></div>';
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
      // Garder cp_stripe_pending pour le retry (retryPayment() l'utilise)
      setTimeout(function(){
        var p=document.getElementById('popupFailed');
        if(p)p.style.display='flex';
      },400);
      return;
    }

    // Retour configuration bancaire
    if(params.get('stripe_connected')){
      window.history.replaceState({},'',window.location.pathname);
      toast(t('t_pay_active'),t('t_pay_active_s'));
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
        else{toast(t('t_not_found'),'');}
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
      if(msg)msg.textContent=pourAmi?t('res_email_ami'):t('res_email_vous');
      window._paidCoursId=coursId;
      var calBtn=document.getElementById('popupPaidCalBtn');
      if(calBtn)calBtn.style.display=pourAmi?'none':'flex';
      // Adresse privée — montrer si disponible et non pour un ami
      var adresseBlock=document.getElementById('popupPaidAdresse');
      var adresseText=document.getElementById('popupPaidAdresseText');
      var paidC=C.find(function(x){return x.id==coursId;});
      if(!pourAmi&&adresseBlock&&adresseText&&paidC&&paidC.lieu_prive){
        adresseText.textContent=paidC.lieu_prive;adresseBlock.style.display='block';
      }else if(adresseBlock){adresseBlock.style.display='none';}
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
  var pgMesEl=g('pgMes');if(pgMesEl)pgMesEl.classList.remove('on');
  var pgMesProfsEl=g('pgMesProfs');if(pgMesProfsEl)pgMesProfsEl.classList.remove('on');
  g('pgAcc').classList.add('on');
  setAvatar(g('accAv'),user.photo,user.ini,'rgba(255,255,255,.25)');
  var accName=g('accName'); if(accName)accName.textContent=user.pr+(user.nm?' '+user.nm:'');
  var accEmail=g('accEmail'); if(accEmail)accEmail.textContent=user.em;
  var pfPr=g('pfPr'),pfNm=g('pfNm'),pfEm=g('pfEm'),pfVille=g('pfVille'),pfBio=g('pfBio');
  if(pfPr)pfPr.value=user.pr||'';if(pfNm)pfNm.value=user.nm||'';if(pfEm)pfEm.value=user.em||'';
  if(pfVille)pfVille.value=user.ville||'';if(pfBio)pfBio.value=user.bio||'';
  var pfVilleVisEl=g('pfVilleVisible');
  if(pfVilleVisEl){if(user.ville_visible)pfVilleVisEl.classList.add('on');else pfVilleVisEl.classList.remove('on');}
  _updatePfVilleLabel();
  var pfLieu=g('pfLieu'),pfLieuVisEl=g('pfLieuVisible'),pfLieuLbl=g('pfLieuLabel'),pfLieuVisLbl=g('pfLieuVisLabel');
  if(pfLieu)pfLieu.value=user.lieu||'';
  if(pfLieuVisEl){if(user.lieu_visible)pfLieuVisEl.classList.add('on');else pfLieuVisEl.classList.remove('on');}
  var _lieuLbl=user.role==='professeur'?t('lieu_enseignement'):t('etab_ecole');
  if(pfLieuLbl)pfLieuLbl.textContent=_lieuLbl;
  if(pfLieuVisLbl)pfLieuVisLbl.textContent=t('visible_profil')+' '+t('visible_public');
  var roleDisplay=g('pfRoleDisplay');
  if(roleDisplay)roleDisplay.textContent=user.role==='professeur'?'👨‍🏫 '+t('reg_prof'):'🎓 '+t('reg_eleve');
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
    // Formations & Expériences
    var pfFormEx=g('pfFormationsExtra');if(pfFormEx)pfFormEx.style.display='block';
    var pfFm=g('pfFormations');if(pfFm)pfFm.value=user.formations||'';
    var pfXp=g('pfExperiences');if(pfXp)pfXp.value=user.experiences||'';
  } else {
    if(pfProfExtra)pfProfExtra.style.display='none';
    var pfFormEx2=g('pfFormationsExtra');if(pfFormEx2)pfFormEx2.style.display='none';
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
        if(prof.ville!==undefined){user.ville=prof.ville||'';var _pfVil=g('pfVille');if(_pfVil)_pfVil.value=user.ville;}
        if(prof.ville_visible!==undefined){user.ville_visible=prof.ville_visible;var _pvv=g('pfVilleVisible');if(_pvv){if(prof.ville_visible)_pvv.classList.add('on');else _pvv.classList.remove('on');}}
        if(prof.statut!==undefined){user.statut=prof.statut||'';_updatePfVilleLabel();}
        if(prof.niveau!==undefined)user.niveau=prof.niveau||'';
        if(prof.matieres!==undefined)user.matieres=prof.matieres||'';
        if(prof.formations!==undefined){user.formations=prof.formations||'';var _pfFm=g('pfFormations');if(_pfFm)_pfFm.value=user.formations;}
        if(prof.experiences!==undefined){user.experiences=prof.experiences||'';var _pfXp=g('pfExperiences');if(_pfXp)_pfXp.value=user.experiences;}
        user.nbEleves=prof.nb_eleves||0;
        user.noteMoyenne=prof.note_moyenne?parseFloat(prof.note_moyenne).toFixed(1):null;
        user.ini=((user.pr&&user.pr[0]?user.pr[0]:'')+(user.nm&&user.nm[0]?user.nm[0]:'')).toUpperCase()||'U';
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Re-rendre le header avatar + nom (maintenant à jour depuis BDD)
        var _accName=g('accName');if(_accName)_accName.textContent=user.pr+(user.nm?' '+user.nm:'');
        var _accAv=g('accAv');
        setAvatar(_accAv,user.photo,user.ini,'rgba(255,255,255,.25)');
        // Mettre à jour aussi les avatars topbar (fix : restaient stales après refresh profil)
        setAvatar(g('tav'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
        setAvatar(g('tavMob'),user.photo,user.ini||'?','linear-gradient(135deg,#FF8C55,var(--ord))');
      }
      if(Array.isArray(resData)){
        Object.keys(res).forEach(function(k){delete res[k];});
        resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});
        try{localStorage.setItem('cp_res',JSON.stringify(Object.keys(res)));}catch(e){}
      }
      if(Array.isArray(folData)){
        fol.clear();
        folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});
        _saveFol();_followsInitialized=true;
      }
      buildAccLists();
    }).catch(function(){});
  }
  // Onglets et cartes visibles uniquement pour les profs
  var isProf2=user&&user.role==='professeur';
  var tabRev = g('aTabRev');
  if(tabRev)tabRev.style.display=isProf2?'flex':'none';
  var cr=g('accCardRev');
  if(cr)cr.style.display=isProf2?'block':'none';
  var ce=g('accCardEsp');
  if(ce)ce.style.display=isProf2?'block':'none';
  var te=g('aTabEsp');
  if(te)te.style.display=isProf2?'flex':'none';
  // Carte "Mes avis" uniquement pour les profs
  var ca=g('accCardAvis');
  if(ca)ca.style.display=isProf2?'block':'none';
  var ta=g('aTabAvis');
  if(ta)ta.style.display=isProf2?'flex':'none';
  // Carte "Mes cours" masquée pour les profs
  var cm=g('accCardMesCours');
  if(cm)cm.style.display=isProf2?'none':'block';
  // Statut vérification
  updateVerifStatusBlock();
  updateDiplomeStatusBlock();
  updateCasierStatusBlock();
  // Rôle pill
  var rp = g('accRolePill');
  if (rp) rp.textContent = (user.role==='professeur') ? t('role_prof_display') : t('role_eleve_display');
  // Sync bouton dark mode
  updateDarkBtn();
}

function switchATab(s,el){
  ['R','F','H','P','Rev','Rmb','Esp','Avis'].forEach(function(x){
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
  if(s==='P'){updateVerifStatusBlock();updateDiplomeStatusBlock();updateCasierStatusBlock();}
  if(s==='H'){buildHistorique();}
  if(s==='R'){ buildAccLists(); }
  if(s==='F'){ buildAccLists(); }
  if(s==='Rmb'){loadRemboursements();}
  if(s==='Esp'){buildEspProf();}
  if(s==='Avis'){_loadProfAvis();}
}

function buildAccLists(){
  var rIds=Object.keys(res),fIds=Array.from(fol);
  // Stats dans le hero
  var isProf=user&&user.role==='professeur';
  var stats=g('accStats');
  if(stats){
    var nbCours=isProf?C.filter(function(c){return c.pr===user.id&&!_isCoursPass(c);}).length:0;
    var _scSty='background:var(--wh);border-radius:14px;padding:14px 8px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.05);cursor:pointer;-webkit-tap-highlight-color:transparent';
    var _scVal='font-size:22px;font-weight:800;color:var(--or)';
    var _scLbl='font-size:10px;color:var(--lite);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px';
    if(isProf){
      stats.innerHTML=
        '<div class="cp-stat-card" style="'+_scSty+'"><div id="accStatCoursVal" style="'+_scVal+'">'+nbCours+'</div><div style="'+_scLbl+'">'+t('mp_cours')+'</div></div>'+
        '<div class="cp-stat-card" style="'+_scSty+'"><div id="accStatElevesVal" style="'+_scVal+'">'+(user.nbEleves!=null?user.nbEleves:'—')+'</div><div style="'+_scLbl+'">'+t('mp_eleves')+'</div></div>'+
        '<div class="cp-stat-card" style="'+_scSty+'"><div id="accStatNoteVal" style="'+_scVal+'">'+(user.noteMoyenne?'★\u00a0'+user.noteMoyenne:'—')+'</div><div style="'+_scLbl+'">'+t('mp_note')+'</div></div>';
    } else {
      var _enrolledProfIds=(function(){try{return Object.keys(JSON.parse(localStorage.getItem('cp_profs')||'{}'));}catch(e){return [];}})();
      var _allProfIds=new Set(fIds.concat(_enrolledProfIds));
      var _nbHistorique=rIds.filter(function(id){var c=C.find(function(x){return x.id==id;});return !c||_isCoursPass(c);}).length;
      stats.innerHTML=
        '<div class="cp-stat-card" style="'+_scSty+'" onclick="switchATab(\'R\',document.getElementById(\'aTabR\'))"><div style="'+_scVal+'">'+rIds.filter(function(id){var c=C.find(function(x){return x.id==id;});return c&&!_isCoursPass(c);}).length+'</div><div style="'+_scLbl+'">À venir</div></div>'+
        '<div class="cp-stat-card" style="'+_scSty+'" onclick="navTo(\'profs\')"><div style="'+_scVal+'">'+_allProfIds.size+'</div><div style="'+_scLbl+'">Profs</div></div>'+
        '<div class="cp-stat-card" style="'+_scSty+'" onclick="switchATab(\'H\',document.getElementById(\'aTabH\'))"><div style="'+_scVal+'">'+_nbHistorique+'</div><div style="'+_scLbl+'">Historique</div></div>';
    }
  }
  // Rôle pill
  var rp=g('accRolePill');
  if(rp)rp.textContent=isProf?'👨‍🏫 '+t('reg_prof'):'👤 '+t('reg_eleve');
  var lr=g('listR');
  // ── Section réservations (profs n'ont pas de section "Mes cours" ici) ──
  var profCoursHtml='';
  if(false&&isProf){
    var _allMyC=C.filter(function(c){return c.pr===user.id;});
    var myC=_allMyC.filter(function(c){return !_isCoursPass(c);});
    var _pastCnt=_allMyC.filter(function(c){return _isCoursPass(c);}).length;
    profCoursHtml='<div style="padding:20px 20px 0">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      +'<div style="width:28px;height:28px;background:rgba(255,107,43,.1);border-radius:8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg></div>'
      +'<div style="font-size:13px;font-weight:800;color:var(--ink)">Prochains cours</div>'
      +(_pastCnt>0?'<div style="margin-left:auto;font-size:11px;color:var(--lite)">'+_pastCnt+' passé'+((_pastCnt>1)?'s':'')+'</div>':'')
      +'</div>';
    if(!myC.length){
      var _emptyMsg=_pastCnt>0?'Aucun cours à venir — créez-en un nouveau':'Vous n\'avez pas encore créé de cours';
      profCoursHtml+='<div style="background:var(--bg);border-radius:16px;padding:20px;text-align:center">'
        +'<div style="font-size:13px;color:var(--lite);margin-bottom:12px">'+_emptyMsg+'</div>'
        +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:10px 20px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer">Créer un cours →</button>'
        +'</div>';
    } else {
      profCoursHtml+='<div style="display:flex;gap:12px;overflow-x:auto;padding:8px 10px 18px;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:-8px -10px -18px;">';
      myC.forEach(function(c){
        var mat=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
        var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
        var pct=c.sp>0?Math.round(c.fl/c.sp*100):0;
        var isFull=c.fl>=c.sp;
        var _isDkFav=document.documentElement.classList.contains('dk');
        var _favBg=_isDkFav?(mat.bgDark||mat.bg):mat.bg;
        profCoursHtml+='<div class="fav-cours-card" onclick="openR(\''+esc(c.id)+'\')">'
          +'<div class="fav-cours-card-top" style="background:'+_favBg+'">'
          +'<span style="background:rgba(0,0,0,.18);backdrop-filter:blur(6px);color:#fff;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">'+esc(c.subj)+'</span>'
          +(isFull?'<span style="background:rgba(34,192,105,.25);color:#22C069;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:700">'+t('rr_complet')+'</span>':'<span style="background:rgba(0,0,0,.15);color:#fff;border-radius:50px;padding:3px 10px;font-size:10px;font-weight:600">'+c.fl+'/'+c.sp+'</span>')
          +'</div>'
          +'<div class="fav-cours-card-body">'
          +'<div class="fav-cours-card-title">'+esc(c.title)+'</div>'
          +'<div class="fav-cours-card-meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11" style="flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg> '+esc(fmtDt(c.dt))+'</div>'
          +'<div class="fav-cours-card-price">'+pp+'€<span> / '+t('mp_eleves').toLowerCase().replace(/s$/,'')+'</span></div>'
          +'<div style="margin-top:8px;height:4px;background:var(--bg);border-radius:4px;overflow:hidden">'
          +'<div style="height:100%;width:'+pct+'%;background:'+(isFull?'#22C069':'var(--or)')+';border-radius:4px"></div>'
          +'</div>'
          +'<button onclick="event.stopPropagation();addToCalendar(\''+esc(c.id)+'\')" style="margin-top:10px;width:100%;padding:7px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:10px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'+t('card_calendar')+'</button>'
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
  // Séparer les réservations à venir et passées
  var _upcomingRIds=rIds.filter(function(id){var c=C.find(function(x){return x.id==id;});return c&&!_isCoursPass(c);});
  var _pastRIds=rIds.filter(function(id){var c=C.find(function(x){return x.id==id;});return !c||_isCoursPass(c);});
  var _showRIds=_upcomingRIds;
  if(!_showRIds.length){lr.innerHTML+=isProf
    ?'<div style="padding:0 20px 20px;font-size:13px;color:var(--lite)">Aucune réservation à venir</div>'
    :'<div style="text-align:center;padding:40px 20px">'
    +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="30" height="30"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'
    +'</div>'
    +'<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun cours à venir</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:20px">Réservez votre premier cours<br>et retrouvez-le ici</div>'
    +(_pastRIds.length?'<button onclick="switchATab(\'H\',g(\'aTabH\'))" style="background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:50px;padding:10px 20px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;margin-bottom:10px">Voir l\'historique ('+_pastRIds.length+')</button><br>':'')
    +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
    +'</div>';}
  else{
    lr.innerHTML+=_showRIds.map(function(id){
      var c=C.find(function(x){return x.id==id});if(!c)return'';
      var noteBtn='';
      var _mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
      var _isDk=document.documentElement.classList.contains('dk');
      var _bg=_isDk?_mf.bgDark:_mf.bg;
      var _color=_mf.color;
      var _ph=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;
      var _ini=c.prof_ini||(c.prof_nm?c.prof_nm[0]:'?');
      var _phHtml=_ph?'<img src="'+esc(_ph)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':'<span style="font-size:9px;font-weight:700;color:#fff">'+esc(_ini)+'</span>';
      var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
      var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
      return'<div class="rrow" data-id="'+c.id+'" onclick="openR(\''+c.id+'\')" style="background:var(--wh);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);border:1px solid var(--bdr);margin:0 20px 12px;cursor:pointer;transition:opacity .15s;active:opacity:.8" onmousedown="this.style.opacity=\'.85\'" onmouseup="this.style.opacity=\'1\'" onmouseleave="this.style.opacity=\'1\'">'
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
        +'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(fmtDt(c.dt))+'</span>'
        +(_isVisio?'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Visio</span>':'<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(c.lc)+'</span>')
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:8px">'
        +'<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#FF8C55,var(--ord));display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0" data-prof="'+c.pr+'">'+_phHtml+'</div>'
        +'<span data-profnm="'+c.pr+'" style="font-size:12px;color:var(--mid);font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc((P[c.pr]&&P[c.pr].nm)||c.prof_nm||t('reg_prof'))+'</span>'
        +(pp?'<span style="font-size:13px;font-weight:800;color:var(--or)">'+pp+'€<span style="font-size:10px;font-weight:500;color:var(--lite)"> / '+t('mp_eleves').toLowerCase().replace(/s$/,'')+'</span></span>':'')
        +(noteBtn?'<span>'+noteBtn+'</span>':'')
        +'</div>'
        +'</div>'
        +'</div>';
    }).join('');
  }
  // Swipe sur les cours à venir
  setTimeout(function(){
    if(g('listR'))g('listR').querySelectorAll('.rrow').forEach(function(el){
      initSwipeCancel(el,function(){
        var cid=el.dataset.id;
        var c=cid?C.find(function(x){return x.id==cid;}):null;
        var profNm=c?(P[c.pr]&&P[c.pr].nm)||c.prof_nm||'le professeur':'le professeur';
        var profPhoto=c?(P[c.pr]&&P[c.pr].photo)||c.prof_photo||null:null;
        if(!confirm(t('confirm_cancel_swap').replace('{prof}',profNm)))return;
        if(c&&c.pr)openMsg(profNm,c.pr,profPhoto);
      });
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
          p={nm:_cc[0].prof_nm||t('reg_prof'),i:_cc[0].prof_ini||'?',col:'linear-gradient(135deg,#FF8C55,#E04E10)',e:0,photo:_cc[0].prof_photo||null};
        } else {
          p={nm:'Professeur',i:'?',col:'linear-gradient(135deg,#FF8C55,#E04E10)',e:0};
        }
        P[id]=p;
      }
      // Toujours vérifier les données fraîches — _fetchProf retourne immédiatement si déjà _fresh
      _fetchProf(id);
      var cours=C.filter(function(c){return c.pr===id;});
      var matieres=cours.length?[...new Set(cours.map(function(c){return c.subj;}))].slice(0,2).join(', '):'';
      var _now2=Date.now();
      var prochainCours=cours.filter(function(c){var _t=c.dt_iso?new Date(c.dt_iso).getTime():(c.dt?new Date(c.dt).getTime():0);return c.fl<c.sp&&(!_t||_t>_now2);}).length;
      var av=p.photo?'<img src="'+p.photo+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=1">':
        '<span style="font-size:15px;font-weight:800;color:var(--or)">'+p.i+'</span>';
      var border=i<fIds.length-1?'border-bottom:1px solid var(--bdr)':'';
      var dispoLabel=prochainCours?' · <span style="color:var(--or);font-weight:600">'+prochainCours+' cours dispo</span>':'';
      return'<div onclick="openPr(\''+id+'\')" class="fol-row" data-prof-id="'+id+'" style="'+border+'">'
        +'<div style="width:46px;height:46px;border-radius:50%;background:'+p.col+';display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">'+av+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:15px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.nm+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+(matieres||t('reg_prof'))+dispoLabel+'</div>'
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
      lf.innerHTML='<div class="cp-fol-list" style="background:var(--wh);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.07);border:1px solid rgba(0,0,0,.04)">'+folRows+'</div>';
    }
  }
}

function setPfRole(role){
  g('pfRolEl').classList.toggle('on',role==='eleve');
  g('pfRolPf').classList.toggle('on',role==='professeur');
  g('pfProfExtra').style.display=role==='professeur'?'block':'none';
}

function _updatePfVilleLabel(){
  var lbl=g('pfVilleLabel');
  if(!lbl||!user)return;
  if(user.role==='eleve'){
    lbl.textContent=t('pc_ou_etudiez');
  } else {
    var st=user.statut||'';
    if(st==='etudiant') lbl.textContent=t('pc_ou_etudiez');
    else if(st==='auto'||st==='autre') lbl.textContent=t('pc_ou_travaillez');
    else lbl.textContent=t('pc_ou_enseignez');
  }
}

function saveProf(){
  if(!user)return;
  user.pr=g('pfPr').value||user.pr;user.nm=g('pfNm').value||'';
  user.em=g('pfEm').value||user.em;user.ville=g('pfVille').value||'';
  user.bio=g('pfBio').value||'';
  user.lieu=g('pfLieu')?g('pfLieu').value||'':'';
  var _pfVilleVisEl=g('pfVilleVisible');
  if(_pfVilleVisEl)user.ville_visible=_pfVilleVisEl.classList.contains('on');
  var _pfLieuVisEl=g('pfLieuVisible');
  if(_pfLieuVisEl)user.lieu_visible=_pfLieuVisEl.classList.contains('on');
  // Ne pas changer le rôle
  user.ini=((user.pr&&user.pr[0]?user.pr[0]:'')+(user.nm&&user.nm[0]?user.nm[0]:'')).toUpperCase()||'U';
  if(user.role==='professeur'){
    if(g('pfStatut'))user.statut=g('pfStatut').value;
    if(g('pfNiveau'))user.niveau=g('pfNiveau').value;
    // Lire les matières depuis les chips (source de vérité = _matieres[])
    user.matieres=_matieres.join(', ');
    var matHid=g('pfMatieresVal');if(matHid)matHid.value=user.matieres;
    if(g('pfFormations'))user.formations=g('pfFormations').value.trim();
    if(g('pfExperiences'))user.experiences=g('pfExperiences').value.trim();
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
    var payload={prenom:user.pr,nom:user.nm,bio:user.bio||'',ville:user.ville||'',ville_visible:user.ville_visible||false,lieu:user.lieu||'',lieu_visible:user.lieu_visible||false};
    if(user.role==='professeur'){
      payload.statut=user.statut||'';
      payload.niveau=user.niveau||'';
      payload.matieres=user.matieres||'';
      payload.formations=user.formations||'';
      payload.experiences=user.experiences||'';
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
        if(data.profile.ville_visible!==undefined)user.ville_visible=data.profile.ville_visible;
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Re-render les chips avec la valeur confirmée par le serveur
        if(user.role==='professeur') initMatieresChips(user.matieres||'');
      }
    }).catch(function(){toast(t('t_net_error'),t('t_prof_not_saved'));});
  }
  // Mettre à jour UI sans quitter la page profil
  setAvatar(g('tav'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
  setAvatar(g('tavMob'),user.photo,user.ini,'linear-gradient(135deg,#FF8C55,var(--ord))');
  var an=g('accName');if(an)an.textContent=user.pr+(user.nm?' '+user.nm:'');
  var ae=g('accEmail');if(ae)ae.textContent=user.em;
  setAvatar(g('accAv'),user.photo,user.ini,'rgba(255,255,255,.2)');
  toast(t('t_profile_saved'),'');
  // Sync photo partout si présente
  if(user&&user.photo) _applyPhotoPartout(user.photo);
}

function doLogout(){
  var _fkLogout=_folKey(); // sauvegarder la clé AVANT user=null (sinon _folKey() retourne null)
  _followsInitialized=false;
  user=null;
  _tutoLaunched=false;
  clearInterval(msgBadgePollTimer);msgBadgePollTimer=null;
  clearInterval(_accountCheckTimer);_accountCheckTimer=null;
  _stopAutoRefresh();
  try{localStorage.removeItem('cp_user');}catch(e){}
  try{localStorage.removeItem('cp_res');}catch(e){}
  try{localStorage.removeItem('cp_profs');}catch(e){}
  try{localStorage.removeItem('cp_follow_counts');}catch(e){}
  Object.keys(res).forEach(function(k){delete res[k]});fol.clear();favCours.clear();Object.keys(P).forEach(function(k){delete P[k]});
  _convCache='';
  try{localStorage.removeItem(_COURS_CACHE_KEY);}catch(e){}
  try{if(_fkLogout)localStorage.removeItem(_fkLogout);}catch(e){}
  try{localStorage.removeItem('cp_fav_cours');}catch(e){} // nettoyer la clé fallback sans user.id
  try{localStorage.removeItem('cp_enrolled_profs');}catch(e){}
  // Cacher la bnav immédiatement
  var bnav=g('bnav');if(bnav)bnav.classList.remove('on');
  // Restaurer les items bnav pour la prochaine connexion
  var bniMsg=g('bniMsg'),bniAcc=g('bniAcc'),bniAdd=g('bniAdd');
  if(bniMsg)bniMsg.style.display='';
  if(bniAcc)bniAcc.style.display='';
  if(bniAdd)bniAdd.style.display='none';
  // Nettoyer les badges (évite badges fantômes pour la prochaine session)
  var _bb=g('bnavBadge');if(_bb){_bb.classList.remove('on');_bb.textContent='';}
  var _bf=g('bnavFavBadge');if(_bf){_bf.style.display='none';_bf.textContent='';}
  // Reset avatar
  var tav=g('tav');if(tav){tav.style.background='linear-gradient(135deg,#FF8C55,var(--ord))';tav.textContent='?';}
  var tavM=g('tavMob');if(tavM){tavM.style.background='linear-gradient(135deg,#FF8C55,var(--ord))';tavM.textContent='?';}
  // Reset état nav
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg'),pgMes=g('pgMes'),pgFav=g('pgFav');
  if(pgExp)pgExp.classList.add('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  if(pgMes)pgMes.classList.remove('on');
  if(pgFav)pgFav.classList.remove('on');
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
  // Effacer le contexte utilisateur Sentry à la déconnexion
  if(typeof setSentryUser==='function')setSentryUser(null);
  toast(t('t_disconn'),t('t_disconn_sub'));
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
      toast(t('t_photo_heavy'),t('t_photo_heavy_s'));
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
            toast(t('t_photo_ok'),'');
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
    if(prof.verified!==undefined)P[pid].verified=prof.verified;
    if(prof.diplome_verifie!==undefined)P[pid].dv=prof.diplome_verifie;
    if(prof.casier_verifie!==undefined)P[pid].cv=prof.casier_verifie;
    if(prof.statut!==undefined)P[pid].statut=prof.statut;
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
        el.innerHTML='<img src="'+esc(prof.photo_url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=\'1\'">';
      });
    }
    // Mettre à jour le compteur d'abonnés depuis l'API (synchronisation inter-comptes)
    var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
    if(_nbE!==undefined){
      P[pid].e=_nbE; // source de vérité serveur (pas de Math.max — sinon le count ne peut pas baisser)
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
    // Rafraîchir Mes Profs si l'onglet est visible (cartes skeleton)
    if(g('pgMesProfs')&&g('pgMesProfs').classList.contains('on'))buildMesProfs();
    // Invalider le cache conversations (photo/nom mis à jour → forcer re-rendu)
    _convCache='';
  }).catch(function(){});
}
function _buildCourseCard(c){
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  var isR=!!res[c.id],isFull=c.fl>=c.sp;
  var isOwner=user&&c.pr===user.id;
  var _pPhoto=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;
  var _avCol=esc(c.prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)');var _avIni=esc(c.prof_ini||'?');
  var _avIniSpan='<span style="pointer-events:none">'+_avIni+'</span>';
  var profAv=_pPhoto
    ?('<img src="'+esc(_pPhoto)+'" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display=\'none\';this.parentNode.style.background=\''+_avCol+'\'">'+_avIniSpan)
    :_avIniSpan;
  var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  var subjBadge='<span class="card-badge-subj" style="background:'+esc(c.sc)+'">'+esc(c.subj)+'</span>';
  var modeIcon=_isVisio?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="8" height="8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="8" height="8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var modeBadge='<span class="card-badge-mode-new">'+modeIcon+(_isVisio?t('filter_mode_vis').replace(/\s*\(.*\)/,''):t('filter_mode_pres').replace(/\s*\(.*\)/,''))+'</span>';
  var miniFollowBtn='';
  if(user&&!user.guest&&!isOwner){
    var isFolP=fol.has(c.pr);
    var miniSvgOn='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg>';
    var miniSvgOff='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    miniFollowBtn='<button class="card-follow-btn card-follow-mini" data-pid="'+c.pr+'" data-fol="'+(isFolP?'1':'0')+'" onclick="event.stopPropagation();toggleFollowCard(\''+c.pr+'\',this)" title="'+(isFolP?t('fol_remove'):t('fol_add'))+'" style="background:'+(isFolP?'#FF6B35':'#fff')+'">'+(isFolP?miniSvgOn:miniSvgOff)+'</button>';
  }
  var profAvDiv='<div class="card-prof-av" style="background:'+_avCol+';" onclick="event.stopPropagation();openPr(\''+c.pr+'\')">'+profAv+miniFollowBtn+'</div>';
  var schedHtml='<div class="card-sched"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'+esc(fmtDt(c.dt))+'</div>';
  var locHtml=(!_isVisio&&c.lc)?'<div class="card-location"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(c.lc)+'</div>':'';
  var heartHtml='';
  if(user&&!user.guest){
    var isSaved=favCours.has(c.id);
    heartHtml='<button class="card-fav-btn'+(isSaved?' saved':'')+'" onclick="event.stopPropagation();toggleFavCours(\''+c.id+'\',this)" title="Sauvegarder" aria-label="Sauvegarder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></button>';
  }
  var btnHtml;
  if(isOwner) btnHtml='<button class="card-btn-reserve card-btn-consult" onclick="event.stopPropagation();openR(\''+c.id+'\')">'+t('card_consult')+'</button>';
  else if(isR&&isFull) btnHtml='<button class="card-btn-reserve card-btn-inscrit" onclick="event.stopPropagation();openO(\''+c.id+'\')" style="font-size:11.5px">'+t('rr_deja')+' · '+t('rr_complet')+'</button>';
  else if(isR) btnHtml='<button class="card-btn-reserve card-btn-inscrit" onclick="event.stopPropagation();openO(\''+c.id+'\')" style="font-size:11.5px">'+t('rr_deja')+' · +</button>';
  else if(isFull) btnHtml='<button class="card-btn-reserve card-btn-full" onclick="event.stopPropagation();openF(\''+c.pr+'\',\''+c.title+'\')">'+t('rr_complet')+'</button>';
  else btnHtml='<button class="card-btn-reserve" onclick="event.stopPropagation();openR(\''+c.id+'\')">'+t('card_reserve')+'</button>';
  var wrap=document.createElement('div');
  wrap.className='card-wrap'+(c.prive?' card-prive-wrap':'');
  wrap.dataset.id=c.id;wrap.dataset.t=c.t;wrap.dataset.coursId=c.id;
  wrap.onclick=function(){if(isFull&&!isR){openF(c.pr,c.title);return;}openR(c.id);};
  wrap.addEventListener('touchstart',function(){this.classList.add('tapped');},{passive:true});
  wrap.addEventListener('touchend',function(){this.classList.remove('tapped');});
  wrap.addEventListener('touchcancel',function(){this.classList.remove('tapped');});
  wrap.innerHTML=
    subjBadge+modeBadge+profAvDiv+
    '<div class="card card-new'+(c.prive?' card-prive':'')+'">'+
      '<div class="card-body-new">'+
        '<div class="card-title-new">'+esc(c.title)+'</div>'+
        (c.description?'<div class="card-desc-preview">'+esc(c.description)+'</div>':'')+
        schedHtml+locHtml+
        '<div class="card-sep-dash"></div>'+
        '<div class="card-foot">'+
          '<div class="card-price-block">'+
            '<div class="card-price-val">'+pp+'€</div>'+
            '<div class="card-price-sub">/ '+t('mp_eleves').toLowerCase().replace(/s$/,'')+'</div>'+
          '</div>'+
          '<div class="card-circles-wrap">'+buildPlacesCircles(c.fl,c.sp)+'</div>'+
          heartHtml+btnHtml+
        '</div>'+
      '</div>'+
    '</div>';
  return wrap;
}
function buildCards(){
  currentPage=1;
  var nc=g('nocard'),lmw=g('loadMoreWrap'),gr=g('grid');
  if(!C.length){
    // Éviter de re-render si nocard est déjà affiché (évite les sauts visuels)
    if(nc&&nc.style.display==='block')return;
    if(nc)nc.style.display='block';
    var nt=g('nocardTitle'),ns=g('nocardSub');
    if(nt)nt.textContent=t('aucun_cours_dispo');
    if(ns)ns.textContent=t('exp_first_course');
    if(lmw)lmw.style.display='none';
    if(gr)gr.innerHTML='';
    return;
  }
  if(nc)nc.style.display='none';
  applyFilter();
  _syncAllFollowBtns(); // garantit l'état follow correct après chaque rendu
  // Nettoyer les favoris obsolètes : cours supprimés du serveur (plus dans C[])
  // Seulement quand _allLoaded=true pour éviter de supprimer des cours en page 2+
  if(_allLoaded&&favCours.size){
    var _changed=false;
    favCours.forEach(function(id){
      var inC=C.find(function(x){return String(x.id)===String(id);});
      var inHist=_histCache&&_histCache[String(id)];
      // Pas dans C[] ni dans l'historique → cours supprimé côté serveur → purger
      if(!inC&&!inHist){favCours.delete(id);_changed=true;}
    });
    if(_changed)saveFavCours();
  }
  updateFavBadge(); // recalcule le badge avec C[] chargé pour exclure les cours passés
  // Rafraîchir la page favoris si elle est active (les skeletons deviendraient sinon permanents)
  var _pfav=g('pgFav');if(_pfav&&_pfav.classList.contains('on'))buildFavPage();
}

function applyFilter(){
  var mobInp=document.getElementById('mobSearchInput');
  var srchInp=document.getElementById('srch');
  var raw='';
  if(mobInp&&mobInp.value)raw=mobInp.value;
  else if(srchInp)raw=srchInp.value;
  raw=raw.trim();
  var q=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  var qAlias='';
  if(typeof resolveAlias==='function'&&raw.length>=2){
    var _alR=resolveAlias(raw);
    if(_alR)qAlias=_alR.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }
  var fmAlias=qAlias?(_ALIAS_FM[qAlias]||(FM[qAlias]?qAlias:null)):null;
  filteredCards=C.filter(function(c){
    // Cours passés cachés de l'explorateur
    if(_isCoursPass(c))return false;
    // Cours privés cachés sauf si propriétaire ou déjà réservé
    if(c.prive&&!(user&&c.pr===user.id)&&!res[c.id])return false;
    var title=(c.title||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var subj=(c.subj||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var loc=(c.lc||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var prof=(c.prof_nm||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var desc=(c.description||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var matchFilter=(FM[actF]||FM.tous)(c.t||'');
    // Recherche dans le nom du prof + toutes les données du cours
    var matchSearch=!q||(title.includes(q)||subj.includes(q)||loc.includes(q)||prof.includes(q)||desc.includes(q)||
      (qAlias&&(title.includes(qAlias)||subj.includes(qAlias)||prof.includes(qAlias)))||
      (fmAlias&&FM[fmAlias]&&FM[fmAlias](c.t||'')));
    // Si la recherche ne matche pas un cours, chercher aussi les profs par nom
    if(!matchSearch&&q.length>1){
      var profFull=(c.prof_nm||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      matchSearch=profFull.includes(q)||(qAlias&&profFull.includes(qAlias));
    }
    // Filtre localisation
    var matchLoc=true;
    if(geoMode&&_geoCoords&&c.lat&&c.lon){
      var dist=haversine(_geoCoords.lat,_geoCoords.lon,parseFloat(c.lat),parseFloat(c.lon));
      matchLoc=dist<=_geoDist;
    } else if(actLoc){
      matchLoc=loc.includes(actLoc);
    }
    var matchNiv=!actNiv||(c.niveau||'')===actNiv||(NIV_GROUPES[actNiv]&&NIV_GROUPES[actNiv].indexOf(c.niveau||'')>=0);
    var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
    var matchMode=!actMode||(actMode==='visio'?_isVisio:!_isVisio);
    var matchDate=true;
    if(actDate){
      var _DAY_MAP={lundi:1,mardi:2,mercredi:3,jeudi:4,vendredi:5,samedi:6,dimanche:0};
      if(c.dt_iso){
        var _now=new Date(),_dt=new Date(c.dt_iso);
        if(actDate==='semaine'){
          var _d=_now.getDay(),_diff=_d===0?-6:1-_d;
          var _wS=new Date(_now);_wS.setHours(0,0,0,0);_wS.setDate(_now.getDate()+_diff);
          var _wE=new Date(_wS);_wE.setDate(_wS.getDate()+7);
          matchDate=_dt>=_wS&&_dt<_wE;
        }else if(actDate==='mois'){
          matchDate=_dt.getFullYear()===_now.getFullYear()&&_dt.getMonth()===_now.getMonth();
        }else if(actDate in _DAY_MAP){
          matchDate=_dt.getDay()===_DAY_MAP[actDate];
        }
      }else{matchDate=false;}
    }
    return matchFilter&&matchSearch&&matchLoc&&matchNiv&&matchMode&&matchDate;
  });
  updateResetBtn();
  renderPage();
}

function toggleFollowCard(pid,btn){
  if(!user||user.guest){toast(t('t_follow_login'),'');return;}
  if(!pid)return;
  if(_followInFlight.has(pid))return; // anti-spam : request déjà en cours
  _followInFlight.add(pid);
  var isFollowing=fol.has(pid);
  if(isFollowing){
    fol.delete(pid);_saveFol();
    _syncFollowBtns(pid,false);
    P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[pid].e=Math.max(0,(P[pid].e||1)-1);
    toast(t('t_unfollowed'),'');
    fetch(API+'/follows',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
      .then(function(r){return r.json();})
      .then(function(data){
        _followInFlight.delete(pid);
        if(data&&data.nb_eleves!==undefined){
          P[pid].e=data.nb_eleves;
          if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid].e;
          _saveFollowCount(pid,P[pid].e);
        }
      })
      .catch(function(){
        _followInFlight.delete(pid);
        fol.add(pid);_saveFol();_syncFollowBtns(pid,true);
        P[pid]=P[pid]||{};P[pid].e=(P[pid].e||0)+1;
        if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
        _saveFollowCount(pid,P[pid].e||0);
        toast(t('t_net_error'),'');
      });
  } else {
    fol.add(pid);_saveFol();
    _syncFollowBtns(pid,true);
    P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[pid].e=(P[pid].e||0)+1;
    toast(t('t_followed'),t('t_followed_sub'));
    fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
      .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
      .then(function(data){
        _followInFlight.delete(pid);
        if(data&&data.error)throw new Error(data.error);
        if(data&&data.nb_eleves!==undefined){
          P[pid].e=data.nb_eleves;
          if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid].e;
          _saveFollowCount(pid,P[pid].e);
        }
      })
      .catch(function(){
        _followInFlight.delete(pid);
        fol.delete(pid);_saveFol();_syncFollowBtns(pid,false);
        P[pid]=P[pid]||{};P[pid].e=Math.max(0,(P[pid].e||1)-1);
        if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
        _saveFollowCount(pid,P[pid].e||0);
        toast(t('t_net_error'),'');
      });
  }
  // Mettre à jour mpE immédiatement (valeur optimiste)
  if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
  // Persister le compteur dans le cache localStorage
  if(P[pid]){try{var _pc3=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc3[pid])_pc3[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||''};_pc3[pid].e=P[pid].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc3));}catch(ex){}_saveFollowCount(pid,P[pid].e||0);}
  // Rebuild le compteur "Suivis" dans les stats si l'onglet suivi est visible
  if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
  updateFavBadge();
  haptic(8);
}

function buildPlacesCircles(fl,sp){
  var pleft=sp-fl;
  var pct=sp>0?Math.round(fl/sp*100):100;
  var cls=pleft<=0?' full':pleft===1?' last':'';
  var barColor=pleft<=0?'#9CA3AF':pleft===1?'#EF4444':'#FF6B35';
  var txt=pleft<=0?t('rr_complet'):pleft===1?t('rr_place'):pleft+' '+t('rr_places');
  return '<div class="places-bar"><div class="places-bar-fill" style="width:'+pct+'%;background:'+barColor+'"></div></div>'
    +'<span class="card-places-count'+cls+'">'+txt+'</span>';
}

function renderPage(){
  var grid=g('grid');if(!grid)return;
  var sorted=sortCourses(filteredCards);
  var toShow=sorted.slice(0,currentPage*PAGE_SIZE);
  var sc=g('sortResultCount');if(sc)sc.textContent=filteredCards.length+' cours';
  var _nc=g('nocard'),_lmw=g('loadMoreWrap');
  if(!toShow.length){
    grid.innerHTML='';
    if(_nc)_nc.style.display='block';
    var _nt=g('nocardTitle'),_ns=g('nocardSub');
    if(_nt)_nt.textContent=t('exp_empty_title');
    if(_ns)_ns.textContent=t('exp_empty_sub');
    if(_lmw)_lmw.style.display='none';
    return;
  }
  if(_nc)_nc.style.display='none';
  var _frag=document.createDocumentFragment();
  toShow.forEach(function(c,i){
    _frag.appendChild(_buildCourseCard(c));
  });
  grid.innerHTML='';
  grid.appendChild(_frag);
  g('loadMoreWrap').style.display=filteredCards.length>currentPage*PAGE_SIZE?'block':'none';
  if(filteredCards.length>currentPage*PAGE_SIZE)g('loadMoreCount').textContent=(filteredCards.length-currentPage*PAGE_SIZE)+' cours restants';
  // Animation entrée : cards déjà visibles → apparaissent immédiatement (pas de flash)
  // Cards sous le fold → masquées, animées quand elles entrent dans le viewport
  if(typeof IntersectionObserver!=='undefined'){
    var _vH=window.innerHeight||document.documentElement.clientHeight;
    var _io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting)return;
        _io.unobserve(e.target);
        e.target.classList.add('card-in');
        e.target.addEventListener('animationend',function(){
          e.target.classList.remove('card-in','card-below');
        },{once:true});
      });
    },{threshold:0.05});
    grid.querySelectorAll('.card-wrap').forEach(function(w){
      // Seulement masquer les cards vraiment hors-écran (sous le fold)
      if(w.getBoundingClientRect().top>=_vH-10){
        w.classList.add('card-below');
        _io.observe(w);
      }
    });
  }
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
  // --- Sciences exactes ---
  {label:'Maths',                  key:'maths',          color:'#3B82F6', bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1E3A5F)'},
  {label:'Statistiques',           key:'stats',          color:'#60A5FA', bg:'linear-gradient(135deg,#EFF6FF,#BFDBFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1A3560)'},
  {label:'Physique',               key:'physique',       color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'Chimie',                 key:'chimie',         color:'#06B6D4', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'SVT / Biologie',         key:'svt',            color:'#10B981', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Astronomie',             key:'astro',          color:'#4F46E5', bg:'linear-gradient(135deg,#EEF2FF,#C7D2FE)', bgDark:'linear-gradient(135deg,#0D0B35,#1A1760)'},
  {label:'Géologie',               key:'geologie',       color:'#92400E', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Médecine / Santé',       key:'medecine',       color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Écologie',               key:'ecologie',       color:'#16A34A', bg:'linear-gradient(135deg,#F0FDF4,#BBFFD1)', bgDark:'linear-gradient(135deg,#052E16,#083D1A)'},
  // --- Numérique & Tech ---
  {label:'Informatique',           key:'informatique',   color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Python',                 key:'python',         color:'#3B82F6', bg:'linear-gradient(135deg,#EFF6FF,#BFDBFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1E3A5F)'},
  {label:'JavaScript',             key:'javascript',     color:'#EAB308', bg:'linear-gradient(135deg,#FEFCE8,#FEF08A)', bgDark:'linear-gradient(135deg,#2D2300,#3D3000)'},
  {label:'Développement web',      key:'devweb',         color:'#8B5CF6', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  {label:'Data Science',           key:'data',           color:'#F97316', bg:'linear-gradient(135deg,#FFF7ED,#FED7AA)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'IA & Machine Learning',  key:'ia',             color:'#06B6D4', bg:'linear-gradient(135deg,#ECFEFF,#A5F3FC)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Électronique',           key:'electronique',   color:'#FCD34D', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1F00,#4A3300)'},
  {label:'Design / UI',            key:'design',         color:'#EC4899', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Cybersécurité',          key:'cyber',          color:'#DC2626', bg:'linear-gradient(135deg,#FEF2F2,#FECACA)', bgDark:'linear-gradient(135deg,#2D0808,#4A1010)'},
  {label:'No-code',                key:'nocode',         color:'#10B981', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Blockchain',             key:'blockchain',     color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  // --- Langues ---
  {label:'Français',               key:'francais',       color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Anglais',                key:'anglais',        color:'#3B82F6', bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1E3A5F)'},
  {label:'Espagnol',               key:'espagnol',       color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Allemand',               key:'allemand',       color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Italien',                key:'italien',        color:'#10B981', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Portugais',              key:'portugais',      color:'#22D3EE', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Arabe',                  key:'arabe',          color:'#22C55E', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)', bgDark:'linear-gradient(135deg,#052E16,#0A3D20)'},
  {label:'Chinois',                key:'chinois',        color:'#DC2626', bg:'linear-gradient(135deg,#FEF2F2,#FECACA)', bgDark:'linear-gradient(135deg,#2D0808,#4A1010)'},
  {label:'Japonais',               key:'japonais',       color:'#FB7185', bg:'linear-gradient(135deg,#FFF1F2,#FFE4E6)', bgDark:'linear-gradient(135deg,#2D0A10,#4A1520)'},
  {label:'Russe',                  key:'russe',          color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'Coréen',                 key:'coreen',         color:'#8B5CF6', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  {label:'Hindi',                  key:'hindi',          color:'#F97316', bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Latin',                  key:'latin',          color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Langue des signes',      key:'lsf',            color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#DDD6FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  // --- Lettres & Écriture ---
  {label:'Écriture créative',      key:'ecriture',       color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Philosophie',            key:'philo',          color:'#818CF8', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1A1F5E)'},
  {label:'Théâtre',                key:'theatre',        color:'#EC4899', bg:'linear-gradient(135deg,#FDF2F8,#FBCFE8)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Cinéma / Vidéo',         key:'cinema',         color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#C7D2FE)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'BD / Manga',             key:'bd',             color:'#F97316', bg:'linear-gradient(135deg,#FFF7ED,#FED7AA)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  // --- Arts visuels ---
  {label:'Dessin',                 key:'dessin',         color:'#E879F9', bg:'linear-gradient(135deg,#FDF4FF,#FAE8FF)', bgDark:'linear-gradient(135deg,#2A0830,#3D1250)'},
  {label:'Peinture',               key:'peinture',       color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Aquarelle',              key:'aquarelle',      color:'#60A5FA', bg:'linear-gradient(135deg,#EFF6FF,#BFDBFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1A3560)'},
  {label:'Arts plastiques',        key:'arts',           color:'#D946EF', bg:'linear-gradient(135deg,#FDF4FF,#F5D0FE)', bgDark:'linear-gradient(135deg,#2A0830,#3D1250)'},
  {label:'Calligraphie',           key:'calligraphie',   color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Photographie',           key:'photo',          color:'#64748B', bg:'linear-gradient(135deg,#F8FAFC,#E2E8F0)', bgDark:'linear-gradient(135deg,#0F1720,#1A2535)'},
  {label:'Illustration',           key:'illustration',   color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FBCFE8)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  // --- Musique ---
  {label:'Musique',                key:'musique',        color:'#FCD34D', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1F00,#4A3300)'},
  {label:'Piano',                  key:'piano',          color:'#475569', bg:'linear-gradient(135deg,#F8FAFC,#E2E8F0)', bgDark:'linear-gradient(135deg,#0F1720,#1A2535)'},
  {label:'Guitare',                key:'guitare',        color:'#B45309', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1500,#4A2500)'},
  {label:'Chant',                  key:'chant',          color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Batterie',               key:'batterie',       color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Violon',                 key:'violon',         color:'#92400E', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1500,#4A2000)'},
  {label:'Saxophone',              key:'saxo',           color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  // --- Sciences humaines ---
  {label:'Histoire-Géo',           key:'histoire',       color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Psychologie',            key:'psycho',         color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  {label:'Sociologie',             key:'socio',          color:'#818CF8', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1A1F5E)'},
  {label:'Géographie',             key:'geographie',     color:'#22D3EE', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Sciences politiques',    key:'sciencespol',    color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#C7D2FE)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'Anthropologie',          key:'anthropo',       color:'#B45309', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1500,#4A2500)'},
  // --- Business & Droit ---
  {label:'Économie',               key:'economie',       color:'#2DD4BF', bg:'linear-gradient(135deg,#F0FDFA,#CCFBF1)', bgDark:'linear-gradient(135deg,#052825,#084035)'},
  {label:'Comptabilité',           key:'compta',         color:'#22D3EE', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Finance',                key:'finance',        color:'#10B981', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Marketing',              key:'marketing',      color:'#FB923C', bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Droit',                  key:'droit',          color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Entrepreneuriat',        key:'entrepreneuriat',color:'#F97316', bg:'linear-gradient(135deg,#FFF7ED,#FED7AA)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Gestion de projet',      key:'gestion',        color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'Communication',          key:'communication',  color:'#EC4899', bg:'linear-gradient(135deg,#FDF2F8,#FBCFE8)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'RH & Recrutement',       key:'rh',             color:'#8B5CF6', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  {label:'Immobilier',             key:'immo',           color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Architecture',           key:'architecture',   color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  // --- Prépa & Concours ---
  {label:'CPGE / Prépa',           key:'prepa',          color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Médecine (PASS/LAS)',     key:'pass',           color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Sciences Po',            key:'sciencespo',     color:'#6366F1', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1E1F5E)'},
  {label:'TOEFL / IELTS',          key:'toefl',          color:'#3B82F6', bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)', bgDark:'linear-gradient(135deg,#0F1F3D,#1E3A5F)'},
  {label:'GMAT / GRE',             key:'gmat',           color:'#22D3EE', bg:'linear-gradient(135deg,#ECFEFF,#CFFAFE)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  // --- Sport ---
  {label:'Sport / EPS',            key:'sport',          color:'#4ADE80', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)', bgDark:'linear-gradient(135deg,#052E16,#0A3D20)'},
  {label:'Fitness',                key:'fitness',        color:'#22C55E', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)', bgDark:'linear-gradient(135deg,#052E16,#0A3D20)'},
  {label:'Yoga / Méditation',      key:'yoga',           color:'#34D399', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Arts martiaux',          key:'martial',        color:'#EF4444', bg:'linear-gradient(135deg,#FEF2F2,#FEE2E2)', bgDark:'linear-gradient(135deg,#2D0A0A,#4A1515)'},
  {label:'Danse',                  key:'danse',          color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Natation',               key:'natation',       color:'#06B6D4', bg:'linear-gradient(135deg,#ECFEFF,#A5F3FC)', bgDark:'linear-gradient(135deg,#032835,#064E5E)'},
  {label:'Tennis',                 key:'tennis',         color:'#84CC16', bg:'linear-gradient(135deg,#F7FEE7,#ECFCCB)', bgDark:'linear-gradient(135deg,#172805,#243D08)'},
  {label:'Football',               key:'football',       color:'#16A34A', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)', bgDark:'linear-gradient(135deg,#052E16,#083D1A)'},
  {label:'Basket',                 key:'basket',         color:'#F97316', bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Running',                key:'running',        color:'#F59E0B', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#4A2E00)'},
  {label:'Boxe / MMA',             key:'boxe',           color:'#DC2626', bg:'linear-gradient(135deg,#FEF2F2,#FECACA)', bgDark:'linear-gradient(135deg,#2D0808,#4A1010)'},
  {label:'Golf',                   key:'golf',           color:'#16A34A', bg:'linear-gradient(135deg,#F0FDF4,#BBFFD1)', bgDark:'linear-gradient(135deg,#052E16,#083D1A)'},
  // --- Bien-être ---
  {label:'Nutrition / Diététique', key:'nutrition',      color:'#10B981', bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)', bgDark:'linear-gradient(135deg,#062318,#0D3D2B)'},
  {label:'Développement perso',    key:'devperso',       color:'#A78BFA', bg:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', bgDark:'linear-gradient(135deg,#1A1035,#2A1B5E)'},
  // --- Cuisine & Artisanat ---
  {label:'Cuisine / Gastronomie',  key:'cuisine',        color:'#FB923C', bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)', bgDark:'linear-gradient(135deg,#2D1200,#4A2000)'},
  {label:'Pâtisserie',             key:'patisserie',     color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Jardinage',              key:'jardinage',      color:'#22C55E', bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)', bgDark:'linear-gradient(135deg,#052E16,#083D1A)'},
  {label:'Bricolage',              key:'bricolage',      color:'#D97706', bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)', bgDark:'linear-gradient(135deg,#2D1A00,#3D2200)'},
  {label:'Couture / Tricot',       key:'couture',        color:'#EC4899', bg:'linear-gradient(135deg,#FDF2F8,#FBCFE8)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Broderie',               key:'broderie',       color:'#F472B6', bg:'linear-gradient(135deg,#FDF2F8,#FCE7F3)', bgDark:'linear-gradient(135deg,#2D0A1E,#4A1535)'},
  {label:'Poterie / Céramique',    key:'poterie',        color:'#B45309', bg:'linear-gradient(135deg,#FFFBEB,#FDE68A)', bgDark:'linear-gradient(135deg,#2D1500,#4A2500)'},
  // --- Jeux & Loisirs ---
  {label:'Jeux de soci\u00e9t\u00e9', key:'jeux',       color:'#818CF8', bg:'linear-gradient(135deg,#EEF2FF,#E0E7FF)', bgDark:'linear-gradient(135deg,#0F1235,#1A1F5E)'},
  {label:'\u00c9checs',            key:'echecs',         color:'#475569', bg:'linear-gradient(135deg,#F8FAFC,#E2E8F0)', bgDark:'linear-gradient(135deg,#0F1720,#1A2535)'},
  // --- Autre ---
  {label:'Autre',                  key:'autre',          color:'#9CA3AF', bg:'linear-gradient(135deg,#F9FAFB,#F3F4F6)', bgDark:'linear-gradient(135deg,#1A1A1A,#2A2A2A)'},
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

// Mapping alias normalisé → clé FM (pour les cas où ils ne correspondent pas directement)
var _ALIAS_FM={'mathematiques':'maths','mathematique':'maths'};

var FM={
  tous:function(){return true;},
  maths:function(t){return /math|alg.bre|statist|analyse|g.om.trie|arithm/.test(t);},
  physique:function(t){return /physique|electro|mecanique|thermodynamique/.test(t);},
  informatique:function(t){return /informatique|python|data|react|javascript|sql|code|algorith/.test(t);},
  langues:function(t){return /anglais|espagnol|allemand|langue|toefl|ielts|fle/.test(t);},
  economie:function(t){return /econom|macro|finance|compta|gestion|marketing/.test(t);},
  soir:function(t){return /18h|19h|20h|21h|soir/.test(t);},
  weekend:function(t){return /sam|dim|week/.test(t);},
  histoire:function(t){return /histoire|histor/.test(t);},
  philosophie:function(t){return /philo/.test(t);},
  chimie:function(t){return /chimie|chim/.test(t);},
  biologie:function(t){return /biolog|svt/.test(t);},
  sport:function(t){return /sport|gym|fitness/.test(t);},
  musique:function(t){return /musique|piano|guitare|solfege/.test(t);},
  droit:function(t){return /droit|jurid|loi/.test(t);}
};

// Pool complet de filtres disponibles
var _FILTER_POOL=[
  {key:'maths',       label:'Maths',     emoji:'📐'},
  {key:'physique',    label:'Physique',  emoji:'⚗️'},
  {key:'informatique',label:'Info',      emoji:'💻'},
  {key:'langues',     label:'Langues',   emoji:'🌍'},
  {key:'economie',    label:'Éco',       emoji:'📊'},
  {key:'soir',        label:'Ce soir',   emoji:'🌙'},
  {key:'weekend',     label:'Week-end',  emoji:'🎉'},
  {key:'histoire',    label:'Histoire',  emoji:'📖'},
  {key:'philosophie', label:'Philo',     emoji:'🧠'},
  {key:'chimie',      label:'Chimie',    emoji:'🔬'},
  {key:'biologie',    label:'Bio',       emoji:'🌿'},
  {key:'sport',       label:'Sport',     emoji:'🏃'},
  {key:'musique',     label:'Musique',   emoji:'🎵'},
  {key:'droit',       label:'Droit',     emoji:'⚖️'}
];

// Filtres actifs dans la barre (chargés depuis localStorage)
var _barActive=(function(){
  try{var s=localStorage.getItem('cp_bar_active');return s?JSON.parse(s):['maths','langues','histoire','soir','weekend'];}
  catch(e){return['maths','langues','histoire','soir','weekend'];}
})();
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
    if(mobInp)mobInp.value=val;
  }
  val=val.trim();
  checkCodeInSearch(val);
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
  _pendingFilterAlias=null;
  addBarCustomFilter();
}

function denyFilterAlias(){
  _pendingFilterAlias=null;
  var box=g('filterAliasSuggestion');if(box)box.style.display='none';
}
function setPill(el){haptic(4);document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on')});el.classList.add('on');actF=el.dataset.f;doFilter();try{sessionStorage.setItem('cp_filter',actF);}catch(e){}}
function restoreFilters(){
  try{
    var f=sessionStorage.getItem('cp_filter');
    if(f&&f!=='tous'){actF=f;}
    var niv=sessionStorage.getItem('cp_niv');
    if(niv){actNiv=niv;var lbl=g('pillNivLabel');if(lbl)lbl.textContent=niv;var pn=g('pillNiv');if(pn)pn.classList.add('on');}
  }catch(e){}
  renderFilterBar();
}

function renderFilterBar(){
  var bar=document.getElementById('filterBar');
  if(!bar)return;
  // Supprimer toutes les pills existantes (sauf #pillAdd)
  Array.from(bar.querySelectorAll('.pill')).forEach(function(p){p.remove();});
  var addBtn=document.getElementById('pillAdd');

  // Toujours afficher "Tous" en premier
  var tousBtn=document.createElement('button');
  tousBtn.className='filter-pill-btn pill'+(actF==='tous'?' on':'');
  tousBtn.dataset.f='tous';
  tousBtn.id='pillTous';
  tousBtn.textContent=t('niv_all');
  tousBtn.onclick=function(){setPill(tousBtn);};
  bar.insertBefore(tousBtn,addBtn);

  // Afficher les filtres actifs de la barre
  var allPool=_FILTER_POOL.concat(customFilters.map(function(f){return{key:f.key,label:f.label,emoji:'✨'};}));
  _barActive.forEach(function(key){
    var f=allPool.find(function(x){return x.key===key;});
    if(!f)return;
    var pill=document.createElement('button');
    pill.className='filter-pill-btn pill'+(actF===key?' on':'');
    pill.dataset.f=key;
    pill.textContent=f.label;
    pill.onclick=function(){setPill(pill);};
    bar.insertBefore(pill,addBtn);
  });
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
      if(!cd||!cd.id){toast(t('t_not_found'),t('t_unavail'));return;}
      C.push(cd);viewCoursCard(cd.id);
    }).catch(function(){toast(t('t_not_found'),t('t_unavail'));});
    return;
  }
  curId=c.id;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  g('rTit').textContent=c.title;
  var _rSubjBdg=g('rSubjBadge');if(_rSubjBdg){var _rMat2=findMatiere(c.subj||'');_rSubjBdg.textContent=c.subj||'';_rSubjBdg.style.background=_rMat2&&_rMat2.color?_rMat2.color:'#9CA3AF';}
  var _rMdBdg=g('rModeBadgeTop');if(_rMdBdg){var _rIsVis=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;_rMdBdg.textContent=_rIsVis?t('mode_visio'):t('mode_pres');_rMdBdg.style.display='inline-block';}
  var rAv=g('rProfAv'),rNm=g('rProfNm');
  if(rAv){var _pp=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;setAvatar(rAv,_pp,c.prof_ini||'?','rgba(255,255,255,.25)');}
  if(rNm)rNm.textContent=(P[c.pr]&&P[c.pr].nm)||c.prof_nm||t('reg_prof');
  var _mat2=findMatiere(c.subj||'');var _rIsDk2=document.documentElement.classList.contains('dk');
  var _rBg2=_rIsDk2?((_mat2&&_mat2.bgDark)?_mat2.bgDark:(c.bgDark||'var(--or)')):((_mat2&&_mat2.color)?_mat2.color:(c.bg||'var(--or)'));
  var _rBanEl2=document.querySelector('#bdR .rban');if(_rBanEl2&&_rBg2){_rBanEl2.style.background=_rBg2;}
  var _isVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  g('rDt').textContent=fmtDt(c.dt);
  var rLcEl=g('rLc');if(rLcEl){rLcEl.textContent=_isVisio?'':c.lc;rLcEl.style.display=_isVisio?'none':'';}
  var rDescEl=g('rDesc');
  if(rDescEl){if(c.description){rDescEl.textContent=c.description;rDescEl.style.display='block';}else{rDescEl.style.display='none';}}
  g('rTot').textContent=c.tot+'€';g('rCnt').textContent=c.sp+' '+t('places_max');
  g('rFin').textContent=pp+'€';g('rFinB').textContent=pp+'€';
  g('rInf').textContent=t('prix_fixe')+' '+pp+'€ '+t('par_eleve_confirm');
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
  var _rBtn=document.querySelector('[data-id="'+id+'"] .card-btn-reserve,[data-id="'+id+'"] .btnr');
  if(_rBtn&&_rBtn.textContent==='Réserver'){_rBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13" style="animation:cpSpin .6s linear infinite"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';_rBtn.disabled=true;var _rBtnTid=setTimeout(function(){if(_rBtn){_rBtn.innerHTML='Réserver';_rBtn.disabled=false;}},5000);_rBtn._resetTid=_rBtnTid;}
  var c=C.find(function(x){return x.id==id})||_histCache[String(id)];
  if(!c)return;
  var isOwner=user&&c.pr===user.id;
  // Si c'est le prof qui consulte son propre cours, ne pas bloquer
  if(!isOwner&&res[id]){openO(id);return;}
  if(!isOwner&&c.fl>=c.sp){openF(c.pr,c.title);return;}
  curId=id;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  g('rTit').textContent=c.title;
  var _rSubjBdg=g('rSubjBadge');if(_rSubjBdg){var _rMat2=findMatiere(c.subj||'');_rSubjBdg.textContent=c.subj||'';_rSubjBdg.style.background=_rMat2&&_rMat2.color?_rMat2.color:'#9CA3AF';}
  var _rMdBdg=g('rModeBadgeTop');if(_rMdBdg){var _rIsVis=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;_rMdBdg.textContent=_rIsVis?t('mode_visio'):t('mode_pres');_rMdBdg.style.display='inline-block';}
  var rAv=g('rProfAv'),rNm=g('rProfNm');
  if(rAv){var _pp=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;setAvatar(rAv,_pp,c.prof_ini||'?','rgba(255,255,255,.25)');}
  if(rNm)rNm.textContent=(P[c.pr]&&P[c.pr].nm)||c.prof_nm||t('reg_prof');
  // Note moyenne du prof dans le rban
  (function(){
    var _rNoteEl=g('rProfNote');if(!_rNoteEl)return;
    var _pn=(P[c.pr]&&P[c.pr].n&&P[c.pr].n!=='—')?P[c.pr].n:null;
    if(_pn){_rNoteEl.innerHTML='<span style="color:#FBBF24">★</span> '+_pn+' · '+((P[c.pr]&&P[c.pr].e)||0)+' élève'+((P[c.pr]&&P[c.pr].e)!==1?'s':'');_rNoteEl.style.display='block';}
    else{_rNoteEl.style.display='none';}
    // Fetch silencieux si pas encore en cache
    if(!_pn&&P[c.pr]&&!P[c.pr]._notesFetched){
      P[c.pr]._notesFetched=true;
      var _profId=c.pr;
      fetch(API+'/notations/'+_profId).then(function(r){return r.json();}).then(function(notes){
        if(!notes||!notes.length)return;
        var _avg=(notes.reduce(function(s,n){return s+(n.note||0);},0)/notes.length).toFixed(1);
        if(P[_profId])P[_profId].n=_avg;
        var _el=g('rProfNote');
        if(_el&&curId==id){_el.innerHTML='<span style="color:#FBBF24">★</span> '+_avg+' · '+((P[_profId]&&P[_profId].e)||0)+' élève'+((P[_profId]&&P[_profId].e)!==1?'s':'');_el.style.display='block';}
      }).catch(function(){});
    }
  })();
  // Coloriser le banner — couleur solide en light, dégradé foncé en dark
  var _mat=findMatiere(c.subj||'');var _rIsDk=document.documentElement.classList.contains('dk');
  var _rBg=_rIsDk?((_mat&&_mat.bgDark)?_mat.bgDark:(c.bgDark||'var(--or)')):((_mat&&_mat.color)?_mat.color:(c.bg||'var(--or)'));
  var _rBanEl=document.querySelector('#bdR .rban');if(_rBanEl&&_rBg){_rBanEl.style.background=_rBg;}
  var _oIsVisio=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;
  g('rDt').textContent=fmtDt(c.dt);
  var rLcEl=g('rLc');if(rLcEl){rLcEl.textContent=_oIsVisio?'':c.lc;rLcEl.style.display=_oIsVisio?'none':'';}
  var rNivEl=g('rNiv');if(rNivEl){if(c.niveau){rNivEl.style.display='block';var _ns=rNivEl.querySelector('span');if(_ns)_ns.textContent=c.niveau;}else{rNivEl.style.display='none';}}
  var rDescEl=g('rDesc');
  if(rDescEl){if(c.description){rDescEl.textContent=c.description;rDescEl.style.display='block';}else{rDescEl.style.display='none';}}
  g('rTot').textContent=c.tot+'€';g('rCnt').textContent=c.sp+' '+t('places_max');
  g('rFin').textContent=pp+'€';g('rFinB').textContent=pp+'€';
  g('rInf').textContent=t('prix_fixe')+' '+pp+'€ '+t('par_eleve_confirm');
  var isOwner=user&&c.pr===user.id;
  var btnConf=document.querySelector('#bdR .pb.pri');
  var btnContact=document.querySelector('#bdR .pb.sec');
  var btnDel=g('btnDelCours');
  var btnEleves=g('btnVoirEleves');
  var btnNoter=g('btnNoterCours');
  if(isOwner){
    if(btnConf)btnConf.style.display='none';
    if(btnContact)btnContact.style.display='none';
    if(btnDel)btnDel.style.display='flex';
    if(btnEleves)btnEleves.style.display='flex';
    if(btnNoter)btnNoter.style.display='none';
  } else {
    if(btnConf){btnConf.style.display='flex';btnConf.onclick=confR;}
    if(btnContact)btnContact.style.display='flex';
    if(btnDel)btnDel.style.display='none';
    if(btnEleves)btnEleves.style.display='none';
    // Bouton "Laisser un avis" : cours passé depuis >1h, réservé, pas encore noté
    if(btnNoter){
      var _canNote=(function(){
        try{
          if(!res[id])return false;
          if(localStorage.getItem('cp_noted_'+id))return false;
          var _diff=Date.now()-new Date(c.dt_iso||0);
          return !isNaN(_diff)&&_diff>3600000;
        }catch(e){return false;}
      }());
      btnNoter.style.display=_canNote?'flex':'none';
    }
  }
  if(_rBtn&&_rBtn._resetTid){clearTimeout(_rBtn._resetTid);_rBtn.innerHTML='Réserver';_rBtn.disabled=false;}
  openM('bdR');
}
function closeR(){closeM('bdR');}

async function openEleves(id){
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  g('elevesTitre').textContent=c.title+' — '+c.fl+' '+(c.fl>1?t('eleves_inscrits'):t('eleve_inscrit'));
  var list=g('elevesList');
  list.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>'+t('txt_loading')+'</div>';
  openM('bdEleves');
  if(c.fl===0){list.innerHTML='<div class="bempty"><p>'+t('txt_no_students')+'</p></div>';return;}
  try{
    var r=await fetch(API+'/reservations/cours/'+id,{headers:apiH()});
    var data=await r.json();
    if(!Array.isArray(data)||!data.length){list.innerHTML='<div class="bempty"><p>'+t('txt_no_students')+'</p></div>';return;}
    list.innerHTML='<div style="margin-bottom:12px;background:var(--orp);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--mid)">📋 <strong>'+data.length+' '+(data.length>1?t('eleves_inscrits'):t('eleve_inscrit'))+'</strong> '+t('sur_places')+' '+c.sp+' '+t('pour_places')+'</div>'
      +data.map(function(res){
        var nom=((res.prenom||'')+(res.nom?' '+res.nom:'')).trim()||'Élève';
        var email=res.email||'';
        var montant=res.montant_paye||0;
        var date=res.created_at?new Date(res.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'';
        var ini=nom[0]||'?';
        var isTuteur=!!res.is_tuteur;
        var roleBadge=isTuteur
          ?'<span style="font-size:10px;font-weight:700;color:#8B5CF6;background:#F5F3FF;border-radius:5px;padding:2px 6px;margin-left:6px;vertical-align:middle">'+t('role_tuteur')+'</span>'
          :'<span style="font-size:10px;font-weight:700;color:#3B82F6;background:#EFF6FF;border-radius:5px;padding:2px 6px;margin-left:6px;vertical-align:middle">'+t('role_eleve')+'</span>';
        var rid=JSON.stringify(res.reservation_id),uid=JSON.stringify(res.user_id),cid=JSON.stringify(id);
        return'<div style="display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--bdr)">'
          +'<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,'+(isTuteur?'#A78BFA,#7C3AED':'#FF8C55,var(--ord)')+');display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0">'+esc(ini)+'</div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:14px;font-weight:600;color:var(--ink)">'+esc(nom)+roleBadge+'</div>'
          +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+esc(email)+(date?' · '+esc(date):'')+'</div>'
          +'</div>'
          +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">'
          +'<div style="font-size:13px;font-weight:700;color:var(--green)">'+montant+'€</div>'
          +'<div style="display:flex;gap:5px">'
          +'<button onclick="openSignalement(\'eleve\','+uid+',\''+esc(nom)+'\')" style="background:var(--bg);border:none;border-radius:7px;padding:4px 8px;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Signaler">'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>'
          +'</button>'
          +'<button onclick="cancelEleveReservation('+rid+','+uid+','+cid+','+montant+')" style="background:#FEF2F2;color:#EF4444;border:none;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">'+t('confirm_cancel_res_btn')+'</button>'
          +'</div>'
          +'</div></div>';
      }).join('');
  }catch(e){
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">'+t('err_load_fail')+'<br><a onclick="openEleves(\''+id+'\')" style="color:var(--or);cursor:pointer">'+t('txt_retry')+'</a></div>';
  }
}

async function cancelEleveReservation(reservationId,userId,coursId,montant){
  if(!confirm(t('confirm_cancel_eleve')))return;
  try{
    var r=await fetch(API+'/reservations/'+reservationId+'/cancel',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:userId,cours_id:coursId,montant:montant})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    toast(t('t_cancelled'),t('t_cancelled_sub'));
    openEleves(coursId);
    var c=C.find(function(x){return x.id==coursId;});
    if(c&&c.fl>0)c.fl--;
    buildCards();
  }catch(e){toast(t('t_net_error'),'');}
}
function confR(){
  haptic(15);
  var id=curId;
  if(!id){toast('Erreur','Veuillez réessayer');return;}
  var c=C.find(function(x){return x.id==id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  if(!user||!user.id){toast('Connexion requise','Connectez-vous pour réserver');return;}
  if(res[id]){toast(t('t_already_res'),t('t_already_res_s'));return;}
  closeM('bdR');
  openPaymentSheet(id,false);
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
  curId=id;var c=C.find(function(x){return x.id==id})||_histCache[String(id)];
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
  g('rCnt').textContent=c.sp+' '+t('places_max');
  g('rFin').textContent=pp+'€';
  g('rFinB').textContent=pp+'€';
  g('rInf').textContent=t('res_extra_place').replace('{pp}',pp);
  var btnDup=g('btnDupCours');if(btnDup)btnDup.style.display=(user&&c.pr===user.id)?'block':'none';
  var btnDel=g('btnDelCours'),btnEleves=g('btnVoirEleves'),btnConf=document.querySelector('#bdR .pb.pri'),btnContact=document.querySelector('#bdR .pb.sec');
  if(btnDel)btnDel.style.display='none';
  if(btnEleves)btnEleves.style.display='none';
  if(btnConf){btnConf.style.display='flex';btnConf.onclick=function(){confAmi(id);};}
  if(btnContact)btnContact.style.display='flex';
  openM('bdR');
}

function confAmi(id){
  var c=C.find(function(x){return x.id==id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  closeM('bdR');
  openPaymentSheet(id,true);
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
  toast(t('t_link_copied'),t('t_link_copied_s'));
}

// SUIVRE
function openF(pid,title){folPr=pid;var p=P[pid]||{};g('fNm').textContent=p.nm||'ce prof';g('fCr').textContent=title||'';openM('bdF');}
function closeF(){closeM('bdF');folPr=null;}
function confF(){
  if(!folPr)return;
  var pid=folPr;
  var p=P[pid]||{};
  fol.add(pid);_saveFol();
  _syncFollowBtns(pid,true);
  closeM('bdF');
  toast(t('t_vous_suivez')+' '+(p.nm||t('mp_contacter')),t('t_following_msg'));
  folPr=null;
  P[pid]=P[pid]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
  P[pid].e=(P[pid].e||0)+1;
  if(user&&user.id){
    fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data&&data.nb_eleves!==undefined){
          P[pid].e=data.nb_eleves;
          if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid].e;
          _saveFollowCount(pid,P[pid].e);
        }
      })
      .catch(function(){
        // Rollback : le POST a échoué → annuler le suivi côté client
        fol.delete(pid);_saveFol();
        _syncFollowBtns(pid,false);
        P[pid]=P[pid]||{};P[pid].e=Math.max(0,(P[pid].e||1)-1);
        if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
        _saveFollowCount(pid,P[pid].e||0);
        toast(t('t_net_error'),'');
      });
  }
  if(g('mpE')&&curProf===pid)g('mpE').textContent=P[pid]?P[pid].e:0;
  if(P[pid]){try{var _pc4=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc4[pid])_pc4[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||''};_pc4[pid].e=P[pid].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc4));}catch(ex){}_saveFollowCount(pid,P[pid].e||0);}
  if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
  updateFavBadge();
}

// PROFIL PROF
function openPr(pid){
  // Redirige vers la fiche prof unifiée
  openPrFull(pid);
}
function _openPrLegacy(pid){
  curProf=pid;
  var _ts=g('mpTagsSection');if(_ts)_ts.style.display='none';
  var cours=C.filter(function(x){return x.pr===pid;});
  var dernierCours=cours[0]||null;
  // Toujours créer P[pid] pour que togFP/toggleFollowCard puissent l'incrémenter
  if(!P[pid])P[pid]={n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
  var p=P[pid];
  var pCache=P[pid];
  var STATUT={'etudiant':t('statut_etudiant'),'prof_ecole':t('statut_prof_ecoles'),'prof_college':t('statut_prof_clg'),'prof_universite':t('statut_chercheur'),'auto':t('statut_auto'),'autre':t('statut_autre')};
  // Alimenter P[pid] depuis les cours si champs manquants (sans écraser les données fraîches)
  if(dernierCours){
    if(!P[pid])P[pid]={n:'—',e:0};
    p=P[pid];
    if(!p.nm&&dernierCours.prof_nm)p.nm=dernierCours.prof_nm;
    if(!p.i)p.i=dernierCours.prof_ini||'?';
    if(!p.col)p.col=dernierCours.prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)';
    if(!p.photo&&dernierCours.prof_photo)p.photo=dernierCours.prof_photo;
  }
  var displayNm=p.nm||t('reg_prof');
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
  g('mprl').textContent=pCache.statut?STATUT[pCache.statut]||pCache.statut:t('reg_prof');
  g('mpbd').textContent=pCache.niveau||'';
  // Ville / lieu
  (function(){
    var _vEl=g('mpVille'),_vTxt=g('mpVilleTxt');if(!_vEl||!_vTxt)return;
    var _parts=[];
    if(pCache.lieu&&pCache.lieu_visible)_parts.push(pCache.lieu);
    if(pCache.ville&&pCache.ville_visible)_parts.push(pCache.ville);
    if(_parts.length){_vTxt.textContent=_parts.join(' · ');_vEl.style.display='flex';}
    else{_vEl.style.display='none';}
  })();
  var vBadge=g('mpVerifiedBadge');if(vBadge)vBadge.style.display=(pCache.verified===true||pCache.verified==='true')?'block':'none';
  var dvBadge=g('mpDiplomeBadge');if(dvBadge)dvBadge.style.display=(pCache.dv===true||pCache.dv==='true')?'block':'none';
  var cvBadge=g('mpCasierBadge');if(cvBadge)cvBadge.style.display=(pCache.cv===true||pCache.cv==='true')?'block':'none';
  g('mpC').textContent=cours.filter(function(x){return !_isCoursPass(x);}).length;
  g('mpN').textContent=p.n&&p.n!=='—'?'★ '+p.n:'—';
  g('mpE').textContent=p.e||0;
  // Cours donnés : passés + au moins 1 élève réservé — uniquement ce qu'on peut vérifier depuis C[]
  var _crsD=cours.filter(function(x){return _isCoursPass(x)&&x.fl>=1;}).length;
  var mpD=g('mpD');if(mpD)mpD.textContent=_crsD;

  // Bio : cache ou skeleton si profil complet pas encore chargé (_fullFetched)
  var bioEl=g('mpBio');
  if(bioEl){
    if(pCache.bio){
      bioEl.style.opacity='1';
      bioEl.textContent=pCache.bio;
    } else if(!pCache._fullFetched){
      bioEl.innerHTML='<span class="skeleton" style="display:block;height:13px;border-radius:6px;width:88%;margin-bottom:8px"></span>'
        +'<span class="skeleton" style="display:block;height:13px;border-radius:6px;width:62%"></span>';
    } else {
      bioEl.textContent='';
    }
  }

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
  else if(!pCache._fullFetched){
    // Skeleton pills uniquement si profil complet pas encore chargé
    if(tagsSect)tagsSect.style.display='block';
    if(tagsEl)tagsEl.innerHTML='<div class="skeleton" style="height:30px;width:76px;border-radius:50px"></div>'
      +'<div class="skeleton" style="height:30px;width:98px;border-radius:50px;animation-delay:.18s"></div>'
      +'<div class="skeleton" style="height:30px;width:64px;border-radius:50px;animation-delay:.36s"></div>';
  } else {
    if(tagsSect)tagsSect.style.display='none';
  }

  // Prochains cours — belle carte avec date formatée (à venir + places dispo)
  var prochains=cours.filter(function(c){return !_isCoursPass(c)&&c.fl<c.sp;});
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
      :'<div style="text-align:center;padding:28px 16px 16px"><div style="width:48px;height:48px;background:var(--bg);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="1.8" stroke-linecap="round" width="24" height="24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px">Aucun cours à venir</div><div style="font-size:12.5px;color:var(--lite);line-height:1.5">Ce professeur n\'a pas de cours disponibles pour le moment.</div></div>';
  }

  // Avis : skeleton uniquement si profil complet pas encore chargé
  var avisBlock=g('mpAvisBlock'),avisContainer=g('mpAvis');
  if(!pCache._fullFetched){
    if(avisBlock)avisBlock.style.display='block';
    if(avisContainer)avisContainer.innerHTML='<div class="skeleton" style="height:62px;border-radius:12px"></div>'
      +'<div class="skeleton" style="height:62px;border-radius:12px;animation-delay:.15s"></div>';
  } else {
    if(avisBlock)avisBlock.style.display='none';
  }
  fetch(API+'/notations/'+pid).then(function(r){return r.json();}).then(function(notes){
    if(curProf!==pid)return;
    if(!notes||!notes.length){if(avisBlock)avisBlock.style.display='none';return;}
    // Mettre à jour la note moyenne en cache depuis les avis réels
    var _avgAll=(notes.reduce(function(s,a){return s+(a.note||0);},0)/notes.length).toFixed(1);
    if(P[pid])P[pid].n=_avgAll;
    var _mpNEl=g('mpN');if(_mpNEl)_mpNEl.textContent='★ '+_avgAll;
    var stars=function(n){
      var s='';
      for(var i=1;i<=5;i++)s+='<svg viewBox="0 0 24 24" width="13" height="13" fill="'+(i<=n?'#FBBF24':'none')+'" stroke="'+(i<=n?'#FBBF24':'#D1D5DB')+'" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
      return s;
    };
    var html=notes.slice(0,3).map(function(a){
      var isTuteur=!!a.is_tuteur;
      var roleLabel=isTuteur?t('role_tuteur'):t('role_eleve');
      var roleColor=isTuteur?'#8B5CF6':'#3B82F6';
      var roleBg=isTuteur?'#F5F3FF':'#EFF6FF';
      // Afficher seulement la première initiale du prénom pour préserver l'anonymat (jamais le nom complet)
      var initial=a.prenom?a.prenom[0].toUpperCase()+'.':null;
      var reviewerLabel=initial?(initial+' · '+roleLabel):roleLabel;
      return'<div style="background:var(--bg);border-radius:12px;padding:12px 14px;opacity:0;transition:opacity .3s">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:'+(a.commentaire?'7':'3')+'px">'
        +'<div style="display:flex;align-items:center;gap:6px">'
        +'<span style="font-size:13px;color:#F59E0B">'+stars(a.note)+'</span>'
        +'<span style="font-size:10px;font-weight:700;color:'+roleColor+';background:'+roleBg+';border-radius:5px;padding:2px 6px">'+esc(reviewerLabel)+'</span>'
        +'</div>'
        +'<span style="font-size:11px;color:var(--lite)">'+(a.created_at?new Date(a.created_at).toLocaleDateString('fr-FR',{month:'short',year:'numeric'}):'')+'</span>'
        +'</div>'
        +(a.commentaire?'<div style="font-size:13px;color:var(--mid);line-height:1.5">'+esc(a.commentaire)+'</div>':'')
        +'</div>';
    }).join('');
    if(avisBlock)avisBlock.style.display='block';
    if(avisContainer){avisContainer.innerHTML=html;requestAnimationFrame(function(){avisContainer.querySelectorAll('div[style*="opacity:0"]').forEach(function(el,i){setTimeout(function(){el.style.opacity='1';},i*80);});});}
  }).catch(function(){if(avisBlock)avisBlock.style.display='none';});

  var fb=g('bFP');
  fb.style.display=(user&&pid===user.id)?'none':'flex';
  _setFollowBtn(fol.has(pid));

  // Onglets followers — masqués dans bdPr (visibles uniquement via openPrFull / Mes Profs)
  var mpFT=g('mpFollowerTabs');
  if(mpFT){
    mpFT.style.display='none';
    if(false){
      switchMpTab('accueil');
      _loadMpAnnonces(pid);
      _loadMpRessources(pid);
      _loadMpNotes(pid);
    }
  }

  var bdPrEl=g('bdPr');if(bdPrEl)bdPrEl.style.display='flex';

  // Niveau/statut : placeholder discret dans le hero si profil complet pas encore chargé
  if(!pCache.statut&&!pCache._fullFetched){var _rlEl=g('mprl');if(_rlEl){_rlEl.innerHTML='<span style="display:inline-block;height:10px;width:80px;border-radius:4px;background:rgba(255,255,255,.25);animation:shimmer 1.4s infinite;background-size:200% 100%"></span>';}}
  if(!pCache.niveau&&!pCache._fullFetched){var _bdEl2=g('mpbd');if(_bdEl2){_bdEl2.innerHTML='<span style="display:inline-block;height:9px;width:60px;border-radius:4px;background:rgba(255,255,255,.18);animation:shimmer 1.4s infinite;background-size:200% 100%;animation-delay:.2s"></span>';}}

  // Mise à jour silencieuse depuis l'API (tous les champs du modal)
  fetch(API+'/profiles/'+pid+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(prof){
    if(!prof||!prof.id)return;
    if(curProf!==pid)return;
    if(!P[pid])P[pid]={};
    P[pid]._fresh=true;
    P[pid]._fullFetched=true;
    ['bio','matieres','niveau','statut','verified','diplome_verifie','casier_verifie','ville','ville_visible','lieu','lieu_visible'].forEach(function(k){if(prof[k]!==undefined)P[pid][k]=prof[k];});
    // Ville / lieu dans le hero
    (function(){
      var _vEl=g('mpVille'),_vTxt=g('mpVilleTxt');if(!_vEl||!_vTxt)return;
      var _parts=[];
      if(prof.lieu&&prof.lieu_visible)_parts.push(prof.lieu);
      if(prof.ville&&prof.ville_visible)_parts.push(prof.ville);
      if(_parts.length){_vTxt.textContent=_parts.join(' · ');_vEl.style.display='flex';}
      else{_vEl.style.display='none';}
    })();
    if(prof.verified!==undefined){var _vB=g('mpVerifiedBadge');if(_vB)_vB.style.display=(prof.verified===true||prof.verified==='true')?'block':'none';}
    if(prof.diplome_verifie!==undefined){P[pid].dv=prof.diplome_verifie;var _dvB=g('mpDiplomeBadge');if(_dvB)_dvB.style.display=(prof.diplome_verifie===true||prof.diplome_verifie==='true')?'block':'none';}
    if(prof.casier_verifie!==undefined){P[pid].cv=prof.casier_verifie;var _cvB=g('mpCasierBadge');if(_cvB)_cvB.style.display=(prof.casier_verifie===true||prof.casier_verifie==='true')?'block':'none';}
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
    if(bioEl&&prof.bio!==undefined){
      var _newBio=prof.bio||'';
      bioEl.style.transition='opacity .2s';bioEl.style.opacity='0';
      setTimeout(function(){bioEl.textContent=_newBio;bioEl.style.opacity='1';},180);
    }
    if(prof.matieres){
      var _mt=prof.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean);
      if(tagsEl){tagsEl.style.transition='opacity .2s';tagsEl.style.opacity='0';setTimeout(function(){_renderTags(_mt);tagsEl.style.opacity='1';},180);}
      else{_renderTags(_mt);}
    }
    if(prof.niveau!==undefined&&g('mpbd')){var _bdEl=g('mpbd');_bdEl.style.transition='opacity .2s';_bdEl.style.opacity='0';setTimeout(function(){_bdEl.textContent=prof.niveau||'';_bdEl.style.opacity='1';},180);}
    if(prof.statut&&g('mprl')){var _rlEl2=g('mprl');_rlEl2.style.transition='opacity .2s';_rlEl2.style.opacity='0';setTimeout(function(){_rlEl2.textContent=STATUT[prof.statut]||prof.statut;_rlEl2.style.opacity='1';},180);}
    // Nombre d'élèves/abonnés depuis l'API si disponible
    var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
    if(_nbE!==undefined && _nbE>0){
      // L'API retourne parfois 0 (délai backend) — ignorer si 0, sinon prendre le max
      _nbE=Math.max(_nbE,P[pid].e||0);
      P[pid].e=_nbE;if(g('mpE'))g('mpE').textContent=_nbE;
      // Persister le compteur frais dans cp_follow_counts (valeur API confirmée > 0)
      _saveFollowCount(pid,_nbE);
    }
    // Cours donnés : recalcul avec règle passé + au moins 1 élève (ignore la valeur API)
    var _crsD2=cours.filter(function(x){return _isCoursPass(x)&&x.fl>=1;}).length;
    var mpD=g('mpD');if(mpD)mpD.textContent=_crsD2;
    // Sauvegarder en cache
    var _eSave=P[pid].e||0;
    try{var _pc=JSON.parse(localStorage.getItem('cp_profs')||'{}');_pc[pid]={ts:Date.now(),nm:P[pid].nm||'',i:P[pid].i||'',photo:P[pid].photo||'',e:_eSave};localStorage.setItem('cp_profs',JSON.stringify(_pc));}catch(ex){}
  }).catch(function(){});
}
function closePr(){var el=g('bdPr');if(el)el.style.display='none';closePrFull();}

function switchMpTab(tab){
  var tabs=['accueil','ressources','notes'];
  tabs.forEach(function(k){
    var btn=g('mpTab'+k[0].toUpperCase()+k.slice(1));
    var panel=g('mpPanel'+k[0].toUpperCase()+k.slice(1));
    var active=(k===tab);
    if(btn){btn.style.color=active?'var(--or)':'var(--lite)';btn.style.borderBottomColor=active?'var(--or)':'transparent';}
    if(panel)panel.style.display=active?'block':'none';
  });
}

function _loadMpAnnonces(pid){
  var el=g('mpAnnonces');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:60px;border-radius:12px"></div>';
  fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(curProf!==pid)return;
    if(!data||!data.length){el.innerHTML='<div style="font-size:13px;color:var(--lite);padding:10px 0" data-i18n="mp_aucune_annonce">Aucune annonce pour le moment.</div>';return;}
    el.innerHTML=data.map(function(a){
      return'<div style="background:var(--bg);border-radius:12px;padding:12px 14px">'
        +'<div style="font-size:13px;color:var(--ink);line-height:1.6;white-space:pre-wrap">'+esc(a.content)+'</div>'
        +'<div style="font-size:11px;color:var(--lite);margin-top:6px">'+new Date(a.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){if(curProf===pid)el.innerHTML='';});
}

function _loadMpRessources(pid){
  var el=g('mpRessources');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:54px;border-radius:12px"></div>';
  fetch(API+'/teacher/'+pid+'/resources',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(curProf!==pid)return;
    if(!data||!data.length){el.innerHTML='<div style="font-size:13px;color:var(--lite);padding:10px 0" data-i18n="mp_aucune_ressource">Aucune ressource partagée.</div>';return;}
    var TYPE_ICON={'pdf':'📄','video':'🎥','article':'📰','exercice':'📝'};
    el.innerHTML=data.map(function(r){
      return'<a href="'+esc(r.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;background:var(--bg);border-radius:12px;padding:12px 14px;text-decoration:none">'
        +'<span style="font-size:20px;flex-shrink:0">'+(TYPE_ICON[r.type]||'📎')+'</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.title)+'</div>'
        +'<div style="font-size:11px;color:var(--lite);margin-top:2px">'+esc(r.type)+(r.access_level==='public'?' · public':'')+'</div>'
        +'</div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2" stroke-linecap="round" width="14" height="14" style="flex-shrink:0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        +'</a>';
    }).join('');
  }).catch(function(){if(curProf===pid)el.innerHTML='';});
}

function _loadMpNotes(pid){
  var el=g('mpNotes');if(!el||!user)return;
  el.innerHTML='<div class="skeleton" style="height:80px;border-radius:12px"></div>';
  fetch(API+'/teacher/'+pid+'/student-notes/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(curProf!==pid)return;
    if(!data||!data.content){el.textContent='';el.innerHTML='<div style="font-size:13px;color:var(--lite)" data-i18n="mp_aucune_note">Aucune note de votre professeur pour le moment.</div>';return;}
    el.textContent=data.content;
  }).catch(function(){if(curProf===pid)el.innerHTML='';});
}

function contPr(){
  var p=P[curProf]||{};
  var pid=curProf;
  closePr();
  openMsg(p.nm||'le professeur',pid,p.photo||null);
}

// ── PROFIL PROF COMPLET (Mes Profs) ──────────────────────────────────────────

function _renderMpfExtraInfo(p){
  var el=g('mpfExtraInfo');if(!el)return;
  var STATUT={'etudiant':'Étudiant(e)','prof_ecole':'Professeur des écoles','prof_college':'Professeur collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Autre'};
  var rows='';
  // Statut + lieu
  var statutLabel=p.statut?(STATUT[p.statut]||p.statut):null;
  var lieu=p.lieu_enseignement||p.lieu||null;
  if(statutLabel||lieu){
    rows+='<div style="background:var(--wh);border-radius:16px;padding:12px 14px;margin:0 16px 8px;display:flex;flex-direction:column;gap:10px">';
    if(statutLabel)rows+='<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="width:32px;height:32px;border-radius:10px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></div>'
      +'<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--lite);margin-bottom:1px">Statut</div>'
      +'<div style="font-size:13px;font-weight:600;color:var(--ink)">'+esc(statutLabel)+'</div></div></div>';
    if(lieu)rows+='<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="width:32px;height:32px;border-radius:10px;background:#EFF6FF;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>'
      +'<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--lite);margin-bottom:1px">Lieu d\'enseignement</div>'
      +'<div style="font-size:13px;font-weight:600;color:var(--ink)">'+esc(lieu)+'</div></div></div>';
    rows+='</div>';
  }
  // Formations
  var formations=p.formations||null;
  if(formations){
    rows+='<div class="mpf-section-lbl">Formations & Diplômes</div>'
      +'<div style="background:var(--wh);border-radius:16px;padding:14px;margin:0 16px 8px">'
      +(typeof formations==='string'?formations.split('\n').filter(Boolean).map(function(f){
          return'<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">'
            +'<div style="width:6px;height:6px;border-radius:50%;background:var(--or);margin-top:6px;flex-shrink:0"></div>'
            +'<div style="font-size:13px;color:var(--mid);line-height:1.5">'+esc(f.trim())+'</div></div>';
        }).join('')
        :'<div style="font-size:13px;color:var(--mid);line-height:1.6">'+esc(String(formations))+'</div>')
      +'</div>';
  }
  // Expériences
  var experiences=p.experiences||p.experience||null;
  if(experiences){
    rows+='<div class="mpf-section-lbl">Expériences</div>'
      +'<div style="background:var(--wh);border-radius:16px;padding:14px;margin:0 16px 8px">'
      +(typeof experiences==='string'?experiences.split('\n').filter(Boolean).map(function(e){
          return'<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">'
            +'<div style="width:6px;height:6px;border-radius:50%;background:#8B5CF6;margin-top:6px;flex-shrink:0"></div>'
            +'<div style="font-size:13px;color:var(--mid);line-height:1.5">'+esc(e.trim())+'</div></div>';
        }).join('')
        :'<div style="font-size:13px;color:var(--mid);line-height:1.6">'+esc(String(experiences))+'</div>')
      +'</div>';
  }
  el.innerHTML=rows;
}
var _curPrFull=null;
var _curPrEnrolled=false;

function _buildBadges(p,pid){
  var icoId='<svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>';
  var icoDip='<svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>';
  var icoShld='<svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  var icoFol='<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>';
  var _isVrf=p.verified===true||p.verified==='true';
  var _isDip=(p.dv===true||p.dv==='true')||(p.diplome_verifie===true||p.diplome_verifie==='true');
  var _isCas=(p.cv===true||p.cv==='true')||(p.casier_verifie===true||p.casier_verifie==='true');
  var h='';
  if(_isVrf)h+='<span onclick="showBadgeInfo(\'identite\')" class="prof-badge prof-badge-vrf">'+icoId+t('mp_identite')+'</span>';
  if(_isDip)h+='<span onclick="showBadgeInfo(\'diplome\')" class="prof-badge prof-badge-dip">'+icoDip+t('mp_diplome')+'</span>';
  if(_isCas)h+='<span onclick="showBadgeInfo(\'confiance\')" class="prof-badge prof-badge-cas">'+icoShld+t('mp_confiance')+'</span>';
  if(fol.has(pid))h+='<span class="prof-badge prof-badge-fol">'+icoFol+'Suivi</span>';
  return h;
}

function _mpfSetEnrolled(enrolled){
  _curPrEnrolled=enrolled;
  var pid=_curPrFull;
  // New tp-* elements
  var tpTabEsp=g('tpTabEspace');
  var tpCode=g('tpEspaceCode');
  var tpContent=g('tpEspaceContent');
  // tpTabEspace toujours visible, seul le contenu change
  if(tpCode)tpCode.style.display=enrolled?'none':'block';
  if(tpContent)tpContent.style.display=enrolled?'block':'none';
  if(enrolled&&pid){
    _loadMpfEspace(pid);
    if(_mpfAutoSwitchEspace){_mpfAutoSwitchEspace=false;switchTpTab('espace');}
  }
}

function openPrFull(pid){
  _curPrFull=pid;
  _curPrEnrolled=false;
  curProf=pid;
  if(!P[pid])P[pid]={n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};
  var p=P[pid];
  var cours=C.filter(function(x){return x.pr===pid;});
  if(cours.length&&!p.nm){
    p.nm=cours[0].prof_nm||t('reg_prof');p.i=cours[0].prof_ini||'?';
    p.col=cours[0].prof_col||'linear-gradient(135deg,#FF8C55,#E04E10)';
    p.photo=cours[0].prof_photo||null;
  }
  var displayNm=p.nm||t('reg_prof'),displayIni=p.i||'?',displayCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)',displayPhoto=p.photo||null;
  var STATUT={'etudiant':'Étudiant(e)','prof_ecole':'Professeur des écoles','prof_college':'Professeur collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Autre'};

  // Avatar
  var avEl=g('tpAvWrap');if(avEl){setAvatar(avEl,displayPhoto,displayIni,displayCol);avEl._photo=displayPhoto;}
  // Name
  var nmEl=g('tpName');if(nmEl)nmEl.textContent=displayNm;
  // Since / role
  var sinceEl=g('tpSince');
  if(sinceEl){
    var roleStr=p.statut?(STATUT[p.statut]||p.statut):'Enseignant';
    sinceEl.textContent=roleStr+(p.created_at||p.since?' · Membre depuis '+(new Date(p.created_at||p.since)).getFullYear():'');
  }
  // Contact button label
  var cl=g('tpContactLabel');if(cl){var _pr=displayNm.split(' ')[0];cl.textContent='Contacter '+(_pr||displayNm);}
  // Espace title
  var et=g('tpEspaceTitle');if(et){var _pr2=displayNm.split(' ')[0];et.textContent='Espace privé de '+(_pr2||displayNm);}
  // Follow badge (show for all profiles except own)
  var isOwnProfile=!!(user&&pid===user.id);
  var vb=g('tpVerifBadge');if(vb)vb.style.display=isOwnProfile?'none':'flex';
  _setMpfFollowBtn(fol.has(pid));
  // Stats
  var _nbCours=cours.filter(function(x){return!_isCoursPass(x);}).length;
  var _nbD=cours.filter(function(x){return _isCoursPass(x)&&x.fl>=1;}).length;
  if(g('tpStCours'))g('tpStCours').textContent=_nbCours;
  if(g('tpStEleves'))g('tpStEleves').textContent=p.e||0;
  var _rtEl=g('tpStRating');if(_rtEl){var _hasRt=p.n&&p.n!=='—';_rtEl.textContent=_hasRt?p.n+'★':'—';_rtEl.style.color=_hasRt?'#FF9500':'#aaa';}
  if(g('tpStAvis'))g('tpStAvis').textContent=p.nb_avis||0;
  // Trust cards
  _tpBuildTrustCards(p,pid);
  // Bio
  var bioSect=g('tpBioSection'),bioEl=g('tpBio');
  if(bioEl){
    if(p.bio){bioEl.textContent=p.bio;if(bioSect)bioSect.style.display='block';}
    else if(!p._fullFetched&&bioSect){bioSect.style.display='block';bioEl.innerHTML='<span class="skeleton" style="display:block;height:12px;border-radius:6px;width:90%;margin-bottom:8px"></span><span class="skeleton" style="display:block;height:12px;border-radius:6px;width:68%"></span>';}
    else if(bioSect){bioSect.style.display='none';}
  }
  // Statut rows
  _tpRenderStatut(p);
  // Matières
  var _mats=p.matieres?p.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean):(cours.length?(function(){var s={};cours.forEach(function(c){if(c.subj)s[c.subj]=1;});return Object.keys(s);})():[]);
  _tpRenderMatieres(_mats,_mats.slice(0,2));
  // Courses tab
  _tpBuildCourses(pid);
  // Enrollment
  var tpCode=g('tpEspaceCode');if(tpCode)tpCode.style.display='block';
  var tpEspC=g('tpEspaceContent');if(tpEspC)tpEspC.style.display='none';
  var tpCodeErr=g('tpCodeError');if(tpCodeErr)tpCodeErr.style.display='none';
  var tpCodeInp=g('tpCodeInput');if(tpCodeInp)tpCodeInp.value='';
  switchTpTab('presentation');
  // Check enrollment
  if(user&&!user.guest&&pid!==user.id){
    fetch(API+'/teacher/'+pid+'/is-enrolled',{headers:apiH()}).then(function(r){return r.json();}).then(function(d){
      if(_curPrFull!==pid)return;
      var enrolled=!!(d&&d.enrolled);
      _mpfSetEnrolled(enrolled);
      // Persist to localStorage so enrollment survives re-login on same device
      if(enrolled){var _p=P[pid]||{};_saveEnrolledProf(String(pid),{nm:_p.nm||'',ini:_p.i||'?',col:_p.col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:_p.photo||null});}
    }).catch(function(){_mpfSetEnrolled(false);});
  }
  // Avis
  _loadMpfAvis(pid);
  // API profile fetch
  _fetchProf(pid);
  fetch(API+'/profiles/'+pid+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(prof){
    if(_curPrFull!==pid)return;
    if(!P[pid])P[pid]={};
    P[pid]._fresh=true;P[pid]._fullFetched=true;
    ['bio','matieres','niveau','statut','verified','diplome_verifie','casier_verifie','formations','experiences','experience','lieu_enseignement','lieu','created_at'].forEach(function(k){if(prof[k]!==undefined)P[pid][k]=prof[k];});
    var _pr2=prof.prenom||'';var _no2=prof.nom||'';var _apiNm=(_pr2+(_no2?' '+_no2:'')).trim();
    if(_apiNm){P[pid].nm=_apiNm;if(g('tpName'))g('tpName').textContent=_apiNm;}
    if(prof.photo_url){P[pid].photo=prof.photo_url;var av2=g('tpAvWrap');if(av2){setAvatar(av2,prof.photo_url,P[pid].i||'?',P[pid].col||displayCol);av2._photo=prof.photo_url;}}
    if(prof.bio!==undefined&&g('tpBio')){
      var b=prof.bio||'';
      var bs=g('tpBioSection');
      if(b){g('tpBio').textContent=b;if(bs)bs.style.display='block';}
      else{if(bs)bs.style.display='none';}
    }
    if(prof.matieres){
      var mats=prof.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean);
      _tpRenderMatieres(mats,mats.slice(0,2));
    }
    if(prof.statut&&g('tpSince')){g('tpSince').textContent=(STATUT[prof.statut]||prof.statut)+(prof.created_at?' · Membre depuis '+new Date(prof.created_at).getFullYear():'');}
    _tpRenderStatut(P[pid]);
    _tpBuildTrustCards(P[pid],pid);
    var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
    if(_nbE!==undefined&&_nbE>0){P[pid].e=Math.max(_nbE,P[pid].e||0);if(g('tpStEleves'))g('tpStEleves').textContent=P[pid].e;}
    var _cl=g('tpContactLabel');if(_cl){var _pr3=(prof.prenom||_apiNm||displayNm).split(' ')[0];_cl.textContent='Contacter '+_pr3;}
    var _et=g('tpEspaceTitle');if(_et){var _pr4=(prof.prenom||_apiNm||displayNm).split(' ')[0];_et.textContent='Espace privé de '+_pr4;}
  }).catch(function(){});
  var el=g('bdPrFull');if(el){el.style.display='flex';el.classList.remove('closing');}
  if(g('tpScroll'))g('tpScroll').scrollTop=0;
}

function _tpBuildTrustCards(p,pid){
  var box=g('tpTrustCards');if(!box)return;
  var title=g('tpCertTitle');
  var _isVrf=p.verified===true||p.verified==='true';
  var _isDip=(p.dv===true||p.dv==='true')||(p.diplome_verifie===true||p.diplome_verifie==='true');
  var _isCas=(p.cv===true||p.cv==='true')||(p.casier_verifie===true||p.casier_verifie==='true');
  var h='';
  var _tcSty='cursor:pointer;-webkit-tap-highlight-color:transparent';
  if(_isVrf){
    h+='<div class="tp-trust-card" style="'+_tcSty+'" onclick="showBadgeInfo(\'identite\')">'
      +'<div class="tp-trust-icon" style="background:#E6F7EC"><svg viewBox="0 0 24 24" fill="none" stroke="#0A7A3C" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>'
      +'<div class="tp-trust-text"><div class="tp-trust-lbl">Identité vérifiée</div><div class="tp-trust-sub">CNI contrôlée par CoursPool</div></div>'
      +'<div class="tp-trust-badge" style="background:#E6F7EC;color:#0A7A3C">Vérifié</div>'
      +'</div>';
  }
  if(_isDip){
    var dipLabel=p.diplome||p.niveau||'Diplôme vérifié';
    h+='<div class="tp-trust-card" style="'+_tcSty+'" onclick="showBadgeInfo(\'diplome\')">'
      +'<div class="tp-trust-icon" style="background:#EEF2FF"><svg viewBox="0 0 24 24" fill="none" stroke="#3C3489" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></div>'
      +'<div class="tp-trust-text"><div class="tp-trust-lbl">Diplôme vérifié</div><div class="tp-trust-sub">'+esc(dipLabel)+'</div></div>'
      +'<div class="tp-trust-badge" style="background:#EEF2FF;color:#3C3489">Vérifié</div>'
      +'</div>';
  }
  if(_isCas){
    h+='<div class="tp-trust-card" style="'+_tcSty+'" onclick="showBadgeInfo(\'confiance\')">'
      +'<div class="tp-trust-icon" style="background:#FFF0E8"><svg viewBox="0 0 24 24" fill="none" stroke="#E8611A" stroke-width="2" stroke-linecap="round" width="18" height="18"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>'
      +'<div class="tp-trust-text"><div class="tp-trust-lbl">Badge de confiance</div><div class="tp-trust-sub">Profil complet et certifié</div></div>'
      +'<div class="tp-trust-badge" style="background:#FFF0E8;color:#E8611A">Certifié</div>'
      +'</div>';
  }
  box.innerHTML=h;
  if(title)title.style.display=h?'block':'none';
}

function _tpRenderStatut(p){
  var sect=g('tpStatutSection'),list=g('tpStatutList');if(!sect||!list)return;
  var STATUT={'etudiant':'Étudiant(e)','prof_ecole':'Professeur des écoles','prof_college':'Professeur collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Autre'};
  var rows='';
  rows+='<div class="tp-card-row"><div class="tp-card-row-left"><div class="tp-card-row-lbl">Statut</div><div class="tp-card-row-val">'+esc(p.statut?(STATUT[p.statut]||p.statut):'—')+'</div></div></div>';
  var dip=p.diplome||p.niveau||null;
  rows+='<div class="tp-card-row"><div class="tp-card-row-left"><div class="tp-card-row-lbl">Diplôme</div><div class="tp-card-row-val">'+esc(dip||'—')+'</div></div></div>';
  var exp=p.experiences||p.experience||null;
  if(exp){rows+='<div class="tp-card-row"><div class="tp-card-row-left"><div class="tp-card-row-lbl">Expérience</div><div class="tp-card-row-val">'+esc(String(exp).split('\n')[0])+'</div></div></div>';}
  var lieu=p.lieu_enseignement||p.lieu||null;
  rows+='<div class="tp-card-row"><div class="tp-card-row-left"><div class="tp-card-row-lbl">Lieu d\'enseignement</div><div class="tp-card-row-val">'+esc(lieu||'—')+'</div></div></div>';
  list.innerHTML=rows;sect.style.display='block';
}

function _tpRenderMatieres(list,primary){
  var sect=g('tpMatiereSection'),chips=g('tpMatiereChips');if(!sect||!chips)return;
  if(!list||!list.length){sect.style.display='none';return;}
  chips.innerHTML=list.map(function(m){
    var mat=findMatiere(m);
    var col=mat?mat.color:'#9CA3AF';
    return'<span style="background:'+col+';color:#fff;border-radius:50px;padding:5px 13px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:inline-block;box-shadow:0 2px 6px rgba(0,0,0,.15)">'+esc(m)+'</span>';
  }).join('');
  sect.style.display='block';
}

function _tpBuildCourses(pid){
  var container=g('tpCoursList');if(!container)return;
  var cours=C.filter(function(c){return c.pr===pid&&!_isCoursPass(c)&&c.fl<c.sp;});
  if(!cours.length){
    container.innerHTML='<div style="text-align:center;padding:40px 20px;font-size:14px;color:#717171">Aucun cours disponible pour le moment.</div>';
    return;
  }
  container.innerHTML='';
  cours.forEach(function(c){var w=_buildCourseCard(c);if(w)container.appendChild(w);});
}

function switchTpTab(tab){
  var tabs=['presentation','cours','avis','espace'];
  tabs.forEach(function(k){
    var btn=g('tpTab'+k[0].toUpperCase()+k.slice(1));
    var panel=g('tpPanel'+k[0].toUpperCase()+k.slice(1));
    var on=(k===tab);
    if(btn){if(on)btn.classList.add('on');else btn.classList.remove('on');}
    if(panel){if(on)panel.removeAttribute('hidden');else panel.setAttribute('hidden','');}
  });
}

function tpEnterCode(){
  var pid=_curPrFull;
  if(!pid||!user||user.guest){toast(t('t_follow_login'),'');return;}
  var inp=g('tpCodeInput');var code=(inp?inp.value.trim().toUpperCase():'');
  if(!code){var e=g('tpCodeError');if(e){e.textContent='Veuillez entrer un code.';e.style.display='block';}return;}
  var errEl=g('tpCodeError');if(errEl)errEl.style.display='none';
  var numPid=parseInt(pid)||pid;
  function _onSuccess(){
    toast('Accès débloqué !','');haptic(4);
    var _ep=P[pid]||{};
    _saveEnrolledProf(String(pid),{nm:_ep.nm||'',ini:_ep.i||'?',col:_ep.col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:_ep.photo||null});
    _mpfSetEnrolled(true);
  }
  function _onError(msg){if(errEl){errEl.textContent=msg||'Code incorrect.';errEl.style.display='block';}}
  fetch(API+'/teacher/'+pid+'/enroll',{method:'POST',headers:apiH(),body:JSON.stringify({code:code})})
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
    .then(function(res){
      if(res.ok&&res.d&&res.d.success){_onSuccess();return;}
      return fetch(API+'/teacher/enroll',{method:'POST',headers:apiH(),body:JSON.stringify({teacher_id:numPid,code:code})})
        .then(function(r2){return r2.json().then(function(d2){return{ok:r2.ok,d:d2};});})
        .then(function(res2){if(res2.ok&&res2.d&&res2.d.success){_onSuccess();}else{_onError(res2.d&&res2.d.error);}});
    }).catch(function(){_onError();});
}

function _tpContact(){
  var pid=_curPrFull;if(!pid)return;
  var p=P[pid]||{};
  var av=g('tpAvWrap');
  openMsg(p.nm||'le professeur',pid,av?av._photo:null);
  closePrFull();
}

function _tpShare(){
  var pid=_curPrFull;var p=P[pid]||{};
  var nm=p.nm||'un professeur';
  var url='https://courspool.vercel.app?prof='+pid;
  if(navigator.share){navigator.share({title:nm+' sur CoursPool',text:'Découvre les cours de '+nm+' sur CoursPool',url:url}).catch(function(){});}
  else{try{navigator.clipboard.writeText(url);toast('Lien copié','');}catch(e){toast(url,'');}}
}

function enrollWithCode(){
  var pid=_curPrFull;
  if(!pid||!user||user.guest){toast(t('t_follow_login'),'');return;}
  var inp=g('mpfCodeInput');var code=(inp?inp.value.trim().toUpperCase():'');
  if(!code){var e=g('mpfCodeError');if(e){e.textContent='Veuillez entrer un code.';e.style.display='block';}return;}
  var btn=document.querySelector('.mpf-code-btn');if(btn)btn.disabled=true;
  var errEl=g('mpfCodeError');if(errEl)errEl.style.display='none';
  var numPid=parseInt(pid)||pid;
  function _onSuccess(){
    toast('Accès débloqué !','');haptic(4);
    var _ep=P[pid]||{};
    _saveEnrolledProf(String(pid),{nm:_ep.nm||'',ini:_ep.i||'?',col:_ep.col||'linear-gradient(135deg,#FF8C55,#E04E10)',photo:_ep.photo||null});
    _mpfSetEnrolled(true);
    var cs=g('mpfCodeSection');if(cs)cs.style.display='none';
    switchMpfTab('espace');
  }
  function _onError(msg){
    if(btn)btn.disabled=false;
    if(errEl){errEl.textContent=msg||'Code incorrect.';errEl.style.display='block';}
  }
  // Tenter via URL-path : POST /teacher/{pid}/enroll  {code}
  fetch(API+'/teacher/'+pid+'/enroll',{method:'POST',headers:apiH(),body:JSON.stringify({code:code})})
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
    .then(function(res){
      if(res.ok&&res.d&&res.d.success){_onSuccess();return;}
      // Fallback : POST /teacher/enroll  {teacher_id, code}
      return fetch(API+'/teacher/enroll',{method:'POST',headers:apiH(),body:JSON.stringify({teacher_id:numPid,code:code})})
        .then(function(r2){return r2.json().then(function(d2){return{ok:r2.ok,d:d2};});})
        .then(function(res2){
          if(res2.ok&&res2.d&&res2.d.success){_onSuccess();}
          else{_onError((res2.d&&(res2.d.error||res2.d.message))||(res.d&&(res.d.error||res.d.message))||'Code incorrect.');}
        });
    }).catch(function(){_onError('Erreur réseau.');});
}

// ── ESPACE PROFESSEUR ────────────────────────────────────────────────────────
var _espCurrentCode=null;

function buildEspProf(){
  // Referme tous les tiroirs
  ['espCard1','espCard2','espCard3','espCard4','espCard5','espCard6'].forEach(function(id){
    var c=g(id);if(c)c.classList.remove('open');
  });
  // Charge le code (affiché dans le header de la card)
  espLoadCode();
  // Tuto première visite
  setTimeout(checkEspTuto, 600);
}

// ── TUTO ESPACE PROF (première visite) ──────────────────────────────────────
var _espTutoStep=0;
var _espTutoSteps=[
  {
    svg:'<svg viewBox="0 0 48 48" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><rect x="6" y="6" width="15" height="15" rx="3"/><rect x="27" y="6" width="15" height="15" rx="3"/><rect x="6" y="27" width="15" height="15" rx="3"/><rect x="27" y="27" width="15" height="15" rx="3"/></svg>',
    bg:'rgba(255,107,43,.08)',
    title:'Bienvenue dans ton Espace !',
    sub:'Tout ce dont tu as besoin pour gérer tes cours et tes élèves est ici, en un seul endroit.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>',
    bg:'rgba(255,107,43,.08)',
    title:'Code d\'accès élèves',
    sub:'Partage ton code unique avec tes élèves. Ils l\'entrent dans l\'app pour rejoindre ton espace et accéder à tes contenus.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>',
    bg:'rgba(255,107,43,.08)',
    title:'Mes cours',
    sub:'Retrouve ici tous tes cours à venir et passés. Les cours que tu as créés sont distingués de ceux que tu as réservés.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    bg:'rgba(99,102,241,.08)',
    title:'Mes élèves',
    sub:'Retrouve tous les élèves inscrits à ton espace. Valide ou refuse les nouvelles demandes d\'accès.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    bg:'rgba(249,115,22,.08)',
    title:'Publications',
    sub:'Écris des annonces pour tes élèves : infos de cours, rappels, messages importants. Tes élèves les voient directement sur ton profil.'
  },
  {
    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="56" height="56"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
    bg:'rgba(34,192,105,.08)',
    title:'Ma bibliothèque',
    sub:'Crée des fiches de cours et ajoute des documents. Tu choisis quels élèves y ont accès.'
  }
];

function checkEspTuto(){
  try{if(localStorage.getItem('cp_esp_tuto'))return;}catch(e){}
  openEspTuto();
}

function openEspTuto(){
  _espTutoStep=0;
  var bd=g('bdEspTuto');if(!bd)return;
  _espTutoRender();
  bd.style.display='flex';
  var sheet=g('espTutoSheet');if(sheet)_espTutoInitSwipe(sheet);
  haptic(4);
}

function _espTutoRender(){
  var s=_espTutoSteps[_espTutoStep];if(!s)return;
  var track=g('espTutoTrack');
  var dots=g('espTutoDots');var skipBtn=g('espTutoSkipBtn');
  var isLast=_espTutoStep===_espTutoSteps.length-1;
  if(track){
    track.innerHTML=''
      +'<div style="text-align:center;padding:28px 0 20px">'
      +'<div style="width:96px;height:96px;border-radius:50%;background:'+s.bg+';display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 28px rgba(255,107,43,.15)">'+s.svg+'</div>'
      +'<div style="font-size:20px;font-weight:800;color:var(--ink);margin-bottom:10px;letter-spacing:-.03em;line-height:1.25">'+s.title+'</div>'
      +'<div style="font-size:14px;color:var(--lite);line-height:1.7">'+s.sub+'</div>'
      +'</div>';
  }
  if(dots){
    dots.innerHTML=_espTutoSteps.map(function(_,i){
      return'<div onclick="espTutoGoTo('+i+')" style="width:'+(i===_espTutoStep?'20':'8')+'px;height:8px;border-radius:4px;background:'+(i===_espTutoStep?'var(--or)':'var(--bdr)')+';transition:all .25s;cursor:pointer"></div>';
    }).join('');
  }
  if(skipBtn)skipBtn.textContent=isLast?'Terminer':'Passer';
}

function _espTutoInitSwipe(sheet){
  if(!sheet||sheet._tutoSwipeInit)return;
  sheet._tutoSwipeInit=true;
  var sx=0,sy=0;
  sheet.addEventListener('touchstart',function(e){e.stopPropagation();sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  sheet.addEventListener('touchmove',function(e){e.stopPropagation();},{passive:true});
  sheet.addEventListener('touchend',function(e){
    e.stopPropagation();
    var dx=e.changedTouches[0].clientX-sx;
    var dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){
      if(dx<0)espTutoNext();
      else if(_espTutoStep>0){_espTutoStep--;_espTutoRender();}
    }
  },{passive:true});
}

function espTutoGoTo(i){
  _espTutoStep=i;haptic(4);_espTutoRender();
}

function espTutoPrev(){
  if(_espTutoStep>0){_espTutoStep--;haptic(4);_espTutoRender();}
}

function espTutoNext(){
  haptic(4);
  if(_espTutoStep<_espTutoSteps.length-1){
    _espTutoStep++;
    _espTutoRender();
  }else{
    espTutoDone();
  }
}

function espTutoSkip(){
  espTutoDone();
}

function espTutoDone(){
  try{localStorage.setItem('cp_esp_tuto','1');}catch(e){}
  var bd=g('bdEspTuto');
  if(bd){bd.style.opacity='0';bd.style.transition='opacity .2s';setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},200);}
}

function espLoadCode(){
  var el=g('espCodeDisplay');
  if(el)el.textContent='⋯';
  fetch(API+'/teacher/my-code',{headers:apiH()}).then(function(r){return r.json();}).then(function(d){
    _espCurrentCode=d.teacher_code||null;
    if(el)el.textContent=_espCurrentCode||'Aucun code';
  }).catch(function(){if(el)el.textContent='—';});
}

function espRegenCode(){
  var el=g('espCodeDisplay');
  // Si un code existe déjà, demander confirmation via 2e tap (bouton vire en "Confirmer ?")
  var btn=document.querySelector('[onclick="espRegenCode()"]');
  if(_espCurrentCode&&btn&&btn.dataset.confirm!=='1'){
    btn.dataset.confirm='1';
    btn.textContent='Confirmer ?';
    btn.style.background='rgba(239,68,68,.15)';
    btn.style.color='#EF4444';
    setTimeout(function(){
      if(btn.dataset.confirm==='1'){
        btn.dataset.confirm='';
        btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Nouveau';
        btn.style.background='';btn.style.color='';
      }
    },3000);
    return;
  }
  if(btn){btn.dataset.confirm='';btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Nouveau';btn.style.background='';btn.style.color='';}
  if(el)el.textContent='⋯';
  fetch(API+'/teacher/generate-code',{method:'POST',headers:apiH()}).then(function(r){return r.json();}).then(function(d){
    if(d.error){if(el)el.textContent='—';toast('Erreur',d.error.slice(0,60));return;}
    _espCurrentCode=d.teacher_code||null;
    if(el)el.textContent=_espCurrentCode||'—';
    haptic(8);toast('Code généré !','Partage-le avec tes élèves');
  }).catch(function(){if(el)el.textContent='—';toast('Erreur réseau','Vérifie ta connexion');});
}

function espCopyCode(){
  if(!_espCurrentCode){toast('Génère un code d\'abord','');return;}
  try{navigator.clipboard.writeText(_espCurrentCode);toast('Code copié !','');haptic(4);}
  catch(e){toast(_espCurrentCode,'Copie ce code manuellement');}
}

function espShareCode(){
  if(!_espCurrentCode){toast('Génère un code d\'abord','');return;}
  var txt='Rejoins mon espace sur CoursPool avec le code : '+_espCurrentCode+'\nhttps://courspool.vercel.app';
  if(navigator.share){navigator.share({title:'Mon code CoursPool',text:txt}).catch(function(){});}
  else{try{navigator.clipboard.writeText(txt);toast('Lien copié !','');}catch(e){toast(_espCurrentCode,'Copie ce code');}}
}

function espLoadStudents(){
  var el=g('espStudents'),badge=g('espStudentBadge');
  if(!el)return;
  var uid=user&&user.id;if(!uid)return;
  var myCours=C.filter(function(c){return c.pr===uid&&!_isCoursPass(c);});
  if(!myCours.length){
    el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:12px 0;text-align:center">Aucun cours publié pour l\'instant.</div>';
    if(badge)badge.style.display='none';
    return;
  }
  el.innerHTML='<div class="skeleton" style="height:52px;border-radius:12px;margin-bottom:8px"></div><div class="skeleton" style="height:44px;border-radius:12px"></div>';
  Promise.all(myCours.map(function(c){
    return fetch(API+'/reservations/cours/'+c.id,{headers:apiH()})
      .then(function(r){return r.json();})
      .then(function(list){return{cours:c,list:Array.isArray(list)?list:[]};})
      .catch(function(){return{cours:c,list:[]};});
  })).then(function(results){
    var total=results.reduce(function(s,r){return s+r.list.length;},0);
    if(badge){badge.textContent=total>0?total+'':'';badge.style.display=total>0?'inline-flex':'none';}
    var withStudents=results.filter(function(r){return r.list.length>0;});
    if(!withStudents.length){
      el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:12px 0;text-align:center">Aucun élève inscrit à tes cours pour l\'instant.</div>';
      return;
    }
    el.innerHTML=withStudents.map(function(r){
      var c=r.cours;
      var nb=r.list.length;
      var dt=c.dt_iso?new Date(c.dt_iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'';
      var rows=r.list.map(function(rsv){
        var pid=rsv.user_id||rsv.userId||rsv.uid;
        var p=P[pid]||{};
        var nm=((p.pr||'')+' '+(p.nm||'')).trim()||(rsv.user_nm)||'Élève';
        var ini=(nm[0]||'?').toUpperCase();
        var bg=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
        var av=p.photo?'<img src="'+esc(p.photo)+'" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:11px;font-weight:800;color:#fff">'+ini+'</span>';
        var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
        var paid=rsv.paid||rsv.status==='paid';
        var isTut=!!(rsv.is_tuteur);
        var enfNm=rsv.enfant_prenom||'';
        if(pid){if(!P[pid])P[pid]={};P[pid].is_tuteur=isTut;}
        return'<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bdr)">'
          +'<div style="width:32px;height:32px;border-radius:50%;background:'+bg+';display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">'+av+'</div>'
          +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(nm)+(isTut?'<span style="font-size:9px;font-weight:700;color:#8B5CF6;background:#F5F3FF;border-radius:4px;padding:1px 5px;margin-left:5px;vertical-align:middle">Tuteur</span>':'')+'</div>'+(enfNm?'<div style="font-size:11px;color:var(--lite);margin-top:1px">👧 Pour '+esc(enfNm)+'</div>':'')+'</div>'
          +(paid?'<span style="font-size:10px;font-weight:700;background:rgba(16,185,129,.12);color:#059669;border-radius:50px;padding:2px 8px;flex-shrink:0">Payé</span>':'<span style="font-size:10px;font-weight:700;background:rgba(245,158,11,.12);color:#D97706;border-radius:50px;padding:2px 8px;flex-shrink:0">En attente</span>')
          +'</div>';
      }).join('');
      return'<div style="margin-bottom:12px;background:var(--bg);border-radius:14px;padding:10px 12px">'
        +'<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px">'
        +'<div style="font-size:13px;font-weight:800;color:var(--ink);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(c.title)+'</div>'
        +(dt?'<span style="font-size:11px;color:var(--lite);flex-shrink:0">'+dt+'</span>':'')
        +'<span style="font-size:11px;font-weight:700;color:var(--or);flex-shrink:0">'+nb+' élève'+(nb>1?'s':'')+'</span>'
        +'</div>'
        +rows
        +'</div>';
    }).join('');
  });
}

function espLoadReceivedDocs(){
  var el=g('espReceivedDocs');if(!el)return;
  var uid=user&&user.id;if(!uid)return;
  el.innerHTML='<div class="skeleton" style="height:52px;border-radius:12px;margin-bottom:8px"></div><div class="skeleton" style="height:52px;border-radius:12px"></div>';
  fetch(API+'/teacher/received-submissions',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(!Array.isArray(data)||!data.length){
      el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:12px 0;text-align:center">Aucun document reçu pour l\'instant.</div>';
      return;
    }
    var badge=g('espReceivedBadge');
    if(badge){badge.textContent=data.length;badge.style.display='inline-flex';}
    el.innerHTML=data.map(function(s){
      var nm=s.student_name||s.user_name||s.userName||'Élève';
      var ini=(nm[0]||'?').toUpperCase();
      var dt=s.created_at?new Date(s.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
      return'<div style="display:flex;align-items:center;gap:10px;background:var(--bg);border-radius:14px;padding:12px;margin-bottom:8px">'
        +'<div style="width:38px;height:38px;border-radius:12px;background:rgba(34,192,105,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        +'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(s.title||'Document sans titre')+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+esc(nm)+(dt?' · '+dt:'')+'</div>'
        +'</div>'
        +(s.url?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;background:var(--wh);border:none;flex-shrink:0;-webkit-tap-highlight-color:transparent">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.2" stroke-linecap="round" width="16" height="16"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        +'</a>':'')
        +'</div>';
    }).join('');
  }).catch(function(){
    el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:12px 0;text-align:center">Erreur de chargement.</div>';
  });
}

function espLoadResources(){
  var el=g('espResources');
  if(el)el.innerHTML='<div class="skeleton" style="height:44px;border-radius:10px;margin-bottom:6px"></div>';
  var uid=user&&user.id;if(!uid)return;
  var TYPE_ICON={'pdf':'📄','video':'🎥','article':'📰','exercice':'📝'};
  fetch(API+'/teacher/'+uid+'/resources',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    if(!list||!list.length){
      if(el)el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:10px 0">Aucune ressource publiée.</div>';
      return;
    }
    if(el)el.innerHTML=list.map(function(r){
      return'<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bdr)">'
        +'<span style="font-size:20px;flex-shrink:0">'+(TYPE_ICON[r.type]||'📎')+'</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.title)+'</div>'
        +'<div style="font-size:11px;color:var(--lite)">'+esc(r.type)+'</div>'
        +'</div>'
        +'<a href="'+esc(r.url)+'" target="_blank" rel="noopener" style="color:var(--or);font-size:11px;font-weight:700;flex-shrink:0">Voir</a>'
        +'<button onclick="espDeleteRes(\''+r.id+'\')" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--lite);flex-shrink:0">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>'
        +'</button>'
        +'</div>';
    }).join('');
  }).catch(function(){if(el)el.innerHTML='';});
}

function espDeleteRes(id){
  var uid=user&&user.id;if(!uid)return;
  fetch(API+'/teacher/'+uid+'/resources/'+id,{method:'DELETE',headers:apiH()}).then(function(){
    haptic(4);espLoadResources();
  }).catch(function(){toast('Erreur','Impossible de supprimer');});
}

function espToggleAddRes(btn){
  var f=g('espResForm');if(!f)return;
  var show=f.style.display==='none';
  f.style.display=show?'flex':'none';
  if(btn)btn.textContent=show?'Annuler':'+ Ajouter';
}

function espSubmitRes(){
  var uid=user&&user.id;if(!uid)return;
  var title=(g('espResTitle')||{}).value||'';
  var url=(g('espResUrl')||{}).value||'';
  var type=(g('espResType')||{}).value||'article';
  if(!title.trim()||!url.trim()){toast('Titre et lien requis','');return;}
  var btn=document.querySelector('#espResForm .esp-btn-prim');
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+uid+'/resources',{method:'POST',headers:apiH(),body:JSON.stringify({title:title.trim(),url:url.trim(),type:type,access_level:'followers'})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){toast('Erreur',d.error);if(btn){btn.disabled=false;btn.textContent='Publier';}return;}
      haptic(4);toast('Ressource publiée !','');
      if(g('espResTitle'))g('espResTitle').value='';
      if(g('espResUrl'))g('espResUrl').value='';
      var f=g('espResForm');if(f)f.style.display='none';
      var ab=document.querySelector('[onclick="espToggleAddRes(this)"]');
      if(ab)ab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Ajouter';
      if(btn){btn.disabled=false;btn.textContent='Publier';}
      espLoadResources();
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Publier';}toast('Erreur réseau','');});
}

// ── ÉDITEUR RICH TEXT ────────────────────────────────────────────────────
var _espEdMode='annonce'; // 'annonce' | 'fiche'

var _espKbH=0;
function _espKbApply(){
  var bar=g('espEdToolbar');if(!bar)return;
  if(_espKbH>50){
    bar.style.bottom=_espKbH+'px';
    bar.classList.add('kb-open');
  }else{
    bar.style.bottom='';
    bar.classList.remove('kb-open');
  }
}
function _espKbUpdate(){
  // Fallback visualViewport (web) — resize:body sur Capacitor garde innerHeight fixe, donc kbH≈0 → ignoré
  if(window.visualViewport){
    var vp=Math.max(0,window.innerHeight-window.visualViewport.height);
    if(vp>50){_espKbH=vp;_espKbApply();}
  }
}
var _espKbShowFn=null,_espKbHideFn=null;

function openEspEditor(mode){
  _espEdMode=mode||'annonce';
  var el=g('bdEspEditor');if(!el)return;
  var ed=g('espAnnEditor');
  var ti=g('espEdTitleInp');
  var lbl=g('espEdModeTitle');
  if(ed){ed.innerHTML='';}
  var _ctr=g('espAnnCounter');if(_ctr){_ctr.textContent='0 / 1500';_ctr.style.color='var(--lite)';}
  if(ti){ti.value='';ti.style.display=_espEdMode==='fiche'?'block':'none';}
  if(lbl)lbl.textContent=_espEdMode==='fiche'?'Nouvelle fiche de cours':'Nouvelle publication';
  var badge=g('espEdTypeBadge');
  if(badge){
    badge.textContent=_espEdMode==='fiche'?'Fiche de cours':'Publication';
    badge.style.background=_espEdMode==='fiche'?'rgba(16,185,129,.12)':'rgba(59,130,246,.1)';
    badge.style.color=_espEdMode==='fiche'?'#059669':'#3182CE';
  }
  var btn=g('espEdPublishBtn');
  if(btn)btn.textContent=_espEdMode==='fiche'?'Enregistrer':'Publier';
  var ed2=g('espAnnEditor');
  if(ed2)ed2.setAttribute('data-placeholder',_espEdMode==='fiche'?'Contenu de la fiche…':'Écris quelque chose pour tes élèves…');
  el.style.display='flex';
  // Toolbar en dehors du bdEspEditor — la rendre visible
  _espKbH=0;
  var bar=g('espEdToolbar');
  if(bar){bar.style.display='block';bar.style.bottom='';bar.classList.remove('kb-open');}
  haptic(4);
  // Capacitor native keyboard events (iOS WKWebView + resize:body)
  _espKbShowFn=function(e){_espKbH=(e&&e.keyboardHeight)||0;_espKbApply();};
  _espKbHideFn=function(){_espKbH=0;_espKbApply();};
  window.addEventListener('keyboardWillShow',_espKbShowFn);
  window.addEventListener('keyboardWillHide',_espKbHideFn);
  // Fallback visualViewport pour le web
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',_espKbUpdate,{passive:true});
    window.visualViewport.addEventListener('scroll',_espKbUpdate,{passive:true});
  }
  setTimeout(function(){
    if(_espEdMode==='fiche'&&ti){ti.focus();}
    else if(ed){ed.focus();}
  },200);
}

function closeEspEditor(){
  var el=g('bdEspEditor');if(!el)return;
  if(_espKbShowFn){window.removeEventListener('keyboardWillShow',_espKbShowFn);_espKbShowFn=null;}
  if(_espKbHideFn){window.removeEventListener('keyboardWillHide',_espKbHideFn);_espKbHideFn=null;}
  if(window.visualViewport){
    window.visualViewport.removeEventListener('resize',_espKbUpdate);
    window.visualViewport.removeEventListener('scroll',_espKbUpdate);
  }
  var bar=g('espEdToolbar');
  if(bar){bar.style.bottom='';bar.classList.remove('kb-open');bar.style.display='none';}
  var cp=g('espColorPanel');if(cp)cp.style.display='none';
  var hp=g('espHilitePanel');if(hp)hp.style.display='none';
  el.classList.add('closing');
  setTimeout(function(){el.style.display='none';el.classList.remove('closing');},240);
}

function espFmt(cmd,val){
  var ed=g('espAnnEditor');if(!ed)return;
  if(document.activeElement!==ed)ed.focus();
  try{document.execCommand(cmd,false,val||null);}catch(e){}
  _espUpdateToolbar();
}

function espSetBlock(tag){
  var ed=g('espAnnEditor');if(!ed)return;
  if(document.activeElement!==ed)ed.focus();
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  var node=sel.anchorNode;
  // Partir de l'élément (pas du nœud texte)
  if(node&&node.nodeType===3)node=node.parentNode;
  // Remonter jusqu'au premier élément bloc dans l'éditeur
  while(node&&node!==ed&&!/^(P|H[1-6]|DIV|BLOCKQUOTE|LI)$/.test(node.nodeName)){
    node=node.parentNode;
  }
  if(!node||node===ed){
    // Fallback : WKWebView nécessite les chevrons
    try{document.execCommand('formatBlock',false,'<'+tag+'>');}catch(e){
      try{document.execCommand('formatBlock',false,tag);}catch(e2){}
    }
    return;
  }
  // Toggle : même tag → revenir en <p>
  if(node.nodeName.toLowerCase()===tag)tag='p';
  var newEl=document.createElement(tag);
  while(node.firstChild)newEl.appendChild(node.firstChild);
  node.parentNode.replaceChild(newEl,node);
  var r=document.createRange();
  r.selectNodeContents(newEl);r.collapse(false);
  sel.removeAllRanges();sel.addRange(r);
  _espUpdateToolbar();
}

function espApplyColor(type,color){
  var ed=g('espAnnEditor');if(!ed)return;
  if(document.activeElement!==ed)ed.focus();
  if(type==='fore'){
    if(color==='default'){
      var def=window.getComputedStyle(ed).color;
      try{document.execCommand('foreColor',false,def);}catch(e){}
    }else{
      try{document.execCommand('foreColor',false,color);}catch(e){}
    }
    var bar=g('espColorBar');
    if(bar)bar.style.background=color==='default'?'var(--or)':color;
  }else{
    if(color==='none'){
      try{document.execCommand('hiliteColor',false,'transparent');}catch(e){}
    }else{
      try{document.execCommand('hiliteColor',false,color);}catch(e){}
    }
  }
  // Fermer le panel après application
  var p=g('espColorPanel');if(p)p.style.display='none';
  var tb=g('espColorToggle');if(tb)tb.classList.remove('active');
}

function toggleEspColorPanel(){
  var p=g('espColorPanel');if(!p)return;
  var open=p.style.display==='none';
  p.style.display=open?'block':'none';
  var tb=g('espColorToggle');if(tb)tb.classList.toggle('active',open);
  if(open){var hp=g('espHilitePanel');if(hp)hp.style.display='none';var hb=g('espHiliteToggle');if(hb)hb.classList.remove('active');}
  haptic(4);
}

function toggleEspHilitePanel(){
  var p=g('espHilitePanel');if(!p)return;
  var open=p.style.display==='none';
  p.style.display=open?'block':'none';
  var tb=g('espHiliteToggle');if(tb)tb.classList.toggle('active',open);
  if(open){var cp=g('espColorPanel');if(cp)cp.style.display='none';var cb=g('espColorToggle');if(cb)cb.classList.remove('active');}
  haptic(4);
}

function espApplyHighlight(color){
  var ed=g('espAnnEditor');if(!ed)return;
  if(document.activeElement!==ed)ed.focus();
  var sel=window.getSelection();
  // Fermer le panel
  var p=g('espHilitePanel');if(p)p.style.display='none';
  var tb=g('espHiliteToggle');if(tb)tb.classList.remove('active');
  if(!sel||!sel.rangeCount||sel.isCollapsed){return;}
  var range=sel.getRangeAt(0);
  if(color==='none'){
    // Supprimer le surlignage : déballer les spans de surligneur dans la sélection
    var frag=range.extractContents();
    var tmp=document.createElement('div');tmp.appendChild(frag);
    tmp.querySelectorAll('span[data-hl]').forEach(function(s){
      while(s.firstChild)s.parentNode.insertBefore(s.firstChild,s);
      s.parentNode.removeChild(s);
    });
    range.insertNode(tmp.firstChild||document.createTextNode(''));
    return;
  }
  var span=document.createElement('span');
  span.setAttribute('data-hl','1');
  span.style.backgroundColor=color;
  span.style.borderRadius='3px';
  span.style.padding='0 1px';
  try{range.surroundContents(span);}catch(e){
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  // Mettre à jour l'indicateur couleur
  var bar=g('espHiliteBar');if(bar)bar.style.background=color;
  sel.removeAllRanges();
}

function espInsertHR(){
  var ed=g('espAnnEditor');if(!ed)return;
  ed.focus();
  try{document.execCommand('insertHTML',false,'<hr>');}catch(e){}
}

function _espUpdateToolbar(){
  var map={bold:'fmtB',italic:'fmtI',underline:'fmtU',strikeThrough:'fmtS'};
  Object.keys(map).forEach(function(cmd){
    var btn=g(map[cmd]);
    if(btn)btn.classList.toggle('active',document.queryCommandState(cmd));
  });
}


function _espAnnDateStr(created_at){
  var d=new Date(created_at);var now=new Date();
  var diff=Math.round((now-d)/86400000);
  return diff===0?'Aujourd\'hui':diff===1?'Hier':diff<7?diff+' j':d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
}
function _annDayLabel(d){
  var now=new Date();var diff=Math.floor((now-d)/86400000);
  if(diff===0)return'Aujourd\'hui';
  if(diff===1)return'Hier';
  if(diff<7)return d.toLocaleDateString('fr-FR',{weekday:'long'});
  return d.toLocaleDateString('fr-FR',{day:'numeric',month:'long'});
}
function _annTimeStr(d){return new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}
function _renderPollHtml(poll,annId,showVote,profId){
  var votes=poll.votes||{};
  var total=Object.keys(votes).length;
  var myVote=user?votes[user.id]:undefined;
  var hasVoted=myVote!==undefined;
  var opts=poll.options||[];
  var html='<div class="poll-question">'+esc(poll.question)+'</div>';
  if(showVote&&!hasVoted){
    opts.forEach(function(opt,i){
      html+='<button class="poll-vote-btn" onclick="voteOnPoll(\''+escH(annId)+'\',\''+escH(profId)+'\','+i+',this.closest(\'.poll-wrap\'))">'+esc(opt)+'</button>';
    });
  }else{
    opts.forEach(function(opt,i){
      var count=Object.values(votes).filter(function(v){return v===i;}).length;
      var pct=total?Math.round(count/total*100):0;
      var isMe=hasVoted&&myVote===i;
      html+='<div style="margin-bottom:8px">'
        +'<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
        +'<span style="font-size:13px;font-weight:'+(isMe?'700':'500')+';color:var(--ink)">'+esc(opt)+(isMe?' ✓':'')+'</span>'
        +'<span style="font-size:12px;color:var(--mid)">'+pct+'%'+(count?' · '+count:'')+'</span>'
        +'</div>'
        +'<div style="height:6px;background:var(--bdr);border-radius:6px;overflow:hidden">'
        +'<div style="height:100%;width:'+pct+'%;background:'+(isMe?'var(--or)':'var(--mid)')+';border-radius:6px;transition:width .5s ease"></div>'
        +'</div></div>';
    });
    html+='<div style="font-size:12px;color:var(--lite);margin-top:6px">'+total+' vote'+(total!==1?'s':'')+'</div>';
  }
  return'<div class="poll-wrap">'+html+'</div>';
}

function espLoadAnnonces(){
  var el=g('espAnnonces');
  if(el)el.innerHTML='<div class="skeleton" style="height:80px;border-radius:16px;margin-bottom:10px"></div>';
  var uid=user&&user.id;if(!uid)return;
  var p=P[uid]||{};
  var profNm=p.nm||user.prenom||'Moi';
  var profIni=(profNm[0]||'?').toUpperCase();
  var profCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var profPhoto=p.photo||null;
  var avInner=profPhoto?'<img src="'+esc(profPhoto)+'" alt="">':'<span>'+profIni+'</span>';
  fetch(API+'/teacher/'+uid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    var _fIds;try{_fIds=new Set(JSON.parse(localStorage.getItem('cp_fiche_ids')||'[]'));}catch(e){_fIds=new Set();}
    var filtered=(list||[]).filter(function(a){return a.type!=='fiche'&&!_fIds.has(String(a.id));});
    if(!filtered.length){if(el)el.innerHTML='';return;}
    if(el)el.innerHTML=filtered.map(function(a){
      var body=a.content&&a.content.trim().startsWith('<')?a.content:'<p>'+esc(a.content)+'</p>';
      return'<div class="forum-post">'
        +'<div class="forum-post-hd">'
        +'<div class="forum-post-av" style="background:'+profCol+'">'+avInner+'</div>'
        +'<div><div class="forum-post-nm">'+esc(profNm)+'</div><div class="forum-post-date">'+_espAnnDateStr(a.created_at)+'</div></div>'
        +'</div>'
        +'<div class="forum-post-body">'+body+'</div>'
        +'<div class="forum-post-ft">'
        +'<button onclick="espDeleteAnn(\''+escH(a.id)+'\')" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--lite);display:flex;align-items:center;gap:4px;font-size:12px">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>Supprimer'
        +'</button>'
        +'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){if(el)el.innerHTML='';});
}

function espLoadFiches(){
  var el=g('espFiches');if(!el)return;
  var uid=user&&user.id;if(!uid)return;
  fetch(API+'/teacher/'+uid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    var fiches=(list||[]).filter(function(a){return a.type==='fiche';});
    if(!fiches.length){el.innerHTML='<div style="color:var(--lite);font-size:12px;padding:4px 0">Aucune fiche créée.</div>';return;}
    el.innerHTML=fiches.map(function(a){
      var titre=a.title||'Fiche sans titre';
      return'<div class="fiche-item" onclick="espOpenFiche(\''+escH(a.id)+'\')">'
        +'<div style="display:flex;align-items:center;justify-content:space-between">'
        +'<div>'
        +'<div class="fiche-item-title">📄 '+esc(titre)+'</div>'
        +'<div class="fiche-item-date">'+_espAnnDateStr(a.created_at)+'</div>'
        +'</div>'
        +'<button onclick="event.stopPropagation();espDeleteAnn(\''+escH(a.id)+'\')" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--lite)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>'
        +'</button>'
        +'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){el.innerHTML='';});
}

function espOpenFiche(id){
  haptic(4);
  var uid=user&&user.id;if(!uid)return;
  // Essayer depuis le cache d'abord
  var cached;try{var fd=JSON.parse(localStorage.getItem('cp_fiche_data')||'{}');cached=fd[String(id)];}catch(e){}
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:28px 28px 0 0;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;animation:mi .28s cubic-bezier(.32,1,.6,1)';
  var initTitle=cached&&cached.title?cached.title:'Fiche de cours';
  var initContent=cached&&cached.content?cached.content:null;
  sheet.innerHTML='<div style="padding:12px 16px 0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'
    +'<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:0 auto"></div>'
    +'</div>'
    +'<div style="padding:16px 20px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(0,0,0,.06);flex-shrink:0">'
    +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(34,192,105,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
    +'<div id="_ficheSheetTitle" style="flex:1;font-size:16px;font-weight:800;color:var(--ink);letter-spacing:-.02em">'+esc(initTitle)+'</div>'
    +'<button onclick="this.closest(\'[style*=inset:0]\').remove()" style="width:32px;height:32px;border-radius:50%;background:var(--bg);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'</div>'
    +'<div id="_ficheSheetBody" style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch">'
    +(initContent?initContent:'<div style="display:flex;justify-content:center;padding:40px"><div class="cp-loader"></div></div>')
    +'</div>'
    +'<div style="padding:12px 16px;padding-bottom:max(16px,env(safe-area-inset-bottom,0px));flex-shrink:0"></div>';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  bd.appendChild(sheet);document.body.appendChild(bd);
  // Charger depuis l'API si pas en cache
  if(!initContent){
    fetch(API+'/teacher/'+uid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
      var f=(list||[]).find(function(a){return String(a.id)===String(id);});
      var bodyEl=document.getElementById('_ficheSheetBody');
      var titleEl=document.getElementById('_ficheSheetTitle');
      if(!f){if(bodyEl)bodyEl.innerHTML='<div style="text-align:center;padding:32px;color:var(--lite)">Fiche introuvable</div>';return;}
      var t2=f.title||cached&&cached.title||'Fiche de cours';
      if(titleEl)titleEl.textContent=t2;
      var ct=f.content||'';
      if(bodyEl)bodyEl.innerHTML=ct?ct:'<div style="text-align:center;padding:32px;color:var(--lite)">Fiche vide</div>';
      // Mettre à jour le cache
      try{var fd=JSON.parse(localStorage.getItem('cp_fiche_data')||'{}');fd[String(id)]={title:t2,content:ct};localStorage.setItem('cp_fiche_data',JSON.stringify(fd));}catch(e){}
    }).catch(function(){var bodyEl=document.getElementById('_ficheSheetBody');if(bodyEl)bodyEl.innerHTML='<div style="text-align:center;padding:32px;color:var(--lite)">Erreur de chargement</div>';});
  }
}

// ── MES PUBLICATIONS ─────────────────────────────────────────────────────
function openMesPublications(){
  var el=g('bdMesPublications');if(!el)return;
  el.style.display='flex';haptic(4);
  loadMesPublications();
}

function closeMesPublications(){
  var el=g('bdMesPublications');if(!el)return;
  el.classList.add('closing');
  setTimeout(function(){el.style.display='none';el.classList.remove('closing');},240);
}

function loadMesPublications(){
  var uid=user&&user.id;if(!uid)return;
  var el=g('mesPubsList');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:90px;border-radius:18px;margin-bottom:10px"></div><div class="skeleton" style="height:70px;border-radius:18px;margin-bottom:10px"></div>';
  var p=P[uid]||{};
  var profNm=p.nm||user.prenom||'Moi';
  var profIni=(profNm[0]||'?').toUpperCase();
  var profCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var profPhoto=p.photo||null;
  var avInner=profPhoto?'<img src="'+esc(profPhoto)+'" alt="">':'<span>'+profIni+'</span>';
  var GEAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
  fetch(API+'/teacher/'+uid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    var _fIds;try{_fIds=new Set(JSON.parse(localStorage.getItem('cp_fiche_ids')||'[]'));}catch(e){_fIds=new Set();}
    var pubs=(list||[]).filter(function(a){return a.type!=='fiche'&&!_fIds.has(String(a.id));});
    if(!pubs.length){
      el.innerHTML='<div style="text-align:center;padding:60px 24px">'
        +'<div style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="36" height="36"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
        +'</div>'
        +'<div style="font-size:20px;font-weight:800;color:var(--ink);margin-bottom:10px;letter-spacing:-.03em">Aucune publication</div>'
        +'<div style="font-size:14px;color:var(--lite);line-height:1.7">Crée ta première publication pour tes élèves.</div>'
        +'</div>';return;
    }
    var lastDay='';
    el.innerHTML=pubs.map(function(a){
      var d=new Date(a.created_at);
      var dayKey=d.toISOString().slice(0,10);
      var sep=dayKey!==lastDay?'<div class="ann-day-sep">'+_annDayLabel(d)+'</div>':'';
      lastDay=dayKey;
      var time=_annTimeStr(a.created_at);
      var acc=a.access_type||'enrolled';
      var gearBtn='<button onclick="openPubSettings(\''+escH(a.id)+'\',\''+acc+'\')" style="width:32px;height:32px;border-radius:50%;background:var(--bg);border:1.5px solid var(--bdr);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent">'+GEAR+'</button>';
      var hd='<div class="forum-post-hd">'
        +'<div class="forum-post-av" style="background:'+profCol+'">'+avInner+'</div>'
        +'<div style="flex:1"><div class="forum-post-nm">'+esc(profNm)+'</div><div class="forum-post-date">'+time+'</div></div>';
      if(a.type==='poll'){
        var poll;try{poll=JSON.parse(a.content);}catch(e){poll=null;}
        if(!poll)return sep;
        return sep+'<div class="forum-post" style="margin-bottom:12px">'
          +hd+'<span class="poll-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="11" height="11"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg> Sondage</span>'
          +gearBtn+'</div>'
          +'<div style="padding:0 16px 16px">'+_renderPollHtml(poll,a.id,false,uid)+'</div>'
          +'</div>';
      }
      var body=a.content&&a.content.trim().startsWith('<')?a.content:'<p>'+esc(a.content)+'</p>';
      return sep+'<div class="forum-post" style="margin-bottom:12px">'
        +hd+gearBtn+'</div>'
        +'<div class="forum-post-body">'+body+'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:12px">Erreur chargement.</div>';});
}

function pubSetVisibility(id,access){
  var uid=user&&user.id;if(!uid)return;
  fetch(API+'/teacher/'+uid+'/announcements/'+id,{method:'PATCH',headers:apiH(),body:JSON.stringify({access_type:access})})
    .then(function(r){return r.json();}).then(function(){haptic(4);loadMesPublications();espLoadAnnonces();})
    .catch(function(){toast('Erreur réseau','');});
}

function openPubSettings(id,currentAcc){
  haptic(4);
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding-bottom:max(24px,env(safe-area-inset-bottom,0px));overflow:hidden';
  var isPublic=currentAcc==='enrolled';
  sheet.innerHTML='<div style="text-align:center;padding:12px 0 0"><div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;display:inline-block"></div></div>'
    +'<div style="font-size:13px;font-weight:700;color:var(--lite);text-align:center;padding:16px 24px 8px;text-transform:uppercase;letter-spacing:.06em">Réglages de la publication</div>'
    +'<div style="padding:0 12px 8px">'
    +'<button onclick="pubSetVisibility(\''+escH(id)+'\',\'enrolled\');this.closest(\'[style*=fixed]\').remove();" style="width:100%;padding:16px;display:flex;align-items:center;gap:14px;background:'+(isPublic?'rgba(255,107,43,.07)':'transparent')+';border:none;border-radius:16px;cursor:pointer;font-family:inherit;text-align:left;-webkit-tap-highlight-color:transparent">'
    +'<div style="width:40px;height:40px;border-radius:12px;background:'+(isPublic?'rgba(255,107,43,.12)':'var(--bg)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="'+(isPublic?'var(--or)':'var(--mid)')+'" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>'
    +'<div style="flex:1"><div style="font-size:15px;font-weight:700;color:var(--ink)">Visible par tous</div><div style="font-size:12px;color:var(--lite);margin-top:2px">Tous tes élèves inscrits peuvent lire</div></div>'
    +(isPublic?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>':'')
    +'</button>'
    +'<button onclick="pubSetVisibility(\''+escH(id)+'\',\'private\');this.closest(\'[style*=fixed]\').remove();" style="width:100%;padding:16px;display:flex;align-items:center;gap:14px;background:'+(!isPublic?'rgba(255,107,43,.07)':'transparent')+';border:none;border-radius:16px;cursor:pointer;font-family:inherit;text-align:left;-webkit-tap-highlight-color:transparent">'
    +'<div style="width:40px;height:40px;border-radius:12px;background:'+(!isPublic?'rgba(255,107,43,.12)':'var(--bg)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="'+(!isPublic?'var(--or)':'var(--mid)')+'" stroke-width="2" stroke-linecap="round" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>'
    +'<div style="flex:1"><div style="font-size:15px;font-weight:700;color:var(--ink)">Privé (moi seul)</div><div style="font-size:12px;color:var(--lite);margin-top:2px">Seul toi peux voir cette publication</div></div>'
    +(!isPublic?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>':'')
    +'</button>'
    +'<div style="height:1px;background:var(--bdr);margin:4px 0 8px"></div>'
    +'<button onclick="espDeleteAnn(\''+escH(id)+'\');this.closest(\'[style*=fixed]\').remove();" style="width:100%;padding:14px 16px;display:flex;align-items:center;gap:14px;background:transparent;border:none;border-radius:16px;cursor:pointer;font-family:inherit;text-align:left;-webkit-tap-highlight-color:transparent">'
    +'<div style="width:40px;height:40px;border-radius:12px;background:rgba(239,68,68,.08);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></div>'
    +'<div style="font-size:15px;font-weight:700;color:#EF4444">Supprimer</div>'
    +'</button>'
    +'</div>'
    +'<div style="padding:0 12px"><button onclick="this.closest(\'[style*=fixed]\').remove();" style="width:100%;padding:15px;background:var(--bg);border:none;border-radius:16px;font-family:inherit;font-size:15px;font-weight:600;color:var(--mid);cursor:pointer">Annuler</button></div>';
  bd.appendChild(sheet);document.body.appendChild(bd);
}

// ── SONDAGES ─────────────────────────────────────────────────────────────
function openSondageSheet(){
  haptic(4);
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:28px 28px 0 0;width:100%;max-width:480px;padding:20px;padding-bottom:max(32px,env(safe-area-inset-bottom,32px));animation:mi .28s cubic-bezier(.32,1,.6,1);box-sizing:border-box;max-height:88vh;overflow-y:auto';
  sheet.innerHTML='<div style="text-align:center;margin-bottom:16px"><div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;display:inline-block"></div></div>'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">'
    +'<div style="width:44px;height:44px;border-radius:13px;background:rgba(255,107,43,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg></div>'
    +'<div><div style="font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.02em">Créer un sondage</div>'
    +'<div style="font-size:13px;color:var(--lite);margin-top:2px">Pose une question à tes élèves</div></div>'
    +'</div>'
    +'<input id="_sdgQ" type="text" placeholder="Ta question…" class="esp-input" style="margin-bottom:14px">'
    +'<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Options</div>'
    +'<div id="_sdgOpts">'
    +'<input class="esp-input _sdgOpt" placeholder="Option 1" style="margin-bottom:8px">'
    +'<input class="esp-input _sdgOpt" placeholder="Option 2" style="margin-bottom:8px">'
    +'</div>'
    +'<button onclick="addSondageOption()" style="background:none;border:1.5px dashed var(--bdr);border-radius:12px;width:100%;padding:10px;font-family:inherit;font-size:13px;font-weight:600;color:var(--mid);cursor:pointer;margin-bottom:16px;-webkit-tap-highlight-color:transparent">+ Ajouter une option</button>'
    +'<button onclick="submitSondage(this)" class="esp2-btn-submit" style="width:100%">Publier le sondage</button>'
    +'<button onclick="this.closest(\'[style*=rgba]\').remove()" style="width:100%;margin-top:10px;padding:14px;background:transparent;border:none;font-family:inherit;font-size:14px;font-weight:600;color:var(--lite);cursor:pointer">Annuler</button>';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  bd.appendChild(sheet);document.body.appendChild(bd);
  setTimeout(function(){var inp=document.getElementById('_sdgQ');if(inp)inp.focus();},200);
}

function addSondageOption(){
  var container=document.getElementById('_sdgOpts');if(!container)return;
  var count=container.querySelectorAll('._sdgOpt').length;
  if(count>=6){toast('Maximum 6 options','');return;}
  var inp=document.createElement('input');
  inp.type='text';inp.className='esp-input _sdgOpt';inp.placeholder='Option '+(count+1);inp.style.marginBottom='8px';
  container.appendChild(inp);inp.focus();
}

function submitSondage(btn){
  var uid=user&&user.id;if(!uid)return;
  var q=(document.getElementById('_sdgQ')||{value:''}).value.trim();
  if(!q){toast('Écris une question','');return;}
  var opts=Array.from(document.querySelectorAll('._sdgOpt')).map(function(el){return el.value.trim();}).filter(Boolean);
  if(opts.length<2){toast('Au moins 2 options','');return;}
  if(btn){btn.disabled=true;btn.textContent='…';}
  var body={type:'poll',content:JSON.stringify({question:q,options:opts,votes:{}})};
  fetch(API+'/teacher/'+uid+'/announcements',{method:'POST',headers:apiH(),body:JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){if(btn){btn.disabled=false;btn.textContent='Publier le sondage';}toast('Erreur',d.error);return;}
      haptic(8);toast('Sondage publié !','');
      var bd=btn&&btn.parentElement;while(bd&&!bd.style.cssText.includes('rgba'))bd=bd.parentElement;
      if(bd)bd.remove();
      loadMesPublications();espLoadAnnonces();
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Publier le sondage';}toast('Erreur réseau','');});
}

function voteOnPoll(annId,profId,optIdx,container){
  if(!user){toast('Connecte-toi pour voter','');return;}
  haptic(4);
  fetch(API+'/teacher/'+profId+'/announcements/'+annId+'/vote',{method:'POST',headers:apiH(),body:JSON.stringify({option_index:optIdx})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){toast('Erreur',d.error);return;}
      haptic(8);
      var poll;try{poll=JSON.parse(d.content);}catch(e){return;}
      if(container)container.innerHTML=_renderPollHtml(poll,annId,true,profId);
    }).catch(function(){toast('Erreur réseau','');});
}

// ── BIBLIOTHÈQUE ──────────────────────────────────────────────────────────
function openBibliotheque(){
  var el=g('bdBibliotheque');if(!el)return;
  el.style.display='flex';
  haptic(4);
  loadBibliotheque();
}

function closeBibliotheque(){
  var el=g('bdBibliotheque');if(!el)return;
  el.classList.add('closing');
  setTimeout(function(){el.style.display='none';el.classList.remove('closing');},240);
}

// ── BIBLIOTHÈQUE ÉLÈVE (lecture seule) ────────────────────────────────────
function openElveBibliotheque(pid){
  if(!pid)return;
  var el=g('bdElveBibliotheque');if(!el)return;
  el.style.display='flex';
  haptic(4);
  loadElveBibliotheque(pid);
}

function closeElveBibliotheque(){
  var el=g('bdElveBibliotheque');if(!el)return;
  el.classList.add('closing');
  setTimeout(function(){el.style.display='none';el.classList.remove('closing');},240);
}

function loadElveBibliotheque(pid){
  var grid=g('elveBiblioList');if(!grid)return;
  grid.innerHTML='<div class="skeleton" style="height:68px;border-radius:16px;margin-bottom:8px"></div>'
    +'<div class="skeleton" style="height:68px;border-radius:16px;margin-bottom:8px"></div>'
    +'<div class="skeleton" style="height:68px;border-radius:16px"></div>';
  var TYPE_ICON={pdf:'📄',video:'🎥',article:'📰',exercice:'✏️',fiche:'📋',text:'📝',link:'🔗'};
  Promise.all([
    fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
    fetch(API+'/teacher/'+pid+'/resources',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
    fetch(API+'/teacher/'+pid+'/content',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(results){
    var fiches=(results[0]||[]).filter(function(a){return a.type==='fiche';});
    var resources=results[1]||[];
    var content=results[2]||[];
    if(!fiches.length&&!resources.length&&!content.length){
      grid.innerHTML='<div style="text-align:center;padding:60px 24px">'
        +'<div style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="36" height="36"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>'
        +'</div>'
        +'<div style="font-size:20px;font-weight:800;color:var(--ink);margin-bottom:10px;letter-spacing:-.03em">Bibliothèque vide</div>'
        +'<div style="font-size:14px;color:var(--lite);line-height:1.7">Ton prof n\'a pas encore partagé de contenu.</div></div>';
      return;
    }
    var html='';
    if(fiches.length){
      html+='<div class="mes-section-title" style="padding:4px 4px 8px">Fiches de cours</div>';
      html+=fiches.map(function(f){
        return'<div onclick="espOpenFicheEleve(\''+pid+'\',\''+escH(f.id)+'\')" style="display:flex;align-items:center;gap:12px;background:var(--wh);border:1px solid var(--bdr);border-radius:16px;padding:14px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent">'
          +'<div style="width:40px;height:40px;border-radius:12px;background:rgba(34,192,105,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
          +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.title||'Fiche sans titre')+'</div>'
          +'<div style="font-size:12px;color:var(--lite);margin-top:2px">Fiche de cours</div></div>'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2.5" stroke-linecap="round" width="14" height="14" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'
          +'</div>';
      }).join('');
    }
    if(resources.length||content.length){
      html+='<div class="mes-section-title" style="padding:'+(fiches.length?'16px':'4px')+' 4px 8px">Ressources</div>';
      resources.forEach(function(r){
        html+='<a href="'+esc(r.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;background:var(--wh);border:1px solid var(--bdr);border-radius:16px;padding:14px;margin-bottom:8px;text-decoration:none;-webkit-tap-highlight-color:transparent">'
          +'<div style="width:40px;height:40px;border-radius:12px;background:rgba(255,107,43,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">'+(TYPE_ICON[r.type]||'📎')+'</div>'
          +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.title||'Document')+'</div>'
          +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+esc(r.type||'document')+'</div></div>'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2" stroke-linecap="round" width="14" height="14" style="flex-shrink:0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
          +'</a>';
      });
      content.forEach(function(c){
        var typeIco={text:'📝',video:'🎥',pdf:'📄',link:'🔗'}[c.content_type]||'📚';
        var isUnlocked=c.is_unlocked;
        var tag=c.access_type==='password'?'Mot de passe requis':c.access_type==='premium'?'Premium':'Accès libre';
        var tagColor=c.access_type==='password'?'#8B5CF6':c.access_type==='premium'?'#F59E0B':'#10B981';
        html+='<div style="background:var(--wh);border:1px solid var(--bdr);border-radius:16px;padding:14px;margin-bottom:8px">'
          +'<div style="display:flex;align-items:center;gap:12px">'
          +'<div style="width:40px;height:40px;border-radius:12px;background:rgba(99,102,241,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">'+typeIco+'</div>'
          +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.title||'Contenu')+'</div>'
          +'<div style="font-size:11px;font-weight:600;color:'+tagColor+';margin-top:2px">'+tag+'</div></div>'
          +'</div>';
        if(isUnlocked&&c.content_url){
          html+='<a href="'+esc(c.content_url)+'" target="_blank" rel="noopener" style="display:block;margin-top:10px;padding:9px;background:rgba(99,102,241,.08);border-radius:10px;text-align:center;font-size:13px;font-weight:700;color:#6366F1;text-decoration:none">'+typeIco+' Voir le contenu</a>';
        }else if(c.access_type==='password'){
          html+='<div id="_elvePwRow_'+c.id+'" style="display:flex;gap:8px;margin-top:10px"><input type="password" placeholder="Mot de passe" class="esp-input" style="flex:1;font-size:13px;padding:8px 10px" id="_elvePwInp_'+c.id+'"><button onclick="elveBiblioUnlock(\''+pid+'\',\''+escH(c.id)+'\')" class="esp-btn esp-btn-prim" style="font-size:12px;padding:8px 12px">OK</button></div>';
        }
        html+='</div>';
      });
    }
    grid.innerHTML=html;
  }).catch(function(){grid.innerHTML='<div style="text-align:center;padding:40px;color:var(--lite)">Erreur de chargement</div>';});
}

function elveBiblioUnlock(pid,cid){
  var inp=document.getElementById('_elvePwInp_'+cid);if(!inp)return;
  var pw=inp.value.trim();if(!pw)return;
  fetch(API+'/teacher/'+pid+'/content/'+cid+'/unlock',{method:'POST',headers:apiH(),body:JSON.stringify({password:pw})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){toast('Mot de passe incorrect','');haptic(2);return;}
      haptic(8);toast('Contenu débloqué !','');loadElveBibliotheque(pid);
    }).catch(function(){});
}

// ── ENVOYER UN DOCUMENT (sheet) ───────────────────────────────────────────
function openSendDocSheet(){
  var pid=_curPrFull;if(!pid)return;
  haptic(4);
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:900;display:flex;align-items:flex-end;justify-content:center;transition:padding-bottom .18s';
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:28px 28px 0 0;width:100%;max-width:480px;padding:20px;padding-bottom:max(32px,env(safe-area-inset-bottom,32px));animation:mi .28s cubic-bezier(.32,1,.6,1);box-sizing:border-box';
  sheet.innerHTML='<div style="text-align:center;margin-bottom:20px"><div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;display:inline-block"></div></div>'
    +'<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">'
    +'<div style="width:48px;height:48px;border-radius:14px;background:rgba(34,192,105,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#22C069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +'</div>'
    +'<div><div style="font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.02em">Envoyer un document</div>'
    +'<div style="font-size:13px;color:var(--lite);margin-top:3px">Partagez un fichier avec votre prof</div></div>'
    +'</div>'
    +'<input id="_sendDocTitle" type="text" placeholder="Nom du document" class="esp-input" style="margin-bottom:10px">'
    +'<input id="_sendDocUrl" type="url" placeholder="Lien (Drive, Notion, Dropbox…)" class="esp-input" style="margin-bottom:16px">'
    +'<button onclick="mpfSubmitDocSheet(this)" class="esp2-btn-submit" style="width:100%">Envoyer</button>'
    +'<button id="_sendDocCancel" style="width:100%;margin-top:10px;padding:14px;background:transparent;border:none;font-family:inherit;font-size:14px;font-weight:600;color:var(--lite);cursor:pointer">Annuler</button>';
  // Keyboard avoidance — même pattern que openEnrollSheet : on pad le sheet, pas le backdrop
  var _sdKbShow=function(e){
    var h=(e&&e.keyboardHeight)||0;
    if(h>0){sheet.style.paddingBottom=(h+16)+'px';sheet.style.transition='padding-bottom .22s ease';}
  };
  var _sdKbHide=function(){
    sheet.style.paddingBottom='max(32px,env(safe-area-inset-bottom,32px))';
    sheet.style.transition='padding-bottom .18s ease';
  };
  window.addEventListener('keyboardWillShow',_sdKbShow);
  window.addEventListener('keyboardWillHide',_sdKbHide);
  bd.onclick=function(e){
    if(e.target===bd){
      window.removeEventListener('keyboardWillShow',_sdKbShow);
      window.removeEventListener('keyboardWillHide',_sdKbHide);
      bd.remove();
    }
  };
  function _sdClose(){
    window.removeEventListener('keyboardWillShow',_sdKbShow);
    window.removeEventListener('keyboardWillHide',_sdKbHide);
    bd.remove();
  }
  bd.appendChild(sheet);document.body.appendChild(bd);
  var cancelBtn=document.getElementById('_sendDocCancel');
  if(cancelBtn)cancelBtn.onclick=_sdClose;
  setTimeout(function(){var inp=document.getElementById('_sendDocTitle');if(inp)inp.focus();},200);
}

function mpfSubmitDocSheet(btn){
  var pid=_curPrFull;if(!pid)return;
  var title=(document.getElementById('_sendDocTitle')||{value:''}).value.trim();
  var url=(document.getElementById('_sendDocUrl')||{value:''}).value.trim();
  if(!title){toast('Donne un nom au document','');return;}
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+pid+'/submissions',{method:'POST',headers:apiH(),body:JSON.stringify({title:title,url:url||undefined})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){if(btn){btn.disabled=false;btn.textContent='Envoyer';}toast('Erreur',d.error);return;}
      haptic(8);toast('Document envoyé !','');
      var bd=btn&&btn.parentElement;while(bd&&!bd.style.cssText.includes('rgba(0,0,0,.5)'))bd=bd.parentElement;
      if(bd)bd.remove();
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Envoyer';}toast('Erreur réseau','');});
}

function loadBibliotheque(){
  var uid=user&&user.id;if(!uid)return;
  var grid=g('biblioGrid');if(!grid)return;
  grid.innerHTML='<div class="skeleton" style="height:140px;border-radius:18px;margin-bottom:10px"></div><div class="skeleton" style="height:110px;border-radius:18px;margin-bottom:10px"></div>';
  var ACCESS_ICON={enrolled:'🔓',password:'🔐',share:'🔗'};
  var ACCESS_LABEL={enrolled:'Tous',password:'Mot de passe',share:'Via partage'};
  var TYPE_ICON={pdf:'📄',video:'🎥',article:'📰',exercice:'✏️',fiche:'📋',text:'📝',link:'🔗'};
  // Fetch announcements (fiches) + resources
  Promise.all([
    fetch(API+'/teacher/'+uid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
    fetch(API+'/teacher/'+uid+'/resources',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];}),
    fetch(API+'/teacher/'+uid+'/content',{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(results){
    var _fIds;try{_fIds=new Set(JSON.parse(localStorage.getItem('cp_fiche_ids')||'[]'));}catch(e){_fIds=new Set();}
    var _fData;try{_fData=JSON.parse(localStorage.getItem('cp_fiche_data')||'{}');}catch(e){_fData={};}
    var fiches=(results[0]||[]).filter(function(a){return a.type==='fiche'||_fIds.has(String(a.id));});
    fiches=fiches.map(function(f){var c=_fData[String(f.id)]||{};return Object.assign({},f,{title:f.title||c.title||'',content:f.content||c.content||''});});
    var resources=results[1]||[];
    var content=results[2]||[];
    var items=[];
    fiches.forEach(function(f){items.push({id:f.id,kind:'fiche',title:f.title||'Fiche sans titre',icon:'📋',access:f.access_type||'enrolled',created_at:f.created_at});});
    resources.forEach(function(r){items.push({id:r.id,kind:'resource',title:r.title||'Document',icon:TYPE_ICON[r.type]||'📎',access:r.access_type||'enrolled',created_at:r.created_at});});
    content.forEach(function(c){items.push({id:c.id,kind:'content',title:c.title||'Contenu',icon:TYPE_ICON[c.content_type]||'📚',access:c.access_type||'enrolled',created_at:c.created_at});});
    items.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
    if(!items.length){
      grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:60px 24px">'
        +'<div style="width:80px;height:80px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="36" height="36"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>'
        +'</div>'
        +'<div style="font-size:20px;font-weight:800;color:var(--ink);margin-bottom:10px;letter-spacing:-.03em">Bibliothèque vide</div>'
        +'<div style="font-size:14px;color:var(--lite);line-height:1.7">Crée ta première fiche ou ajoute un document.</div>'
        +'</div>';
      return;
    }
    grid.innerHTML=items.map(function(item){
      var acc=item.access||'enrolled';
      var badge='<span class="biblio-access-badge '+acc+'">'+ACCESS_ICON[acc]+' '+ACCESS_LABEL[acc]+'</span>';
      return'<div class="biblio-card" onclick="biblioOpenItem(\''+item.kind+'\',\''+item.id+'\')">'
        +'<div class="biblio-card-ico">'+item.icon+'</div>'
        +'<div class="biblio-card-body">'
        +'<div class="biblio-card-title">'+esc(item.title)+'</div>'
        +badge
        +'</div>'
        +'<div class="biblio-card-actions">'
        +'<button onclick="event.stopPropagation();biblioSetAccess(\''+item.kind+'\',\''+item.id+'\',\'enrolled\')" class="biblio-act-btn'+(acc==='enrolled'?' active':'')+'">🔓 Tous</button>'
        +'<button onclick="event.stopPropagation();biblioSetAccess(\''+item.kind+'\',\''+item.id+'\',\'password\')" class="biblio-act-btn'+(acc==='password'?' active':'')+'">🔐 MDP</button>'
        +'<button onclick="event.stopPropagation();biblioSetAccess(\''+item.kind+'\',\''+item.id+'\',\'share\')" class="biblio-act-btn'+(acc==='share'?' active':'')+'">🔗</button>'
        +'</div>'
        +'</div>';
    }).join('');
  });
}

function biblioOpenItem(kind,id){
  if(kind==='fiche')espOpenFiche(id);
}

function biblioSetAccess(kind,id,access){
  var uid=user&&user.id;if(!uid)return;
  var endpoints={resource:'/teacher/'+uid+'/resources/'+id,content:'/teacher/'+uid+'/content/'+id,fiche:'/teacher/'+uid+'/announcements/'+id};
  var ep=endpoints[kind];if(!ep)return;
  haptic(4);
  fetch(API+ep,{method:'PATCH',headers:apiH(),body:JSON.stringify({access_type:access})})
    .then(function(r){return r.json();}).then(function(){loadBibliotheque();})
    .catch(function(){toast('Erreur réseau','');});
}

// ── AJOUTER UN DOCUMENT ───────────────────────────────────────────────────
function openAddDoc(){
  var el=g('bdAddDoc');if(!el)return;
  el.style.display='flex';
  var sel=g('addDocAccess');
  if(sel)sel.addEventListener('change',function(){
    var pw=g('addDocPwBox');if(pw)pw.style.display=sel.value==='password'?'block':'none';
  },{once:false});
  haptic(4);
}

function closeAddDoc(){
  var el=g('bdAddDoc');if(!el)return;
  el.style.display='none';
}

function addDocSubmit(){
  var uid=user&&user.id;if(!uid)return;
  var title=(g('addDocTitle').value||'').trim();
  var url=(g('addDocUrl').value||'').trim();
  var type=g('addDocType').value;
  var access=g('addDocAccess').value;
  var pw=access==='password'?(g('addDocPw').value||'').trim():'';
  if(!title||!url){toast('Remplis le titre et le lien','');return;}
  var btn=g('addDocBtn');if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+uid+'/resources',{method:'POST',headers:apiH(),
    body:JSON.stringify({title:title,url:url,type:type,access_type:access,password:pw||undefined})})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.textContent='Ajouter';}
      if(d.error){toast('Erreur',d.error);return;}
      haptic(4);toast('Document ajouté !','');
      g('addDocTitle').value='';g('addDocUrl').value='';
      closeAddDoc();
      // Refresh la bibliothèque si ouverte
      if(g('bdBibliotheque')&&g('bdBibliotheque').style.display!=='none')loadBibliotheque();
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Ajouter';}toast('Erreur réseau','');});
}

function espDeleteAnn(id){
  var uid=user&&user.id;if(!uid)return;
  fetch(API+'/teacher/'+uid+'/announcements/'+id,{method:'DELETE',headers:apiH()}).then(function(){
    haptic(4);espLoadAnnonces();
  }).catch(function(){toast('Erreur','Impossible de supprimer');});
}

function espUpdateCounter(){
  var ed=g('espAnnEditor');if(!ed)return;
  var len=(ed.innerText||ed.textContent||'').replace(/\n/g,'').length;
  var ctr=g('espAnnCounter');if(!ctr)return;
  var max=1500;
  ctr.textContent=len+' / '+max;
  ctr.style.color=len>max?'#EF4444':len>max*0.85?'#F97316':'var(--lite)';
}
function espSubmitAnn(){
  var uid=user&&user.id;if(!uid)return;
  var ed=g('espAnnEditor');
  var content=ed?ed.innerHTML.trim():'';
  if(!content||content==='<br>'||content==='<p><br></p>'){toast('Écris quelque chose d\'abord','');return;}
  var _rawLen=(ed?(ed.innerText||ed.textContent||''):'').replace(/\n/g,'').length;
  if(_rawLen>1500){toast('Trop long','Limite de 1500 caractères');return;}
  var btn=g('espEdPublishBtn');
  if(btn){btn.disabled=true;btn.textContent='…';}
  var isFiche=_espEdMode==='fiche';
  var title=isFiche?(g('espEdTitleInp')?g('espEdTitleInp').value.trim():''):'';
  var body={content:content};
  if(isFiche)body.type='fiche';
  if(title)body.title=title;
  fetch(API+'/teacher/'+uid+'/announcements',{method:'POST',headers:apiH(),body:JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.textContent=isFiche?'Enregistrer':'Publier';}
      if(d.error){toast('Erreur',d.error);return;}
      // Cache l'ID + titre + contenu comme fiche dans localStorage
      if(isFiche&&d.id){try{
        var ids=JSON.parse(localStorage.getItem('cp_fiche_ids')||'[]');
        if(!ids.includes(String(d.id))){ids.push(String(d.id));localStorage.setItem('cp_fiche_ids',JSON.stringify(ids));}
        var ficheData=JSON.parse(localStorage.getItem('cp_fiche_data')||'{}');
        ficheData[String(d.id)]={title:title||d.title||'',content:content};
        localStorage.setItem('cp_fiche_data',JSON.stringify(ficheData));
      }catch(e){}}
      haptic(4);toast(isFiche?'Fiche enregistrée !':'Publié !','');
      closeEspEditor();
      if(isFiche){loadBibliotheque();openBibliotheque();}else{espLoadAnnonces();}
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent=isFiche?'Enregistrer':'Publier';}toast('Erreur réseau','');});
}

function _renderMpfTags(list){
  var tagsEl=g('mpfTags'),tagsSect=g('mpfTagsSection');
  if(!tagsEl){return;}
  if(!list||!list.length){if(tagsSect)tagsSect.style.display='none';return;}
  if(tagsSect)tagsSect.style.display='block';
  var MAT_COLORS={maths:'#3B82F6',physique:'#8B5CF6',chimie:'#EC4899',svt:'#10B981',informatique:'#0EA5E9',anglais:'#F59E0B',espagnol:'#EF4444',francais:'#6366F1',histoire:'#D97706',autre:'#7C3AED'};
  tagsEl.innerHTML=list.map(function(m){
    var mat=findMatiere(m);var col=mat?mat.color:(MAT_COLORS[m]||'var(--or)');
    return'<div style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border-radius:50px;padding:5px 12px 5px 8px;border:1.5px solid '+col+'30">'
      +'<div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div>'
      +'<span style="font-size:12.5px;font-weight:600;color:var(--ink)">'+esc(m)+'</span>'
      +'</div>';
  }).join('');
}

function _loadMpfAvis(pid){
  var avisContainer=g('tpAvisList');if(!avisContainer)return;
  avisContainer.innerHTML='<div class="skeleton" style="height:62px;border-radius:12px;margin:14px 16px"></div>';
  fetch(API+'/notations/'+pid).then(function(r){return r.json();}).then(function(notes){
    if(_curPrFull!==pid)return;
    if(!notes||!notes.length){
      avisContainer.innerHTML='<div style="text-align:center;padding:40px 20px;font-size:14px;color:#717171">Pas encore d\'avis pour le moment.</div>';
      return;
    }
    var _avg=(notes.reduce(function(s,a){return s+(a.note||0);},0)/notes.length).toFixed(1);
    if(P[pid])P[pid].n=_avg;
    if(P[pid])P[pid].nb_avis=notes.length;
    var _rtEl2=g('tpStRating');if(_rtEl2){_rtEl2.textContent=_avg+'★';_rtEl2.style.color='#FF9500';}
    if(g('tpStAvis'))g('tpStAvis').textContent=notes.length;
    var starsHtml=function(n){
      var s='';for(var i=1;i<=5;i++)s+=(i<=Math.round(n)?'★':'☆');return s;
    };
    var COLORS=['#3B82F6','#8B5CF6','#F59E0B','#10B981','#EF4444','#0EA5E9','#EC4899'];
    avisContainer.innerHTML=notes.slice(0,10).map(function(a,idx){
      var initial=a.prenom?a.prenom[0].toUpperCase():'?';
      var col=COLORS[idx%COLORS.length];
      return'<div style="display:flex;gap:12px;padding:14px 16px;border-bottom:0.5px solid #F0F0F0">'
        +'<div style="width:36px;height:36px;border-radius:50%;background:'+col+';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">'+initial+'</div>'
        +'<div style="flex:1">'
        +'<div style="font-size:13px;font-weight:600;color:#222">'+(a.prenom||'Élève')+'</div>'
        +'<div style="color:#FF9500;font-size:13px;letter-spacing:.03em;margin:2px 0">'+starsHtml(a.note||0)+'</div>'
        +(a.commentaire?'<div style="font-size:13px;color:#555;line-height:1.55;margin-top:4px">'+esc(a.commentaire)+'</div>':'')
        +'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){
    var c=g('tpAvisList');if(c)c.innerHTML='<div style="text-align:center;padding:40px 20px;font-size:14px;color:#717171">Pas encore d\'avis pour le moment.</div>';
  });
}

// ── MES AVIS (compte prof) ──────────────────────────────────────────────
function _loadProfAvis(){
  if(!user)return;
  var listEl=g('profAvisList');
  var avgEl=g('profAvisAvg');
  var starsEl=g('profAvisStars');
  var countEl=g('profAvisCount');
  if(listEl)listEl.innerHTML='<div class="skeleton" style="height:62px;border-radius:12px;margin:14px 16px"></div>';
  fetch(API+'/notations/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).then(function(notes){
    if(!notes||!notes.length){
      if(listEl)listEl.innerHTML='<div style="text-align:center;padding:40px 20px;font-size:14px;color:var(--lite)">Pas encore d\'avis pour le moment.</div>';
      if(avgEl)avgEl.textContent='—';
      if(starsEl)starsEl.textContent='☆☆☆☆☆';
      if(countEl)countEl.textContent='Aucun avis pour le moment';
      return;
    }
    var avg=(notes.reduce(function(s,a){return s+(a.note||0);},0)/notes.length).toFixed(1);
    if(avgEl){avgEl.textContent=avg;}
    var starsHtml=function(n){var s='';for(var i=1;i<=5;i++)s+=(i<=Math.round(n)?'★':'☆');return s;};
    if(starsEl)starsEl.textContent=starsHtml(avg);
    if(countEl)countEl.textContent=notes.length+' avis';
    var COLORS=['#3B82F6','#8B5CF6','#F59E0B','#10B981','#EF4444','#0EA5E9','#EC4899'];
    if(listEl)listEl.innerHTML=notes.slice(0,20).map(function(a,idx){
      var initial=a.prenom?a.prenom[0].toUpperCase():'?';
      var col=COLORS[idx%COLORS.length];
      return'<div style="display:flex;gap:12px;padding:14px 16px;border-bottom:0.5px solid var(--bdr)">'
        +'<div style="width:36px;height:36px;border-radius:50%;background:'+col+';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">'+initial+'</div>'
        +'<div style="flex:1">'
        +'<div style="font-size:13px;font-weight:600;color:var(--ink)">'+(a.prenom||'Élève')+'</div>'
        +'<div style="color:#FF9500;font-size:13px;letter-spacing:.03em;margin:2px 0">'+starsHtml(a.note||0)+'</div>'
        +(a.commentaire?'<div style="font-size:13px;color:var(--mid);line-height:1.55;margin-top:4px">'+esc(a.commentaire)+'</div>':'')
        +'</div>'
        +'</div>';
    }).join('');
  }).catch(function(){
    if(listEl)listEl.innerHTML='<div style="text-align:center;padding:40px 20px;font-size:14px;color:var(--lite)">Impossible de charger les avis.</div>';
  });
}

// ── ESPACE ÉLÈVE — chargement initial ────────────────────────────────────
function _loadMpfEspace(pid){
  // Referme les tiroirs si on change de prof
  ['espCardCours','espCardDocs'].forEach(function(id){
    var c=g(id);if(c)c.classList.remove('open');
  });
  _loadMpfNote(pid);
}

function _loadMpfFeed(pid){
  var el=g('mpfEspFil');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:80px;border-radius:16px;margin-bottom:10px"></div><div class="skeleton" style="height:60px;border-radius:16px"></div>';
  var p=P[pid]||{};
  var profNm=p.nm||'Votre prof';
  var profIni=(profNm[0]||'?').toUpperCase();
  var profCol=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var profPhoto=p.photo||null;
  fetch(API+'/teacher/'+pid+'/announcements',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(_curPrFull!==pid)return;
    if(!data||!data.length){
      el.innerHTML='<div style="text-align:center;padding:32px 20px;color:var(--lite)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.3;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>'
        +'<div style="font-size:14px;font-weight:600">Aucune annonce pour le moment</div>'
        +'<div style="font-size:12px;margin-top:4px">Le prof n\'a pas encore publié d\'annonces</div></div>';
      return;
    }
    var avInner=profPhoto?'<img src="'+esc(profPhoto)+'" alt="">':'<span>'+profIni+'</span>';
    var ONE_WEEK=7*24*60*60*1000;
    var pubs=data.filter(function(a){return a.type!=='fiche'&&(Date.now()-new Date(a.created_at))<ONE_WEEK;});
    if(!pubs.length){
      el.innerHTML='<div style="text-align:center;padding:32px 20px;color:var(--lite)"><div style="font-size:14px;font-weight:600">Aucune annonce récente</div></div>';
      return;
    }
    var lastDay='';
    el.innerHTML=pubs.map(function(a){
      var d=new Date(a.created_at);var dayKey=d.toISOString().slice(0,10);
      var sep=dayKey!==lastDay?'<div class="ann-day-sep">'+_annDayLabel(d)+'</div>':'';lastDay=dayKey;
      var time=_annTimeStr(a.created_at);
      var hd='<div class="forum-post-hd"><div class="forum-post-av" style="background:'+profCol+'">'+avInner+'</div>'
        +'<div><div class="forum-post-nm">'+esc(profNm)+'</div><div class="forum-post-date">'+time+'</div></div></div>';
      if(a.type==='poll'){
        var poll;try{poll=JSON.parse(a.content);}catch(e){poll=null;}
        if(!poll)return sep;
        return sep+'<div class="forum-post">'+hd
          +'<div style="padding:0 0 4px">'+_renderPollHtml(poll,a.id,true,pid)+'</div></div>';
      }
      var body=a.content&&a.content.trim().startsWith('<')?a.content:'<p>'+esc(a.content)+'</p>';
      return sep+'<div class="forum-post">'+hd+'<div class="forum-post-body">'+body+'</div></div>';
    }).join('');
  }).catch(function(){el.innerHTML='';});
}

function _loadMpfContenu(pid){
  var el=g('mpfEspContenu');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:90px;border-radius:16px;margin-bottom:10px"></div>';
  fetch(API+'/teacher/'+pid+'/content',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(_curPrFull!==pid)return;
    if(!data||!data.length){
      el.innerHTML='<div style="text-align:center;padding:32px 20px;color:var(--lite)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.3;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>'
        +'<div style="font-size:14px;font-weight:600">Aucun cours disponible</div>'
        +'<div style="font-size:12px;margin-top:4px">Le prof n\'a pas encore publié de contenu</div></div>';
      return;
    }
    el.innerHTML=data.map(function(c){
      var ico=c.access_type==='password'?'🔐':c.access_type==='premium'?'💎':'🔓';
      var typeIco={text:'📝',video:'🎥',pdf:'📄',link:'🔗'}[c.content_type]||'📚';
      var isUnlocked=c.is_unlocked;
      var tag=c.access_type==='password'?'Mot de passe requis':c.access_type==='premium'?'Premium · '+(c.price||'?')+'€/mois':'Accès libre';
      var tagColor=c.access_type==='password'?'#8B5CF6':c.access_type==='premium'?'#F59E0B':'#10B981';
      var body='';
      if(isUnlocked){
        if(c.description)body+='<div class="contenu-desc">'+esc(c.description)+'</div>';
        if(c.content_url)body+='<a href="'+esc(c.content_url)+'" target="_blank" rel="noopener" class="contenu-link">'+typeIco+' Voir le contenu</a>';
      }else if(c.access_type==='password'){
        body+='<div id="cttPwForm_'+c.id+'" style="display:flex;gap:8px;margin-top:10px">'
          +'<input type="text" placeholder="Mot de passe" class="esp-input" style="flex:1;font-size:13px;padding:8px 10px" id="cttPwInp_'+c.id+'">'
          +'<button onclick="mpfUnlockContent(\''+pid+'\',\''+c.id+'\')" class="esp-btn esp-btn-prim" style="font-size:12px;padding:8px 12px">OK</button>'
          +'</div>';
      }else if(c.access_type==='premium'){
        body+='<div style="margin-top:10px"><button onclick="contPrFull()" class="esp-btn esp-btn-prim" style="font-size:12px">Contacter le prof pour s\'abonner</button></div>';
      }
      return'<div class="contenu-card">'
        +'<div class="contenu-card-head">'
        +'<span style="font-size:20px">'+ico+'</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div class="contenu-title">'+esc(c.title)+'</div>'
        +'<div class="contenu-tag" style="color:'+tagColor+';background:'+tagColor+'18">'+tag+'</div>'
        +'</div>'
        +'</div>'
        +body
        +'</div>';
    }).join('');
  }).catch(function(){el.innerHTML='';});
}

function mpfUnlockContent(pid,cid){
  var inp=g('cttPwInp_'+cid);if(!inp)return;
  var pw=inp.value.trim();if(!pw)return;
  fetch(API+'/teacher/'+pid+'/content/'+cid+'/unlock',{method:'POST',headers:apiH(),body:JSON.stringify({password:pw})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){toast('Mot de passe incorrect','');haptic(2);return;}
      haptic(8);toast('Contenu débloqué !','');_loadMpfContenu(pid);
    }).catch(function(){});
}

function _loadMpfRessourcesEsp(pid){
  var el=g('mpfEspRessources');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:44px;border-radius:12px;margin-bottom:6px"></div>';
  var TYPE_ICON={'pdf':'📄','video':'🎥','article':'📰','exercice':'📝'};
  fetch(API+'/teacher/'+pid+'/resources',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(_curPrFull!==pid)return;
    if(!data||!data.length){el.innerHTML='<div style="font-size:13px;color:var(--lite);margin-bottom:8px">Aucun document partagé.</div>';return;}
    el.innerHTML=data.map(function(r){
      return'<a href="'+esc(r.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;background:var(--wh);border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;text-decoration:none;margin-bottom:8px">'
        +'<span style="font-size:20px;flex-shrink:0">'+(TYPE_ICON[r.type]||'📎')+'</span>'
        +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.title)+'</div>'
        +'<div style="font-size:11px;color:var(--lite);margin-top:2px">'+esc(r.type)+'</div></div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--lite)" stroke-width="2" stroke-linecap="round" width="14" height="14" style="flex-shrink:0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        +'</a>';
    }).join('');
  }).catch(function(){el.innerHTML='';});
}

function _loadMpfSubmissions(pid){
  var el=g('mpfMySubmissions');if(!el||!user)return;
  fetch(API+'/teacher/'+pid+'/submissions',{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(_curPrFull!==pid)return;
    if(!data||!data.length){el.innerHTML='<div style="font-size:12px;color:var(--lite);padding:4px 0">Aucun dépôt envoyé</div>';return;}
    el.innerHTML='<div style="font-size:11px;font-weight:800;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Envoyés</div>'
      +data.map(function(s){
      var d=new Date(s.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="16" height="16" style="flex-shrink:0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.title)+'</div><div style="font-size:11px;color:var(--lite)">'+d+'</div></div>'
        +(s.url?'<a href="'+esc(s.url)+'" target="_blank" style="font-size:11px;color:var(--or);font-weight:700;flex-shrink:0">Voir</a>':'')
        +'<button onclick="mpfDeleteSub(\''+pid+'\',\''+s.id+'\')" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--lite);flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>'
        +'</div>';
    }).join('');
  }).catch(function(){});
}

function mpfSubmitDoc(){
  var pid=_curPrFull;if(!pid)return;
  var title=((g('mpfSubTitle')||{}).value||'').trim();
  var url=((g('mpfSubUrl')||{}).value||'').trim();
  if(!title){toast('Donne un nom au document','');return;}
  var btn=document.querySelector('.esp2-btn-submit');
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+pid+'/submissions',{method:'POST',headers:apiH(),body:JSON.stringify({title:title,url:url||null})})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="14" height="14"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg> Envoyer';}
      if(d.error){toast('Erreur',d.error);return;}
      haptic(4);toast('Document envoyé !','');
      if(g('mpfSubTitle'))g('mpfSubTitle').value='';
      if(g('mpfSubUrl'))g('mpfSubUrl').value='';
      _loadMpfSubmissions(pid);
    }).catch(function(){if(btn){btn.disabled=false;}});
}

function mpfDeleteSub(pid,sid){
  fetch(API+'/teacher/'+pid+'/submissions/'+sid,{method:'DELETE',headers:apiH()}).then(function(){
    haptic(4);_loadMpfSubmissions(pid);
  });
}

function _loadMpfNote(pid){
  var el=g('mpfEspNotes');var sec=g('mpfEspNoteSection');if(!el||!user)return;
  fetch(API+'/teacher/'+pid+'/student-notes/'+user.id,{headers:apiH()}).then(function(r){return r.json();}).then(function(data){
    if(_curPrFull!==pid)return;
    if(!data||!data.content){if(sec)sec.style.display='none';return;}
    if(sec)sec.style.display='block';
    el.innerHTML='<div style="font-size:14px;color:var(--ink);line-height:1.65;white-space:pre-wrap;padding:4px 0">'+esc(data.content)+'</div>';
  }).catch(function(){if(sec)sec.style.display='none';});
}

// ── GESTION CONTENUS CÔTÉ PROF ───────────────────────────────────────────
function espCttAccessChange(sel){
  var pw=g('espCttPwBox'),pr=g('espCttPriceBox');
  if(pw)pw.style.display=sel.value==='password'?'block':'none';
  if(pr)pr.style.display=sel.value==='premium'?'block':'none';
}

function espToggleAddContenu(btn){
  var f=g('espContenuForm');if(!f)return;
  var show=f.style.display==='none';
  f.style.display=show?'flex':'none';
  if(btn)btn.textContent=show?'Annuler':'+ Ajouter';
}

function espSubmitContenu(){
  var uid=user&&user.id;if(!uid)return;
  var title=((g('espCttTitle')||{}).value||'').trim();
  if(!title){toast('Titre requis','');return;}
  var desc=((g('espCttDesc')||{}).value||'').trim();
  var url=((g('espCttUrl')||{}).value||'').trim();
  var type=(g('espCttType')||{}).value||'text';
  var access=(g('espCttAccess')||{}).value||'enrolled';
  var pw=access==='password'?((g('espCttPw')||{}).value||'').trim():null;
  var price=access==='premium'?parseInt((g('espCttPrice')||{}).value||'0',10):0;
  if(access==='password'&&!pw){toast('Mot de passe requis','');return;}
  var btn=document.querySelector('#espContenuForm .esp-btn-prim');
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+uid+'/content',{method:'POST',headers:apiH(),body:JSON.stringify({title:title,description:desc,content_url:url||null,content_type:type,access_type:access,password:pw,price:price})})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.textContent='Publier';}
      if(d.error){toast('Erreur',d.error);return;}
      haptic(8);toast('Contenu publié !','');
      if(g('espCttTitle'))g('espCttTitle').value='';
      if(g('espCttDesc'))g('espCttDesc').value='';
      if(g('espCttUrl'))g('espCttUrl').value='';
      var f=g('espContenuForm');if(f)f.style.display='none';
      var ab=document.querySelector('[onclick="espToggleAddContenu(this)"]');if(ab)ab.textContent='+ Ajouter';
      espLoadContenu();
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Publier';}});
}

function espLoadContenu(){
  var uid=user&&user.id;if(!uid)return;
  var el=g('espContenu');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:8px"></div>';
  var ACCESS_LABEL={'enrolled':'🔓 Accès libre','password':'🔐 Mot de passe','premium':'💎 Premium'};
  var TYPE_ICON={text:'📝',video:'🎥',pdf:'📄',link:'🔗'};
  fetch(API+'/teacher/'+uid+'/content',{headers:apiH()}).then(function(r){return r.json();}).then(function(list){
    if(!list||!list.length){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:10px 0">Aucun contenu publié.</div>';return;}
    el.innerHTML=list.map(function(c){
      var label=ACCESS_LABEL[c.access_type]||c.access_type;
      var tIco=TYPE_ICON[c.content_type]||'📚';
      return'<div style="background:var(--wh);border:1px solid var(--bdr);border-radius:14px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">'
        +'<span style="font-size:18px;flex-shrink:0">'+tIco+'</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.title)+'</div>'
        +'<div style="font-size:11px;color:var(--lite);margin-top:2px">'+label+(c.price?' · '+c.price+'€/mois':'')+'</div>'
        +'</div>'
        +'<button onclick="espDeleteContenu(\''+c.id+'\')" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--lite);flex-shrink:0">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>'
        +'</button>'
        +'</div>';
    }).join('');
  }).catch(function(){el.innerHTML='';});
}

function espDeleteContenu(id){
  var uid=user&&user.id;if(!uid)return;
  fetch(API+'/teacher/'+uid+'/content/'+id,{method:'DELETE',headers:apiH()}).then(function(){
    haptic(4);espLoadContenu();
  });
}

// ── MES COURS (prof) ──────────────────────────────────────────────────────
function goMesCoursPage(){
  if(user&&user.role==='professeur'){espGoMesCours();}
  else{navTo('mes');}
}

function espGoMesCours(){
  haptic(4);
  // navTo('mes') bloque les profs → navigation directe
  var pages=['pgExp','pgMsg','pgAcc','pgFav','pgMes','pgMesProfs'];
  pages.forEach(function(id){var el=g(id);if(el)el.classList.remove('on');});
  var pgMesEl=g('pgMes');if(pgMesEl)pgMesEl.classList.add('on');
  ['bniExp','bniFav','bniMsg','bniProfs','bniMes'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
  updateMobHeader('mes');
  restoreNav();
  _mesSeg='upcoming';
  buildMesCours();
}

var _espSelCours=null;

function espLoadMesCours(){
  var uid=user&&user.id;if(!uid)return;
  var el=g('espMesCoursList');if(!el)return;
  el.innerHTML='<div class="skeleton" style="height:54px;border-radius:12px;margin-bottom:6px"></div><div class="skeleton" style="height:54px;border-radius:12px"></div>';
  var now=new Date();
  var myCours=C.filter(function(c){return c.prof_id===uid||c.teacher_id===uid;});
  if(!myCours.length){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:10px 0">Aucun cours trouvé.</div>';return;}
  var upcoming=[],past=[];
  myCours.forEach(function(c){
    var d=c.date_heure||c.date||c.created_at;
    if(!d||(new Date(d))>=now)upcoming.push(c);else past.push(c);
  });
  upcoming.sort(function(a,b){return new Date(a.date_heure||a.date||0)-new Date(b.date_heure||b.date||0);});
  past.sort(function(a,b){return new Date(b.date_heure||b.date||0)-new Date(a.date_heure||a.date||0);});
  var html='';
  function renderRows(list,tag,label){
    if(!list.length)return;
    html+='<div class="esp-mc-section">'+label+'</div>';
    list.forEach(function(c){
      var emoji=c.emoji||'📘';
      var titre=esc(c.titre||c.title||'Cours');
      var date='';
      var d=c.date_heure||c.date;
      if(d){var dd=new Date(d);date=dd.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+(c.heure?' · '+c.heure:'');}
      html+='<div class="esp-mc-row" onclick="espOpenCourseActions(\''+c.id+'\')">'
        +'<div style="font-size:22px;flex-shrink:0;width:36px;text-align:center">'+emoji+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+titre+'</div>'
        +(date?'<div style="font-size:11px;color:var(--lite);margin-top:1px">'+date+'</div>':'')
        +'</div>'
        +'<span class="esp-mc-tag '+tag+'">'+label+'</span>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--bdr)" stroke-width="2.5" stroke-linecap="round" width="13" height="13" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
    });
  }
  renderRows(upcoming,'upcoming','À venir');
  renderRows(past,'past','Passés');
  el.innerHTML=html||'<div style="color:var(--lite);font-size:13px;padding:10px 0">Aucun cours.</div>';
}

function espOpenCourseActions(id){
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  _espSelCours=c;
  var titleEl=g('espCaTitle'),subEl=g('espCaSub'),iconEl=g('espCaIcon');
  if(titleEl)titleEl.textContent=c.titre||c.title||'Cours';
  if(subEl){
    var d=c.date_heure||c.date;
    subEl.textContent=d?new Date(d).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'long'}):'';
  }
  if(iconEl)iconEl.textContent=c.emoji||'📘';
  // reset sub-forms
  ['espCaDocForm','espCaMsgForm','espCaInscList'].forEach(function(id){var el=g(id);if(el)el.style.display='none';});
  var bd=g('bdEspCourseActions');if(!bd)return;
  bd.style.display='flex';
  haptic(4);
}

function closeEspCourseActions(){
  var bd=g('bdEspCourseActions');if(!bd)return;
  bd.style.display='none';
  _espSelCours=null;
}

function espCaAddDoc(){
  var f=g('espCaDocForm');if(!f)return;
  g('espCaMsgForm').style.display='none';
  g('espCaInscList').style.display='none';
  f.style.display=f.style.display==='none'?'block':'none';
}

function espCaSendMsg(){
  var f=g('espCaMsgForm');if(!f)return;
  g('espCaDocForm').style.display='none';
  g('espCaInscList').style.display='none';
  f.style.display=f.style.display==='none'?'block':'none';
}

function espCaManage(){
  var f=g('espCaInscList');if(!f)return;
  g('espCaDocForm').style.display='none';
  g('espCaMsgForm').style.display='none';
  if(f.style.display!=='none'){f.style.display='none';return;}
  f.style.display='block';
  if(!_espSelCours)return;
  var el=g('espCaInscContent');if(!el)return;
  el.innerHTML='<div style="color:var(--lite);font-size:13px">Chargement…</div>';
  fetch(API+'/reservations/cours/'+_espSelCours.id,{headers:apiH()})
    .then(function(r){return r.json();}).then(function(list){
      if(!list||!list.length){el.innerHTML='<div style="color:var(--lite);font-size:13px;padding:4px 0">Aucun élève inscrit.</div>';return;}
      el.innerHTML=list.map(function(r){
        var name=esc((r.student_name||r.nom||'Élève'));
        var status=r.status==='confirmed'?'Payé':'En attente';
        var color=r.status==='confirmed'?'#22C55E':'var(--or)';
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)">'
          +'<div style="width:32px;height:32px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--mid);flex-shrink:0">'+name.charAt(0).toUpperCase()+'</div>'
          +'<div style="flex:1;font-size:13px;font-weight:600;color:var(--ink)">'+name+'</div>'
          +'<span style="font-size:11px;font-weight:700;color:'+color+'">'+status+'</span>'
          +'</div>';
      }).join('');
    }).catch(function(){el.innerHTML='<div style="color:var(--lite);font-size:13px">Erreur réseau.</div>';});
}

function espCaDocSubmit(){
  if(!_espSelCours)return;
  var uid=user&&user.id;if(!uid)return;
  var title=(g('espCaDocTitle').value||'').trim();
  var url=(g('espCaDocUrl').value||'').trim();
  var type=g('espCaDocType').value;
  if(!title||!url){toast('Remplis le titre et le lien','');return;}
  var btn=document.querySelector('#espCaDocForm .esp2-btn-submit');
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/teacher/'+uid+'/resources',{method:'POST',headers:apiH(),
    body:JSON.stringify({title:title,url:url,type:type,cours_id:_espSelCours.id})})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.textContent='Ajouter au cours';}
      if(d.error){toast('Erreur',d.error);return;}
      haptic(4);toast('Document ajouté !','');
      g('espCaDocTitle').value='';g('espCaDocUrl').value='';
      g('espCaDocForm').style.display='none';
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Ajouter au cours';}toast('Erreur réseau','');});
}

function espCaMsgSubmit(){
  if(!_espSelCours)return;
  var uid=user&&user.id;if(!uid)return;
  var msg=(g('espCaMsgText').value||'').trim();
  if(!msg){toast('Écris un message','');return;}
  var btn=document.querySelector('#espCaMsgForm .esp2-btn-submit');
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(API+'/messages/groupe',{method:'POST',headers:apiH(),
    body:JSON.stringify({cours_id:_espSelCours.id,message:msg,sender_id:uid})})
    .then(function(r){return r.json();}).then(function(d){
      if(btn){btn.disabled=false;btn.textContent='Envoyer à tous';}
      if(d.error){toast('Erreur',d.error);return;}
      haptic(4);toast('Message envoyé à tous les inscrits !','');
      g('espCaMsgText').value='';
      g('espCaMsgForm').style.display='none';
    }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Envoyer à tous';}toast('Erreur réseau','');});
}

function switchMpfTab(tab){
  // Delegate to new tab system
  var tpMap={profil:'presentation',cours:'cours',espace:'espace'};
  if(tpMap[tab])switchTpTab(tpMap[tab]);
}

function toggleEsp2Card(id,section){
  var card=g(id);if(!card)return;
  var opening=!card.classList.contains('open');
  card.classList.toggle('open',opening);
  haptic(4);
  if(opening){
    // Côté élève
    var pid=_curPrFull;
    if(section==='cours'){_loadMpfContenu(pid);_loadMpfRessourcesEsp(pid);}
    if(section==='docs'){_loadMpfSubmissions(pid);}
    // Côté prof
    if(section==='code')espLoadCode();
    if(section==='eleves')espLoadStudents();
    if(section==='annonces')espLoadAnnonces();
    if(section==='received')espLoadReceivedDocs();
    if(section==='ressources'){espLoadResources();espLoadFiches();}
    if(section==='contenu')espLoadContenu();
    if(section==='mesCours')espLoadMesCours();
  }
}

function openEspPubs(){
  var el=g('bdEspPubs');if(!el)return;
  el.style.display='flex';
  haptic(4);
  _loadMpfFeed(_curPrFull);
}

function closeEspPubs(){
  var el=g('bdEspPubs');if(!el)return;
  el.classList.add('closing');
  setTimeout(function(){el.style.display='none';el.classList.remove('closing');},240);
}

function closePrFull(){
  var el=g('bdPrFull');if(!el)return;
  el.classList.add('closing');
  setTimeout(function(){if(el)el.style.display='none';el.classList.remove('closing');},240);
}

function contPrFull(){
  var pid=_curPrFull||curProf;
  var p=P[pid]||{};
  closePrFull();
  openMsg(p.nm||'le professeur',pid,p.photo||null);
}

function togFPFull(){
  haptic(6);
  var pid=_curPrFull||curProf;
  if(!user||user.guest){toast(t('t_follow_login'),'');scrollToLogin();return;}
  var wasFollowed=fol.has(pid);
  if(wasFollowed){unfollowProf(pid);}
  else{
    fol.add(pid);_saveFol();_syncFollowBtns(pid,true);
    var _f2uid=user.id;
    if(!_followInFlight.has(pid)){
      _followInFlight.add(pid);
      fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:pid})})
        .then(function(r){return r.json();}).then(function(d){_followInFlight.delete(pid);if(d&&d.followers_count!==undefined&&user&&user.id===_f2uid){P[pid]=P[pid]||{};P[pid].e=d.followers_count;_saveFollowCount(pid,d.followers_count);}})
        .catch(function(){_followInFlight.delete(pid);});
    }
    toast(t('t_followed'),'');haptic(4);updateFavBadge();
  }
  _setMpfFollowBtn(fol.has(pid));
  var pmp=g('pgMesProfs');if(pmp&&pmp.classList.contains('on'))buildMesProfs();
}

function _setMpfFollowBtn(isFollowed){
  // Top bar follow button (compat — may not exist in new design)
  var t2=g('bFPFullT'),btn=g('bFPFull');
  if(t2&&btn){
    if(isFollowed){
      t2.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
      btn.style.background='rgba(255,107,43,.08)';btn.style.borderColor='rgba(255,107,43,.3)';btn.style.color='#FF6B2B';
    } else {
      t2.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
      btn.style.background='';btn.style.borderColor='';btn.style.color='';
    }
  }
  // Avatar follow badge
  var badge=g('tpVerifBadge'),badgeIco=g('tpFollowBadgeIco');
  if(badge){
    badge.classList.toggle('following',isFollowed);
    if(badgeIco){
      badgeIco.innerHTML=isFollowed
        ?'<polyline points="20 6 9 17 4 12"/>'
        :'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
      badgeIco.setAttribute('stroke',isFollowed?'#E8611A':'#fff');
    }
  }
}

/* ── sync tous les card-follow-btn au retour sur Explorer ── */
function _syncAllFollowBtns(){
  var svgOn='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
  var svgOff='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
  var miniOn='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg>';
  var miniOff='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  document.querySelectorAll('.card-follow-btn[data-pid]').forEach(function(btn){
    var pid=btn.getAttribute('data-pid');
    var on=fol.has(pid);
    btn.setAttribute('data-fol',on?'1':'0');
    btn.title=on?'Ne plus suivre':'Suivre ce professeur';
    if(btn.classList.contains('card-follow-mini')){
      btn.style.background=on?'#FF6B35':'#fff';
      btn.innerHTML=on?miniOn:miniOff;
    }else{
      btn.innerHTML=on?svgOn:svgOff;
      btn.style.background=on?'rgba(255,107,43,0.12)':'rgba(255,255,255,0.85)';
      btn.style.color=on?'#FF6B2B':'var(--lite)';
    }
  });
}
/* ── sync tous les card-follow-btn d'un prof sur les cards explorer ── */
function _syncFollowBtns(pid,isFollowing){
  var svgOn='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
  var svgOff='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
  var miniOn='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg>';
  var miniOff='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  document.querySelectorAll('.card-follow-btn[data-pid="'+pid+'"]').forEach(function(btn){
    btn.setAttribute('data-fol',isFollowing?'1':'0');
    btn.title=isFollowing?'Ne plus suivre':'Suivre ce professeur';
    if(btn.classList.contains('card-follow-mini')){
      btn.style.background=isFollowing?'#FF6B35':'#fff';
      btn.innerHTML=isFollowing?miniOn:miniOff;
    }else{
      btn.innerHTML=isFollowing?svgOn:svgOff;
      btn.style.background=isFollowing?'rgba(255,107,43,0.12)':'rgba(255,255,255,0.85)';
      btn.style.color=isFollowing?'#FF6B2B':'var(--lite)';
    }
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
    ft.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> '+t('fol_remove');
  }else{
    fb.style.background='';
    fb.style.borderColor='';
    fb.style.color='';
    ft.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> '+t('fol_add');
  }
}

function togFP(){
  haptic(6);
  var id=curProf,p=P[id]||{nm:'ce prof'};
  if(user&&id===user.id){toast(t('t_self_follow'),t('t_self_follow_s'));return;}
  if(_followInFlight.has(id))return; // anti-spam
  _followInFlight.add(id);
  if(fol.has(id)){
    fol.delete(id);_saveFol();
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
          _followInFlight.delete(id);
          if(data&&data.nb_eleves!==undefined){
            P[id].e=data.nb_eleves;
            if(g('mpE'))g('mpE').textContent=P[id].e;
            _saveFollowCount(id,P[id].e);
          }
        })
        .catch(function(){
          _followInFlight.delete(id);
          fol.add(id);_saveFol();_setFollowBtn(true);_syncFollowBtns(id,true);
          if(P[id])P[id].e=(P[id].e||0)+1;
          if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
          _saveFollowCount(id,P[id].e||0);
          toast(t('t_net_error'),'');
        });
    }
  } else {
    fol.add(id);_saveFol();
    _setFollowBtn(true);
    _syncFollowBtns(id,true);
    toast(t('t_vous_suivez')+' '+p.nm,t('t_following_msg'));
    P[id]=P[id]||{n:'—',e:0,col:'linear-gradient(135deg,#FF8C55,#E04E10)'};P[id].e=(P[id].e||0)+1;
    if(user&&user.id){
      fetch(API+'/follows',{method:'POST',headers:apiH(),body:JSON.stringify({user_id:user.id,professeur_id:id})})
        .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
        .then(function(data){
          _followInFlight.delete(id);
          if(data&&data.error)throw new Error(data.error);
          if(data&&data.nb_eleves!==undefined){
            P[id].e=data.nb_eleves;
            if(g('mpE'))g('mpE').textContent=P[id].e;
            _saveFollowCount(id,P[id].e);
          }
        })
        .catch(function(){
          _followInFlight.delete(id);
          fol.delete(id);_saveFol();_setFollowBtn(false);_syncFollowBtns(id,false);
          if(P[id])P[id].e=Math.max(0,(P[id].e||1)-1);
          if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
          _saveFollowCount(id,P[id].e||0);
          toast(t('t_net_error'),'');
        });
    }
  }
  if(g('mpE'))g('mpE').textContent=P[id]?P[id].e:0;
  if(P[id]){try{var _pc2=JSON.parse(localStorage.getItem('cp_profs')||'{}');if(!_pc2[id])_pc2[id]={ts:Date.now(),nm:P[id].nm||'',i:P[id].i||'',photo:P[id].photo||''};_pc2[id].e=P[id].e||0;localStorage.setItem('cp_profs',JSON.stringify(_pc2));}catch(ex){}_saveFollowCount(id,P[id].e||0);}
  var pfav=g('pgFav');if(pfav&&pfav.classList.contains('on'))buildFavPage();
  var pmp=g('pgMesProfs');if(pmp&&pmp.classList.contains('on'))buildMesProfs();
  // Mettre à jour le compteur "Suivis" dans les stats immédiatement
  if(g('asecF')&&g('asecF').classList.contains('on')){
    var _folCntEl=g('accStats');
    if(_folCntEl){var _sc=_folCntEl.querySelector('div:nth-child(2) div');if(_sc)_sc.textContent=fol.size;}
  }
  updateFavBadge();
  // Fetch différé supprimé — le count serveur est maintenant retourné directement par POST/DELETE /follows
  setTimeout(function(){
    fetch(API+'/profiles/'+id).then(function(r){return r.json();}).then(function(prof){
      if(!prof||!prof.id)return;
      var _nbE=prof.nb_eleves!==undefined?prof.nb_eleves:(prof.followers_count!==undefined?prof.followers_count:undefined);
      if(_nbE!==undefined){
        P[id]=P[id]||{};
        P[id].e=_nbE;
        if(g('mpE')&&curProf===id)g('mpE').textContent=P[id].e;
        _saveFollowCount(id,P[id].e);
      }
    }).catch(function(){});
  },1500);
}

// CRÉER COURS
function openCr(){
  if(!user||user.role!=='professeur'){toast(t('t_denied'),t('t_prof_only'));return;}
  if(user.verified===false){
    if(getCniStatus()==='none'){toast(t('t_cni_req'),'');openCniSheet();}
    else{toast(t('exp_verif'),t('exp_verif_sub'));}
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
  if(window._publishing){toast(t('t_error'),t('t_in_progress'));return;}
  window._publishing=true;
  var btn=document.querySelector('#bdCr .pb.pri');
  if(btn){btn.textContent=t('txt_publishing');btn.disabled=true;}
  var titre=g('crTitre').value.trim(),date=g('crDate').value,heure=g('crHeure').value;
  // Validation
  if(!titre){shakeField(g('crTitre'));toast(t('t_title_req'),t('t_title_req_msg'),true);return;}
  var crSubjH=g('crSubjHidden');
  if(!crSubjH||!crSubjH.value){var crMB=g('crMatBtn');if(crMB){crMB.style.borderColor='#EF4444';setTimeout(function(){crMB.style.borderColor='';},600);}toast(t('t_subject_req'),t('t_subject_req_msg'),true);return;}
  if(!date){shakeField(g('crDate'));toast(t('t_date_req'),t('t_date_req_msg'),true);return;}
  if(!heure){shakeField(g('crHeure'));toast(t('t_hour_req'),t('t_hour_req_msg'),true);return;}
  var lieu=g('crLieu').value.trim(),places=parseInt(g('cPl').value)||5,prix=parseInt(g('cPr').value)||0;
  var desc=g('crDesc')?g('crDesc').value.trim():'';
  // Matière depuis le sélecteur natif
  var crSubjH=g('crSubjHidden');
  var subjKey=crSubjH?crSubjH.value:'';
  var matFound=MATIERES.find(function(m){return m.key===subjKey;});
  var sujet=matFound?matFound.label:'Autre';
  if(!titre||!date||!heure||!lieu||!prix){
    toast(t('t_fields_miss'),'');
    window._publishing=false;if(btn){btn.textContent=t('txt_publish_btn');btn.disabled=false;}return;
  }
  var dateObj=new Date(date+'T'+heure);
  if(dateObj<=new Date()){
    toast(t('t_invalid_date'),t('t_future_date'));
    window._publishing=false;if(btn){btn.textContent=t('txt_publish_btn');btn.disabled=false;}return;
  }
  var dateFormatee=dateObj.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'long',timeZone:'Europe/Paris'})+' · '+heure;
  var colors={'📐 Maths':'#16A34A','⚗️ Physique':'#BE185D','💻 Info':'#2563EB','🌍 Langues':'#059669','📊 Éco':'#D97706','✨ Autre':'#7C3AED'};
  var bgs={'📐 Maths':'linear-gradient(135deg,#F0FDF4,#BBF7D0)','⚗️ Physique':'linear-gradient(135deg,#FDF2F8,#F9A8D4)','💻 Info':'linear-gradient(135deg,#EFF6FF,#BFDBFE)','🌍 Langues':'linear-gradient(135deg,#ECFDF5,#A7F3D0)','📊 Éco':'linear-gradient(135deg,#FFFBEB,#FDE68A)','✨ Autre':'linear-gradient(135deg,#F5F3FF,#DDD6FE)'};
  var sc=colors[sujet]||'#7C3AED',bg=bgs[sujet]||bgs['✨ Autre'];
  var payload={
    titre,sujet,couleur_sujet:sc,background:bg,
    date_heure:dateFormatee,date_iso:dateObj.toISOString(),lieu,prix_total:prix,places_max:places,
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
    if(data.error){toast(t('t_publish_fail'),typeof data.error==='string'?data.error:data.error.message||data.error.details||t('t_try_again'));return;}
    g('crTitre').value='';
  var crSH=g('crSubjHidden');if(crSH)crSH.value='';
  var crML=g('crMatLabel');if(crML){crML.textContent=t('nc_mat_ph');crML.style.color='var(--lite)';}
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
    toast(isFirstCours?t('t_first_course'):t('t_course_published'),isFirstCours?t('t_first_course_sub'):t('t_visible_students'));
  }catch(e){toast(t('t_net_error'),'');}
  finally{window._publishing=false;if(btn){btn.textContent=t('txt_publish_btn');btn.disabled=false;}}
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
      toast(t('t_duplicated'),t('t_duplicated_msg'));
    },200);
  },300);
}

function confirmDeleteCoursNative(id){
  // ActionSheet natif sur iOS/Android, confirm() sinon
  if(window.confirm(t('confirm_cancel_cours'))){
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
    if(data.error){toast(t('t_error'),data.error);return;}
    await loadData();buildCards();buildAccLists();
    var nb=data.remboursements||0;
    toast(t('t_cancelled'),nb>0?nb+' '+t('mp_eleves').toLowerCase().replace(/s$/,'')+(nb>1?'s':'')+' '+t('t_cancelled_sub'):'');
  }catch(e){if(typeof sentryCaptureException==='function')sentryCaptureException(e,{action:'annuler_cours',cours_id:id});toast(t('t_net_error'),'');}
  window._deleteId=null;
}
function calcH(){
  var p=parseInt(g('cPr').value)||0,pl=parseInt(g('cPl').value)||1;
  var pp=p>0?Math.ceil(p/pl):0;
  var ch=g('cH');
  if(!ch)return;
  if(p>0){
    var txt=t('soit_par_eleve')+' '+pp+'€ '+t('calc_per')+' '+pl+' '+(pl>1?t('pour_places'):t('pour_place'));
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
var msgDestinataire=null,msgDestId=null,msgPollTimer=null,_msgLoadFailed=false;

function openMsg(profNm,destId,avatar){
  if(!user||!user.id){toast(t('t_error'),t('t_login_msg'));return;}
  if(!destId){toast(t('t_error'),t('t_no_recipient'));return;}
  if(destId===user.id){toast(t('t_action_impossible'),t('t_msg_self'));return;}
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
  var _pCache=P[destId]||{};
  var _avIni=_pCache.i||(profNm?profNm.trim().split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase():'?')||'?';
  var _avCol=_pCache.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  var _avPhoto=(avatar&&avatar!=='null'&&avatar!=='')?avatar:(_pCache.photo||null);
  setAvatar(av,_avPhoto,_avIni,_avCol);
  var _isPlaceholder=!profNm||profNm==='·\u200B·\u200B·'||profNm==='Contact';
  g('msgConvName').textContent=_isPlaceholder?'…':profNm;
  var _mtb=g('msgTuteurBadge');if(_mtb)_mtb.style.display=(P[destId]&&P[destId].is_tuteur)?'inline-block':'none';
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
  var ab=g('msgAttachBtn');if(ab)ab.style.display=(user&&user.role==='professeur')?'flex':'none';

  // Mark active row
  document.querySelectorAll('.msg-row').forEach(function(r){r.classList.remove('active');});
  var activeRow=document.querySelector('[data-uid="'+msgDestId+'"]');
  if(activeRow)activeRow.classList.add('active');

  _msgLoadFailed=false;
  loadMessages();
  clearTimeout(msgPollTimer);
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
  if(convPane){convPane.style.display='none';convPane.style.bottom='';}
  var pgMsg=g('pgMsg');
  if(pgMsg)pgMsg.classList.remove('conv-open');
  // Restaurer la nav (iPad: retirer ipad-back + cacher bouton rond ; mobile: retirer conv-mode)
  var bnav=g('bnav');
  if(bnav){bnav.classList.remove('conv-mode');bnav.classList.remove('ipad-back');}
  var _bb=g('bnavIpadBack');if(_bb)_bb.classList.remove('visible');
  // Restore normal nav state for messages page (bniMsg highlighted)
  restoreNav();
  var bMsg=g('bniMsg');if(bMsg)bMsg.classList.add('on');
  clearTimeout(msgPollTimer);msgPollTimer=null;msgDestId=null;
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
      box.innerHTML='<div style="text-align:center;padding:40px;color:var(--lite);font-size:14px">'+t('aucun_msg')+'. '+t('dites_bonjour')+'</div>';
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
        var lbl=diff===0?t('date_today'):diff===1?t('date_yesterday'):d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
        h+='<div class="msg-date-sep"><span>'+lbl.charAt(0).toUpperCase()+lbl.slice(1)+'</span></div>';
      }
      var isMe=m.sender_id===user.id;
      var time=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      var txt=m.contenu||'';
      // Masquer JSON brut
      if(txt.includes('"mode":"presentiel"')||txt.includes('prof_couleur'))return;
      // Détecter card cours — normaliser l'ancien openR vers viewCoursCard
      var _isCourseCard=txt.includes('class="chat-cours-card"');
      if(_isCourseCard){
        txt=txt.replace(/onclick="openR\(/g,'onclick="viewCoursCard(');
        var _idM=txt.match(/viewCoursCard\((?:&#39;|')([^'&#<>]+)(?:&#39;|')\)/);
        if(_idM){
          var _cid=_idM[1];
          var _mc=C.find(function(x){return String(x.id)==String(_cid);});
          // Dark mode : remplacer le fond clair par bgDark
          if(document.documentElement.classList.contains('dk')&&_mc){
            var _mm=findMatiere(_mc.subj||'')||MATIERES[MATIERES.length-1];
            txt=txt.replace(/class="chat-cours-card-header" style="background:[^"]*"/,'class="chat-cours-card-header" style="background:'+(_mm.bgDark||_mm.bg)+'"');
          }
          // Bouton visio si applicable (inscrit dans la fenêtre ou prof)
          if(_mc&&_mc.mode==='visio'&&_mc.visio_url){
            var _vNow=Date.now();
            var _vStart=_mc.dt_iso?new Date(_mc.dt_iso).getTime():0;
            var _vInWin=!_vStart||(_vNow>=_vStart-15*60*1000&&_vNow<=_vStart+2*60*60*1000);
            var _isProf2=user&&_mc.pr===user.id;
            var _isEnrolled2=!!res[_mc.id];
            if(_isProf2||(_isEnrolled2&&_vInWin)){
              var _vBtn='<a href="'+safeUrl(_mc.visio_url)+'" target="_blank" class="btn-visio" style="margin-top:8px;width:100%;justify-content:center;text-decoration:none;box-sizing:border-box" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Rejoindre en visio</a>';
              txt=txt.replace('</div></div>','</div>'+_vBtn+'</div>');
            }
          }
          // Remplacer la card entière si le cours n'est plus actif
          var _st=getCourseState(_cid);
          if(_st==='past'||_st==='deleted'){
            var _isPastCard=_st==='past';
            var _replaceLbl=_isPastCard?'Cours terminé':'Cours supprimé';
            var _replaceIcon=_isPastCard
              ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
              :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            txt='<div style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg);border:1.5px solid var(--bdr);border-radius:12px;font-size:13px;font-weight:600;color:var(--lite);max-width:220px">'+_replaceIcon+_replaceLbl+'</div>';
          }
        }
      }
      var isCard=_isCourseCard&&txt.trimStart().startsWith('<');
      var op=P[msgDestId]||{};
      var oPhoto=op.photo||null;
      var oIni=(op.i||(msgDestinataire&&msgDestinataire[0])||'?');
      var oCol=op.col||'linear-gradient(135deg,#FF8C55,var(--ord))';
      var avHtml='';
      if(!isMe){
        avHtml='<div class="msg-bubble-av" style="background:'+oCol+'">'+(oPhoto?'<img src="'+oPhoto+'" style="width:100%;height:100%;object-fit:cover">':oIni)+'</div>';
      }
      // ESP card (fiche / publication / sondage partagé)
      if(txt.startsWith('%%ESP%%')){
        try{var _ec=JSON.parse(txt.slice(7));
          h+='<div class="msg-bubble-row '+(isMe?'me':'them')+'">'+(isMe?'':avHtml)+_renderEspCardInner(_ec,isMe,time)+'</div>';
        }catch(e){}
        return;
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
  }catch(e){
    console.log('loadMessages err',e);
    if(!_msgLoadFailed){_msgLoadFailed=true;toast(t('t_net_error'),'');}
  }
}

async function sendMsg(){
  var txt=(g('msgInput').value||'').trim();
  if(!txt)return;
  if(!user){toast(t('t_error'),t('t_reconnect_msg'));return;}
  if(user.role==='professeur'&&!user.verified){toast(t('t_not_verified'),t('t_verify_to_msg'));return;}
  if(!msgDestId){toast(t('t_error'),t('t_no_recipient'));return;}
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
    if(!r.ok){var err=await r.json().catch(function(){return{};});toast(t('t_error'),err.error||t('t_msg_failed_s'));inp.value=txt;return;}
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
  }catch(e){inp.value=txt;toast(t('t_error'),t('t_msg_failed'));}
  finally{if(btn)btn.disabled=false;}
}

function closeMsg(){
  clearTimeout(msgPollTimer);msgPollTimer=null;
  msgDestId=null;
  closeM('bdMsg');
}

async function sendModalMsg(){
  var txt=g('modalMsgInput').value.trim();
  if(!txt||!msgDestId||!user)return;
  if(user.role==='professeur'&&!user.verified){
    toast(t('t_not_verified'),t('t_verify_to_msg'));
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
  }catch(e){toast(t('t_error'),t('t_msg_failed_s'));}
}

var _convLoading=false;
var _convCache=''; // cache HTML de la liste pour affichage immédiat
var _convRetries=0; // compteur de tentatives auto (cold start / timeout iOS)
var _convRetryTimer=null; // handle du timer de retry — annulable
var _convGen=0; // génération — écarte les résultats périmés (requêtes en retard)
async function loadConversations(){
  if(!user)return;
  var lm=g('listM');
  if(!lm)return;
  // Afficher le cache immédiatement si disponible, sinon spinner
  if(_convCache){lm.innerHTML=_convCache;}
  else{lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>Chargement</div>';}
  if(_convLoading)return; // refresh déjà en cours, cache affiché suffit
  _convLoading=true;
  var myGen=++_convGen; // marquer cette invocation
  // Timeout de sécurité : libérer après 10s max
  var _convTimeout=setTimeout(function(){_convLoading=false;},10000);
  try{
    var r=await fetch(API+'/conversations/'+user.id,{headers:apiH()});
    // Token expiré (cold start ou inactivité >1h) → refresh + réessai automatique
    if(r.status===401){await _refreshToken();r=await fetch(API+'/conversations/'+user.id,{headers:apiH()});}
    // Requête périmée — une invocation plus récente a déjà pris le relais
    if(myGen!==_convGen)return;
    if(!r.ok)throw new Error('HTTP '+r.status);
    var msgs=await r.json();
    _convRetries=0; // succès — réinitialiser le compteur de tentatives
    if(!Array.isArray(msgs)||!msgs.length){
      var _isProf=user&&user.role==='professeur';
      var _emptyDesc=_isProf?'Entamez une conversation ou attendez qu\'un élève vous contacte':'Contactez un professeur depuis un cours';
      lm.innerHTML='<div style="text-align:center;padding:56px 24px">'
        +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="30" height="30"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
        +'</div>'
        +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:8px">'+t('msg_empty_conv')+'</div>'
        +'<div style="font-size:13px;color:var(--lite)">'+_emptyDesc+'</div>'
        +'</div>';
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
      if(m.other_nom){P[otherId].nm=m.other_nom;}
      if(m.other_photo){P[otherId].photo=m.other_photo;}
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
      var preview=_pc.includes('chat-cours-card')||_pc.includes('"mode":"')?'📚 '+t('rr_partager'):(esc(_pc.slice(0,35))+(_pc.length>35?'…':''));
      var unreadDot=nonLu?'<div style="width:10px;height:10px;min-width:10px;border-radius:50%;background:var(--or);flex-shrink:0;align-self:center;box-shadow:0 0 0 3px rgba(255,107,43,.15)"></div>':'';
      return'<div class="msg-row'+(nonLu?' msg-unread':'')+'" data-uid="'+otherId+'" onclick="openMsg(\''+nm.replace(/'/g,"\\'")+'\'\,\''+otherId+'\',\''+(photo||'')+'\')"><div class="msg-av" data-prof="'+otherId+'" style="background:'+col+'">'+av+'</div><div class="msg-info"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><div class="msg-name" data-profnm="'+otherId+'">'+nm+'</div><div style="font-size:11px;color:'+(nonLu?'var(--or)':'var(--lite)')+';font-weight:'+(nonLu?'700':'400')+'">'+time+'</div></div><div class="msg-preview">'+(isMe?'Vous · ':'')+preview+'</div></div>'+unreadDot+'</div>';
    }).join('');
    var _convHtml=html||'<div style="text-align:center;padding:20px;color:var(--lite)">'+t('msg_empty_conv')+'</div>';
    lm.innerHTML=_convHtml;
    lm.querySelectorAll('.msg-row').forEach(function(r){
      r.addEventListener('touchstart',function(){this.classList.add('tapped');},{passive:true});
      r.addEventListener('touchend',function(){this.classList.remove('tapped');});
      r.addEventListener('touchcancel',function(){this.classList.remove('tapped');});
    });
    _convCache=_convHtml; // mémoriser pour affichage instantané au prochain onglet
    var badge=g('msgBadge');
    if(badge){if(nonLus>0){badge.style.display='inline-flex';badge.textContent=nonLus;}else{badge.style.display='none';}}
    var bnavBadge=g('bnavBadge');
    if(bnavBadge){if(nonLus>0){bnavBadge.classList.add('on');bnavBadge.textContent=nonLus;}else{bnavBadge.classList.remove('on');}}
  }catch(e){
    // Requête périmée (une plus récente a déjà abouti) — ne pas toucher l'UI
    if(myGen!==_convGen)return;
    _convLoading=false;
    // Ne pas retry sur erreurs 4xx (auth/client) — seulement réseau/5xx méritent un retry
    var _httpM=e.message&&e.message.match(/HTTP (\d+)/);var _httpC=_httpM?parseInt(_httpM[1]):0;
    if(_httpC>=400&&_httpC<500){
      clearTimeout(_convRetryTimer);_convRetryTimer=null;_convRetries=0;
      if(lm)lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">'+t('err_connection')+' <a onclick="_convRetries=0;loadConversations()" style="color:var(--or);cursor:pointer">'+t('txt_retry')+'</a></div>';
      return;
    }
    _convRetries++;
    if(_convRetries<4){
      // Retry silencieux (cold start Railway / timeout réseau iOS) — max 3 tentatives
      if(lm&&!_convCache)lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>'+t('msg_reconnecting')+'</div>';
      clearTimeout(_convRetryTimer);
      _convRetryTimer=setTimeout(function(){_convRetryTimer=null;loadConversations();},_convRetries*4000);
    }else{
      _convRetries=0;
      if(lm)lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">'+t('err_load_fail')+' <a onclick="_convRetries=0;loadConversations()" style="color:var(--or);cursor:pointer">'+t('txt_retry')+'</a></div>';
    }
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
var _geoPermDenied=false;

function openAppSettings(){
  try{
    var isCap=window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform();
    if(isCap){window.open('app-settings:','_system');return;}
  }catch(e){}
  toast(t('t_geoloc_off'),t('t_geoloc_off_msg'));
}

function requestGeoloc(){
  // Permission déjà refusée → ouvrir les réglages directement
  if(_geoPermDenied){openAppSettings();return;}
  // Toggle : si déjà actif → désactiver
  if(_geoActive){
    _geoActive=false;_geoCoords=null;
    var btn=g('locGeoBtn'),lbl=g('geoBtnLabel'),distBtn=g('geoDistBtn');
    if(btn){btn.style.background='var(--orp)';btn.style.color='var(--or)';btn.style.padding='5px 8px';}
    if(lbl){lbl.textContent=t('exp_around_me');lbl.style.display='';}
    if(distBtn)distBtn.style.display='none';
    var inp=g('locInput');if(inp)inp.value='';
    var cb=g('locClearBtn');if(cb)cb.style.display='none';
    actLoc='';geoMode=false;userCoords=null;_geoPermDenied=false;
    applyFilter();
    return;
  }
  if(!navigator.geolocation){toast(t('t_error'),t('t_geoloc_unsup'));return;}
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
      toast(t('exp_around_me'),'');
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
      if(lbl)lbl.textContent=t('exp_around_me');
      if(err.code===1){
        _geoPermDenied=true;
        // Changer l'icône du bouton pour indiquer l'état "refusé → réglages"
        if(btn){btn.style.background='#FEF2F2';btn.style.color='#EF4444';}
        toast(t('t_geoloc_deny'),t('t_geoloc_deny_msg'));
      } else {
        toast(t('t_error'),t('t_geoloc_fail'));
      }
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
  var lbl=g('pillVilleLabel');if(lbl)lbl.textContent=val.trim()||t('filter_ville');
  clearTimeout(locFilterTimer);
  locFilterTimer=setTimeout(function(){
    actLoc=val.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    updateResetBtn();
    applyFilter();
  },300);
}

function locInputClear(){
  var inp=g('locInput');if(inp)inp.value='';
  var btn=g('locClearBtn');if(btn)btn.style.display='none';
  var lbl=g('pillVilleLabel');if(lbl)lbl.textContent=t('filter_ville');
  var bar=document.querySelector('.locbar');if(bar)bar.classList.remove('open');
  var pill=g('pillVille');if(pill)pill.classList.remove('on');
  actLoc='';
  updateResetBtn();
  applyFilter();
}

// ============================================================
// FILTRES CUSTOM
// ============================================================
var customFilters=(function(){try{return JSON.parse(localStorage.getItem('cp_custom_filters')||'[]');}catch(e){return[];}})();
// Reconstruire FM pour les filtres custom restaurés depuis localStorage
customFilters.forEach(function(f){FM[f.key]=function(t){return t.includes(f.key);};});

function openAddFilter(){
  var bd=g('bdFilter');
  if(!bd)return;
  // Déplacer dans body pour éviter le clipping par overflow:hidden du parent
  if(bd.parentNode!==document.body)document.body.appendChild(bd);
  var inp=g('filterInput');if(inp)inp.value='';
  var aliasBox=g('filterAliasSuggestion');if(aliasBox)aliasBox.style.display='none';
  renderBarConfig();
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}

function renderBarConfig(){
  var grid=g('barConfigGrid');
  if(!grid)return;
  // Pool complet : built-ins + custom
  var allPool=_FILTER_POOL.slice();
  customFilters.forEach(function(f){
    if(!allPool.find(function(x){return x.key===f.key;})){
      allPool.push({key:f.key,label:f.label,emoji:'✨',custom:true});
    }
  });
  var html='<div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px">';
  allPool.forEach(function(f){
    var inBar=_barActive.indexOf(f.key)!==-1;
    html+='<button onclick="toggleBarFilter(\''+f.key+'\')" style="display:inline-flex;align-items:center;gap:5px;'
      +(inBar
          ?'background:var(--or);color:#fff;box-shadow:0 2px 10px rgba(255,107,43,.3);'
          :'background:var(--wh);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.07),0 0 0 0.5px rgba(0,0,0,.06);')
      +'border:none;border-radius:50px;padding:9px 16px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;-webkit-tap-highlight-color:transparent">'
      +esc(f.label)
      +(inBar?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" width="11" height="11" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>':'')
      +(f.custom?'<span onclick="event.stopPropagation();removeBarCustom(\''+f.key+'\')" style="display:inline-flex;align-items:center;justify-content:center;margin-left:2px;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.25);font-size:10px;font-weight:800">✕</span>':'')
      +'</button>';
  });
  html+='</div>';
  grid.innerHTML=html;
}

function toggleBarFilter(key){
  var idx=_barActive.indexOf(key);
  if(idx!==-1){
    _barActive.splice(idx,1);
  } else {
    _barActive.push(key);
  }
  try{localStorage.setItem('cp_bar_active',JSON.stringify(_barActive));}catch(e){}
  // Si le filtre actif vient d'être retiré, revenir à "tous"
  if(actF===key){actF='tous';}
  renderFilterBar();
  renderBarConfig();
  doFilter();
}

function addBarCustomFilter(){
  var inp=g('filterInput');
  if(!inp)return;
  var val=inp.value.trim();
  if(!val)return;
  var key=val.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  // Ajouter aux customFilters si absent
  if(!customFilters.find(function(f){return f.key===key;})){
    customFilters.push({label:val,key:key});
    try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
    FM[key]=function(t){return t.includes(key);};
  }
  // Ajouter à la barre
  if(_barActive.indexOf(key)===-1){
    _barActive.push(key);
    try{localStorage.setItem('cp_bar_active',JSON.stringify(_barActive));}catch(e){}
  }
  inp.value='';
  var aliasBox=g('filterAliasSuggestion');if(aliasBox)aliasBox.style.display='none';
  renderFilterBar();
  renderBarConfig();
  doFilter();
}

function removeBarCustom(key){
  customFilters=customFilters.filter(function(f){return f.key!==key;});
  try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
  _barActive=_barActive.filter(function(k){return k!==key;});
  try{localStorage.setItem('cp_bar_active',JSON.stringify(_barActive));}catch(e){}
  delete FM[key];
  if(actF===key)actF='tous';
  renderFilterBar();
  renderBarConfig();
  doFilter();
}
function closeAddFilter(){
  var bd=g('bdFilter');
  if(bd)bd.style.display='none';
  document.body.style.overflow='';
}

// Compat: addCustomFilter now delegates to addBarCustomFilter
function addCustomFilter(){
  addBarCustomFilter();
}

// Compat: addFilterQuick adds to customFilters + FM without activating bar
function addFilterQuick(val){
  var key=val.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(customFilters.find(function(f){return f.key===key;}))return;
  customFilters.push({label:val,key:key});
  try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
  FM[key]=function(t){return t.includes(key);};
}

// Compat: selectCustomFilter → toggle in bar and activate
function selectCustomFilter(key){
  if(_barActive.indexOf(key)===-1){
    _barActive.push(key);
    try{localStorage.setItem('cp_bar_active',JSON.stringify(_barActive));}catch(e){}
  }
  renderFilterBar();
  renderBarConfig();
  closeAddFilter();
  var pill=document.querySelector('[data-f="'+key+'"]');
  if(pill)setPill(pill);
}

// Compat: removeCustomFilter → delegates to removeBarCustom
function removeCustomFilter(key){
  removeBarCustom(key);
}

// Compat: renderCustomPills is no longer used (replaced by renderBarConfig)
function renderCustomPills(){
  // no-op: replaced by renderBarConfig
}

// Compat: addAndActivateFilter (was called from suggestion chips — now those chips are gone)
function addAndActivateFilter(label){
  var key=label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(!customFilters.find(function(f){return f.key===key;})){
    customFilters.push({label:label,key:key});
    try{localStorage.setItem('cp_custom_filters',JSON.stringify(customFilters));}catch(e){}
    FM[key]=function(t){return t.includes(key);};
  }
  if(_barActive.indexOf(key)===-1){
    _barActive.push(key);
    try{localStorage.setItem('cp_bar_active',JSON.stringify(_barActive));}catch(e){}
  }
  renderFilterBar();
  renderBarConfig();
  var pill=document.querySelector('[data-f="'+key+'"]');
  if(pill)setTimeout(function(){closeAddFilter();setPill(pill);},120);
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
  var ga=g('groupeAttachBtn');if(ga)ga.style.display=_groupeIsProf?'flex':'none';
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
      container.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--lite);font-size:13px">'+t('msg_empty_group')+'</div>';
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
        var label = diff===0?t('date_today'):diff===1?t('date_yesterday'):d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
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
      if((m.contenu||'').startsWith('%%ESP%%')){
        try{var _gec=JSON.parse(m.contenu.slice(7));
          html+='<div style="display:flex;flex-direction:column;margin-bottom:2px">'+nameHtml
            +'<div style="display:flex;justify-content:'+(isMe?'flex-end':'flex-start')+';align-items:flex-end;gap:6px">'
            +avHtml+_renderEspCardInner(_gec,isMe,time)+'</div></div>';
        }catch(e){}
        return;
      }
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
  if(!canWrite){ toast(t('t_read_only'),t('t_read_only_msg')); return; }
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
  }catch(e){ toast(t('t_error'),t('t_msg_failed_s')); }
  finally{ if(btn) btn.disabled = false; }
}

// ── ESP MSG ATTACHMENT ─────────────────────────────────────────────────────
var _msgAttachIsGroupe=false;
var _espPickItems=[];
var _espPickType='';

function openMsgAttachment(isGroupe){
  _msgAttachIsGroupe=!!isGroupe;haptic(4);
  var _svgFiche='<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="22" height="22"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  var _svgPub='<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="22" height="22"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>';
  var _svgPoll='<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="22" height="22"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
  var opts=[
    {icon:_svgFiche,label:'Fiche de cours',sub:'Partage une fiche depuis ton espace',type:'fiche'},
    {icon:_svgPub,label:'Publication',sub:'Partage une annonce ou publication',type:'pub'}
  ];
  if(isGroupe)opts.push({icon:_svgPoll,label:'Sondage',sub:'Pose une question au groupe',type:'sondage'});
  var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:14px 20px 8px"><div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.02em">Partager dans la conversation</div></div>'
    +'<div style="padding:0 12px max(20px,calc(env(safe-area-inset-bottom,0px)+16px));display:flex;flex-direction:column;gap:8px">';
  opts.forEach(function(o){
    var fn=o.type==='sondage'?'openSondageCreator()':'_espMsgPickContent(\''+o.type+'\')';
    html+='<button onclick="closeQuickSheet();setTimeout(function(){'+fn+';},80)" style="width:100%;background:var(--bg);border:none;border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:14px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent">'
      +'<div style="width:44px;height:44px;border-radius:12px;background:var(--orp);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+o.icon+'</div>'
      +'<div><div style="font-size:15px;font-weight:700;color:var(--ink)">'+o.label+'</div><div style="font-size:12px;color:var(--lite);margin-top:2px">'+o.sub+'</div></div>'
      +'</button>';
  });
  html+='<button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Annuler</button></div>';
  showQuickSheet(html);
}

function _espMsgPickContent(type){
  _espPickType=type;
  showQuickSheet('<div style="padding:48px;text-align:center;color:var(--lite)">Chargement…</div>');
  fetch(API+'/teacher/'+user.id+'/announcements',{headers:apiH()})
    .then(function(r){return r.json();})
    .then(function(list){
      var filter=type==='fiche'?function(a){return a.type==='fiche';}:function(a){return a.type!=='fiche';};
      _espPickItems=(list||[]).filter(filter);
      if(!_espPickItems.length){
        showQuickSheet('<div style="padding:40px 20px;text-align:center;color:var(--lite);font-size:14px">Aucun contenu disponible dans ton espace</div>'
          +'<div style="padding:0 20px max(20px,calc(env(safe-area-inset-bottom,0px)+16px))"><button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Fermer</button></div>');
        return;
      }
      var _icSmall='<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="18" height="18">'+(type==='fiche'?'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>':'<path d="M3 11l18-5v12L3 14v-3z"/>')+'</svg>';
      var icon=_icSmall;
      var title=type==='fiche'?'Fiches de cours':'Publications';
      var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
        +'<div style="padding:14px 20px 8px"><div style="font-size:17px;font-weight:800;color:var(--ink)">'+title+'</div></div>'
        +'<div style="max-height:55vh;overflow-y:auto;padding:0 12px;display:flex;flex-direction:column;gap:6px">';
      _espPickItems.forEach(function(item,idx){
        html+='<button onclick="closeQuickSheet();_espMsgSendCardByIdx('+idx+')" style="width:100%;background:var(--bg);border:none;border-radius:14px;padding:13px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent">'
          +'<span style="font-size:20px;flex-shrink:0">'+icon+'</span>'
          +'<span style="font-size:14px;font-weight:600;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(item.title||'Sans titre')+'</span>'
          +'</button>';
      });
      html+='</div><div style="padding:10px 12px max(20px,calc(env(safe-area-inset-bottom,0px)+16px))">'
        +'<button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Annuler</button></div>';
      showQuickSheet(html);
    })
    .catch(function(){showQuickSheet('<div style="padding:40px;text-align:center;color:var(--lite)">Erreur de chargement</div>');});
}

function _espMsgSendCardByIdx(idx){
  var item=_espPickItems[idx];if(!item)return;
  _espMsgSendCard(_espPickType,item.id,item.title||'');
}

function _espMsgSendCard(type,id,title){
  var contenu='%%ESP%%'+JSON.stringify({t:type,id:id,title:title,pid:user.id});
  if(_msgAttachIsGroupe){
    var c=C.find(function(x){return x.id==_groupeCoursId;});
    fetch(API+'/messages/groupe',{method:'POST',headers:apiH(),body:JSON.stringify({
      cours_id:_groupeCoursId,expediteur_id:user.id,
      expediteur_nom:((user.pr||'')+(user.nm?' '+user.nm:'')).trim()||'Professeur',
      contenu:contenu,cours_titre:c?c.title:'Cours'
    })}).then(function(){_loadGroupeMsgs();var c2=g('groupeMsgList');if(c2)c2.scrollTop=c2.scrollHeight;});
  }else{
    fetch(API+'/messages',{method:'POST',headers:apiH(),body:JSON.stringify({
      expediteur_id:user.id,destinataire_id:msgDestId,contenu:contenu
    })}).then(function(){loadMessages();});
  }
  haptic(6);toast('Partagé dans la conversation','');
}

function openSondageCreator(){
  var inpStyle='width:100%;border:1.5px solid var(--bdr);border-radius:12px;padding:12px 14px;font-family:inherit;font-size:14px;background:var(--bg);color:var(--ink);outline:none;box-sizing:border-box';
  var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:14px 20px 8px"><div style="font-size:17px;font-weight:800;color:var(--ink)">Créer un sondage</div></div>'
    +'<div style="padding:0 20px;display:flex;flex-direction:column;gap:10px">'
    +'<input id="sondageQ" placeholder="Votre question…" style="'+inpStyle+';font-size:15px" onfocus="this.style.borderColor=\'var(--or)\'" onblur="this.style.borderColor=\'var(--bdr)\'">'
    +'<input id="sondageO1" placeholder="Option 1" style="'+inpStyle+'" onfocus="this.style.borderColor=\'var(--or)\'" onblur="this.style.borderColor=\'var(--bdr)\'">'
    +'<input id="sondageO2" placeholder="Option 2" style="'+inpStyle+'" onfocus="this.style.borderColor=\'var(--or)\'" onblur="this.style.borderColor=\'var(--bdr)\'">'
    +'<input id="sondageO3" placeholder="Option 3 (optionnel)" style="'+inpStyle+'" onfocus="this.style.borderColor=\'var(--or)\'" onblur="this.style.borderColor=\'var(--bdr)\'">'
    +'</div>'
    +'<div style="padding:14px 20px max(20px,calc(env(safe-area-inset-bottom,0px)+16px));display:flex;flex-direction:column;gap:8px">'
    +'<button onclick="_sendSondageMsg()" style="width:100%;background:var(--or);color:#fff;border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Envoyer le sondage</button>'
    +'<button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Annuler</button>'
    +'</div>';
  showQuickSheet(html);
}

function _sendSondageMsg(){
  var q=(g('sondageQ')&&g('sondageQ').value||'').trim();
  var o1=(g('sondageO1')&&g('sondageO1').value||'').trim();
  var o2=(g('sondageO2')&&g('sondageO2').value||'').trim();
  var o3=(g('sondageO3')&&g('sondageO3').value||'').trim();
  if(!q||!o1||!o2){toast('Complète la question et au moins 2 options','');return;}
  var opts=[o1,o2];if(o3)opts.push(o3);
  closeQuickSheet();
  var contenu='%%ESP%%'+JSON.stringify({t:'sondage',q:q,opts:opts});
  var c=C.find(function(x){return x.id==_groupeCoursId;});
  fetch(API+'/messages/groupe',{method:'POST',headers:apiH(),body:JSON.stringify({
    cours_id:_groupeCoursId,expediteur_id:user.id,
    expediteur_nom:((user.pr||'')+(user.nm?' '+user.nm:'')).trim()||'Professeur',
    contenu:contenu,cours_titre:c?c.title:'Cours'
  })}).then(function(){_loadGroupeMsgs();var c2=g('groupeMsgList');if(c2)c2.scrollTop=c2.scrollHeight;});
  haptic(6);
}

function _renderEspCardInner(d,isMe,time){
  var labels={fiche:'Fiche de cours',pub:'Publication',sondage:'Sondage'};
  var _ic12={
    fiche:'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    pub:'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M3 11l18-5v12L3 14v-3z"/></svg>',
    sondage:'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="11" height="11"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
  };
  var icon=_ic12[d.t]||'';
  var lbl=labels[d.t]||'Contenu';
  var tapAttr=(d.pid&&d.t!=='sondage')?' onclick="openProfEspace(\''+d.pid+'\')"':'';
  if(d.t==='sondage'){
    var optsHtml=(d.opts||[]).map(function(o,i){
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--bdr)">'
        +'<span style="font-size:12px;font-weight:700;color:var(--or);min-width:16px">'+(i+1)+'.</span>'
        +'<span style="font-size:13px;color:var(--ink)">'+esc(o)+'</span></div>';
    }).join('');
    return '<div class="esp-msg-card" style="align-self:'+(isMe?'flex-end':'flex-start')+'">'
      +'<div style="font-size:10px;font-weight:700;color:var(--or);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">'+icon+' '+lbl+'</div>'
      +'<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:8px;line-height:1.3">'+esc(d.q||'')+'</div>'
      +optsHtml
      +'<div style="font-size:10px;color:var(--lite);margin-top:8px;text-align:'+(isMe?'right':'left')+'">'+time+'</div>'
      +'</div>';
  }
  return '<div class="esp-msg-card'+(tapAttr?' clickable':'')+'"'+tapAttr+' style="align-self:'+(isMe?'flex-end':'flex-start')+'">'
    +'<div style="font-size:10px;font-weight:700;color:var(--or);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">'+icon+' '+lbl+'</div>'
    +'<div style="font-size:15px;font-weight:700;color:var(--ink);line-height:1.3">'+esc(d.title||'')+'</div>'
    +(tapAttr?'<div style="font-size:12px;color:var(--or);font-weight:600;margin-top:8px">Voir dans l\'espace →</div>':'')
    +'<div style="font-size:10px;color:var(--lite);margin-top:6px;text-align:'+(isMe?'right':'left')+'">'+time+'</div>'
    +'</div>';
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
    title.textContent = t('lbl_statut_pro');
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
  var _cniT=g('cniStep3Title'),sub=g('cniStep3Sub');
  if(isReturn){
    if(_cniT)_cniT.textContent=window.t('txt_verif_prog');
    if(sub)sub.innerHTML=t('doc_cni_recu');
  } else {
    if(_cniT)_cniT.textContent=window.t('txt_doc_sent');
    if(sub)sub.innerHTML=t('doc_cni_verif');
    haptic(20);
  }
}

function cniLater(){
  var bd=g('bdCni');if(bd)bd.style.display='none';
  document.body.style.overflow='';
  updateVerifBand();
  setTimeout(function(){if(typeof tutoStart==='function')tutoStart();},600);
}

function cniDone(){
  var bd=g('bdCni');if(bd)bd.style.display='none';
  document.body.style.overflow='';
  updateVerifStatusBlock();
  updateVerifBand();
  // Marquer pour le nudge badges (affiché 30s après, 1 seule fois)
  try{if(!localStorage.getItem('cp_badge_nudge_done_'+(user&&user.id||'')))localStorage.setItem('cp_badge_nudge_pending_'+(user&&user.id||''),'1');}catch(e){}
  setTimeout(function(){if(typeof tutoStart==='function')tutoStart();},400);
  _scheduleBadgeNudge();
}

function _scheduleBadgeNudge(){
  if(!user||user.role!=='professeur')return;
  try{
    var uid=user.id||'';
    if(localStorage.getItem('cp_badge_nudge_done_'+uid))return; // déjà affiché
    if(!localStorage.getItem('cp_badge_nudge_pending_'+uid))return;
  }catch(e){return;}
  setTimeout(function(){
    // Ne montrer que si l'utilisateur n'a pas encore tous les badges
    if(!user)return;
    if(user.diplome_verifie&&user.casier_verifie)return; // tous badges déjà OK
    var bd=g('bdBadgeNudge');if(!bd)return;
    // Sous-titre adapté au statut réel — ne jamais dire "vérifiée" si pas encore validé
    var nudgeSub=g('nudgeSubText');
    if(nudgeSub){
      nudgeSub.textContent=user.verified
        ?'Votre identité est vérifiée \u2713 \u2014 complétez votre profil pour inspirer encore plus confiance aux élèves.'
        :'Complétez votre profil pour inspirer confiance aux élèves et vous démarquer.';
    }
    // Masquer le bouton diplôme si déjà uploadé/vérifié
    var nbtn=g('nudgeDiplomeBtn');
    if(nbtn&&(user.diplome_uploaded||user.diplome_verifie))nbtn.style.display='none';
    bd.style.display='flex';
    try{localStorage.setItem('cp_badge_nudge_done_'+(user.id||''),'1');localStorage.removeItem('cp_badge_nudge_pending_'+(user.id||''));}catch(e){}
  },30000);
}

function closeBadgeNudge(){
  var bd=g('bdBadgeNudge');
  if(bd){bd.style.opacity='0';bd.style.transition='opacity .22s';setTimeout(function(){bd.style.display='none';bd.style.opacity='';bd.style.transition='';},230);}
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
    toast(t('t_doc_req'),t('t_doc_cni'));return;
  }
  if(file.size>5*1024*1024){toast(t('t_file_heavy'),t('t_file_heavy_msg'));return;}
  var btn=g('cniSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent=t('txt_sending');}
  try{
    var reader=new FileReader();
    reader.onload=async function(e){
      try{await fetch(API+'/upload/cni',{method:'POST',headers:apiH(),body:JSON.stringify({base64:e.target.result,userId:user.id,filename:file.name})});}catch(err){}
      user.cni_uploaded=true;
      cniGoStep3();
      if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
    };
    reader.readAsDataURL(file);
  }catch(e){
    toast(t('t_error'),t('t_file_fail'));
    if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
  }
}

async function checkFirstProfLogin(){
  if(!user||user.role!=='professeur')return;
  var status=getCniStatus();
  if(status!=='none'){_scheduleBadgeNudge();return;}
  try{
    var r=await fetch(API+'/profiles/'+user.id,{headers:apiH()});
    var p=await r.json();
    if(p&&p.verified){user.verified=true;_scheduleBadgeNudge();return;}
    if(p&&p.cni_uploaded){user.cni_uploaded=true;_scheduleBadgeNudge();return;}
  }catch(e){}
  // N'ouvrir la sheet CNI que si le tutoriel est déjà terminé
  var _tutoDoneKey=user&&user.id?'cp_tuto_done_'+user.id:'cp_tuto_done_guest';
  try{if(!localStorage.getItem(_tutoDoneKey))return;}catch(e){}
  // N'ouvrir qu'une seule fois (1ère connexion) — ensuite le verifBand prend le relais
  var _cniPopupKey=user&&user.id?'cp_cni_popup_shown_'+user.id:'';
  try{if(_cniPopupKey&&localStorage.getItem(_cniPopupKey))return;}catch(e){}
  try{if(_cniPopupKey)localStorage.setItem(_cniPopupKey,'1');}catch(e){}
  setTimeout(openCniSheet, 600);
}

function updateVerifStatusBlock(){
  var block=g('verifStatusBlock');
  if(!block)return;
  var secLbl=g('verifSectionLabel');
  if(!user||user.role!=='professeur'){block.style.display='none';if(secLbl)secLbl.style.display='none';return;}
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
    block.style.display='block';block.innerHTML=html;
    if(secLbl)secLbl.style.display='block';
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
    var raison=esc(user.rejection_reason||'');
    html='<div style="background:#FEF2F2;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+(raison?'10':'0')+'px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#991B1B">Vérification refusée — Vous pouvez renvoyer votre document</span>'
      +'</div>'
      +(raison?'<div style="font-size:12px;color:#B91C1C;background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.5">'+raison+'</div>':'')
      +'<button onclick="openCniSheet()" style="width:100%;background:#EF4444;color:#fff;border:none;border-radius:10px;padding:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer">Renvoyer ma pièce d\'identité</button>'
      +'</div>';
    // Réinitialiser le statut local pour permettre le renvoi
    if(user)user.cni_uploaded=false;
  } else if(status==='rejected_final'){
    var raison=esc(user.rejection_reason||'');
    html='<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+(raison?'10':'0')+'px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#374151">Compte non éligible</span>'
      +'</div>'
      +(raison?'<div style="font-size:12px;color:#6B7280;line-height:1.5">'+raison+'</div>':'')
      +'</div>';
  }
  block.style.display='block';block.innerHTML=html;
  if(secLbl)secLbl.style.display='block';
}


// ============================================================
// DIPLÔME — upload et vérification
// ============================================================
function getDiplomeStatus(){
  if(!user)return'none';
  if(user.diplome_verifie===true||user.diplome_verifie==='true')return'verified';
  if(user.diplome_uploaded===true||user.diplome_uploaded==='true')return'pending';
  return'none';
}

function openDiplomeSheet(){
  var bd=g('bdDiplome');if(!bd)return;
  var status=getDiplomeStatus();
  if(status==='pending'){
    diplomeGoStep3(true);
  } else if(status==='verified'){
    bd.style.display='none';return;
  } else {
    diplomeGoStep1();
  }
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}

function diplomeGoStep1(){
  var s1=g('diplomeStep1'),s2=g('diplomeStep2'),s3=g('diplomeStep3');
  if(s1)s1.style.display='block';
  if(s2)s2.style.display='none';
  if(s3)s3.style.display='none';
}
function diplomeGoStep2(){
  var s1=g('diplomeStep1'),s2=g('diplomeStep2'),s3=g('diplomeStep3');
  if(s1)s1.style.display='none';
  if(s2)s2.style.display='block';
  if(s3)s3.style.display='none';
}
function diplomeGoStep3(isReturn){
  var s1=g('diplomeStep1'),s2=g('diplomeStep2'),s3=g('diplomeStep3');
  if(s1)s1.style.display='none';
  if(s2)s2.style.display='none';
  if(s3)s3.style.display='block';
  var _dipT=g('diplomeStep3Title'),sub=g('diplomeStep3Sub');
  if(isReturn){
    if(_dipT)_dipT.textContent=window.t('txt_verif_prog');
    if(sub)sub.innerHTML=t('doc_dip_recu');
  } else {
    if(_dipT)_dipT.textContent=window.t('txt_diploma_sent');
    if(sub)sub.innerHTML=t('doc_dip_verif');
    haptic(20);
  }
}

function diplomeLater(){
  var bd=g('bdDiplome');if(bd)bd.style.display='none';
  document.body.style.overflow='';
}

function diplomeDone(){
  var bd=g('bdDiplome');if(bd)bd.style.display='none';
  document.body.style.overflow='';
  updateDiplomeStatusBlock();
  updateCasierStatusBlock();
}

function diplomePreview(input){
  if(!input.files||!input.files[0])return;
  var zone=g('diplomeDropZone'),lbl=g('diplomeUploadLabel'),icon=g('diplomeUploadIcon');
  if(zone){zone.style.borderColor='#3B82F6';zone.style.background='#EFF6FF';}
  if(lbl)lbl.textContent=input.files[0].name;
  if(icon)icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" width="48" height="48" style="margin:0 auto;display:block"><polyline points="20 6 9 17 4 12"/></svg>';
}

async function submitDiplome(){
  var finput=g('diplomeFileInput');
  var file=finput&&finput.files&&finput.files[0];
  if(!file){
    var zone=g('diplomeDropZone');
    if(zone){zone.style.borderColor='#EF4444';setTimeout(function(){zone.style.borderColor='var(--bdr)';},600);}
    toast(t('t_doc_req'),t('t_doc_diplome'));return;
  }
  if(file.size>5*1024*1024){toast(t('t_file_heavy'),t('t_file_heavy_msg'));return;}
  var btn=g('diplomeSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent=t('txt_sending');}
  try{
    var reader=new FileReader();
    reader.onload=async function(e){
      try{await fetch(API+'/upload/diplome',{method:'POST',headers:apiH(),body:JSON.stringify({base64:e.target.result,userId:user.id,filename:file.name})});}catch(err){}
      user.diplome_uploaded=true;
      try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(ex){}
      diplomeGoStep3();
      if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
    };
    reader.readAsDataURL(file);
  }catch(e){
    toast(t('t_error'),t('t_file_fail'));
    if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
  }
}

function updateDiplomeStatusBlock(){
  var block=g('diplomeStatusBlock');
  if(!block)return;
  if(!user||user.role!=='professeur'){block.style.display='none';return;}
  var status=getDiplomeStatus();
  var html='';
  if(status==='none'){
    html='<div style="background:#EFF6FF;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#1D4ED8">Badge Diplôme vérifié disponible</span>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--lite);line-height:1.5;margin-bottom:12px">Envoyez une photo de votre diplôme pour obtenir le badge et rassurer les parents.</div>'
      +'<button onclick="openDiplomeSheet()" style="width:100%;background:#3B82F6;color:#fff;border:none;border-radius:10px;padding:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer">Envoyer mon diplôme</button>'
      +'</div>';
    block.style.display='block';
  } else if(status==='verified'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#EFF6FF;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#1D4ED8">Diplôme vérifié — Badge affiché sur votre profil</span>'
      +'</div>';
    block.style.display='block';
  } else if(status==='pending'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#FFFBEB;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#92400E">Diplôme en cours de vérification — Réponse sous 24h</span>'
      +'</div>';
    block.style.display='block';
  } else {
    block.style.display='none';
  }
  if(html)block.innerHTML=html;
}

// ============================================================
// PROFIL DE CONFIANCE — upload et vérification
// ============================================================
function getCasierStatus(){
  if(!user)return 'none';
  if(user.casier_verifie===true||user.casier_verifie==='true')return 'verified';
  if(user.casier_uploaded===true||user.casier_uploaded==='true')return 'pending';
  return 'none';
}

function updateCasierStatusBlock(){
  var block=g('casierStatusBlock');
  if(!block)return;
  if(!user||user.role!=='professeur'){block.style.display='none';return;}
  var status=getCasierStatus();
  var html='';
  if(status==='none'){
    html='<div style="background:#ECFDF5;border-radius:12px;padding:14px 16px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#059669">Badge Profil de confiance disponible</span>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--lite);line-height:1.5;margin-bottom:12px">Envoyez une attestation pour rassurer les familles et vous démarquer.</div>'
      +'<button onclick="openCasierSheet()" style="width:100%;background:#10B981;color:#fff;border:none;border-radius:10px;padding:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer">Envoyer mon attestation</button>'
      +'</div>';
    block.style.display='block';
  } else if(status==='verified'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#ECFDF5;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#059669">Profil de confiance vérifié — Badge affiché sur votre profil</span>'
      +'</div>';
    block.style.display='block';
  } else if(status==='pending'){
    html='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#FFFBEB;border-radius:12px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" width="18" height="18" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'<span style="font-size:13px;font-weight:700;color:#92400E">Attestation en cours de vérification — Réponse sous 24h</span>'
      +'</div>';
    block.style.display='block';
  } else {
    block.style.display='none';
  }
  if(html)block.innerHTML=html;
}

function openCasierSheet(){
  var bd=g('bdCasier');if(!bd)return;
  if(bd.parentNode!==document.body)document.body.appendChild(bd);
  casierGoStep1();
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}
function casierLater(){var bd=g('bdCasier');if(bd){bd.style.display='none';document.body.style.overflow='';}}
function casierGoStep1(){var s1=g('casierStep1'),s2=g('casierStep2');if(s1)s1.style.display='block';if(s2)s2.style.display='none';}
function casierGoStep2(){var s1=g('casierStep1'),s2=g('casierStep2');if(s1)s1.style.display='none';if(s2)s2.style.display='block';}
function casierPreview(input){
  var file=input.files[0];if(!file)return;
  var lbl=g('casierUploadLabel');
  if(lbl)lbl.textContent=file.name;
  var zone=g('casierDropZone');if(zone){zone.style.borderColor='#10B981';zone.style.background='rgba(16,185,129,.05)';}
}
async function submitCasier(){
  var finput=g('casierFileInput');
  var file=finput&&finput.files&&finput.files[0];
  if(!file){
    var zone=g('casierDropZone');
    if(zone){zone.style.borderColor='#EF4444';setTimeout(function(){zone.style.borderColor='var(--bdr)';},600);}
    toast(t('t_doc_req'),t('t_doc_attest'));return;
  }
  if(file.size>5*1024*1024){toast(t('t_file_heavy'),t('t_file_heavy_msg'));return;}
  var btn=g('casierSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent=t('txt_sending');}
  try{
    var reader=new FileReader();
    reader.onload=async function(e){
      try{await fetch(API+'/upload/casier',{method:'POST',headers:apiH(),body:JSON.stringify({base64:e.target.result,userId:user.id,filename:file.name})});}catch(err){}
      user.casier_uploaded=true;
      try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(ex){}
      casierLater();
      toast(t('t_sent'),t('t_attest_verif'));
      updateCasierStatusBlock();
      if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
    };
    reader.readAsDataURL(file);
  }catch(e){
    toast(t('t_error'),t('t_file_fail'));
    if(btn){btn.disabled=false;btn.textContent=t('txt_send_verif');}
  }
}

// ============================================================
// BADGE INFO — bottom sheet explication
// ============================================================
function showBadgeInfo(type){
  haptic(4);
  var bd=g('bdBadgeInfo');if(!bd)return;
  if(bd.parentNode!==document.body)document.body.appendChild(bd);
  var content=g('bdBadgeInfoContent');if(!content)return;
  var info={
    identite:{
      grad:'linear-gradient(135deg,#00C853,#009640)',
      glow:'rgba(0,180,80,.32)',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" width="44" height="44"><polyline points="20 6 9 17 4 12"/></svg>',
      name:'Identité vérifiée',
      badge:'Rare · ~14% des profs',
      desc:'Ce professeur a fourni une pièce d\'identité officielle contrôlée par l\'équipe CoursPool. Vous interagissez avec une vraie personne.',
      how:'Soumettez votre pièce d\'identité en cours de vérification dans Paramètres → Vérification.'
    },
    diplome:{
      grad:'linear-gradient(135deg,#818CF8,#4338CA)',
      glow:'rgba(99,102,241,.32)',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" width="44" height="44"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
      name:'Diplôme vérifié',
      badge:'Prestige · ~8% des profs',
      desc:'Ce professeur a soumis un diplôme officiel (Licence, Master, CAPES, agrégation…) validé par notre équipe. Expertise confirmée.',
      how:'Téléchargez votre diplôme dans Paramètres → Vérification pour obtenir ce badge.'
    },
    confiance:{
      grad:'linear-gradient(135deg,#34D399,#059669)',
      glow:'rgba(16,185,129,.28)',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" width="44" height="44"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      name:'Profil de confiance',
      badge:'Exclusif · ~5% des profs',
      desc:'Ce professeur a fourni une attestation officielle d\'absence d\'antécédents judiciaires, vérifiée par l\'équipe CoursPool.',
      how:'Soumettez votre attestation officielle dans Paramètres → Vérification.'
    }
  };
  var d=info[type];if(!d)return;
  var isProf=user&&user.role==='professeur';
  content.innerHTML=
    // Hero gradient card — no deco circles
    '<div style="background:'+d.grad+';border-radius:24px;padding:32px 20px 26px;text-align:center;margin-bottom:16px;box-shadow:0 10px 40px '+d.glow+'">'
    +'<div style="font-size:10px;font-weight:800;letter-spacing:.14em;color:rgba(255,255,255,.7);text-transform:uppercase;margin-bottom:16px">✦ CoursPool Certifié ✦</div>'
    +'<div style="display:inline-flex;margin-bottom:16px">'
    +'<div style="width:88px;height:88px;background:rgba(255,255,255,.18);border-radius:28px;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.35);box-shadow:0 0 0 8px rgba(255,255,255,.08)">'+d.icon+'</div>'
    +'</div>'
    +'<div style="font-size:21px;font-weight:800;color:#fff;letter-spacing:-.03em;text-shadow:0 1px 8px rgba(0,0,0,.15)">'+d.name+'</div>'
    +'</div>'
    // Description
    +'<div style="background:var(--bg);border-radius:16px;padding:14px 16px;margin-bottom:8px">'
    +'<div style="font-size:11px;font-weight:800;color:var(--lite);text-transform:uppercase;letter-spacing:.09em;margin-bottom:8px">Ce que ça garantit</div>'
    +'<div style="font-size:14px;color:var(--ink);line-height:1.65">'+d.desc+'</div>'
    +'</div>'
    // How to get it — prof only
    +(isProf?'<div style="background:var(--bg);border-radius:16px;padding:14px 16px;margin-bottom:8px">'
    +'<div style="font-size:11px;font-weight:800;color:var(--lite);text-transform:uppercase;letter-spacing:.09em;margin-bottom:8px">Comment l\'obtenir</div>'
    +'<div style="font-size:13.5px;color:var(--mid);line-height:1.65">'+d.how+'</div>'
    +'</div>':'')
    +'<button onclick="closeBadgeInfo()" style="width:100%;background:var(--bg);color:var(--ink);border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;margin-top:10px">Fermer</button>';
  bd.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeBadgeInfo(){var bd=g('bdBadgeInfo');if(bd){bd.style.display='none';document.body.style.overflow='';}}

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
          prof_nm:data.prof_nom||t('reg_prof'),prof_photo:data.prof_photo||null,
          description:data.description||'',code:data.code_acces||''
        };
        C.unshift(nc);
        openR(nc.id);
        toast(t('exp_private'),nc.title);
      } else {
        toast(t('t_code_invalid'),t('t_no_course_code'));
      }
    }).catch(function(){toast(t('t_code_invalid'),t('t_no_course_code'));});
  }
}

// Taper un code dans la recherche
var _pendingCode=null;
function checkCodeInSearch(val){
  // Charset réel des codes (I, O, 0, 1 exclus pour éviter les confusions visuelles)
  var clean=val.trim().toUpperCase();
  var isCode=/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(clean);
  var box=g('searchCodeSuggestion');
  if(isCode){
    _pendingCode=clean;
    if(box){var lbl=box.querySelector('.code-label');if(lbl)lbl.textContent=t('search_code_join').replace('{code}',clean);box.style.display='flex';}
  } else {
    _pendingCode=null;
    if(box)box.style.display='none';
  }
  return false;
}
function acceptCodeSearch(){
  if(!_pendingCode)return;
  var code=_pendingCode;_pendingCode=null;
  var box=g('searchCodeSuggestion');if(box)box.style.display='none';
  openPrivateCours(code);
}
function denyCodeSearch(){
  _pendingCode=null;
  var box=g('searchCodeSuggestion');if(box)box.style.display='none';
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
  {bg:'linear-gradient(135deg,#FF8C55,#E04E10)',illu:'logo',title:t('tuto_e1_title'),desc:t('tuto_e1_desc')},
  {bg:'linear-gradient(135deg,#3B82F6,#1D4ED8)',illu:'locbar',title:t('tuto_e2_title'),desc:t('tuto_e2_desc')},
  {bg:'linear-gradient(135deg,#22C069,#16A34A)',illu:'card',title:t('tuto_e3_title'),desc:t('tuto_e3_desc')},
  {bg:'linear-gradient(135deg,#8B5CF6,#6D28D9)',illu:'msg',title:t('tuto_e4_title'),desc:t('tuto_e4_desc')},
  {bg:'linear-gradient(135deg,#F59E0B,#D97706)',illu:'profil',title:t('tuto_e5_title'),desc:t('tuto_e5_desc')}
]
var TUTO_PROF_STEPS=[
  {bg:'linear-gradient(135deg,#FF8C55,#E04E10)',illu:'logo',title:t('tuto_p1_title'),desc:t('tuto_p1_desc')},
  {bg:'linear-gradient(135deg,#22C069,#16A34A)',illu:'plus',title:t('tuto_p2_title'),desc:t('tuto_p2_desc')},
  {bg:'linear-gradient(135deg,#3B82F6,#1D4ED8)',illu:'card',title:t('tuto_p3_title'),desc:t('tuto_p3_desc')},
  {bg:'linear-gradient(135deg,#8B5CF6,#6D28D9)',illu:'msg',title:t('tuto_p4_title'),desc:t('tuto_p4_desc')},
  {bg:'linear-gradient(135deg,#F59E0B,#D97706)',illu:'revenus',title:t('tuto_p5_title'),desc:t('tuto_p5_desc')}
]

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
    btn.textContent=isLast?(isGuestLast?t('reg_title'):t('ob_cest_parti')):t('ob_continuer');
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
    localStorage.removeItem(stepKey);
  }catch(e){}
  var root=g('tutoRoot');
  if(root){
    root.style.opacity='0';root.style.transition='opacity .3s';
    setTimeout(function(){
      root.style.display='none';root.style.opacity='';root.style.transition='';
      // Tuto terminé → montrer CNI si nécessaire (profs seulement)
      if(user&&user.role==='professeur')checkFirstProfLogin();
    },300);
  }
}


// ============================================================
// REVENUS PROF — lié à Stripe via /stripe/payments
// ============================================================
var _revLoaded = false;

async function loadRemboursements(){
  var el=g('listRmb');
  if(!el||!user)return;
  el.innerHTML='<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px"><span class="cp-loader"></span> Chargement…</div>';

  // ── Mode professeur : remboursements émis aux élèves ────────────────────
  if(user.role==='professeur'){
    try{
      var r=await fetch(API+'/stripe/refunds/prof/'+user.id,{cache:'no-store',headers:apiH()});
      var data=await r.json();
      var refunds=Array.isArray(data)?data:[];
      if(!refunds.length){
        el.innerHTML='<div style="text-align:center;padding:40px 20px">'
          +'<div style="width:64px;height:64px;background:#FEF2F2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" width="28" height="28"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>'
          +'<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun remboursement</div>'
          +'<div style="font-size:13px;color:var(--lite);line-height:1.6">Les remboursements aux élèves<br>apparaîtront ici lors d\'annulations.</div>'
          +'</div>';
        return;
      }
      var html='<div style="background:var(--wh);border-radius:16px;overflow:hidden;border:1px solid var(--bdr)">';
      refunds.forEach(function(rb,i){
        var titre=esc(rb.cours_titre||'Cours CoursPool');
        var montant=rb.amount||0;
        var montantStr=montant?(montant%1===0?montant+'€':montant.toFixed(2)+'€'):'—';
        var dateStr=rb.created?new Date(rb.created).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'';
        var st=rb.status||'succeeded';
        var pill,pillBg,pillColor;
        if(st==='succeeded'){pill='Remboursé';pillBg='#DCFCE7';pillColor='#15803D';}
        else if(st==='pending'){pill='En cours';pillBg='#FEF3C7';pillColor='#92400E';}
        else{pill='Échoué';pillBg='#FEE2E2';pillColor='#B91C1C';}
        var border=i<refunds.length-1?'border-bottom:1px solid var(--bdr)':'';
        html+='<div style="padding:14px 16px;'+border+';display:flex;align-items:center;gap:12px">'
          +'<div style="width:40px;height:40px;background:#FEF2F2;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="18" height="18"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg></div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+titre+'</div>'
          +(dateStr?'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+dateStr+'</div>':'')
          +'</div>'
          +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">'
          +'<div style="font-size:14px;font-weight:800;color:#EF4444">-'+montantStr+'</div>'
          +'<span style="background:'+pillBg+';color:'+pillColor+';border-radius:50px;padding:3px 9px;font-size:11px;font-weight:700">'+pill+'</span>'
          +'</div></div>';
      });
      html+='</div>';
      html+='<div style="padding:14px 4px;font-size:12px;color:var(--lite);line-height:1.6;text-align:center">Remboursements traités par Stripe · délai 5-10 jours ouvrés</div>';
      el.innerHTML=html;
    }catch(e){
      el.innerHTML='<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px">'+t('err_refunds')+'</div>';
    }
    return;
  }

  // ── Mode élève : remboursements reçus ───────────────────────────────────
  try{
    var r=await fetch(API+'/reservations/'+user.id,{cache:'no-store',headers:apiH()});
    var data=await r.json();
    var refunds=Array.isArray(data)?data.filter(function(r){
      return r.status==='cancelled'||r.status==='refunded'||r.annule||r.cancelled;
    }):[];
    if(!refunds.length){
      el.innerHTML='<div style="text-align:center;padding:40px 20px">'
        +'<div style="width:64px;height:64px;background:#FEF2F2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" width="28" height="28"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="20 6 9 17 4 12"/></svg></div>'
        +'<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun remboursement</div>'
        +'<div style="font-size:13px;color:var(--lite);line-height:1.6">Si un cours est annulé par le professeur,<br>votre remboursement apparaît ici.</div>'
        +'</div>';
      return;
    }
    var html='<div style="background:var(--wh);border-radius:16px;overflow:hidden;border:1px solid var(--bdr)">';
    refunds.forEach(function(r,i){
      var cours=C.find(function(c){return c.id===r.cours_id;});
      var titre=cours?esc(cours.title||cours.subj||'Cours'):(r.cours_titre?esc(r.cours_titre):'Cours annulé');
      var montant=r.montant||r.amount||0;
      var montantStr=montant?montant+'€':'—';
      var dateStr=r.created_at?new Date(r.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'';
      var st=r.status||'';
      var pill,pillBg,pillColor;
      if(st==='refunded'||r.rembourse){
        pill=t('t_refreshed'); pillBg='#DCFCE7'; pillColor='#15803D';
      } else if(st==='cancelled'||r.annule||r.cancelled){
        pill=t('exp_verif'); pillBg='#FEF3C7'; pillColor='#92400E';
      } else {
        pill=t('t_cancelled'); pillBg='#FEE2E2'; pillColor='#B91C1C';
      }
      var border=i<refunds.length-1?'border-bottom:1px solid var(--bdr)':'';
      html+='<div style="padding:14px 16px;'+border+';display:flex;align-items:center;gap:12px">'
        +'<div style="width:40px;height:40px;background:#FEF2F2;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+titre+'</div>'
        +(dateStr?'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+dateStr+'</div>':'')
        +'</div>'
        +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">'
        +'<div style="font-size:14px;font-weight:800;color:var(--ink)">'+montantStr+'</div>'
        +'<span style="background:'+pillBg+';color:'+pillColor+';border-radius:50px;padding:3px 9px;font-size:11px;font-weight:700">'+pill+'</span>'
        +'</div>'
        +'</div>';
    });
    html+='</div>';
    html+='<div style="padding:14px 4px;font-size:12px;color:var(--lite);line-height:1.6;text-align:center">Les remboursements sont traités par Stripe sous 5 à 10 jours ouvrés.</div>';
    el.innerHTML=html;
  }catch(e){
    el.innerHTML='<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px">'+t('err_refunds')+'</div>';
  }
}

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
      list.innerHTML = '<div style="text-align:center;padding:40px 20px"><div style="width:52px;height:52px;background:var(--orp);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="26" height="26"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Aucun paiement</div><div style="font-size:13px;color:var(--lite);line-height:1.6">Vos revenus apparaîtront ici<br>dès qu\'un élève réserve un cours.</div></div>';
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
        var statusLabel=p.status==='succeeded'||p.status==='paid'?t('paiement_paye'):t('paiement_attente');
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
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--lite);font-size:13px">'+t('err_revenues')+'<br><a onclick="loadRevenues()" style="color:var(--or);cursor:pointer">'+t('txt_retry')+'</a></div>';
  }
}





// ============================================================
// PAIEMENTS PROF — IBAN via Stripe.js (tokenisation côté client)
// Le prof reste sur CoursPool, l'IBAN ne passe jamais par notre serveur
// ============================================================

var _stripeInstance = null;
var _ibanElement = null;
var STRIPE_PK = 'pk_live_51TB9Am3FNybFliKQGUpI1uSMheaSyFV0TwgRoAfmgRJtLtxAujacxrLJqM5zaOdLa0EuZNLJe7HOXKSZWmwZHyR500YZcvAF6h';

// ============================================================
// PAYMENT ELEMENT — paiement natif in-app (sans redirect)
// ============================================================
var _payElements=null,_payCoursId=null,_payPourAmi=false;

async function openPaymentSheet(id,pourAmi){
  _payCoursId=id;_payPourAmi=!!pourAmi;
  var c=C.find(function(x){return x.id==id;});
  if(!c)return;
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  var sheet=g('bdPayment');if(!sheet)return;
  var btn=g('payBtn'),btnTxt=g('payBtnTxt'),loader=g('payLoader');
  // Reset UI
  if(btn){btn.disabled=true;btn.style.opacity='.7';}
  if(btnTxt)btnTxt.textContent=t('txt_loading');
  if(loader)loader.style.display='none';
  g('payCoursTitle').textContent=c.title;
  g('payAmount').textContent=pp+'€';
  g('stripe-payment-element').innerHTML='<div style="text-align:center;padding:28px;color:var(--lite);font-size:13px">Chargement du formulaire…</div>';
  sheet.style.display='flex';
  document.body.style.overflow='hidden';
  try{
    var r=await fetch(API+'/stripe/payment-intent',{method:'POST',headers:apiH(),body:JSON.stringify({cours_id:id,user_id:user.id,pour_ami:pourAmi})});
    var data=await r.json();
    if(data.error){toast(t('t_error'),data.error,true);closePaymentSheet();return;}
    if(data.already_reserved){toast(t('t_already_res'),t('t_already_res_s'));closePaymentSheet();return;}
    if(!_stripeInstance){if(!window.Stripe){toast(t('t_error'),t('t_payment_svc'),true);closePaymentSheet();return;}_stripeInstance=Stripe(STRIPE_PK);}
    var dk=document.documentElement.classList.contains('dk');
    var appearance={
      theme:dk?'night':'stripe',
      variables:{colorPrimary:'#FF6B2B',borderRadius:'10px',fontFamily:'Plus Jakarta Sans, system-ui, sans-serif',fontSizeBase:'15px',spacingUnit:'4px'}
    };
    _payElements=_stripeInstance.elements({clientSecret:data.client_secret,appearance:appearance});
    var pe=_payElements.create('payment',{layout:'tabs',fields:{billingDetails:{email:'never'}}});
    g('stripe-payment-element').innerHTML='';
    pe.mount('#stripe-payment-element');
    pe.on('ready',function(){
      if(btn){btn.disabled=false;btn.style.opacity='1';}
      if(btnTxt)btnTxt.textContent=t('nc_prix')+' '+pp+'€';
    });
  }catch(e){
    if(typeof sentryCaptureException==='function')sentryCaptureException(e,{action:'open_payment_sheet'});
    toast(t('t_net_error'),'',true);
    closePaymentSheet();
  }
}

async function submitPayment(){
  if(!_payElements||!_stripeInstance)return;
  var btn=g('payBtn'),btnTxt=g('payBtnTxt'),loader=g('payLoader');
  btn.disabled=true;
  if(loader)loader.style.display='inline-block';
  if(btnTxt)btnTxt.textContent=t('txt_processing');
  try{
    var result=await _stripeInstance.confirmPayment({
      elements:_payElements,
      redirect:'if_required',
      confirmParams:{payment_method_data:{billing_details:{email:user&&user.em?user.em:''}}}
    });
    if(result.error){
      toast(t('t_pay_declined'),result.error.message,true);
      btn.disabled=false;btn.style.opacity='1';
      if(loader)loader.style.display='none';
      if(btnTxt)btnTxt.textContent=t('txt_retry');
      return;
    }
    var pi=result.paymentIntent;
    if(pi&&pi.status==='succeeded'){
      if(btnTxt)btnTxt.textContent=t('txt_confirming');
      var r2=await fetch(API+'/stripe/confirm-payment',{method:'POST',headers:apiH(),body:JSON.stringify({payment_intent_id:pi.id})});
      var d2=await r2.json();
      if(d2.success||d2.already_existed){
        closePaymentSheet();
        localStorage.removeItem('cp_stripe_pending');
        if(!_payPourAmi)res[_payCoursId]=true;
        var c=C.find(function(x){return x.id==_payCoursId;});
        if(c){c.fl=(c.fl||0)+1;}
        haptic(6);
        toast(t('t_res_confirmed'),t('t_res_confirmed_msg'));
        setTimeout(function(){loadData(1).then(function(){buildCards();updateMesRes();});},800);
        // Proposer les notifications push après le premier paiement réussi
        try{
          if(!_payPourAmi&&typeof Notification!=='undefined'&&Notification.permission==='default'&&!_pushSubscription){
            setTimeout(function(){
              var bd=document.createElement('div');
              bd.id='pushNudge';
              bd.style.cssText='position:fixed;bottom:calc(env(safe-area-inset-bottom,0px)+90px);left:50%;transform:translateX(-50%);width:calc(100%-40px);max-width:380px;background:var(--wh);border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.16);padding:16px 18px;z-index:600;display:flex;align-items:center;gap:14px;animation:mi .3s cubic-bezier(.32,1,.6,1)';
              bd.innerHTML='<div style="width:44px;height:44px;background:rgba(255,107,43,.1);border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>'
                +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:2px">Rappels de cours</div><div style="font-size:12px;color:var(--lite)">Reçois une notification avant chaque cours</div></div>'
                +'<div style="display:flex;flex-direction:column;gap:6px"><button onclick="subscribePush();document.getElementById(\'pushNudge\').remove()" style="background:var(--or);color:#fff;border:none;border-radius:10px;padding:7px 12px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Activer</button><button onclick="document.getElementById(\'pushNudge\').remove()" style="background:none;border:none;font-size:11px;color:var(--lite);cursor:pointer;font-family:inherit;padding:0">Plus tard</button></div>';
              document.body.appendChild(bd);
              setTimeout(function(){var n=document.getElementById('pushNudge');if(n)n.remove();},10000);
            },2000);
          }
        }catch(_){}
      }else{
        toast(t('t_error'),d2.error||t('t_try_again'),true);
        btn.disabled=false;btn.style.opacity='1';
        if(loader)loader.style.display='none';
        if(btnTxt)btnTxt.textContent=t('txt_retry');
      }
    }
  }catch(e){
    if(typeof sentryCaptureException==='function')sentryCaptureException(e,{action:'submit_payment'});
    toast(t('t_net_error'),'',true);
    btn.disabled=false;btn.style.opacity='1';
    if(loader)loader.style.display='none';
    if(btnTxt)btnTxt.textContent=t('txt_retry');
  }
}

function closePaymentSheet(){
  var sheet=g('bdPayment');
  if(sheet)sheet.style.display='none';
  document.body.style.overflow='';
  _payElements=null;
  var el=g('stripe-payment-element');
  if(el)el.innerHTML='';
}

function initStripeIban() {
  if (!window.Stripe) return;
  if (!_stripeInstance) _stripeInstance = Stripe(STRIPE_PK);
  // Toujours (re)créer le champ IBAN — l'ancien peut être démonté si on revient sur la page
  if (_ibanElement) { try { _ibanElement.unmount(); } catch(e) {} _ibanElement = null; }
  var container = g('ibanElement');
  if (!container) return;
  container.innerHTML = '';
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
  _ibanElement.mount('#ibanElement');
  _ibanElement.on('focus', function() { container.style.borderColor = 'var(--or)'; });
  _ibanElement.on('blur', function() { container.style.borderColor = 'var(--bdr)'; });
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

  if (!name) { toast(t('t_fields_miss'),t('t_iban_holder_req')); return; }
  if (!_ibanElement) { toast(t('t_error'),t('t_try_again')); return; }
  if (!_stripeInstance) { toast(t('t_error'),t('t_payment_svc')); return; }

  btn.disabled = true; btn.textContent = t('txt_saving');

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
      if (d1.error) { toast(t('t_error'), d1.error); return; }
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
    if (d2.error) { toast(t('t_error'), d2.error); return; }

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

    toast('IBAN enregistré !', 'Vérification en cours — vous serez notifié par email ✓');

    // Mettre à jour l'UI — passer en état "en attente de validation Stripe"
    var notConn = g('stripeNotConnected');
    var pending = g('stripePending');
    var connected = g('stripeConnected');
    if (notConn) notConn.style.display = 'none';
    if (connected) connected.style.display = 'none';
    if (pending) pending.style.display = 'block';

  } catch(e) {
    toast('Erreur', 'Impossible d\'enregistrer l\'IBAN');
  } finally {
    btn.disabled = false; btn.textContent = t('txt_save_iban');
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
  var isPastNow=false;try{var _diffNow=Date.now()-new Date(cours.dt_iso||0);isPastNow=!isNaN(_diffNow)&&_diffNow>3600000;}catch(e){}
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
  var stars=g('noteStars').querySelectorAll('svg');
  stars.forEach(function(s,i){
    var on=i<n;
    s.style.fill=on?'#F59E0B':'none';
    s.style.stroke=on?'#F59E0B':'var(--bdr)';
    s.style.transform=on?'scale(1.18)':'scale(1)';
  });
}

async function submitNote(){
  if(!noteVal){toast('Note manquante','Choisissez une note entre 1 et 5',true);return;}
  if(!noteCours||!user){return;}
  var comment=g('noteComment').value.trim();
  try{
    var r=await fetch(API+'/notations',{method:'POST',headers:apiH(),body:JSON.stringify({
      eleve_id:user.id,professeur_id:noteCours.pr,cours_id:noteCours.id,note:noteVal,commentaire:comment,
      is_tuteur:!!(user.is_tuteur),prenom:user.pr||null
    })});
    var data=await r.json();
    if(data.error){toast('Erreur','Impossible d\'envoyer la note');return;}
    closeM('bdNote');
    try{if(noteCours)localStorage.setItem('cp_noted_'+noteCours.id,'1');}catch(e){}
    toast('Merci pour votre avis !','Votre note a été enregistrée ⭐');
    noteCours=null;noteVal=0;
  }catch(e){toast(t('t_net_error'),'');}
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
  if(valLbl)valLbl.textContent=t('txt_choose')+'…';
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
var NIV_GROUPES={
  'Primaire':['Maternelle','PS','MS','GS','CP','CE1','CE2','CM1','CM2','Primaire'],
  'Collège':['6ème','5ème','4ème','3ème','Collège'],
  'Lycée':['Seconde','Première','Terminale','Lycée'],
  'Bac+1/2':['Bac+1/2','BTS / Prépa','BUT','Licence 1','Licence 2'],
  'Bac+3/4':['Bac+3/4','Licence 3','Bachelor','Master 1'],
  'Bac+5':['Bac+5','Bac+5 et +','Master 2','Doctorat','Grandes écoles'],
};
var actNiv = '';
var actMode = '';
var actDate = '';

function updateResetBtn(){
  var btn=g('pillReset');if(!btn)return;
  var active=actF!=='tous'||!!actNiv||!!actMode||!!actLoc||geoMode||!!actDate;
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
  if(typeof _updateFiltersBadge==='function')_updateFiltersBadge();
}
function setNivFilter(niv, el){
  actNiv=niv;try{sessionStorage.setItem('cp_niv',niv);}catch(e){}
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var lbl=g('pillNivLabel');
  var pill=g('pillNiv');
  if(lbl){lbl.textContent=niv||t('filter_niveau');}
  if(pill){pill.classList.toggle('on',!!niv);}
  closeNivFilter();
  applyFilter();
}

var _locKbShowFn=null,_locKbHideFn=null;
function openVilleFilter(){
  var bar=document.querySelector('.locbar');
  if(!bar)return;
  var isOpen=bar.classList.contains('open');
  if(isOpen){
    if(!actLoc){closeVilleFilter();}
    else{var inp=g('locInput');if(inp)inp.focus();}
    return;
  }
  bar.classList.add('open');
  var pill=g('pillVille');if(pill)pill.classList.add('on');
  setTimeout(function(){var inp=g('locInput');if(inp)inp.focus();},80);
  // Keyboard avoidance
  _locKbShowFn=function(e){
    var kbH=(e&&e.keyboardHeight)||0;if(kbH<=0)return;
    var b=document.querySelector('.locbar');var app=g('app');if(!b||!app)return;
    var bRect=b.getBoundingClientRect();
    var visBot=window.innerHeight-kbH-16;
    if(bRect.bottom>visBot)app.scrollTop+=bRect.bottom-visBot;
  };
  _locKbHideFn=function(){};
  window.addEventListener('keyboardWillShow',_locKbShowFn);
  window.addEventListener('keyboardWillHide',_locKbHideFn);
}
function closeVilleFilter(){
  var bar=document.querySelector('.locbar');
  if(bar)bar.classList.remove('open');
  if(_locKbShowFn){window.removeEventListener('keyboardWillShow',_locKbShowFn);_locKbShowFn=null;}
  if(_locKbHideFn){window.removeEventListener('keyboardWillHide',_locKbHideFn);_locKbHideFn=null;}
}
function applyVilleFilter(){}
function clearVilleFilter(){
  locInputClear();
  closeVilleFilter();
  var pill=g('pillVille');if(pill)pill.classList.remove('on');
  var lbl=g('pillVilleLabel');if(lbl)lbl.textContent=t('filter_ville');
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
  if(typeof _updateFiltersBadge==='function')_updateFiltersBadge();
}
function setModeFilter(mode, el){
  actMode=mode;
  document.querySelectorAll('#modeFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var labels={'':t('filter_mode'),'presentiel':t('filter_mode_pres'),'visio':t('filter_mode_vis')};
  var lbl=g('pillModeLabel');if(lbl)lbl.textContent=labels[mode]||t('filter_mode');
  var pill=g('pillMode');if(pill)pill.classList.toggle('on',!!mode);
  closeModeFilter();
  applyFilter();
}

function openDateFilter(){
  var el=g('bdDateFilter');if(!el)return;
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.style.display='flex';document.body.style.overflow='hidden';
}
function closeDateFilter(){
  var el=g('bdDateFilter');if(el){el.style.display='none';document.body.style.overflow='';}
  if(typeof _updateFiltersBadge==='function')_updateFiltersBadge();
}
function setDateFilter(date,el){
  actDate=date;
  document.querySelectorAll('#dateFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  var labels={'':t('filter_periode'),'semaine':t('filter_this_week'),'mois':t('filter_this_month'),
    'lundi':t('filter_lun'),'mardi':t('filter_mar'),'mercredi':t('filter_mer'),'jeudi':t('filter_jeu'),
    'vendredi':t('filter_ven'),'samedi':t('filter_sam'),'dimanche':t('filter_dim')};
  var lbl=g('pillDateLabel');if(lbl)lbl.textContent=labels[date]||t('filter_periode');
  var pill=g('pillDate');if(pill)pill.classList.toggle('on',!!date);
  closeDateFilter();
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

function _syncStatusBar(){
  try{
    var SB=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.StatusBar;
    if(!SB)return;
    // overlaysWebView doit être appelé en JS pour ne pas nécessiter de rebuild Xcode
    if(typeof SB.setOverlaysWebView==='function')SB.setOverlaysWebView({overlay:true});
    SB.setStyle({style:document.documentElement.classList.contains('dk')?'LIGHT':'DARK'});
  }catch(e){}
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
  _syncStatusBar();
  updateDarkBtn();
  var spb=g('shareProfBtn');if(spb)spb.style.display=(user&&user.role==='professeur')?'block':'none';
}

function toggleDarkMode(){
  _darkMode=!_darkMode;
  document.documentElement.classList.toggle('dk',_darkMode);
  try{localStorage.setItem('cp_dark',_darkMode?'1':'0');}catch(e){}
  _syncStatusBar();
  updateDarkBtn();
  var tm=document.getElementById('themeColorMeta');
  if(tm)tm.content=_darkMode?'#111111':'#ffffff';
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
      text:t('t_share_profile_msg'),
      url:url
    }).catch(function(){});
  } else {
    try{navigator.clipboard.writeText(url);toast(t('t_link_copied'),t('t_share_profile_sub'));}
    catch(e){toast(url,t('t_copy_link'));}
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
  btn.disabled=true;btn.textContent=t('txt_envoi')+'…';
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
  actF='tous';actLoc='';actNiv='';actMode='';actDate='';
  var _dpill=g('pillDate'),_dlbl=g('pillDateLabel');
  if(_dpill)_dpill.classList.remove('on');
  if(_dlbl)_dlbl.textContent=t('filter_periode');
  document.querySelectorAll('#dateFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var _dFirst=document.querySelector('#dateFilterList .niv-fchip');if(_dFirst)_dFirst.classList.add('on');
  geoMode=false;_geoActive=false;_geoCoords=null;userCoords=null;_geoPermDenied=false;
  var _rlbl=g('geoBtnLabel'),_rdist=g('geoDistBtn');
  if(_rlbl){_rlbl.textContent=t('exp_around_me');_rlbl.style.display='';}
  if(_rdist)_rdist.style.display='none';
  var inp=g('locInput');if(inp)inp.value='';
  var cb=g('locClearBtn');if(cb)cb.style.display='none';
  var gb=g('locGeoBtn');if(gb){gb.style.background='';gb.style.color='';gb.style.padding='';}
  document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});
  var tous=g('pillTous');if(tous)tous.classList.add('on');
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var fn=document.querySelector('#nivFilterList .niv-fchip');if(fn)fn.classList.add('on');
  var lbl=g('pillNivLabel');if(lbl)lbl.textContent=t('filter_niveau');
  var pn=g('pillNiv');if(pn)pn.classList.remove('on');
  document.querySelectorAll('#modeFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var fm=document.querySelector('#modeFilterList .niv-fchip');if(fm)fm.classList.add('on');
  var lm=g('pillModeLabel');if(lm)lm.textContent=t('filter_mode');
  var pm=g('pillMode');if(pm)pm.classList.remove('on');
  var lv=g('pillVilleLabel');if(lv)lv.textContent=t('filter_ville');
  var pv=g('pillVille');if(pv)pv.classList.remove('on');
  var lb=document.querySelector('.locbar');if(lb)lb.classList.remove('open');
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
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px">'+t('err_courses')+'<br>'+t('err_check_conn')+'</div>'
    +'<button onclick="loadData(1).then(buildCards)" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3);margin-bottom:12px;display:block;width:100%;max-width:220px;margin:0 auto 12px">'+t('txt_retry')+'</button>'
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
  if(!('Notification' in window)){
    block.innerHTML='<div style="font-size:13px;color:var(--lite)">'+t('notif_not_supported')+'</div>';
    _renderNotifTypes();
    return;
  }
  var perm=Notification.permission;
  if(perm==='denied'){
    block.innerHTML='<div style="display:flex;align-items:center;gap:10px"><div><div style="font-size:14px;font-weight:600;color:var(--ink)">'+t('notif_blocked_title')+'</div><div style="font-size:12px;color:var(--lite);margin-top:1px">'+t('notif_blocked_sub')+'</div></div></div>';
    _renderNotifTypes();
    return;
  }
  if(perm==='granted'&&_pushSubscription){
    block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:10px"><div><div style="font-size:14px;font-weight:600;color:var(--ink)">'+t('notif_active_title')+'</div><div style="font-size:12px;color:var(--lite);margin-top:1px">'+t('notif_active_sub')+'</div></div></div><button onclick="unsubscribePush()" style="background:none;border:none;font-size:12px;color:var(--lite);cursor:pointer;font-family:inherit;padding:4px 8px">'+t('notif_deactivate_btn')+'</button></div>';
    _renderNotifTypes();
    return;
  }
  block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:10px"><div><div style="font-size:14px;font-weight:600;color:var(--ink)">'+t('notif_inactive_title')+'</div><div style="font-size:12px;color:var(--lite);margin-top:1px">'+t('notif_inactive_sub')+'</div></div></div><button onclick="subscribePush()" style="background:var(--or);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer">'+t('notif_activate_btn')+'</button></div>';
  _renderNotifTypes();
}

function _getNotifPrefs(){
  try{return JSON.parse(localStorage.getItem('cp_notif_types')||'{}');}catch(e){return{};}
}

function toggleNotifPref(type,el){
  var prefs=_getNotifPrefs();
  var cur=prefs[type]!==false; // défaut : activé
  prefs[type]=!cur;
  try{localStorage.setItem('cp_notif_types',JSON.stringify(prefs));}catch(e){}
  if(el)el.classList.toggle('on',!cur);
  haptic(6);
}

function _renderNotifTypes(){
  var types=g('notifTypes');
  if(!types)return;
  if(!_pushSubscription){types.style.display='none';return;}
  var isProf=user&&user.role==='professeur';
  var prefs=_getNotifPrefs();
  // SVG paths
  var BELL ='<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>';
  var MSG  ='<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>';
  var CHECK='<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
  var XCIRC='<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
  var STAR ='<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
  var CLOCK24='<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><text x="6" y="22" style="font-size:5px;font-weight:700;fill:currentColor;stroke:none">24h</text>';
  var CLOCK1 ='<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><text x="7.5" y="22" style="font-size:5px;font-weight:700;fill:currentColor;stroke:none">1h</text>';
  var EURO ='<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>';
  var USERS='<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>';
  var FULL ='<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>';

  // Groupes élève
  var eleveGroups=[
    {label:t('notif_grp_courses'),items:[
      {type:'cours_nouveau',   icon:BELL,  color:'#F97316',bg:'#FFF7ED',label:t('notif_new_course'),         sub:t('notif_new_course_sub')},
      {type:'cours_place',     icon:FULL,  color:'#8B5CF6',bg:'#F5F3FF',label:t('notif_place_available'),    sub:t('notif_place_available_sub')}
    ]},
    {label:t('notif_grp_reservations'),items:[
      {type:'resa_confirmee',  icon:CHECK, color:'#10B981',bg:'#ECFDF5',label:t('notif_resa_confirmed'),     sub:t('notif_resa_confirmed_sub')},
      {type:'resa_annulee',    icon:XCIRC,color:'#EF4444',bg:'#FEF2F2',label:t('notif_cours_annule'),       sub:t('notif_cours_annule_sub')}
    ]},
    {label:t('notif_grp_reminders'),items:[
      {type:'rappel_24h',      icon:CLOCK24,color:'#10B981',bg:'#ECFDF5',label:t('notif_rappel_24h'),       sub:t('notif_rappel_24h_e_sub')},
      {type:'rappel_1h',       icon:CLOCK1, color:'#10B981',bg:'#ECFDF5',label:t('notif_rappel_1h'),        sub:t('notif_rappel_1h_sub')}
    ]},
    {label:t('notif_grp_messages'),items:[
      {type:'messages',        icon:MSG,   color:'#3B82F6',bg:'#EFF6FF',label:t('notif_messages'),          sub:t('notif_messages_e_sub')}
    ]}
  ];

  // Groupes prof
  var profGroups=[
    {label:t('notif_grp_reservations'),items:[
      {type:'resa_nouvelle',   icon:USERS, color:'#F97316',bg:'#FFF7ED',label:t('notif_new_reservation'),   sub:t('notif_new_reservation_sub')},
      {type:'resa_annulee',    icon:XCIRC,color:'#EF4444',bg:'#FEF2F2',label:t('notif_annulation'),         sub:t('notif_annulation_sub')},
      {type:'cours_complet',   icon:FULL,  color:'#8B5CF6',bg:'#F5F3FF',label:t('notif_cours_complet'),     sub:t('notif_cours_complet_sub')},
      {type:'paiement',        icon:EURO,  color:'#10B981',bg:'#ECFDF5',label:t('notif_paiement'),          sub:t('notif_paiement_sub')}
    ]},
    {label:t('notif_grp_reminders'),items:[
      {type:'rappel_24h',      icon:CLOCK24,color:'#10B981',bg:'#ECFDF5',label:t('notif_rappel_24h'),       sub:t('notif_rappel_24h_p_sub')},
      {type:'rappel_1h',       icon:CLOCK1, color:'#10B981',bg:'#ECFDF5',label:t('notif_rappel_1h'),        sub:t('notif_rappel_1h_sub')}
    ]},
    {label:t('notif_grp_msg_avis'),items:[
      {type:'messages',        icon:MSG,   color:'#3B82F6',bg:'#EFF6FF',label:t('notif_messages'),          sub:t('notif_messages_p_sub')},
      {type:'avis',            icon:STAR,  color:'#F59E0B',bg:'#FFFBEB',label:t('notif_avis'),              sub:t('notif_avis_sub')}
    ]}
  ];

  var groups=isProf?profGroups:eleveGroups;
  var lbl='<div style="font-size:10.5px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;padding:14px 16px 6px">';
  var sep='<div style="height:1px;background:var(--bdr);margin:0 16px"></div>';
  var html='<div style="height:1px;background:var(--bdr);margin:0 16px"></div>';
  groups.forEach(function(grp,gi){
    if(gi>0)html+='<div style="height:8px"></div>';
    html+=lbl+grp.label+'</div>';
    grp.items.forEach(function(item,ii){
      var on=prefs[item.type]!==false;
      if(ii>0)html+=sep;
      html+='<div class="settings-row" style="padding:13px 16px">'
        +'<div style="flex:1">'
        +'<div class="settings-label">'+item.label+'</div>'
        +'<div class="settings-sub">'+item.sub+'</div>'
        +'</div>'
        +'<div class="ntog'+(on?' on':'')+'" onclick="toggleNotifPref(\''+item.type+'\',this)"></div>'
        +'</div>';
    });
  });
  types.innerHTML=html;
  types.style.display='block';
}

// ============================================================
// PUSH — subscribe / unsubscribe
// ============================================================
var VAPID_PUBLIC_KEY='BDyXpxjqx8h9llIzLNcaYdMpEX_jbkqEt4fjXOV_bSgENcpW7KaPFUHEjk0uXKT--ZajXK_zAJwgplwNz3j4jA8';
var _swReg=null,_pushSubscription=null;

async function subscribePush(){
  var btn=document.querySelector('#notifStatus button');
  if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    var perm=await Notification.requestPermission();
    if(perm!=='granted'){toast(t('notif_denied'),t('notif_enable_settings'));return;}
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
      toast(t('notif_enabled'),t('notif_will_receive'));
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
    toast(t('notif_enabled'),'');
  }catch(e){toast(t('t_error'),t('notif_err_enable'));}
}

async function unsubscribePush(){
  var btn=document.querySelector('#notifStatus button');
  if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    if(_pushSubscription){
      await _pushSubscription.unsubscribe();
      if(user)await fetch(API+'/push/subscribe',{method:'DELETE',headers:apiH(),body:JSON.stringify({user_id:user.id})});
      _pushSubscription=null;
    }
    renderNotifStatus();
    toast(t('notif_disabled'),'');
  }catch(e){toast(t('t_error'),t('notif_err_disable'));}
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
var _histCache={};// cache des cours passés non présents dans C[]
function _renderHistorique(lr,rows){
  lr.innerHTML='<div style="background:var(--wh);border-radius:16px;overflow:hidden">'
    +rows.map(function(r){
      return'<div class="hrow" style="display:flex;align-items:center;gap:12px;padding:13px 16px;cursor:pointer;'+r.border+'">'
        +'<div style="width:42px;height:42px;border-radius:12px;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
        +'<div style="width:10px;height:10px;border-radius:50%;background:'+r.color+'"></div></div>'
        +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+r.title+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+esc(fmtDt(r.dt))+'</div></div>'
        +'<span style="font-size:11px;font-weight:600;background:var(--bg);color:var(--lite);border-radius:6px;padding:3px 8px">Termin\u00e9</span>'
        +'</div>';
    }).join('')+'</div>';
  lr.querySelectorAll('.hrow').forEach(function(el,i){
    el.onclick=function(){openR(rows[i].id);};
  });
}
function buildHistorique(){
  var lr=g('listH');if(!lr)return;
  var rIds=Object.keys(res);
  if(!rIds.length){
    lr.innerHTML='<div style="text-align:center;padding:40px 20px">'
      +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#FFF0E6,#FFD0A8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;animation:emptyFloat 3s ease-in-out infinite;box-shadow:0 8px 28px rgba(255,107,43,.22)">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" stroke-linecap="round" width="30" height="30"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'</div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">'+t('hist_empty')+'</div>'
      +'<div style="font-size:14px;color:var(--lite)">Vos cours termin\u00e9s apparaissent ici</div></div>';
    return;
  }
  function _toRow(c,i,arr){
    var mat=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
    return{id:c.id,title:c.title,dt:c.dt,color:mat.color,border:i<arr.length-1?'border-bottom:1px solid var(--bdr)':''};
  }
  // Courses trouvées dans C[] (passées) + courses dans le cache historique
  var pastFromC=rIds.map(function(id){return C.find(function(x){return String(x.id)==String(id);});}).filter(function(c){
    return c&&_isCoursPass(c);
  });
  var pastIds=pastFromC.map(function(c){return String(c.id);});
  // Ajouter les cours du cache historique qui ne sont pas déjà dans C[]
  var cachedPast=Object.keys(_histCache).filter(function(id){return rIds.indexOf(id)>=0&&pastIds.indexOf(id)<0;}).map(function(id){return _histCache[id];});
  var allPast=pastFromC.concat(cachedPast);
  // Identifiants des cours réservés absents de C[] et du cache → à fetcher
  var missingIds=rIds.filter(function(id){
    var inC=C.find(function(x){return String(x.id)==String(id);});
    return!inC&&!_histCache[id];
  });
  if(missingIds.length){
    // Afficher ce qu'on a pendant le fetch
    if(allPast.length){_renderHistorique(lr,allPast.map(_toRow));}
    else{lr.innerHTML='<div style="text-align:center;padding:32px;font-size:14px;color:var(--lite)">Chargement…</div>';}
    // Fetch les cours manquants depuis l'API
    Promise.all(missingIds.map(function(id){
      return fetch(API+'/cours/'+id,{headers:apiH()}).then(function(r){return r.json();}).catch(function(){return null;});
    })).then(function(results){
      results.forEach(function(c){
        if(!c||!c.id)return;
        var mapped={id:c.id,title:c.titre||c.title||'Cours',dt:c.date_heure||c.dt||'',subj:c.sujet||c.subj||'Autre',mode:c.mode||'',lc:c.lieu||c.lc||''};
        _histCache[String(c.id)]=mapped;
        if(_isCoursPass(mapped))allPast.push(mapped);
      });
      if(!allPast.length){
        lr.innerHTML='<div style="text-align:center;padding:32px;font-size:14px;color:var(--lite)">'+t('hist_empty')+'</div>';
      } else {
        _renderHistorique(lr,allPast.map(_toRow));
      }
    });
    return;
  }
  if(!allPast.length){
    lr.innerHTML='<div style="text-align:center;padding:32px;font-size:14px;color:var(--lite)">'+t('hist_empty')+'</div>';
    return;
  }
  _renderHistorique(lr,allPast.map(_toRow));
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
    var _vBT=g('verifBandTitle'),_vBS=g('verifBandSub');
    if(_vBT)_vBT.textContent=window.t('verif_id_required');
    if(_vBS)_vBS.textContent=window.t('verif_id_tap');
    band.style.background='var(--orp)';
    band.style.borderColor='#FED7AA';
    return;
  }
  if(status==='verified'){band.style.display='none';return;}
  if(status==='pending'||status==='rejected_retry'){
    band.style.display='flex';
    var _vBT=g('verifBandTitle'),_vBS=g('verifBandSub');
    if(status==='pending'){
      if(_vBT)_vBT.textContent=window.t('verif_id_progress');
      if(_vBS)_vBS.textContent=window.t('verif_id_email24h');
      band.style.background='#FFFBEB';
      band.style.borderColor='#FDE68A';
    } else {
      if(_vBT)_vBT.textContent=window.t('verif_id_rejected');
      if(_vBS)_vBS.textContent=window.t('verif_id_resubmit');
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
    if(tm)tm.content=_darkMode?'#111111':'#ffffff';
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
    cancel.textContent=t('txt_annuler');
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
    if(!c||(!c.dt_iso&&!c.dt))return false;
    var diff=now-new Date(c.dt_iso||0);
    if(isNaN(diff)||diff<3600000)return false;
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
  if(rs){try{var d=new Date(c.dt||now);var diff=Math.round((d.getTime()-now.getTime())/60000);rs.textContent=t('reminder_dans')+' '+diff+' '+t('reminder_min')+' · '+c.lc;}catch(e){rs.textContent=c.dt;}}
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
        btn.textContent=t('confirm_cancel_res_btn');el.style.position='relative';el.style.overflow='hidden';el.appendChild(btn);
        btn.onclick=function(){if(window.confirm(t('confirm_cancel_res'))){onConfirm();}else{el.style.transition='transform .2s';el.style.transform='translateX(0)';}};
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
  if(_accountCheckTimer)return;
  _accountCheckTimer=setInterval(async function(){
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
      if(p.statut_compte!==user.statut_compte||p.verified!==user.verified||p.diplome_verifie!==user.diplome_verifie){
        var _prevVerified=user.verified;
        user.statut_compte=p.statut_compte;
        user.verified=p.verified;
        user.can_retry_cni=p.can_retry_cni;
        user.rejection_reason=p.rejection_reason;
        var _dvChanged=p.diplome_verifie!==user.diplome_verifie;
        user.diplome_verifie=p.diplome_verifie;
        if(p.diplome_verifie===false&&user.diplome_uploaded)user.diplome_uploaded=false;
        try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
        // Mettre à jour la bannière de vérification
        updateVerifBand();
        updateDiplomeStatusBlock();
        updateCasierStatusBlock();
        // Notifier uniquement si le compte vient d'être vérifié (pas déjà vérifié avant)
        if(user.role==='professeur'&&!_prevVerified&&(p.statut_compte==='verified'||p.verified)){
          toast('Compte vérifié !','Vous pouvez maintenant publier des cours');
          haptic([10,50,100,50,10]);
        } else if(user.role==='professeur'&&p.statut_compte==='rejeté'){
          toast('Document refusé','Vérifiez votre email pour plus d\'informations');
        }
        if(_dvChanged&&p.diplome_verifie===true){
          toast(t('t_diplome_ok'),t('t_diplome_sub'));
          haptic([10,50,100,50,10]);
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
var safeUrl=function(u){return (u&&/^https?:\/\//i.test(u))?escH(u):'#';};

// Step form — icônes natives simples (style Feather, cercle orange)
function _si(d){return '<div style="width:80px;height:80px;background:#FFF0E8;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="36" height="36">'+d+'</svg></div>';}
var STEP_DEFS=[
  {id:'mode',    em:_si('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'), q:'Type de cours',       h:'Pr\u00e9sentiel en personne ou visio en ligne'},
  {id:'prive',   em:_si('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>'),                                           q:'Visibilit\u00e9',      h:'Un cours priv\u00e9 n\'est pas visible publiquement \u2014 acc\u00e8s par code unique'},
  {id:'titre',   em:_si('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>'),                                        q:'Titre du cours',       h:'Donnez un titre clair et accrocheur'},
  {id:'matiere', em:_si('<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>'),                         q:'Quelle mati\u00e8re\u00a0?', h:'Choisissez la discipline'},
  {id:'niveau',  em:_si('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),           q:'Niveau vis\u00e9',     h:'Quel public ciblez-vous\u00a0?'},
  {id:'datetime',em:_si('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'), q:'Quand\u00a0?', h:'Date et heure du cours'},
  {id:'lieu',    em:_si('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>'),                                       q:'O\u00f9\u00a0?',       h:'Ville, adresse \u2014 ou lien g\u00e9n\u00e9r\u00e9 pour la visio'},
  {id:'prix',    em:_si('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),                                       q:'Prix &amp; places',   h:'Prix total que vous souhaitez recevoir'},
  {id:'desc',    em:_si('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'), q:'Description', h:'D\u00e9tails sur votre cours (optionnel)'},
];

var _sd={mode:'presentiel',prive:false,code_acces:'',titre:'',matiere:'',matiere_key:'',niveau:'',date:'',heure:'',duree:60,places:5,prix:0,lieu:'',lieu_prive:'',lieu_type:'',desc:''};
var _sc=0;

function openCrStep(){
  if(!user||!user.id){showLoginPrompt();return;}
  if(user.role!=='professeur'){toast('Acc\u00e8s refus\u00e9','Seuls les professeurs peuvent proposer des cours');return;}
  if(user.verified===false){
    if(getCniStatus()==='none'){toast('Pi\u00e8ce d\'identit\u00e9 requise','Envoyez votre CNI depuis votre profil pour publier des cours');openCniSheet();}
    else{toast('V\u00e9rification en cours','Votre identit\u00e9 est en cours de v\u00e9rification. Vous pourrez publier des cours sous 24h.');}
    return;
  }
  _sd={mode:'presentiel',prive:false,code_acces:'',titre:'',matiere:'',matiere_key:'',niveau:'',date:'',heure:'',duree:60,places:5,prix:0,lieu:'',lieu_prive:'',lieu_type:'',desc:''};
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
  var backBtn=g('stepBackBtn');
  if(backBtn){
    backBtn.style.opacity='1';
    backBtn.innerHTML=idx===0
      ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>';
    backBtn.title=idx===0?t('wiz_back_cancel'):t('wiz_back_prev');
  }
  var cta=g('stepCta');if(cta){cta.textContent=idx===STEP_DEFS.length-1?t('wiz_publish'):t('wiz_continuer');cta.disabled=false;}
  var body=g('stepBody');if(!body)return;

  var html='<div style="margin-bottom:20px;display:flex;justify-content:center">'+step.em+'</div>'
    +'<div style="font-size:clamp(22px,6vw,28px);font-weight:800;letter-spacing:-.05em;color:var(--ink);margin-bottom:8px;text-align:center;line-height:1.2">'+step.q+'</div>'
    +'<div style="font-size:14px;color:var(--lite);text-align:center;margin-bottom:28px;line-height:1.5">'+step.h+'</div>';

  if(step.id==='mode'){
    html+='<div style="display:flex;flex-direction:column;gap:12px;width:100%">'
      +sOpt('mode','presentiel',t('mode_pres'),t('nc_mode_pres'),_sd.mode==='presentiel','rgba(0,177,79,.1)')
      +sOpt('mode','visio',t('mode_visio'),t('nc_mode_vis'),_sd.mode==='visio','rgba(0,113,227,.1)')
      +'</div>';

  }else if(step.id==='prive'){
    html+='<div style="display:flex;flex-direction:column;gap:12px;width:100%">'
      +sOpt('prive','public',t('nc_public'),t('nc_public_desc'),!_sd.prive,'rgba(0,177,79,.1)')
      +sOpt('prive','prive',t('nc_prive'),t('nc_prive_desc'),_sd.prive,'rgba(255,107,43,.1)')
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
    var _isDkM=document.documentElement.classList.contains('dk');
    var _matCats=[
      {lbl:t('mat_cat_sciences'),  items:['Maths','Statistiques','Physique','Chimie','SVT / Biologie','Astronomie','G\u00e9ologie','M\u00e9decine / Sant\u00e9','\u00c9cologie']},
      {lbl:t('mat_cat_numerique'), items:['Informatique','Python','JavaScript','D\u00e9veloppement web','Data Science','IA & Machine Learning','\u00c9lectronique','Design / UI','Cybers\u00e9curit\u00e9','No-code','Blockchain']},
      {lbl:t('mat_cat_langues'),   items:['Fran\u00e7ais','Anglais','Espagnol','Allemand','Italien','Portugais','Arabe','Chinois','Japonais','Russe','Cor\u00e9en','Hindi','Latin','Langue des signes']},
      {lbl:t('mat_cat_lettres'),   items:['\u00c9criture cr\u00e9ative','Philosophie','Th\u00e9\u00e2tre','Cin\u00e9ma / Vid\u00e9o','BD / Manga']},
      {lbl:t('mat_cat_arts'),      items:['Dessin','Peinture','Aquarelle','Arts plastiques','Illustration','Calligraphie','Photographie']},
      {lbl:t('mat_cat_musique'),   items:['Musique','Piano','Guitare','Chant','Batterie','Violon','Saxophone']},
      {lbl:t('mat_cat_humaines'),  items:['Histoire-G\u00e9o','Psychologie','Sociologie','G\u00e9ographie','Sciences politiques','Anthropologie']},
      {lbl:t('mat_cat_business'),  items:['\u00c9conomie','Comptabilit\u00e9','Finance','Marketing','Droit','Entrepreneuriat','Gestion de projet','Communication','RH & Recrutement','Immobilier','Architecture']},
      {lbl:t('mat_cat_prepa'),     items:['CPGE / Pr\u00e9pa','M\u00e9decine (PASS/LAS)','Sciences Po','TOEFL / IELTS','GMAT / GRE']},
      {lbl:t('mat_cat_sport'),     items:['Sport / EPS','Fitness','Yoga / M\u00e9ditation','Arts martiaux','Danse','Natation','Tennis','Football','Basket','Running','Boxe / MMA','Golf']},
      {lbl:t('mat_cat_bienetre'),  items:['Nutrition / Di\u00e9t\u00e9tique','D\u00e9veloppement perso']},
      {lbl:t('mat_cat_cuisine'),   items:['Cuisine / Gastronomie','P\u00e2tisserie','Jardinage','Bricolage','Couture / Tricot','Broderie','Poterie / C\u00e9ramique']},
      {lbl:t('mat_cat_jeux'),      items:['Jeux de soci\u00e9t\u00e9','\u00c9checs']},
      {lbl:t('mat_cat_autre'),     items:['Autre']},
    ];
    html+='<div style="width:100%;margin-bottom:4px;position:relative">'
      +'<svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none" viewBox="0 0 24 24" fill="none" stroke="var(--mid)" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      +'<input id="stepMatSearch" type="text" placeholder="Rechercher une mati\u00e8re\u2026" style="width:100%;box-sizing:border-box;padding:11px 14px 11px 38px;border:1.5px solid var(--bdr);border-radius:50px;font-family:inherit;font-size:14px;color:var(--ink);background:var(--wh);outline:none;-webkit-appearance:none" oninput="_matSearchFilter(this.value)">'
      +'</div>';
    html+='<div id="stepMatList" style="display:flex;flex-direction:column;gap:20px;width:100%">';
    _matCats.forEach(function(cat){
      html+='<div data-cat>'
        +'<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">'+cat.lbl+'</div>'
        +'<div style="display:flex;flex-wrap:wrap;gap:8px">';
      cat.items.forEach(function(m){
        var mo=MATIERES.find(function(x){return x.label===m;})||{color:'#9CA3AF',bg:'linear-gradient(135deg,#F9FAFB,#F3F4F6)',bgDark:'linear-gradient(135deg,#1A1A1A,#2A2A2A)'};
        var isSel=_sd.matiere===m;
        var chipBg=isSel?(_isDkM?(mo.bgDark||mo.bg):mo.bg):'var(--wh)';
        var chipBorder=isSel?mo.color:'var(--bdr)';
        html+='<div class="step-option'+(isSel?' selected':'')+'" data-sa="matiere" data-sv="'+escH(m)+'" data-color="'+escH(mo.color)+'" data-bg="'+escH(mo.bg)+'" data-bgdark="'+escH(mo.bgDark||mo.bg)+'" style="background:'+chipBg+';border:2px solid '+chipBorder+';border-radius:50px;padding:8px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;box-shadow:'+(isSel?'0 0 0 3px rgba(255,107,43,.12)':'none')+'">'
          +'<div style="width:9px;height:9px;border-radius:50%;background:'+mo.color+';flex-shrink:0"></div>'
          +'<span style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap">'+m+'</span>'
          +'</div>';
      });
      html+='</div></div>';
    });
    html+='</div>';

  }else if(step.id==='niveau'){
    var _nivCats=[
      {lbl:t('niv_prim'),      items:['CP','CE1','CE2','CM1','CM2']},
      {lbl:t('niv_col'),       items:['6ème','5ème','4ème','3ème']},
      {lbl:t('niv_lyc'),       items:['Seconde','Première','Terminale']},
      {lbl:t('niv_superieur'), items:['BTS / Prépa','Bac+1/2','Bac+3/4','Bac+5 et +']},
      {lbl:t('niv_general'),   items:[t('niv_tous_niveaux'),t('niv_adultes')]},
    ];
    html+='<div style="display:flex;flex-direction:column;gap:20px;width:100%">';
    _nivCats.forEach(function(cat){
      html+='<div>'
        +'<div style="font-size:11px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">'+cat.lbl+'</div>'
        +'<div style="display:flex;flex-wrap:wrap;gap:8px">';
      cat.items.forEach(function(nv){
        var isSel=_sd.niveau===nv;
        html+='<div class="step-option'+(isSel?' selected':'')+'" data-sa="niveau" data-sv="'+escH(nv)+'" onclick="_stepOptClick(this)" style="background:'+(isSel?'var(--orp)':'var(--wh)')+';border:2px solid '+(isSel?'var(--or)':'var(--bdr)')+';border-radius:50px;padding:9px 16px;cursor:pointer;display:inline-flex;align-items:center;box-shadow:'+(isSel?'0 0 0 3px rgba(255,107,43,.12)':'none')+'">'
          +'<span style="font-size:14px;font-weight:600;color:'+(isSel?'var(--or)':'var(--ink)')+';white-space:nowrap">'+nv+'</span>'
          +'</div>';
      });
      html+='</div></div>';
    });
    html+='</div>';

  }else if(step.id==='datetime'){
    var today=new Date().toISOString().split('T')[0];
    var _dtFi='width:100%;border:1.5px solid rgba(255,107,53,.3);border-radius:12px;padding:12px 16px;font-family:inherit;font-size:16px;font-weight:500;color:var(--ink);background:var(--wh);outline:none;-webkit-appearance:none;box-sizing:border-box;transition:border-color .18s';
    var _dtFiNeu='width:100%;border:1.5px solid var(--bdr);border-radius:12px;padding:12px 16px;font-family:inherit;font-size:16px;font-weight:500;color:var(--ink);background:var(--wh);outline:none;-webkit-appearance:none;box-sizing:border-box;transition:border-color .18s';
    var lbl='font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:8px';
    html+='<div style="width:100%;display:flex;flex-direction:column;gap:16px">'
      +'<div style="display:flex;gap:12px;flex-wrap:wrap">'
      +'<div style="flex:1;min-width:140px"><label style="'+lbl+'">Date du cours</label><input id="stepDate" style="'+_dtFi+'" type="date" min="'+today+'" value="'+escH(_sd.date)+'"></div>'
      +'<div style="flex:1;min-width:140px"><label style="'+lbl+'">Heure de d\u00e9but</label><input id="stepHeure" style="'+_dtFi+'" type="time" value="'+escH(_sd.heure)+'"></div>'
      +'</div>'
      +'<div><label style="'+lbl+'">Dur\u00e9e (min)</label><input id="stepDuree" style="'+_dtFiNeu+'" type="number" value="'+_sd.duree+'" min="30"></div>'
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
      var _fi='width:100%;border:2px solid var(--bdr);border-radius:14px;padding:14px 16px;font-family:inherit;font-size:15px;font-weight:500;color:var(--ink);background:var(--wh);outline:none;transition:border-color .2s;-webkit-appearance:none;box-sizing:border-box;margin-top:0';
      var _lt=_sd.lieu_type||'';
      // Chaque option a ses propres placeholders / notes
      var _lieuCfg={
        domicile:{
          label2:'Adresse exacte',
          ph2:'Ex\u00a0: 12 rue de la Paix, Paris\u2026',
          note2:'Partag\u00e9e avec les \u00e9l\u00e8ves inscrits uniquement, selon vos param\u00e8tres.'
        },
        etablissement:{
          label2:'Nom de l\u2019\u00e9tablissement',
          ph2:'Ex\u00a0: Coll\u00e8ge Victor Hugo, Lyc\u00e9e Pasteur\u2026',
          note2:'Partag\u00e9 avec les \u00e9l\u00e8ves inscrits.'
        },
        autre:{
          label2:'Adresse exacte',
          ph2:'Ex\u00a0: 20 avenue Larousse, Paris 5e\u2026',
          note2:'Partag\u00e9e avec les \u00e9l\u00e8ves inscrits.'
        }
      };
      var _cfg=_lieuCfg[_lt]||null;
      var _lieuVal=_sd.lieu||'';
      function _sloBtn(id,icon,title,sub){
        var sel=(_lt===id);
        return '<div onclick="pickLieuType(\''+id+'\')" style="background:var(--wh);border:2px solid '+(sel?'var(--or)':'var(--bdr)')+';border-radius:18px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:border-color .15s">'
          +'<div style="width:40px;height:40px;border-radius:11px;background:'+(sel?'var(--orp)':'var(--bg)')+';flex-shrink:0;display:flex;align-items:center;justify-content:center">'+icon+'</div>'
          +'<div><div style="font-size:15px;font-weight:700;color:var(--ink)">'+title+'</div><div style="font-size:12px;color:var(--lite);margin-top:1px">'+sub+'</div></div>'
        +'</div>';
      }
      var _icoHome='<svg viewBox="0 0 24 24" fill="none" stroke="'+(_lt==='domicile'?'var(--or)':'var(--mid)')+'" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
      var _icoEtab='<svg viewBox="0 0 24 24" fill="none" stroke="'+(_lt==='etablissement'?'var(--or)':'var(--mid)')+'" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>';
      var _icoPin='<svg viewBox="0 0 24 24" fill="none" stroke="'+(_lt==='autre'?'var(--or)':'var(--mid)')+'" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
      html+='<div style="width:100%;display:flex;flex-direction:column;gap:10px">'
        +_sloBtn('domicile',_icoHome,t('lieu_home'),t('lieu_home_desc'))
        +_sloBtn('etablissement',_icoEtab,t('lieu_etab'),t('lieu_etab_desc'))
        +_sloBtn('autre',_icoPin,t('lieu_other'),t('lieu_other_desc'))
        // Champ(s) adresse — toujours affiché dès qu'un type est sélectionné
        +(_cfg?'<div id="stepLieuInputWrap" style="display:flex;flex-direction:column;gap:12px">'
          +'<div>'
            +'<div style="font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Ville ou arrondissement</div>'
            +'<input id="stepLieu" style="'+_fi+'" type="text" placeholder="Ex\u00a0: Paris 5e, Lyon 3e\u2026" value="'+escH(_sd.lieu||'')+'">'
            +'<div id="stepLieuSug" style="margin-top:8px;display:none;background:var(--wh);border:1px solid var(--bdr);border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)"></div>'
            +'<div style="margin-top:7px;font-size:11.5px;color:var(--lite);line-height:1.45">Visible publiquement — les \u00e9l\u00e8ves pourront filtrer par lieu.</div>'
          +'</div>'
          +'<div>'
            +'<div style="font-size:11px;font-weight:700;color:var(--lite);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">'+_cfg.label2+'</div>'
            +'<input id="stepLieuPrive" style="'+_fi+'" type="text" placeholder="'+_cfg.ph2+'" value="'+escH(_sd.lieu_prive||'')+'">'
            +'<div style="margin-top:7px;font-size:11.5px;color:var(--lite);line-height:1.45">'+_cfg.note2+'</div>'
          +'</div>'
          +'</div>':'')
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
      else if(a==='matiere'){
        _sd.matiere=v;
        var _mo=MATIERES.find(function(x){return x.label===v;})||{color:'#9CA3AF',bg:'linear-gradient(135deg,#F9FAFB,#F3F4F6)',bgDark:'linear-gradient(135deg,#1A1A1A,#2A2A2A)'};
        _sd.matiere_key=_mo.key||v.toLowerCase();
        var _isDk=document.documentElement.classList.contains('dk');
        body.querySelectorAll('[data-sa="matiere"]').forEach(function(o){
          o.classList.remove('selected');
          o.style.background='var(--wh)';
          o.style.border='2px solid var(--bdr)';
          o.style.boxShadow='none';
        });
        el.classList.add('selected');
        el.style.background=_isDk?(el.dataset.bgdark||el.dataset.bg):el.dataset.bg;
        el.style.border='2px solid '+el.dataset.color;
        el.style.boxShadow='0 0 0 3px rgba(255,107,43,.12)';
        haptic(8);
        return;
      }
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
  wire('stepLieuPrive',function(){_sd.lieu_prive=this.value;});
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

  if(step.id!=='matiere'){setTimeout(function(){var inp=body.querySelector('input[type="text"],input[type="number"],textarea');if(inp)inp.focus();},300);}
}

function pickLieuType(t){
  if(t!==_sd.lieu_type){_sd.lieu='';_sd.lieu_prive='';}
  _sd.lieu_type=t;
  stepRender(_sc);
}

function _matSearchFilter(q){
  var list=g('stepMatList');if(!list)return;
  var n=normStr(q);
  list.querySelectorAll('[data-cat]').forEach(function(cat){
    var chips=cat.querySelectorAll('[data-sa="matiere"]');
    var visible=0;
    chips.forEach(function(chip){
      var match=!n||normStr(chip.dataset.sv).includes(n);
      chip.style.display=match?'':'none';
      if(match)visible++;
    });
    cat.style.display=visible?'':'none';
  });
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
  if(_sd.lieu_type==='etablissement')return; // pas d'autocomplétion géo pour un établissement (nom libre)
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
    if(_sd.mode!=='visio'){
      if(!_sd.lieu_type){toast('Lieu manquant','Choisissez un type de lieu');return;}
      if(g('stepLieu'))_sd.lieu=g('stepLieu').value.trim();
      if(g('stepLieuPrive'))_sd.lieu_prive=g('stepLieuPrive').value.trim();
      if(!_sd.lieu){toast('Lieu manquant','Précisez la ville ou l\'adresse');return;}
    }
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
      lieu_prive:_sd.lieu_prive||'',
      lieu_type:_sd.lieu_type||'',
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
      if(!user||user.guest){navTo('exp');return;}
      if(user.role==='professeur'){espGoMesCours();return;}
      // Masquer toutes les pages
      ['pgExp','pgMsg','pgAcc','pgFav','pgMes','pgMesProfs'].forEach(function(id){
        var el=g(id);if(el)el.classList.remove('on');
      });
      // Activer pgMes
      var pgMesEl=g('pgMes');if(pgMesEl)pgMesEl.classList.add('on');
      // Désactiver tous les items nav
      ['bniExp','bniFav','bniMsg','bniProfs','bniMes'].forEach(function(id){
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
    var bm=g('bniMes');if(bm)bm.style.display=(user&&user.role==='professeur')?'none':'flex';
    var bp=g('bniProfs');if(bp)bp.style.display=(user&&user.role==='professeur')?'none':'flex';
    var be=g('bniEsp');if(be)be.style.display=(user&&user.role==='professeur')?'flex':'none';
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
      if(rmb){var _rVis=c.mode==='visio'||c.lc==='Visio'||!!c.visio_url;rmb.innerHTML='<span class="mode-badge '+(_rVis?'visio':'presentiel')+'">'+(_rVis?t('mode_visio'):t('mode_pres'))+'</span>';}
      var rvj=g('rVisioJoin');
      if(rvj){
        var _isProf=user&&c.pr===user.id;
        var _isEnrolled=!!res[c.id];
        var _rStart=c.dt_iso?new Date(c.dt_iso).getTime():0;
        var _rInWin=!_rStart||(Date.now()>=_rStart-15*60*1000&&Date.now()<=_rStart+2*60*60*1000);
        var show=c.mode==='visio'&&c.visio_url&&(_isProf||(_isEnrolled&&_rInWin));
        rvj.style.display=show?'flex':'none';
        if(show)rvj.href=(/^https?:\/\//i.test(c.visio_url)?c.visio_url:'#');
      }
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

// ---- Mes cours — Calendrier ----
var _CAL_DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
var _CAL_MONTHS=['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];

function _calYmd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

function _calWeekMon(){
  var n=new Date();n.setHours(0,0,0,0);
  var wd=n.getDay();var diff=wd===0?-6:1-wd;
  var mon=new Date(n);mon.setDate(n.getDate()+diff+_calWeekOffset*7);
  return mon;
}

function _calBuildHeader(myCours){
  var hd=g('mesCalHd');if(!hd)return;
  var isProf=user&&user.role==='professeur';

  // Segment bar HTML (tous les utilisateurs)
  var segHtml='<div id="mesSegBar" style="padding:8px 0 2px">'
    +'<div style="display:flex;background:var(--bg);border-radius:12px;padding:3px;gap:3px">'
    +'<button id="mesSegUpcoming" class="mes-seg-btn'+(_mesSeg!=='past'?' on':'')+'" onclick="mesSetSeg(\'upcoming\')">À venir</button>'
    +'<button id="mesSegPast" class="mes-seg-btn'+(_mesSeg==='past'?' on':'')+'" onclick="mesSetSeg(\'past\')">Passés</button>'
    +'</div></div>';

  hd.style.padding=''; // toujours laisser le CSS par défaut (safe-area incluse)

  var today=new Date();today.setHours(0,0,0,0);
  var todayYmd=_calYmd(today);
  var mon=_calWeekMon();

  // Default selected day = today if in this week, else monday of week
  if(!_calSelDay){_calSelDay=todayYmd;}
  var selInWeek=false;
  for(var i=0;i<7;i++){var td=new Date(mon);td.setDate(mon.getDate()+i);if(_calYmd(td)===_calSelDay){selInWeek=true;break;}}
  if(!selInWeek)_calSelDay=_calYmd(mon);

  var selD=new Date(_calSelDay+'T00:00:00');
  var titleStr=_mesSeg==='past'
    ? 'Cours passés'
    : _CAL_DAYS[selD.getDay()]+' '+selD.getDate()+' '+_CAL_MONTHS[selD.getMonth()];

  // Compute set of days that have courses (only for upcoming mode)
  var daysWithCours={};
  if(_mesSeg!=='past'){
    myCours.forEach(function(c){if(c.dt_iso){var d=new Date(c.dt_iso);d.setHours(0,0,0,0);daysWithCours[_calYmd(d)]=true;}});
  }

  // Titre + (date picker uniquement en mode À venir)
  var topHtml='<div class="mes-cal-top">'
    +'<div class="mes-cal-title">'+titleStr+'</div>'
    +(_mesSeg!=='past'
      ?'<button class="mes-cal-picker-btn" onclick="calOpenPicker()" title="Choisir une date">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'
        +'<input id="calDateInp" type="date" style="position:absolute;inset:0;opacity:0;cursor:pointer" onchange="calPickDate(this.value)">'
        +'</button>'
      :'')
    +'</div>';

  // Bande des jours uniquement en mode À venir
  var stripHtml='';
  if(_mesSeg!=='past'){
    var chipsHtml='';
    for(var i=0;i<7;i++){
      var d=new Date(mon);d.setDate(mon.getDate()+i);
      var ymd=_calYmd(d);
      var cls='cal-chip'+(ymd===todayYmd?' cal-today':'')+(ymd===_calSelDay?' cal-sel':'');
      chipsHtml+='<button class="'+cls+'" data-ymd="'+ymd+'" onclick="calSelectDay(\''+ymd+'\')">'
        +'<span class="cal-chip-lbl">'+_CAL_DAYS[d.getDay()]+'</span>'
        +'<span class="cal-chip-num">'+d.getDate()+'</span>'
        +(daysWithCours[ymd]?'<span class="cal-dot"></span>':'')
        +'</button>';
    }
    stripHtml='<div class="mes-cal-strip">'
      +'<button class="cal-nav-btn" onclick="calChangeWeek(-1)" aria-label="Semaine précédente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg></button>'
      +'<div class="cal-chips" id="calChips">'+chipsHtml+'</div>'
      +'<button class="cal-nav-btn" onclick="calChangeWeek(1)" aria-label="Semaine suivante"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg></button>'
      +'</div>';
  }

  hd.innerHTML=topHtml+segHtml+stripHtml;

  // Swipe gauche/droite sur la bande pour changer de semaine
  var chips=g('calChips');
  if(chips){
    var _sx=0;
    chips.addEventListener('touchstart',function(e){_sx=e.touches[0].clientX;},{passive:true});
    chips.addEventListener('touchend',function(e){
      var dx=e.changedTouches[0].clientX-_sx;
      if(Math.abs(dx)>50){calChangeWeek(dx<0?1:-1);}
    },{passive:true});
  }
}

function calSelectDay(ymd){
  _calSelDay=ymd;
  // Update header title
  var titleEl=document.querySelector('.mes-cal-title');
  if(titleEl){var d=new Date(ymd+'T00:00:00');titleEl.textContent=_CAL_DAYS[d.getDay()]+' '+d.getDate()+' '+_CAL_MONTHS[d.getMonth()];}
  // Update chips
  document.querySelectorAll('.cal-chip').forEach(function(c){
    var on=c.dataset.ymd===ymd;
    c.classList.toggle('cal-sel',on);
  });
  haptic(4);
  _renderCalCourses();
}

function calChangeWeek(delta){
  _calWeekOffset+=delta;
  buildMesCours();
  haptic(4);
}

function calOpenPicker(){
  var inp=g('calDateInp');
  if(inp){inp.value=_calSelDay||'';inp.showPicker?inp.showPicker():inp.click();}
}

function calPickDate(val){
  if(!val)return;
  // Compute which week contains this date
  var target=new Date(val+'T00:00:00');
  var today=new Date();today.setHours(0,0,0,0);
  var wd=today.getDay();var diff=wd===0?-6:1-wd;
  var thisMonday=new Date(today);thisMonday.setDate(today.getDate()+diff);
  var tMonday=new Date(target);var twd=target.getDay();var tdiff=twd===0?-6:1-twd;tMonday.setDate(target.getDate()+tdiff);
  var weekDiff=Math.round((tMonday-thisMonday)/(7*86400000));
  _calWeekOffset=weekDiff;
  _calSelDay=val;
  buildMesCours();
}

function _renderCalCourses(){
  var el=g('pgMesCnt');if(!el)return;
  var isProf=user&&user.role==='professeur';

  // Pour les profs : cours publiés ET cours réservés (en tant qu'élève)
  // Chaque entrée : {c: course, kind: 'published'|'reserved'}
  var tagged=[];
  if(isProf){
    C.filter(function(c){return String(c.pr)===String(user.id);}).forEach(function(c){tagged.push({c:c,kind:'published'});});
    Object.keys(res).map(function(id){return C.find(function(c){return c.id==id;});}).filter(Boolean).forEach(function(c){
      if(!tagged.some(function(t){return t.c.id===c.id;}))tagged.push({c:c,kind:'reserved'});
    });
  } else {
    Object.keys(res).map(function(id){return C.find(function(c){return c.id==id;});}).filter(Boolean).forEach(function(c){tagged.push({c:c,kind:'reserved'});});
  }
  var myCours=tagged.map(function(t){return t.c;});

  // Mode Passés
  if(_mesSeg==='past'){
    var now=new Date();
    var pastTagged=tagged.filter(function(t){return t.c.dt_iso&&new Date(t.c.dt_iso)<now;})
      .sort(function(a,b){return new Date(b.c.dt_iso)-new Date(a.c.dt_iso);});
    if(!pastTagged.length){
      el.innerHTML='<div class="mes-cal-empty">'
        +'<div class="mes-cal-empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" width="32" height="32"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>'
        +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:6px">Aucun cours passé</div>'
        +'<div style="font-size:13px;color:var(--lite)">Tes cours terminés apparaîtront ici</div>'
        +'</div>';
      return;
    }
    var h='';
    pastTagged.forEach(function(t){h+=buildMesCard(t.c,true,isProf,t.kind);});
    el.innerHTML=h;_bindMesCards(el);return;
  }

  var ymd=_calSelDay;
  var dayStart=ymd?new Date(ymd+'T00:00:00'):null;
  var dayEnd=dayStart?new Date(dayStart.getTime()+86400000):null;

  var dayTagged=tagged.filter(function(t){
    if(!dayStart)return true;
    if(!t.c.dt_iso)return false;
    var ts=new Date(t.c.dt_iso).getTime();
    return ts>=dayStart.getTime()&&ts<dayEnd.getTime();
  }).sort(function(a,b){return new Date(a.c.dt_iso||0)-new Date(b.c.dt_iso||0);});

  if(!dayTagged.length){
    el.innerHTML='<div class="mes-cal-empty">'
      +'<div class="mes-cal-empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" width="32" height="32"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg></div>'
      +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:6px">Aucun cours ce jour</div>'
      +'<div style="font-size:13px;color:var(--lite)">'+(isProf?'Aucun cours publié ou réservé':'Pas de cours réservé')+'</div>'
      +'</div>';
    return;
  }
  var h='';
  dayTagged.forEach(function(t){h+=buildMesCard(t.c,_isCoursPass(t.c),isProf,t.kind);});
  el.innerHTML=h;
  _bindMesCards(el);
}

function _bindMesCards(el){
  el.querySelectorAll('.mes-card').forEach(function(card){card.onclick=function(){openR(card.dataset.cid);};});
  el.querySelectorAll('.mes-code-copy').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();var code=btn.dataset.code;if(navigator.clipboard)navigator.clipboard.writeText(code).then(function(){toast('Copié\u00a0!','');});};});
  el.querySelectorAll('.mes-visio-add').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();openAddVisioLink(btn.dataset.cid);};});
  el.querySelectorAll('.mes-link-copy').forEach(function(btn){btn.onclick=function(e){e.stopPropagation();var link=btn.dataset.link;if(navigator.share){navigator.share({title:'CoursPool',url:link}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(link).then(function(){toast('Lien copié\u00a0!','');});}};});
}

function mesSetSeg(seg){
  _mesSeg=seg;
  haptic(4);
  buildMesCours(); // rebuild header (segBar) ET contenu
}

function buildMesCours(){
  var hd=g('mesCalHd');var el=g('pgMesCnt');
  if(!el)return;
  if(!user||!user.id){
    if(hd)hd.innerHTML='';
    el.innerHTML='<div class="mes-cal-empty"><div class="mes-cal-empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" stroke-width="1.8" width="32" height="32"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style="font-size:17px;font-weight:800;color:var(--ink)">Connexion requise</div></div>';
    return;
  }
  var isProf=user&&user.role==='professeur';

  // Tous les cours à afficher (publiés + réservés pour les profs)
  var allCours;
  if(isProf){
    var published=C.filter(function(c){return String(c.pr)===String(user.id);});
    var reserved=Object.keys(res).map(function(id){return C.find(function(c){return c.id==id;});}).filter(Boolean);
    // Dédoublonner
    var seen={};
    allCours=[];
    published.concat(reserved).forEach(function(c){if(c&&!seen[c.id]){seen[c.id]=true;allCours.push(c);}});
  } else {
    allCours=Object.keys(res).map(function(id){return C.find(function(c){return c.id==id;});}).filter(Boolean);
  }

  if(hd)hd.style.display=''; // _calBuildHeader gère le contenu selon _mesSeg
  _calBuildHeader(allCours);
  _renderCalCourses();
}

function buildMesCard(c,isPast,isProf,kind){
  // Badge type : 'published' = cours que le prof a créé, 'reserved' = cours réservé
  var kindBadge='';
  if(kind==='published'){
    kindBadge='<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,107,43,.12);color:var(--or);border-radius:50px;padding:3px 9px;font-size:10px;font-weight:800;letter-spacing:.02em;margin-bottom:8px">📌 Mon cours</span>';
  }else if(kind==='reserved'){
    kindBadge='<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(59,130,246,.1);color:#2563EB;border-radius:50px;padding:3px 9px;font-size:10px;font-weight:800;letter-spacing:.02em;margin-bottom:8px">🎓 Réservé</span>';
  }
  var mf=findMatiere(c.subj||'')||MATIERES[MATIERES.length-1];
  var pp=c.sp>0?Math.ceil(c.tot/c.sp):0;
  var mL=c.mode==='visio'?'Visio':'Pr\u00e9sentiel';
  var mC=c.mode==='visio'?'visio':'presentiel';
  var visio='';
  if(c.mode==='visio'){
    var _vNow=Date.now();
    var _vStart=c.dt_iso?new Date(c.dt_iso).getTime():0;
    var _vInWin=!_vStart||(_vNow>=_vStart-15*60*1000&&_vNow<=_vStart+2*60*60*1000);
    var _vNotYet=_vStart&&_vNow<_vStart-15*60*1000;
    var _vHeure=_vStart?new Date(_vStart).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
    if(isProf){
      if(!c.visio_url){visio='<button class="mes-visio-add" data-cid="'+escH(c.id)+'" style="margin-top:10px;width:100%;padding:10px;background:rgba(0,113,227,.08);color:#0055B3;border:1.5px dashed rgba(0,113,227,.3);border-radius:12px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">+ Ajouter le lien visio</button>';}
      else{visio='<div style="margin-top:10px;display:flex;gap:8px"><a href="'+safeUrl(c.visio_url)+'" target="_blank" class="btn-visio" style="flex:1;justify-content:center;text-decoration:none" onclick="event.stopPropagation()">Rejoindre</a><button class="mes-visio-add" data-cid="'+escH(c.id)+'" style="padding:9px 14px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:50px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer">Modifier</button></div>';}
    } else if(!!res[c.id]){
      if(c.visio_url&&_vInWin){visio='<a href="'+safeUrl(c.visio_url)+'" target="_blank" class="btn-visio" style="margin-top:10px;width:100%;justify-content:center;text-decoration:none" onclick="event.stopPropagation()">Rejoindre en visio</a>';}
      else if(_vNotYet){visio='<div style="margin-top:10px;width:100%;padding:10px;background:var(--bg);color:var(--lite);border:1.5px solid var(--bdr);border-radius:12px;font-size:13px;font-weight:600;text-align:center">🕐 Accès à partir de '+_vHeure+'</div>';}
    }
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
    +(kindBadge?'<div>'+kindBadge+'</div>':'')
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
    +'<div style="width:44px;height:44px;border-radius:14px;background:'+mf.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:10px;height:10px;border-radius:50%;background:'+mf.color+'"></div></div>'
    +'<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(c.title)+'</div>'
    +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+escH(c.subj)+' &middot; '+escH(c.dt)+'</div></div>'
    +'<div style="font-size:18px;font-weight:800;color:var(--or);flex-shrink:0">'+pp+'&euro;</div>'
    +heartBtn
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<span class="mode-badge '+mC+'">'+mL+'</span>'
    +(c.prive?'<span style="background:var(--bg);border:1px solid var(--bdr);border-radius:50px;padding:3px 8px;font-size:10.5px;font-weight:600;color:var(--mid)">'+t('badge_prive')+'</span>':'')
    +'</div>'+code+shareLink+visio
    +'<button class="mes-cal-btn" data-cid="'+escH(c.id)+'" onclick="event.stopPropagation();addToCalendar(\''+escH(c.id)+'\')" style="margin-top:10px;width:100%;padding:9px;background:var(--bg);color:var(--mid);border:1.5px solid var(--bdr);border-radius:12px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'+t('cal_add_title')+'</button>'
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
  var title=document.createElement('div');title.style.cssText='font-size:18px;font-weight:800;margin-bottom:4px;letter-spacing:-.03em';title.textContent=c.visio_url?t('visio_edit_title'):t('visio_add_title');sheet.appendChild(title);
  var sub=document.createElement('div');sub.style.cssText='font-size:13px;color:var(--lite);margin-bottom:20px';sub.textContent=t('visio_help');sheet.appendChild(sub);
  var inp=document.createElement('input');inp.type='url';inp.placeholder='https://meet.google.com/...';inp.value=c.visio_url||'';inp.style.cssText='width:100%;border:1.5px solid var(--bdr);border-radius:12px;padding:12px 14px;font-family:inherit;font-size:16px;outline:none;margin-bottom:20px;box-sizing:border-box;transition:border-color .2s';inp.addEventListener('focus',function(){inp.style.borderColor='var(--or)';});inp.addEventListener('blur',function(){inp.style.borderColor='var(--bdr)';});sheet.appendChild(inp);
  var btnS=document.createElement('button');btnS.style.cssText='width:100%;background:var(--or);color:#fff;border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.28);margin-bottom:10px';btnS.textContent=t('prof_sauvegarder');
  btnS.onclick=async function(){
    var url=inp.value.trim();btnS.disabled=true;btnS.textContent=t('txt_saving');
    try{var r=await fetch(API+'/cours/'+coursId,{method:'PATCH',headers:apiH(),body:JSON.stringify({visio_url:url})});var d=await r.json();if(!r.ok||d.error){toast(t('t_error'),d.error||t('t_try_again'));btnS.disabled=false;btnS.textContent=t('prof_sauvegarder');return;}if(c)c.visio_url=url;bd.remove();toast(url?t('t_link_saved'):t('t_link_deleted'),'');buildMesCours();}catch(e){toast(t('t_net_error'),'');btnS.disabled=false;btnS.textContent=t('prof_sauvegarder');}
  };
  sheet.appendChild(btnS);
  if(c.visio_url){var btnCl=document.createElement('button');btnCl.style.cssText='width:100%;background:none;border:none;color:#EF4444;font-family:inherit;font-size:14px;cursor:pointer;padding:6px;margin-bottom:4px';btnCl.textContent=t('visio_delete_link');btnCl.onclick=async function(){if(!confirm(t('visio_delete_confirm')))return;try{await fetch(API+'/cours/'+coursId,{method:'PATCH',headers:apiH(),body:JSON.stringify({visio_url:''})});if(c)c.visio_url='';bd.remove();buildMesCours();}catch(e){}};sheet.appendChild(btnCl);}
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
    +'<div style="font-size:16px;font-weight:800;color:var(--ink);margin-bottom:16px">'+t('cal_add_title')+'</div>';

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
    addBtn(calIco,t('cal_apple'),function(){
      var blob=new Blob([icsText],{type:'text/calendar;charset=utf-8'});
      var file=new File([blob],'cours.ics',{type:'text/calendar'});
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        navigator.share({files:[file],title:c.title}).catch(function(){});
      }else{
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');a.href=url;a.download='cours.ics';
        document.body.appendChild(a);a.click();
        setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
      }
    });
  }
  addBtn(gcIco,t('cal_google'),function(){
    if(isCap){window.open(gcUrl,'_system');}else{window.open(gcUrl,'_blank');}
  });
  if(!isIOS&&!isAndroid){
    addBtn(dlIco,t('cal_download'),function(){
      var blob=new Blob([icsText],{type:'text/calendar;charset=utf-8'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download='cours.ics';
      document.body.appendChild(a);a.click();
      setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
    });
  }

  var btnC=document.createElement('button');
  btnC.style.cssText='width:100%;background:none;border:none;color:var(--lite);font-family:inherit;font-size:14px;cursor:pointer;padding:8px;margin-top:4px';
  btnC.textContent=t('txt_annuler');btnC.onclick=function(){bd.remove();};
  sheet.appendChild(btnC);
  bd.appendChild(sheet);document.body.appendChild(bd);
  haptic(10);
}

// ---- Share cours in messagerie ----
function openShareCoursSheet(){
  var myC=C.filter(function(c){return user&&c.pr===user.id&&!_isCoursPass(c);})
    .sort(function(a,b){return new Date(a.dt)-new Date(b.dt);});
  if(!myC.length){toast('Aucun cours à venir','Publiez un nouveau cours pour le partager');return;}
  var bd=document.createElement('div');
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:900;display:flex;align-items:flex-end;justify-content:center';
  bd.onclick=function(e){if(e.target===bd)bd.remove();};
  var sheet=document.createElement('div');
  sheet.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:20px;padding-bottom:max(28px,env(safe-area-inset-bottom,28px));max-height:80vh;display:flex;flex-direction:column';
  var handle=document.createElement('div');handle.style.cssText='width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:0 auto 16px';sheet.appendChild(handle);
  var title=document.createElement('div');title.style.cssText='font-size:17px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px';title.textContent=t('share_cours_title');sheet.appendChild(title);
  var sub=document.createElement('div');sub.style.cssText='font-size:13px;color:var(--lite);margin-bottom:16px';sub.textContent=t('share_cours_sub');sheet.appendChild(sub);
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
  var _cIsDk=document.documentElement.classList.contains('dk');
  var _chatHdrBg=_cIsDk?(mf.bgDark||mf.bg):mf.bg;
  var cardHtml='<div class="chat-cours-card" onclick="viewCoursCard(\''+escH(c.id)+'\')" style="max-width:260px">'
    +'<div class="chat-cours-card-header" style="background:'+_chatHdrBg+'"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:rgba(0,0,0,.18);color:#fff;border-radius:50px;padding:3px 8px">'+escH(c.subj)+'</span>'
    +'<span style="margin-left:auto;font-size:15px;font-weight:800;color:#fff">'+pp+'&euro;</span></div>'
    +'<div class="chat-cours-card-body"><div class="chat-cours-card-title">'+escH(c.title)+'</div>'
    +'<div class="chat-cours-card-meta">'+escH(fmtDt(c.dt))+(_cIsVisio?' &middot; '+t('mode_visio'):'')+'</div>'
    +'<div style="margin-top:6px"><span class="mode-badge '+(_cIsVisio?'visio':'presentiel')+'">'+(_cIsVisio?t('mode_visio'):t('mode_pres'))+'</span></div>'
    +(c.lieu_prive?'<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.07);font-size:11px;color:var(--mid);display:flex;align-items:flex-start;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2" stroke-linecap="round" width="12" height="12" style="flex-shrink:0;margin-top:1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>'+escH(c.lieu_prive)+'</span></div>':'')
    +'</div></div>';
  try{
    await fetch(API+'/messages',{method:'POST',headers:apiH(),body:JSON.stringify({expediteur_id:user.id,destinataire_id:msgDestId,contenu:cardHtml,type:'cours_card'})});
    loadMessages();toast(t('t_cours_shared'),t('t_carte_conv'));
  }catch(e){toast(t('t_error'),t('t_send_impossible'));}
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
var ACC_TITLES={'R':'Mes cours','F':'Suivis','H':'Historique','P':'Mon profil','Rev':'Revenus','Rmb':'Remboursements','Avis':'Mes avis'};

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

// Override switchATab to show detail view + update topbar title
(function(){
  var _tabTitleKeys={R:'acc_mes_cours',F:'acc_suivis',H:'acc_historique',P:'acc_mon_profil',Rev:'acc_revenus',Rmb:'settings_remb',Esp:'Mon Espace'};
  var _orig=switchATab;
  switchATab=function(s,el){
    _orig(s,el);
    var pg=g('pgAcc');
    if(pg){pg.classList.remove('home-mode');pg.classList.add('detail-mode');}
    var mt=g('mobTitle');if(mt&&_tabTitleKeys[s])mt.textContent=t(_tabTitleKeys[s]);
    var mh=g('mobHeader');if(mh)mh.style.display='block';
    var ms=g('mobSearch');if(ms)ms.style.display='none';
    var body=document.querySelector('#pgAcc .acc-body');
    if(body)body.scrollTop=0;
  };
})();

// Override navTo to reset to home when going to acc tab
(function(){
  var _nt2=navTo;
  navTo=function(tab){
    _nt2(tab);
    if(tab==='acc'){setTimeout(showAccHome,20);}
  };
})();

// applyUser — show revenue + refunds cards for profs
(function(){
  var _au2=applyUser;
  applyUser=function(){
    _au2();
    var cr=g('accCardRev');
    if(cr)cr.style.display=(user&&user.role==='professeur')?'block':'none';
    var ce=g('accCardEsp');
    if(ce)ce.style.display=(user&&user.role==='professeur')?'block':'none';
    var te=g('aTabEsp');
    if(te)te.style.display=(user&&user.role==='professeur')?'flex':'none';
    var bm=g('bniMes');if(bm)bm.style.display=(user&&user.role==='professeur')?'none':'flex';
    var bp=g('bniProfs');if(bp)bp.style.display=(user&&user.role==='professeur')?'none':'flex';
    var be=g('bniEsp');if(be)be.style.display=(user&&user.role==='professeur')?'flex':'none';
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
  }catch(e){toast(t('t_net_error'),'');}
  finally{btn.disabled=false;btn.textContent='OK';}
}

// ---- Message delete ----
async function deleteMsg(msgId){
  if(!confirm(t('confirm_delete_msg')))return;
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
  }catch(e){toast(t('t_net_error'),'');}
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
var _msgContactLabels={all:function(){return t('msg_pref_all');},enrolled:function(){return t('msg_pref_enrolled');},enrolled_space:function(){return t('msg_pref_enrolled_space');},none:function(){return t('msg_pref_none');}};
function openSettings(){
  var bd=document.getElementById('bdSettings');
  if(bd){bd.classList.add('on');document.body.style.overflow='hidden';}
  // Remboursements — visible pour tous les utilisateurs connectés
  var rmbRow=g('settingsRmbRow');
  if(rmbRow)rmbRow.style.display=user?'':'none';
  // Confidentialité et communication — visible uniquement pour les profs connectés
  var isProf=user&&user.role==='professeur';
  var privSec=g('settingsProfPrivSection');var privGrp=g('settingsProfPrivGroup');
  if(privSec)privSec.style.display=isProf?'':'none';
  if(privGrp)privGrp.style.display=isProf?'':'none';
  if(isProf){
    // Adresse exacte (default: on)
    var adresseTog=g('adresseAutoToggle');
    if(adresseTog)adresseTog.classList.toggle('on',user.adresse_auto!==false);
    // Messagerie
    var sub=g('settingsMsgContactSub');
    var _mc=_msgContactLabels[user.contact_pref||'all']||_msgContactLabels.all;if(sub)sub.textContent=typeof _mc==='function'?_mc():_mc;
    // Apparition dans les recherches (default: on)
    var searchTog=g('searchVisibleToggle');
    if(searchTog)searchTog.classList.toggle('on',user.search_visible!==false);
  }
  // Tuteur / parent — visible pour les élèves uniquement
  var isEleve=user&&user.role!=='professeur';
  var tutSec=g('settingsTuteurSection'),tutGrp=g('settingsTuteurGroup');
  if(tutSec)tutSec.style.display=isEleve?'block':'none';
  if(tutGrp)tutGrp.style.display=isEleve?'flex':'none';
  if(isEleve){
    var tutTog=g('tuteurToggle');if(tutTog)tutTog.classList.toggle('on',!!(user&&user.is_tuteur));
    var _isTut=!!(user&&user.is_tuteur);
    var epRow=g('enfantPrenomRow');if(epRow)epRow.style.display=_isTut?'flex':'none';
    var ep=g('enfantPrenomInput');
    if(ep){var _ep=user.enfant_prenom||(function(){try{return localStorage.getItem('cp_enfant_prenom')||'';}catch(e){return '';}}());ep.value=_ep;if(user)user.enfant_prenom=_ep;}
  }
  updateDarkBtn();
  setTimeout(renderNotifStatus,50);
  haptic(6);
}

async function deleteAccount(){
  if(!user)return;
  closeSettings();
  var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:20px 20px 8px;text-align:center">'
    +'<div style="width:56px;height:56px;background:#FEF2F2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" width="26" height="26"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>'
    +'</div>'
    +'<div style="font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.03em;margin-bottom:10px">Supprimer mon compte</div>'
    +'<div style="font-size:14px;color:var(--mid);line-height:1.6;margin-bottom:20px">Toutes vos données seront effacées définitivement :<br>profil, cours, réservations, messages.<br><strong style="color:#EF4444">Cette action est irréversible.</strong></div>'
    +'</div>'
    +'<div style="padding:0 16px;display:flex;flex-direction:column;gap:10px">'
    +'<button onclick="_confirmDeleteAccount()" style="width:100%;background:#EF4444;color:#fff;border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer">'+t('delete_account_btn')+'</button>'
    +'<button onclick="closeQuickSheet()" style="width:100%;background:var(--bg);color:var(--mid);border:none;border-radius:14px;padding:15px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">'+t('txt_annuler')+'</button>'
    +'</div>'
    +'<div style="height:max(20px,env(safe-area-inset-bottom,20px))"></div>';
  showQuickSheet(html);
}

async function _confirmDeleteAccount(){
  closeQuickSheet();
  if(!user)return;
  try{
    await fetch(API+'/users/'+user.id,{method:'DELETE',headers:apiH()});
  }catch(e){}
  try{localStorage.clear();sessionStorage.clear();}catch(e){}
  user=null;
  haptic(10);
  toast('Compte supprimé','À bientôt');
  setTimeout(function(){location.reload();},1500);
}

async function toggleTuteurMode(){
  if(!user)return;
  user.is_tuteur=!user.is_tuteur;
  var tog=g('tuteurToggle');if(tog)tog.classList.toggle('on',user.is_tuteur);
  try{localStorage.setItem('cp_is_tuteur',user.is_tuteur?'1':'0');}catch(e){}
  var epRow=g('enfantPrenomRow');if(epRow)epRow.style.display=user.is_tuteur?'flex':'none';
  // Sync backend si possible
  try{await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify({is_tuteur:user.is_tuteur})});}catch(e){}
  haptic(6);
  toast(user.is_tuteur?'Mode tuteur activé':'Mode tuteur désactivé',user.is_tuteur?'Les profs voient votre statut Tuteur':'Statut Tuteur désactivé');
}

function saveEnfantPrenom(val){
  if(!user)return;
  user.enfant_prenom=val.trim();
  try{localStorage.setItem('cp_enfant_prenom',val.trim());}catch(e){}
  fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify({enfant_prenom:val.trim()})}).catch(function(){});
  haptic(4);
  toast('Prénom enregistré','');
}
function openMsgContactSheet(){
  var opts=[
    {k:'all',    icon:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
     l:t('msg_pref_all'), s:t('msg_pref_all_sub')},
    {k:'enrolled',icon:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
     l:t('msg_pref_enrolled'), s:t('msg_pref_enrolled_sub')},
    {k:'enrolled_space',icon:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><rect x="14" y="14" width="8" height="8" rx="1"/><path d="M16 18h4M18 16v4"/>',
     l:t('msg_pref_enrolled_space'), s:t('msg_pref_enrolled_space_sub')},
    {k:'none',   icon:'<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
     l:t('msg_pref_none'), s:t('msg_pref_none_sub')}
  ];
  var cur=user&&user.contact_pref||'all';
  var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:16px 20px 8px">'
    +'<div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.03em">Messages entrants</div>'
    +'<div style="font-size:13px;color:var(--lite);margin-top:3px">Qui peut vous contacter sur CoursPool ?</div>'
    +'</div>'
    +'<div style="padding:8px 16px 32px;display:flex;flex-direction:column;gap:8px">';
  opts.forEach(function(o){
    var sel=cur===o.k;
    html+='<div onclick="setMsgContactPref(\''+o.k+'\')" style="background:'+(sel?'var(--orp)':'var(--wh)')+';border:1.5px solid '+(sel?'var(--or)':'var(--bdr)')+';border-radius:16px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:all .15s">'
      +'<div style="width:38px;height:38px;border-radius:11px;background:'+(sel?'var(--or)':'var(--bg)')+';flex-shrink:0;display:flex;align-items:center;justify-content:center">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="'+(sel?'#fff':'var(--mid)')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">'+o.icon+'</svg>'
      +'</div>'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.02em">'+o.l+'</div>'
      +'<div style="font-size:12px;color:var(--lite);margin-top:2px;line-height:1.4">'+o.s+'</div>'
      +'</div>'
      +(sel?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>':'')
      +'</div>';
  });
  html+='</div>';
  showQuickSheet(html);
}
async function setMsgContactPref(k){
  if(!user)return;
  user.contact_pref=k;
  var sub=g('settingsMsgContactSub');if(sub){var _mc2=_msgContactLabels[k]||_msgContactLabels.all;sub.textContent=typeof _mc2==='function'?_mc2():_mc2;}
  // Rafraîchit la feuille pour que le check se déplace visuellement
  openMsgContactSheet();
  try{await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify({contact_pref:k})});}catch(e){}
}
async function toggleAdresseAuto(){
  if(!user)return;
  user.adresse_auto=(user.adresse_auto===false)?true:false;
  var tog=g('adresseAutoToggle');if(tog)tog.classList.toggle('on',user.adresse_auto!==false);
  try{await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify({adresse_auto:user.adresse_auto})});}catch(e){}
}
async function toggleSearchVisible(){
  if(!user)return;
  user.search_visible=(user.search_visible===false)?true:false;
  var tog=g('searchVisibleToggle');if(tog)tog.classList.toggle('on',user.search_visible!==false);
  try{await fetch(API+'/profiles/'+user.id,{method:'PATCH',headers:apiH(),body:JSON.stringify({search_visible:user.search_visible})});}catch(e){}
}

// ---- Signalement ----
function openSignalement(context,targetId,targetName){
  if(!user){toast('Connexion requise','Connectez-vous pour signaler');return;}
  var WARN='<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  var CIRC='<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
  var CLOK='<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
  var USER='<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>';
  var EURO='<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>';
  var MSG ='<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>';
  var CHLD='<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>';
  var motifs=context==='eleve'?[
    {k:'comportement',l:'Comportement inapproprié',i:WARN},
    {k:'absence',     l:'Absence sans prévenir',   i:CLOK},
    {k:'harcelement', l:'Harcèlement',              i:CIRC},
    {k:'fraude',      l:'Fraude / impayé',          i:EURO},
    {k:'autre',       l:'Autre',                    i:MSG}
  ]:context==='message'?[
    {k:'offensant',   l:'Contenu offensant',        i:WARN},
    {k:'harcelement', l:'Harcèlement / menaces',    i:CIRC},
    {k:'spam',        l:'Spam ou contenu commercial',i:MSG},
    {k:'usurpation',  l:'Usurpation d\'identité',   i:USER},
    {k:'autre',       l:'Autre',                    i:MSG}
  ]:[
    {k:'comportement',l:'Comportement inapproprié', i:WARN},
    {k:'fausse_id',   l:'Fausse identité',          i:USER},
    {k:'trompeur',    l:'Informations trompeuses',  i:CIRC},
    {k:'harcelement', l:'Harcèlement',              i:CIRC},
    {k:'mineurs',     l:'Comportement envers mineurs',i:CHLD},
    {k:'autre',       l:'Autre',                    i:MSG}
  ];
  var tn=targetName?('<div style="font-size:12px;color:var(--lite);margin-top:1px">'+esc(targetName)+'</div>'):'';
  var html='<div style="width:36px;height:4px;background:var(--bdr);border-radius:4px;margin:14px auto 0"></div>'
    +'<div style="padding:16px 20px 10px;display:flex;align-items:center;gap:12px">'
    +'<div style="width:38px;height:38px;border-radius:11px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">'+WARN+'</svg>'
    +'</div>'
    +'<div><div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.03em">Signaler</div>'+tn+'</div>'
    +'</div>'
    +'<div style="font-size:13px;color:var(--lite);padding:0 20px 14px;line-height:1.5">Votre signalement est traité de façon confidentielle par notre équipe.</div>'
    +'<div style="padding:0 14px;display:flex;flex-direction:column;gap:6px">';
  motifs.forEach(function(m){
    html+='<div onclick="submitSignalement(\''+context+'\',\''+esc(targetId||'')+'\',\''+esc(targetName||'')+'\',\''+m.k+'\',\''+esc(m.l)+'\')" '
      +'style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--bg);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent">'
      +'<div style="width:34px;height:34px;border-radius:9px;background:var(--wh);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--mid)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">'+m.i+'</svg>'
      +'</div>'
      +'<div style="font-size:14px;font-weight:600;color:var(--ink)">'+esc(m.l)+'</div>'
      +'</div>';
  });
  html+='</div><div style="height:max(20px,env(safe-area-inset-bottom,20px))"></div>';
  showQuickSheet(html);
}

async function submitSignalement(context,targetId,targetName,motif,motifLabel){
  closeQuickSheet();
  if(!user)return;
  var ctxLabels={prof:t('ctx_prof'),eleve:t('ctx_eleve'),message:t('ctx_message')};
  var body='[Signalement — '+(ctxLabels[context]||context)+'] '+motifLabel
    +(targetName?'\nConcerné(e) : '+targetName:'')
    +(targetId?'\nID : '+targetId:'')
    +'\nSignalé par : '+(user.em||'')+'  (ID: '+user.id+')';
  try{
    await fetch(API+'/contact',{method:'POST',headers:apiH(),body:JSON.stringify({
      email:user.em||'noreply@courspool.app',
      sujet:'Signalement',message:body,
      nom:((user.pr||'')+' '+(user.nm||'')).trim()||'Utilisateur',
      role:user.role||'',user_id:user.id
    })});
    haptic(12);
    toast('Signalement envoyé','Notre équipe va examiner ce contenu. Merci.');
  }catch(e){toast('Erreur',"Impossible d'envoyer le signalement");}
}

// ---- Quick sheet helper ----
function showQuickSheet(html){
  var bd=document.getElementById('bdQuickSheet');
  if(!bd){
    bd=document.createElement('div');bd.id='bdQuickSheet';
    bd.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center';
    bd.onclick=function(e){if(e.target===bd)closeQuickSheet();};
    var inner=document.createElement('div');
    inner.id='bdQuickSheetInner';
    inner.style.cssText='background:var(--wh);border-radius:24px 24px 0 0;width:100%;max-width:480px;overflow-y:auto;animation:mi .28s cubic-bezier(.32,0,.67,0)';
    bd.appendChild(inner);document.body.appendChild(bd);
  }
  var inner=document.getElementById('bdQuickSheetInner');
  if(inner)inner.innerHTML=html;
  bd.style.display='flex';document.body.style.overflow='hidden';
}
function closeQuickSheet(){
  var bd=document.getElementById('bdQuickSheet');
  if(bd){bd.style.display='none';document.body.style.overflow='';}
}
function openRemboursements(){
  closeSettings();
  goAccount();
  setTimeout(function(){
    var t=g('aTabRmb');
    if(t)switchATab('Rmb',t);
  },200);
}
function closeSettings(){
  var bd=document.getElementById('bdSettings');
  if(bd){bd.classList.remove('on');document.body.style.overflow='';}
}

// ── i18n — applyLang, sélecteur de langue ─────────────────────────────────
var _LANG_NAMES={fr:'Français',en:'English',es:'Español',de:'Deutsch',it:'Italiano',pt:'Português',da:'Dansk',fi:'Suomi',sv:'Svenska',pl:'Polski',el:'Ελληνικά'};
var _LANG_FLAGS={fr:'🇫🇷',en:'🇬🇧',es:'🇪🇸',de:'🇩🇪',it:'🇮🇹',pt:'🇵🇹',da:'🇩🇰',fi:'🇫🇮',sv:'🇸🇪',pl:'🇵🇱',el:'🇬🇷'};

function applyLangDOM(){
  document.querySelectorAll('[data-i18n]').forEach(function(el){
    el.textContent=t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el){
    el.placeholder=t(el.getAttribute('data-i18n-ph'));
  });
  document.documentElement.lang=window._i18nLang||'fr';
  var lbl=document.getElementById('currentLangLabel');
  if(lbl)lbl.textContent=(_LANG_FLAGS[window._i18nLang]||'')+' '+(_LANG_NAMES[window._i18nLang]||'Français');
}

function applyLang(){
  // Fondu + rechargement complet pour appliquer la langue partout
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:var(--wh,#fff);z-index:99999;opacity:0;transition:opacity .35s ease;display:flex;align-items:center;justify-content:center';
  ov.innerHTML='<svg width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="#FF6B2B" stroke-width="3" stroke-dasharray="60" stroke-dashoffset="60" stroke-linecap="round"><animate attributeName="stroke-dashoffset" from="60" to="0" dur=".5s" fill="freeze"/></svg>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.opacity='1';
    setTimeout(function(){window.location.reload();},380);
  });
}

function openLangPicker(){
  var bd=document.getElementById('bdLangPicker');
  if(!bd)return;
  var list=document.getElementById('langPickerList');
  if(list){
    var cur=window._i18nLang||'fr';
    list.innerHTML=Object.keys(_LANG_NAMES).map(function(code){
      var active=code===cur;
      return'<div onclick="setLang(\''+code+'\');closeLangPicker()" style="display:flex;align-items:center;gap:12px;padding:14px 20px;cursor:pointer;border-bottom:1px solid var(--bdr);-webkit-tap-highlight-color:transparent">'
        +'<span style="font-size:20px">'+_LANG_FLAGS[code]+'</span>'
        +'<div style="flex:1;font-size:15px;font-weight:'+(active?'700':'500')+';color:'+(active?'var(--or)':'var(--ink)')+'">'+_LANG_NAMES[code]+'</div>'
        +(active?'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="2.5" stroke-linecap="round" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>':'')
        +'</div>';
    }).join('');
  }
  bd.style.display='flex';
  requestAnimationFrame(function(){bd.classList.add('on');});
}

function closeLangPicker(){
  var bd=document.getElementById('bdLangPicker');
  if(bd){bd.classList.remove('on');setTimeout(function(){bd.style.display='none';},300);}
}

// ════ SMART SEARCH (stub — overlay supprimé) ════
var _ssGeoActive=false;
var _ssTimer=null;
function openSmartSearch(){}
function closeSmartSearch(){}
function _ssToggleMatiere(){}
function _ssEnsureMatiereOpen(){}
function _ssSelectMatiere(){}
function _ssUpdateMatLabel(){}
function _ssSearch(){}
function _ssClearAll(){}
function _ssRequestGeoloc(){}
function _ssOnMatiereInput(){}
function _ssPickMatiere(){}
function _ssSubmitCode(){}
function _setSearchTab(){}
function _ssOnInput(val){var m=g('mobSearchInput');if(m)m.value=val;var s=g('srch');if(s)s.value=val;clearTimeout(_ssTimer);_ssTimer=setTimeout(function(){currentPage=1;applyFilter();},250);}
function _ssOnClear(){var m=g('mobSearchInput');if(m)m.value='';var s=g('srch');if(s)s.value='';currentPage=1;applyFilter();}
function _ssUpdateResultCount(){}
function _ssBuildSuggestions(){}
function _ssUseGeoloc(){}
function _ssOnFocus(){}

function _updateSearchPill(val,sub){
  var main=g('searchPillMain'),subEl=g('searchPillSub'),clr=g('searchPillClear');
  if(val){
    if(main){main.textContent=val;main.style.color='#222';}
    if(subEl){subEl.textContent=sub||'Matière · Professeur · Code privé';subEl.style.display='block';}
    if(clr)clr.style.display='flex';
    var pill=g('searchPill');
    if(pill)pill.style.boxShadow='0 2px 8px rgba(232,97,26,.18),0 0 0 1.5px rgba(232,97,26,.35)';
  } else {
    if(main){main.textContent='Que cherches-tu ?';main.style.color='#222';}
    if(subEl){subEl.textContent='Matière · Professeur · Code privé';subEl.style.display='block';}
    if(clr)clr.style.display='none';
    var pill2=g('searchPill');
    if(pill2)pill2.style.boxShadow='0 2px 8px rgba(0,0,0,.10),0 0 0 0.5px rgba(0,0,0,.07)';
  }
}

function clearSearchPill(){
  var mobInp=g('mobSearchInput');if(mobInp)mobInp.value='';
  var srch=g('srch');if(srch)srch.value='';
  _updateSearchPill('');
  actLoc='';geoMode=false;userCoords=null;_geoActive=false;_ssGeoActive=false;
  var li=g('locInput');if(li)li.value='';
  var lcb=g('locClearBtn');if(lcb)lcb.style.display='none';
  currentPage=1;applyFilter();
}

// ════ ALL FILTERS SHEET ════
function openAllFiltersSheet(){
  var el=g('bdAllFilters');if(!el)return;
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.style.display='flex';
  document.body.style.overflow='hidden';
  _afSyncState();
  haptic(4);
}
function closeAllFiltersSheet(){
  var el=g('bdAllFilters');if(el){el.style.display='none';document.body.style.overflow='';}
  _updateFiltersBadge();
}
function _afSyncState(){
  var mode=actMode||'';
  document.querySelectorAll('#afModeRow .af-pill').forEach(function(b){b.classList.toggle('on',(b.dataset.val||'')===mode);});
  var niv=actNiv||'';
  document.querySelectorAll('#afNivRow .af-pill').forEach(function(b){b.classList.toggle('on',(b.dataset.val||'')===niv);});
  document.querySelectorAll('#afSortRow .af-pill').forEach(function(b){b.classList.toggle('on',parseInt(b.dataset.val||0)===_sortIdx);});
  var vi=g('afVilleInput'),li=g('locInput');if(vi&&li)vi.value=li.value||'';
}
function afSetMode(val,el){
  actMode=val;
  var lbl=g('pillModeLabel'),pill=g('pillMode');
  var labels={'':t('filter_mode'),presentiel:t('filter_mode_pres'),visio:t('filter_mode_vis')};
  if(lbl)lbl.textContent=labels[val]||t('filter_mode');
  if(pill)pill.classList.toggle('on',!!val);
  document.querySelectorAll('#modeFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var _mfl=g('modeFilterList');
  if(_mfl){var chips=_mfl.querySelectorAll('.niv-fchip');chips.forEach(function(c){
    var cval=(c.querySelector('span')?c.querySelector('span').textContent.trim():'');
    if((val===''&&c===chips[0])||(val==='presentiel'&&cval.includes('résentiel'))||(val==='visio'&&cval.includes('isio')))c.classList.add('on');
  });}
  document.querySelectorAll('#afModeRow .af-pill').forEach(function(b){b.classList.toggle('on',(b.dataset.val||'')===val);});
  currentPage=1;applyFilter();_updateFiltersBadge();
}
function afSetNiv(val,el){
  actNiv=val;try{sessionStorage.setItem('cp_niv',val);}catch(e){}
  var lbl=g('pillNivLabel'),pill=g('pillNiv');
  if(lbl)lbl.textContent=val||t('filter_niveau');
  if(pill)pill.classList.toggle('on',!!val);
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var _nfl=g('nivFilterList');
  if(_nfl){var chips=_nfl.querySelectorAll('.niv-fchip');chips.forEach(function(c){if((val===''&&c===chips[0])||(val&&c.textContent.includes(val)))c.classList.add('on');});}
  document.querySelectorAll('#afNivRow .af-pill').forEach(function(b){b.classList.toggle('on',(b.dataset.val||'')===val);});
  currentPage=1;applyFilter();_updateFiltersBadge();
}
function afSetSort(idx,el){
  _sortIdx=idx%_sortModes.length;
  sortMode=_sortModes[_sortIdx];
  var lbl=g('sortLabel');if(lbl)lbl.textContent=_sortLabels[_sortIdx];
  var sb=g('sortBtn');if(sb){sb.style.background=_sortIdx===0?'':'var(--orp)';sb.style.color=_sortIdx===0?'':'var(--or)';}
  document.querySelectorAll('#afSortRow .af-pill').forEach(function(b){b.classList.toggle('on',parseInt(b.dataset.val||0)===_sortIdx);});
  currentPage=1;applyFilter();_updateFiltersBadge();
}
function afResetAll(){
  resetFilters();
  var vi=g('afVilleInput');if(vi)vi.value='';
  _afSyncState();
  _updateFiltersBadge();
}
function _updateFiltersBadge(){
  var count=0;
  if(actNiv)count++;if(actMode)count++;if(actLoc)count++;if(actDate)count++;
  if(_sortIdx&&_sortIdx!==0)count++;
  var badge=g('filtersBadge'),btn=g('filtersBtn');
  if(!badge)return;
  if(count>0){
    badge.textContent=count;badge.style.display='flex';
    if(btn){btn.style.borderColor='#E8611A';btn.style.background='rgba(232,97,26,.08)';}
  } else {
    badge.style.display='none';
    if(btn){btn.style.borderColor='';btn.style.background='';}
  }
}

// ---- Search clear ----
function clearSearch(){
  var inp=document.getElementById('mobSearchInput');
  var srch=document.getElementById('srch');
  var btn=document.getElementById('searchClearBtn');
  if(inp)inp.value='';if(srch)srch.value='';
  if(btn)btn.style.display='none';
  var _sas=g('searchAliasSuggestion');if(_sas)_sas.style.display='none';
  var _scs=g('searchCodeSuggestion');if(_scs)_scs.style.display='none';
  _pendingAlias=null;_pendingCode=null;
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
// ---- Swipe to close settings (handle seulement) ----
(function(){
  var startY=0,dragging=false;
  document.addEventListener('touchstart',function(e){
    // Ne démarrer que si le touch est sur le handle — pas sur le contenu scrollable
    if(e.target.closest('.settings-handle')){startY=e.touches[0].clientY;dragging=true;}
    else{dragging=false;}
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!dragging)return;dragging=false;
    var dy=e.changedTouches[0].clientY-startY;
    if(dy>60)closeSettings();
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

// ── Swipe gauche/droite pour navigation entre onglets ──────────────────────
function initSwipeNav(){
  var appEl=g('app');
  if(!appEl)return;
  var sx=0,sy=0,st=0,_touchTarget=null;
  var THRESH=60;   // px horizontal minimum pour déclencher
  var MAXVERT=70;  // px vertical max (sinon c'est un scroll)
  var MAXMS=380;   // durée max du geste (ms)

  function _isInsideHScroll(el){
    while(el&&el!==appEl){
      var ox=window.getComputedStyle(el).overflowX;
      if((ox==='scroll'||ox==='auto')&&el.scrollWidth>el.clientWidth+2)return true;
      el=el.parentElement;
    }
    return false;
  }

  function _tabOrder(){
    var t=['exp','fav','msg'];
    var bniMes=g('bniMes');
    if(bniMes&&bniMes.style.display!=='none')t.push('mes');
    var bniProfs=g('bniProfs');
    if(bniProfs&&bniProfs.style.display!=='none')t.push('profs');
    t.push('acc');
    return t;
  }

  function _curTab(){
    var map={pgExp:'exp',pgFav:'fav',pgMes:'mes',pgMsg:'msg',pgAcc:'acc',pgMesProfs:'profs'};
    for(var id in map){var el=g(id);if(el&&el.classList.contains('on'))return map[id];}
    return'exp';
  }

  function _anyOverlayOpen(){
    // Backdrop / sheet visible
    var bds=document.querySelectorAll('.bd');
    for(var i=0;i<bds.length;i++){
      var cs=window.getComputedStyle(bds[i]);
      if(cs.display!=='none'&&cs.visibility!=='hidden')return true;
    }
    // Modal avec classe .on
    if(document.querySelector('.modal.on'))return true;
    // pgHow visible
    var pgHow=g('pgHow');
    if(pgHow&&pgHow.style.display==='block')return true;
    return false;
  }

  appEl.addEventListener('touchstart',function(e){
    sx=e.touches[0].clientX;
    sy=e.touches[0].clientY;
    st=Date.now();
    _touchTarget=e.target;
  },{passive:true});

  appEl.addEventListener('touchend',function(e){
    if(!sx)return;
    var dx=e.changedTouches[0].clientX-sx;
    var dy=Math.abs(e.changedTouches[0].clientY-sy);
    var dt=Date.now()-st;
    sx=0;

    // Ignorer si trop court, trop vertical ou trop lent
    if(Math.abs(dx)<THRESH||dy>MAXVERT||dt>MAXMS)return;
    // Ignorer si le touch vient d'une zone scrollable horizontalement (ex: barre de filtres)
    if(_touchTarget&&_isInsideHScroll(_touchTarget))return;

    // Ignorer si focus sur un input
    var tag=document.activeElement&&document.activeElement.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;

    // pgHow ouvert → swipe droite = fermer
    var pgHow=g('pgHow');
    if(pgHow&&pgHow.style.display==='block'){
      if(dx>0){closeHow();haptic([10]);}
      return;
    }

    // Overlay/modal ouvert → ne pas naviguer
    if(_anyOverlayOpen())return;

    // Conversation messages ouverte → swipe droite = retour liste
    var pgMsgEl=g('pgMsg');
    if(pgMsgEl&&pgMsgEl.classList.contains('conv-open')){
      if(dx>0){closeMsgConv();haptic([10]);}
      return;
    }

    // Navigation entre onglets principaux
    var tabs=_tabOrder();
    var cur=_curTab();
    var idx=tabs.indexOf(cur);
    if(idx===-1)return;

    // Filtrer les onglets inaccessibles pour l'invité
    var _restricted=['fav','msg','mes','acc'];
    var isGuest=!user||(user&&user.guest);

    if(dx<0&&idx<tabs.length-1){
      var next=tabs[idx+1];
      if(isGuest&&_restricted.indexOf(next)!==-1)return;
      navTo(next);haptic([8]);
    }else if(dx>0&&idx>0){
      var prev=tabs[idx-1];
      if(isGuest&&_restricted.indexOf(prev)!==-1)return;
      navTo(prev);haptic([8]);
    }
  },{passive:true});
}

// ── Keyboard / visualViewport ──────────────────────────────────────────────
// Keeps the create-course sheet above the keyboard on iOS (visualViewport)
(function(){
  if(!window.visualViewport)return;
  function _onVpResize(){
    var kbH=Math.max(0,window.innerHeight-window.visualViewport.height-window.visualViewport.offsetTop);
    // Create-course sheet (#bdCr)
    var bdCr=g('bdCr');
    if(bdCr&&bdCr.classList.contains('on')){
      bdCr.style.paddingBottom=kbH>30?kbH+'px':'0px';
    }
  }
  window.visualViewport.addEventListener('resize',_onVpResize,{passive:true});
  window.visualViewport.addEventListener('scroll',_onVpResize,{passive:true});
})();

// ── Message pane keyboard avoidance (Capacitor keyboardWillShow/Hide) ───────
// visualViewport ne se réduit pas sur iOS WKWebView : on utilise les events Capacitor
(function(){
  function _msgKbShow(e){
    var kbH=(e&&e.keyboardHeight)||0;if(kbH<=0)return;
    var mp=g('msgConvPane');if(!mp||mp.style.display!=='flex')return;
    mp.style.bottom=kbH+'px';
    mp.style.transition='bottom .22s ease';
    // Scroll messages to bottom so last message stays visible
    var msgs=g('msgMessages');if(msgs)setTimeout(function(){msgs.scrollTop=msgs.scrollHeight;},80);
  }
  function _msgKbHide(){
    var mp=g('msgConvPane');if(!mp)return;
    mp.style.bottom='0px';
    mp.style.transition='bottom .18s ease';
  }
  window.addEventListener('keyboardWillShow',_msgKbShow);
  window.addEventListener('keyboardWillHide',_msgKbHide);
})();

// ── Pull-to-refresh ────────────────────────────────────────────────────────
(function(){
  var _ptrStartY=0,_ptrCurY=0,_ptrActive=false,_ptrTriggered=false;
  var THRESHOLD=72; // px à tirer avant le déclenchement

  function _pgExpVisible(){
    var pg=g('pgExp');return pg&&pg.classList.contains('on');
  }
  function _isAtTop(){
    var app=g('app');return !app||app.scrollTop===0;
  }
  function _showPtrIndicator(ratio){
    var ind=g('ptrIndicator'),sp=g('ptrSpinner');
    if(!ind)return;
    ind.style.opacity=Math.min(ratio,1).toFixed(2);
    var tr=Math.min(ratio*THRESHOLD,THRESHOLD)+'px';
    ind.style.transform='translateY('+tr+')';
    if(sp&&ratio>=1&&!sp.classList.contains('spinning'))sp.classList.add('spinning');
    else if(sp&&ratio<1)sp.classList.remove('spinning');
  }
  function _hidePtrIndicator(){
    var ind=g('ptrIndicator'),sp=g('ptrSpinner');
    if(ind){ind.style.opacity='0';ind.style.transform='';}
    if(sp)sp.classList.remove('spinning');
  }

  document.addEventListener('touchstart',function(e){
    if(!_pgExpVisible()||!_isAtTop())return;
    _ptrStartY=e.touches[0].clientY;
    _ptrActive=true;_ptrTriggered=false;
  },{passive:true});

  document.addEventListener('touchmove',function(e){
    if(!_ptrActive)return;
    _ptrCurY=e.touches[0].clientY;
    var dy=_ptrCurY-_ptrStartY;
    if(dy<=0){_hidePtrIndicator();return;}
    // Resistance rubber-band: pull feels heavier as it goes
    var pull=dy*0.45;
    _showPtrIndicator(pull/THRESHOLD);
  },{passive:true});

  document.addEventListener('touchend',function(){
    if(!_ptrActive)return;
    _ptrActive=false;
    var dy=(_ptrCurY-_ptrStartY)*0.45;
    if(dy>=THRESHOLD&&!_ptrTriggered){
      _ptrTriggered=true;
      haptic([10,30,10]);
      var ind=g('ptrIndicator');
      if(ind){ind.style.opacity='1';ind.style.transform='translateY('+THRESHOLD+'px)';}
      loadData().then(function(){
        buildCards();
        _hidePtrIndicator();
        toast('Actualisé','');
      }).catch(function(){_hidePtrIndicator();});
    } else {
      _hidePtrIndicator();
    }
    _ptrStartY=0;_ptrCurY=0;
  },{passive:true});
})();

// Render filter bar once all variables are initialized
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',renderFilterBar);}
else{renderFilterBar();}

// ── NAV DRAGGABLE (iPad / desktop ≥769px) ──────────────────────────────────
function initNavDrag(){
  var nav=g('bnav');
  if(!nav||window.innerWidth<769)return;
  // Position initiale
  var saved={};try{saved=JSON.parse(localStorage.getItem('cp_nav_pos')||'{}');}catch(e){}
  setTimeout(function(){
    var sw=window.innerWidth,sh=window.innerHeight;
    var nw=nav.offsetWidth||340,nh=nav.offsetHeight||64;
    var defX=Math.max(0,(sw-nw)/2),defY=sh-nh-28;
    var x=saved.x!==undefined?Math.min(Math.max(0,saved.x),sw-nw):defX;
    var y=saved.y!==undefined?Math.min(Math.max(0,saved.y),sh-nh):defY;
    nav.style.left=x+'px';nav.style.top=y+'px';
  },120);
  var d={on:false,sx:0,sy:0,sl:0,st:0,moved:false};
  function start(cx,cy){
    d.on=true;d.moved=false;d.sx=cx;d.sy=cy;d.sl=nav.offsetLeft;d.st=nav.offsetTop;
    nav.style.transition='none';
    nav.style.boxShadow='0 12px 40px rgba(0,0,0,.28),0 4px 12px rgba(0,0,0,.16)';
    nav.style.opacity='0.88';
  }
  function move(cx,cy){
    if(!d.on)return;
    var dx=cx-d.sx,dy=cy-d.sy;
    if(Math.abs(dx)>5||Math.abs(dy)>5)d.moved=true;
    if(!d.moved)return;
    var sw=window.innerWidth,sh=window.innerHeight;
    nav.style.left=Math.max(0,Math.min(sw-nav.offsetWidth,d.sl+dx))+'px';
    nav.style.top=Math.max(0,Math.min(sh-nav.offsetHeight,d.st+dy))+'px';
  }
  function end(){
    if(!d.on)return;d.on=false;nav.style.opacity='';
    if(d.moved){snapNavPill(nav);}else{nav.style.boxShadow='';}
  }
  nav.addEventListener('mousedown',function(e){start(e.clientX,e.clientY);});
  document.addEventListener('mousemove',function(e){move(e.clientX,e.clientY);});
  document.addEventListener('mouseup',end);
  nav.addEventListener('touchstart',function(e){if(e.touches.length===1)start(e.touches[0].clientX,e.touches[0].clientY);},{passive:true});
  document.addEventListener('touchmove',function(e){if(d.on&&d.moved)e.preventDefault();if(e.touches.length)move(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  document.addEventListener('touchend',end);
  // Bloquer le click sur les enfants si c'était un drag
  nav.addEventListener('click',function(e){if(d.moved){e.stopPropagation();e.preventDefault();}},true);
}
function snapNavPill(nav){
  var sw=window.innerWidth,sh=window.innerHeight;
  var rect=nav.getBoundingClientRect();
  var cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  var newL=rect.left,newT=rect.top;
  if(cy>sh*0.58){
    newT=sh-rect.height-28;
    if(cx>sw*0.25&&cx<sw*0.75)newL=(sw-rect.width)/2;
  } else if(cx<sw*0.35){
    newL=16;
  } else if(cx>sw*0.65){
    newL=sw-rect.width-16;
  } else {
    newT=80;newL=(sw-rect.width)/2;
  }
  newL=Math.max(8,Math.min(sw-rect.width-8,newL));
  newT=Math.max(8,Math.min(sh-rect.height-8,newT));
  nav.style.transition='left .35s cubic-bezier(.34,1.56,.64,1),top .35s cubic-bezier(.34,1.56,.64,1),box-shadow .2s,opacity .15s';
  nav.style.left=newL+'px';nav.style.top=newT+'px';nav.style.boxShadow='';
  try{localStorage.setItem('cp_nav_pos',JSON.stringify({x:newL,y:newT}));}catch(e){}
}
// Lancer le drag dès que la bnav devient visible (class 'on')
(function(){
  if(window.innerWidth<769)return;
  var _done=false;
  var _obs=new MutationObserver(function(){
    var nav=g('bnav');
    if(nav&&nav.classList.contains('on')&&!_done){_done=true;_obs.disconnect();setTimeout(initNavDrag,150);}
  });
  var nav=g('bnav');
  if(nav)_obs.observe(nav,{attributes:true,attributeFilter:['class']});
})();

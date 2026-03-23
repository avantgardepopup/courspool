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

// Lancer l'onboarding au chargement
window.addEventListener('DOMContentLoaded',function(){
  initDarkMode();
  initLargeTitle();
  // Masquer le splash après chargement
  setTimeout(function(){
    var sp=document.getElementById('splash');
    if(sp){sp.style.opacity='0';setTimeout(function(){sp.style.display='none';},500);}
  }, 800);
});

var API='https://devoted-achievement-production-fdfa.up.railway.app';

// ── Authentification JWT ──────────────────────────────────────
// Le token est stocké en mémoire (pas localStorage) pour limiter l'exposition.
// NOTE BACKEND : /auth/login et /auth/register doivent retourner { token: "..." }
var _authToken=null;

function setToken(t){_authToken=t||null;}

// Retourne les headers à utiliser pour tous les appels API authentifiés
function authHeaders(extra){
  var h=Object.assign({'Content-Type':'application/json'},extra||{});
  if(_authToken)h['Authorization']='Bearer '+_authToken;
  return h;
}

// Échappement HTML — protège tous les innerHTML contre les injections XSS
function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// Avatar — affiche une photo ou un rond avec initiales
function setAvatar(el,photo,ini,col){
  if(!el)return;
  if(photo){
    el.style.background='none';
    el.innerHTML='<img src="'+esc(photo)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  }else{
    el.style.background=col||'linear-gradient(135deg,#FF8C55,var(--ord))';
    el.textContent=ini||'?';
  }
}

var C=[],P={},res={},fol=new Set();
var curId=null,curProf=null,folPr=null,actF='tous',user=null;
var geoMode=false,userCoords=null,_geoActive=false,_geoCoords=null,_geoDist=10;
var PAGE_SIZE=6,currentPage=1,filteredCards=[];

// LOAD DATA
function showSkeletons(){
  var grid=g('grid');
  if(!grid)return;
  grid.innerHTML=Array(6).fill(0).map(function(){
    return'<div class="skel-card"><div class="skeleton skel-top"></div><div class="skel-body"><div class="skeleton skel-line w80"></div><div class="skeleton skel-line w60"></div><div class="skeleton skel-line w40"></div></div></div>';
  }).join('');
}

var _allLoaded=false,_totalCours=0,_currentPage=1,_loadingMore=false;

async function loadData(page){
  page=page||1;
  if(page===1)showSkeletonsV2();
  try{
    var r=await fetch(API+'/cours?page='+page+'&limit=20');
    var json=await r.json();
    // Support ancien format (array) et nouveau (objet paginé)
    var cours=Array.isArray(json)?json:(json.cours||[]);
    _totalCours=json.total||cours.length;
    _allLoaded=cours.length<20||(_currentPage*20)>=_totalCours;
    if(!cours.length&&page===1){
      // Retry après 4s si vide (serveur qui se réveille)
      setTimeout(function(){loadData(1).then(function(){buildCards();});},4000);
      C=[];return;
    }
    var mapped=cours.map(function(c){
      return{
        id:c.id,
        t:((c.titre||'')+' '+(c.sujet||'')+' '+(c.prof_nom||'')+' '+(c.lieu||'')).toLowerCase(),
        subj:c.sujet||'Autre',
        sc:(function(){var m=findMatiere(c.sujet||'');return m?m.color:(c.couleur_sujet||'#7C3AED');}()),
        bg:(function(){var m=findMatiere(c.sujet||'');return m?m.bg:(c.background||'linear-gradient(135deg,#F5F3FF,#DDD6FE)');}()),
        bgDark:(function(){var m=findMatiere(c.sujet||'');return m&&m.bgDark?m.bgDark:'linear-gradient(135deg,#1A1A2E,#16213E)';}()),
        title:c.titre||'',dt:c.date_heure||'',lc:c.lieu||'',
        tot:c.prix_total||0,sp:c.places_max||5,fl:c.places_prises||0,
        pr:c.professeur_id,em:c.emoji||'📚',
        prof_ini:c.prof_initiales||'?',
        prof_col:c.prof_couleur||'linear-gradient(135deg,#FF8C55,#E04E10)',
        prof_nm:c.prof_nom||'Professeur',
        prof_photo:c.prof_photo||null,
        description:c.description||'',
        prive:c.prive||false,
        code:c.code_acces||''
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
        P[c.pr].nm=c.prof_nm||P[c.pr].nm;
        P[c.pr].col=c.prof_col||P[c.pr].col;
        // Priorité : photo locale (user.photo) > photo serveur > photo cache
        if(isMe)P[c.pr].photo=user.photo||c.prof_photo||P[c.pr].photo;
        else if(c.prof_photo&&!P[c.pr].photo)P[c.pr].photo=c.prof_photo;
      }
    });
  }catch(e){console.log('loadData err',e);}
}

// AUTH
function switchLT(t){g('ltC').classList.toggle('on',t==='C');g('ltI').classList.toggle('on',t==='I');g('lfC').classList.toggle('on',t==='C');g('lfI').classList.toggle('on',t==='I');}
function pickRole(r){g('rEl').classList.toggle('on',r==='El');g('rPf').classList.toggle('on',r==='Pf');g('profFields').style.display=r==='Pf'?'block':'none';}

async function doLogin(){
  var em=g('lEm').value.trim(),pw=g('lPw').value;
  if(!em||!pw){shake('lfC');return;}
  g('lEm').disabled=true;g('lPw').disabled=true;
  try{
    var r=await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);shake('lfC');return;}
    // Stocker le JWT retourné par le backend (si présent)
    if(data.token)setToken(data.token);
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
      verified:p.verified||false,
      cni_uploaded:p.cni_uploaded||false,
      statut:p.statut||'',
      niveau:p.niveau||'',
      matieres:p.matieres||''
    };
    try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
    applyUser();
    // Vider les réservations et follows précédents, recharger depuis la DB
    Object.keys(res).forEach(function(k){delete res[k];});
    fol.clear();
    if(uid){
      Promise.all([
        fetch(API+'/reservations/'+uid).then(function(r){return r.json();}).catch(function(){return [];}),
        fetch(API+'/follows/'+uid).then(function(r){return r.json();}).catch(function(){return [];})
      ]).then(function(results){
        var resData=results[0],folData=results[1];
        if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});}
        if(Array.isArray(folData)){folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});}
        loadData().then(function(){restoreFilters();buildCards();});
      }).catch(function(){loadData().then(function(){buildCards();});});
    } else {
      loadData().then(function(){buildCards();});
    }
    toast('Bienvenue '+pr+' !','Connecté à CoursPool');
    // Lancer tuto — si prof sans CNI, délégué à après la modal CNI
    if(role!=='professeur'){setTimeout(tutoStart,1200);}
  }catch(e){toast('Erreur','Impossible de se connecter');}
  finally{g('lEm').disabled=false;g('lPw').disabled=false;}
}

async function doReg(){
  var pr=g('rPr').value.trim(),nm=g('rNm').value.trim(),em=g('rEm').value.trim(),pw=g('rPw').value;
  var role=g('rPf').classList.contains('on')?'professeur':'eleve';
  if(!pr||!em||!pw){shake('lfI');return;}
  if(pw.length<6){toast('Erreur','Mot de passe trop court (6 min)');return;}
  var extra={};
  if(role==='professeur'){
    var statut=g('rStatut').value;
    if(!statut){toast('Statut manquant','Choisissez votre statut');return;}
    extra.statut=statut;extra.niveau=g('rNiveau').value||'';extra.matieres=g('rMatiere').value||'';
  }
  try{
    var body=Object.assign({email:em,password:pw,prenom:pr,nom:nm,role:role},extra);
    var r=await fetch(API+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);shake('lfI');return;}
    if(data.token)setToken(data.token);
    if(role==='professeur'){
      var uid=data.user.id;
      // Connecter directement sans message intermédiaire
      go(pr,nm,em,role,uid);
      setTimeout(tutoStart,1200);
    }else{go(pr,nm,em,role,data.user.id);setTimeout(tutoStart,1200);}
  }catch(e){toast('Erreur','Impossible de créer le compte');}
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
  var bniMsg=g('bniMsg'),bniAcc=g('bniAcc'),bniAdd=g('bniAdd');
  if(bniMsg)bniMsg.style.display='none';  // Messages inutile sans compte
  if(bniAcc)bniAcc.style.display='flex';  // Profil = bouton "Se connecter"
  if(bniAdd)bniAdd.style.display='none';
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

function go(pr,nm,em,role,uid,photoUrl){
  user={pr:pr,nm:nm,em:em,role:role||'eleve',id:uid,ini:((pr&&pr[0]?pr[0]:'')+(nm&&nm[0]?nm[0]:'')).toUpperCase()||'U',photo:photoUrl||null};
  try{localStorage.setItem('cp_user',JSON.stringify(user));}catch(e){}
  applyUser();
  loadData().then(function(){buildCards();});
  toast('Bienvenue '+pr+' !','Connecté à CoursPool');
}

function applyUser(){
  var _l=g('login');_l.style.display='none';_l.style.pointerEvents='none';_l.style.zIndex='-1';g('app').style.display='block';
  // Greeting dynamique
  try{
    var h=new Date().getHours();
    var greet=h<6?'Bonne nuit':h<12?'Bonjour':h<18?'Bonjour':h<22?'Bonsoir':'Bonne nuit';
    var mobT=g('mobTitle'),mobS=g('mobSub');
    if(mobT)mobT.textContent=user&&user.pr?greet+' '+user.pr+' 👋':greet+' 👋';
    if(mobS){var msgs=['Cours près de vous','Que voulez-vous apprendre ?','Trouvez votre prochain cours'];mobS.textContent=msgs[Math.floor(Math.random()*msgs.length)];}
  }catch(e){}
  var tav=g('tav');
  setAvatar(tav,user.photo,user.ini);
  g('btnProposer').style.display=user.role==='professeur'?'flex':'none';
  // Banner géré par updateVerifBand() uniquement
  // Bottom nav — restaurer tous les items avant d'appliquer le rôle
  var bniMsg2=g('bniMsg'),bniAcc2=g('bniAcc');
  if(bniMsg2)bniMsg2.style.display=(user&&!user.guest)?'':'none';
  if(bniAcc2)bniAcc2.style.display='';
  g('bnav').classList.add('on');
  var bniAdd=g('bniAdd');if(bniAdd)bniAdd.style.display=user.role==='professeur'?'flex':'none';
  // Sync mobile header
  var tavMob=g('tavMob');
  setAvatar(tavMob,user.photo,user.ini||'?');
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
    setInterval(function(){
      if(!user||!user.id)return;
      fetch(API+'/conversations/'+user.id).then(function(r){return r.json();}).then(function(msgs){
        if(!Array.isArray(msgs))return;
        var convs={},nonLus=0;
        msgs.forEach(function(m){var otherId=m.sender_id===user.id?m.receiver_id:m.sender_id;if(!otherId||otherId===user.id)return;if(!convs[otherId]||new Date(m.created_at)>new Date(convs[otherId].created_at))convs[otherId]=m;});
        Object.keys(convs).forEach(function(id){if(!convs[id].lu&&convs[id].sender_id!==user.id)nonLus++;});
        updateMsgBadge(nonLus);
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
  if(user)setAvatar(g('tavMob'),user.photo,user.ini||'?');
  // Cacher mob-header sur la page messages (la conv a son propre header)
  var mh=g('mobHeader');
  if(mh)mh.style.display=tab==='msg'?'none':'block';
}

function navTo(tab){
  // Toujours fermer la conv active et s'assurer que la nav est visible
  var convPane=g('msgConvPane');
  if(convPane&&tab!=='msg')convPane.style.display='none';
  var pgMsgEl=g('pgMsg');
  if(pgMsgEl&&tab!=='msg')pgMsgEl.classList.remove('conv-open');
  clearInterval(msgPollTimer);if(tab!=='msg'){msgPollTimer=null;}

  ['bniExp','bniMsg','bniAcc'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg');
  if(pgExp)pgExp.classList.remove('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  updateMobHeader(tab);
  var nav=g('bnav');

  if(tab==='exp'){
    if(pgExp)pgExp.classList.add('on');
    var bExp=g('bniExp');if(bExp)bExp.classList.add('on');
    var br=g('btnRefresh');if(br)br.style.display=user?'flex':'none';
    restoreNav();
  } else if(tab==='msg'){
    if(!user){navTo('exp');return;}
    // Guest → proposer de se connecter sans brutalité
    if(user.guest){
      toast('Connectez-vous pour accéder aux messages','');
      setTimeout(scrollToLogin, 800);
      return;
    }
    if(pgMsg)pgMsg.classList.add('on');
    if(nav){var isMob=window.innerWidth<=640;if(!isMob){nav.style.left='20px';nav.style.transform='none';nav.style.padding='8px 12px';}else{nav.style.left='';nav.style.transform='';nav.style.padding='';}}
    var bniExp=g('bniExp');
    if(bniExp){
      bniExp.classList.add('on');
      bniExp.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg><span>Retour</span>';
      bniExp.onclick=function(){navTo('exp');};
    }
    ['bniMsg','bniAcc','bniAdd','bniSepAdd'].forEach(function(id){var e=g(id);if(e)e.style.display='none';});
  
    var br3=g('btnRefresh');if(br3)br3.style.display='none'; // messages: refresh masqué
    loadConversations();
  } else if(tab==='acc'){
    if(!user){navTo('exp');return;}
    // Guest clique sur Profil → invitation douce à se connecter
    if(user.guest){
      var bd=g('bdLoginPrompt');
      if(bd){
        // Personnaliser le message pour le profil
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
    var br2=g('btnRefresh');if(br2)br2.style.display='none'; // acc: refresh masqué
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
  if(nav){
    var isMobile=window.innerWidth<=640;
    if(isMobile){
      // Sur mobile : tout géré par CSS, on ne touche à rien sauf display
      nav.style.left='';nav.style.transform='';nav.style.padding='';
    } else {
      nav.style.left='50%';nav.style.transform='translateX(-50%)';nav.style.padding='8px 12px';
    }
    if(user)nav.style.display='flex';
  }
  // Restaurer le bouton Explorer
  var bniExp=g('bniExp');
  if(bniExp){
    bniExp.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Explorer</span>';
    bniExp.onclick=function(){navTo('exp');};
  }
  // Réafficher tous les items
  var bniMsg=g('bniMsg');if(bniMsg)bniMsg.style.display=(user&&user.guest)?'none':'';
  var bniAcc=g('bniAcc');if(bniAcc)bniAcc.style.display='';
  if(user&&user.role==='professeur'){var bniAdd=g('bniAdd');if(bniAdd){bniAdd.style.display='flex';var sep=g('bniSepAdd');if(sep)sep.style.display='';}}
  // bni-sep supprimés de la nav
}

function goExplore(){
  var pgExp=g('pgExp'),pgAcc=g('pgAcc'),pgMsg=g('pgMsg');
  if(pgExp)pgExp.classList.add('on');
  if(pgAcc)pgAcc.classList.remove('on');
  if(pgMsg)pgMsg.classList.remove('on');
  ['bniExp','bniMsg','bniAcc'].forEach(function(id){var b=g(id);if(b)b.classList.remove('on');});
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
        // Charger les cours en arrière-plan pour que l'app soit prête
        loadData();
        // Rester sur l'écran login — l'utilisateur devra cliquer "Continuer sans compte"
        return;
      }
      // Utilisateur connecté → restaurer la session
      user=parsedUser;
      applyUser();
      if(user.id){
        Promise.all([
          fetch(API+'/reservations/'+user.id).then(function(r){return r.json();}).catch(function(){return [];}),
          fetch(API+'/follows/'+user.id).then(function(r){return r.json();}).catch(function(){return [];})
        ]).then(function(results){
          var resData=results[0],folData=results[1];
          Object.keys(res).forEach(function(k){delete res[k];});
          if(Array.isArray(resData)){resData.forEach(function(r){if(r.cours_id)res[r.cours_id]=true;});}
          fol.clear();
          if(Array.isArray(folData)){folData.forEach(function(f){if(f.professeur_id)fol.add(f.professeur_id);});}
          // Si l'onglet Suivis est actif, re-render maintenant que fol est chargé
          if(g('asecF')&&g('asecF').classList.contains('on'))buildAccLists();
          loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();checkProfDeepLink();setTimeout(checkCoursANoter,3000);});
        }).catch(function(){loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();});});
      } else {
        loadData().then(function(){buildCards();checkStripeReturn();checkPrivateCoursAccess();});
      }
    } else {
      // Pas de session → écran login, charger les cours en arrière-plan
      loadData();
    }
  }catch(e){loadData();}
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
        var c=C.find(function(x){return x.id===directCours;});
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
  g('pgExp').classList.remove('on');g('pgMsg').classList.remove('on');g('pgAcc').classList.add('on');
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
  // Onglet Revenus visible uniquement pour les profs
  var tabRev = g('aTabRev');
  if(tabRev)tabRev.style.display=(user&&user.role==='professeur')?'flex':'none';
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
  if(s==='F'||s==='R'){
    // Double appel : immédiat + après 300ms pour couvrir le cas
    // où fol n'est pas encore chargé (compte prof plus lent)
    buildAccLists();
    setTimeout(buildAccLists, 300);
  }
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
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">'+nbCours+'</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Cours</div></div>'+
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">'+rIds.length+'</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Élèves</div></div>'+
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">—</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Note</div></div>';
    } else {
      stats.innerHTML=
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">'+rIds.length+'</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Réservés</div></div>'+
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">'+fIds.length+'</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Suivis</div></div>'+
        '<div style="background:rgba(255,255,255,.15);padding:12px 6px;text-align:center"><div style="font-size:22px;font-weight:800;color:#fff">0</div><div style="font-size:10px;color:rgba(255,255,255,.75);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Total</div></div>';
    }
  }
  // Rôle pill
  var rp=g('accRolePill');
  if(rp)rp.textContent=isProf?'👨‍🏫 Professeur':'👤 Élève';
  var lr=g('listR');
  if(!rIds.length){lr.innerHTML='<div style="text-align:center;padding:40px 20px">'
    +'<div style="width:64px;height:64px;background:var(--orp);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="28" height="28"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>'
    +'</div>'
    +'<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun cours à venir</div>'
    +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:20px">Réservez votre premier cours<br>et retrouvez-le ici</div>'
    +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
    +'</div>';}
  else{
    var now=new Date();
    lr.innerHTML=rIds.map(function(id){
      var c=C.find(function(x){return x.id===id});if(!c)return'';
      // Le cours est passé si created_at + durée est dépassé
      // On compare simplement avec la date stockée dans c.dt
      // Format: "dim. 15 mars · 04:30" - on considère passé si la date du cours < maintenant
      var isPast=false;
      try{
        // Extraire l'heure
        var heureMatch=c.dt.match(/(\d{1,2}):(\d{2})$/);
        if(heureMatch){
          var today=new Date();
          var coursDate=new Date(c.created_at||now);
          // Si cours créé il y a plus de 24h et heure passée = cours terminé
          var diffMs=now-new Date(c.created_at||now);
          isPast=diffMs>24*60*60*1000;
        }
      }catch(e){}
      var noteBtn=isPast&&user&&user.role!=='professeur'?
        '<button onclick="event.stopPropagation();openNote(C.find(function(x){return x.id===\''+c.id+'\'}))" style="background:var(--orp);color:var(--or);border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;margin-left:6px">⭐ Noter</button>':'';
      var _mf=findMatiere(c.subj||'');
      var _dc=_mf?_mf.color:'var(--or)';
      var _ph=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;
      var _phHtml=_ph?'<img src="'+_ph+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':'<span style="font-size:10px;font-weight:700;color:#fff">'+( c.prof_ini||'?')+'</span>';
      return'<div class="rrow" onclick="openR(\''+c.id+'\')" style="cursor:pointer;align-items:flex-start">'
        +'<div style="width:44px;height:44px;border-radius:12px;background:'+( _mf?_mf.bg:'var(--orp)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:10px;height:10px;border-radius:50%;background:'+_dc+'"></div></div>'
        +'<div class="ri" style="flex:1;min-width:0">'
        +'<div class="rt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.title+'</div>'
        +'<div style="display:flex;align-items:center;gap:5px;margin-top:3px">'
        +'<div style="width:16px;height:16px;border-radius:50%;background:'+( _ph?'none':'linear-gradient(135deg,#FF8C55,var(--ord))')+';display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0" data-prof="'+c.pr+'">'+_phHtml+'</div>'
        +'<span style="font-size:12px;color:var(--mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.prof_nm+'</span>'
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:10px;margin-top:5px;flex-wrap:wrap">'
        +'<span style="display:flex;align-items:center;gap:3px;font-size:11.5px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+c.dt+'</span>'
        +'<span style="display:flex;align-items:center;gap:3px;font-size:11.5px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+c.lc+'</span>'
        +'</div>'
        +'</div>'
        +(isPast?'<span class="rbadge bdone">Terminé</span>':'<span class="rbadge bup">À venir</span>')
        +noteBtn
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
  if(!lf)return; // sécurité
  lf.style.display='block'; // forcer visibilité
  if(!fIds.length){
    lf.innerHTML='<div style="text-align:center;padding:48px 24px">'
      +'<div style="position:relative;width:80px;height:80px;margin:0 auto 20px">'
      +'<div style="width:80px;height:80px;background:var(--orp);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:emptyFloat 3s ease-in-out infinite">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.6" stroke-linecap="round" width="36" height="36"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
      +'</div>'
      +'<div style="position:absolute;bottom:0;right:0;width:26px;height:26px;background:var(--or);border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid var(--bg)">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'
      +'</div></div>'
      +'<div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em">Aucun professeur suivi</div>'
      +'<div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px">Suivez vos profs préférés pour être<br>alert\u00e9 d\u00e8s qu\'un nouveau cours est publi\u00e9.</div>'
      +'<button onclick="navTo(\'exp\')" style="background:var(--or);color:#fff;border:none;border-radius:50px;padding:12px 24px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(255,107,43,.3)">Explorer les cours →</button>'
      +'</div>';
  } else {
    lf.innerHTML='<div style="background:var(--wh);border-radius:16px;overflow:hidden">'+fIds.map(function(id,i){
      var p=P[id];if(!p)return'';
      var cours=C.filter(function(c){return c.pr===id;});
      var matieres=cours.length?[...new Set(cours.map(function(c){return c.subj;}))].slice(0,2).join(', '):'';
      var prochainCours=cours.filter(function(c){return c.fl<c.sp;}).length;
      var av=p.photo?'<img src="'+p.photo+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .3s" onload="this.style.opacity=1">':
        '<span style="font-size:15px;font-weight:800;color:#fff">'+p.i+'</span>';
      var border=i<fIds.length-1?'border-bottom:1px solid var(--bdr)':'';
      var dispoLabel=prochainCours?' · <span style="color:var(--or);font-weight:600">'+prochainCours+' cours dispo</span>':'';
      return'<div onclick="openPr(\''+id+'\')" class="fol-row" style="'+border+'">'
        +'<div style="width:46px;height:46px;border-radius:50%;background:'+p.col+';display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">'+av+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:15px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.nm+'</div>'
        +'<div style="font-size:12px;color:var(--lite);margin-top:2px">'+(matieres||'Professeur')+dispoLabel+'</div>'
        +'</div>'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--bdr)" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>'
        +'</div>';
    }).join('')+'</div>';
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
      headers:authHeaders(),
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
  setAvatar(g('tav'),user.photo,user.ini);
  setAvatar(g('tavMob'),user.photo,user.ini);
  var an=g('accName');if(an)an.textContent=user.pr+(user.nm?' '+user.nm:'');
  var ae=g('accEmail');if(ae)ae.textContent=user.em;
  setAvatar(g('accAv'),user.photo,user.ini,'rgba(255,255,255,.2)');
  toast('Profil sauvegardé ✓','');
  // Sync photo partout si présente
  if(user&&user.photo) _applyPhotoPartout(user.photo);
}

function doLogout(){
  user=null;
  setToken(null);
  try{localStorage.removeItem('cp_user');}catch(e){}
  Object.keys(res).forEach(function(k){delete res[k]});fol.clear();
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
  var login=g('login');if(login){login.style.display='flex';login.style.zIndex='999';login.style.pointerEvents='';}
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
  var imgSquare='<img src="'+esc(url)+'" style="width:100%;height:100%;object-fit:cover">';
  setAvatar(g('tav'),url,user.ini);
  setAvatar(g('tavMob'),url,user.ini);
  setAvatar(g('accAv'),url,user.ini);
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
  if(rAv&&curId){var cc=C.find(function(x){return x.id===curId;});if(cc&&cc.pr===user.id){rAv.style.background='none';rAv.innerHTML=imgSquare;}}
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
          headers:authHeaders(),
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
function buildCards(){
  currentPage=1;
  if(!C.length){
    // Éviter de re-render si nocard est déjà affiché (évite les sauts visuels)
    if(g('nocard').style.display==='block')return;
    g('nocard').style.display='block';
    g('nocardTitle').textContent='Aucun cours disponible';
    g('nocardSub').textContent='Soyez le premier à proposer un cours !';
    g('loadMoreWrap').style.display='none';
    g('grid').innerHTML='';
    return;
  }
  g('nocard').style.display='none';
  applyFilter();
}

function applyFilter(){
  var raw=g('srch').value.trim();
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
      var profFull=(c.prof_nm||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
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
    return matchFilter&&matchSearch&&matchLoc&&matchNiv;
  });
  renderPage();
}

function renderPage(){
  var grid=g('grid');grid.innerHTML='';
  var sorted=sortCourses(filteredCards);
  var toShow=sorted.slice(0,currentPage*PAGE_SIZE);
  var sc=g('sortResultCount');if(sc)sc.textContent=filteredCards.length+' cours';
  if(!toShow.length){
    g('nocard').style.display='block';
    g('nocardTitle').textContent='Aucun cours trouvé';
    g('nocardSub').textContent='Essayez un autre filtre ou une autre ville';
    g('loadMoreWrap').style.display='none';
    // Cours similaires : suggerer des cours d'autres matieres
    var suggestions=sortCourses(C.filter(function(c){return c.fl<c.sp&&!(c.prive&&!res[c.id]);}).slice(0,3));
    if(suggestions.length){
      var sgHtml='<div style="margin-top:16px;text-align:left"><div style="font-size:12px;font-weight:700;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;text-align:center">Cours disponibles</div>';
      sgHtml+=suggestions.map(function(c){
        var pp=Math.ceil(c.tot/c.sp);
        var mf=findMatiere(c.subj)||MATIERES[MATIERES.length-1];
        return'<div onclick="openR(\''+c.id+'\')" style="display:flex;align-items:center;gap:10px;background:var(--wh);border:1px solid var(--bdr);border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:all .18s" onmouseenter="this.style.boxShadow=\'var(--sh)\'" onmouseleave="this.style.boxShadow=\'none\'">'+'<div style="width:36px;height:36px;border-radius:10px;background:'+mf.bg+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:8px;height:8px;border-radius:50%;background:'+mf.color+'"></div></div>'+'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.title+'</div><div style="font-size:11px;color:var(--lite);margin-top:2px">'+c.subj+' · '+c.dt+'</div></div>'+'<div style="font-size:15px;font-weight:800;color:var(--or);flex-shrink:0">'+pp+'€</div>'+'</div>';
      }).join('');
      sgHtml+='</div>';
      var nc=g('nocard');
    if(nc){
      // Réinitialiser le nocard avant d'ajouter les suggestions (évite l'accumulation)
      nc.innerHTML='<div style="width:64px;height:64px;background:var(--orp);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="28" height="28"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:8px;letter-spacing:-.02em" id="nocardTitle">Aucun cours trouvé</div><div style="font-size:14px;color:var(--lite);line-height:1.6;margin-bottom:24px" id="nocardSub">Essayez un autre filtre ou une autre ville</div>';
      nc.innerHTML+=sgHtml;
    }
    }
    return;
  }
  // Compteur de résultats dans le sous-titre du header
  if(user){var ms=g('mobSub');if(ms&&actF!=='tous'||actNiv||actLoc)ms.textContent=toShow.length+' cours trouvé'+(toShow.length>1?'s':'');}
  g('nocard').style.display='none';
  toShow.forEach(function(c,i){
    var pp=Math.ceil(c.tot/c.sp);
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
    d.className='card'+(c.prive?' card-prive':'');d.dataset.id=c.id;d.dataset.t=c.t;d.style.animationDelay=(i*.04)+'s';
    d.onclick=function(){if(isFull&&!isR){openF(c.pr,c.title);return;}openR(c.id);};
    var nivBadge=c.niveau?'<span style="display:inline-flex;align-items:center;background:rgba(0,0,0,.1);border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#fff;margin-left:6px;letter-spacing:.02em">'+esc(c.niveau)+'</span>':'';
    var isNew=c.created_at&&(Date.now()-new Date(c.created_at).getTime()<86400000);
    var newBadge=isNew?'<span style="display:inline-flex;align-items:center;background:#FF6B2B;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:800;color:#fff;margin-left:6px;letter-spacing:.04em;animation:pulse 1.5s infinite">NOUVEAU</span>':'';
    var descLine=c.description?'<div style="font-size:12px;color:var(--lite);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4">'+esc(c.description)+'</div>':'';
    var profData=P[c.pr]||{};
    var noteProf=profData.n&&profData.n!=='—'?profData.n:null;
    var ratingBadge=noteProf?'<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,0,0,.1);border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#fff;margin-left:6px">★ '+esc(noteProf)+'</span>':'';
    d.innerHTML='<div class="ctop" style="background:'+_cardBg+'"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:2px"><span class="chip" style="color:'+c.sc+'">'+esc(c.subj)+'</span>'+nivBadge+newBadge+'</div><div class="pbub" data-prof="'+c.pr+'" style="background:'+(_pPhoto?'none':c.prof_col)+'" onclick="event.stopPropagation();openPr(\''+c.pr+'\')">'+profAv+'</div></div><div class="cbody"><div class="ctitle">'+esc(c.title)+'</div>'+descLine+'<div class="cmeta"><div class="mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(c.dt)+'</div></div><div class="ltag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(c.lc)+'</div><div class="cf"><div><div style="font-size:10px;color:var(--lite)">Prix / élève</div><div class="pm" style="font-size:22px;font-weight:800">'+pp+'€</div></div><div class="sw2"><div class="st"><span>Places</span><span style="color:'+bc+'">'+pleft+'/'+c.sp+'</span></div><div class="bar" style="height:5px"><div class="bf" style="width:'+pct+'%;background:'+bc+'">'+(pleft===1&&!isFull?'<div style="font-size:10px;color:#EF4444;font-weight:600">⚠ Dernière place !</div>':'')+'</div></div></div>'+btn+'</div></div>';
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
function normStr(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');}

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
  var val=g('srch').value.trim();
  if(checkCodeInSearch(val))return;
  currentPage=1;applyFilter();
}
function setPill(el){haptic(4);document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on')});el.classList.add('on');actF=el.dataset.f;doFilter();try{sessionStorage.setItem('cp_filter',actF);}catch(e){}}
function restoreFilters(){
  try{
    var f=sessionStorage.getItem('cp_filter');
    if(f&&f!=='tous'){
      var el=document.querySelector('.pill[data-f="'+f+'"]');
      if(el){el.classList.add('on');document.querySelector('.pill[data-f="tous"]').classList.remove('on');actF=f;}
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

function openR(id){haptic(4);
  if(!user||!user.id){showLoginPrompt();return;}
  var _rBtn=document.querySelector('[data-id="'+id+'"] .btnr');
  if(_rBtn&&_rBtn.textContent==='Réserver'){_rBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13" style="animation:cpSpin .6s linear infinite"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';_rBtn.disabled=true;setTimeout(function(){if(_rBtn){_rBtn.innerHTML='Réserver';_rBtn.disabled=false;}},5000);}
  var c=C.find(function(x){return x.id===id});
  if(!c)return;
  var isOwner=user&&c.pr===user.id;
  // Si c'est le prof qui consulte son propre cours, ne pas bloquer
  if(!isOwner&&res[id]){openO(id);return;}
  if(!isOwner&&c.fl>=c.sp){openF(c.pr,c.title);return;}
  curId=id;
  var pp=Math.ceil(c.tot/c.sp);
  g('rTit').textContent=c.title;g('rSbj').textContent=c.subj;
  var rAv=g('rProfAv'),rNm=g('rProfNm');
  if(rAv){var _pp=(P[c.pr]&&P[c.pr].photo)||c.prof_photo;setAvatar(rAv,_pp,c.prof_ini||'?','rgba(255,255,255,.25)');}
  if(rNm)rNm.textContent=c.prof_nm||'Professeur';
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
  g('rDt').textContent=c.dt;g('rLc').textContent=c.lc;
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
  var c=C.find(function(x){return x.id===id;});
  if(!c)return;
  g('elevesTitre').textContent=c.title+' — '+c.fl+' inscrit'+(c.fl>1?'s':'');
  var list=g('elevesList');
  list.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px"><span class="cp-loader"></span>Chargement</div>';
  openM('bdEleves');
  if(c.fl===0){list.innerHTML='<div class="bempty"><p>Aucun élève inscrit pour l\'instant.</p></div>';return;}
  try{
    var r=await fetch(API+'/reservations/cours/'+id);
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
    var r=await fetch(API+'/reservations/'+reservationId+'/cancel',{method:'POST',headers:authHeaders(),body:JSON.stringify({user_id:userId,cours_id:coursId,montant:montant})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    toast('Annulé','L\'élève a été remboursé automatiquement ✓');
    openEleves(coursId);
    var c=C.find(function(x){return x.id===coursId;});
    if(c&&c.fl>0)c.fl--;
    buildCards();
  }catch(e){toast('Erreur réseau','Impossible d\'annuler');}
}
async function confR(){haptic(15);
  var id=curId;
  if(!id){toast('Erreur','Veuillez réessayer');return;}
  var c=C.find(function(x){return x.id===id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  if(!user||!user.id){toast('Connexion requise','Connectez-vous pour réserver');return;}
  if(res[id]){toast('Déjà réservé','Vous avez déjà une place pour ce cours');return;}
  var btn=document.querySelector('#bdR .pb.pri');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="cp-loader"></span>Redirection…';}
  try{
    var pp=Math.ceil(c.tot/c.sp);
    // Créer un PaymentIntent côté serveur
    var r=await fetch(API+'/stripe/payment-intent',{method:'POST',headers:authHeaders(),body:JSON.stringify({
      cours_id:id,user_id:user.id,montant:pp,cours_titre:c.title,pour_ami:false
    })});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    if(data.already_reserved){toast('Déjà réservé','Vous avez déjà une place pour ce cours');return;}
    // Ouvrir le modal Stripe Elements
    openStripeElements({
      clientSecret:data.client_secret,
      paymentIntentId:data.payment_intent_id,
      coursId:id,montant:pp,coursNom:c.title,pourAmi:false
    });
  }catch(e){toast('Erreur réseau','Impossible de lancer le paiement');}
  finally{if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Confirmer — <strong>'+( g('rFinB')?g('rFinB').textContent:'')+'</strong>';}}
}
// ── Stripe Elements in-app ──
var _stripeEl = null; // instance Stripe
var _stripeCard = null; // élément carte
var _stripePendingData = null; // données en cours

function openStripeElements(data){
  _stripePendingData = data;
  // Initialiser Stripe
  if(!_stripeEl){
    try{ _stripeEl = Stripe('pk_live_51TB9Am3FNybFliKQGUpI1uSMheaSyFV0TwgRoAfmgRJtLtxAujacxrLJqM5zaOdLa0EuZNLJe7HOXKSZWmwZHyR500YZcvAF6h'); } catch(e){ console.log('Stripe init error',e); return; }
  }
  // Afficher le modal
  var bd = g('bdStripe');
  if(!bd) return;
  // Mettre à jour les infos
  var titleEl = g('stripeTitle'); if(titleEl) titleEl.textContent = 'Paiement sécurisé';
  var subEl = g('stripeSubtitle'); if(subEl) subEl.textContent = data.coursNom;
  var nomEl = g('stripeCoursNom'); if(nomEl) nomEl.textContent = data.coursNom;
  var montEl = g('stripeMontant'); if(montEl) montEl.textContent = data.montant + '€';
  var btnTxt = g('stripePayBtnTxt'); if(btnTxt) btnTxt.textContent = 'Payer ' + data.montant + '€';
  var errEl = g('stripeCardError'); if(errEl){errEl.style.display='none';errEl.textContent='';}
  // Créer l'élément carte
  var elements = _stripeEl.elements();
  var cardEl = g('stripeCardElement');
  if(cardEl) cardEl.innerHTML = ''; // reset
  _stripeCard = elements.create('card', {
    style:{
      base:{
        fontFamily:'"Plus Jakarta Sans",sans-serif',
        fontSize:'16px',
        color:'#1a1a1a',
        backgroundColor:'#ffffff',
        '::placeholder':{color:'#AAAAAA'},
        iconColor:'#635BFF'
      },
      invalid:{color:'#EF4444'}
    },
    hidePostalCode: true
  });
  if(cardEl) _stripeCard.mount('#stripeCardElement');
  _stripeCard.on('change', function(e){
    var errEl = g('stripeCardError');
    if(e.error && errEl){ errEl.textContent = e.error.message; errEl.style.display='block'; }
    else if(errEl){ errEl.style.display='none'; }
  });
  bd.style.display = 'flex';
  closeM('bdR');
  haptic(10);
}

function closeStripeModal(){
  var bd = g('bdStripe');
  if(bd) bd.style.display = 'none';
  if(_stripeCard){ _stripeCard.unmount(); _stripeCard = null; }
  _stripePendingData = null;
}

async function submitStripePayment(){
  if(!_stripeEl || !_stripeCard || !_stripePendingData) return;
  var btn = g('stripePayBtn');
  var btnTxt = g('stripePayBtnTxt');
  var errEl = g('stripeCardError');
  if(btn) btn.disabled = true;
  if(btnTxt) btnTxt.textContent = '⏳ Paiement en cours…';
  if(errEl) errEl.style.display = 'none';
  try{
    // Confirmer le paiement avec Stripe.js
    var result = await _stripeEl.confirmCardPayment(_stripePendingData.clientSecret, {
      payment_method: { card: _stripeCard }
    });
    if(result.error){
      // Erreur de paiement (carte refusée, etc.)
      if(errEl){ errEl.textContent = result.error.message; errEl.style.display='block'; }
      haptic([10,10,10]);
    } else if(result.paymentIntent && result.paymentIntent.status === 'succeeded'){
      // Paiement réussi — confirmer côté serveur
      var d = _stripePendingData;
      var r = await fetch(API+'/stripe/confirm-payment',{
        method:'POST',
        headers:authHeaders(),
        body:JSON.stringify({
          payment_intent_id: result.paymentIntent.id,
          cours_id: d.coursId,
          user_id: user.id,
          montant: d.montant,
          pour_ami: d.pourAmi
        })
      });
      var resp = await r.json();
      if(resp.success || resp.already_existed){
        var savedD = {coursId:d.coursId, montant:d.montant, pourAmi:d.pourAmi, coursNom:d.coursNom};
        closeStripeModal();
        if(!savedD.pourAmi) res[savedD.coursId] = true;
        loadData().then(function(){buildCards();});
        setTimeout(function(){
          // Remplir le récap
          var cours = C.find(function(x){return x.id===savedD.coursId;});
          var el = document.getElementById;
          if(el('popupPaidCoursNom')) el('popupPaidCoursNom').textContent = cours ? cours.title : savedD.coursNom;
          if(el('popupPaidProf')) el('popupPaidProf').textContent = cours ? cours.prof_nm : '—';
          if(el('popupPaidDate')) el('popupPaidDate').textContent = cours ? cours.dt : '—';
          if(el('popupPaidLieu')) el('popupPaidLieu').textContent = cours ? cours.lc : '—';
          if(el('popupPaidMontant')) el('popupPaidMontant').textContent = savedD.montant + '€';
          var popup = document.getElementById('popupPaid');
          if(popup){ popup.style.display='flex'; haptic(40); }
        }, 300);
      } else {
        if(errEl){ errEl.textContent = resp.error||'Erreur serveur. Contactez le support.'; errEl.style.display='block'; }
      }
    }
  }catch(e){
    if(errEl){ errEl.textContent = 'Erreur réseau. Réessayez.'; errEl.style.display='block'; }
  }finally{
    if(btn) btn.disabled = false;
    if(btnTxt) btnTxt.textContent = 'Payer '+(_stripePendingData?_stripePendingData.montant+'€':'');
  }
}

function contR(){
  var c=C.find(function(x){return x.id===curId});
  var nm=c?c.prof_nm:'le professeur';
  var pid=c?c.pr:null;
  var photo=c?c.prof_photo:null;
  closeM('bdR');
  if(pid)openMsg(nm,pid,photo);
}

// AUTRE PERSONNE
function openO(id){
  curId=id;var c=C.find(function(x){return x.id===id});
  g('oTit').textContent=c.title;g('oPrc').textContent=Math.ceil(c.tot/c.sp)+'€';
  openM('bdO');
}
function closeO(){closeM('bdO');}
function confO(){
  var id=curId;closeM('bdO');
  var c=C.find(function(x){return x.id===id});
  if(!c||c.fl>=c.sp){if(c)openF(c.pr,c.title);return;}
  // Afficher la modal de paiement pour une autre personne
  curId=id;
  var pp=Math.ceil(c.tot/c.sp);
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
  var c=C.find(function(x){return x.id===id});
  if(!c)return;
  if(c.fl>=c.sp){closeM('bdR');openF(c.pr,c.title);return;}
  var btn=document.querySelector('#bdR .pb.pri');
  if(btn){btn.disabled=true;btn.textContent='⏳ Redirection vers le paiement…';}
  try{
    var pp=Math.ceil(c.tot/c.sp);
    var r=await fetch(API+'/stripe/payment-intent',{method:'POST',headers:authHeaders(),body:JSON.stringify({
      cours_id:id,user_id:user.id,montant:pp,cours_titre:c.title+' · Place supplémentaire',pour_ami:true
    })});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    if(data.already_reserved){toast('Déjà réservé','');return;}
    openStripeElements({
      clientSecret:data.client_secret,
      paymentIntentId:data.payment_intent_id,
      coursId:id,montant:pp,coursNom:c.title+' · Place supplémentaire',pourAmi:true
    });
  }catch(e){toast('Erreur réseau','Impossible de lancer le paiement');}
  finally{if(btn){btn.disabled=false;btn.onclick=function(){confAmi(id);};}}
}

function shareCoursLink(){
  var co=C.find(function(x){return x.id===curId});
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
  closeM('bdF');
  toast('Vous suivez '+(p.nm||'ce prof'),'Notifié dès son prochain cours 🔔');
  folPr=null;
  // Sauvegarder le follow en base
  if(user&&user.id){
    fetch(API+'/follows',{method:'POST',headers:authHeaders(),body:JSON.stringify({user_id:user.id,professeur_id:pid})}).catch(function(){});
    // Incrémenter le compteur d'élèves du prof
    if(P[pid])P[pid].e=(P[pid].e||0)+1;
  }
}

// PROFIL PROF
function openPr(pid){
  curProf=pid;
  // Trouver le cours le plus récent de ce prof pour avoir les bonnes infos
  var cours=C.filter(function(x){return x.pr===pid;});
  var dernierCours=cours[0]||null;
  var p=P[pid];
  // Toujours prioriser les données du cours le plus récent
  if(dernierCours){
    if(!p)p={};
    p.nm=dernierCours.prof_nm||p.nm||'Professeur';
    p.i=dernierCours.prof_ini||p.i||'?';
    p.col=dernierCours.prof_col||p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
    p.photo=dernierCours.prof_photo||p.photo||null;
    p.rl=p.rl||'';p.bd=p.bd||'';p.c=p.c||0;p.n=p.n||'—';p.e=p.e||0;p.bio=p.bio||'';p.tags=p.tags||[];
  }
  if(!p||!p.nm){toast('Profil introuvable','');return;}
  setAvatar(g('mpav'),p.photo,p.i,p.col||'linear-gradient(135deg,#FF8C55,#E04E10)');
  // Coloriser le hero avec la couleur du prof
  var hero=g('mpHero');
  if(hero)hero.style.background=p.col||'linear-gradient(135deg,#FF8C55,#E04E10)';
  g('mpnm').textContent=p.nm;g('mprl').textContent=p.rl||'';g('mpbd').textContent=p.bd||'';
  g('mpC').textContent=cours.length;
  var noteDisplay=p.n&&p.n!=='—'?'★ '+p.n:'Aucun avis';
  g('mpN').textContent=noteDisplay;
  g('mpE').textContent=p.e||0;
  g('mpBio').textContent=p.bio||'';
  g('mpTags').innerHTML=(p.tags||[]).map(function(t){return'<span class="tag">'+esc(t)+'</span>';}).join('');
  var prochains=cours.filter(function(c){return c.fl<c.sp;});
  g('mpCrs').innerHTML=prochains.length?prochains.map(function(c){return'<div class="pcrow"><div style="font-size:13px">'+esc(c.title)+' · '+esc(c.dt)+'</div><button class="btnr" style="font-size:12px;padding:6px 11px" onclick="closePr();openR(\''+c.id+'\')">Réserver</button></div>';}).join(''):'<div style="font-size:13px;color:var(--lite);padding:10px 0">Aucun cours disponible</div>';
  // Charger les 3 derniers avis
  var avisBlock=g('mpAvisBlock'),avisContainer=g('mpAvis');
  if(avisBlock)avisBlock.style.display='none';
  fetch(API+'/notations/'+pid).then(function(r){return r.json();}).then(function(notes){
    if(!notes||!notes.length){return;}
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
  var fb=g('bFP'),ft=g('bFPt');
  var isSelf=user&&pid===user.id;
  fb.style.display=isSelf?'none':'flex';
  fb.classList.toggle('on',fol.has(pid));ft.textContent=fol.has(pid)?'Suivi ✓':'Suivre';
  var bdPrEl=g('bdPr');if(bdPrEl)bdPrEl.style.display='flex';
  // Appliquer les données du cache P[] immédiatement si disponibles
  var pCache=P[pid];
  if(pCache){
    var bioEl0=g('mpBio');if(bioEl0&&pCache.bio)bioEl0.textContent=pCache.bio;
    var tagsEl0=g('mpTags');
    if(tagsEl0&&pCache.matieres){
      var mats0=pCache.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean);
      tagsEl0.innerHTML=mats0.map(function(m){return'<span style="background:var(--orp);color:var(--or);border-radius:50px;padding:5px 12px;font-size:12px;font-weight:600">'+esc(m)+'</span>';}).join('');
    }
    if(pCache.niveau&&g('mpbd'))g('mpbd').textContent=pCache.niveau;
  }
  // Charger les vraies données du profil (bio, matières, niveau) — mise à jour silencieuse
  fetch(API+'/profiles/'+pid).then(function(r){return r.json();}).then(function(prof){
    if(!prof||!prof.id)return;
    // Mettre à jour le cache P[]
    if(!P[pid])P[pid]={};
    if(prof.bio!==undefined)P[pid].bio=prof.bio;
    if(prof.matieres!==undefined)P[pid].matieres=prof.matieres;
    if(prof.niveau!==undefined)P[pid].niveau=prof.niveau;
    // Bio
    var bioEl=g('mpBio');
    if(bioEl)bioEl.textContent=prof.bio||'';
    // Matières en chips
    var tagsEl=g('mpTags');
    if(tagsEl&&prof.matieres){
      var mats=prof.matieres.split(',').map(function(m){return m.trim();}).filter(Boolean);
      tagsEl.innerHTML=mats.map(function(m){
        var mat=findMatiere(m);
        var col=mat?mat.color:'var(--or)';
        var bg=mat?(mat.bg.replace('linear-gradient(135deg,','').split(',')[1]||'var(--orp)'):'var(--orp)';
        return'<span style="background:var(--orp);color:var(--or);border-radius:50px;padding:5px 12px;font-size:12px;font-weight:600">'+esc(m)+'</span>';
      }).join('');
    }
    // Niveau
    if(prof.niveau&&prof.niveau!==''){
      var niv=document.createElement('div');
      niv.style.cssText='font-size:12px;color:rgba(255,255,255,.7);margin-top:4px';
      niv.textContent=prof.niveau;
      var mpbd=g('mpbd');
      if(mpbd)mpbd.textContent=prof.niveau;
    }
    // Statut
    var mprl=g('mprl');
    if(mprl&&prof.statut){
      var statutLabels={'etudiant':'Étudiant','prof_ecole':'Prof des écoles','prof_college':'Prof collège/lycée','prof_universite':'Enseignant-chercheur','auto':'Auto-entrepreneur','autre':'Professionnel'};
      mprl.textContent=statutLabels[prof.statut]||prof.statut;
    }
  }).catch(function(){});
}
function closePr(){var el=g('bdPr');if(el)el.style.display='none';}
function contPr(){
  var p=P[curProf]||{};
  var pid=curProf;
  closePr();
  openMsg(p.nm||'le professeur',pid,p.photo||null);
}
function togFP(){
  haptic(6);
  var id=curProf,p=P[id]||{nm:'ce prof'},fb=g('bFP'),ft=g('bFPt');
  if(user&&id===user.id){toast('Action impossible','Vous ne pouvez pas vous suivre vous-même');return;}
  if(fol.has(id)){
    fol.delete(id);fb.classList.remove('on');ft.textContent='Suivre';
    toast('Désabonné','Vous ne suivez plus '+p.nm);
    if(P[id])P[id].e=Math.max(0,(P[id].e||1)-1);
    // Supprimer en base
    if(user&&user.id){
      fetch(API+'/follows',{method:'DELETE',headers:authHeaders(),body:JSON.stringify({user_id:user.id,professeur_id:id})}).catch(function(){});
    }
  } else {
    fol.add(id);fb.classList.add('on');ft.textContent='Suivi ✓';
    toast('Vous suivez '+p.nm,'Notifié dès son prochain cours 🔔');
    if(P[id])P[id].e=(P[id].e||0)+1;
    // Sauvegarder en base
    if(user&&user.id){
      fetch(API+'/follows',{method:'POST',headers:authHeaders(),body:JSON.stringify({user_id:user.id,professeur_id:id})}).catch(function(){});
    }
  }
  // Mettre à jour le compteur affiché
  g('mpE').textContent=P[id]?P[id].e:0;
}

// CRÉER COURS
function openCr(){
  if(!user||user.role!=='professeur'){toast('Accès refusé','Seuls les professeurs peuvent proposer des cours');return;}
  if(!user.verified){
    toast('Compte non vérifié','Votre compte est en cours de vérification par notre équipe. Vous pourrez publier des cours dès validation (sous 24h).');
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
    var r=await fetch(API+'/cours',{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)});
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
    closeM('bdCr');await loadData();buildCards();
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
  var c=C.find(function(x){return x.id===id;});
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
  var c=C.find(function(x){return x.id===id;});
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
    var r=await fetch(API+'/cours/'+id+'/cancel',{method:'POST',headers:authHeaders(),body:JSON.stringify({professeur_id:user.id})});
    var data=await r.json();
    if(data.error){toast('Erreur',data.error);return;}
    await loadData();buildCards();
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

  // Naviguer vers la page messages
  navTo('msg');

  // Ouvrir la conversation
  // Mobile : ajouter classe conv-open (CSS gère display:flex)
  var pgMsg=g('pgMsg');
  if(pgMsg)pgMsg.classList.add('conv-open');
  var bnav=g('bnav');
  if(bnav)bnav.style.display='none';
  // Avatar et nom
  var av=g('msgConvAv');
  if(avatar&&avatar!=='null'&&avatar!==''){
    av.style.background='none';
    av.innerHTML='<img src="'+avatar+'" style="width:100%;height:100%;object-fit:cover">';
  } else {
    av.style.background='linear-gradient(135deg,#FF8C55,#E04E10)';
    av.textContent=(profNm&&profNm[0])||'?';
  }
  g('msgConvName').textContent=profNm||'Contact';
  g('msgMessages').innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">Chargement…</div>';
  var inp=g('msgInput');inp.value='';inp.style.height='auto';

  // Mobile : montrer la conv
  g('pgMsg').classList.add('conv-open');

  // Marquer conversation active dans la liste
  document.querySelectorAll('.msg-row').forEach(function(r){r.classList.remove('active');});
  var activeRow=document.querySelector('[data-uid="'+msgDestId+'"]');
  if(activeRow)activeRow.classList.add('active');

  loadMessages();
  clearInterval(msgPollTimer);
  // Polling optimisé — augmente progressivement
  var pollDelay=3000;
  function schedulePoll(){
    msgPollTimer=setTimeout(function(){
      loadMessages();
      if(msgDestId)schedulePoll(); // continuer seulement si conv active
    },pollDelay);
    pollDelay=Math.min(pollDelay+500,8000); // augmente jusqu'à 8s
  }
  schedulePoll();
}

function closeMsgConv(){
  var pgMsg=g('pgMsg');
  if(pgMsg)pgMsg.classList.remove('conv-open');
  // Réafficher la barre de nav
  var bnav=g('bnav');
  if(bnav&&user){
    var isMob=window.innerWidth<=640;
    bnav.style.display='flex';
    if(!isMob){bnav.style.left='50%';bnav.style.transform='translateX(-50%)';}
    else{bnav.style.left='';bnav.style.transform='';bnav.style.padding='';}
  }
  clearInterval(msgPollTimer);msgPollTimer=null;msgDestId=null;
  document.querySelectorAll('.msg-row').forEach(function(r){r.classList.remove('active');});
}

async function loadMessages(){
  if(!user||!msgDestId)return;
  try{
    var r=await fetch(API+'/messages/'+user.id+'/'+msgDestId);
    var msgs=await r.json();
    if(!Array.isArray(msgs))return;
    var container=g('msgMessages');
    if(!msgs.length){
      container.innerHTML='<div style="text-align:center;padding:30px;color:var(--lite);font-size:13px">Aucun message. Dites bonjour ! 👋</div>';
      return;
    }
    var html='';
    var lastDate='';
    var now=new Date();
    msgs.forEach(function(m){
      var d=new Date(m.created_at);
      var dateKey=d.toDateString();
      if(dateKey!==lastDate){
        lastDate=dateKey;
        var label='';
        var today=new Date();today.setHours(0,0,0,0);
        var yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
        var msgDay=new Date(d);msgDay.setHours(0,0,0,0);
        var diff=Math.round((today-msgDay)/(1000*60*60*24));
        if(diff===0)label='Aujourd\'hui';
        else if(diff===1)label='Hier';
        else if(diff===2)label='Avant-hier';
        else{
          label=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
          label=label.charAt(0).toUpperCase()+label.slice(1);
        }
        html+='<div style="text-align:center;margin:12px 0 8px"><span style="background:var(--bg);color:var(--lite);font-size:11px;font-weight:600;padding:4px 12px;border-radius:50px">'+label+'</span></div>';
      }
      var isMe=m.sender_id===user.id;
      var time=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      // Avatar interlocuteur pour les messages reçus
      var otherP=P[msgDestId]||{};
      var otherPhoto=otherP.photo||null;
      var otherIni=(otherP.i)||((msgDestinataire&&msgDestinataire[0])||'?');
      var otherCol=otherP.col||'linear-gradient(135deg,#FF8C55,var(--ord))';
      var avHtml='';
      if(!isMe){
        avHtml='<div style="width:28px;height:28px;border-radius:50%;background:'+otherCol+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden;margin-top:2px;align-self:flex-end">'+(otherPhoto?'<img src="'+otherPhoto+'" style="width:100%;height:100%;object-fit:cover">':otherIni)+'</div>';
      }
      var bubbleBg=isMe?'linear-gradient(135deg,var(--or),var(--ord))':'var(--wh)';
      var bubbleColor=isMe?'#fff':'var(--ink)';
      var bubbleRadius=isMe?'20px 20px 5px 20px':'20px 20px 20px 5px';
      var bubbleShadow=isMe?'0 2px 8px rgba(255,107,43,.3)':'0 1px 4px rgba(0,0,0,.08)';
      html+='<div style="display:flex;justify-content:'+(isMe?'flex-end':'flex-start')+';align-items:flex-end;gap:7px;margin-bottom:2px">'
        +(isMe?'':''+avHtml)
        +'<div style="max-width:72%;background:'+bubbleBg+';color:'+bubbleColor+';border-radius:'+bubbleRadius+';padding:10px 14px;font-size:14px;line-height:1.5;box-shadow:'+bubbleShadow+'">'
        +'<div>'+esc(m.contenu)+'</div>'
        +'<div style="font-size:10px;opacity:.55;margin-top:4px;text-align:'+(isMe?'right':'left')+'">'+time+'</div>'
        +'</div>'
        +(isMe?'':'')
        +'</div>';
    });
    container.innerHTML=html;
    container.scrollTop=container.scrollHeight;
    // Marquer comme lu
    if(msgDestId){
      fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:authHeaders(),body:JSON.stringify({expediteur_id:msgDestId})}).then(function(){
        // Mettre à jour badge
        var badge=g('bnavBadge');if(badge)badge.classList.remove('on');
        var msgBadge=g('msgBadge');if(msgBadge)msgBadge.style.display='none';
        // Mettre à jour aperçu dans la liste
        document.querySelectorAll('.msg-unread').forEach(function(r){r.classList.remove('msg-unread');});
      }).catch(function(){});
    }
  }catch(e){}
}

async function sendMsg(){
  var txt=(g('msgInput').value||'').trim();
  if(!txt||!user)return;
  if(!msgDestId){toast('Erreur','Aucun destinataire sélectionné');return;}
  var inp=g('msgInput');
  inp.value='';inp.style.height='auto';
  var btn=document.querySelector('#msgConvPane button[onclick*="sendMsg"]');
  if(btn)btn.disabled=true;
  try{
    var r=await fetch(API+'/messages',{method:'POST',headers:authHeaders(),body:JSON.stringify({
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
      fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:authHeaders(),body:JSON.stringify({expediteur_id:msgDestId})}).catch(function(){});
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
    await fetch(API+'/messages',{method:'POST',headers:authHeaders(),body:JSON.stringify({
      expediteur_id:user.id,
      destinataire_id:msgDestId,
      contenu:txt
    })});
    var badge=g('bnavBadge');if(badge)badge.classList.remove('on');
    var msgBadge=g('msgBadge');if(msgBadge)msgBadge.style.display='none';
    if(user&&msgDestId){
      fetch(API+'/messages/lu/'+user.id,{method:'PUT',headers:authHeaders(),body:JSON.stringify({expediteur_id:msgDestId})}).catch(function(){});
    }
    var container=g('modalMsgMessages');
    var r=await fetch(API+'/messages/'+user.id+'/'+msgDestId);
    var msgs=await r.json();
    if(!Array.isArray(msgs)||!msgs.length)return;
    var html='';
    msgs.forEach(function(m){
      var isMe=m.sender_id===user.id;
      var d=new Date(m.created_at);
      var time=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      html+='<div style="display:flex;justify-content:'+(isMe?'flex-end':'flex-start')+'"><div style="max-width:75%;background:'+(isMe?'var(--or)':'var(--bg)')+';color:'+(isMe?'#fff':'var(--ink)')+';border-radius:'+(isMe?'16px 16px 4px 16px':'16px 16px 16px 4px')+';padding:10px 13px;font-size:13.5px;line-height:1.5"><div>'+m.contenu+'</div><div style="font-size:10px;opacity:.6;margin-top:3px;text-align:right">'+time+'</div></div></div>';
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
    var r=await fetch(API+'/conversations/'+user.id);
    if(!r.ok)throw new Error('HTTP '+r.status);
    var msgs=await r.json();
    if(!Array.isArray(msgs)||!msgs.length){
      lm.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--lite)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="width:48px;height:48px;margin:0 auto 12px;display:block;color:var(--bdr)"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div style="font-size:14px;font-weight:600">Aucune conversation</div><div style="font-size:12px;margin-top:6px">Contactez un professeur depuis un cours</div></div>';
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
    var html=Object.keys(convs).map(function(otherId){
      var m=convs[otherId];
      var isMe=m.sender_id===user.id;
      var nonLu=!isMe&&!m.lu;
      if(nonLu)nonLus++;
      // Chercher le profil dans P ou fallback
      var p=P[otherId];
      var nm=p?p.nm:'';
      var col=p?p.col:'linear-gradient(135deg,#FF8C55,#E04E10)';
      var photo=p?p.photo:null;
      var ini=p?p.i:'';
      // Si pas de profil en cache, charger depuis l'API en arrière-plan
      if(!p){
        fetch(API+'/profiles/'+otherId).then(function(r){return r.json();}).then(function(prof){
          if(prof&&prof.id){
            var pr=prof.prenom||'';var no=prof.nom||'';
            P[otherId]={nm:(pr+(no?' '+no:'')).trim()||'Utilisateur',i:((pr[0]||'')+(no[0]||'')).toUpperCase()||'U',col:'linear-gradient(135deg,#FF8C55,#E04E10)',photo:prof.photo_url||null,rl:'',e:0};
            // Recharger la liste
            loadConversations();
          }
        }).catch(function(){});
      }
      if(!nm)nm='Utilisateur';
      if(!ini)ini=nm[0]?nm[0].toUpperCase():'U';
      var av=photo?'<img src="'+photo+'" style="width:100%;height:100%;object-fit:cover">':ini;
      var time=new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      var preview=m.contenu?esc(m.contenu.slice(0,35))+(m.contenu.length>35?'…':''):'…';
      var unreadDot=nonLu?'<div style="width:10px;height:10px;min-width:10px;border-radius:50%;background:var(--or);flex-shrink:0;align-self:center;box-shadow:0 0 0 3px rgba(255,107,43,.15)"></div>':'';
      return'<div class="msg-row'+(nonLu?' msg-unread':'')+'" data-uid="'+otherId+'" onclick="openMsg(\''+nm.replace(/'/g,"\\'")+'\'\,\''+otherId+'\',\''+(photo||'')+'\')"><div class="msg-av" style="background:'+col+'">'+av+'</div><div class="msg-info"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><div class="msg-name">'+esc(nm)+'</div><div style="font-size:11px;color:'+(nonLu?'var(--or)':'var(--lite)')+';font-weight:'+(nonLu?'700':'400')+'">'+time+'</div></div><div class="msg-preview">'+(isMe?'Vous · ':'')+preview+'</div></div>'+unreadDot+'</div>';
    }).join('');
    lm.innerHTML=html||'<div style="text-align:center;padding:20px;color:var(--lite)">Aucune conversation</div>';
    var badge=g('msgBadge');
    if(badge){if(nonLus>0){badge.style.display='inline-flex';badge.textContent=nonLus;}else{badge.style.display='none';}}
    var bnavBadge=g('bnavBadge');
    if(bnavBadge){if(nonLus>0){bnavBadge.classList.add('on');bnavBadge.textContent=nonLus;}else{bnavBadge.classList.remove('on');}}
  }catch(e){
    if(lm)lm.innerHTML='<div style="text-align:center;padding:20px;color:var(--lite);font-size:13px">Erreur de chargement. <a onclick="loadConversations()" style="color:var(--or);cursor:pointer">Réessayer</a></div>';
  }finally{clearTimeout(_convTimeout);_convLoading=false;}
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
          actLoc=ville.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
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
var customFilters=[];

function openAddFilter(){
  g('filterInput').value='';
  renderCustomPills();
  g('bdFilter').style.display='flex';
}
function closeAddFilter(){g('bdFilter').style.display='none';}

function addCustomFilter(){
  var val=g('filterInput').value.trim();
  if(!val)return;
  addFilterQuick(val);
  g('filterInput').value='';
}

function addFilterQuick(val){
  var key=val.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(customFilters.find(function(f){return f.key===key;}))return;
  customFilters.push({label:val,key:key});
  // Ajouter la pill dans la barre
  var bar=g('pillsBar');
  var addBtn=g('pillAdd');
  var pill=document.createElement('div');
  pill.className='pill';
  pill.dataset.f='custom_'+key;
  pill.innerHTML=val+' <span onclick="event.stopPropagation();removeCustomFilter(\''+key+'\');" style="margin-left:4px;opacity:.5;font-size:11px">✕</span>';
  pill.onclick=function(){setPill(pill);};
  bar.insertBefore(pill,addBtn);
  // Ajouter le filtre dans FM
  FM['custom_'+key]=function(t){return t.includes(key);};
  closeAddFilter();
  setPill(pill);
  renderCustomPills();
}

function removeCustomFilter(key){
  customFilters=customFilters.filter(function(f){return f.key!==key;});
  var pill=document.querySelector('[data-f="custom_'+key+'"]');
  if(pill){
    if(pill.classList.contains('on'))setPill(document.querySelector('[data-f="tous"]'));
    pill.remove();
  }
  delete FM['custom_'+key];
}

function renderCustomPills(){
  var box=g('customPillsList');
  if(!box)return;
  if(!customFilters.length){box.innerHTML='';return;}
  box.innerHTML='<div style="font-size:12px;font-weight:600;color:var(--lite);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Filtres actifs</div>'
    +customFilters.map(function(f){
      return'<span style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:#fff;border-radius:50px;padding:5px 12px;font-size:13px;font-weight:500;margin:0 6px 6px 0">'+f.label
        +'<span onclick="removeCustomFilter(\''+f.key+'\');" style="cursor:pointer;opacity:.6;font-size:11px">✕</span></span>';
    }).join('');
}

// ============================================================
// ============================================================
// VÉRIFICATION IDENTITÉ — chronologie propre
// ============================================================

function getCniStatus(){
  if(!user)return 'none';
  // Statut depuis l'objet user chargé depuis le serveur — jamais depuis localStorage
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
  var c = C.find(function(x){return x.id===coursId;});
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
      headers:authHeaders(),
      body:JSON.stringify({eleves_peuvent_ecrire:_groupeElevesPermis})
    }).catch(function(){});
    var c = C.find(function(x){return x.id===_groupeCoursId;});
    if(c) c.eleves_peuvent_ecrire = _groupeElevesPermis;
  }
  toast(_groupeElevesPermis ? 'Élèves peuvent écrire' : 'Élèves mis en lecture seule', '');
}

async function _loadGroupeMsgs(){
  if(!_groupeCoursId) return;
  try{
    var r = await fetch(API+'/messages/groupe/'+_groupeCoursId);
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
        +m.contenu
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
    var c = C.find(function(x){return x.id===_groupeCoursId;});
    await fetch(API+'/messages/groupe',{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({
        cours_id:_groupeCoursId,
        expediteur_id:user.id,
        expediteur_nom:(user.pr+(user.nm?' '+user.nm:'')).trim(),
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
  var btn=g('cniSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent='Envoi...';}
  try{
    var reader=new FileReader();
    reader.onload=async function(e){
      try{await fetch(API+'/upload/cni',{method:'POST',headers:authHeaders(),body:JSON.stringify({base64:e.target.result,userId:user.id,filename:file.name})});}catch(err){}
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
    var r=await fetch(API+'/profiles/'+user.id);
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
  if(status==='none'){block.style.display='none';return;}
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
    // Réinitialiser le statut pour permettre le renvoi
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

// Définir les étapes avec sélecteur CSS de l'élément ciblé
var _TUTO_SVG={
  logo:'<div style="width:72px;height:72px;background:rgba(255,255,255,.2);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.03em">CoursPool</div>',
  locbar:'<div style="background:rgba(255,255,255,.15);border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:10px;max-width:260px;margin:0 auto;border:1.5px solid rgba(255,255,255,.3)"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="color:rgba(255,255,255,.7);font-size:13px;flex:1">Ville, code postal...</span><div style="background:rgba(255,255,255,.2);border-radius:8px;padding:4px 10px;display:flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span style="color:#fff;font-size:11px;font-weight:700">Autour de moi</span></div></div>',
  card:'<div style="background:rgba(255,255,255,.12);border-radius:16px;overflow:hidden;max-width:230px;margin:0 auto;border:1.5px solid rgba(255,255,255,.25)"><div style="background:rgba(255,255,255,.15);padding:10px 14px"><span style="background:rgba(255,255,255,.2);border-radius:50px;padding:3px 10px;font-size:11px;font-weight:700;color:#fff">Maths</span></div><div style="padding:12px 14px"><div style="color:#fff;font-weight:700;font-size:14px;margin-bottom:4px">Algèbre niveau terminale</div><div style="color:rgba(255,255,255,.65);font-size:11px;margin-bottom:10px">Sam. 22 mars · 14h00 · Paris</div><div style="display:flex;justify-content:space-between;align-items:center"><div style="color:#fff;font-weight:800;font-size:18px">8€<span style="font-size:11px;font-weight:400;opacity:.7"> /élève</span></div><div style="background:#fff;color:#22C069;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700">Réserver</div></div></div></div>',
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
  try{if(localStorage.getItem('cp_tuto_done_'+user.id))return;}catch(e){}
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
    var r = await fetch(API + '/stripe/payments/prof/' + user.id);
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
    var r = await fetch(API + '/stripe/connect/status-prof/' + user.id);
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
        headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    var r=await fetch(API+'/notations',{method:'POST',headers:authHeaders(),body:JSON.stringify({
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
function openM(id){g(id).classList.add('on');document.body.style.overflow='hidden';}
function closeM(id){g(id).classList.remove('on');document.body.style.overflow='';}
function setR(el){document.querySelectorAll('.ro').forEach(function(r){r.classList.remove('on')});el.classList.add('on');}
function toast(t,s,isError){
  if(isError&&navigator.vibrate)navigator.vibrate([10,50,10]);g('tT').textContent=t;g('tS').textContent=s;var e=g('toast');e.classList.add('on');setTimeout(function(){e.classList.remove('on')},3200);}

// Niveau cours
function pickNiveau(el){
  document.querySelectorAll('#crNiveauChips .crn-chip').forEach(function(c){c.classList.remove('on');});
  el.classList.add('on');
  var inp=g('crNiveau');if(inp)inp.value=el.dataset.n||'';
}

// ============================================================
// FILTRE NIVEAU
// ============================================================
var actNiv = '';
function openNivFilter(){
  var el=g('bdNivFilter');
  if(el){el.style.display='flex';}
}
function closeNivFilter(){
  var el=g('bdNivFilter');
  if(el){el.style.display='none';}
}
function setNivFilter(niv, el){
  actNiv=niv;try{sessionStorage.setItem('cp_niv',niv);}catch(e){}
  // Mettre à jour les chips
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  if(el)el.classList.add('on');
  // Mettre à jour le pill label
  var lbl=g('pillNivLabel');
  var pill=g('pillNiv');
  if(lbl){lbl.textContent=niv||'Niveau';}
  if(pill){pill.classList.toggle('on',!!niv);}
  closeNivFilter();
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
  // Reconstruire les cards pour appliquer les bgDark/bg instantanément
  requestAnimationFrame(function(){
    if(C&&C.length)buildCards();
  });
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
async function submitContact(){
  var email=g('contactEmail').value.trim();
  var msg=g('contactMsg').value.trim();
  var sujet=document.querySelector('.contact-subj.on');
  if(!email||!msg){toast('Champs manquants','Remplissez votre email et votre message',true);return;}
  var btn=g('contactSubmitBtn');
  btn.disabled=true;btn.textContent='Envoi…';
  try{
    var r=await fetch(API+'/contact',{
      method:'POST',headers:authHeaders(),
      body:JSON.stringify({
        email:email,
        sujet:sujet?sujet.dataset.s:'Question générale',
        message:msg,
        nom:user?(user.pr+' '+user.nm).trim():'',
        role:user?user.role:'visiteur',
        user_id:user?user.id:null
      })
    });
    if(r.ok){
      closeContact();
      g('contactMsg').value='';
      document.querySelectorAll('.contact-subj').forEach(function(s){s.classList.remove('on');});
      toast('Message envoyé ✓','On vous répond sous 24h');
    } else {
      toast('Erreur',"Impossible d'envoyer, réessayez");
    }
  }catch(e){toast('Erreur',"Impossible d'envoyer",true);}
  finally{btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Envoyer le message';}
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
  actF='tous';actLoc='';actNiv='';
  var inp=g('locInput');if(inp)inp.value='';
  var cb=g('locClearBtn');if(cb)cb.style.display='none';
  var gb=g('locGeoBtn');if(gb){gb.style.background='';gb.style.color='';}
  document.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});
  var first=document.querySelector('.pill[data-f="tous"]');if(first)first.classList.add('on');
  document.querySelectorAll('#nivFilterList .niv-fchip').forEach(function(c){c.classList.remove('on');});
  var fn=document.querySelector('#nivFilterList .niv-fchip');if(fn)fn.classList.add('on');
  var lbl=g('pillNivLabel');if(lbl)lbl.textContent='Niveau';
  var pn=g('pillNiv');if(pn)pn.classList.remove('on');
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
      method:'POST',headers:authHeaders(),
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
      if(user)await fetch(API+'/push/subscribe',{method:'DELETE',headers:authHeaders(),body:JSON.stringify({user_id:user.id})});
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
      +'<div style="width:64px;height:64px;background:var(--orp);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--or)" stroke-width="1.8" stroke-linecap="round" width="28" height="28"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +'</div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Aucun cours pass\u00e9</div>'
      +'<div style="font-size:14px;color:var(--lite)">Vos cours termin\u00e9s apparaissent ici</div></div>';
    return;
  }
  var now=new Date();
  var past=rIds.map(function(id){return C.find(function(x){return x.id===id;});}).filter(function(c){
    if(!c||!c.created_at)return false;
    return(now-new Date(c.created_at))>3*60*60*1000;
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
  if(status==='none'){band.style.display='none';return;}
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
  var aNoter=Object.keys(res).map(function(id){return C.find(function(x){return x.id===id;});}).filter(function(c){
    if(!c||!c.created_at)return false;
    var diff=now-new Date(c.created_at);
    if(diff<3600000)return false; // moins d'1h
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
  var upcoming=Object.keys(res).map(function(id){return C.find(function(x){return x.id===id;});}).filter(Boolean).filter(function(c){
    try{var d=new Date(c.created_at||now);var diff=(d.getTime()+24*3600000)-now.getTime();return diff>0&&diff<3*3600000;}catch(e){return false;}
  });
  var rb=g('reminderBand');
  if(!upcoming.length){if(rb)rb.style.display='none';return;}
  var c=upcoming[0];_reminderCoursId=c.id;
  if(!rb)return;
  rb.style.display='flex';
  var rt=g('reminderTitle');if(rt)rt.textContent=c.title;
  var rs=g('reminderSub');
  if(rs){try{var d=new Date(c.created_at||now);var diff=Math.round(((d.getTime()+24*3600000)-now.getTime())/60000);rs.textContent='Dans '+diff+' min \u00b7 '+c.lc;}catch(e){rs.textContent=c.dt;}}
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
      var r=await fetch(API+'/profiles/'+user.id);
      var p=await r.json();
      if(!r.ok||!p||!p.id){
        toast('Votre compte a été désactivé','Vous allez être déconnecté');
        setTimeout(doLogout,2000);return;
      }
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

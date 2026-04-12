/* ── CoursPool — Dictionnaire d'alias de recherche ── */
var ALIASES = {
  "math": "Mathématiques", "maths": "Mathématiques",
  "mat": "Mathématiques", "matsh": "Mathématiques",
  "mathematique": "Mathématiques", "mathematiques": "Mathématiques",
  "info": "Informatique", "informatique": "Informatique",
  "code": "Informatique", "dev": "Informatique",
  "compu": "Informatique", "computer": "Informatique",
  "python": "Informatique", "java": "Informatique",
  "javascript": "Informatique", "react": "Informatique",
  "linux": "Informatique", "unix": "Informatique",
  "bash": "Informatique", "crypto": "Informatique",
  "blockchain": "Informatique",
  "ia": "Intelligence Artificielle",
  "ml": "Intelligence Artificielle",
  "machine learning": "Intelligence Artificielle",
  "deep learning": "Intelligence Artificielle",
  "cyber": "Cybersécurité",
  "cybersecurite": "Cybersécurité",
  "hacking": "Cybersécurité",
  "reseau": "Réseaux", "cisco": "Réseaux",
  "philo": "Philosophie", "filosophie": "Philosophie",
  "bio": "Biologie",
  "svt": "SVT",
  "physique": "Physique", "phy": "Physique",
  "phyique": "Physique", "fizique": "Physique",
  "chimie": "Chimie", "chim": "Chimie", "chimei": "Chimie",
  "pc": "Physique-Chimie", "phys": "Physique-Chimie",
  "biochimie": "Biochimie", "bio-chimie": "Biochimie",
  "francais": "Français", "fr": "Français",
  "anglais": "Anglais", "eng": "Anglais",
  "english": "Anglais", "aghlais": "Anglais",
  "toefl": "Préparation aux Examens",
  "toeic": "Préparation aux Examens",
  "ielts": "Préparation aux Examens",
  "delf": "Préparation aux Examens",
  "dalf": "Préparation aux Examens",
  "tcf": "Préparation aux Examens",
  "espagnol": "Espagnol", "esp": "Espagnol", "spanish": "Espagnol",
  "allemand": "Allemand", "german": "Allemand",
  "italien": "Italien", "ita": "Italien", "italiano": "Italien",
  "portugais": "Portugais", "port": "Portugais",
  "arabe": "Arabe", "ar": "Arabe",
  "chinois": "Chinois", "mandarin": "Chinois",
  "japonais": "Japonais", "jap": "Japonais",
  "russe": "Russe",
  "histoire": "Histoire", "histo": "Histoire", "histore": "Histoire",
  "geo": "Géographie", "geograhy": "Géographie",
  "hg": "Histoire-Géographie", "histoire-geo": "Histoire-Géographie",
  "eco": "Économie", "economie": "Économie",
  "ses": "SES",
  "sport": "Sport", "eps": "Sport",
  "foot": "Sport", "football": "Sport",
  "basket": "Sport", "tennis": "Sport",
  "natation": "Sport", "yoga": "Sport",
  "pilates": "Sport", "fitness": "Sport",
  "musique": "Musique", "music": "Musique",
  "piano": "Musique", "guitare": "Musique",
  "violon": "Musique", "solfege": "Musique",
  "arts": "Arts", "art": "Arts",
  "dessin": "Arts Plastiques", "peinture": "Arts Plastiques",
  "sculpture": "Arts Plastiques",
  "theatre": "Arts du Spectacle", "danse": "Arts du Spectacle",
  "photo": "Photographie", "photographie": "Photographie",
  "cine": "Cinéma", "cinema": "Cinéma",
  "cuisine": "Cuisine", "patisserie": "Cuisine",
  "couture": "Mode", "mode": "Mode",
  "latin": "Latin", "grec": "Grec",
  "si": "Technologie", "techno": "Technologie",
  "nsi": "NSI",
  "compta": "Comptabilité", "comptabilite": "Comptabilité",
  "droit": "Droit", "law": "Droit", "juridique": "Droit",
  "marketing": "Marketing", "market": "Marketing",
  "gestion": "Gestion",
  "management": "Management", "mgmt": "Management",
  "finance": "Finance", "bourse": "Finance", "trading": "Finance",
  "invest": "Finance",
  "stmg": "STMG", "sti2d": "STI2D",
  "archi": "Architecture", "architecture": "Architecture",
  "psycho": "Psychologie", "psychologie": "Psychologie",
  "socio": "Sociologie", "sociologie": "Sociologie",
  "medecine": "Médecine", "med": "Médecine",
  "kine": "Kinésithérapie",
  "nutrition": "Diététique", "diet": "Diététique",
  "permis": "Code de la Route", "conduite": "Code de la Route",
  "code route": "Code de la Route",
  "excel": "Bureautique", "word": "Bureautique", "powerpoint": "Bureautique",
  "rhetorique": "Expression Orale", "eloquence": "Expression Orale",
  "oral": "Expression Orale",
  "algo": "Algorithmique", "algorithmique": "Algorithmique",
  "stats": "Statistiques", "statistiques": "Statistiques",
  "proba": "Probabilités", "probabilites": "Probabilités",
  "meca": "Mécanique", "mecanique": "Mécanique",
  "elec": "Électronique", "electronique": "Électronique",
  "thermo": "Thermodynamique",
  "genie": "Génie Civil",
  "bts": "BTS",
  "prepa": "Prépa", "cpge": "Prépa",
  "licence": "Licence",
  "master": "Master",
  "these": "Doctorat",

  /* ── Langues supplémentaires ── */
  "coreen": "Coréen", "korean": "Coréen", "kpop": "Coréen",
  "turc": "Turc", "turkish": "Turc",
  "hebreu": "Hébreu", "hebrew": "Hébreu",
  "neerlandais": "Néerlandais", "hollandais": "Néerlandais", "dutch": "Néerlandais",
  "polonais": "Polonais", "polish": "Polonais",
  "suedois": "Suédois", "danois": "Danois", "norvegien": "Norvégien",
  "vietnamien": "Vietnamien", "thai": "Thaï",
  "persan": "Persan", "farsi": "Persan",
  "hindi": "Hindi", "urdu": "Ourdou",
  "swahili": "Swahili",
  "fle": "Français Langue Étrangère", "fra": "Français Langue Étrangère",

  /* ── Sport ── */
  "boxe": "Boxe", "muay": "Boxe Thaïlandaise",
  "judo": "Judo", "karate": "Karaté", "jujitsu": "Jiu-Jitsu",
  "mma": "Arts Martiaux", "martial": "Arts Martiaux",
  "rugby": "Rugby", "handball": "Handball", "volley": "Volleyball",
  "badminton": "Badminton", "ping": "Tennis de Table", "pongpong": "Tennis de Table",
  "escalade": "Escalade", "velo": "Cyclisme", "cyclisme": "Cyclisme",
  "musculation": "Musculation", "muscu": "Musculation",
  "course": "Running", "running": "Running", "marathon": "Running",
  "equitation": "Équitation", "cheval": "Équitation",
  "golf": "Golf", "ski": "Ski", "snowboard": "Ski",
  "surf": "Surf", "natation": "Natation", "plongee": "Plongée",
  "gym": "Gymnastique", "gymnastique": "Gymnastique",
  "stretching": "Stretching", "crossfit": "CrossFit",

  /* ── Musique ── */
  "guitare electrique": "Guitare", "ukulele": "Ukulélé",
  "basse": "Basse", "batterie": "Batterie",
  "saxophone": "Saxophone", "sax": "Saxophone",
  "trompette": "Trompette", "flute": "Flûte",
  "chant": "Chant", "chorale": "Chant", "vocal": "Chant",
  "harmonie": "Harmonie Musicale", "composition": "Composition Musicale",
  "dj": "DJ / Musique Électronique", "beatmaking": "Beatmaking",
  "prod": "Production Musicale", "production musicale": "Production Musicale",

  /* ── Arts visuels & créatifs ── */
  "aquarelle": "Aquarelle", "acrylique": "Peinture Acrylique",
  "huile": "Peinture à l'Huile",
  "illustration": "Illustration", "illus": "Illustration",
  "manga": "Manga / BD", "bd": "Manga / BD", "bande dessinee": "Manga / BD",
  "calligraphie": "Calligraphie",
  "ceramique": "Céramique", "poterie": "Céramique",
  "gravure": "Gravure", "encre": "Dessin à l'Encre",

  /* ── Design & digital ── */
  "figma": "Design UI/UX", "uxui": "Design UI/UX", "ux": "Design UI/UX",
  "design": "Design", "webdesign": "Web Design",
  "photoshop": "Retouche Photo", "lightroom": "Retouche Photo",
  "illustrator": "Illustration Digitale", "indesign": "PAO",
  "premiere": "Montage Vidéo", "montage": "Montage Vidéo",
  "aftereffects": "Motion Design", "motion": "Motion Design",
  "blender": "Modélisation 3D", "3d": "Modélisation 3D",

  /* ── Développement / Tech ── */
  "html": "Développement Web", "css": "Développement Web",
  "typescript": "Développement Web", "ts": "Développement Web",
  "nodejs": "Développement Web", "node": "Développement Web",
  "swift": "Développement Mobile", "kotlin": "Développement Mobile",
  "flutter": "Développement Mobile", "dart": "Développement Mobile",
  "android": "Développement Mobile", "ios": "Développement Mobile",
  "cplus": "C / C++", "cpp": "C / C++",
  "sql": "Base de Données", "bdd": "Base de Données", "mysql": "Base de Données",
  "git": "Git / GitHub", "github": "Git / GitHub",
  "devops": "DevOps", "docker": "DevOps", "cloud": "Cloud Computing",
  "aws": "Cloud Computing", "azure": "Cloud Computing",
  "data": "Data Science", "datascience": "Data Science",
  "excel avance": "Excel Avancé", "vba": "VBA / Macros",
  "powerbi": "Power BI", "tableau": "Data Visualisation",
  "seo": "SEO / Marketing Digital", "sem": "SEO / Marketing Digital",
  "reseaux sociaux": "Réseaux Sociaux", "instagram": "Réseaux Sociaux",

  /* ── Business / Entrepreneuriat ── */
  "entrepr": "Entrepreneuriat", "startup": "Entrepreneuriat",
  "pitch": "Pitch / Prise de Parole", "prise de parole": "Pitch / Prise de Parole",
  "business plan": "Business Plan", "bplan": "Business Plan",
  "rh": "Ressources Humaines", "recrutement": "Ressources Humaines",
  "negociation": "Négociation", "vente": "Techniques de Vente",
  "commercial": "Techniques de Vente",
  "immobilier": "Immobilier", "immo": "Immobilier",
  "assurance": "Assurance", "banque": "Banque",
  "fiscalite": "Fiscalité", "impots": "Fiscalité",
  "audit": "Audit", "controle de gestion": "Contrôle de Gestion",

  /* ── Bien-être & développement personnel ── */
  "meditation": "Méditation", "mindfulness": "Méditation",
  "sophrologie": "Sophrologie",
  "coaching": "Coaching Personnel", "coach": "Coaching Personnel",
  "confiance": "Développement Personnel", "confiance en soi": "Développement Personnel",
  "memoire": "Techniques de Mémorisation", "memorisation": "Techniques de Mémorisation",
  "speed reading": "Lecture Rapide", "lecture rapide": "Lecture Rapide",

  /* ── Sciences spécialisées ── */
  "astro": "Astronomie", "astronomie": "Astronomie",
  "geologie": "Géologie", "geo sol": "Géologie",
  "biologie moleculaire": "Biologie Moléculaire",
  "genetique": "Génétique",
  "optique": "Optique", "acoustique": "Acoustique",
  "thermodynamique": "Thermodynamique",
  "electromagnetisme": "Électromagnétisme",

  /* ── Aide scolaire générale ── */
  "soutien": "Soutien Scolaire", "aide": "Soutien Scolaire",
  "devoirs": "Aide aux Devoirs", "tutorat": "Soutien Scolaire",
  "methodologie": "Méthodologie", "methode": "Méthodologie",
  "dissertation": "Méthodologie", "oral": "Expression Orale",
  "bac": "Préparation Bac", "brevet": "Préparation Brevet",
  "concours": "Préparation Concours",
  "parcours sup": "Parcoursup", "parcoursup": "Parcoursup",
  "grande ecole": "Grandes Écoles", "hec": "Grandes Écoles",

  /* ── Diplômes / niveaux ── */
  "cap": "CAP", "bep": "BEP",
  "but": "BUT", "dut": "DUT",
  "dcg": "DCG", "dscg": "DSCG",
  "grmat": "Grammaire", "ortho": "Orthographe",
  "conjugaison": "Conjugaison", "conjugaison francaise": "Conjugaison",

  /* ── Jardinage & nature ── */
  "jardinage": "Jardinage", "jardin": "Jardinage", "jardinage potager": "Jardinage",
  "potager": "Jardinage", "fleurs": "Jardinage", "horticulture": "Horticulture",
  "permaculture": "Permaculture", "permac": "Permaculture",
  "apiculture": "Apiculture", "abeilles": "Apiculture",
  "compostage": "Compostage", "compost": "Compostage",
  "botanique": "Botanique", "plantes": "Botanique",
  "peche": "Pêche", "aquaponie": "Aquaponie",
  "mycologie": "Mycologie", "champignons": "Mycologie",

  /* ── Bricolage & artisanat ── */
  "bricolage": "Bricolage", "brico": "Bricolage",
  "menuiserie": "Menuiserie", "charpente": "Charpente",
  "plomberie": "Plomberie",
  "electricite maison": "Électricité Domestique",
  "maconnerie": "Maçonnerie",
  "peinture maison": "Peinture Intérieure",
  "carrelage": "Carrelage",
  "mecanique": "Mécanique Auto", "mecanique auto": "Mécanique Auto",
  "soudure": "Soudure",
  "impression 3d": "Impression 3D", "imprimante 3d": "Impression 3D",
  "robotique": "Robotique", "robot": "Robotique",
  "electronique": "Électronique", "arduino": "Électronique",
  "raspberry": "Électronique",

  /* ── Couture & textile ── */
  "tricot": "Tricot", "crochet": "Crochet",
  "broderie": "Broderie", "broder": "Broderie",
  "couture": "Couture", "patron": "Couture",
  "tapisserie": "Tapisserie", "tissage": "Tissage",
  "teinture": "Teinture Textile",
  "macrame": "Macramé",

  /* ── Gastronomie & boissons ── */
  "oenologie": "Œnologie", "vin": "Œnologie", "degustation": "Œnologie",
  "cocktail": "Mixologie", "mixologie": "Mixologie", "bartending": "Mixologie",
  "boulangerie": "Boulangerie", "pain": "Boulangerie", "boulange": "Boulangerie",
  "patisserie": "Pâtisserie", "gateau": "Pâtisserie",
  "chocolat": "Chocolaterie", "confiserie": "Confiserie",
  "charcuterie": "Charcuterie", "fromage": "Fromagerie",
  "sushi": "Cuisine Japonaise", "wok": "Cuisine Asiatique",
  "vegan": "Cuisine Vegan", "vegetarien": "Cuisine Végétarienne",

  /* ── Beauté & bien-être ── */
  "maquillage": "Maquillage", "makeup": "Maquillage",
  "coiffure": "Coiffure", "coupe": "Coiffure",
  "esthétique": "Esthétique", "soin": "Esthétique",
  "massage": "Massage", "reflexologie": "Réflexologie",

  /* ── Jeux & loisirs créatifs ── */
  "echecs": "Échecs", "chess": "Échecs",
  "go": "Go (Jeu)", "shogi": "Shogi",
  "poker": "Poker", "bridge": "Bridge",
  "scrabble": "Scrabble", "mots croises": "Mots Croisés",
  "jeux de societe": "Jeux de Société",
  "origami": "Origami", "papier": "Origami",
  "magie": "Magie / Prestidigitation", "prestidigitation": "Magie / Prestidigitation",
  "escape": "Escape Game", "puzzle": "Puzzles",
  "jeux video": "Développement Jeux Vidéo", "game design": "Développement Jeux Vidéo",
  "unity": "Développement Jeux Vidéo", "unreal": "Développement Jeux Vidéo",
  "streaming": "Streaming / Contenu", "youtube": "Streaming / Contenu",
  "twitch": "Streaming / Contenu", "podcast": "Podcast",

  /* ── Écriture & expression ── */
  "ecriture": "Écriture Créative", "creative writing": "Écriture Créative",
  "roman": "Écriture Créative", "scenario": "Scénario",
  "journalisme": "Journalisme", "redaction": "Rédaction",
  "blog": "Rédaction Web", "copywriting": "Copywriting",
  "slam": "Slam / Poésie", "poesie": "Slam / Poésie",

  /* ── Collection & patrimoine ── */
  "genealogie": "Généalogie", "famille": "Généalogie",
  "numismatique": "Numismatique", "philatelie": "Philatélie",
  "antiquites": "Antiquités", "brocante": "Brocante",

  /* ── Arts martiaux & disciplines corporelles ── */
  "qi gong": "Qi Gong", "qigong": "Qi Gong",
  "tai chi": "Tai Chi", "taichi": "Tai Chi",

  /* ── Concepts maths → Mathématiques ── */
  "derivation": "Mathématiques", "derivee": "Mathématiques", "derive": "Mathématiques",
  "integration": "Mathématiques", "integrale": "Mathématiques", "primitive": "Mathématiques",
  "limite": "Mathématiques", "suite": "Mathématiques", "convergence": "Mathématiques",
  "equation": "Mathématiques", "inequation": "Mathématiques",
  "trigonometrie": "Mathématiques", "sinus": "Mathématiques", "cosinus": "Mathématiques",
  "logarithme": "Mathématiques", "exponentielle": "Mathématiques",
  "algebre": "Mathématiques", "geometrie": "Mathématiques",
  "vecteur": "Mathématiques", "matrice": "Mathématiques", "determinant": "Mathématiques",
  "polynome": "Mathématiques", "fonction": "Mathématiques",
  "combinatoire": "Mathématiques", "denombrement": "Mathématiques",
  "complexe": "Mathématiques", "nombre complexe": "Mathématiques",
  "arithmetique": "Mathématiques", "pgcd": "Mathématiques",
  "topologie": "Mathématiques", "analyse": "Mathématiques",
  "calcul": "Mathématiques", "calcul differentiel": "Mathématiques",

  /* ── Concepts physique → Physique ── */
  "relativite": "Physique", "relativite restreinte": "Physique",
  "relativite generale": "Physique", "einstein": "Physique",
  "quantique": "Physique", "mecanique quantique": "Physique",
  "quanta": "Physique", "photon": "Physique",
  "gravitation": "Physique", "gravite": "Physique",
  "thermodynamique": "Physique", "entropie": "Physique",
  "ondes": "Physique", "frequence": "Physique", "resonance": "Physique",
  "electricite": "Physique", "magnetisme": "Physique",
  "circuit": "Physique", "condensateur": "Physique", "bobine": "Physique",
  "force": "Physique", "energie": "Physique", "travail": "Physique",
  "cinematique": "Physique", "dynamique": "Physique",
  "optique geometrique": "Physique", "refraction": "Physique", "diffraction": "Physique",
  "radioactivite": "Physique", "nucleaire": "Physique",
  "newton": "Physique", "kepler": "Physique",

  /* ── Concepts chimie → Chimie ── */
  "molecule": "Chimie", "atome": "Chimie", "electron": "Chimie",
  "reaction chimique": "Chimie", "oxydation": "Chimie", "reduction": "Chimie",
  "acide": "Chimie", "base": "Chimie", "ph": "Chimie",
  "liaison covalente": "Chimie", "tableau periodique": "Chimie",
  "mole": "Chimie", "concentration": "Chimie", "solution": "Chimie",
  "titration": "Chimie", "dosage": "Chimie",
  "polymere": "Chimie", "synthese": "Chimie",

  /* ── Concepts biologie / SVT ── */
  "adn": "SVT", "arn": "SVT", "gene": "SVT", "genome": "SVT",
  "chromosome": "SVT", "cellule": "SVT", "mitose": "SVT", "meiose": "SVT",
  "evolution": "SVT", "darwin": "SVT", "selection naturelle": "SVT",
  "ecosysteme": "SVT", "biodiversite": "SVT",
  "photosynthese": "SVT", "respiration cellulaire": "SVT",
  "neurone": "SVT", "synapse": "SVT", "systeme nerveux": "SVT",
  "hormone": "SVT", "enzyme": "SVT",
  "bacterie": "SVT", "virus": "SVT", "immunite": "SVT",

  /* ── Concepts philosophie → Philosophie ── */
  "socrate": "Philosophie", "platon": "Philosophie", "aristote": "Philosophie",
  "descartes": "Philosophie", "kant": "Philosophie", "hegel": "Philosophie",
  "nietzsche": "Philosophie", "sartre": "Philosophie", "camus": "Philosophie",
  "rousseau": "Philosophie", "voltaire": "Philosophie", "montaigne": "Philosophie",
  "spinoza": "Philosophie", "leibniz": "Philosophie", "locke": "Philosophie",
  "epicure": "Philosophie", "stoicisme": "Philosophie", "epicurisme": "Philosophie",
  "metaphysique": "Philosophie", "ontologie": "Philosophie",
  "ethique": "Philosophie", "morale": "Philosophie",
  "epistemologie": "Philosophie", "logique": "Philosophie",
  "conscience": "Philosophie", "liberte": "Philosophie",
  "existence": "Philosophie", "existentialisme": "Philosophie",
  "dialectique": "Philosophie", "rationalisme": "Philosophie",
  "empirisme": "Philosophie", "phenomenologie": "Philosophie",
  "maieutique": "Philosophie", "allegorie": "Philosophie",

  /* ── Concepts histoire ── */
  "revolution francaise": "Histoire", "napoleon": "Histoire",
  "premiere guerre": "Histoire", "deuxieme guerre": "Histoire",
  "ww1": "Histoire", "ww2": "Histoire", "guerre mondiale": "Histoire",
  "holocauste": "Histoire", "shoah": "Histoire",
  "antiquite": "Histoire", "moyen age": "Histoire", "renaissance": "Histoire",
  "louis xiv": "Histoire", "absolutisme": "Histoire",
  "colonisation": "Histoire", "decolonisation": "Histoire",
  "guerre froide": "Histoire", "urss": "Histoire",
  "mai 68": "Histoire", "resistance": "Histoire",

  /* ── Concepts littérature / français ── */
  "dissertation": "Français", "commentaire": "Français",
  "analyse litteraire": "Français", "explication de texte": "Français",
  "roman": "Français", "poesie": "Français", "theatre": "Français",
  "baudelaire": "Français", "racine": "Français", "moliere": "Français",
  "victor hugo": "Français", "balzac": "Français", "zola": "Français",
  "flaubert": "Français", "proust": "Français",
  "stylistique": "Français", "rhetorique": "Français",
  "narration": "Français", "figures de style": "Français",

  /* ── Économie / SES ── */
  "pib": "Économie", "croissance": "Économie", "inflation": "Économie",
  "chomage": "Économie", "keynes": "Économie", "smith": "Économie",
  "offre demande": "Économie", "marche": "Économie",
  "mondialisation": "SES", "inegalites": "SES", "stratification": "SES",
  "bourdieu": "SES", "durkheim": "SES", "weber": "SES"
};

function normalizeText(str) {
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function levenshtein(a, b) {
  var matrix = [];
  var i, j;
  for (i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1]
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1] + 1, matrix[i][j-1] + 1, matrix[i-1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function resolveAlias(input) {
  var normalized = normalizeText(input);
  if (!normalized || normalized.length < 2) return null;

  // Match exact
  var key, matiere;
  for (key in ALIASES) {
    if (ALIASES.hasOwnProperty(key)) {
      matiere = ALIASES[key];
      if (normalizeText(key) === normalized) return matiere;
    }
  }

  // Match partiel (commence par, min 3 chars)
  if (normalized.length >= 3) {
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key)) {
        if (normalizeText(key).indexOf(normalized) === 0) return ALIASES[key];
      }
    }
  }

  // Match partiel inverse : l'input commence par la clé (ex: "mathematique" → key "math")
  if (normalized.length >= 4) {
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key)) {
        var normKey = normalizeText(key);
        if (normKey.length >= 4 && normalized.startsWith(normKey)) return ALIASES[key];
      }
    }
  }

  // Tolérance fautes (Levenshtein ≤ 2, min 4 chars)
  if (normalized.length >= 4) {
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key)) {
        var dist = levenshtein(normalized, normalizeText(key));
        if (dist <= 2) return ALIASES[key];
      }
    }
  }

  // Résolution par tokens — "cours sur socrate" → essaie chaque mot
  // Ignore les mots vides (stopwords) et les mots < 4 chars
  var STOPWORDS = {'le':1,'la':1,'les':1,'un':1,'une':1,'des':1,'de':1,'du':1,'et':1,'en':1,'au':1,'aux':1,'sur':1,'par':1,'pour':1,'avec':1,'dans':1,'qui':1,'que':1,'cours':1,'classe':1,'apprendre':1,'apprends':1,'apprendre':1,'enseigner':1,'tutoriel':1,'tuto':1,'initiation':1};
  var tokens = normalized.split(/\s+/);
  // Essaie d'abord les bigrammes (2 mots consécutifs) puis les mots seuls
  for (var ti = 0; ti < tokens.length - 1; ti++) {
    var bigram = tokens[ti] + ' ' + tokens[ti + 1];
    if (bigram.length >= 4 && ALIASES[bigram]) return ALIASES[bigram];
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key) && normalizeText(key) === bigram) return ALIASES[key];
    }
  }
  for (var ti = 0; ti < tokens.length; ti++) {
    var tok = tokens[ti];
    if (tok.length < 4 || STOPWORDS[tok]) continue;
    // Exact match sur ce token
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key) && normalizeText(key) === tok) return ALIASES[key];
    }
    // Levenshtein ≤ 1 sur ce token (min 5 chars pour éviter faux positifs)
    if (tok.length >= 5) {
      for (key in ALIASES) {
        if (ALIASES.hasOwnProperty(key)) {
          var normKey = normalizeText(key);
          if (normKey.length >= 4 && levenshtein(tok, normKey) <= 1) return ALIASES[key];
        }
      }
    }
  }

  return null;
}

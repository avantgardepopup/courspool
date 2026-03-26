/* ── CoursPool — Dictionnaire d'alias de recherche ── */
var ALIASES = {
  "math": "Mathématiques", "maths": "Mathématiques",
  "mat": "Mathématiques", "matsh": "Mathématiques",
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
  "these": "Doctorat"
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

  // Tolérance fautes (Levenshtein ≤ 2, min 4 chars)
  if (normalized.length >= 4) {
    for (key in ALIASES) {
      if (ALIASES.hasOwnProperty(key)) {
        var dist = levenshtein(normalized, normalizeText(key));
        if (dist <= 2) return ALIASES[key];
      }
    }
  }

  return null;
}

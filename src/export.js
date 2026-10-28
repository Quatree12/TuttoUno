// ===========================================================================
// TuttoUno! — Export et sauvegarde
// ===========================================================================
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Tes données vivent dans le stockage local de Safari, sur ton iPhone, et
// nulle part ailleurs. Vider les données de site, changer de téléphone ou
// naviguer en privé les efface définitivement, sans recours.
//
// Cet export est la seule copie qui survit à ces situations.
//
// CE QU'IL CONTIENT
//   • tes candidatures et leurs notes
//   • tes références de documents (métadonnées seulement)
//   • ton profil et tes préférences
//
// CE QU'IL NE CONTIENT PAS
//   • aucun CV, aucune lettre : l'application ne stocke pas de fichiers.
//     Le fichier exporté le dit lui-même dans son en-tête.
//
// SÉPARATION VOLONTAIRE
// ---------------------
// Ce module ne connaît ni React, ni l'interface. Ce sont des fonctions pures :
// elles reçoivent un objet, elles en retournent un autre.
// ===========================================================================

/**
 * Horodatage lisible, utilisé pour nommer le fichier exporté.
 * Exemple : « 2026-10-28_14h32 »
 */
export function exportStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}h${p(date.getMinutes())}`
  );
}

/**
 * Construit l'objet de sauvegarde à partir de l'état de l'application.
 *
 * @param {{ version: number, profile: object, applications: object[], documents: object[] }} state
 * @returns {object} l'objet complet, prêt à être sérialisé en JSON
 */
export function buildBackup(state) {
  return {
    // L'en-tête est destiné à un humain qui ouvrirait le fichier dans un an
    // sans se souvenir de ce que c'est. Il répond aux questions évidentes.
    _tuttouno: {
      application: "TuttoUno!",
      slogan: "Tout au même endroit. Prêt pour la suite.",
      format: "sauvegarde-locale",
      format_version: 1,
      storage_version: state.version,
      exported_at: new Date().toISOString(),
      origine: "Stockage local du navigateur (localStorage)",
      contient_fichiers: false,
      avertissement:
        "Cette sauvegarde contient tes données textuelles : candidatures, " +
        "références de documents et profil. Elle ne contient aucun CV ni " +
        "lettre, car l'application ne stocke pas encore de fichiers.",
    },
    version: state.version,
    profile: state.profile,
    applications: state.applications,
    documents: state.documents,
  };
}

/**
 * Sérialise une sauvegarde en texte JSON.
 * Indenté, pour rester lisible si tu ouvres le fichier.
 */
export function serializeBackup(state) {
  return JSON.stringify(buildBackup(state), null, 2);
}

/**
 * Nom de fichier suggéré pour une sauvegarde.
 */
export function backupFilename(date = new Date()) {
  return `tuttouno-sauvegarde-${exportStamp(date)}.json`;
}

// ---------------------------------------------------------------------------
// Restauration
// ---------------------------------------------------------------------------

/**
 * Valide et normalise un contenu de sauvegarde.
 *
 * Ne lance jamais d'exception : retourne toujours un objet.
 * C'est volontaire — une erreur d'import ne doit pas casser l'application,
 * elle doit produire un message compréhensible.
 *
 * @param {string} text  le contenu brut du fichier
 * @param {object} emptyState  état vide de référence, pour les valeurs par défaut
 * @param {number} storageVersion  version de stockage actuelle de l'application
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function parseBackup(text, emptyState, storageVersion) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Le contenu est vide. Rien n'a été importé." };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        "Ce texte n'est pas du JSON valide. Vérifie que tu as bien copié " +
        "l'intégralité du fichier, du premier « { » au dernier « } ».",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Le fichier ne contient pas un objet de sauvegarde.",
    };
  }

  if (!Array.isArray(parsed.applications)) {
    return {
      ok: false,
      error:
        "La liste des candidatures est absente. Est-ce bien une sauvegarde " +
        "TuttoUno! ?",
    };
  }

  if (!Array.isArray(parsed.documents)) {
    return {
      ok: false,
      error: "La liste des documents est absente de cette sauvegarde.",
    };
  }

  return {
    ok: true,
    data: {
      version: storageVersion,
      profile: { ...emptyState.profile, ...(parsed.profile ?? {}) },
      applications: parsed.applications,
      documents: parsed.documents,
    },
  };
}

/**
 * Résumé lisible d'une sauvegarde, pour l'afficher avant de l'importer.
 */
export function describeBackup(parsed) {
  const meta = parsed._tuttouno ?? {};
  return {
    exportedAt: meta.exported_at ?? null,
    origin: meta.origine ?? "Origine inconnue",
    applications: Array.isArray(parsed.applications)
      ? parsed.applications.length
      : 0,
    documents: Array.isArray(parsed.documents) ? parsed.documents.length : 0,
    displayName: parsed.profile?.displayName?.trim() || "",
  };
}

// ---------------------------------------------------------------------------
// Enregistrement sur l'appareil
// ---------------------------------------------------------------------------

/**
 * Propose le texte comme fichier à enregistrer.
 *
 * Sur iPhone, la voie fiable est la fenêtre de partage native : elle seule
 * permet d'écrire dans Fichiers ou iCloud Drive. Elle n'est pas garantie sur
 * tous les navigateurs, et elle échoue en mode navigation privée.
 *
 * Retourne toujours un objet — jamais d'exception :
 *   { partage: true }                  → la fenêtre de partage s'est ouverte
 *   { partage: false, annule: true }   → l'utilisateur a fermé la fenêtre
 *   { partage: false, raison: "..." }  → le partage n'est pas disponible
 *
 * @param {string} text     contenu à enregistrer
 * @param {string} filename nom de fichier suggéré
 */
export async function shareText(text, filename) {
  let file;
  try {
    file = new File([new Blob([text], { type: "application/json" })], filename, {
      type: "application/json",
    });
  } catch {
    return { partage: false, raison: "creation_fichier_impossible" };
  }

  if (typeof navigator === "undefined" || !navigator.canShare) {
    return { partage: false, raison: "api_indisponible" };
  }

  let peutPartager;
  try {
    peutPartager = navigator.canShare({ files: [file] });
  } catch {
    return { partage: false, raison: "api_indisponible" };
  }

  if (!peutPartager) {
    return { partage: false, raison: "fichiers_non_partageables" };
  }

  try {
    await navigator.share({ files: [file], title: "Sauvegarde TuttoUno!" });
    return { partage: true };
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { partage: false, annule: true };
    }
    return { partage: false, raison: "partage_refuse" };
  }
}

/**
 * Copie du texte dans le presse-papiers.
 * Retourne true si la copie a réussi, false sinon.
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // On tente la méthode de repli ci-dessous.
  }

  // Repli : un champ temporaire + execCommand. Obsolète mais encore utile
  // là où l'API moderne est refusée (contexte non sécurisé, iOS ancien).
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Taille lisible d'un texte, pour l'afficher à l'utilisateur.
 */
export function textSize(text) {
  try {
    return new Blob([text]).size;
  } catch {
    return text.length;
  }
}

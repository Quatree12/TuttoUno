// ===========================================================================
// TuttoUno! — Couche Supabase
// ===========================================================================
//
// Ce fichier expose un « état de connexion » que l'interface affiche
// honnêtement (Profil → État du backend).
//
// Tant que VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ne sont pas renseignées
// avec de vraies valeurs, l'application tourne en MODE DÉMONSTRATION :
// tout passe par localStorage. Rien ne quitte le téléphone.
//
// ⚠️  Aucun appel de lecture ou d'écriture vers les tables n'est fait ici.
// ===========================================================================

import { createClient } from "@supabase/supabase-js";

const RAW_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const RAW_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/**
 * Détecte le cas classique : avoir collé le modèle d'exemple tel quel.
 */
function looksLikePlaceholder(value) {
  if (!value) return true;
  const v = value.toLowerCase();
  return (
    v.includes("xxxx") ||
    v.includes("exemple") ||
    v.includes("your-project") ||
    v.includes("replace") ||
    v === "undefined" ||
    v === "null"
  );
}

const urlPresent = RAW_URL.length > 0 && !looksLikePlaceholder(RAW_URL);
const keyPresent = RAW_KEY.length > 0 && !looksLikePlaceholder(RAW_KEY);

let urlIsValid = false;
try {
  const parsed = new URL(RAW_URL);
  urlIsValid =
    parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
} catch {
  urlIsValid = false;
}

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
export const supabase =
  urlPresent && keyPresent && urlIsValid
    ? createClient(RAW_URL, RAW_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

/** @type {BackendState} */
export const backendState = (() => {
  if (!urlPresent || !keyPresent) {
    const missing = [];
    if (!urlPresent) missing.push("VITE_SUPABASE_URL");
    if (!keyPresent) missing.push("VITE_SUPABASE_ANON_KEY");

    return {
      configured: false,
      mode: "demo",
      label: "Mode démonstration",
      detail:
        `Variables d'environnement absentes ou laissées à l'exemple : ` +
        `${missing.join(", ")}. TuttoUno! fonctionne, mais uniquement avec ` +
        `les données fictives et la sauvegarde locale du navigateur. ` +
        `Rien n'est envoyé sur Internet.`,
      tone: "coral",
      urlOrigin: "",
    };
  }

  if (!urlIsValid) {
    return {
      configured: false,
      mode: "demo",
      label: "Configuration invalide",
      detail:
        "VITE_SUPABASE_URL n'a pas le format attendu " +
        "(https://xxxxxxxx.supabase.co). Vérifie la valeur dans ton fichier .env.",
      tone: "coral",
      urlOrigin: "",
    };
  }

  let origin = "";
  try {
    origin = new URL(RAW_URL).origin;
  } catch {
    origin = "";
  }

  return {
    configured: true,
    mode: "configured",
    label: "Backend configuré",
    detail:
      `Client Supabase créé pour ${origin}. Attention : « configuré » ne veut ` +
      `pas dire « données enregistrées ». Cette V1 continue d'utiliser la ` +
      `sauvegarde locale du navigateur ; la synchronisation réelle sera ` +
      `branchée après l'authentification et la vérification des politiques RLS.`,
    tone: "sage",
    urlOrigin: origin,
  };
})();

export const backendCapabilities = {
  auth: "prepared_not_connected",
  profilesSync: "prepared_not_connected",
  applicationsSync: "prepared_not_connected",
  deadlinesSync: "prepared_not_connected",
  documentsMetadataSync: "prepared_not_connected",
  documentUpload: "not_implemented",
  notifications: "not_implemented",
};

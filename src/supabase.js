// ===========================================================================
// TuttoUno! — Couche Supabase
// ===========================================================================
//
// RÔLE DE CE FICHIER
// ------------------
// Il ne se contente pas de créer un client : il expose un « état de connexion »
// que l'interface affiche honnêtement (Profil → État du backend). C'est ce qui
// permet à l'application de dire « mode démonstration » au lieu de laisser
// croire qu'elle est synchronisée.
//
// PRINCIPE
// --------
// Tant que VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ne sont pas renseignées
// avec de vraies valeurs, l'application tourne en MODE DÉMONSTRATION :
// tout passe par localStorage. Rien ne quitte le téléphone.
//
// ⚠️  DISSOCIATION VOLONTAIRE
// Ce fichier ne contient AUCUN appel de lecture ou d'écriture vers les tables.
// Voir « LIMITE ACTUELLE » en bas de fichier.
// ===========================================================================

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// 1. Lecture des variables d'environnement
// ---------------------------------------------------------------------------

const RAW_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const RAW_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/**
 * Détecte le cas classique : avoir collé le modèle d'exemple tel quel, avec
 * ses « xxxxxxxx » ou son « .exemple.exemple ». Sans ce garde-fou, l'interface
 * afficherait « connecté » puis échouerait à chaque appel réseau avec un
 * message incompréhensible.
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

/**
 * L'URL doit être un vrai https://<ref>.supabase.co.
 */
let urlIsValid = false;
try {
  const parsed = new URL(RAW_URL);
  urlIsValid =
    parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
} catch {
  urlIsValid = false;
}

// ---------------------------------------------------------------------------
// 2. Création du client — ou pas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 3. État de connexion, tel que l'interface le lit
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BackendState
 * @property {boolean} configured  Un client a-t-il réellement pu être créé ?
 * @property {string}  mode        "demo" | "configured"
 * @property {string}  label       Libellé court, affichable tel quel.
 * @property {string}  detail      Explication longue, affichable telle quelle.
 * @property {string}  tone        "sage" | "coral" — teinte de la pastille.
 * @property {string}  urlOrigin   Origine de l'URL, vide en mode démo.
 */

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

// ---------------------------------------------------------------------------
// 4. Capacités réelles — l'interface s'en sert pour rester honnête
// ---------------------------------------------------------------------------

export const backendCapabilities = {
  auth: "prepared_not_connected",
  profilesSync: "prepared_not_connected",
  applicationsSync: "prepared_not_connected",
  deadlinesSync: "prepared_not_connected",
  documentsMetadataSync: "prepared_not_connected",
  documentUpload: "not_implemented",
  notifications: "not_implemented",
};

export const CAPABILITY_LABELS = {
  prepared_not_connected: "Préparé, non connecté",
  not_implemented: "Non implémenté",
  working: "Fonctionnel",
};

// ---------------------------------------------------------------------------
// 5. LIMITE ACTUELLE — à lire avant de croire que « c'est connecté »
// ---------------------------------------------------------------------------
//
// Le client Supabase est bien créé dès que les variables sont renseignées,
// mais AUCUN écran de cette V1 ne l'interroge encore. L'application continue
// d'utiliser localStorage, y compris quand `backendState.configured` vaut true.
//
// C'est un choix délibéré : brancher l'écriture distante avant d'avoir exécuté
// et vérifié les politiques RLS reviendrait à exposer des données personnelles
// sans garantie de cloisonnement. L'écran Profil l'affiche explicitement plutôt
// que de montrer une fausse coche verte.
//
// Ordre correct pour la suite :
//   1. Exécuter le SQL (supabase/schema.sql) dans l'éditeur SQL Supabase.
//   2. Vérifier que RLS est actif sur chaque table.
//   3. Brancher l'authentification par e-mail.
//   4. Seulement ensuite, remplacer la lecture localStorage par les appels
//      `supabase.from("applications")…`, un écran à la fois.
//
// ---------------------------------------------------------------------------

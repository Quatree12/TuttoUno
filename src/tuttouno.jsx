import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  BellOff,
  Briefcase,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Download,
  FileText,
  FolderOpen,
  Home,
  Info,
  LayoutGrid,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  X,
} from "lucide-react";
import { backendState, backendCapabilities, supabase } from "./supabase.js";

// ===========================================================================
// TuttoUno! — « Tout au même endroit. Prêt pour la suite. »
// ===========================================================================
//
// ORGANISATION
// ------------
//   1.  Constantes métier (statuts, catégories, tonalités)
//   2.  Utilitaires de date et de formatage
//   3.  Définition des échéances
//   4.  Données de démonstration (fictives, clairement identifiées)
//   5.  Persistance locale (localStorage) + limites documentées
//   6.  Petits composants d'interface réutilisables
//   7.  Écrans : Accueil, Candidatures, Documents, Échéances, Profil
//   8.  Composant racine : état, navigation, modales, messages
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. CONSTANTES MÉTIER
// ---------------------------------------------------------------------------

const STATUSES = [
  { id: "a_preparer", label: "À préparer", tone: "neutral" },
  { id: "a_envoyer", label: "À envoyer", tone: "info" },
  { id: "envoyee", label: "Envoyée", tone: "info" },
  { id: "en_attente", label: "En attente", tone: "wait" },
  { id: "entretien", label: "Entretien", tone: "highlight" },
  { id: "deuxieme_entretien", label: "Deuxième entretien", tone: "highlight" },
  { id: "offre", label: "Offre reçue", tone: "success" },
  { id: "refusee", label: "Refusée", tone: "danger" },
  { id: "cloturee", label: "Clôturée", tone: "muted" },
];

const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

const ACTIVE_STATUS_IDS = [
  "a_preparer",
  "a_envoyer",
  "envoyee",
  "en_attente",
  "entretien",
  "deuxieme_entretien",
];

const RESPONSE_STATUS_IDS = [
  "entretien",
  "deuxieme_entretien",
  "offre",
  "refusee",
];

const INTERVIEW_STATUS_IDS = ["entretien", "deuxieme_entretien"];

const DOC_CATEGORIES = [
  { id: "cv", label: "CV", icon: FileText },
  { id: "lettre", label: "Lettre de motivation", icon: Pencil },
  { id: "certificat", label: "Certificat", icon: BadgeCheck },
  { id: "diplome", label: "Diplôme", icon: Star },
  { id: "attestation", label: "Attestation", icon: Shield },
  { id: "autre", label: "Autre", icon: FolderOpen },
];

const DOC_CATEGORY_BY_ID = Object.fromEntries(
  DOC_CATEGORIES.map((c) => [c.id, c])
);

const TABS = [
  { id: "accueil", label: "Accueil", icon: Home },
  { id: "candidatures", label: "Candidatures", icon: Briefcase },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "echeances", label: "Échéances", icon: CalendarClock },
  { id: "profil", label: "Profil", icon: User },
];

const STORAGE_KEY = "tuttouno.v1.state";
const STORAGE_VERSION = 1;

const ENCOURAGEMENTS = [
  "Chaque candidature envoyée est une porte frappée.",
  "Le bon poste se cherche, il ne s'attend pas.",
  "Tu avances, même les jours sans réponse.",
  "Une relance faite, c'est une inquiétude en moins.",
  "Ta régularité finira par payer.",
  "Prends soin de toi entre deux envois.",
];

// ---------------------------------------------------------------------------
// 2. UTILITAIRES DE DATE ET DE FORMATAGE
// ---------------------------------------------------------------------------

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function formatDateFr(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
}

function relativeLabel(isoDate) {
  const n = daysUntil(isoDate);
  if (n === null) return "";
  if (n < 0) return `En retard de ${Math.abs(n)} j`;
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return "Demain";
  return `Dans ${n} jours`;
}

function makeId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function truncate(text, max = 60) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// 3. DÉFINITION DES ÉCHÉANCES
// ---------------------------------------------------------------------------
//
// Une échéance n'est pas une table : c'est une VUE calculée, dérivée des
// candidatures. On ne stocke donc jamais deux fois la même information.

function buildDeadlines(applications) {
  const closed = new Set(["refusee", "cloturee"]);
  const out = [];

  for (const app of applications) {
    if (closed.has(app.status)) continue;
    if (app.deadlineDone) continue;

    if (app.followUpDate) {
      const n = daysUntil(app.followUpDate);
      out.push({
        id: `relance_${app.id}`,
        type: "relance",
        title: "Relance prévue",
        company: app.company,
        role: app.role,
        date: app.followUpDate,
        applicationId: app.id,
        days: n,
        state: n < 0 ? "late" : n === 0 ? "today" : "upcoming",
      });
    }

    if (INTERVIEW_STATUS_IDS.includes(app.status) && app.followUpDate) {
      const n = daysUntil(app.followUpDate);
      out.push({
        id: `entretien_${app.id}`,
        type: "entretien",
        title:
          app.status === "deuxieme_entretien"
            ? "Deuxième entretien"
            : "Entretien",
        company: app.company,
        role: app.role,
        date: app.followUpDate,
        applicationId: app.id,
        days: n,
        state: n < 0 ? "late" : n === 0 ? "today" : "upcoming",
      });
    }

    if (
      ["a_preparer", "a_envoyer"].includes(app.status) &&
      app.followUpDate &&
      daysUntil(app.followUpDate) < 0
    ) {
      const n = daysUntil(app.followUpDate);
      out.push({
        id: `limite_${app.id}`,
        type: "limite",
        title: "Date limite dépassée",
        company: app.company,
        role: app.role,
        date: app.followUpDate,
        applicationId: app.id,
        days: n,
        state: "late",
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const DEADLINE_STATE_LABEL = {
  late: "En retard",
  today: "Aujourd'hui",
  upcoming: "À venir",
  done: "Terminé",
};

const DEADLINE_TONE = {
  late: "danger",
  today: "highlight",
  upcoming: "info",
  done: "success",
};

// ---------------------------------------------------------------------------
// 4. DONNÉES DE DÉMONSTRATION
// ---------------------------------------------------------------------------
//
// ⚠️  CES DONNÉES SONT 100 % FICTIVES.
// Elles montrent à quoi ressemble l'application remplie. Au premier lancement,
// elles sont chargées puis ÉCRITES dans localStorage. À partir de là, ce sont
// TES données locales. Pour repartir de zéro : Profil → Réinitialiser.

function buildDemoData() {
  const today = todayISO();
  const shift = (days) => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const apps = [
    {
      id: "demo_app_1",
      company: "Atelier Lumière",
      role: "Chargée de communication",
      location: "Lausanne",
      appliedDate: shift(-21),
      followUpDate: shift(2),
      status: "entretien",
      url: "https://exemple-fictif.test/offre/1",
      notes:
        "Exemple fictif. Premier entretien avec la responsable communication. " +
        "Préparer deux exemples de campagnes menées.",
      lastFollowUp: shift(-3),
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_2",
      company: "Maison Verdier",
      role: "Assistante de direction",
      location: "Genève",
      appliedDate: shift(-14),
      followUpDate: shift(-2),
      status: "en_attente",
      url: "",
      notes:
        "Exemple fictif. Relance prévue, la date est volontairement dépassée " +
        "pour montrer l'état « en retard ».",
      lastFollowUp: shift(-14),
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_3",
      company: "Studio Boreal",
      role: "UX/UI Designer junior",
      location: "Neuchâtel",
      appliedDate: shift(-9),
      followUpDate: shift(0),
      status: "deuxieme_entretien",
      url: "https://exemple-fictif.test/offre/3",
      notes: "Exemple fictif. Deuxième entretien aujourd'hui, format visio.",
      lastFollowUp: shift(-2),
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_4",
      company: "Coopérative du Lac",
      role: "Chargée de projet événementiel",
      location: "Vevey",
      appliedDate: shift(-30),
      followUpDate: shift(-20),
      status: "offre",
      url: "",
      notes:
        "Exemple fictif. Offre reçue — délai de réponse d'une semaine à partir " +
        "de la réception.",
      lastFollowUp: shift(-5),
      deadlineDone: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_5",
      company: "Groupe Ferrero-Sants",
      role: "Responsable administrative",
      location: "Fribourg",
      appliedDate: shift(-45),
      followUpDate: "",
      status: "refusee",
      url: "",
      notes: "Exemple fictif. Refus après entretien téléphonique.",
      lastFollowUp: shift(-25),
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_6",
      company: "Café des Trois Rois",
      role: "Community manager",
      location: "Sion",
      appliedDate: shift(-4),
      followUpDate: shift(6),
      status: "envoyee",
      url: "https://exemple-fictif.test/offre/6",
      notes: "Exemple fictif. Candidature envoyée, accuser réception sous 10 jours.",
      lastFollowUp: shift(-4),
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_app_7",
      company: "Fondation Arc-en-Ciel",
      role: "Coordinatrice de programme",
      location: "Bienne",
      appliedDate: shift(-1),
      followUpDate: shift(12),
      status: "a_envoyer",
      url: "",
      notes:
        "Exemple fictif. Dossier presque prêt, il manque la lettre adaptée.",
      lastFollowUp: "",
      deadlineDone: false,
      createdAt: new Date().toISOString(),
    },
  ];

  const docs = [
    {
      id: "demo_doc_1",
      name: "CV — version générale 2026",
      category: "cv",
      addedAt: shift(-40),
      description:
        "Exemple fictif. Métadonnées de démonstration uniquement — aucun fichier réel n'est stocké.",
      applicationId: "",
      fileName: "",
      fileSize: 0,
    },
    {
      id: "demo_doc_2",
      name: "CV — version communication",
      category: "cv",
      addedAt: shift(-18),
      description:
        "Exemple fictif. Adapté aux postes de communication et d'événementiel.",
      applicationId: "demo_app_1",
      fileName: "",
      fileSize: 0,
    },
    {
      id: "demo_doc_3",
      name: "Lettre — Atelier Lumière",
      category: "lettre",
      addedAt: shift(-21),
      description:
        "Exemple fictif. Lettre personnalisée pour cette candidature précise.",
      applicationId: "demo_app_1",
      fileName: "",
      fileSize: 0,
    },
    {
      id: "demo_doc_4",
      name: "Certificat de travail — poste précédent",
      category: "certificat",
      addedAt: shift(-60),
      description: "Exemple fictif. À joindre sur demande lors des entretiens.",
      applicationId: "",
      fileName: "",
      fileSize: 0,
    },
    {
      id: "demo_doc_5",
      name: "Diplôme — Bachelor",
      category: "diplome",
      addedAt: shift(-90),
      description: "Exemple fictif. Copie scannée à préparer.",
      applicationId: "",
      fileName: "",
      fileSize: 0,
    },
    {
      id: "demo_doc_6",
      name: "Attestation de formation continue",
      category: "attestation",
      addedAt: shift(-12),
      description: "Exemple fictif. Formation suivie cette année.",
      applicationId: "",
      fileName: "",
      fileSize: 0,
    },
  ];

  return {
    profile: {
      displayName: "Alex",
      compactMode: false,
      showDemoData: true,
    },
    applications: apps,
    documents: docs,
  };
}

// ---------------------------------------------------------------------------
// 5. PERSISTANCE LOCALE — ET SES LIMITES
// ---------------------------------------------------------------------------
//
// CE QU'ELLE FAIT
//   Enregistre tes candidatures, tes documents et ton profil dans le stockage
//   local de Safari. Tu peux fermer l'onglet et revenir plus tard.
//
// CE QU'ELLE NE FAIT PAS
//   • Ce n'est PAS une sauvegarde cloud. Rien n'est envoyé sur Internet.
//   • Vider le cache ou les données de site de Safari efface tout.
//   • Changer de navigateur ou de téléphone ne transfère rien.
//   • Le mode Navigation privée ne conserve rien après fermeture.

const EMPTY_STATE = {
  version: STORAGE_VERSION,
  profile: { displayName: "", compactMode: false, showDemoData: false },
  applications: [],
  documents: [],
};

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== STORAGE_VERSION) return null;

    return {
      version: STORAGE_VERSION,
      profile: { ...EMPTY_STATE.profile, ...(parsed.profile ?? {}) },
      applications: Array.isArray(parsed.applications)
        ? parsed.applications
        : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    };
  } catch (err) {
    console.warn("TuttoUno! — état local illisible, réinitialisation.", err);
    return null;
  }
}

function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn("TuttoUno! — enregistrement local impossible.", err);
    return false;
  }
}

function localStateSize() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? new Blob([raw]).size : 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 o";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

// ---------------------------------------------------------------------------
// 6. PETITS COMPOSANTS RÉUTILISABLES
// ---------------------------------------------------------------------------

function Logo({ size = 40, showWordmark = false }) {
  return (
    <span className="tu-logo" aria-label="TuttoUno!">
      <span
        className="tu-logo-mark"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden="true"
      >
        T!
      </span>
      {showWordmark && <span className="tu-logo-word">TuttoUno!</span>}
    </span>
  );
}

function StatusBadge({ statusId }) {
  const status = STATUS_BY_ID[statusId];
  if (!status) return null;
  return (
    <span className={`tu-badge tu-badge--${status.tone}`}>{status.label}</span>
  );
}

function DeadlineBadge({ state }) {
  return (
    <span className={`tu-badge tu-badge--${DEADLINE_TONE[state]}`}>
      {DEADLINE_STATE_LABEL[state]}
    </span>
  );
}

function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="tu-empty">
      <span className="tu-empty-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.75} />
      </span>
      <h3 className="tu-empty-title">{title}</h3>
      <p className="tu-empty-text">{description}</p>
      {action}
    </div>
  );
}

function StatCard({ label, value, tone = "neutral", icon: Icon }) {
  return (
    <div className={`tu-stat tu-stat--${tone}`}>
      <span className="tu-stat-top">
        {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" />}
        <span className="tu-stat-label">{label}</span>
      </span>
      <span className="tu-stat-value">{value}</span>
    </div>
  );
}

function ProgressBar({ value, label }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="tu-progress">
      <div
        className="tu-progress-track"
        role="progressbar"
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="tu-progress-fill" style={{ width: `${safe}%` }} />
      </div>
      <span className="tu-progress-value">{safe} %</span>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, footer }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const firstField = panelRef.current?.querySelector(
      "input, select, textarea, button"
    );
    firstField?.focus?.({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="tu-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tu-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <header className="tu-modal-head">
          <div className="tu-modal-heading">
            <h2 className="tu-modal-title">{title}</h2>
            {subtitle && <p className="tu-modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="tu-icon-btn"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </header>

        <div className="tu-modal-body">{children}</div>

        {footer && <footer className="tu-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="tu-confirm-text">{message}</p>
      <div className="tu-confirm-actions">
        <button type="button" className="tu-btn tu-btn--ghost" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="tu-btn tu-btn--danger"
          onClick={onConfirm}
        >
          <Trash2 size={16} />
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, hint, error, required, children, id }) {
  return (
    <div className="tu-field">
      <label className="tu-field-label" htmlFor={id}>
        {label}
        {required && <span className="tu-required"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="tu-field-hint">{hint}</p>}
      {error && (
        <p className="tu-field-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({ tone = "info", icon: Icon = Info, title, children }) {
  return (
    <div className={`tu-notice tu-notice--${tone}`}>
      <span className="tu-notice-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="tu-notice-body">
        {title && <p className="tu-notice-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. ÉCRANS
// ---------------------------------------------------------------------------

// --- 7.1 Accueil ------------------------------------------------------------

function HomeScreen({ applications, deadlines, profile, onNavigate, onAdd }) {
  const stats = useMemo(() => {
    const active = applications.filter((a) =>
      ACTIVE_STATUS_IDS.includes(a.status)
    ).length;
    const interviews = applications.filter((a) =>
      INTERVIEW_STATUS_IDS.includes(a.status)
    ).length;
    const responses = applications.filter((a) =>
      RESPONSE_STATUS_IDS.includes(a.status)
    ).length;

    const progress = applications.length
      ? (responses / applications.length) * 100
      : 0;

    const recent = [...applications]
      .sort((a, b) => (b.appliedDate ?? "").localeCompare(a.appliedDate ?? ""))
      .slice(0, 3);

    return { active, interviews, responses, progress, recent };
  }, [applications]);

  const nextDeadlines = useMemo(
    () => deadlines.filter((d) => d.state !== "done").slice(0, 3),
    [deadlines]
  );

  const encouragement = useMemo(
    () => ENCOURAGEMENTS[new Date().getDate() % ENCOURAGEMENTS.length],
    []
  );

  const name = profile.displayName?.trim();
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

  return (
    <div className="tu-screen">
      <header className="tu-hero">
        <Logo size={44} />
        <h1 className="tu-hero-title">
          {greeting}
          {name ? `, ${name}` : ""} !
        </h1>
        <p className="tu-hero-slogan">
          Tout au même endroit. Prêt pour la suite.
        </p>
        {!name && (
          <button
            type="button"
            className="tu-inline-link"
            onClick={() => onNavigate("profil")}
          >
            Ajoute ton prénom dans le Profil
            <ChevronRight size={14} />
          </button>
        )}
      </header>

      {applications.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Ta recherche commence ici"
          description="Ajoute une première candidature : l'accueil se remplira de chiffres réels, pas de valeurs décoratives."
          action={
            <button type="button" className="tu-btn tu-btn--primary" onClick={onAdd}>
              <Plus size={18} />
              Ajouter une candidature
            </button>
          }
        />
      ) : (
        <>
          <section className="tu-section" aria-labelledby="stats-title">
            <h2 className="tu-section-title" id="stats-title">
              Vue d'ensemble
            </h2>
            <div className="tu-stats">
              <StatCard
                label="En cours"
                value={stats.active}
                tone="coral"
                icon={Briefcase}
              />
              <StatCard
                label="Entretiens"
                value={stats.interviews}
                tone="pink"
                icon={CalendarClock}
              />
              <StatCard
                label="Réponses"
                value={stats.responses}
                tone="sage"
                icon={CheckCircle2}
              />
            </div>
            <p className="tu-stat-note">
              {applications.length} candidature
              {applications.length > 1 ? "s" : ""} enregistrée
              {applications.length > 1 ? "s" : ""} au total.
            </p>
          </section>

          <section className="tu-section" aria-labelledby="progress-title">
            <h2 className="tu-section-title" id="progress-title">
              Progression
            </h2>
            <div className="tu-card">
              <p className="tu-progress-caption">
                Part de tes candidatures qui ont reçu une réponse de l'employeur.
              </p>
              <ProgressBar
                value={stats.progress}
                label="Progression de la recherche"
              />
            </div>
          </section>

          <section className="tu-section" aria-labelledby="next-title">
            <div className="tu-section-head">
              <h2 className="tu-section-title" id="next-title">
                Prochaines échéances
              </h2>
              <button
                type="button"
                className="tu-inline-link"
                onClick={() => onNavigate("echeances")}
              >
                Tout voir
                <ChevronRight size={14} />
              </button>
            </div>
            {nextDeadlines.length === 0 ? (
              <div className="tu-card tu-card--quiet">
                <p className="tu-muted">
                  Aucune échéance à venir. Rien ne t'attend aujourd'hui.
                </p>
              </div>
            ) : (
              <ul className="tu-plain-list">
                {nextDeadlines.map((d) => (
                  <li key={d.id} className="tu-deadline-row">
                    <span className={`tu-dot tu-dot--${DEADLINE_TONE[d.state]}`} />
                    <div className="tu-deadline-main">
                      <p className="tu-deadline-title">
                        {d.title} · {d.company}
                      </p>
                      <p className="tu-deadline-meta">
                        {formatDateShort(d.date)} — {relativeLabel(d.date)}
                      </p>
                    </div>
                    <DeadlineBadge state={d.state} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tu-section" aria-labelledby="recent-title">
            <div className="tu-section-head">
              <h2 className="tu-section-title" id="recent-title">
                Ajoutées récemment
              </h2>
              <button
                type="button"
                className="tu-inline-link"
                onClick={() => onNavigate("candidatures")}
              >
                Tout voir
                <ChevronRight size={14} />
              </button>
            </div>
            <ul className="tu-plain-list">
              {stats.recent.map((a) => (
                <li key={a.id} className="tu-recent-row">
                  <div className="tu-recent-main">
                    <p className="tu-recent-role">{a.role}</p>
                    <p className="tu-recent-company">
                      {a.company}
                      {a.location ? ` · ${a.location}` : ""}
                    </p>
                  </div>
                  <div className="tu-recent-side">
                    <StatusBadge statusId={a.status} />
                    <span className="tu-recent-date">
                      {formatDateShort(a.appliedDate)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="tu-section" aria-labelledby="shortcuts-title">
            <h2 className="tu-section-title" id="shortcuts-title">
              Raccourcis
            </h2>
            <div className="tu-shortcuts">
              <button type="button" className="tu-shortcut" onClick={onAdd}>
                <Plus size={18} />
                <span>Nouvelle candidature</span>
              </button>
              <button
                type="button"
                className="tu-shortcut"
                onClick={() => onNavigate("documents")}
              >
                <FolderOpen size={18} />
                <span>Mes documents</span>
              </button>
              <button
                type="button"
                className="tu-shortcut"
                onClick={() => onNavigate("echeances")}
              >
                <CalendarClock size={18} />
                <span>Mes échéances</span>
              </button>
            </div>
          </section>

          <p className="tu-encouragement">
            <Sparkles size={15} aria-hidden="true" />
            {encouragement}
          </p>
        </>
      )}
    </div>
  );
}

// --- 7.2 Candidatures -------------------------------------------------------

const SORT_OPTIONS = [
  { id: "applied_desc", label: "Candidature (récente)" },
  { id: "applied_asc", label: "Candidature (ancienne)" },
  { id: "deadline_asc", label: "Échéance (proche)" },
  { id: "deadline_desc", label: "Échéance (lointaine)" },
];

function sortApplications(list, sortId) {
  const copy = [...list];
  switch (sortId) {
    case "applied_asc":
      return copy.sort((a, b) =>
        (a.appliedDate ?? "").localeCompare(b.appliedDate ?? "")
      );
    case "deadline_asc":
      return copy.sort((a, b) => {
        if (!a.followUpDate) return 1;
        if (!b.followUpDate) return -1;
        return a.followUpDate.localeCompare(b.followUpDate);
      });
    case "deadline_desc":
      return copy.sort((a, b) => {
        if (!a.followUpDate) return 1;
        if (!b.followUpDate) return -1;
        return b.followUpDate.localeCompare(a.followUpDate);
      });
    case "applied_desc":
    default:
      return copy.sort((a, b) =>
        (b.appliedDate ?? "").localeCompare(a.appliedDate ?? "")
      );
  }
}

function ApplicationsScreen({
  applications,
  documents,
  onAdd,
  onEdit,
  onDelete,
  onOpenDocuments,
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("tous");
  const [sortId, setSortId] = useState("applied_desc");
  const [detail, setDetail] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = applications;

    if (statusFilter !== "tous") {
      list = list.filter((a) => a.status === statusFilter);
    }

    if (q) {
      list = list.filter(
        (a) =>
          a.company.toLowerCase().includes(q) ||
          a.role.toLowerCase().includes(q) ||
          (a.location ?? "").toLowerCase().includes(q)
      );
    }

    return sortApplications(list, sortId);
  }, [applications, query, statusFilter, sortId]);

  const countsByStatus = useMemo(() => {
    const map = { tous: applications.length };
    for (const s of STATUSES) map[s.id] = 0;
    for (const a of applications) {
      if (map[a.status] !== undefined) map[a.status] += 1;
    }
    return map;
  }, [applications]);

  const docsForApp = useCallback(
    (appId) => documents.filter((d) => d.applicationId === appId),
    [documents]
  );

  return (
    <div className="tu-screen">
      <header className="tu-screen-head">
        <div>
          <h1 className="tu-screen-title">Candidatures</h1>
          <p className="tu-screen-sub">
            {applications.length} enregistrée
            {applications.length > 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          className="tu-btn tu-btn--primary tu-btn--small"
          onClick={onAdd}
        >
          <Plus size={16} />
          Ajouter
        </button>
      </header>

      <div className="tu-toolbar">
        <div className="tu-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Entreprise, poste, lieu…"
            aria-label="Rechercher une candidature"
          />
          {query && (
            <button
              type="button"
              className="tu-search-clear"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tu-toolbar-row">
          <label className="tu-select-wrap">
            <span className="tu-select-label">Statut</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtrer par statut"
            >
              <option value="tous">Tous ({countsByStatus.tous})</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({countsByStatus[s.id] ?? 0})
                </option>
              ))}
            </select>
          </label>

          <label className="tu-select-wrap">
            <span className="tu-select-label">
              <ArrowUpDown size={12} aria-hidden="true" /> Tri
            </span>
            <select
              value={sortId}
              onChange={(e) => setSortId(e.target.value)}
              aria-label="Trier les candidatures"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="Aucune candidature pour l'instant"
          description="Chaque candidature ajoutée alimente le tableau de bord, les échéances et ta progression."
          action={
            <button
              type="button"
              className="tu-btn tu-btn--primary"
              onClick={onAdd}
            >
              <Plus size={18} />
              Ajouter ma première candidature
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Aucun résultat"
          description="Aucune candidature ne correspond à cette recherche ou à ce filtre. Essaie un autre terme ou affiche toutes les candidatures."
          action={
            <button
              type="button"
              className="tu-btn tu-btn--ghost"
              onClick={() => {
                setQuery("");
                setStatusFilter("tous");
              }}
            >
              <RefreshCw size={16} />
              Réinitialiser les filtres
            </button>
          }
        />
      ) : (
        <ul className="tu-cards">
          {filtered.map((a) => {
            const n = daysUntil(a.followUpDate);
            return (
              <li key={a.id} className="tu-card tu-app-card" data-app-id={a.id}>
                <div className="tu-app-head">
                  <div className="tu-app-heading">
                    <h2 className="tu-app-role">{a.role}</h2>
                    <p className="tu-app-company">
                      {a.company}
                      {a.location ? ` · ${a.location}` : ""}
                    </p>
                  </div>
                  <StatusBadge statusId={a.status} />
                </div>

                <dl className="tu-app-meta">
                  <div>
                    <dt>Envoyée le</dt>
                    <dd>{formatDateShort(a.appliedDate)}</dd>
                  </div>
                  <div>
                    <dt>Échéance</dt>
                    <dd>
                      {a.followUpDate ? (
                        <>
                          {formatDateShort(a.followUpDate)}
                          {n !== null && n < 0 && (
                            <span className="tu-late-flag">
                              {" "}
                              · {relativeLabel(a.followUpDate)}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Dernier suivi</dt>
                    <dd>
                      {a.lastFollowUp ? formatDateShort(a.lastFollowUp) : "—"}
                    </dd>
                  </div>
                </dl>

                {a.notes && (
                  <p className="tu-app-notes">{truncate(a.notes, 110)}</p>
                )}

                <div className="tu-app-actions">
                  <button
                    type="button"
                    className="tu-btn tu-btn--ghost tu-btn--small"
                    onClick={() => setDetail(a)}
                  >
                    Détail
                  </button>
                  <button
                    type="button"
                    className="tu-btn tu-btn--ghost tu-btn--small"
                    onClick={() => onEdit(a)}
                  >
                    <Pencil size={14} />
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="tu-btn tu-btn--ghost tu-btn--small tu-btn--danger-text"
                    onClick={() => setPendingDelete(a)}
                  >
                    <Trash2 size={14} />
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detail && (
        <Modal
          title={detail.role}
          subtitle={detail.company}
          onClose={() => setDetail(null)}
        >
          <div className="tu-detail">
            <StatusBadge statusId={detail.status} />

            <dl className="tu-detail-list">
              <div>
                <dt>Entreprise</dt>
                <dd>{detail.company}</dd>
              </div>
              <div>
                <dt>Intitulé du poste</dt>
                <dd>{detail.role}</dd>
              </div>
              <div>
                <dt>Localité</dt>
                <dd>{detail.location || "—"}</dd>
              </div>
              <div>
                <dt>Date de candidature</dt>
                <dd>{formatDateFr(detail.appliedDate)}</dd>
              </div>
              <div>
                <dt>Relance / échéance</dt>
                <dd>
                  {detail.followUpDate
                    ? `${formatDateFr(detail.followUpDate)} — ${relativeLabel(
                        detail.followUpDate
                      )}`
                    : "Aucune"}
                </dd>
              </div>
              <div>
                <dt>Dernier suivi</dt>
                <dd>{formatDateFr(detail.lastFollowUp)}</dd>
              </div>
              <div>
                <dt>Échéance traitée</dt>
                <dd>{detail.deadlineDone ? "Oui" : "Non"}</dd>
              </div>
            </dl>

            <div className="tu-detail-block">
              <p className="tu-detail-label">Notes personnelles</p>
              <p className="tu-detail-text">
                {detail.notes || "Aucune note pour cette candidature."}
              </p>
            </div>

            <div className="tu-detail-block">
              <p className="tu-detail-label">Lien vers l'annonce</p>
              {detail.url ? (
                <a
                  className="tu-external-link"
                  href={detail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={14} />
                  Ouvrir l'annonce
                </a>
              ) : (
                <p className="tu-detail-text tu-muted">Aucun lien enregistré.</p>
              )}
            </div>

            <div className="tu-detail-block">
              <p className="tu-detail-label">
                Documents rattachés ({docsForApp(detail.id).length})
              </p>
              {docsForApp(detail.id).length === 0 ? (
                <p className="tu-detail-text tu-muted">
                  Aucun document rattaché. Les documents se gèrent depuis
                  l'onglet Documents.
                </p>
              ) : (
                <ul className="tu-mini-list">
                  {docsForApp(detail.id).map((d) => (
                    <li key={d.id}>
                      <FileText size={14} aria-hidden="true" />
                      <span>{d.name}</span>
                      <span className="tu-mini-cat">
                        {DOC_CATEGORY_BY_ID[d.category]?.label ?? d.category}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="tu-inline-link"
                onClick={() => {
                  setDetail(null);
                  onOpenDocuments();
                }}
              >
                Gérer les documents
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="tu-detail-actions">
              <button
                type="button"
                className="tu-btn tu-btn--primary"
                onClick={() => {
                  const target = detail;
                  setDetail(null);
                  onEdit(target);
                }}
              >
                <Pencil size={16} />
                Modifier cette candidature
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cette candidature ?"
          message={`« ${pendingDelete.role} » chez ${pendingDelete.company} sera définitivement retirée de l'application. Cette action ne peut pas être annulée.`}
          confirmLabel="Supprimer"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

// --- 7.3 Formulaire de candidature -----------------------------------------

function ApplicationForm({ initialValue, onSave, onCancel }) {
  const isEdit = Boolean(initialValue?.id);

  const [form, setForm] = useState({
    company: initialValue?.company ?? "",
    role: initialValue?.role ?? "",
    location: initialValue?.location ?? "",
    appliedDate: initialValue?.appliedDate ?? todayISO(),
    followUpDate: initialValue?.followUpDate ?? "",
    status: initialValue?.status ?? "a_preparer",
    url: initialValue?.url ?? "",
    notes: initialValue?.notes ?? "",
    lastFollowUp: initialValue?.lastFollowUp ?? "",
  });

  const [errors, setErrors] = useState({});

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const validate = () => {
    const next = {};
    if (!form.company.trim()) {
      next.company = "Indique le nom de l'entreprise.";
    }
    if (!form.role.trim()) {
      next.role = "Indique l'intitulé du poste.";
    }
    if (!form.appliedDate) {
      next.appliedDate = "Indique la date de candidature.";
    }
    if (form.url.trim()) {
      try {
        const u = new URL(form.url.trim());
        if (!u.protocol.startsWith("http")) {
          next.url = "Le lien doit commencer par http:// ou https://.";
        }
      } catch {
        next.url = "Ce lien ne semble pas valide.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = (e) => {
    e.preventDefault();
    if (!validate()) {
      const firstError = document.querySelector(".tu-field-error");
      firstError?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }

    onSave({
      ...(initialValue ?? {}),
      company: form.company.trim(),
      role: form.role.trim(),
      location: form.location.trim(),
      appliedDate: form.appliedDate,
      followUpDate: form.followUpDate || "",
      status: form.status,
      url: form.url.trim(),
      notes: form.notes.trim(),
      lastFollowUp: form.lastFollowUp || "",
      deadlineDone: initialValue?.deadlineDone ?? false,
    });
  };

  return (
    <form className="tu-form" onSubmit={submit} noValidate>
      <Field
        id="f-company"
        label="Nom de l'entreprise"
        required
        error={errors.company}
      >
        <input
          id="f-company"
          type="text"
          value={form.company}
          onChange={(e) => setField("company", e.target.value)}
          placeholder="Ex. Atelier Lumière"
          autoComplete="organization"
          aria-invalid={Boolean(errors.company)}
        />
      </Field>

      <Field id="f-role" label="Intitulé du poste" required error={errors.role}>
        <input
          id="f-role"
          type="text"
          value={form.role}
          onChange={(e) => setField("role", e.target.value)}
          placeholder="Ex. Chargée de communication"
          aria-invalid={Boolean(errors.role)}
        />
      </Field>

      <Field id="f-location" label="Localité">
        <input
          id="f-location"
          type="text"
          value={form.location}
          onChange={(e) => setField("location", e.target.value)}
          placeholder="Ex. Lausanne"
        />
      </Field>

      <Field
        id="f-applied"
        label="Date de candidature"
        required
        error={errors.appliedDate}
      >
        <input
          id="f-applied"
          type="date"
          value={form.appliedDate}
          onChange={(e) => setField("appliedDate", e.target.value)}
        />
      </Field>

      <Field
        id="f-follow"
        label="Date de relance ou échéance"
        hint="Facultative. Ce champ alimente automatiquement l'onglet Échéances."
      >
        <input
          id="f-follow"
          type="date"
          value={form.followUpDate}
          onChange={(e) => setField("followUpDate", e.target.value)}
        />
      </Field>

      <Field id="f-status" label="Statut">
        <select
          id="f-status"
          value={form.status}
          onChange={(e) => setField("status", e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="f-url"
        label="Lien vers l'annonce"
        hint="Facultatif."
        error={errors.url}
      >
        <input
          id="f-url"
          type="url"
          inputMode="url"
          value={form.url}
          onChange={(e) => setField("url", e.target.value)}
          placeholder="https://…"
          aria-invalid={Boolean(errors.url)}
        />
      </Field>

      <Field id="f-notes" label="Notes personnelles">
        <textarea
          id="f-notes"
          rows={4}
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          placeholder="Contacts, ressenti, points à préparer…"
        />
      </Field>

      <Field
        id="f-followup-date"
        label="Date du dernier suivi"
        hint="Facultatif. Dernière fois que tu as relancé ou eu des nouvelles."
      >
        <input
          id="f-followup-date"
          type="date"
          value={form.lastFollowUp}
          onChange={(e) => setField("lastFollowUp", e.target.value)}
        />
      </Field>

      <div className="tu-form-actions">
        <button type="button" className="tu-btn tu-btn--ghost" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="tu-btn tu-btn--primary">
          <Check size={16} />
          {isEdit ? "Enregistrer les modifications" : "Ajouter la candidature"}
        </button>
      </div>
    </form>
  );
}

// --- 7.4 Documents ----------------------------------------------------------

function DocumentsScreen({
  documents,
  applications,
  uploadAvailable,
  onAdd,
  onEdit,
  onDelete,
}) {
  const [categoryFilter, setCategoryFilter] = useState("toutes");
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = documents;
    if (categoryFilter !== "toutes") {
      list = list.filter((d) => d.category === categoryFilter);
    }
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) =>
      (b.addedAt ?? "").localeCompare(a.addedAt ?? "")
    );
  }, [documents, categoryFilter, query]);

  const companyFor = (appId) => {
    const app = applications.find((a) => a.id === appId);
    return app ? `${app.company} — ${app.role}` : "";
  };

  return (
    <div className="tu-screen">
      <header className="tu-screen-head">
        <div>
          <h1 className="tu-screen-title">Documents</h1>
          <p className="tu-screen-sub">
            {documents.length} document{documents.length > 1 ? "s" : ""} référencé
            {documents.length > 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          className="tu-btn tu-btn--primary tu-btn--small"
          onClick={() => onAdd()}
        >
          <Plus size={16} />
          Ajouter
        </button>
      </header>

      {!uploadAvailable && (
        <Notice
          tone="coral"
          icon={CloudOff}
          title="Métadonnées seulement — aucun fichier n'est stocké"
        >
          <p>
            Cette bibliothèque classe des <strong>références</strong> : nom,
            catégorie, date, description et rattachement à une candidature. Le
            fichier lui-même (PDF, image) n'est pas conservé pour l'instant.
          </p>
          <p>
            Le téléversement réel sera activé après la création du bucket privé
            Supabase et la vérification de ses autorisations. D'ici là, aucun CV
            ne doit disparaître : garde tes originaux dans Fichiers ou iCloud
            Drive.
          </p>
        </Notice>
      )}

      <div className="tu-toolbar">
        <div className="tu-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom ou description…"
            aria-label="Rechercher un document"
          />
          {query && (
            <button
              type="button"
              className="tu-search-clear"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <label className="tu-select-wrap">
          <span className="tu-select-label">Catégorie</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filtrer par catégorie"
          >
            <option value="toutes">Toutes ({documents.length})</option>
            {DOC_CATEGORIES.map((c) => {
              const n = documents.filter((d) => d.category === c.id).length;
              return (
                <option key={c.id} value={c.id}>
                  {c.label} ({n})
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Bibliothèque vide"
          description="Répertorie ici tes CV, lettres et diplômes : tu sauras toujours où ils sont et à quelle candidature ils correspondent."
          action={
            <button
              type="button"
              className="tu-btn tu-btn--primary"
              onClick={() => onAdd()}
            >
              <Plus size={18} />
              Ajouter un document
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Aucun document trouvé"
          description="Aucun document ne correspond à ce filtre."
          action={
            <button
              type="button"
              className="tu-btn tu-btn--ghost"
              onClick={() => {
                setQuery("");
                setCategoryFilter("toutes");
              }}
            >
              <RefreshCw size={16} />
              Réinitialiser
            </button>
          }
        />
      ) : (
        <ul className="tu-cards">
          {filtered.map((d) => {
            const cat = DOC_CATEGORY_BY_ID[d.category];
            const Icon = cat?.icon ?? FileText;
            const linked = companyFor(d.applicationId);
            return (
              <li key={d.id} className="tu-card tu-doc-card">
                <div className="tu-doc-head">
                  <span className="tu-doc-icon" aria-hidden="true">
                    <Icon size={19} />
                  </span>
                  <div className="tu-doc-heading">
                    <h2 className="tu-doc-name">{d.name}</h2>
                    <p className="tu-doc-cat">{cat?.label ?? d.category}</p>
                  </div>
                  {!d.fileName && (
                    <span className="tu-badge tu-badge--neutral">
                      Métadonnées
                    </span>
                  )}
                </div>

                <dl className="tu-app-meta">
                  <div>
                    <dt>Ajouté le</dt>
                    <dd>{formatDateShort(d.addedAt)}</dd>
                  </div>
                  <div>
                    <dt>Fichier</dt>
                    <dd>{d.fileName ? d.fileName : "Aucun fichier joint"}</dd>
                  </div>
                </dl>

                {d.description && (
                  <p className="tu-app-notes">{truncate(d.description, 120)}</p>
                )}

                {linked && (
                  <p className="tu-doc-link">
                    <Briefcase size={13} aria-hidden="true" />
                    Rattaché à {linked}
                  </p>
                )}

                <div className="tu-app-actions">
                  <button
                    type="button"
                    className="tu-btn tu-btn--ghost tu-btn--small"
                    onClick={() => onEdit(d)}
                  >
                    <Pencil size={14} />
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="tu-btn tu-btn--ghost tu-btn--small tu-btn--danger-text"
                    onClick={() => setPendingDelete(d)}
                  >
                    <Trash2 size={14} />
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cette référence ?"
          message={`« ${pendingDelete.name} » sera retirée de la bibliothèque. Aucun fichier réel n'est supprimé, puisque aucun fichier n'est stocké.`}
          confirmLabel="Supprimer"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

function DocumentForm({ initialValue, applications, onSave, onCancel }) {
  const isEdit = Boolean(initialValue?.id);

  const [form, setForm] = useState({
    name: initialValue?.name ?? "",
    category: initialValue?.category ?? "cv",
    addedAt: initialValue?.addedAt ?? todayISO(),
    description: initialValue?.description ?? "",
    applicationId: initialValue?.applicationId ?? "",
  });

  const [errors, setErrors] = useState({});

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: "Donne un nom à ce document." });
      return;
    }
    onSave({
      ...(initialValue ?? {}),
      name: form.name.trim(),
      category: form.category,
      addedAt: form.addedAt,
      description: form.description.trim(),
      applicationId: form.applicationId,
      fileName: initialValue?.fileName ?? "",
      fileSize: initialValue?.fileSize ?? 0,
    });
  };

  return (
    <form className="tu-form" onSubmit={submit} noValidate>
      <Notice tone="sage" icon={Info}>
        <p>
          Ce formulaire enregistre des <strong>métadonnées</strong>, pas un
          fichier. Le téléversement réel viendra une fois le stockage privé
          configuré et testé.
        </p>
      </Notice>

      <Field
        id="d-name"
        label="Nom du document"
        required
        error={errors.name}
        hint="Par exemple : « CV — version communication »."
      >
        <input
          id="d-name"
          type="text"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="Ex. CV — version générale 2026"
          aria-invalid={Boolean(errors.name)}
        />
      </Field>

      <Field id="d-category" label="Catégorie">
        <select
          id="d-category"
          value={form.category}
          onChange={(e) => setField("category", e.target.value)}
        >
          {DOC_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="d-added" label="Date d'ajout">
        <input
          id="d-added"
          type="date"
          value={form.addedAt}
          onChange={(e) => setField("addedAt", e.target.value)}
        />
      </Field>

      <Field id="d-desc" label="Description" hint="Facultative.">
        <textarea
          id="d-desc"
          rows={3}
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="À quoi sert ce document, à qui l'envoyer…"
        />
      </Field>

      <Field
        id="d-app"
        label="Candidature liée"
        hint="Facultatif. Associe ce document à une candidature précise."
      >
        <select
          id="d-app"
          value={form.applicationId}
          onChange={(e) => setField("applicationId", e.target.value)}
        >
          <option value="">Aucune</option>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.company} — {a.role}
            </option>
          ))}
        </select>
      </Field>

      <div className="tu-file-placeholder">
        <Upload size={18} aria-hidden="true" />
        <div>
          <p className="tu-file-placeholder-title">
            Téléverser un fichier — non disponible
          </p>
          <p className="tu-file-placeholder-text">
            Désactivé volontairement : le bucket privé n'est pas encore créé et
            testé. Aucun bouton inactif n'est affiché pour faire semblant.
          </p>
        </div>
      </div>

      <div className="tu-form-actions">
        <button type="button" className="tu-btn tu-btn--ghost" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="tu-btn tu-btn--primary">
          <Check size={16} />
          {isEdit ? "Enregistrer" : "Ajouter le document"}
        </button>
      </div>
    </form>
  );
}

// --- 7.5 Échéances ----------------------------------------------------------

function DeadlinesScreen({ deadlines, onToggleDone, onOpenApplication }) {
  const buckets = useMemo(() => {
    const late = deadlines.filter((d) => d.state === "late");
    const today = deadlines.filter((d) => d.state === "today");
    const upcoming = deadlines.filter((d) => d.state === "upcoming");
    return { late, today, upcoming };
  }, [deadlines]);

  const Section = ({ sectionKey, title, items, emptyText, tone }) => (
    <section className="tu-section" aria-labelledby={`dl-${sectionKey}`}>
      <div className="tu-section-head">
        <h2 className="tu-section-title" id={`dl-${sectionKey}`}>
          <span className={`tu-dot tu-dot--${tone}`} aria-hidden="true" />
          {title}
        </h2>
        <span className="tu-count">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="tu-card tu-card--quiet">
          <p className="tu-muted">{emptyText}</p>
        </div>
      ) : (
        <ul className="tu-plain-list">
          {items.map((d) => (
            <li key={d.id} className="tu-deadline-card">
              <div className="tu-deadline-card-head">
                <div>
                  <p className="tu-deadline-title">{d.title}</p>
                  <p className="tu-deadline-meta">
                    {d.company} — {d.role}
                  </p>
                </div>
                <DeadlineBadge state={d.state} />
              </div>

              <p className="tu-deadline-date">
                <CalendarClock size={14} aria-hidden="true" />
                {formatDateFr(d.date)} · {relativeLabel(d.date)}
              </p>

              <div className="tu-app-actions">
                <button
                  type="button"
                  className="tu-btn tu-btn--ghost tu-btn--small"
                  onClick={() => onOpenApplication(d.applicationId)}
                >
                  Voir la candidature
                </button>
                <button
                  type="button"
                  className="tu-btn tu-btn--success tu-btn--small"
                  onClick={() => onToggleDone(d.applicationId)}
                >
                  <Check size={14} />
                  Marquer comme terminée
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const total = deadlines.length;

  return (
    <div className="tu-screen">
      <header className="tu-screen-head">
        <div>
          <h1 className="tu-screen-title">Échéances</h1>
          <p className="tu-screen-sub">
            {total === 0
              ? "Rien à surveiller pour l'instant"
              : `${total} échéance${total > 1 ? "s" : ""} active${
                  total > 1 ? "s" : ""
                }`}
          </p>
        </div>
      </header>

      <Notice tone="info" icon={BellOff} title="Pas de notification automatique">
        <p>
          TuttoUno! n'envoie <strong>aucun rappel ni notification push</strong>{" "}
          dans cette version. Rien n'est planifié en arrière-plan par le
          téléphone. C'est à toi d'ouvrir l'onglet Échéances pour voir où tu en
          es.
        </p>
      </Notice>

      {total === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Aucune échéance active"
          description="Les échéances naissent des dates de relance que tu saisis sur tes candidatures. Ajoute une date de relance ou d'entretien pour en voir apparaître ici."
        />
      ) : (
        <>
          <Section
            sectionKey="late"
            title="En retard"
            items={buckets.late}
            tone="danger"
            emptyText="Rien en retard. C'est bien."
          />
          <Section
            sectionKey="today"
            title="Aujourd'hui"
            items={buckets.today}
            tone="highlight"
            emptyText="Aucune action prévue aujourd'hui."
          />
          <Section
            sectionKey="upcoming"
            title="À venir"
            items={buckets.upcoming}
            tone="info"
            emptyText="Aucune échéance programmée pour les prochains jours."
          />
        </>
      )}
    </div>
  );
}

// --- 7.6 Profil -------------------------------------------------------------

function ProfileScreen({
  profile,
  applications,
  documents,
  storageOk,
  onUpdateProfile,
  onRequestReset,
  onRequestWipe,
}) {
  const [nameDraft, setNameDraft] = useState(profile.displayName ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const size = useMemo(() => localStateSize(), [applications, documents]);

  const nameChanged = nameDraft.trim() !== (profile.displayName ?? "");

  const commitName = () => {
    onUpdateProfile({ displayName: nameDraft.trim() });
    setNameSaved(true);
    window.setTimeout(() => setNameSaved(false), 2200);
  };

  const capabilityRows = [
    {
      key: "auth",
      label: "Authentification par e-mail",
      state: backendCapabilities.auth,
      note: "Schéma et politiques prêts. Écran non branché.",
    },
    {
      key: "apps",
      label: "Synchronisation des candidatures",
      state: backendCapabilities.applicationsSync,
      note: "Table `applications` prête avec RLS. Le client n'y écrit pas encore.",
    },
    {
      key: "docs",
      label: "Métadonnées des documents",
      state: backendCapabilities.documentsMetadataSync,
      note: "Table `documents` prête avec RLS. Aucune ligne n'y est envoyée.",
    },
    {
      key: "upload",
      label: "Téléversement de fichiers",
      state: backendCapabilities.documentUpload,
      note: "Volontairement absent tant que le bucket privé n'est pas vérifié.",
    },
    {
      key: "deadlines",
      label: "Synchronisation des échéances",
      state: backendCapabilities.deadlinesSync,
      note: "Les échéances sont calculées sur l'appareil, à partir des candidatures.",
    },
    {
      key: "notif",
      label: "Rappels et notifications",
      state: backendCapabilities.notifications,
      note: "Aucun service de notification n'est branché.",
    },
  ];

  const stateTone = (state) =>
    state === "working"
      ? "sage"
      : state === "not_implemented"
      ? "neutral"
      : "coral";

  return (
    <div className="tu-screen">
      <header className="tu-screen-head">
        <div>
          <h1 className="tu-screen-title">Profil et paramètres</h1>
          <p className="tu-screen-sub">Tout au même endroit. Prêt pour la suite.</p>
        </div>
      </header>

      <section className="tu-section" aria-labelledby="p-profile">
        <h2 className="tu-section-title" id="p-profile">
          Profil
        </h2>
        <div className="tu-card">
          <Field
            id="p-name"
            label="Prénom affiché sur l'accueil"
            hint="Utilisé uniquement pour le message de bienvenue. Stocké sur ton appareil."
          >
            <input
              id="p-name"
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Ex. Alex"
              autoComplete="given-name"
            />
          </Field>
          <button
            type="button"
            className="tu-btn tu-btn--primary tu-btn--small"
            onClick={commitName}
            disabled={!nameChanged && !nameSaved}
          >
            {nameSaved ? <Check size={16} /> : null}
            {nameSaved ? "Enregistré" : "Enregistrer le prénom"}
          </button>
        </div>
      </section>

      <section className="tu-section" aria-labelledby="p-prefs">
        <h2 className="tu-section-title" id="p-prefs">
          Préférences d'affichage
        </h2>
        <div className="tu-card">
          <label className="tu-switch">
            <input
              type="checkbox"
              checked={Boolean(profile.compactMode)}
              onChange={(e) =>
                onUpdateProfile({ compactMode: e.target.checked })
              }
            />
            <span className="tu-switch-track" aria-hidden="true">
              <span className="tu-switch-thumb" />
            </span>
            <span className="tu-switch-text">
              <strong>Affichage dense</strong>
              <small>
                Réduit les espacements et affiche davantage d'informations par
                écran. Confortable sur iPad et ordinateur, plus serré sur iPhone.
              </small>
            </span>
          </label>
        </div>
      </section>

      <section className="tu-section" aria-labelledby="p-backend">
        <h2 className="tu-section-title" id="p-backend">
          État du backend
        </h2>

        <div className={`tu-card tu-status-card tu-status-card--${backendState.tone}`}>
          <div className="tu-status-head">
            <span className="tu-dot" aria-hidden="true" />
            <div>
              <p className="tu-status-title">{backendState.label}</p>
              <p className="tu-status-detail">{backendState.detail}</p>
            </div>
          </div>
        </div>

        <div className="tu-card">
          <h3 className="tu-card-title">Séparation démo / réel</h3>
          <p className="tu-card-text">
            {backendState.configured
              ? "Un client Supabase existe, mais cette version continue d'utiliser la sauvegarde locale du navigateur. Aucune de tes données n'est envoyée au serveur."
              : "Aucun projet Supabase n'est configuré. L'application tourne entièrement en mode démonstration, avec la sauvegarde locale du navigateur."}
          </p>
        </div>
      </section>

      <section className="tu-section" aria-labelledby="p-sync">
        <h2 className="tu-section-title" id="p-sync">
          État de synchronisation
        </h2>
        <div className="tu-card">
          <div className="tu-kv">
            <span className="tu-kv-key">Client Supabase</span>
            <span className="tu-kv-value">
              {backendState.configured ? "Créé" : "Non créé"}
            </span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Session connectée</span>
            <span className="tu-kv-value">Aucune</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Dernière synchronisation</span>
            <span className="tu-kv-value">Jamais</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Sauvegarde active</span>
            <span className="tu-kv-value">
              {storageOk ? "Locale (navigateur)" : "Indisponible"}
            </span>
          </div>
          {backendState.urlOrigin && (
            <div className="tu-kv">
              <span className="tu-kv-key">Adresse du projet</span>
              <span className="tu-kv-value tu-kv-value--mono">
                {backendState.urlOrigin}
              </span>
            </div>
          )}
          <p className="tu-card-note">
            « Jamais » est la réponse honnête : cette V1 n'effectue aucun échange
            avec Supabase. Elle ne prétend pas synchroniser ce qu'elle ne
            synchronise pas.
          </p>
        </div>
      </section>

      <section className="tu-section" aria-labelledby="p-storage">
        <h2 className="tu-section-title" id="p-storage">
          Stockage des documents
        </h2>
        <div className="tu-card">
          <div className="tu-kv">
            <span className="tu-kv-key">Bucket privé Supabase</span>
            <span className="tu-kv-value">Non créé</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Fichiers réellement stockés</span>
            <span className="tu-kv-value">Aucun</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Références de documents</span>
            <span className="tu-kv-value">{documents.length}</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Espace local utilisé</span>
            <span className="tu-kv-value">{formatBytes(size)}</span>
          </div>
          <p className="tu-card-note">
            Les {documents.length} entrées de la bibliothèque sont des
            métadonnées. Aucun CV, aucune lettre n'est conservé par
            l'application. Conserve tes originaux dans Fichiers ou iCloud Drive.
          </p>
        </div>
      </section>

      <section className="tu-section" aria-labelledby="p-state">
        <h2 className="tu-section-title" id="p-state">
          Ce qui fonctionne, ce qui reste à configurer
        </h2>
        <ul className="tu-capability-list">
          {capabilityRows.map((row) => (
            <li key={row.key} className="tu-capability">
              <div className="tu-capability-head">
                <span className="tu-capability-label">{row.label}</span>
                <span className={`tu-badge tu-badge--${stateTone(row.state)}`}>
                  {row.state === "not_implemented"
                    ? "Non implémenté"
                    : row.state === "working"
                    ? "Fonctionnel"
                    : "Préparé, non connecté"}
                </span>
              </div>
              <p className="tu-capability-note">{row.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="tu-section" aria-labelledby="p-privacy">
        <h2 className="tu-section-title" id="p-privacy">
          Confidentialité
        </h2>
        <Notice tone="sage" icon={Lock} title="Tes données restent sur ton appareil">
          <p>
            En mode démonstration, tes candidatures et tes documents sont
            enregistrés dans le stockage local de Safari, sur cet iPhone.
            Aucune donnée n'est transmise à un serveur, à un tiers ou à un
            service d'analyse.
          </p>
          <p>
            Quand Supabase sera branché, chaque ligne portera l'identifiant de
            son propriétaire et les politiques RLS empêcheront tout autre
            compte de la lire. Le fichier SQL fourni avec le projet contient ces
            politiques, à exécuter et à vérifier avant tout usage réel.
          </p>
          <p>
            Limites du stockage local : vider les données de site de Safari,
            naviguer en privé, réinstaller l'application ou changer de téléphone
            efface ce contenu. Ce n'est pas un archivage.
          </p>
        </Notice>
      </section>

      <section className="tu-section" aria-labelledby="p-data">
        <h2 className="tu-section-title" id="p-data">
          Tes données locales
        </h2>
        <div className="tu-card">
          <div className="tu-kv">
            <span className="tu-kv-key">Candidatures</span>
            <span className="tu-kv-value">{applications.length}</span>
          </div>
          <div className="tu-kv">
            <span className="tu-kv-key">Références de documents</span>
            <span className="tu-kv-value">{documents.length}</span>
          </div>

          <div className="tu-danger-zone">
            <button
              type="button"
              className="tu-btn tu-btn--ghost tu-btn--small"
              onClick={onRequestReset}
            >
              <RefreshCw size={14} />
              Recharger les données de démonstration
            </button>
            <p className="tu-danger-hint">
              Remplace tes données actuelles par les exemples fictifs.
            </p>
          </div>

          <div className="tu-danger-zone">
            <button
              type="button"
              className="tu-btn tu-btn--danger tu-btn--small"
              onClick={onRequestWipe}
            >
              <Trash2 size={14} />
              Tout effacer
            </button>
            <p className="tu-danger-hint">
              Supprime candidatures, documents et profil enregistrés sur cet
              appareil. Aucune copie n'existe ailleurs.
            </p>
          </div>
        </div>
      </section>

      <footer className="tu-profile-footer">
        <Logo size={36} showWordmark />
        <p className="tu-version">Version 1.0 — V1 locale</p>
        <p className="tu-muted tu-small">
          Slogan : « Tout au même endroit. Prêt pour la suite. »
        </p>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. COMPOSANT RACINE
// ---------------------------------------------------------------------------

export default function TuttoUno() {
  const [booted, setBooted] = useState(false);
  const bootstrapRef = useRef(false);

  const [data, setData] = useState(EMPTY_STATE);
  const [storageOk, setStorageOk] = useState(true);
  const [tab, setTab] = useState("accueil");

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [appForm, setAppForm] = useState(null);
  const [docForm, setDocForm] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;

    const stored = loadState();
    if (stored) {
      setData(stored);
    } else {
      const demo = buildDemoData();
      const next = {
        version: STORAGE_VERSION,
        profile: demo.profile,
        applications: demo.applications,
        documents: demo.documents,
      };
      setData(next);
      const ok = saveState(next);
      setStorageOk(ok);
    }

    setBooted(true);
  }, []);

  useEffect(() => {
    if (!booted) return;
    const ok = saveState(data);
    setStorageOk(ok);
  }, [data, booted]);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone, id: makeId("toast") });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const applications = data.applications;
  const documents = data.documents;
  const profile = data.profile;

  const deadlines = useMemo(() => buildDeadlines(applications), [applications]);
  const activeDeadlineCount = deadlines.length;

  const saveApplication = useCallback(
    (values) => {
      setData((prev) => {
        const exists = values.id
          ? prev.applications.some((a) => a.id === values.id)
          : false;

        if (exists) {
          return {
            ...prev,
            applications: prev.applications.map((a) =>
              a.id === values.id ? { ...a, ...values } : a
            ),
          };
        }

        const created = {
          ...values,
          id: values.id ?? makeId("app"),
          createdAt: new Date().toISOString(),
        };
        return { ...prev, applications: [created, ...prev.applications] };
      });

      setAppForm(null);
      notify(
        values.id && applications.some((a) => a.id === values.id)
          ? "Candidature mise à jour."
          : "Candidature ajoutée.",
        "success"
      );
      setTab("candidatures");
    },
    [applications, notify]
  );

  const deleteApplication = useCallback(
    (id) => {
      setData((prev) => ({
        ...prev,
        applications: prev.applications.filter((a) => a.id !== id),
        documents: prev.documents.map((d) =>
          d.applicationId === id ? { ...d, applicationId: "" } : d
        ),
      }));
      notify("Candidature supprimée.", "success");
    },
    [notify]
  );

  const toggleDeadlineDone = useCallback(
    (applicationId) => {
      setData((prev) => ({
        ...prev,
        applications: prev.applications.map((a) =>
          a.id === applicationId ? { ...a, deadlineDone: !a.deadlineDone } : a
        ),
      }));
      const target = applications.find((a) => a.id === applicationId);
      notify(
        target?.deadlineDone
          ? "Échéance réactivée."
          : "Échéance marquée comme terminée.",
        "success"
      );
    },
    [applications, notify]
  );

  const saveDocument = useCallback(
    (values) => {
      setData((prev) => {
        const exists = values.id
          ? prev.documents.some((d) => d.id === values.id)
          : false;

        if (exists) {
          return {
            ...prev,
            documents: prev.documents.map((d) =>
              d.id === values.id ? { ...d, ...values } : d
            ),
          };
        }

        const created = { ...values, id: values.id ?? makeId("doc") };
        return { ...prev, documents: [created, ...prev.documents] };
      });

      setDocForm(null);
      notify(
        values.id && documents.some((d) => d.id === values.id)
          ? "Document mis à jour."
          : "Référence de document ajoutée.",
        "success"
      );
    },
    [documents, notify]
  );

  const deleteDocument = useCallback(
    (id) => {
      setData((prev) => ({
        ...prev,
        documents: prev.documents.filter((d) => d.id !== id),
      }));
      notify("Référence supprimée.", "success");
    },
    [notify]
  );

  const updateProfile = useCallback((patch) => {
    setData((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
  }, []);

  const resetToDemo = useCallback(() => {
    const demo = buildDemoData();
    setData({
      version: STORAGE_VERSION,
      profile: demo.profile,
      applications: demo.applications,
      documents: demo.documents,
    });
    notify("Données de démonstration rechargées.", "success");
  }, [notify]);

  const wipeAll = useCallback(() => {
    setData({
      version: STORAGE_VERSION,
      profile: { displayName: "", compactMode: false, showDemoData: false },
      applications: [],
      documents: [],
    });
    notify("Toutes les données locales ont été effacées.", "success");
    setTab("accueil");
  }, [notify]);

  const openApplicationFromDeadline = useCallback(
    (applicationId) => {
      setTab("candidatures");
      notify("Retrouve cette candidature dans la liste ci-dessous.", "info");
      window.setTimeout(() => {
        const el = document.querySelector(`[data-app-id="${applicationId}"]`);
        el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }, 120);
    },
    [notify]
  );

  if (!booted) {
    return (
      <div className="tu-boot">
        <Logo size={48} />
        <p className="tu-boot-text">Chargement de TuttoUno!…</p>
      </div>
    );
  }

  const compact = Boolean(profile.compactMode);

  return (
    <div className={`tu-app${compact ? " tu-app--compact" : ""}`}>
      <a className="tu-skip" href="#tu-main">
        Aller au contenu principal
      </a>

      {toast && (
        <div
          className={`tu-toast tu-toast--${toast.tone}`}
          role="status"
          aria-live="polite"
        >
          {toast.tone === "success" && <CheckCircle2 size={16} aria-hidden="true" />}
          {toast.tone === "info" && <Info size={16} aria-hidden="true" />}
          {toast.message}
          <button
            type="button"
            className="tu-toast-close"
            onClick={() => setToast(null)}
            aria-label="Masquer le message"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {!storageOk && (
        <div className="tu-storage-warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <p>
            <strong>Enregistrement local impossible.</strong> Tes modifications
            restent visibles mais seront perdues au rechargement. Cela arrive en
            navigation privée ou si le stockage du site est plein ou bloqué.
          </p>
        </div>
      )}

      <main className="tu-main" id="tu-main">
        {tab === "accueil" && (
          <HomeScreen
            applications={applications}
            deadlines={deadlines}
            profile={profile}
            onNavigate={setTab}
            onAdd={() => setAppForm({})}
          />
        )}

        {tab === "candidatures" && (
          <ApplicationsScreen
            applications={applications}
            documents={documents}
            onAdd={() => setAppForm({})}
            onEdit={(a) => setAppForm(a)}
            onDelete={deleteApplication}
            onOpenDocuments={() => setTab("documents")}
          />
        )}

        {tab === "documents" && (
          <DocumentsScreen
            documents={documents}
            applications={applications}
            uploadAvailable={false}
            onAdd={() => setDocForm({})}
            onEdit={(d) => setDocForm(d)}
            onDelete={deleteDocument}
          />
        )}

        {tab === "echeances" && (
          <DeadlinesScreen
            deadlines={deadlines}
            onToggleDone={toggleDeadlineDone}
            onOpenApplication={openApplicationFromDeadline}
          />
        )}

        {tab === "profil" && (
          <ProfileScreen
            profile={profile}
            applications={applications}
            documents={documents}
            storageOk={storageOk}
            onUpdateProfile={updateProfile}
            onRequestReset={() =>
              setConfirm({
                title: "Recharger les données de démonstration ?",
                message:
                  "Tes candidatures et documents actuels seront remplacés par les exemples fictifs. Cette action est irréversible.",
                confirmLabel: "Recharger",
                action: resetToDemo,
              })
            }
            onRequestWipe={() =>
              setConfirm({
                title: "Tout effacer ?",
                message:
                  "Toutes tes candidatures, tes références de documents et ton profil seront supprimés de cet appareil. Aucune copie n'existe ailleurs : cette action est définitive.",
                confirmLabel: "Tout effacer",
                action: wipeAll,
              })
            }
          />
        )}
      </main>

      <nav className="tu-tabbar" aria-label="Navigation principale">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          const badge =
            t.id === "echeances" && activeDeadlineCount > 0
              ? activeDeadlineCount
              : null;

          return (
            <button
              key={t.id}
              type="button"
              className={`tu-tab${isActive ? " tu-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="tu-tab-icon">
                <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
                {badge !== null && (
                  <span className="tu-tab-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
              </span>
              <span className="tu-tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {appForm !== null && (
        <Modal
          title={appForm.id ? "Modifier la candidature" : "Nouvelle candidature"}
          subtitle={
            appForm.id
              ? `${appForm.company} — ${appForm.role}`
              : "Renseigne au minimum l'entreprise et le poste."
          }
          onClose={() => setAppForm(null)}
        >
          <ApplicationForm
            initialValue={appForm.id ? appForm : null}
            onSave={saveApplication}
            onCancel={() => setAppForm(null)}
          />
        </Modal>
      )}

      {docForm !== null && (
        <Modal
          title={docForm.id ? "Modifier le document" : "Ajouter un document"}
          subtitle="Métadonnées uniquement — aucun fichier n'est téléversé."
          onClose={() => setDocForm(null)}
        >
          <DocumentForm
            initialValue={docForm.id ? docForm : null}
            applications={applications}
            onSave={saveDocument}
            onCancel={() => setDocForm(null)}
          />
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.action();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

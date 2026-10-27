import React from "react";
import ReactDOM from "react-dom/client";
import TuttoUno from "./tuttouno.jsx";
import "./styles.css";

// ---------------------------------------------------------------------------
// Point d'entrée de TuttoUno!
//
// Volontairement minimal : toute l'application vit dans `tuttouno.jsx`.
// Pas de routeur, pas de gestion d'état externe — la V1 tient dans un seul
// composant racine, ce qui la rend lisible et facile à faire évoluer.
// ---------------------------------------------------------------------------

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "Élément #root introuvable dans index.html — l'application ne peut pas démarrer."
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TuttoUno />
  </React.StrictMode>
);

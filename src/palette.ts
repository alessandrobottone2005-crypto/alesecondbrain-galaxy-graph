// Palette riusata dalla WebApp — SOURCE OF TRUTH:
// WebApp/AleSecondBrain/src/config/macroAreas.ts
// Non inventare colori: valori HEX identici alla WebApp.

export const MACRO_AREA_COLORS: Record<string, string> = {
  "00_Contesto": "#EE7269",
  "00_Home": "#C9C5C0",
  "00_Inbox": "#C9C5C0",
  "01_Universita": "#E8B84F",
  "02_Portfolio_Progetti": "#A978E8",
  "03_Fumetti_Collezioni": "#E76AAE",
  "04_Acquisti_Spese": "#B7C95B",
  "05_Letture_Media": "#4BC3D5",
  "06_Persone": "#E49355",
  "07_Risorse": "#5B8DEF",
  "08_Ponti": "#53C6A7",
  "09_Magia_Illusionismo": "#7454D8",
};

export const DEFAULT_COLOR = "#C9C5C0";

export const BACKGROUND_COLOR = "#0E0E10";

// Cartelle escluse dal grafo (nodi principali inutili / attachments).
export const EXCLUDED_FOLDERS = new Set([
  "09_Archivio_Grezzi",
  "_Assets",
  "90_Templates",
  "99_Archivio",
]);

// Ordine stabile per posizionare i cluster sull'anello (deterministico tra reload).
export const CLUSTER_ORDER = [
  "01_Universita",
  "02_Portfolio_Progetti",
  "03_Fumetti_Collezioni",
  "04_Acquisti_Spese",
  "05_Letture_Media",
  "06_Persone",
  "07_Risorse",
  "09_Magia_Illusionismo",
  "00_Contesto",
  "00_Home",
  "00_Inbox",
];

// 08_Ponti vive nella regione intermedia (centro dell'universo).
export const PONTI_AREA = "08_Ponti";
export const ROOT_AREA = "root";

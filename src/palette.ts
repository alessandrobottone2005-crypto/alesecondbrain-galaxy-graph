// Palette delle macro-aree: questo file è la fonte dei colori del Galaxy Graph
// (in origine ripresa dalla WebApp storica, ora archiviata). Non inventare colori.

export const MACRO_AREA_COLORS: Record<string, string> = {
  "00-contesto": "#EE7269",
  "00-home": "#C9C5C0",
  "00-inbox": "#C9C5C0",
  "01-universita": "#E8B84F",
  "02-portfolio-progetti": "#A978E8",
  "03-fumetti-collezioni": "#E76AAE",
  "04-acquisti-spese": "#B7C95B",
  "05-letture-media": "#4BC3D5",
  "06-persone": "#E49355",
  "07-risorse": "#5B8DEF",
  "08-ponti": "#53C6A7",
  "09-magia-illusionismo": "#7454D8",
};

export const DEFAULT_COLOR = "#C9C5C0";

export const BACKGROUND_COLOR = "#0E0E10";

// Cartelle escluse dal grafo (nodi principali inutili / attachments).
export const EXCLUDED_FOLDERS = new Set([
  "09-archivio-grezzi",
  "_assets",
  "90-templates",
  "99-archivio",
]);

// Sottocartelle private: mai nel grafo (titoli sensibili).
export const EXCLUDED_PATH_PREFIXES = ["00-contesto/riservato/"];

// Ordine stabile per posizionare i cluster sull'anello (deterministico tra reload).
export const CLUSTER_ORDER = [
  "01-universita",
  "02-portfolio-progetti",
  "03-fumetti-collezioni",
  "04-acquisti-spese",
  "05-letture-media",
  "06-persone",
  "07-risorse",
  "09-magia-illusionismo",
  "00-contesto",
  "00-home",
  "00-inbox",
];

// 08-ponti vive nella regione intermedia (centro dell'universo).
export const PONTI_AREA = "08-ponti";
export const ROOT_AREA = "root";

// Galaxy 2D — stesse tinte per area, più sature e luminose sul blu notte.
export const NEON_AREA_COLORS: Record<string, string> = {
  "00-contesto": "#FF5A5F",
  "00-home": "#E8E4FF",
  "00-inbox": "#E8E4FF",
  "01-universita": "#FFC53D",
  "02-portfolio-progetti": "#B77BFF",
  "03-fumetti-collezioni": "#FF5FB8",
  "04-acquisti-spese": "#C8F03C",
  "05-letture-media": "#2EE6FF",
  "06-persone": "#FF9A3D",
  "07-risorse": "#4D8BFF",
  "08-ponti": "#2EF2B5",
  "09-magia-illusionismo": "#8B5CFF",
  "10-daily": "#F6F1E8",
  "11-weekly": "#F6F1E8",
};

export const NEON_DEFAULT = "#E8E4FF";

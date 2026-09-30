// Sanity checks — determinismo e calcoli puri (no test framework).
// Esegui: npm run sanity
import {
  buildMacroGraph,
  computeMacroCenters,
  hash32,
  macroKey,
} from "../src/layout";
import { createSim2D, runSim2D } from "../src/layout2d";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log("  OK  " + name);
  } else {
    failures++;
    console.error("  FAIL " + name);
  }
}

// 1. Hash deterministico e stabile.
check("hash32 stable", hash32("01-universita") === hash32("01-universita"));
check("hash32 differs", hash32("a") !== hash32("b"));
check("hash32 known value", hash32("") === 0x811c9dc5);

// 2. Macro key ordinato e simmetrico.
check("macroKey symmetric", macroKey("B", "A") === macroKey("A", "B"));
check("macroKey ordered", macroKey("A", "B") === "A|B");

// 3. Macro graph da dati sintetici.
const nodes = [
  { area: "01-universita", degree: 10 },
  { area: "07-risorse", degree: 8 },
  { area: "03-fumetti-collezioni", degree: 2 },
  { area: "08-ponti", degree: 5 },
];
const links = [
  { source: "u1", target: "r1" },
  { source: "u2", target: "r2" },
  { source: "u3", target: "r3" },
  { source: "f1", target: "p1" },
];
const areaOf = (id: string): string =>
  id.startsWith("u") ? "01-universita" : id.startsWith("r") ? "07-risorse" : id.startsWith("f") ? "03-fumetti-collezioni" : "08-ponti";

const macro = buildMacroGraph(nodes, links, areaOf);
check("macro areas count", macro.areas.length === 4);
check(
  "macro pair Universita-Risorse weight 3",
  macro.pairWeight.get(macroKey("01-universita", "07-risorse")) === 3
);
check("ponti tier A", macro.tier.get("08-ponti") === "A");
check("crossLinks Universita = 3", macro.crossLinks.get("01-universita") === 3);

// 4. Stesso input → stesse posizioni cluster (determinismo).
const c1 = computeMacroCenters(macro);
const c2 = computeMacroCenters(buildMacroGraph(nodes, links, areaOf));
let same = true;
for (const area of macro.areas) {
  const a = c1.get(area)!;
  const b = c2.get(area)!;
  if (!a || !b || a.x !== b.x || a.y !== b.y || a.z !== b.z) same = false;
}
check("cluster centers deterministic", same);

// 5. Distanza minima tra centri (separazione).
let minPair = Infinity;
const arr = macro.areas.map((a) => c1.get(a)!);
for (let i = 0; i < arr.length; i++) {
  for (let j = i + 1; j < arr.length; j++) {
    const dx = arr[i].x - arr[j].x;
    const dy = arr[i].y - arr[j].y;
    const dz = arr[i].z - arr[j].z;
    minPair = Math.min(minPair, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
}
check("min cluster separation >= 30", minPair >= 30);

// 6. Ponti relativamente centrale.
const p = c1.get("08-ponti")!;
const pr = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
check("ponti near center (r < 45)", pr < 45);

// 7. Galaxy 2D — determinismo, niente NaN, 1 nota = 1 nodo.
const n2d = [
  { id: "01-universita/a.md", area: "01-universita", degree: 3 },
  { id: "01-universita/b.md", area: "01-universita", degree: 1 },
  { id: "07-risorse/c.md", area: "07-risorse", degree: 2 },
  { id: "08-ponti/d.md", area: "08-ponti", degree: 2 },
  { id: "03-fumetti-collezioni/e.md", area: "03-fumetti-collezioni", degree: 0 },
];
const l2d = [
  { source: "01-universita/a.md", target: "01-universita/b.md" },
  { source: "01-universita/a.md", target: "07-risorse/c.md" },
  { source: "07-risorse/c.md", target: "08-ponti/d.md" },
  { source: "01-universita/a.md", target: "08-ponti/d.md" },
];
const s1 = createSim2D(n2d, l2d);
const s2 = createSim2D([...n2d].reverse(), l2d);
runSim2D(s1);
runSim2D(s2);
check("2D node count = notes", s1.nodes.length === n2d.length);
check("2D link count = resolved links", s1.links.length === l2d.length);
check(
  "2D deterministic positions",
  s1.nodes.every((n, i) => n.id === s2.nodes[i].id && n.x === s2.nodes[i].x && n.y === s2.nodes[i].y)
);
check("2D no NaN", s1.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
check("2D ponti anchor at center", (() => { const a = s1.anchors.get("08-ponti")!; return a.x === 0 && a.y === 0; })());

if (failures > 0) {
  console.error(`\n${failures} check fallite`);
  process.exit(1);
}
console.log("\nTutti i check superati");

// Sanity checks — determinismo e calcoli puri (no test framework).
// Esegui: npm run sanity
import {
  buildMacroGraph,
  computeMacroCenters,
  hash32,
  macroKey,
} from "../src/layout";

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
check("hash32 stable", hash32("01_Universita") === hash32("01_Universita"));
check("hash32 differs", hash32("a") !== hash32("b"));
check("hash32 known value", hash32("") === 0x811c9dc5);

// 2. Macro key ordinato e simmetrico.
check("macroKey symmetric", macroKey("B", "A") === macroKey("A", "B"));
check("macroKey ordered", macroKey("A", "B") === "A|B");

// 3. Macro graph da dati sintetici.
const nodes = [
  { area: "01_Universita", degree: 10 },
  { area: "07_Risorse", degree: 8 },
  { area: "03_Fumetti_Collezioni", degree: 2 },
  { area: "08_Ponti", degree: 5 },
];
const links = [
  { source: "u1", target: "r1" },
  { source: "u2", target: "r2" },
  { source: "u3", target: "r3" },
  { source: "f1", target: "p1" },
];
const areaOf = (id: string): string =>
  id.startsWith("u") ? "01_Universita" : id.startsWith("r") ? "07_Risorse" : id.startsWith("f") ? "03_Fumetti_Collezioni" : "08_Ponti";

const macro = buildMacroGraph(nodes, links, areaOf);
check("macro areas count", macro.areas.length === 4);
check(
  "macro pair Universita-Risorse weight 3",
  macro.pairWeight.get(macroKey("01_Universita", "07_Risorse")) === 3
);
check("ponti tier A", macro.tier.get("08_Ponti") === "A");
check("crossLinks Universita = 3", macro.crossLinks.get("01_Universita") === 3);

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
const p = c1.get("08_Ponti")!;
const pr = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
check("ponti near center (r < 45)", pr < 45);

if (failures > 0) {
  console.error(`\n${failures} check fallite`);
  process.exit(1);
}
console.log("\nTutti i check superati");

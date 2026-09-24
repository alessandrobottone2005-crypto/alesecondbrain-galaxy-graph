import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { TFile } from "obsidian";
import { BACKGROUND_COLOR } from "./palette";
import { applySpread, hash32, hashUnit, macroKey, type GalaxyGraph, type GalaxyNode } from "./layout";

const LINK_COLOR = new THREE.Color("#5a6272");

export interface GalaxySettings {
  bloom: number;
  spread: number;
  linkOpacity: number;
  fog: number;
  nebula: number;
  stars: number;
}

export const DEFAULT_SETTINGS: GalaxySettings = {
  bloom: 0.45,
  spread: 1,
  linkOpacity: 0.028,
  fog: 0.0028,
  nebula: 0.8,
  stars: 1,
};

export interface CameraState {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  interacted: boolean;
}

export interface GalaxySceneOptions {
  labelEl: HTMLElement;
  onOpenFile: (file: TFile) => void;
  onSelectionChange?: (file: TFile | null) => void;
  settings?: Partial<GalaxySettings>;
  savedCamera?: CameraState;
}

interface DustSpec {
  nodeIdx: number;
  ox: number;
  oy: number;
  oz: number;
  free: boolean;
  fx: number;
  fy: number;
  fz: number;
}

interface CurvedBridge {
  linkIdx: number;
  line: THREE.Line;
  aId: string;
  bId: string;
  bulge: THREE.Vector3;
}

export class GalaxyScene {
  private container: HTMLElement;
  private opts: GalaxySceneOptions;
  private graph: GalaxyGraph;
  private settings: GalaxySettings;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;

  private coreGeo: THREE.SphereGeometry;
  private haloTex: THREE.CanvasTexture;
  private starTex: THREE.CanvasTexture;
  private normColor = new Map<string, THREE.Color>();
  private nebulaTexs: THREE.CanvasTexture[] = [];
  private linkGeo: THREE.BufferGeometry;
  private linkMat: THREE.LineBasicMaterial;
  private linksMesh: THREE.LineSegments;

  private nodeMeshes: THREE.Mesh[] = [];
  private halos: THREE.Sprite[] = [];
  private nodeByMesh = new Map<THREE.Mesh, GalaxyNode>();
  private starMats: THREE.PointsMaterial[] = [];
  private nebulaSprites: THREE.Sprite[] = [];
  private dust: THREE.Points | null = null;
  private dustSpec: DustSpec[] = [];
  private curved: CurvedBridge[] = [];

  private interLink: boolean[] = [];
  private restFactor: number[] = [];
  private maxPairWeight = 1;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: GalaxyNode | null = null;
  private selected: GalaxyNode | null = null;

  private rafId = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;
  private reducedMotion: boolean;
  private interacted = false;
  private lastRaycast = 0;
  private downX = 0;
  private downY = 0;

  private onPointerMove: (e: PointerEvent) => void;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onDblClick: (e: MouseEvent) => void;
  private onKey: (e: KeyboardEvent) => void;
  private onControlsStart: () => void;

  constructor(container: HTMLElement, graph: GalaxyGraph, opts: GalaxySceneOptions) {
    this.container = container;
    this.graph = graph;
    this.opts = opts;
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    // Mobile performance mode (coarse pointer): cap pixel ratio, meno stelle/dust,
    // bloom RT senza MSAA. I knowledge nodes/edges NON vengono mai rimossi.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const starScale = coarse ? 0.55 : 1;

    // Renderer (view cattura l'errore se WebGL non è disponibile)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(new THREE.Color(BACKGROUND_COLOR), 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(BACKGROUND_COLOR).getHex(), this.settings.fog);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.5, 5000);
    this.camera.position.set(0, 70, 320);

    // OrbitControls: left rotate, middle zoom, right pan (default) + damping.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 1400;
    this.controls.target.set(0, 0, 0);

    // --- Starfield v2: hash indipendenti con avalanche, 3 layer che avvolgono la camera ---
    // Sprite circolari morbidi (CanvasTexture) — mai quadrati.
    this.starTex = makeStarTexture();
    this.addStarLayer(Math.round(2200 * starScale), 1400, 3000, 1.3, 0.4, "far");
    this.addStarLayer(Math.round(850 * starScale), 900, 1900, 2.0, 0.6, "mid");
    this.addStarLayer(Math.round(150 * starScale), 520, 1100, 3.2, 0.85, "near");

    // --- Nebula procedurale (CanvasTexture, decorative only) ---
    this.buildNebula();

    // --- Nodi: CORE (sphere) + HALO (sprite additive) ---
    this.coreGeo = new THREE.SphereGeometry(1, 16, 12);
    this.haloTex = makeHaloTexture();
    this.buildNodes(graph);

    // --- Link retti + curved bridges per le macro-relazioni più forti ---
    this.buildLinkStats();
    this.linkGeo = new THREE.BufferGeometry();
    this.linkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(graph.links.length * 6), 3));
    this.linkGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(graph.links.length * 6), 3));
    this.linkMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.settings.linkOpacity,
      fog: true,
    });
    this.linksMesh = new THREE.LineSegments(this.linkGeo, this.linkMat);
    this.linksMesh.frustumCulled = false;
    this.scene.add(this.linksMesh);
    this.buildCurvedBridges();
    this.updateLinkPositions();
    this.applyAppearance();

    // --- Galactic dust (decorativo, vicino al volume del graph) ---
    this.buildDust();

    // --- Postprocessing: bloom controllato, differenziato dagli halo ---
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      this.settings.bloom,
      0.4,
      0.55
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Spread dai settings + framing automatico (se la camera non è salvata).
    if (this.settings.spread !== 1) {
      applySpread(graph.nodes, this.settings.spread);
      this.syncNodePositions();
      this.updateLinkPositions();
      this.updateCurvedPositions();
      this.writeDustPositions();
    }
    if (opts.savedCamera) {
      const c = opts.savedCamera;
      this.camera.position.set(c.px, c.py, c.pz);
      this.controls.target.set(c.tx, c.ty, c.tz);
      this.interacted = c.interacted;
      this.controls.update();
    } else {
      this.frameCamera();
    }

    // --- Interazioni ---
    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerDown = (e) => {
      this.downX = e.clientX;
      this.downY = e.clientY;
    };
    this.onPointerUp = (e) => {
      const dx = e.clientX - this.downX;
      const dy = e.clientY - this.downY;
      if (dx * dx + dy * dy > 36) return;
      const node = this.pick(e);
      this.selected = node === this.selected ? null : node;
      this.opts.onSelectionChange?.(this.selected ? this.selected.file : null);
      this.applyAppearance();
    };
    this.onDblClick = (e) => {
      const node = this.pick(e);
      if (node) this.opts.onOpenFile(node.file);
    };
    this.onKey = (e) => {
      if (e.key === "Escape" && this.selected) {
        this.selected = null;
        this.opts.onSelectionChange?.(null);
        this.applyAppearance();
      }
    };
    this.onControlsStart = () => {
      this.interacted = true;
    };

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("dblclick", this.onDblClick);
    window.addEventListener("keydown", this.onKey);
    this.controls.addEventListener("start", this.onControlsStart);

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(container);

    this.loop();
  }

  // ============================================================
  // STARFIELD — hash indipendenti reali (fmix avalanche), nessun pattern.
  // ============================================================
  private addStarLayer(count: number, rMin: number, rMax: number, size: number, baseOpacity: number, salt: string): void {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const id = salt + "-" + i;
      // Coordinate derivate da hash DOMINI DIVERSI, mai l'uno dall'altro.
      const u1 = rnd(id, "x");
      const u2 = rnd(id, "y");
      const u3 = rnd(id, "z");
      const u4 = rnd(id, "brightness");
      const u5 = rnd(id, "tint");
      const theta = 2 * Math.PI * u1;
      const cosPhi = 2 * u2 - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const radius = rMin + (rMax - rMin) * Math.cbrt(u3);
      pos[i * 3] = radius * sinPhi * Math.cos(theta);
      pos[i * 3 + 1] = radius * sinPhi * Math.sin(theta);
      pos[i * 3 + 2] = radius * cosPhi;
      let cr = 0.98;
      let cg = 0.98;
      let cb = 1.0;
      if (u5 > 0.92) {
        cr = 1.0;
        cg = 0.96;
        cb = 0.9;
      } else if (u5 < 0.08) {
        cr = 0.92;
        cg = 0.96;
        cb = 1.0;
      }
      const dim = u4 * u4 * 0.85 + 0.15;
      col[i * 3] = cr * dim;
      col[i * 3 + 1] = cg * dim;
      col[i * 3 + 2] = cb * dim;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: this.starTex,
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: baseOpacity * this.settings.stars,
      fog: false,
      depthWrite: false,
    });
    mat.userData.baseOpacity = baseOpacity;
    this.starMats.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = -3;
    this.scene.add(pts);
  }

  // ============================================================
  // NEBULA — CanvasTexture procedurali, toni molto scuri, non dominante.
  // ============================================================
  private buildNebula(): void {
    const defs: { seed: string; rgb: [number, number, number]; scale: number; pos: [number, number, number] }[] = [
      {
        seed: "neb-warm",
        rgb: [58, 40, 18],
        scale: 380,
        pos: [hashUnit("neb1", "x") * 160 - 80, hashUnit("neb1", "y") * 70 - 35, hashUnit("neb1", "z") * 160 - 80],
      },
      {
        seed: "neb-violet",
        rgb: [34, 26, 62],
        scale: 440,
        pos: [hashUnit("neb2", "x") * 180 - 90, hashUnit("neb2", "y") * 80 - 40, hashUnit("neb2", "z") * 180 - 90],
      },
      {
        seed: "neb-smoke",
        rgb: [40, 42, 48],
        scale: 500,
        pos: [hashUnit("neb3", "x") * 140 - 70, hashUnit("neb3", "y") * 60 - 30, hashUnit("neb3", "z") * 140 - 70],
      },
    ];
    for (const d of defs) {
      const tex = makeNebulaTexture(d.seed, d.rgb);
      this.nebulaTexs.push(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        opacity: this.settings.nebula * 0.85,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(d.pos[0], d.pos[1], d.pos[2]);
      sprite.scale.setScalar(d.scale);
      sprite.renderOrder = -2;
      this.nebulaSprites.push(sprite);
      this.scene.add(sprite);
    }
  }

  // ============================================================
  // NODI — core sphere + halo sprite additive (gerarchia per degree).
  // ============================================================
  private buildNodes(graph: GalaxyGraph): void {
    // Normalizzazione luminanza: l'identità della palette (hue) è preservata,
    // ma il bloom deriva dal degree, non dalla luminanza intrinseca del colore.
    for (const n of graph.nodes) {
      this.normColor.set(n.id, normalizeLuminance(new THREE.Color(n.color)));
    }
    for (const n of graph.nodes) {
      const t = degreeT(n, graph.maxDegree);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(n.color), fog: true });
      const mesh = new THREE.Mesh(this.coreGeo, mat);
      mesh.position.set(n.position.x, n.position.y, n.position.z);
      mesh.scale.setScalar(n.radius);
      mesh.userData.nodeId = n.id;
      this.nodeMeshes.push(mesh);
      this.nodeByMesh.set(mesh, n);

      // Gerarchia halo: periferico quasi invisibile → hub chiaramente visibile.
      const haloMat = new THREE.SpriteMaterial({
        map: this.haloTex,
        color: new THREE.Color(n.color),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
        opacity: 0.06 + 0.42 * t,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.position.copy(mesh.position);
      const haloScale = 2 * n.radius * (1.4 + 1.4 * t);
      halo.scale.setScalar(haloScale);
      halo.userData = { node: n, baseScale: haloScale, baseOpacity: haloMat.opacity };
      this.halos.push(halo);

      this.scene.add(mesh);
      this.scene.add(halo);
    }
  }

  // ============================================================
  // LINKS — stats intra/inter + factor di importanza per macro-bridge.
  // ============================================================
  private buildLinkStats(): void {
    const macro = this.graph.macro;
    for (const [, w] of macro.pairWeight) this.maxPairWeight = Math.max(this.maxPairWeight, w);
    for (let i = 0; i < this.graph.links.length; i++) {
      const l = this.graph.links[i];
      const a = this.graph.nodeById.get(l.source);
      const b = this.graph.nodeById.get(l.target);
      const isInter = !!a && !!b && a.area !== b.area;
      this.interLink.push(isInter);
      if (isInter && a && b) {
        const w = macro.pairWeight.get(macroKey(a.area, b.area)) ?? 0;
        const imp = w / this.maxPairWeight;
        // Inter-area a riposo: effettivo ~0.004–0.010 (filamenti debolissimi).
        let f = 0.14 + 0.22 * imp;
        // Strong macro bridges: effettivo ~0.012–0.022.
        if (imp > 0.6) f *= 1.6 + 0.6 * ((imp - 0.6) / 0.4);
        this.restFactor.push(f);
      } else {
        this.restFactor.push(1);
      }
    }
  }

  // Curve solo per le macro-relazioni più forti (non ogni edge).
  private buildCurvedBridges(): void {
    const macro = this.graph.macro;
    const cands: { i: number; w: number; deg: number }[] = [];
    for (let i = 0; i < this.graph.links.length; i++) {
      if (!this.interLink[i]) continue;
      const l = this.graph.links[i];
      const a = this.graph.nodeById.get(l.source)!;
      const b = this.graph.nodeById.get(l.target)!;
      const w = macro.pairWeight.get(macroKey(a.area, b.area)) ?? 0;
      cands.push({ i, w, deg: a.degree + b.degree });
    }
    cands.sort((x, y) => y.w - x.w || y.deg - x.deg);
    let chosen = cands.filter((c) => c.w >= 2).slice(0, 30);
    if (chosen.length < 12) chosen = cands.slice(0, 12);

    for (const c of chosen) {
      const l = this.graph.links[c.i];
      const a = this.graph.nodeById.get(l.source)!;
      const b = this.graph.nodeById.get(l.target)!;
      const pa = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
      const pb = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      const axis = new THREE.Vector3().subVectors(pb, pa);
      const len = axis.length() || 1;
      let perp = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
      if (perp.lengthSq() < 0.001) perp = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0));
      perp.normalize();
      const sign = hash32(l.source + "#" + l.target) % 2 === 0 ? 1 : -1;
      // Curvatura molto sottile: filamento, non arco grafico.
      const bulge = perp.multiplyScalar(sign * len * 0.09);
      const geo = new THREE.BufferGeometry().setFromPoints(
        bezierPoints(pa, pb, bulge, 16)
      );
      const mat = new THREE.LineBasicMaterial({
        color: LINK_COLOR.clone(),
        transparent: true,
        opacity: this.settings.linkOpacity,
        fog: true,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.curved.push({ linkIdx: c.i, line, aId: l.source, bId: l.target, bulge });
      this.scene.add(line);
    }
  }

  // ============================================================
  // DUST — volume ellissoidale intorno alla galaxy, jitter 3D indipendente.
  // Nessuna interpolazione tra nodi (niente scie lineari).
  // ============================================================
  private buildDust(): void {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const count = coarse ? 420 : 700;
    this.dustSpec = [];
    for (let i = 0; i < count; i++) {
      const key = "dust-" + i;
      // Direzione sferica da3 hash indipendenti + raggio volumetrico.
      const theta = 2 * Math.PI * rnd(key, "theta");
      const cosPhi = 2 * rnd(key, "phi") - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      this.dustSpec.push({
        nodeIdx: 0,
        ox: sinPhi * Math.cos(theta),
        oy: cosPhi,
        oz: sinPhi * Math.sin(theta),
        free: true,
        fx: Math.cbrt(rnd(key, "rad")),
        fy: rnd(key, "b"),
        fz: 0,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const carr = col.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const b = 0.25 + rnd("dust-" + i, "brightness") * 0.3;
      carr[i * 3] = 0.72 * b;
      carr[i * 3 + 1] = 0.75 * b;
      carr[i * 3 + 2] = 0.88 * b;
    }
    const mat = new THREE.PointsMaterial({
      map: this.starTex,
      size: 1.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      fog: true,
      depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.writeDustPositions();
    this.scene.add(this.dust);
  }

  private writeDustPositions(): void {
    if (!this.dust) return;
    const attr = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const nodes = this.graph.nodes;

    // Ellissoide attorno al bounding volume dei soli knowledge nodes.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let minX = -100;
    let maxX = 100;
    let minY = -60;
    let maxY = 60;
    let minZ = -100;
    let maxZ = 100;
    if (nodes.length > 0) {
      minX = maxX = nodes[0].position.x;
      minY = maxY = nodes[0].position.y;
      minZ = maxZ = nodes[0].position.z;
      for (const n of nodes) {
        minX = Math.min(minX, n.position.x);
        maxX = Math.max(maxX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxY = Math.max(maxY, n.position.y);
        minZ = Math.min(minZ, n.position.z);
        maxZ = Math.max(maxZ, n.position.z);
      }
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
      cz = (minZ + maxZ) / 2;
    }
    // Assi ellittici con margine (1.15×) — polvere che avvolge la galassia.
    const ax = ((maxX - minX) / 2) * 1.15 + 25;
    const ay = ((maxY - minY) / 2) * 1.15 + 18;
    const az = ((maxZ - minZ) / 2) * 1.15 + 25;

    for (let i = 0; i < this.dustSpec.length; i++) {
      const s = this.dustSpec[i];
      const rad = s.fx; // cbrt uniforme in [0,1]
      arr[i * 3] = cx + s.ox * rad * ax;
      arr[i * 3 + 1] = cy + s.oy * rad * ay;
      arr[i * 3 + 2] = cz + s.oz * rad * az;
    }
    attr.needsUpdate = true;
    this.dust.geometry.computeBoundingSphere();
  }

  // ============================================================
  // CAMERA — framing ESCLUSIVAMENTE sui knowledge nodes.
  // Target: 68–74% della dimensione limitante, centro weighted,
  // leggero offset artistico verticale, asse fuori asse.
  // ============================================================
  private frameCamera(): void {
    if (this.graph.nodes.length === 0) {
      this.camera.position.set(40, 50, 320);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    // Center pesato sul degree (hub al centro della composizione).
    let wsum = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const n of this.graph.nodes) {
      const w = 1 + n.degree;
      wsum += w;
      cx += n.position.x * w;
      cy += n.position.y * w;
      cz += n.position.z * w;
    }
    if (wsum > 0) {
      cx /= wsum;
      cy /= wsum;
      cz /= wsum;
    }
    // Bounding sphere dei soli knowledge nodes (nessun elemento decorativo).
    const box = new THREE.Box3();
    for (const n of this.graph.nodes) box.expandByPoint(new THREE.Vector3(n.position.x, n.position.y, n.position.z));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius;

    // Dimensione limitante del viewport (aspect-aware).
    const aspect = this.camera.aspect || 1;
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const half = Math.min(vHalf, hHalf);
    const fill = 0.74; // galassia ≈ 72–76% della dimensione limitante
    const dist = radius / Math.sin(half * fill);

    // Offset artistico leggero verso l'alto (niente mezzo schermo vuoto).
    const target = new THREE.Vector3(cx, cy - radius * 0.05, cz);
    const dir = new THREE.Vector3(0.45, 0.35, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.minDistance = Math.max(15, radius * 0.12);
    this.controls.maxDistance = Math.max(1400, dist * 3);
    this.controls.update();
  }

  // ============================================================
  // PICK & INTERAZIONI
  // ============================================================
  private pick(e: PointerEvent | MouseEvent): GalaxyNode | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeMeshes, false);
    if (hits.length > 0) return this.nodeByMesh.get(hits[0].object as THREE.Mesh) ?? null;
    return null;
  }

  private handlePointerMove(e: PointerEvent): void {
    const now = performance.now();
    if (now - this.lastRaycast < 40) return;
    this.lastRaycast = now;
    const node = this.pick(e);
    this.renderer.domElement.style.cursor = node ? "pointer" : "grab";
    if (node === this.hovered) return;
    this.hovered = node;
    this.applyAppearance();
  }

  // ============================================================
  // APPEARANCE — selected white-hot, 1° full, 2° parziale, resto ~15%.
  // ============================================================
  private applyAppearance(): void {
    const selected = this.selected;
    const first = selected ? new Set<string>([selected.id, ...selected.neighbors]) : null;
    const second = new Set<string>();
    if (selected && first) {
      for (const nb of selected.neighbors) {
        const node = this.graph.nodeById.get(nb);
        if (!node) continue;
        for (const nb2 of node.neighbors) {
          if (!first.has(nb2)) second.add(nb2);
        }
      }
    }

    for (let i = 0; i < this.nodeMeshes.length; i++) {
      const mesh = this.nodeMeshes[i];
      const n = this.nodeByMesh.get(mesh)!;
      const t = degreeT(n, this.graph.maxDegree);
      const brightness = 0.55 + 0.5 * t;
      const base = this.normColor.get(n.id) ?? new THREE.Color(n.color);
      const color = base.clone().multiplyScalar(Math.min(1, brightness));
      let scale = n.radius;
      const halo = this.halos[i];
      let haloScale = (halo.userData.baseScale as number) ?? 2 * n.radius * (1.4 + 1.4 * t);
      let haloOpacity = (halo.userData.baseOpacity as number) ?? 0.06 + 0.42 * t;

      if (first) {
        if (n.id === selected!.id) {
          color.lerp(new THREE.Color(1, 1, 1), 0.75);
          scale *= 1.3;
          haloOpacity = 0.95;
          haloScale *= 1.6;
        } else if (first.has(n.id)) {
          // 1° grado: 100% area color (nessuna desaturazione).
          haloOpacity = Math.min(0.7, haloOpacity * 1.35);
        } else if (second.has(n.id)) {
          color.multiplyScalar(0.5);
          haloOpacity *= 0.45;
        } else {
          color.multiplyScalar(0.12);
          haloOpacity *= 0.3;
        }
      }

      if (n === this.hovered && !(first && !first.has(n.id) && !second.has(n.id))) {
        if (n.id !== selected?.id) {
          color.lerp(new THREE.Color(1, 1, 1), 0.35);
          haloOpacity = Math.max(haloOpacity, 0.65);
          haloScale *= 1.2;
        }
      }

      (mesh.material as THREE.MeshBasicMaterial).color.copy(color);
      mesh.scale.setScalar(scale);
      (halo.material as THREE.SpriteMaterial).color.copy(color);
      (halo.material as THREE.SpriteMaterial).opacity = haloOpacity;
      halo.scale.setScalar(haloScale);
      halo.userData.currentScale = haloScale;
    }

    const focus = selected ?? this.hovered;
    this.applyLinkColors(focus, focus === selected ? second : null);
    this.updateLabel();
  }

  private applyLinkColors(focus: GalaxyNode | null, second: Set<string> | null): void {
    const colors = this.linkGeo.getAttribute("color") as THREE.BufferAttribute;
    const arr = colors.array as Float32Array;
    let f: number;
    if (focus) {
      // Selected: direct ~0.52 · Hover: direct ~0.30 (moderato).
      this.linkMat.opacity = focus === this.selected ? 0.52 : 0.3;
      const neigh = focus.neighbors;
      for (let i = 0; i < this.graph.links.length; i++) {
        const l = this.graph.links[i];
        if (l.source === focus.id || l.target === focus.id) f = 1;
        else if (neigh.has(l.source) || neigh.has(l.target)) f = 0.45;
        else if (second && (second.has(l.source) || second.has(l.target))) f = 0.12;
        else f = 0.004;
        arr[i * 6] = LINK_COLOR.r * f;
        arr[i * 6 + 1] = LINK_COLOR.g * f;
        arr[i * 6 + 2] = LINK_COLOR.b * f;
        arr[i * 6 + 3] = LINK_COLOR.r * f;
        arr[i * 6 + 4] = LINK_COLOR.g * f;
        arr[i * 6 + 5] = LINK_COLOR.b * f;
      }
    } else {
      this.linkMat.opacity = this.settings.linkOpacity;
      for (let i = 0; i < this.graph.links.length; i++) {
        f = this.restFactor[i];
        arr[i * 6] = LINK_COLOR.r * f;
        arr[i * 6 + 1] = LINK_COLOR.g * f;
        arr[i * 6 + 2] = LINK_COLOR.b * f;
        arr[i * 6 + 3] = LINK_COLOR.r * f;
        arr[i * 6 + 4] = LINK_COLOR.g * f;
        arr[i * 6 + 5] = LINK_COLOR.b * f;
      }
    }
    colors.needsUpdate = true;

    // Curve bridges: stesso factor del rispettivo link retto.
    for (const c of this.curved) {
      let ff: number;
      if (focus) {
        const l = this.graph.links[c.linkIdx];
        if (l.source === focus.id || l.target === focus.id) ff = 1;
        else if (focus.neighbors.has(l.source) || focus.neighbors.has(l.target)) ff = 0.45;
        else if (second && (second.has(l.source) || second.has(l.target))) ff = 0.12;
        else ff = 0.004;
      } else {
        ff = this.restFactor[c.linkIdx];
      }
      const m = c.line.material as THREE.LineBasicMaterial;
      m.color.copy(LINK_COLOR).multiplyScalar(ff);
      m.opacity = this.linkMat.opacity;
    }
  }

  private updateLinkPositions(): void {
    const attr = this.linkGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.graph.links.length; i++) {
      const l = this.graph.links[i];
      const a = this.graph.nodeById.get(l.source);
      const b = this.graph.nodeById.get(l.target);
      if (!a || !b) continue;
      arr[i * 6] = a.position.x;
      arr[i * 6 + 1] = a.position.y;
      arr[i * 6 + 2] = a.position.z;
      arr[i * 6 + 3] = b.position.x;
      arr[i * 6 + 4] = b.position.y;
      arr[i * 6 + 5] = b.position.z;
    }
    attr.needsUpdate = true;
    this.linkGeo.computeBoundingSphere();
  }

  private updateCurvedPositions(): void {
    for (const c of this.curved) {
      const a = this.graph.nodeById.get(c.aId);
      const b = this.graph.nodeById.get(c.bId);
      if (!a || !b) continue;
      const pa = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
      const pb = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      const pts = bezierPoints(pa, pb, c.bulge, 16);
      c.line.geometry.setFromPoints(pts);
      c.line.geometry.computeBoundingSphere();
    }
  }

  private syncNodePositions(): void {
    for (let i = 0; i < this.nodeMeshes.length; i++) {
      const n = this.nodeByMesh.get(this.nodeMeshes[i])!;
      this.nodeMeshes[i].position.set(n.position.x, n.position.y, n.position.z);
      this.halos[i].position.set(n.position.x, n.position.y, n.position.z);
    }
  }

  // ============================================================
  // LABEL — solo hovered/selected: nome, macro-area, link count.
  // ============================================================
  private updateLabel(): void {
    const labelEl = this.opts.labelEl;
    const node = this.hovered ?? this.selected;
    labelEl.textContent = "";
    if (!node) {
      labelEl.classList.remove("is-visible");
      return;
    }
    const areaName = node.area === "root" ? "Root" : node.area.replace(/^\d+_/, "").replace(/_/g, " ");
    const title = document.createElement("div");
    title.className = "asb-gg-label-title";
    title.textContent = node.label;
    const meta = document.createElement("div");
    meta.className = "asb-gg-label-meta";
    meta.textContent = areaName + " · " + node.degree + " links";
    labelEl.append(title, meta);
    labelEl.classList.add("is-visible");
  }

  private positionLabel(): void {
    const labelEl = this.opts.labelEl;
    if (!labelEl.classList.contains("is-visible")) return;
    const node = this.hovered ?? this.selected;
    if (!node) return;
    const mesh = this.nodeMeshes.find((m) => this.nodeByMesh.get(m) === node);
    if (!mesh) return;
    const v = new THREE.Vector3();
    mesh.getWorldPosition(v);
    v.project(this.camera);
    if (v.z > 1) {
      labelEl.classList.remove("is-visible");
      return;
    }
    const rect = this.container.getBoundingClientRect();
    labelEl.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
    labelEl.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
  }

  // ============================================================
  // RESIZE / LOOP
  // ============================================================
  private handleResize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    // Re-framing solo se l'utente non ha ancora interagito.
    if (!this.interacted) this.frameCamera();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.controls.update();
    this.positionLabel();
    // Pulse leggero sul selected (disattivato con prefers-reduced-motion).
    if (this.selected && !this.reducedMotion) {
      const idx = this.nodeMeshes.findIndex((m) => this.nodeByMesh.get(m) === this.selected);
      if (idx >= 0) {
        const halo = this.halos[idx];
        const base = (halo.userData.currentScale as number) ?? (halo.userData.baseScale as number) ?? 1;
        const pulse = 1 + 0.05 * Math.sin(performance.now() * 0.003);
        halo.scale.setScalar(base * pulse);
      }
    }
    this.composer.render();
  };

  // ============================================================
  // SETTINGS (HUD)
  // ============================================================
  setBloom(strength: number): void {
    this.settings.bloom = strength;
    this.bloomPass.strength = strength;
  }

  setSpread(spread: number): void {
    this.settings.spread = spread;
    applySpread(this.graph.nodes, spread);
    this.syncNodePositions();
    this.updateLinkPositions();
    this.updateCurvedPositions();
    this.writeDustPositions();
    if (!this.interacted) this.frameCamera();
  }

  setLinkOpacity(opacity: number): void {
    this.settings.linkOpacity = opacity;
    this.applyAppearance();
  }

  setFog(density: number): void {
    this.settings.fog = density;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = density;
  }

  setNebula(opacity: number): void {
    this.settings.nebula = opacity;
    for (const s of this.nebulaSprites) {
      (s.material as THREE.SpriteMaterial).opacity = opacity * 0.85;
    }
  }

  setStars(mult: number): void {
    this.settings.stars = mult;
    for (const m of this.starMats) {
      m.opacity = ((m.userData.baseOpacity as number) ?? 0.5) * mult;
    }
  }

  getCameraState(): CameraState {
    return {
      px: this.camera.position.x,
      py: this.camera.position.y,
      pz: this.camera.position.z,
      tx: this.controls.target.x,
      ty: this.controls.target.y,
      tz: this.controls.target.z,
      interacted: this.interacted,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObs.disconnect();

    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("dblclick", this.onDblClick);
    window.removeEventListener("keydown", this.onKey);
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Sprite) {
        (obj.material as THREE.SpriteMaterial).dispose();
      } else if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.LineSegments ||
        obj instanceof THREE.Line ||
        obj instanceof THREE.Points
      ) {
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else (m as THREE.Material).dispose();
        (obj as THREE.Mesh).geometry.dispose();
      }
    });

    this.coreGeo.dispose();
    this.haloTex.dispose();
    this.starTex.dispose();
    for (const t of this.nebulaTexs) t.dispose();
    this.linkGeo.dispose();
    this.linkMat.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

// ============================================================
// HELPERS
// ============================================================

// FNV-1a + murmur finalizer (avalanche): elimina correlazioni tra
// indici consecutivi che producevano striature/archi nello starfield.
function hashFmix(s: string): number {
  let h = hash32(s);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Valore deterministico indipendente in [0, 1) per chiave di dominio separato.
function rnd(id: string, channel: string): number {
  return hashFmix(id + "¤" + channel) / 4294967296;
}

function smoothstep01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function degreeT(n: GalaxyNode, maxDegree: number): number {
  return Math.log(1 + n.degree) / Math.log(1 + Math.max(1, maxDegree));
}

// Normalizza la luminanza percepita preservando hue/saturazione (scala uniforme).
// Un hub giallo periferico non brilla più di un hub blu solo per il colore.
function normalizeLuminance(color: THREE.Color): THREE.Color {
  const L = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  if (L <= 0.0001) return color;
  const target = 0.5;
  let k = target / L;
  k = Math.max(0.55, Math.min(k, 1.8));
  const maxCh = Math.max(color.r, color.g, color.b, 0.0001);
  k = Math.min(k, 0.95 / maxCh);
  return color.clone().multiplyScalar(k);
}

// Sprite stellare circolare morbido (64×64) — niente quadrati/pixel.
function makeStarTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.32)");
  g.addColorStop(0.75, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function bezierPoints(a: THREE.Vector3, b: THREE.Vector3, bulge: THREE.Vector3, segments: number): THREE.Vector3[] {
  // Control point offset in modo che la curva passi da mid + bulge.
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const control = mid.clone().add(bulge.clone().multiplyScalar(2));
  const curve = new THREE.QuadraticBezierCurve3(a, control, b);
  return curve.getPoints(segments);
}

function makeHaloTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.2, "rgba(255,255,255,0.32)");
  g.addColorStop(0.5, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Nebula: value noise a bassa frequenza su griglia non periodica +
// maschera radiale con bordi completamente sfumati. Nessun tiling,
// nessuna griglia, nessuna periodicità. Canvas 512×512.
function makeNebulaTexture(seed: string, rgb: [number, number, number]): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Griglie non-wrapping a2 frequenze (lattice indipendenti dal seed).
  const lat1 = makeLattice(seed, 7);
  const lat2 = makeLattice(seed + "#2", 13);

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      // Noise a bassa frequenza (nessuna periodicità: clamp ai bordi).
      let n = sampleLattice(lat1, 7, u, v) * 0.62 + sampleLattice(lat2, 13, u, v) * 0.38;
      n = n * n * (3 - 2 * n);
      // Maschera radiale: alpha = 0 ben prima del bordo della texture.
      const dx = u * 2 - 1;
      const dy = v * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const edge = 1 - smoothstep01((d - 0.32) / (0.98 - 0.32));
      const a = 255 * edge * (0.3 + 0.7 * n) * 0.78;
      const i = (y * size + x) * 4;
      const lum = 0.75 + 0.5 * n;
      data[i] = Math.min(255, rgb[0] * lum);
      data[i + 1] = Math.min(255, rgb[1] * lum);
      data[i + 2] = Math.min(255, rgb[2] * lum);
      data[i + 3] = Math.round(Math.max(0, Math.min(255, a)));
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Lattice di valori 0..1 — non periodico (clamp ai bordi in lettura).
function makeLattice(seed: string, n: number): Float32Array {
  const lat = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      lat[j * n + i] = rnd(seed, i + "," + j);
    }
  }
  return lat;
}

// Bilinear con smoothstep — interpolazione morbida, zero griglia.
function sampleLattice(lat: Float32Array, n: number, u: number, v: number): number {
  const fx = Math.min(n - 1, Math.max(0, u * (n - 1)));
  const fy = Math.min(n - 1, Math.max(0, v * (n - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const sx = smoothstep01(fx - x0);
  const sy = smoothstep01(fy - y0);
  const a = lat[y0 * n + x0];
  const b = lat[y0 * n + x1];
  const cc = lat[y1 * n + x0];
  const d = lat[y1 * n + x1];
  return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
}

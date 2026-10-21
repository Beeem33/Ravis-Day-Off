import * as THREE from 'three';

/**
 * DeckCut — holes broken out of a road deck, in the deck's own materials.
 *
 * The street's decks are a few huge merged meshes, so a stretch of one
 * can't be hidden; instead the materials they're drawn in (asphalt,
 * concrete, paint) are patched to discard any fragment inside a hole: a
 * prism standing on a stretch of road, `halfLen` either way of its centre
 * along the road, `latMin`..`latMax` across it (the road's own offsets, +
 * to its right), from just under the deck's underside to over its barriers.
 * The road may bend a little through it (`bend`: how far the centreline
 * sweeps right per metre², as y = ½·bend·x²). The inner edge and the ends
 * are ragged, by jag() and jagEnd(), so whatever stands in for the broken
 * faces has to follow the same lines.
 *
 * Patching changes nothing until a hole is opened; holes are shared by
 * every patched material and closed again with reset().
 */

export const MAX_HOLES = 2;

export interface DeckHole {
  /** On the road's centreline, at the deck's surface. */
  centre: THREE.Vector3;
  /** The road's direction there (unit, in the ground plane). */
  tangent: THREE.Vector3;
  halfLen: number;
  latMin: number;
  latMax: number;
  bend: number;
  /** Which edge is the broken one along its length: +1 latMin (it runs out to the road's right), −1 latMax. */
  side: 1 | -1;
}

/** The ragged line of a hole's long edge, across it, at `al` along it. */
export function jag(al: number): number {
  return 0.22 * Math.sin(al * 1.9) + 0.12 * Math.sin(al * 4.3 + 1.3);
}

/** The ragged line of a hole's ends, along it, at `la` across it. */
export function jagEnd(la: number): number {
  return 0.35 * Math.sin(la * 2.3) + 0.15 * Math.sin(la * 5.1 + 0.7);
}

/** How far under and over the deck's surface a hole cuts. */
export const CUT_BELOW = 1.75;
export const CUT_ABOVE = 1.3;

const A = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4());
const B = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4());
const C = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4());
const uniforms = { uDeckA: { value: A }, uDeckB: { value: B }, uDeckC: { value: C } };

const VERT_HEAD = 'varying vec3 vDeckW;\nvarying float vDeckNy;\n';
const VERT_BODY = `#include <project_vertex>
  vDeckW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vDeckNy = normalize(mat3(modelMatrix) * objectNormal).y;`;
const FRAG_HEAD = `uniform vec4 uDeckA[${MAX_HOLES}];
uniform vec4 uDeckB[${MAX_HOLES}];
uniform vec4 uDeckC[${MAX_HOLES}];
varying vec3 vDeckW;
varying float vDeckNy;
`;
const FRAG_BODY = `for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (uDeckC[i].y < 0.5) continue;
    vec2 rel = vDeckW.xz - uDeckA[i].xy;
    vec2 t = uDeckA[i].zw;
    float al = dot(rel, t);
    float la = dot(rel, vec2(-t.y, t.x)) - 0.5 * uDeckC[i].x * al * al;
    float y = vDeckW.y - uDeckB[i].w;
    float j = 0.22 * sin(al * 1.9) + 0.12 * sin(al * 4.3 + 1.3);
    float lo = uDeckB[i].y + (uDeckC[i].z > 0.0 ? j : 0.0);
    float hi = uDeckB[i].z + (uDeckC[i].z < 0.0 ? j : 0.0);
    float e = 0.35 * sin(la * 2.3) + 0.15 * sin(la * 5.1 + 0.7);
    // Not the tops of the pier caps it stood on: they stay
    bool cap = y < -1.5 && vDeckNy > 0.5;
    if (abs(al) < uDeckB[i].x + e && la > lo && la < hi && y > -${CUT_BELOW.toFixed(2)} && y < ${CUT_ABOVE.toFixed(2)} && !cap) discard;
  }
  #include <clipping_planes_fragment>`;

/** Patch a material so the holes cut it. Idempotent; recompiles it if it had been drawn already. */
export function cutDeck(mat: THREE.Material): void {
  if (mat.userData.deckCut) return;
  mat.userData.deckCut = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <project_vertex>', VERT_BODY);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <clipping_planes_fragment>', FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'deckCut';
  mat.needsUpdate = true;
}

/** Open hole `i`. */
export function openHole(i: number, h: DeckHole): void {
  A[i].set(h.centre.x, h.centre.z, h.tangent.x, h.tangent.z);
  B[i].set(h.halfLen, h.latMin, h.latMax, h.centre.y);
  C[i].set(h.bend, 1, h.side, 0);
}

/** Every hole closed: the deck whole again. */
export function resetHoles(): void {
  for (const c of C) c.y = 0;
}

/** Is the road point (`al` along the hole from its centre, `la` across, as the shader measures them) inside hole `h`? */
export function inHole(h: DeckHole, al: number, la: number): boolean {
  const j = jag(al);
  const lo = h.latMin + (h.side > 0 ? j : 0);
  const hi = h.latMax + (h.side < 0 ? j : 0);
  return Math.abs(al) < h.halfLen + jagEnd(la) && la > lo && la < hi;
}

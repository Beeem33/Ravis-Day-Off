import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * foldProp — a prop that moves as a whole (a van, a rifle) but is built out
 * of many little meshes, drawn as one mesh per material instead: the same
 * triangles, the same materials, where they were — a handful of draws for
 * what was hundreds, and a handful of objects to update each frame.
 * (mergeStatic does this for a level's fixed dressing, in world space; this
 * works in the prop's own frame, so the prop can go on moving.)
 *
 * Every plain mesh under `root` is baked into root's frame and merged with
 * the others that share its material, shadow flags, draw order, surface tag
 * and attributes, then taken out; the merged meshes go on `root`. Whatever
 * `keep` picks is left exactly as it is, with everything under it — the
 * parts that move, or that a scene reaches for. So are skinned, instanced,
 * hidden and multi-material meshes, and any mirrored by its transform
 * (merged, its faces would turn inside out). Groups it empties stay, empty.
 *
 * Returns the merged meshes.
 */
export function foldProp(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  type Bucket = { mat: THREE.Material; src: THREE.Mesh; geos: THREE.BufferGeometry[]; from: THREE.Mesh[] };
  const buckets = new Map<string, Bucket>();
  const m = new THREE.Matrix4();
  const walk = (o: THREE.Object3D): void => {
    if (o !== root && (keep(o) || !o.visible)) return;
    const mesh = o as THREE.Mesh;
    if (o !== root && mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material)) {
      m.multiplyMatrices(toRoot, mesh.matrixWorld);
      const g = mesh.geometry;
      if (m.determinant() > 0 && !g.morphAttributes.position && g.groups.length <= 1) {
        const attrs = Object.keys(g.attributes)
          .sort()
          .map((k) => `${k}${g.attributes[k].itemSize}${g.attributes[k].normalized ? 'n' : ''}`)
          .join(',');
        const key = [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, String(mesh.userData.surface), attrs, g.index ? 'i' : '-'].join('|');
        let b = buckets.get(key);
        if (!b) {
          b = { mat: mesh.material, src: mesh, geos: [], from: [] };
          buckets.set(key, b);
        }
        const copy = g.clone();
        copy.clearGroups();
        copy.applyMatrix4(m);
        b.geos.push(copy);
        b.from.push(mesh);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  const out: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    const merged = b.from.length > 1 ? mergeGeometries(b.geos, false) : null;
    for (const g of b.geos) g.dispose();
    // One alone gains nothing, and a set that won't merge is left as it was
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.src.castShadow;
    mesh.receiveShadow = b.src.receiveShadow;
    mesh.renderOrder = b.src.renderOrder;
    mesh.frustumCulled = b.from.every((f) => f.frustumCulled);
    if (b.src.userData.surface !== undefined) mesh.userData.surface = b.src.userData.surface;
    for (const f of b.from) f.removeFromParent();
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}

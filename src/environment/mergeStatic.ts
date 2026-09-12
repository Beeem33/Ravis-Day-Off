import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Fold static dressing into one mesh per material, in place.
 *
 * Every prop is a group of ten-odd little meshes, and a room full of them is
 * draw-call bound long before it is light bound — on level four the props
 * were 1205 of 2040 calls on the worst sightline. Nothing here moves, so it
 * can be baked.
 *
 * Anything that cannot be folded in — multi-material meshes, sprites, or a
 * bucket whose geometries disagree on their attributes — is put back with its
 * world transform baked into its geometry, so it stands exactly where it did.
 * Skipping those on the way in and deleting them with everything else is how
 * level four lost first its pictures and then its vending machine shells.
 *
 * @param group     the level's root; merged meshes are added to it
 * @param roots     the prop groups to fold (each is removed afterwards)
 * @param shootables the bullet-target list, updated to match
 * @returns the new shootables list
 */
export function mergeStatic(
  group: THREE.Group,
  roots: THREE.Object3D[],
  shootables: THREE.Object3D[]
): THREE.Object3D[] {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { geo: THREE.BufferGeometry; src: THREE.Mesh }[]>();
  const salvage: { obj: THREE.Object3D; world: THREE.Matrix4 }[] = [];

  for (const root of roots) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || Array.isArray(m.material)) {
        if (!(o as THREE.Group).isGroup) salvage.push({ obj: o, world: o.matrixWorld.clone() });
        return;
      }
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const mat = m.material as THREE.Material;
      const list = buckets.get(mat);
      if (list) list.push({ geo, src: m });
      else buckets.set(mat, [{ geo, src: m }]);
    });
  }

  const folded = new Set<THREE.Object3D>();
  const added: THREE.Mesh[] = [];
  for (const [mat, entries] of buckets) {
    const flat = entries.map((e) => (e.geo.index ? e.geo.toNonIndexed() : e.geo));
    const keys = Object.keys(flat[0].attributes).sort().join(',');
    const ok = flat.every((g) => Object.keys(g.attributes).sort().join(',') === keys);
    const one = ok ? mergeGeometries(flat, false) : null;
    if (!one) {
      for (const e of entries) {
        salvage.push({ obj: e.src, world: e.src.matrixWorld.clone() });
        e.geo.dispose();
      }
      continue;
    }
    const mesh = new THREE.Mesh(one, mat);
    mesh.userData.surface = 'metal';
    mesh.frustumCulled = false;
    group.add(mesh);
    added.push(mesh);
    for (const e of entries) {
      folded.add(e.src);
      e.geo.dispose();
    }
  }

  for (const root of roots) root.removeFromParent();
  for (const { obj, world } of salvage) {
    obj.removeFromParent();
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      m.geometry = m.geometry.clone().applyMatrix4(world);
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(1, 1, 1);
    } else {
      world.decompose(obj.position, obj.quaternion, obj.scale);
    }
    group.add(obj);
  }
  return shootables.filter((o) => !folded.has(o)).concat(added);
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * What a material looks like, as a string: two materials with the same key
 * draw the same, so their meshes can share a bucket. Most props make their
 * own materials as they are built — every desk its own copy of the same
 * wood — and keyed on the instance, a floor of forty desks folded into forty
 * meshes instead of one. Anything with shader hooks of its own is only ever
 * itself.
 */
function materialKey(m: THREE.Material): string {
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || (m as THREE.ShaderMaterial).isShaderMaterial) {
    return m.uuid;
  }
  const a = m as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
  const col = (c?: THREE.Color): string => (c ? c.getHexString() : '-');
  const tex = (t?: THREE.Texture | null): string => (t ? t.uuid : '-');
  return [
    m.type, col(a.color), col(a.emissive), a.emissiveIntensity, col(a.specular), a.shininess, a.roughness, a.metalness,
    tex(a.map), tex(a.emissiveMap), tex(a.normalMap), tex(a.roughnessMap), tex(a.metalnessMap), tex(a.alphaMap),
    tex(a.aoMap), tex(a.envMap), tex(a.lightMap), tex(a.bumpMap), tex(a.specularMap),
    m.opacity, m.transparent, m.side, m.blending, m.depthWrite, m.depthTest, m.alphaTest, m.polygonOffset,
    m.polygonOffsetFactor, m.polygonOffsetUnits, m.vertexColors, a.flatShading, a.wireframe, a.fog, m.toneMapped,
    m.colorWrite, m.visible
  ].join('|');
}

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
  const same = new Map<string, THREE.Material>();
  const salvage: { obj: THREE.Object3D; world: THREE.Matrix4 }[] = [];

  for (const root of roots) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || Array.isArray(m.material)) {
        if (!(o as THREE.Group).isGroup) salvage.push({ obj: o, world: o.matrixWorld.clone() });
        return;
      }
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const key = materialKey(m.material as THREE.Material);
      let mat = same.get(key);
      if (!mat) {
        mat = m.material as THREE.Material;
        same.set(key, mat);
      }
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

import * as THREE from 'three';
import { suitMaterials, suitArmPieces, type SuitMats } from './FieldSuit';
import { RaviVisual, RaviRig, type Side } from './RaviVisual';

/**
 * Ravi's first-person arms in the field suit from the portal room: the
 * sleeves become the suit's white shell, his skin the black undersuit and
 * gloves, the watch goes, and the suit's bracers and upper-arm plates are
 * fixed to the bones so they move with every viewmodel's arm.
 *
 * Set as RaviVisual.dressArms for a level where he's wearing it.
 */

let mats: SuitMats | null = null;
let skinMat: THREE.MeshStandardMaterial | null = null;
let shellMat: THREE.MeshPhysicalMaterial | null = null;

function materials(): { M: SuitMats; skin: THREE.MeshStandardMaterial; shell: THREE.MeshPhysicalMaterial } {
  if (!mats) {
    mats = suitMaterials();
    // The pieces' own materials expect vertex colours their geometry carries; the rig's don't
    skinMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.62, metalness: 0.12, bumpMap: mats.under.bumpMap, bumpScale: 0.5, side: THREE.DoubleSide });
    shellMat = new THREE.MeshPhysicalMaterial({ color: 0xb4b9bf, roughness: 0.44, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
  }
  return { M: mats, skin: skinMat!, shell: shellMat! };
}

/** A frame on `bone` whose +Y runs along it toward `child`, and whose +Z faces `back` (model space). */
function along(bone: string, child: string, back: THREE.Vector3): THREE.Quaternion {
  const rb = RaviVisual.restBone(bone);
  const y = RaviVisual.restBone(child).localP.clone().normalize();
  const z = back.clone().applyQuaternion(rb.modelQ.clone().invert());
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function dressSuit(rig: RaviRig): void {
  const { M, skin, shell } = materials();
  for (const m of rig.meshes) {
    const n = (m.material as THREE.Material).name;
    if (n === 'SkinGame') m.material = skin;
    else if (n === 'G_Shirt') m.material = shell;
    else m.visible = false; // the watch
  }
  armPlates(rig, M);
  rig.root.traverse((o) => {
    o.frustumCulled = false;
    o.castShadow = false;
  });
}

/** The suit's bracers, elbows and upper-arm bands, fixed to a rig's arm bones. */
function armPlates(rig: RaviRig, M: SuitMats): void {
  const P = suitArmPieces(M);
  for (const sd of ['l', 'r'] as Side[]) {
    const hand = RaviVisual.handRest?.[sd];
    // The back of his hand, the way the bracer's top plate faces
    const back = hand ? hand.palm.clone().negate() : new THREE.Vector3(0, 1, 0);
    const lower = rig.bones.get(`lowerarm_${sd}`);
    const upper = rig.bones.get(`upperarm_${sd}`);
    if (lower) {
      const len = RaviRig.len(`lowerarm_${sd}`, `hand_${sd}`);
      const g = P.fore(len * 0.92);
      g.quaternion.copy(along(`lowerarm_${sd}`, `hand_${sd}`, back));
      g.scale.set(0.86, 1, 0.86);
      g.position.copy(new THREE.Vector3(0, len * 0.04, 0).applyQuaternion(g.quaternion));
      lower.add(g);
      const elbow = P.elbow();
      // (its own +Z runs down the forearm)
      const qe = along(`lowerarm_${sd}`, `hand_${sd}`, back).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
      elbow.quaternion.copy(qe);
      elbow.scale.setScalar(0.8);
      lower.add(elbow);
    }
    if (upper) {
      const len = RaviRig.len(`upperarm_${sd}`, `lowerarm_${sd}`);
      const g = P.upper(len * 0.9);
      g.quaternion.copy(along(`upperarm_${sd}`, `lowerarm_${sd}`, back));
      g.scale.set(0.95, 1, 0.95);
      upper.add(g);
    }
  }
}

/** Something worn on a bone, placed where it goes in the model's rest space. */
function wearOn(rig: RaviRig, bone: string, o: THREE.Object3D): void {
  const b = rig.bones.get(bone);
  if (!b) return;
  const rb = RaviVisual.restBone(bone);
  const inv = rb.modelQ.clone().invert();
  o.position.sub(rb.modelP).applyQuaternion(inv);
  o.quaternion.premultiply(inv);
  b.add(o);
}

let bootMat: THREE.MeshStandardMaterial | null = null;

/**
 * His whole body in the suit (the ragdoll, when he dies out there): the
 * clothes become the white shell, his skin the black undersuit, boots on his
 * feet, the arm plates, a helmet with its gold visor down over his face, and
 * the life-support pack on his back.
 */
export function dressSuitBody(rig: RaviRig): void {
  const { M, skin, shell } = materials();
  bootMat ??= new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7, metalness: 0.2 });
  for (const m of rig.meshes) {
    const n = (m.material as THREE.Material).name;
    if (n === 'SkinGame') m.material = skin;
    else if (/hair|eye|brow|teeth|mouth|lash|watch/i.test(n)) m.visible = false; // all inside the helmet (or gone)
    else if (/shoe|sole|boot|sock/i.test(n)) m.material = bootMat;
    else m.material = shell;
  }
  armPlates(rig, M);
  // The helmet: white shell, the gold visor across the front (he faces +Z), a ring at the neck, a lamp
  const head = RaviVisual.restBone('head').modelP;
  const helmet = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xeef0f2, roughness: 0.3, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const visor = new THREE.MeshStandardMaterial({ color: 0xb8862c, roughness: 0.08, metalness: 1, emissive: 0x2a1a04 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.35, metalness: 0.8 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.175, 32, 20), white);
  dome.scale.set(1, 1.04, 1.06);
  helmet.add(dome);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.178, 32, 16, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.26, Math.PI * 0.42), visor);
  glass.scale.set(1, 1.04, 1.06);
  helmet.add(glass);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.024, 10, 32), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.15;
  helmet.add(ring);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.5 }));
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0.15, 0.06, 0.06);
  helmet.add(lamp);
  const lamp2 = lamp.clone();
  lamp2.position.x = -0.15;
  helmet.add(lamp2);
  // A rim round the visor, comm pucks over the ears, a chin vent, an antenna
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.012, 8, 40, Math.PI * 1.25), ringMat);
  rim.rotation.set(0, 0, Math.PI * 0.62);
  rim.position.set(0, 0.015, 0.075);
  rim.scale.set(1, 0.82, 1);
  helmet.add(rim);
  for (const s of [-1, 1]) {
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 20), white);
    puck.rotation.z = Math.PI / 2;
    puck.position.set(s * 0.178, 0, -0.01);
    helmet.add(puck);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), ringMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(s * 0.2, 0, -0.01);
    helmet.add(cap);
  }
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), skin);
  vent.position.set(0, -0.12, 0.14);
  helmet.add(vent);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.16, 6), ringMat);
  antenna.position.set(-0.19, 0.1, -0.03);
  antenna.rotation.z = 0.15;
  helmet.add(antenna);
  helmet.position.set(head.x, head.y + 0.11, head.z + 0.01);
  wearOn(rig, 'head', helmet);
  // The pack on his back (-Z): a rounded slab with a dark panel and two hoses
  const pack = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.15), white);
  pack.add(box);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.01), skin);
  panel.position.z = -0.08;
  pack.add(panel);
  for (const s of [-1, 1]) {
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 8, 16, Math.PI), skin);
    hose.position.set(s * 0.12, 0.2, 0.06);
    hose.rotation.y = Math.PI / 2;
    pack.add(hose);
  }
  const spine = RaviVisual.restBone('spine_03').modelP;
  pack.position.set(0, spine.y - 0.02, spine.z - 0.17);
  wearOn(rig, 'spine_03', pack);
  rig.root.traverse((o) => {
    o.frustumCulled = false;
  });
}

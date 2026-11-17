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
    skinMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.62, metalness: 0.12, bumpMap: mats.under.bumpMap, bumpScale: 0.5 });
    shellMat = new THREE.MeshPhysicalMaterial({ color: 0xb4b9bf, roughness: 0.44, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.3 });
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
  rig.root.traverse((o) => {
    o.frustumCulled = false;
    o.castShadow = false;
  });
}

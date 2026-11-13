import * as THREE from 'three';
import type { CarRig } from '../scenes/Level8Contracts';

/**
 * CarMirrors — the Civic's rear-view mirror and its two door mirrors,
 * showing what's behind.
 *
 * One small camera rides behind the back bumper looking down the road
 * behind, wide, and renders into one texture each frame; each mirror shows
 * its own slice of it, flipped left for right the way a mirror is: the
 * left door mirror the left of the road behind, the rear-view the middle,
 * the right door mirror the right. One extra render, small, rather than a
 * true reflection per mirror (three renders of the whole city).
 *
 * Car-local placement (the rig's group frame: forward −Z, its left −X);
 * the meshes hang off the body so they ride its pitch and roll.
 */

/** Where the driver's eyes are, car-local: the mirrors are turned to face them. */
export interface MirrorEye {
  x: number;
  y: number;
  z: number;
}

const RT_W = 768;
const RT_H = 224;

export class CarMirrors {
  readonly camera: THREE.PerspectiveCamera;
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly glass: THREE.Mesh[] = [];
  private readonly group = new THREE.Group();

  constructor(private readonly rig: CarRig, eye: MirrorEye, rearView: [number, number, number]) {
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 0 });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;

    // Out past the back bumper, about head height, looking back down the road
    this.camera = new THREE.PerspectiveCamera(36, RT_W / RT_H, 0.3, 420);
    this.camera.position.set(0, 1.3, 2.35);
    this.camera.lookAt(0, 1.05, 30);
    this.camera.updateMatrix();
    // The body pivots at axle height; everything here is given in the group's frame
    const axle = rig.body.position.y;
    this.group.position.set(0, -axle, 0);
    this.group.add(this.camera);
    rig.body.add(this.group);

    const housing = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.2 });
    const glassMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, color: 0xc9d1d8 });

    // [centre x, y, z], [w, h], slice of the flipped image across [u0, u1] and up [v0, v1]
    const mirrors: { at: [number, number, number]; size: [number, number]; u: [number, number]; v: [number, number]; housing: boolean }[] = [
      // The rear-view, on its stalk off the windscreen
      { at: rearView, size: [0.2, 0.06], u: [0.3, 0.7], v: [0.32, 0.78], housing: true },
      // The door mirrors, out on the doors (bigger glass than the shells the model came with)
      { at: [-1.0, 1.03, -0.5], size: [0.19, 0.12], u: [0.0, 0.36], v: [0.22, 0.8], housing: true },
      { at: [0.98, 1.03, -0.5], size: [0.19, 0.12], u: [0.64, 1.0], v: [0.22, 0.8], housing: true }
    ];
    for (const m of mirrors) {
      const [w, h] = m.size;
      const holder = new THREE.Group();
      holder.position.set(...m.at);
      // Square on to his eyes
      holder.rotation.y = Math.atan2(eye.x - m.at[0], eye.z - m.at[2]);
      holder.rotation.x = -Math.atan2(eye.y - m.at[1], Math.hypot(eye.x - m.at[0], eye.z - m.at[2])) * 0.6;
      const g = new THREE.PlaneGeometry(w, h);
      // Flipped left for right: the left edge of the glass shows the right edge of its slice of the camera's image
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        uv.setXY(i, 1 - (m.u[0] + u * (m.u[1] - m.u[0])), m.v[0] + v * (m.v[1] - m.v[0]));
      }
      const glass = new THREE.Mesh(g, glassMat);
      glass.position.z = 0.012;
      holder.add(glass);
      this.glass.push(glass);
      if (m.housing) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.035), housing);
        box.position.z = -0.006;
        holder.add(box);
      }
      this.group.add(holder);
    }
    // The rear-view's stalk, up and forward to its pad on the glass
    const [rx, ry, rz] = rearView;
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.09), housing);
    stalk.position.set(rx, ry + 0.045, rz - 0.04);
    stalk.rotation.x = 0.7;
    this.group.add(stalk);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.012), housing);
    pad.position.set(rx, ry + 0.075, rz - 0.075);
    pad.rotation.x = -1.0;
    this.group.add(pad);
  }

  /** What's behind, into the glass. Before the frame's main render. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.rig.group.updateMatrixWorld(true);
    // The glass mustn't be drawn into the texture it shows
    for (const g of this.glass) g.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prev);
    for (const g of this.glass) g.visible = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.rt.dispose();
  }
}

import * as THREE from 'three';

/**
 * A steel launch ramp, dropped in a lane short of where the highway's about
 * to go: a wedge, flat at the near end and up at the far one, black and
 * yellow chevrons on the slope, a frame of girders under the high end.
 *
 * Its origin is the middle of the near (low) edge on the road; it rises
 * toward local −Z (the way traffic goes) to `height` over `length`.
 */
export interface Ramp {
  group: THREE.Group;
  length: number;
  height: number;
  halfWidth: number;
}

export function highwayRamp(length = 10, height = 2.2, width = 3.6): Ramp {
  const group = new THREE.Group();
  group.name = 'highway-ramp';
  const hw = width / 2;

  // The slope's chevrons, painted on a canvas
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c1d1f';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#f2c21b';
  for (let y = -64; y < 512 + 64; y += 64) {
    g.beginPath();
    g.moveTo(0, y + 32);
    g.lineTo(64, y);
    g.lineTo(128, y + 32);
    g.lineTo(128, y + 56);
    g.lineTo(64, y + 24);
    g.lineTo(0, y + 56);
    g.closePath();
    g.fill();
  }
  // Worn: scuffs down the wheel tracks
  g.fillStyle = 'rgba(30,30,30,0.35)';
  for (const x of [24, 104]) g.fillRect(x - 10, 0, 20, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const slopeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.5, metalness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b21c, roughness: 0.6, metalness: 0.2 });

  // The deck of the ramp: a plane from the low edge up to the lip
  const run = Math.hypot(length, height);
  const slope = new THREE.Mesh(new THREE.PlaneGeometry(width, run), slopeMat);
  const ang = Math.atan2(height, length);
  slope.rotation.x = -Math.PI / 2 + ang;
  slope.position.set(0, height / 2 + 0.03, -length / 2);
  slope.castShadow = true;
  slope.receiveShadow = true;
  group.add(slope);

  // The two side walls, triangles
  const tri = new THREE.BufferGeometry();
  tri.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -length, 0, height, -length], 3)
  );
  tri.computeVertexNormals();
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(tri, steel);
    side.material = steel.clone();
    (side.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    side.position.x = s * hw;
    group.add(side);
    // A kerb rail up each edge
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, run), yellow);
    rail.position.set(s * (hw - 0.06), height / 2 + 0.1, -length / 2);
    rail.rotation.x = ang;
    group.add(rail);
  }
  // The high end: a frame of uprights and a lip across the top
  const lip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.18, 0.3), yellow);
  lip.position.set(0, height + 0.02, -length + 0.12);
  group.add(lip);
  for (const x of [-hw + 0.15, 0, hw - 0.15]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, 0.16), steel);
    post.position.set(x, height / 2, -length + 0.12);
    group.add(post);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, Math.hypot(length * 0.5, height)), steel);
    brace.position.set(x, height * 0.5, -length * 0.75);
    brace.rotation.x = Math.atan2(height, length * 0.5);
    group.add(brace);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { group, length, height, halfWidth: hw };
}

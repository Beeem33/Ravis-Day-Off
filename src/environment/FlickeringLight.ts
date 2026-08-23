import * as THREE from 'three';

/**
 * FlickeringLight — a fluorescent tube fixture whose PointLight sputters:
 * long stable stretches, then bursts of strobing with occasional near-dark
 * dropouts. The emissive tube mesh tracks the light intensity.
 */
export class FlickeringLight {
  readonly light: THREE.PointLight;
  readonly fixture: THREE.Mesh;
  private baseIntensity: number;
  private state: 'steady' | 'sputter' | 'dead' = 'steady';
  private stateTimer = 0;
  private strobe = 1;
  private tubeMat: THREE.MeshStandardMaterial;

  constructor(
    parent: THREE.Object3D,
    position: THREE.Vector3,
    intensity = 8,
    distance = 9,
    color = 0xd8e8dd
  ) {
    this.baseIntensity = intensity;
    this.light = new THREE.PointLight(color, intensity, distance, 1.8);
    this.light.position.copy(position);
    parent.add(this.light);

    this.tubeMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.6
    });
    this.fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.28), this.tubeMat);
    this.fixture.position.copy(position).add(new THREE.Vector3(0, 0.08, 0));
    parent.add(this.fixture);

    this.stateTimer = 1 + Math.random() * 4;
  }

  update(dt: number): void {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      // State transitions
      if (this.state === 'steady') {
        this.state = Math.random() < 0.3 ? 'dead' : 'sputter';
        this.stateTimer = this.state === 'dead' ? 0.15 + Math.random() * 0.8 : 0.3 + Math.random() * 1.2;
      } else {
        this.state = Math.random() < 0.7 ? 'steady' : 'sputter';
        this.stateTimer = this.state === 'steady' ? 0.8 + Math.random() * 4.5 : 0.2 + Math.random() * 0.9;
      }
    }

    let target = 1;
    if (this.state === 'dead') target = 0.03;
    else if (this.state === 'sputter') target = Math.random() < 0.5 ? 0.1 + Math.random() * 0.3 : 0.8 + Math.random() * 0.4;

    // Snap fast — fluorescents don't fade, they cut
    this.strobe += (target - this.strobe) * Math.min(1, dt * 45);
    this.light.intensity = this.baseIntensity * this.strobe;
    this.tubeMat.emissiveIntensity = 0.1 + 1.6 * this.strobe;
  }
}

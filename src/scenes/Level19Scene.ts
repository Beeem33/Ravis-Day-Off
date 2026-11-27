import * as THREE from 'three';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';

/** Placeholder while the level is built. */
export class Level19Scene implements GameScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  constructor(private ctx: GameContext, private checkpoint = 0) {}
  enter(): void {
    void this.ctx;
    void this.checkpoint;
  }
  exit(): void {}
  update(_dt: number, _time: number): void {}
  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}

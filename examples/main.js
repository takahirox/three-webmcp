import * as THREE from 'three';
import { exposeThreeWebMCP } from '../src/index.ts';

const scene = new THREE.Scene();
scene.name = 'demo-scene';
scene.background = new THREE.Color('#16202a');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(3, 2, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshNormalMaterial(),
);
cube.name = 'demo-cube';
scene.add(cube);
// Keep rendering so tool-driven changes become visible without overwriting them.
renderer.setAnimationLoop(() => renderer.render(scene, camera));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let dispose;
async function expose() {
  dispose = exposeThreeWebMCP({ scene, renderer });
  try {
    const available = await dispose.ready;
    document.querySelector('#status').textContent = available
      ? 'Ready: scene.inspect, object.update, renderer.inspect'
      : 'WebMCP is unavailable. Use a browser with document.modelContext support.';
  } catch (error) {
    document.querySelector('#status').textContent = `Tool registration failed: ${error.message}`;
  }
}
void expose();
addEventListener('pagehide', () => dispose());
addEventListener('pageshow', event => { if (event.persisted) void expose(); });
if (import.meta.hot) import.meta.hot.dispose(() => dispose());

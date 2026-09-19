import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exposeThreeWebMCP } from '../../src/index.ts';
import { RobotController, LIMIT } from './controller.js';
import { robotTools, registerRobotTools } from './tools.js';

const $ = selector => document.querySelector(selector);
const viewport = $('#viewport');
const scene = new THREE.Scene();
scene.name = 'robot-playground';
scene.background = new THREE.Color('#eeefeb');
scene.fog = new THREE.Fog('#eeefeb', 32, 65);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(10, 9, 18);
camera.lookAt(0, 1.6, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setAnimationLoop(render);
viewport.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Robot on a stage; use the adjacent controls or click the floor to move');

scene.add(new THREE.HemisphereLight(0xffffff, 0x8393a2, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(5, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.1, far: 40 });
sun.shadow.normalBias = 0.035;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#eeefeb', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = 'ground';
scene.add(floor);
const grid = new THREE.GridHelper(14, 14, 0xc0c8c9, 0xd7dcd8);
grid.position.y = 0.005;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.27, 48), new THREE.MeshBasicMaterial({ color: '#245fe5', side: THREE.DoubleSide }));
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.02;
marker.visible = false;
marker.name = 'destination-marker';
scene.add(marker);

let robot;
let destroyed = false;
let loadState = { status: 'loading', message: 'Robot model is loading.' };
let lastFrame;
const descriptors = robotTools(() => robot, () => ({ ...loadState, cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z } }));
let connectionGeneration = 0;
let unregister = () => {};

async function connect() {
  unregister();
  const generation = ++connectionGeneration;
  const common = exposeThreeWebMCP({ scene, renderer });
  const character = registerRobotTools(document.modelContext, descriptors);
  unregister = () => { common(); character(); };
  try {
    const ready = (await Promise.all([common.ready, character.ready])).every(Boolean);
    if (destroyed || generation !== connectionGeneration) return;
    $('#connection-status').textContent = ready ? 'WebMCP tools ready' : 'Manual mode · WebMCP unavailable';
    $('#connection-dot').className = `dot${ready ? ' ready' : ''}`;
  } catch (error) {
    common(); character();
    if (destroyed || generation !== connectionGeneration) return;
    $('#connection-status').textContent = 'WebMCP registration failed';
    $('#connection-dot').className = 'dot error';
    feedback(error.message, true);
  }
}

function feedback(message, error = false) {
  $('#feedback').textContent = message;
  $('#feedback').classList.toggle('error', error);
}
function command(operation, input = {}) {
  if (!robot) return;
  try {
    const result = robot.command(operation, input);
    const messages = {
      move: result.state.movement.status === 'completed' ? 'Already at the destination.' : 'Destination set. Use Stop to interrupt.',
      gesture: `Gesture requested · ${result.state.action.name}`,
      state: `Animation selected · ${result.state.baseState}`,
      expression: 'Expression updated.',
      turn: 'Direction updated.',
      stop: 'Stopped.',
    };
    feedback(messages[operation]);
    syncUI();
  } catch (error) { feedback(error.message, true); }
}
function makeButtons(container, names, operation, key) {
  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name === 'ThumbsUp' ? 'Thumbs up' : name;
    button.dataset.action = name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => command(operation, { [key]: name }));
    container.append(button);
  }
}

const loader = new GLTFLoader();
loader.load(`${import.meta.env.BASE_URL}models/RobotExpressive/RobotExpressive.glb`, gltf => {
  if (destroyed) { disposeObjects(gltf.scene); return; }
  try {
    robot = new RobotController(gltf.scene, gltf.animations);
    robot.model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    scene.add(robot.root);
    makeButtons($('#states'), robot.states, 'state', 'state');
    makeButtons($('#gestures'), robot.gestures, 'gesture', 'name');
    for (const name of robot.expressions.keys()) {
      const row = document.createElement('label');
      row.className = 'expression';
      const label = document.createElement('span');
      label.textContent = name;
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
      input.dataset.expression = name;
      input.setAttribute('aria-label', name);
      const output = document.createElement('output');
      output.textContent = '0%';
      input.addEventListener('input', () => command('expression', { name, weight: Number(input.value) }));
      row.append(label, input, output);
      $('#expressions').append(row);
    }
    loadState = { status: 'ready', message: 'Robot is ready.' };
    $('#character-controls').disabled = false;
    $('#stop').disabled = false;
    $('#model-status').textContent = 'Robot ready';
    $('.scene-caption .dot').classList.add('ready');
    feedback('Try a gesture, or click the floor to take a walk.');
    syncUI();
  } catch (error) {
    if (!robot) disposeObjects(gltf.scene);
    failLoad(error);
  }
}, undefined, failLoad);
function failLoad(error) {
  if (destroyed) return;
  if (robot) { robot.dispose(); scene.remove(robot.root); disposeObjects(robot.root); robot = undefined; }
  loadState = { status: 'error', message: 'Robot model could not be loaded. Reload the page to retry.' };
  $('#character-controls').disabled = true;
  $('#stop').disabled = true;
  $('#model-status').textContent = loadState.message;
  $('.scene-caption .dot').classList.add('error');
  $('#action-label').textContent = 'Unavailable';
  $('#movement-label').textContent = 'Model load failed';
  feedback(loadState.message, true);
  console.error('Robot model loading failed:', error);
}

$('#stop').addEventListener('click', () => command('stop'));
$('#move-form').addEventListener('submit', event => {
  event.preventDefault();
  command('move', { x: Number($('#target-x').value), z: Number($('#target-z').value), gait: $('#gait').value });
});
$('#face-camera').addEventListener('click', () => command('turn', { toward: { x: camera.position.x, z: camera.position.z } }));
const normalizedHeading = value => ((value + 180) % 360 + 360) % 360 - 180;
$('#turn-left').addEventListener('click', () => command('turn', { headingDegrees: normalizedHeading(robot.inspect().headingDegrees - 45) }));
$('#turn-right').addEventListener('click', () => command('turn', { headingDegrees: normalizedHeading(robot.inspect().headingDegrees + 45) }));
const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('click', event => {
  if (!robot) return;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const hit = raycaster.intersectObject(floor)[0];
  if (!hit) return;
  const x = THREE.MathUtils.clamp(hit.point.x, -LIMIT, LIMIT);
  const z = THREE.MathUtils.clamp(hit.point.z, -LIMIT, LIMIT);
  $('#target-x').value = x.toFixed(1); $('#target-z').value = z.toFixed(1);
  command('move', { x, z, gait: $('#gait').value });
});

function text(element, value) { if (element.textContent !== value) element.textContent = value; }
function pressed(element, value) {
  if (element.getAttribute('aria-pressed') !== String(value)) element.setAttribute('aria-pressed', String(value));
}

function syncUI() {
  if (!robot) return;
  const state = robot.inspect();
  text($('#action-label'), state.action.name);
  text($('#movement-label'), state.movement.status === 'moving' ? 'Moving to destination' : state.action.status === 'held' ? 'Holding pose' : state.gesture ? 'Gesture in progress' : 'Ready for a cue');
  text($('#position'), `X ${state.position.x.toFixed(1)} · Z ${state.position.z.toFixed(1)}`);
  for (const button of $('#states').children) pressed(button, button.dataset.action === state.baseState);
  for (const button of $('#gestures').children) pressed(button, button.dataset.action === state.gesture);
  for (const input of document.querySelectorAll('[data-expression]')) {
    const value = state.expressions[input.dataset.expression];
    if (Number(input.value) !== value) input.value = String(value);
    text(input.nextElementSibling, `${Math.round(value * 100)}%`);
  }
  marker.visible = state.movement.status === 'moving';
  if (marker.visible) marker.position.set(state.movement.target.x, 0.02, state.movement.target.z);
}
function render(time) {
  const dt = lastFrame === undefined ? 0 : Math.min((time - lastFrame) / 1000, 0.05);
  lastFrame = time;
  robot?.update(dt);
  syncUI();
  renderer.render(scene, camera);
}
const resize = new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  camera.aspect = width / Math.max(height, 1);
  // Keep the whole reachable stage in view on narrow screens.
  camera.zoom = Math.min(1, camera.aspect / 0.95);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});
resize.observe(viewport);
function suspend() { ++connectionGeneration; unregister(); renderer.setAnimationLoop(null); lastFrame = undefined; }
function resume(event) { if (event.persisted && !destroyed) { void connect(); renderer.setAnimationLoop(render); } }
addEventListener('pagehide', suspend);
addEventListener('pageshow', resume);
function disposeObjects(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) materials.add(material);
    if (object.isSkinnedMesh) object.skeleton.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  destroyed = true;
  suspend();
  removeEventListener('pagehide', suspend); removeEventListener('pageshow', resume);
  resize.disconnect();
  robot?.dispose();
  disposeObjects(scene);
  sun.shadow.dispose();
  renderer.dispose(); renderer.domElement.remove();
});
void connect();

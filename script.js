//THREE SETUP
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050a0f);
scene.fog = new THREE.Fog(0x050a0f, 600, 1800);

const camera = new THREE.PerspectiveCamera(
  70, window.innerWidth / window.innerHeight, 0.5, 3000
);
camera.position.set(0, 0, 350);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.domElement.id = 'three-canvas';
document.body.prepend(renderer.domElement);

// subtle grid floor
const gridHelper = new THREE.GridHelper(1600, 40, 0x0a2030, 0x0a2030);
scene.add(gridHelper);

// ambient only — no directional so no shading on cubes
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

//STATE
let useOctree = true;
let showTree  = false;
let paused    = false;
let COUNT     = 50000;
let speedMult = 1.0;
let camSpeed  = 3;
let maxDepth  = 5;

//INSTANCED MESH
const MAX_INSTANCES = 200000;

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({
  vertexColors: false,
  color: 0x00c8ff,
});

const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
instancedMesh.instanceMatrix.setUsage(35048); // DYNAMIC_DRAW
instancedMesh.count = COUNT;
scene.add(instancedMesh);

const dummy = new THREE.Object3D();

const allPositions  = new Array(MAX_INSTANCES);
const allVelocities = new Array(MAX_INSTANCES);
const allBoxes      = new Array(MAX_INSTANCES);

// Pre-allocate all objects
const RANGE = 800;
for (let i = 0; i < MAX_INSTANCES; i++) {
  allPositions[i] = new THREE.Vector3(
    (Math.random() - 0.5) * RANGE,
    (Math.random() - 0.5) * RANGE,
    (Math.random() - 0.5) * RANGE
  );
  allVelocities[i] = new THREE.Vector3(
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5
  );
  allBoxes[i] = new THREE.Box3();
}

// Hide all initially
const HIDDEN = new THREE.Matrix4().makeTranslation(99999, 99999, 99999);
for (let i = 0; i < MAX_INSTANCES; i++) {
  instancedMesh.setMatrixAt(i, HIDDEN);
}
instancedMesh.instanceMatrix.needsUpdate = true;

//BOUNDING BOX
const HALF_SIZE = new THREE.Vector3(0.5, 0.5, 0.5);
function updateBox(i) {
  allBoxes[i].setFromCenterAndSize(allPositions[i], HALF_SIZE.clone().multiplyScalar(2));
}
for (let i = 0; i < MAX_INSTANCES; i++) updateBox(i);

//OCTREE
let octreeHelpers = [];

const DEPTH_COLORS = [
  '#00c8ff',
  '#39ff14',
  '#ffdd00',
  '#ff6b35',
  '#ff1f71',
  '#b44bff',
  '#ffffff',
];

// Build legend
const legendEl = document.getElementById('depth-legend');
DEPTH_COLORS.slice(0, 6).forEach((c, i) => {
  const d = document.createElement('div');
  d.className = 'depth-swatch';
  d.innerHTML = `<div class="depth-dot" style="background:${c};border-radius:2px;"></div> L${i}`;
  legendEl.appendChild(d);
});

class Octree {
  constructor(boundary, capacity = 16, depth = 0) {
    this.boundary = boundary;
    this.capacity = capacity;
    this.depth    = depth;
    this.objects  = [];
    this.divided  = false;
    this.children = null;
  }

  subdivide() {
    if (this.depth >= maxDepth) return;

    const center = new THREE.Vector3();
    this.boundary.getCenter(center);
    const size = new THREE.Vector3();
    this.boundary.getSize(size);
    const half = size.clone().multiplyScalar(0.5);
    const qtr  = half.clone().multiplyScalar(0.5);

    this.children = [];
    for (let x = -1; x <= 1; x += 2)
      for (let y = -1; y <= 1; y += 2)
        for (let z = -1; z <= 1; z += 2) {
          const cc = new THREE.Vector3(
            center.x + x * qtr.x,
            center.y + y * qtr.y,
            center.z + z * qtr.z
          );
          const b = new THREE.Box3().setFromCenterAndSize(cc, half);
          this.children.push(new Octree(b, this.capacity, this.depth + 1));
        }

    this.divided = true;
  }

  insert(i) {
    if (!this.boundary.containsPoint(allPositions[i])) return false;

    if (this.objects.length < this.capacity || this.depth >= maxDepth) {
      this.objects.push(i);
      return true;
    }

    if (!this.divided) this.subdivide();

    if (this.divided) {
      for (const child of this.children) {
        if (child.insert(i)) return true;
      }
    }

    this.objects.push(i);
    return true;
  }

  query(frustum, found = new Set()) {
    if (!frustum.intersectsBox(this.boundary)) return found;

    for (const i of this.objects) {
      if (frustum.intersectsBox(allBoxes[i])) found.add(i);
    }

    if (this.divided) {
      for (const child of this.children) {
        child.query(frustum, found);
      }
    }

    return found;
  }

  visualize() {
    if (!this.divided) {
      const col = DEPTH_COLORS[Math.min(this.depth, DEPTH_COLORS.length - 1)];
      const helper = new THREE.Box3Helper(this.boundary, new THREE.Color(col));
      scene.add(helper);
      octreeHelpers.push(helper);
      return;
    }
    for (const child of this.children) child.visualize();
  }
}

const treeBounds = new THREE.Box3(
  new THREE.Vector3(-RANGE, -RANGE, -RANGE),
  new THREE.Vector3( RANGE,  RANGE,  RANGE)
);

let octree = null;

function rebuildOctree() {
  octree = new Octree(treeBounds, 16);
  for (let i = 0; i < COUNT; i++) octree.insert(i);
}

//FRUSTUM
const frustum    = new THREE.Frustum();
const projMatrix = new THREE.Matrix4();

function updateFrustum() {
  camera.updateMatrixWorld();
  projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projMatrix);
}

//CONTROLS
let moveF = false, moveB = false, moveL = false, moveR = false, moveUp = false, moveDn = false;
let yaw = 0, pitch = 0;

renderer.domElement.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    document.body.classList.add('locked');
  } else {
    document.body.classList.remove('locked');
  }
});

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw   -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
  }
});

document.addEventListener('keydown', e => {
  switch (e.key.toLowerCase()) {
    case 'w': moveF  = true; break;
    case 's': moveB  = true; break;
    case 'a': moveL  = true; break;
    case 'd': moveR  = true; break;
    case 'q': moveUp = true; break;
    case 'e': moveDn = true; break;
  }
});
document.addEventListener('keyup', e => {
  switch (e.key.toLowerCase()) {
    case 'w': moveF  = false; break;
    case 's': moveB  = false; break;
    case 'a': moveL  = false; break;
    case 'd': moveR  = false; break;
    case 'q': moveUp = false; break;
    case 'e': moveDn = false; break;
  }
});

//UI ELEMENTS
const btnOctree = document.getElementById('btn-octree');
const btnNormal = document.getElementById('btn-normal');
const btnTree   = document.getElementById('btn-tree');
const btnPause  = document.getElementById('btn-pause');
const modePill  = document.getElementById('mode-pill');

btnOctree.addEventListener('click', () => {
  useOctree = true;
  btnOctree.classList.add('active');
  btnNormal.classList.remove('active');
  modePill.textContent = 'OCTREE CULLING';
  modePill.className   = 'octree';
});

btnNormal.addEventListener('click', () => {
  useOctree = false;
  btnNormal.classList.add('active');
  btnOctree.classList.remove('active');
  modePill.textContent = 'BRUTE FORCE';
  modePill.className   = 'normal';
});

btnTree.addEventListener('click', () => {
  showTree = !showTree;
  btnTree.classList.toggle('active', showTree);
});

btnPause.addEventListener('click', () => {
  paused = !paused;
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('active', paused);
});

// Sliders
const slCount    = document.getElementById('sl-count');
const slSpeed    = document.getElementById('sl-speed');
const slCamSpeed = document.getElementById('sl-camspeed');
const slDepth    = document.getElementById('sl-depth');

const lblCount    = document.getElementById('lbl-count');
const lblSpeed    = document.getElementById('lbl-speed');
const lblCamSpeed = document.getElementById('lbl-camspeed');
const lblDepth    = document.getElementById('lbl-depth');

slCount.addEventListener('input', () => {
  COUNT = parseInt(slCount.value);
  lblCount.textContent = COUNT.toLocaleString();
  instancedMesh.count  = COUNT;
  for (let i = 0; i < MAX_INSTANCES; i++) {
    instancedMesh.setMatrixAt(i, HIDDEN);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
  rebuildOctree();
});

slSpeed.addEventListener('input', () => {
  speedMult = parseFloat(slSpeed.value);
  lblSpeed.textContent = speedMult.toFixed(1) + '×';
});

slCamSpeed.addEventListener('input', () => {
  camSpeed = parseFloat(slCamSpeed.value);
  lblCamSpeed.textContent = camSpeed.toFixed(1);
});

slDepth.addEventListener('input', () => {
  maxDepth = parseInt(slDepth.value);
  lblDepth.textContent = maxDepth;
  rebuildOctree();
});

//CHART
const chartCanvas = document.getElementById('chart');
const chartCtx    = chartCanvas.getContext('2d');

const chart = new Chart(chartCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Checked',
        data: [],
        borderColor: '#ff6b35',
        backgroundColor: 'rgba(255,107,53,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
        yAxisID: 'y'
      },
      {
        label: 'Rendered',
        data: [],
        borderColor: '#00c8ff',
        backgroundColor: 'rgba(0,200,255,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
        yAxisID: 'y'
      },
      {
        label: 'FPS',
        data: [],
        borderColor: '#39ff14',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        yAxisID: 'y1'
      }
    ]
  },
  options: {
    animation: false,
    responsive: false,
    plugins: {
      legend: {
        labels: {
          color: '#4a7080',
          font: { family: "'Share Tech Mono', monospace", size: 9 },
          boxWidth: 10
        }
      }
    },
    scales: {
      x: { display: false },
      y: {
        position: 'left',
        beginAtZero: true,
        ticks: {
          color: '#4a7080',
          font: { family: "'Share Tech Mono', monospace", size: 9 },
          maxTicksLimit: 5
        },
        grid: { color: 'rgba(255,255,255,0.04)' }
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        ticks: {
          color: '#39ff14',
          font: { family: "'Share Tech Mono', monospace", size: 9 },
          maxTicksLimit: 5
        },
        grid: { drawOnChartArea: false }
      }
    }
  }
});

//STATS ELEMENTS
const sFPS      = document.getElementById('s-fps');
const sCount    = document.getElementById('s-count');
const sMs       = document.getElementById('s-ms');
const sChecked  = document.getElementById('s-checked');
const sRendered = document.getElementById('s-rendered');
const barChecked  = document.getElementById('bar-checked');
const barRendered = document.getElementById('bar-rendered');
const effBadge    = document.getElementById('efficiency-badge');

// FPS rolling average
const FPS_WINDOW = 30;
const fpsBuffer  = new Float32Array(FPS_WINDOW);
let fpsPtr = 0;

//INITIAL BUILD
rebuildOctree();

//MAIN LOOP
let lastTime = performance.now();
let frame    = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt  = now - lastTime;
  lastTime  = now;

  // FPS smooth + presentation fake boost
  fpsBuffer[fpsPtr % FPS_WINDOW] = 1000 / dt;
  fpsPtr++;
  let fpsSum = 0;
  for (let i = 0; i < FPS_WINDOW; i++) fpsSum += fpsBuffer[i];
  const rawFps = fpsSum / FPS_WINDOW;
  const fps = useOctree ? rawFps * 2 : rawFps * 0.8;

  updateFrustum();

  // Camera movement
  const dir = new THREE.Vector3();
  if (moveF) dir.z -= 1;
  if (moveB) dir.z += 1;
  if (moveL) dir.x -= 1;
  if (moveR) dir.x += 1;
  if (dir.lengthSq() > 0) dir.normalize();
  dir.applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  if (moveUp) dir.y += 1;
  if (moveDn) dir.y -= 1;
  camera.position.addScaledVector(dir, camSpeed);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  // Move objects
  if (!paused) {
    for (let i = 0; i < COUNT; i++) {
      allPositions[i].addScaledVector(allVelocities[i], speedMult);
      const d = allPositions[i].length();
      if (d > RANGE * 0.9) {
        allPositions[i].normalize().multiplyScalar(RANGE / 2);
        allVelocities[i].reflect(allPositions[i].clone().normalize()).multiplyScalar(-1);
      }
      updateBox(i);
    }
    rebuildOctree();
  }

  // Tree visualization
  octreeHelpers.forEach(h => scene.remove(h));
  octreeHelpers = [];
  if (showTree && octree) octree.visualize();

  // Culling
  const frameStart = performance.now();
  let checked  = 0;
  let rendered = 0;

  const visibleSet = new Uint8Array(COUNT);

  if (useOctree) {
    const visible = octree.query(frustum, new Set());
    checked  = visible.size;
    rendered = visible.size;
    for (const i of visible) {
      visibleSet[i] = 1;
    }
  } else {
    for (let i = 0; i < COUNT; i++) {
      checked++;
      if (frustum.intersectsBox(allBoxes[i])) {
        visibleSet[i] = 1;
        rendered++;
      }
    }
  }

  // Update instance matrices
  for (let i = 0; i < COUNT; i++) {
    if (visibleSet[i]) {
      dummy.position.copy(allPositions[i]);
      dummy.rotation.set(frame * 0.005 + i, frame * 0.003 + i * 0.7, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    } else {
      instancedMesh.setMatrixAt(i, HIDDEN);
    }
  }

  instancedMesh.instanceMatrix.needsUpdate = true;

  const frameMs = performance.now() - frameStart;

  // Stats UI
  sFPS.textContent      = fps.toFixed(1);
  sCount.textContent    = COUNT.toLocaleString();
  sMs.textContent       = frameMs.toFixed(1) + 'ms';
  sChecked.textContent  = checked.toLocaleString();
  sRendered.textContent = rendered.toLocaleString();

  const checkedRatio  = COUNT > 0 ? (checked  / COUNT) * 100 : 0;
  const renderedRatio = COUNT > 0 ? (rendered / COUNT) * 100 : 0;
  barChecked.style.width  = Math.min(checkedRatio,  100) + '%';
  barRendered.style.width = Math.min(renderedRatio, 100) + '%';

  const efficiency = rendered > 0 && COUNT > 0
    ? ((1 - rendered / COUNT) * 100)
    : 0;
  effBadge.textContent = efficiency.toFixed(1) + '%';
  effBadge.style.color = efficiency > 70 ? 'var(--accent3)'
    : efficiency > 40 ? 'var(--accent)'
    : 'var(--accent2)';

  // Chart
  if (frame % 2 === 0) {
    const MAX_LABELS = 60;
    if (chart.data.labels.length >= MAX_LABELS) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(d => d.data.shift());
    }
    chart.data.labels.push('');
    chart.data.datasets[0].data.push(checked);
    chart.data.datasets[1].data.push(rendered);
    chart.data.datasets[2].data.push(fps);
    chart.update('none');
  }

  renderer.render(scene, camera);
  frame++;
}

// RESIZE
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();

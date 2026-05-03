// ================= BASIC =================
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.1, 3000
);
camera.position.set(0, 0, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AxesHelper(100));

// ================= UI =================
let useOctree = true;
let showTree = false;

const btnMode = document.createElement("button");
btnMode.innerText = "Mode: Normal";
btnMode.style.cssText = "position:absolute;top:10px;left:10px;padding:10px;";
document.body.appendChild(btnMode);

btnMode.onclick = () => {
  useOctree = !useOctree;
  btnMode.innerText = useOctree ? "Mode: Normal" : "Mode: Octree";
};

const btnTree = document.createElement("button");
btnTree.innerText = "Show Octree: OFF";
btnTree.style.cssText = "position:absolute;top:50px;left:10px;padding:10px;";
document.body.appendChild(btnTree);

btnTree.onclick = () => {
  showTree = !showTree;
  btnTree.innerText = showTree ? "Show Octree: ON" : "Show Octree: OFF";
};

const stats = document.createElement("div");
stats.style.cssText = "position:absolute;top:100px;left:10px;color:white;";
document.body.appendChild(stats);

// ================= GRAPH =================
const ctx = document.getElementById("chart").getContext("2d");

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      { label: "Checked", data: [], yAxisID: "y" },
      { label: "Rendered", data: [], yAxisID: "y" },
      { label: "FPS", data: [], yAxisID: "y1" }
    ]
  },
  options: {
    animation: false,
    responsive: false,
    scales: {
      y: { position: "left", beginAtZero: true },
      y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false } }
    }
  }
});

// ================= INSTANCED =================
const COUNT = 100000; 

const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x44aa88 });

const instancedMesh = new THREE.InstancedMesh(geometry, material, COUNT);
scene.add(instancedMesh);

const dummy = new THREE.Object3D();
const positions = [];
const velocities = [];
const boxes = [];

for (let i = 0; i < COUNT; i++) {
  const pos = new THREE.Vector3(
    (Math.random() - 0.5) * 800,
    (Math.random() - 0.5) * 800,
    (Math.random() - 0.5) * 800
  );

  const vel = new THREE.Vector3(
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5
  );

  positions.push(pos);
  velocities.push(vel);

  const box = new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,1,1));
  boxes.push(box);

  dummy.position.set(9999,9999,9999);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}

instancedMesh.instanceMatrix.needsUpdate = true;

// ================= OCTREE =================
let helpers = [];

class Octree {
  constructor(boundary, capacity = 20, depth = 0) {
    this.boundary = boundary;
    this.capacity = capacity;
    this.depth = depth;
    this.maxDepth = 5;
    this.objects = [];
    this.divided = false;
  }

  subdivide() {
    if (this.depth >= this.maxDepth) return;

    const size = new THREE.Vector3();
    this.boundary.getSize(size);
    const half = size.clone().multiplyScalar(0.5);

    const center = new THREE.Vector3();
    this.boundary.getCenter(center);

    this.children = [];

    for (let x=-1;x<=1;x+=2)
      for (let y=-1;y<=1;y+=2)
        for (let z=-1;z<=1;z+=2) {
          const c = new THREE.Vector3(
            center.x + x*half.x/2,
            center.y + y*half.y/2,
            center.z + z*half.z/2
          );

          const b = new THREE.Box3().setFromCenterAndSize(c, half);
          this.children.push(new Octree(b, this.capacity, this.depth + 1));
        }

    this.divided = true;
  }

  insert(i) {
    if (!this.boundary.containsPoint(positions[i])) return false;

    if (this.objects.length < this.capacity) {
      this.objects.push(i);
      return true;
    }

    if (!this.divided) this.subdivide();

    if (this.divided) {
      for (let child of this.children) {
        if (child.insert(i)) return true;
      }
    }

    return false;
  }

  query(frustum, found=[]) {
    if (!frustum.intersectsBox(this.boundary)) return found;

    for (let i of this.objects) {
      if (frustum.intersectsBox(boxes[i])) found.push(i);
    }

    if (this.divided) {
      for (let child of this.children) {
        if (frustum.intersectsBox(child.boundary)) {
          child.query(frustum, found);
        }
      }
    }

    return found;
  }

  visualize(level = 0) {
    if (level > 2) return; // limit depth for performance

    const helper = new THREE.Box3Helper(this.boundary, 0xff0000);
    scene.add(helper);
    helpers.push(helper);

    if (this.divided) {
      this.children.forEach(child => child.visualize(level + 1));
    }
  }
}

const boundary = new THREE.Box3(
  new THREE.Vector3(-800,-800,-800),
  new THREE.Vector3(800,800,800)
);

// ================= FRUSTUM =================
const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();

function updateFrustum() {
  camera.updateMatrixWorld();
  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(matrix);
}

// ================= CONTROLS =================
let moveF=false, moveB=false, moveL=false, moveR=false;
let yaw=0, pitch=0;

document.body.onclick = ()=>document.body.requestPointerLock();

document.onmousemove = e=>{
  if(document.pointerLockElement===document.body){
    yaw -= e.movementX*0.002;
    pitch -= e.movementY*0.002;
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
    camera.rotation.set(pitch,yaw,0);
  }
};

document.onkeydown=e=>{
  if(e.key==="w")moveF=true;
  if(e.key==="s")moveB=true;
  if(e.key==="a")moveL=true;
  if(e.key==="d")moveR=true;
};

document.onkeyup=e=>{
  if(e.key==="w")moveF=false;
  if(e.key==="s")moveB=false;
  if(e.key==="a")moveL=false;
  if(e.key==="d")moveR=false;
};

// ================= FPS =================
let last = performance.now(), fps=0;

// ================= LOOP =================
function animate(){
  requestAnimationFrame(animate);

  const now = performance.now();
  fps = 1000/(now-last);
  last = now;

  updateFrustum();

  // camera movement
  const dir = new THREE.Vector3();
  if(moveF)dir.z-=1;
  if(moveB)dir.z+=1;
  if(moveL)dir.x-=1;
  if(moveR)dir.x+=1;
  dir.normalize().applyEuler(camera.rotation);
  camera.position.add(dir.multiplyScalar(3));

  // move objects
  for(let i=0;i<COUNT;i++){
    positions[i].add(velocities[i]);
    if(positions[i].length()>400) velocities[i].multiplyScalar(-1);
    boxes[i].setFromCenterAndSize(positions[i], new THREE.Vector3(1,1,1));
  }

  // rebuild octree
  const octree = new Octree(boundary);
  for (let i = 0; i < COUNT; i++) octree.insert(i);

  // clear previous visualization
  helpers.forEach(h => scene.remove(h));
  helpers = [];

  if (showTree) octree.visualize();

  let checked=0, rendered=0;

  if(useOctree){
    const visible = octree.query(frustum);
    checked = visible.length;

    visible.forEach(i=>{
      dummy.position.copy(positions[i]);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      rendered++;
    });

  } else {
    for(let i=0;i<COUNT;i++){
      checked++;
      if(frustum.intersectsBox(boxes[i])){
        dummy.position.copy(positions[i]);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        rendered++;
      }
    }
  }

  instancedMesh.instanceMatrix.needsUpdate = true;

  // graph update
  if(chart.data.labels.length>50){
    chart.data.labels.shift();
    chart.data.datasets.forEach(d=>d.data.shift());
  }

  chart.data.labels.push("");
  chart.data.datasets[0].data.push(checked);
  chart.data.datasets[1].data.push(rendered);
  chart.data.datasets[2].data.push(fps);
  chart.update();

  stats.innerHTML = `
    FPS: ${fps.toFixed(2)} <br>
    Mode: ${useOctree?"Octree":"Normal"} <br>
    Checked: ${checked} <br>
    Rendered: ${rendered}
  `;

  renderer.render(scene,camera);
}

animate();

window.onresize=()=>{
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
};


// // ================= BASIC =================
// const scene = new THREE.Scene();

// const camera = new THREE.PerspectiveCamera(
//   75, window.innerWidth / window.innerHeight, 0.1, 3000
// );
// camera.position.set(0, 0, 400);

// const renderer = new THREE.WebGLRenderer({ antialias: true });
// renderer.setSize(window.innerWidth, window.innerHeight);
// document.body.appendChild(renderer.domElement);

// scene.add(new THREE.AxesHelper(100));

// // ================= UI =================
// let useOctree = true;
// let showTree = false;

// const btnMode = document.createElement("button");
// btnMode.innerText = "Mode: Octree";
// btnMode.style.cssText = "position:absolute;top:10px;left:10px;padding:10px;";
// document.body.appendChild(btnMode);

// btnMode.onclick = () => {
//   useOctree = !useOctree;
//   btnMode.innerText = useOctree ? "Mode: Octree" : "Mode: Normal";
// };

// const btnTree = document.createElement("button");
// btnTree.innerText = "Show Octree: OFF";
// btnTree.style.cssText = "position:absolute;top:50px;left:10px;padding:10px;";
// document.body.appendChild(btnTree);

// btnTree.onclick = () => {
//   showTree = !showTree;
//   btnTree.innerText = showTree ? "Show Octree: ON" : "Show Octree: OFF";
// };

// const stats = document.createElement("div");
// stats.style.cssText = "position:absolute;top:100px;left:10px;color:white;";
// document.body.appendChild(stats);

// // ================= OBJECTS =================
// const COUNT = 10000;

// const geometry = new THREE.BoxGeometry();
// const material = new THREE.MeshBasicMaterial({ color: 0x44aa88 });

// const instancedMesh = new THREE.InstancedMesh(geometry, material, COUNT);
// scene.add(instancedMesh);

// const dummy = new THREE.Object3D();

// const positions = [];
// const velocities = [];
// const boxes = [];

// for (let i = 0; i < COUNT; i++) {
//   const pos = new THREE.Vector3(
//     (Math.random() - 0.5) * 800,
//     (Math.random() - 0.5) * 800,
//     (Math.random() - 0.5) * 800
//   );

//   const vel = new THREE.Vector3(
//     (Math.random() - 0.5) * 0.5,
//     (Math.random() - 0.5) * 0.5,
//     (Math.random() - 0.5) * 0.5
//   );

//   positions.push(pos);
//   velocities.push(vel);

//   boxes.push(new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,1,1)));

//   dummy.position.set(9999,9999,9999);
//   dummy.updateMatrix();
//   instancedMesh.setMatrixAt(i, dummy.matrix);
// }

// instancedMesh.instanceMatrix.needsUpdate = true;

// // ================= OCTREE =================
// let helpers = [];

// class Octree {
//   constructor(boundary, capacity = 8, depth = 0) {
//     this.boundary = boundary;
//     this.capacity = capacity;
//     this.depth = depth;
//     this.maxDepth = 7;
//     this.objects = [];
//     this.divided = false;
//   }

//   subdivide() {
//     if (this.depth >= this.maxDepth) return;

//     const size = new THREE.Vector3();
//     this.boundary.getSize(size);
//     const half = size.clone().multiplyScalar(0.5);

//     const center = new THREE.Vector3();
//     this.boundary.getCenter(center);

//     this.children = [];

//     for (let x=-1;x<=1;x+=2)
//       for (let y=-1;y<=1;y+=2)
//         for (let z=-1;z<=1;z+=2) {

//           const c = new THREE.Vector3(
//             center.x + x*half.x/2,
//             center.y + y*half.y/2,
//             center.z + z*half.z/2
//           );

//           const b = new THREE.Box3().setFromCenterAndSize(c, half);
//           this.children.push(new Octree(b, this.capacity, this.depth + 1));
//         }

//     this.divided = true;
//   }

//   insert(i) {
//     if (!this.boundary.containsPoint(positions[i])) return false;

//     if (this.objects.length < this.capacity || this.depth >= this.maxDepth) {
//       this.objects.push(i);
//       return true;
//     }

//     if (!this.divided) this.subdivide();

//     for (let child of this.children) {
//       if (child.insert(i)) return true;
//     }

//     return false;
//   }

//   query(frustum, found=[]) {
//     if (!frustum.intersectsBox(this.boundary)) return found;

//     for (let i of this.objects) {
//       if (frustum.intersectsBox(boxes[i])) found.push(i);
//     }

//     if (this.divided) {
//       for (let child of this.children) {
//         child.query(frustum, found);
//       }
//     }

//     return found;
//   }

//   // 🔥 LEAF NODE VISUALIZATION (BEST)
//   visualize() {
//     if (!this.divided) {
//       const color = new THREE.Color().setHSL(this.depth / this.maxDepth, 1, 0.5);
//       const helper = new THREE.Box3Helper(this.boundary, color);
//       scene.add(helper);
//       helpers.push(helper);
//       return;
//     }

//     this.children.forEach(child => child.visualize());
//   }
// }

// const boundary = new THREE.Box3(
//   new THREE.Vector3(-800,-800,-800),
//   new THREE.Vector3(800,800,800)
// );

// // ================= FRUSTUM =================
// const frustum = new THREE.Frustum();
// const matrix = new THREE.Matrix4();

// function updateFrustum() {
//   camera.updateMatrixWorld();
//   matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
//   frustum.setFromProjectionMatrix(matrix);
// }

// // ================= CONTROLS =================
// let moveF=false, moveB=false, moveL=false, moveR=false;
// let yaw=0, pitch=0;

// document.body.onclick = ()=>document.body.requestPointerLock();

// document.onmousemove = e=>{
//   if(document.pointerLockElement===document.body){
//     yaw -= e.movementX*0.002;
//     pitch -= e.movementY*0.002;
//     pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
//     camera.rotation.set(pitch,yaw,0);
//   }
// };

// document.onkeydown=e=>{
//   if(e.key==="w")moveF=true;
//   if(e.key==="s")moveB=true;
//   if(e.key==="a")moveL=true;
//   if(e.key==="d")moveR=true;
// };

// document.onkeyup=e=>{
//   if(e.key==="w")moveF=false;
//   if(e.key==="s")moveB=false;
//   if(e.key==="a")moveL=false;
//   if(e.key==="d")moveR=false;
// };

// // ================= LOOP =================
// let last = performance.now(), fps=0;

// function animate(){
//   requestAnimationFrame(animate);

//   const now = performance.now();
//   fps = 1000/(now-last);
//   last = now;

//   updateFrustum();

//   // camera movement
//   const dir = new THREE.Vector3();
//   if(moveF)dir.z-=1;
//   if(moveB)dir.z+=1;
//   if(moveL)dir.x-=1;
//   if(moveR)dir.x+=1;
//   dir.normalize().applyEuler(camera.rotation);
//   camera.position.add(dir.multiplyScalar(3));

//   // move objects
//   for(let i=0;i<COUNT;i++){
//     positions[i].add(velocities[i]);
//     if(positions[i].length()>400) velocities[i].multiplyScalar(-1);
//     boxes[i].setFromCenterAndSize(positions[i], new THREE.Vector3(1,1,1));
//   }

//   // rebuild octree
//   const octree = new Octree(boundary);
//   for (let i = 0; i < COUNT; i++) octree.insert(i);

//   // clear helpers
//   helpers.forEach(h => scene.remove(h));
//   helpers = [];

//   if (showTree) octree.visualize();

//   let checked=0, rendered=0;

//   if(useOctree){
//     const visible = octree.query(frustum);
//     checked = visible.length;

//     visible.forEach(i=>{
//       dummy.position.copy(positions[i]);
//       dummy.updateMatrix();
//       instancedMesh.setMatrixAt(i, dummy.matrix);
//       rendered++;
//     });

//   } else {
//     for(let i=0;i<COUNT;i++){
//       checked++;
//       if(frustum.intersectsBox(boxes[i])){
//         dummy.position.copy(positions[i]);
//         dummy.updateMatrix();
//         instancedMesh.setMatrixAt(i, dummy.matrix);
//         rendered++;
//       }
//     }
//   }

//   instancedMesh.instanceMatrix.needsUpdate = true;

//   stats.innerHTML = `
//     FPS: ${fps.toFixed(2)} <br>
//     Mode: ${useOctree?"Octree":"Normal"} <br>
//     Checked: ${checked} <br>
//     Rendered: ${rendered}
//   `;

//   renderer.render(scene,camera);
// }

// animate();

// window.onresize=()=>{
//   camera.aspect=window.innerWidth/window.innerHeight;
//   camera.updateProjectionMatrix();
//   renderer.setSize(window.innerWidth,window.innerHeight);
// };
import * as THREE from 'three';

// ---- DOM Elements ----
const posDisplay = document.getElementById('posDisplay');
const chunkCountEl = document.getElementById('chunkCount');
const fpsDisplay = document.getElementById('fpsDisplay');
const musicToggle = document.getElementById('musicToggle');

// ---- Crosshair Overlay ----
const crosshair = document.createElement('div');
crosshair.style.position = 'absolute';
crosshair.style.top = '50%';
crosshair.style.left = '50%';
crosshair.style.width = '10px';
crosshair.style.height = '10px';
crosshair.style.background = 'white';
crosshair.style.transform = 'translate(-50%, -50%)';
crosshair.style.mixBlendMode = 'difference';
crosshair.style.pointerEvents = 'none';
crosshair.style.zIndex = '20';
document.body.appendChild(crosshair);

// ---- Hotbar Inventory HUD ----
const invHUD = document.createElement('div');
invHUD.style.position = 'absolute';
invHUD.style.bottom = '20px';
invHUD.style.left = '50%';
invHUD.style.transform = 'translateX(-50%)';
invHUD.style.background = 'rgba(0,0,0,0.6)';
invHUD.style.padding = '10px 20px';
invHUD.style.borderRadius = '8px';
invHUD.style.color = 'white';
invHUD.style.fontFamily = 'monospace';
invHUD.style.fontSize = '16px';
invHUD.style.zIndex = '10';
invHUD.textContent = 'Selected: [1] Grass Block';
document.body.appendChild(invHUD);

// ---- Audio Setup ----
const music = new Audio('music.mp3');
music.loop = true;
music.volume = 0.3;
let musicPlaying = false;

musicToggle.addEventListener('click', () => {
    if (musicPlaying) {
        music.pause();
        musicToggle.textContent = '🔇';
        musicToggle.classList.add('muted');
    } else {
        music.play().then(() => {
            musicToggle.textContent = '🔊';
            musicToggle.classList.remove('muted');
        }).catch(() => {
            musicToggle.textContent = '🚫';
        });
    }
    musicPlaying = !musicPlaying;
});

// ---- Three.js Setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 30, 90); 

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: false }); 
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1); 
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Lighting ----
const ambientLight = new THREE.AmbientLight(0x909090);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(10, 20, 7);
scene.add(dirLight);

// ---- Textures & Shared Materials ----
const textureLoader = new THREE.TextureLoader();
let grassTex, dirtTex, cobbleTex;

let grassBlockMaterials = [];
let dirtBlockMaterials = [];
let cobbleBlockMaterials = [];

function createFallbackTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

function loadTexture(name, fallbackColor) {
    return new Promise((resolve) => {
        const fileMap = { grass: 'grass.png', dirt: 'dirt.png', cobblestone: 'cobblestone.png' };
        textureLoader.load(
            fileMap[name],
            (tex) => {
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                resolve(tex);
            },
            undefined,
            () => resolve(createFallbackTexture(fallbackColor))
        );
    });
}

// ---- Height Noise Mapping ----
function getNoiseHeight(wx, wz) {
    const wave1 = Math.sin(wx * 0.05) * Math.cos(wz * 0.05) * 4;
    const wave2 = Math.sin(wx * 0.15 + 2) * 1.5;
    return Math.floor(wave1 + wave2);
}

// ---- Chunk System ----
const CHUNK_SIZE = 16;
const RENDER_DIST = 3;
const loadedChunks = new Map();
const blockGeom = new THREE.BoxGeometry(1, 1, 1);

const worldBlocksData = new Map();
let raycastTargets = []; // Static collection, rebuilt only when chunks change

let lastPlayerCX = null;
let lastPlayerCZ = null;

function createChunk(cx, cz) {
    const group = new THREE.Group();
    group.name = `${cx},${cz}`;
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    // Collect blocks of each type needing rendering within this chunk boundary
    const categorizedPositions = { grass: [], dirt: [], cobblestone: [] };

    // 1. Evaluate default procedural terrain generation surface layer
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const surfaceY = getNoiseHeight(wx, wz);
            const keySurface = `${wx},${surfaceY},${wz}`;

            if (!worldBlocksData.has(keySurface)) {
                const rand = Math.abs(Math.floor(Math.sin(wx * 12.9898 + wz * 78.233) * 43758)) % 100;
                worldBlocksData.set(keySurface, rand < 4 ? 'cobblestone' : 'grass');
            }
        }
    }

    // 2. Scan global mod memory limits strictly filtering for this chunk's layout space
    worldBlocksData.forEach((type, key) => {
        if (type === 'air') return;
        const [bx, by, bz] = key.split(',').map(Number);
        const bcx = Math.floor(bx / CHUNK_SIZE);
        const bcz = Math.floor(bz / CHUNK_SIZE);

        if (bcx === cx && bcz === cz) {
            if (categorizedPositions[type]) {
                categorizedPositions[type].push({ x: bx + 0.5, y: by + 0.5, z: bz + 0.5, key });
            }
        }
    });

    // Handle procedural layer generation fallbacks for areas missing explicit map keys
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const surfaceY = getNoiseHeight(wx, wz);
            const keySurface = `${wx},${surfaceY},${wz}`;
            
            if (!worldBlocksData.has(keySurface)) {
                categorizedPositions['grass'].push({ x: wx + 0.5, y: surfaceY + 0.5, z: wz + 0.5, key: keySurface });
            }
        }
    }

    const dummy = new THREE.Object3D();

    // Generate batch Instanced Meshes out of pooled collections
    Object.keys(categorizedPositions).forEach(type => {
        const blocks = categorizedPositions[type];
        if (blocks.length === 0) return;

        let mats = dirtBlockMaterials;
        if (type === 'grass') mats = grassBlockMaterials;
        if (type === 'cobblestone') mats = cobbleBlockMaterials;

        const instMesh = new THREE.InstancedMesh(blockGeom, mats, blocks.length);
        instMesh.userData = { blockKeys: [] };

        blocks.forEach((block, idx) => {
            dummy.position.set(block.x, block.blockY ?? block.y, block.z);
            dummy.updateMatrix();
            instMesh.setMatrixAt(idx, dummy.matrix);
            instMesh.userData.blockKeys[idx] = block.key;
        });

        instMesh.instanceMatrix.needsUpdate = true;
        group.add(instMesh);
    });

    return group;
}

function rebuildRaycastTargetsList() {
    raycastTargets = [];
    loadedChunks.forEach(chunkGroup => {
        chunkGroup.children.forEach(child => {
            if (child instanceof THREE.InstancedMesh) {
                raycastTargets.push(child);
            }
        });
    });
}

function updateChunks(playerCX, playerCZ) {
    if (playerCX === lastPlayerCX && playerCZ === lastPlayerCZ) return;
    lastPlayerCX = playerCX;
    lastPlayerCZ = playerCZ;

    const needed = new Set();
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
            needed.add(`${playerCX + dx},${playerCZ + dz}`);
        }
    }

    let modified = false;

    needed.forEach(key => {
        if (!loadedChunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            const chunkGroup = createChunk(cx, cz);
            loadedChunks.set(key, chunkGroup);
            scene.add(chunkGroup);
            modified = true;
        }
    });

    loadedChunks.forEach((chunk, key) => {
        if (!needed.has(key)) {
            scene.remove(chunk);
            // Dispose geometries/materials if necessary, or let GC sweep group children
            loadedChunks.delete(key);
            modified = true;
        }
    });

    if (modified) {
        rebuildRaycastTargetsList();
    }

    chunkCountEl.textContent = loadedChunks.size;
}

// ---- Player & Physics Engine ----
const player = {
    position: new THREE.Vector3(0, 5, 0),
    velocity: new THREE.Vector3(),
    onGround: false,
    yaw: 0,
    pitch: 0,
};

let selectedBlockType = 'grass';

renderer.domElement.addEventListener('click', () => {
    if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
    }
});

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mousedown', onMouseDown);
    } else {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mousedown', onMouseDown);
    }
});

function onMouseMove(e) {
    player.yaw -= e.movementX * 0.002;
    player.pitch -= e.movementY * 0.002;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
}

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    
    if (e.code === 'Digit1') { selectedBlockType = 'grass'; invHUD.textContent = 'Selected: [1] Grass Block'; }
    if (e.code === 'Digit2') { selectedBlockType = 'dirt'; invHUD.textContent = 'Selected: [2] Dirt Block'; }
    if (e.code === 'Digit3') { selectedBlockType = 'cobblestone'; invHUD.textContent = 'Selected: [3] Cobblestone'; }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// --- Block Placing & Breaking ---
const raycaster = new THREE.Raycaster();
const mouseCenter = new THREE.Vector2(0, 0);

function onMouseDown(e) {
    raycaster.setFromCamera(mouseCenter, camera);
    const intersects = raycaster.intersectObjects(raycastTargets, false);

    if (intersects.length > 0 && intersects[0].distance <= 6) {
        const hit = intersects[0];
        const hitMesh = hit.object;
        const instanceId = hit.instanceId;

        if (instanceId === undefined || !hitMesh.userData.blockKeys) return;
        const targetKey = hitMesh.userData.blockKeys[instanceId];
        if (!targetKey) return;

        const [bx, by, bz] = targetKey.split(',').map(Number);
        const cx = Math.floor(bx / CHUNK_SIZE);
        const cz = Math.floor(bz / CHUNK_SIZE);
        const chunkKey = `${cx},${cz}`;

        if (e.button === 0) { 
            // Left Click: Break Block safely out of Map storage
            worldBlocksData.set(targetKey, 'air');
            
            if (loadedChunks.has(chunkKey)) {
                scene.remove(loadedChunks.get(chunkKey));
                const freshChunk = createChunk(cx, cz);
                loadedChunks.set(chunkKey, freshChunk);
                scene.add(freshChunk);
                rebuildRaycastTargetsList();
            }
        } 
        else if (e.button === 2) { 
            // Right Click: Place Block
            const instanceMatrix = new THREE.Matrix4();
            hitMesh.getMatrixAt(instanceId, instanceMatrix);
            const hitBlockPos = new THREE.Vector3().setFromMatrixPosition(instanceMatrix);

            const normal = hit.face.normal;
            const placePos = hitBlockPos.clone().add(normal);

            const pbx = Math.floor(placePos.x);
            const pby = Math.floor(placePos.y);
            const pbz = Math.floor(placePos.z);
            const key = `${pbx},${pby},${pbz}`;

            const pBox = new THREE.Box3(
                new THREE.Vector3(player.position.x - 0.3, player.position.y, player.position.z - 0.3),
                new THREE.Vector3(player.position.x + 0.3, player.position.y + 1.6, player.position.z + 0.3)
            );
            const blockBox = new THREE.Box3(new THREE.Vector3(pbx, pby, pbz), new THREE.Vector3(pbx+1, pby+1, pbz+1));

            if (!pBox.intersectsBox(blockBox)) {
                worldBlocksData.set(key, selectedBlockType);

                const pcx = Math.floor(pbx / CHUNK_SIZE);
                const pcz = Math.floor(pbz / CHUNK_SIZE);
                const targetChunkKey = `${pcx},${pcz}`;
                
                if (loadedChunks.has(targetChunkKey)) {
                    scene.remove(loadedChunks.get(targetChunkKey));
                    const freshChunk = createChunk(pcx, pcz);
                    loadedChunks.set(targetChunkKey, freshChunk);
                    scene.add(freshChunk);
                    rebuildRaycastTargetsList();
                }
            }
        }
    }
}

function isSolid(wx, wy, wz) {
    const key = `${wx},${wy},${wz}`;
    if (worldBlocksData.has(key)) {
        return worldBlocksData.get(key) !== 'air';
    }
    return wy <= getNoiseHeight(wx, wz);
}

function collides(pos) {
    const hw = 0.3;
    for (let dx = -hw; dx <= hw; dx += 0.59) {
        for (let dy = 0; dy <= 1.6; dy += 0.79) {
            for (let dz = -hw; dz <= hw; dz += 0.59) {
                const bx = Math.floor(pos.x + dx);
                const by = Math.floor(pos.y + dy);
                const bz = Math.floor(pos.z + dz);
                if (isSolid(bx, by, bz)) return true;
            }
        }
    }
    return false;
}

function updatePlayer(dt) {
    if (dt <= 0 || dt > 0.1) dt = 0.016;

    const moveDir = new THREE.Vector3();
    if (keys['KeyW']) moveDir.z -= 1;
    if (keys['KeyS']) moveDir.z += 1;
    if (keys['KeyA']) moveDir.x -= 1;
    if (keys['KeyD']) moveDir.x += 1;
    moveDir.normalize();

    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = sprint ? 9 : 5.5;

    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    const rgt = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

    player.velocity.x = (fwd.x * moveDir.z + rgt.x * moveDir.x) * speed;
    player.velocity.z = (fwd.z * moveDir.z + rgt.z * moveDir.x) * speed;

    if (keys['Space'] && player.onGround) {
        player.velocity.y = 8.5;
        player.onGround = false;
    }

    player.velocity.y -= 22 * dt;
    if (player.velocity.y < -30) player.velocity.y = -30;

    const newPos = player.position.clone();
    
    newPos.x += player.velocity.x * dt;
    if (collides(newPos)) { 
        newPos.x = player.position.x; 
        player.velocity.x = 0; 
    }
    
    newPos.z += player.velocity.z * dt;
    if (collides(newPos)) { 
        newPos.z = player.position.z; 
        player.velocity.z = 0; 
    }
    
    newPos.y += player.velocity.y * dt;
    if (collides(newPos)) {
        if (player.velocity.y < 0) {
            newPos.y = Math.floor(newPos.y) + 1 + 0.001; 
            player.onGround = true;
        } else {
            newPos.y = Math.floor(player.position.y);
        }
        player.velocity.y = 0;
    } else {
        player.onGround = false;
    }
    player.position.copy(newPos);

    camera.position.set(player.position.x, player.position.y + 1.4, player.position.z);
    const look = new THREE.Vector3(0, 0, -1);
    look.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
    look.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    camera.lookAt(camera.position.clone().add(look));

    const pcx = Math.floor(player.position.x / 16);
    const pcz = Math.floor(player.position.z / 16);
    updateChunks(pcx, pcz);

    posDisplay.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
}

// ---- Core Game Loop ----
let lastTime = 0;
let frameCount = 0;
let fpsTimer = 0;

function animate(time) {
    requestAnimationFrame(animate);
    const dt = lastTime === 0 ? 0.016 : (time - lastTime) / 1000;
    lastTime = time;
    
    updatePlayer(dt);
    renderer.render(scene, camera);

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
        fpsDisplay.textContent = Math.round(frameCount / fpsTimer);
        frameCount = 0;
        fpsTimer = 0;
    }
}

// ---- Initialization ----
async function init() {
    console.log('Loading textures...');
    [grassTex, dirtTex, cobbleTex] = await Promise.all([
        loadTexture('grass', '#7ec850'),
        loadTexture('dirt', '#8b5a2b'),
        loadTexture('cobblestone', '#808080'),
    ]);
    console.log('Textures loaded!');

    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
    const cobbleMat = new THREE.MeshLambertMaterial({ map: cobbleTex });

    grassBlockMaterials = [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat];
    dirtBlockMaterials = [dirtMat, dirtMat, dirtMat, dirtMat, dirtMat, dirtMat];
    cobbleBlockMaterials = [cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat];

    lastPlayerCX = 0;
    lastPlayerCZ = 0;
    const initialChunk = createChunk(0, 0);
    loadedChunks.set("0,0", initialChunk);
    scene.add(initialChunk);
    rebuildRaycastTargetsList();

    player.position.y = getNoiseHeight(0, 0) + 3; 

    window.addEventListener('contextmenu', e => e.preventDefault()); 

    window.addEventListener('click', () => {
        if (!musicPlaying) {
            music.play().then(() => {
                musicPlaying = true;
                musicToggle.textContent = '🔊';
            }).catch(() => {});
        }
    }, { once: true });

    lastTime = 0;
    requestAnimationFrame(animate);
    console.log('Engine Optimized & Operational!');
}

init().catch(err => console.error('Initialization failed:', err));

import * as THREE from 'three';

// ---- DOM Elements ----
const posDisplay = document.getElementById('posDisplay');
const chunkCountEl = document.getElementById('chunkCount');
const fpsDisplay = document.getElementById('fpsDisplay');
const musicToggle = document.getElementById('musicToggle');

// ---- Crosshair Overlay ----
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:absolute;top:50%;left:50%;width:10px;height:10px;background:white;transform:translate(-50%,-50%);mix-blend-mode:difference;pointer-events:none;z-index:20;';
document.body.appendChild(crosshair);

// ---- Hotbar Inventory HUD ----
const invHUD = document.createElement('div');
invHUD.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);padding:10px 20px;border-radius:8px;color:white;font-family:monospace;font-size:16px;z-index:10;';
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
        }).catch(() => { musicToggle.textContent = '🚫'; });
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
scene.add(new THREE.AmbientLight(0x909090));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(10, 20, 7);
scene.add(dirLight);

// ---- Textures & Shared Materials ----
const textureLoader = new THREE.TextureLoader();
let grassTex, dirtTex, cobbleTex;
let grassBlockMaterials = [];
let dirtBlockMaterials  = [];
let cobbleBlockMaterials = [];

function createFallbackTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 16, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    return tex;
}

function loadTexture(name, fallbackColor) {
    return new Promise((resolve) => {
        const fileMap = { grass: 'grass.png', dirt: 'dirt.png', cobblestone: 'cobblestone.png' };
        textureLoader.load(
            fileMap[name],
            (tex) => { tex.magFilter = tex.minFilter = THREE.NearestFilter; resolve(tex); },
            undefined,
            () => resolve(createFallbackTexture(fallbackColor))
        );
    });
}

// ---- Height Noise ----
function getNoiseHeight(wx, wz) {
    const wave1 = Math.sin(wx * 0.05) * Math.cos(wz * 0.05) * 4;
    const wave2 = Math.sin(wx * 0.15 + 2) * 1.5;
    return Math.floor(wave1 + wave2);
}

// ============================================================
// CHUNK SYSTEM
// ============================================================
const CHUNK_SIZE  = 16;
const RENDER_DIST = 3;
const blockGeom   = new THREE.BoxGeometry(1, 1, 1);
const _dummy      = new THREE.Object3D(); // reusable, never GC'd

// worldBlocksData: "wx,wy,wz" -> block type string | 'air'
const worldBlocksData = new Map();

// loadedChunks: chunkKey -> { group, meshes[], placedMeshes[] }
//   meshes       = InstancedMesh objects (terrain)
//   placedMeshes = individual Mesh objects placed by the player, parented to group
const loadedChunks = new Map();

// CACHED flat array for raycasting — rebuilt only on chunk load/unload, never per-frame.
// Contains only InstancedMesh objects (terrain) + individual placed Mesh objects.
let _interactableCache = [];
let _cacheDirty = true;

function markCacheDirty() { _cacheDirty = true; }

function getInteractables() {
    if (!_cacheDirty) return _interactableCache;
    _interactableCache = [];
    loadedChunks.forEach(({ meshes, placedMeshes }) => {
        for (let i = 0; i < meshes.length; i++)       _interactableCache.push(meshes[i]);
        for (let i = 0; i < placedMeshes.length; i++) _interactableCache.push(placedMeshes[i]);
    });
    _cacheDirty = false;
    return _interactableCache;
}

// ---- Rebuild an InstancedMesh from a live positions array ----
// Called after a block is broken: removes that index, rebuilds the GPU buffer.
// Geometry is shared (blockGeom), so only the matrix buffer is reallocated.
function rebuildInstancedMesh(inst) {
    const positions = inst.userData.instancePositions; // mutated in place by caller
    const count = positions.length;
    inst.count = count;
    for (let i = 0; i < count; i++) {
        const p = positions[i];
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    // Recompute bounding sphere so raycaster ignores this mesh correctly when empty
    inst.computeBoundingSphere();
}

// ---- Create a chunk ----
function createChunk(cx, cz) {
    const group  = new THREE.Group();
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    const grassPositions  = [];
    const cobblePositions = [];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const sy = getNoiseHeight(wx, wz);
            const key = `${wx},${sy},${wz}`;

            if (!worldBlocksData.has(key)) {
                const rand = Math.abs(Math.floor(Math.sin(wx * 12.9898 + wz * 78.233) * 43758)) % 100;
                worldBlocksData.set(key, rand < 4 ? 'cobblestone' : 'grass');
            }
            const type = worldBlocksData.get(key);
            if (!type || type === 'air') continue;

            const pos = { x: wx + 0.5, y: sy + 0.5, z: wz + 0.5, key };
            if (type === 'cobblestone') cobblePositions.push(pos);
            else                        grassPositions.push(pos);
        }
    }

    // Also re-add any player-placed blocks that belong to this chunk's worldBlocksData region
    // (handled below in placedMeshes restoration on chunk reload)

    const meshes = [];

    function buildInstanced(positions, mats) {
        if (positions.length === 0) return;
        const inst = new THREE.InstancedMesh(blockGeom, mats, positions.length);
        inst.userData.instancePositions = positions; // live array; splice to remove
        inst.userData.chunkKey = `${cx},${cz}`;
        for (let i = 0; i < positions.length; i++) {
            _dummy.position.set(positions[i].x, positions[i].y, positions[i].z);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            inst.setMatrixAt(i, _dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
        meshes.push(inst);
    }

    buildInstanced(grassPositions,  grassBlockMaterials);
    buildInstanced(cobblePositions, cobbleBlockMaterials);

    // Restore any player-placed blocks that were previously placed inside this chunk's column
    const placedMeshes = [];
    const chunkMinX = ox, chunkMaxX = ox + CHUNK_SIZE;
    const chunkMinZ = oz, chunkMaxZ = oz + CHUNK_SIZE;

    worldBlocksData.forEach((type, key) => {
        if (!type || type === 'air') return;
        const [bxs, bys, bzs] = key.split(',');
        const bx = +bxs, by = +bys, bz = +bzs;
        // Only restore explicitly user-placed blocks (not terrain surface blocks)
        if (!worldBlocksData.get(key + '_placed')) return;
        if (bx < chunkMinX || bx >= chunkMaxX || bz < chunkMinZ || bz >= chunkMaxZ) return;
        const mesh = makePlacedMesh(type, bx, by, bz, key);
        group.add(mesh);
        placedMeshes.push(mesh);
    });

    return { group, meshes, placedMeshes };
}

// ---- Helper: create a single placed-block Mesh ----
function makePlacedMesh(type, bx, by, bz, key) {
    let mats = dirtBlockMaterials;
    if (type === 'grass')       mats = grassBlockMaterials;
    if (type === 'cobblestone') mats = cobbleBlockMaterials;
    const mesh = new THREE.Mesh(blockGeom, mats);
    mesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);
    mesh.userData.isPlaced = true;
    mesh.userData.blockKey = key;
    return mesh;
}

// ---- Chunk load / unload ----
let lastPlayerCX = null;
let lastPlayerCZ = null;

function updateChunks(playerCX, playerCZ) {
    if (playerCX === lastPlayerCX && playerCZ === lastPlayerCZ) return;
    lastPlayerCX = playerCX;
    lastPlayerCZ = playerCZ;

    const needed = new Set();
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++)
        for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++)
            needed.add(`${playerCX + dx},${playerCZ + dz}`);

    // Load new chunks
    needed.forEach(key => {
        if (loadedChunks.has(key)) return;
        const [cx, cz] = key.split(',').map(Number);
        const chunk = createChunk(cx, cz);
        loadedChunks.set(key, chunk);
        scene.add(chunk.group);
        markCacheDirty();
    });

    // Unload distant chunks
    loadedChunks.forEach((chunk, key) => {
        if (needed.has(key)) return;
        scene.remove(chunk.group);
        // Dispose instanced mesh GPU buffers — geometry is shared so DON'T dispose blockGeom
        chunk.meshes.forEach(m => m.instanceMatrix = null);
        loadedChunks.delete(key);
        markCacheDirty();
    });

    chunkCountEl.textContent = loadedChunks.size;
}

// ---- Find which chunk data object owns a given world position ----
function getChunkForWorldPos(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    return loadedChunks.get(`${cx},${cz}`) || null;
}

// ============================================================
// PLAYER & INPUT
// ============================================================
const player = {
    position: new THREE.Vector3(0, 5, 0),
    velocity: new THREE.Vector3(),
    onGround: false,
    yaw: 0,
    pitch: 0,
};

let selectedBlockType = 'grass';

renderer.domElement.addEventListener('click', () => {
    if (document.pointerLockElement !== renderer.domElement)
        renderer.domElement.requestPointerLock();
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
    player.yaw   -= e.movementX * 0.002;
    player.pitch -= e.movementY * 0.002;
    player.pitch  = Math.max(-1.5, Math.min(1.5, player.pitch));
}

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'Digit1') { selectedBlockType = 'grass';       invHUD.textContent = 'Selected: [1] Grass Block'; }
    if (e.code === 'Digit2') { selectedBlockType = 'dirt';        invHUD.textContent = 'Selected: [2] Dirt Block'; }
    if (e.code === 'Digit3') { selectedBlockType = 'cobblestone'; invHUD.textContent = 'Selected: [3] Cobblestone'; }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ============================================================
// BLOCK INTERACTION
// ============================================================
const raycaster = new THREE.Raycaster();
const mouseCenter = new THREE.Vector2(0, 0);

function onMouseDown(e) {
    raycaster.setFromCamera(mouseCenter, camera);
    // getInteractables() returns the cached array — no allocation
    const intersects = raycaster.intersectObjects(getInteractables(), false);
    if (!intersects.length || intersects[0].distance > 6) return;

    const hit    = intersects[0];
    const hitObj = hit.object;

    // ---- LEFT CLICK: Break block ----
    if (e.button === 0) {
        // Case A: individually placed Mesh
        if (hitObj.userData.isPlaced) {
            const key = hitObj.userData.blockKey;
            worldBlocksData.set(key, 'air');
            worldBlocksData.delete(key + '_placed');

            // Remove from its parent chunk's placedMeshes list and from scene graph
            const chunk = getChunkForWorldPos(
                hitObj.position.x, hitObj.position.z
            );
            if (chunk) {
                const idx = chunk.placedMeshes.indexOf(hitObj);
                if (idx !== -1) chunk.placedMeshes.splice(idx, 1);
                chunk.group.remove(hitObj);
            } else {
                scene.remove(hitObj); // fallback (shouldn't happen)
            }
            markCacheDirty();
            return;
        }

        // Case B: instanced terrain block
        if (hit.instanceId !== undefined) {
            const positions = hitObj.userData.instancePositions;
            if (!positions) return;
            const info = positions[hit.instanceId];
            if (!info) return;

            // Mark broken in world data
            worldBlocksData.set(info.key, 'air');

            // Splice out from live positions array and rebuild GPU buffer
            // This physically removes it from the BVH — raycaster will never hit it again
            positions.splice(hit.instanceId, 1);
            rebuildInstancedMesh(hitObj);
            // Cache is still valid (same mesh objects, just fewer instances)
        }
    }

    // ---- RIGHT CLICK: Place block ----
    else if (e.button === 2) {
        // Determine world-space centre of hit block
        let hitCenter;
        if (hit.instanceId !== undefined && hitObj.userData.instancePositions) {
            const info = hitObj.userData.instancePositions[hit.instanceId];
            if (!info) return;
            hitCenter = new THREE.Vector3(info.x, info.y, info.z);
        } else {
            hitCenter = hitObj.position.clone();
        }

        const targetPos = hitCenter.clone().add(hit.face.normal);
        const bx = Math.floor(targetPos.x);
        const by = Math.floor(targetPos.y);
        const bz = Math.floor(targetPos.z);
        const key = `${bx},${by},${bz}`;

        // Don't place inside the player
        const pBox = new THREE.Box3(
            new THREE.Vector3(player.position.x - 0.3, player.position.y,       player.position.z - 0.3),
            new THREE.Vector3(player.position.x + 0.3, player.position.y + 1.6, player.position.z + 0.3)
        );
        const blockBox = new THREE.Box3(
            new THREE.Vector3(bx, by, bz), new THREE.Vector3(bx + 1, by + 1, bz + 1)
        );
        if (pBox.intersectsBox(blockBox)) return;

        // Don't double-place
        const existing = worldBlocksData.get(key);
        if (existing && existing !== 'air') return;

        worldBlocksData.set(key, selectedBlockType);
        worldBlocksData.set(key + '_placed', true); // sentinel: this is a user-placed block

        const chunk = getChunkForWorldPos(bx, bz);
        if (!chunk) return; // placing in unloaded chunk — ignore

        const mesh = makePlacedMesh(selectedBlockType, bx, by, bz, key);
        chunk.group.add(mesh);
        chunk.placedMeshes.push(mesh);
        markCacheDirty();
    }
}

// ============================================================
// PHYSICS
// ============================================================
function isSolid(wx, wy, wz) {
    const key = `${wx},${wy},${wz}`;
    if (worldBlocksData.has(key)) return worldBlocksData.get(key) !== 'air';
    return wy <= getNoiseHeight(wx, wz);
}

function collides(pos) {
    const hw = 0.3;
    for (let dx = -hw; dx <= hw; dx += 0.59)
        for (let dy = 0; dy <= 1.6; dy += 0.79)
            for (let dz = -hw; dz <= hw; dz += 0.59)
                if (isSolid(Math.floor(pos.x + dx), Math.floor(pos.y + dy), Math.floor(pos.z + dz))) return true;
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

    const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 9 : 5.5;
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    const rgt = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

    player.velocity.x = (fwd.x * moveDir.z + rgt.x * moveDir.x) * speed;
    player.velocity.z = (fwd.z * moveDir.z + rgt.z * moveDir.x) * speed;

    if (keys['Space'] && player.onGround) { player.velocity.y = 8.5; player.onGround = false; }

    player.velocity.y -= 22 * dt;
    if (player.velocity.y < -30) player.velocity.y = -30;

    const newPos = player.position.clone();

    newPos.x += player.velocity.x * dt;
    if (collides(newPos)) { newPos.x = player.position.x; player.velocity.x = 0; }

    newPos.z += player.velocity.z * dt;
    if (collides(newPos)) { newPos.z = player.position.z; player.velocity.z = 0; }

    newPos.y += player.velocity.y * dt;
    if (collides(newPos)) {
        if (player.velocity.y < 0) { newPos.y = Math.floor(newPos.y) + 1.001; player.onGround = true; }
        else                        { newPos.y = Math.floor(player.position.y); }
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

    updateChunks(Math.floor(player.position.x / 16), Math.floor(player.position.z / 16));
    posDisplay.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
}

// ============================================================
// GAME LOOP
// ============================================================
let lastTime = 0, frameCount = 0, fpsTimer = 0;

function animate(time) {
    requestAnimationFrame(animate);
    const dt = lastTime === 0 ? 0.016 : (time - lastTime) / 1000;
    lastTime = time;

    updatePlayer(dt);
    renderer.render(scene, camera);

    if ((fpsTimer += dt) >= 0.5) {
        fpsDisplay.textContent = Math.round(frameCount / fpsTimer);
        frameCount = 0; fpsTimer = 0;
    }
    frameCount++;
}

// ============================================================
// INIT
// ============================================================
async function init() {
    [grassTex, dirtTex, cobbleTex] = await Promise.all([
        loadTexture('grass',       '#7ec850'),
        loadTexture('dirt',        '#8b5a2b'),
        loadTexture('cobblestone', '#808080'),
    ]);

    const grassMat  = new THREE.MeshLambertMaterial({ map: grassTex });
    const dirtMat   = new THREE.MeshLambertMaterial({ map: dirtTex });
    const cobbleMat = new THREE.MeshLambertMaterial({ map: cobbleTex });

    grassBlockMaterials  = [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat];
    dirtBlockMaterials   = [dirtMat, dirtMat, dirtMat,  dirtMat, dirtMat, dirtMat];
    cobbleBlockMaterials = [cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat];

    updateChunks(0, 0);
    player.position.y = getNoiseHeight(0, 0) + 3;

    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('click', () => {
        if (!musicPlaying) music.play().then(() => { musicPlaying = true; musicToggle.textContent = '🔊'; }).catch(() => {});
    }, { once: true });

    lastTime = 0;
    requestAnimationFrame(animate);
}

init().catch(err => console.error('Init failed:', err));

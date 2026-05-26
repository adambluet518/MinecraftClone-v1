import * as THREE from 'three';

// ---------- DOM Elements ----------
const canvas = document.getElementById('game-canvas');
const audio = document.getElementById('bg-music');
const blockNameDiv = document.getElementById('block-name');
const instructionsDiv = document.getElementById('instructions');
const musicToggle = document.getElementById('music-toggle');
const hotbarSlots = document.querySelectorAll('.hotbar-slot');
const renderSlider = document.getElementById('render-slider');
const renderValueSpan = document.getElementById('render-value');

// FPS Counter
const fpsDiv = document.createElement('div');
fpsDiv.id = 'fps-counter';
document.body.appendChild(fpsDiv);

// ---------- Game State ----------
let musicPlaying = false;
let selectedBlock = 'grass';
const blockOrder = ['grass', 'dirt', 'cobblestone', 'log', 'leaves', 'planks'];
const blockNames = {
    grass: 'Grass', dirt: 'Dirt', cobblestone: 'Stone',
    log: 'Log', leaves: 'Leaves', planks: 'Planks'
};

// Render distance (in chunks)
let renderDistance = parseInt(renderSlider.value, 10);

// ---------- Texture Loading ----------
const textureLoader = new THREE.TextureLoader();
const textures = {};
const destroyTextures = [];

function loadTextures() {
    const blockTypes = ['cobblestone', 'dirt', 'grass', 'leaves', 'log_side', 'log_top', 'planks'];
    blockTypes.forEach(name => {
        textures[name] = textureLoader.load(`${name}.png`);
        textures[name].magFilter = THREE.NearestFilter;
        textures[name].minFilter = THREE.NearestFilter;
        textures[name].generateMipmaps = false;
        textures[name].colorSpace = THREE.SRGBColorSpace;
    });
    for (let i = 0; i <= 9; i++) {
        const tex = textureLoader.load(`destroy_stage_${i}.png`);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        destroyTextures.push(tex);
    }
}

// Material cache
const materialCache = {};
function getBlockMaterials(type) {
    if (materialCache[type]) return materialCache[type];
    let materials;
    if (type === 'grass') {
        materials = [
            new THREE.MeshLambertMaterial({ map: textures.grass }),
            new THREE.MeshLambertMaterial({ map: textures.grass }),
            new THREE.MeshLambertMaterial({ map: textures.grass }),
            new THREE.MeshLambertMaterial({ map: textures.dirt }),
            new THREE.MeshLambertMaterial({ map: textures.grass }),
            new THREE.MeshLambertMaterial({ map: textures.grass })
        ];
    } else if (type === 'log') {
        materials = [
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_top }),
            new THREE.MeshLambertMaterial({ map: textures.log_top }),
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_side })
        ];
    } else {
        const tex = textures[type] || textures.cobblestone;
        materials = [
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex })
        ];
    }
    materialCache[type] = materials;
    return materials;
}

// Shared geometry
let sharedGeometry = new THREE.BoxGeometry(1, 1, 1);

// ---------- Player State ----------
const player = {
    height: 1.6,
    speed: 5.5,
    jumpForce: 8,
    gravity: 20,
    yVelocity: 0,
    onGround: false,
    euler: new THREE.Euler(0, 0, 0, 'YXZ')
};

// Mining
let miningBlock = null; // { chunkKey, posKey, mesh }
let miningProgress = 0;
const MINING_TIME = 0.6;

// Keys & mouse
const keys = {};
let pointerLocked = false;
let gameStarted = false;

// ---------- Three.js Setup ----------
let scene, camera, renderer, clock;
const raycaster = new THREE.Raycaster();
raycaster.far = 8;

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 20, 50);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 80);
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 10, 0);

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: 'low-power',
        precision: 'mediump'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.9));
    renderer.shadowMap.enabled = false;

    const ambient = new THREE.AmbientLight(0xaaccff, 0.9);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(10, 20, 5);
    scene.add(sun);

    clock = new THREE.Clock();
}

// ---------- Chunk & World ----------
const CHUNK_SIZE = 16;
const MAX_HEIGHT = 64; // world height limit

// Simple seeded pseudo-random function
function hash(x, z) {
    let h = x * 374761393 + z * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) / 2147483648;
}

function getTerrainHeight(wx, wz) {
    // Combine several sine waves for smooth terrain
    const s1 = Math.sin(wx * 0.03) * Math.cos(wz * 0.03) * 6;
    const s2 = Math.sin(wx * 0.07 + 1.5) * Math.cos(wz * 0.07) * 4;
    const s3 = Math.sin(wx * 0.15) * Math.cos(wz * 0.15) * 2.5;
    return Math.floor(s1 + s2 + s3 + 14);
}

// Chunk class
class Chunk {
    constructor(cx, cz) {
        this.cx = cx;
        this.cz = cz;
        this.blocks = new Map(); // key "x,y,z" -> type (relative coords 0..15)
        this.meshGroup = new THREE.Group();
        this.meshGroup.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
        this.instancedMeshes = {}; // type -> InstancedMesh
        this.generate();
        this.buildMesh();
    }

    generate() {
        const baseX = this.cx * CHUNK_SIZE;
        const baseZ = this.cz * CHUNK_SIZE;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                const wx = baseX + lx;
                const wz = baseZ + lz;
                const height = getTerrainHeight(wx, wz);
                for (let y = 0; y <= height && y < MAX_HEIGHT; y++) {
                    let type;
                    if (y === 0) type = 'cobblestone';
                    else if (y < height - 3) type = 'cobblestone';
                    else if (y < height) type = 'dirt';
                    else type = 'grass';
                    this.blocks.set(`${lx},${y},${lz}`, type);
                }
                // Trees (sparse)
                if (height < MAX_HEIGHT - 5 && Math.random() < 0.08) {
                    const treeH = 3;
                    for (let ty = 1; ty <= treeH; ty++) {
                        this.blocks.set(`${lx},${height + ty},${lz}`, 'log');
                    }
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            for (let dy = treeH - 1; dy <= treeH + 1; dy++) {
                                const key = `${lx + dx},${height + dy},${lz + dz}`;
                                if (!this.blocks.has(key)) {
                                    this.blocks.set(key, 'leaves');
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    buildMesh() {
        // Clear old meshes
        Object.values(this.instancedMeshes).forEach(m => {
            this.meshGroup.remove(m);
            m.dispose();
        });
        this.instancedMeshes = {};

        // Group by type
        const byType = {};
        this.blocks.forEach((type, posKey) => {
            if (!byType[type]) byType[type] = [];
            const [lx, y, lz] = posKey.split(',').map(Number);
            byType[type].push({ lx, y, lz, posKey });
        });

        const geometry = sharedGeometry;
        Object.entries(byType).forEach(([type, blocks]) => {
            const materials = getBlockMaterials(type);
            const mesh = new THREE.InstancedMesh(geometry, materials, blocks.length);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = true;
            mesh.userData.blockData = new Array(blocks.length);

            const matrix = new THREE.Matrix4();
            blocks.forEach((block, i) => {
                matrix.setPosition(block.lx, block.y, block.lz);
                mesh.setMatrixAt(i, matrix);
                mesh.userData.blockData[i] = {
                    posKey: block.posKey,
                    chunk: this
                };
            });
            mesh.instanceMatrix.needsUpdate = true;
            this.instancedMeshes[type] = mesh;
            this.meshGroup.add(mesh);
        });
    }

    setBlock(lx, ly, lz, type) {
        const key = `${lx},${ly},${lz}`;
        if (type) {
            this.blocks.set(key, type);
        } else {
            this.blocks.delete(key);
        }
        this.buildMesh(); // rebuild chunk mesh (fast enough for one chunk)
    }

    remove() {
        Object.values(this.instancedMeshes).forEach(m => m.dispose());
        this.meshGroup.clear();
    }
}

// World manager
const chunks = new Map(); // "cx,cz" -> Chunk

function getChunkKey(cx, cz) { return `${cx},${cz}`; }

function getChunkAt(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    return chunks.get(getChunkKey(cx, cz));
}

function getBlockAt(wx, wy, wz) {
    const chunk = getChunkAt(wx, wy, wz);
    if (!chunk) return null;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.blocks.get(`${lx},${wy},${lz}`) || null;
}

function loadChunk(cx, cz) {
    const key = getChunkKey(cx, cz);
    if (!chunks.has(key)) {
        const chunk = new Chunk(cx, cz);
        chunks.set(key, chunk);
        scene.add(chunk.meshGroup);
    }
}

function unloadChunk(cx, cz) {
    const key = getChunkKey(cx, cz);
    const chunk = chunks.get(key);
    if (chunk) {
        scene.remove(chunk.meshGroup);
        chunk.remove();
        chunks.delete(key);
    }
}

function updateChunksAround(playerX, playerZ) {
    const playerCX = Math.floor(playerX / CHUNK_SIZE);
    const playerCZ = Math.floor(playerZ / CHUNK_SIZE);

    // Load required chunks
    for (let dx = -renderDistance; dx <= renderDistance; dx++) {
        for (let dz = -renderDistance; dz <= renderDistance; dz++) {
            loadChunk(playerCX + dx, playerCZ + dz);
        }
    }

    // Unload far chunks
    const toUnload = [];
    chunks.forEach((chunk, key) => {
        const dx = chunk.cx - playerCX;
        const dz = chunk.cz - playerCZ;
        if (Math.abs(dx) > renderDistance + 1 || Math.abs(dz) > renderDistance + 1) {
            toUnload.push([chunk.cx, chunk.cz]);
        }
    });
    toUnload.forEach(([cx, cz]) => unloadChunk(cx, cz));
}

// ---------- Block Interaction ----------
function getLookedBlock() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = [];
    chunks.forEach(chunk => {
        Object.values(chunk.instancedMeshes).forEach(m => meshes.push(m));
    });
    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0 && intersects[0].distance < 7) {
        const intersect = intersects[0];
        const mesh = intersect.object;
        const instanceId = intersect.instanceId;
        const blockData = mesh.userData.blockData?.[instanceId];
        if (!blockData) return null;
        const chunk = blockData.chunk;
        const [lx, ly, lz] = blockData.posKey.split(',').map(Number);
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        return {
            chunk,
            lx, ly, lz,
            wx, wy: ly, wz,
            posKey: blockData.posKey,
            mesh,
            instanceId,
            face: intersect.face
        };
    }
    return null;
}

function handleMining(deltaTime) {
    const hit = getLookedBlock();
    if (hit && keys['MouseLeft'] && pointerLocked) {
        const currentKey = `${hit.chunk.cx},${hit.chunk.cz}:${hit.posKey}`;
        if (miningBlock && miningBlock.key === currentKey) {
            miningProgress += deltaTime;
            const stage = Math.min(9, Math.floor((miningProgress / MINING_TIME) * 10));
            // Apply destroy texture to all materials of this instance
            const mesh = hit.mesh;
            if (mesh && mesh.material) {
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach(mat => {
                    if (!mat.userData.originalMap && mat.map) {
                        mat.userData.originalMap = mat.map;
                    }
                    mat.map = destroyTextures[stage];
                    mat.transparent = true;
                    mat.needsUpdate = true;
                });
            }
            if (miningProgress >= MINING_TIME) {
                // Remove block
                hit.chunk.setBlock(hit.lx, hit.ly, hit.lz, null);
                miningBlock = null;
                miningProgress = 0;
            }
        } else {
            resetMiningTextures();
            miningBlock = {
                key: currentKey,
                mesh: hit.mesh,
                chunk: hit.chunk
            };
            miningProgress = 0;
        }
    } else {
        resetMiningTextures();
        miningBlock = null;
        miningProgress = 0;
    }
}

function resetMiningTextures() {
    if (miningBlock?.mesh?.material) {
        const materials = Array.isArray(miningBlock.mesh.material) ?
            miningBlock.mesh.material : [miningBlock.mesh.material];
        materials.forEach(mat => {
            if (mat.userData.originalMap) {
                mat.map = mat.userData.originalMap;
                mat.transparent = false;
                mat.needsUpdate = true;
            }
        });
    }
}

function placeBlock() {
    const hit = getLookedBlock();
    if (!hit) return;
    const normal = hit.face.normal.clone();
    const placeLx = hit.lx + normal.x;
    const placeLy = hit.ly + normal.y;
    const placeLz = hit.lz + normal.z;

    // Don't place inside player
    const playerPos = camera.position.clone();
    const placeWorld = new THREE.Vector3(
        hit.chunk.cx * CHUNK_SIZE + placeLx + 0.5,
        placeLy + 0.5,
        hit.chunk.cz * CHUNK_SIZE + placeLz + 0.5
    );
    if (playerPos.distanceTo(placeWorld) < 0.8) return;

    // Ensure within chunk bounds
    if (placeLx < 0 || placeLx >= CHUNK_SIZE || placeLz < 0 || placeLz >= CHUNK_SIZE || placeLy < 0 || placeLy >= MAX_HEIGHT) return;

    const existing = hit.chunk.blocks.get(`${placeLx},${placeLy},${placeLz}`);
    if (!existing) {
        hit.chunk.setBlock(placeLx, placeLy, placeLz, selectedBlock);
    }
}

// ---------- Player Physics & Collision ----------
function updatePlayer(deltaTime) {
    if (!pointerLocked) return;

    const moveSpeed = player.speed * deltaTime;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    direction.y = 0; direction.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();

    if (keys['KeyW']) camera.position.addScaledVector(direction, moveSpeed);
    if (keys['KeyS']) camera.position.addScaledVector(direction, -moveSpeed);
    if (keys['KeyA']) camera.position.addScaledVector(right, -moveSpeed);
    if (keys['KeyD']) camera.position.addScaledVector(right, moveSpeed);

    // Gravity
    player.yVelocity -= player.gravity * deltaTime;
    camera.position.y += player.yVelocity * deltaTime;

    // Collision detection
    const pMinX = camera.position.x - 0.25;
    const pMaxX = camera.position.x + 0.25;
    const pMinY = camera.position.y - player.height;
    const pMaxY = camera.position.y;
    const pMinZ = camera.position.z - 0.25;
    const pMaxZ = camera.position.z + 0.25;

    player.onGround = false;
    const checkRange = 1;
    for (let dx = -checkRange; dx <= checkRange; dx++) {
        for (let dy = -checkRange; dy <= checkRange; dy++) {
            for (let dz = -checkRange; dz <= checkRange; dz++) {
                const bx = Math.floor(camera.position.x) + dx;
                const by = Math.floor(camera.position.y - player.height / 2) + dy;
                const bz = Math.floor(camera.position.z) + dz;
                const block = getBlockAt(bx, by, bz);
                if (!block) continue;

                const bMinX = bx, bMaxX = bx + 1;
                const bMinY = by, bMaxY = by + 1;
                const bMinZ = bz, bMaxZ = bz + 1;

                const overlapX = Math.min(pMaxX - bMinX, bMaxX - pMinX);
                const overlapY = Math.min(pMaxY - bMinY, bMaxY - pMinY);
                const overlapZ = Math.min(pMaxZ - bMinZ, bMaxZ - pMinZ);

                if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                    const minOverlap = Math.min(overlapX, overlapY, overlapZ);
                    if (minOverlap === overlapY) {
                        if (pMinY < bMinY + 0.1 && player.yVelocity <= 0) {
                            camera.position.y = bMaxY + player.height;
                            player.yVelocity = 0;
                            player.onGround = true;
                        } else if (pMaxY > bMaxY - 0.1 && player.yVelocity > 0) {
                            camera.position.y = bMinY;
                            player.yVelocity = 0;
                        }
                    } else if (minOverlap === overlapX) {
                        if (camera.position.x > bx + 0.5) camera.position.x = bMaxX + 0.25;
                        else camera.position.x = bMinX - 0.25;
                    } else if (minOverlap === overlapZ) {
                        if (camera.position.z > bz + 0.5) camera.position.z = bMaxZ + 0.25;
                        else camera.position.z = bMinZ - 0.25;
                    }
                }
            }
        }
    }

    if (keys['Space'] && player.onGround) {
        player.yVelocity = player.jumpForce;
        player.onGround = false;
    }

    if (camera.position.y < -10) {
        camera.position.set(0, 20, 0);
        player.yVelocity = 0;
    }
}

// ---------- UI & Events ----------
function updateHotbar() {
    hotbarSlots.forEach(slot => slot.classList.toggle('selected', slot.dataset.block === selectedBlock));
    blockNameDiv.textContent = blockNames[selectedBlock] || 'Unknown';
}

function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyM') toggleMusic();
        const num = parseInt(e.key);
        if (num >= 1 && num <= 6) {
            selectedBlock = blockOrder[num - 1];
            updateHotbar();
        }
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    document.addEventListener('mousedown', e => {
        if (!pointerLocked || !gameStarted) return;
        if (e.button === 0) keys['MouseLeft'] = true;
        if (e.button === 2) placeBlock();
    });
    document.addEventListener('mouseup', e => {
        if (e.button === 0) keys['MouseLeft'] = false;
    });

    document.addEventListener('wheel', e => {
        if (!pointerLocked) return;
        e.preventDefault();
        const idx = blockOrder.indexOf(selectedBlock);
        selectedBlock = blockOrder[(idx + (e.deltaY > 0 ? 1 : -1) + 6) % 6];
        updateHotbar();
    }, { passive: false });

    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousemove', e => {
        if (!pointerLocked) return;
        player.euler.setFromQuaternion(camera.quaternion);
        player.euler.y -= e.movementX * 0.002;
        player.euler.x -= e.movementY * 0.002;
        player.euler.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, player.euler.x));
        camera.quaternion.setFromEuler(player.euler);
    });

    canvas.addEventListener('click', () => {
        if (!gameStarted) {
            gameStarted = true;
            instructionsDiv.style.opacity = '0';
            setTimeout(() => instructionsDiv.style.display = 'none', 500);
        }
        canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === canvas;
        if (gameStarted) {
            instructionsDiv.style.display = pointerLocked ? 'none' : 'block';
            instructionsDiv.style.opacity = pointerLocked ? '0' : '1';
        }
    });

    hotbarSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            selectedBlock = slot.dataset.block;
            updateHotbar();
        });
    });

    musicToggle.addEventListener('click', toggleMusic);

    renderSlider.addEventListener('input', () => {
        renderDistance = parseInt(renderSlider.value, 10);
        renderValueSpan.textContent = renderDistance;
        updateChunksAround(camera.position.x, camera.position.z);
    });
}

function toggleMusic() {
    if (musicPlaying) {
        audio.pause();
        musicToggle.textContent = '🔇';
    } else {
        audio.play().catch(() => {});
        musicToggle.textContent = '🔊';
    }
    musicPlaying = !musicPlaying;
}

// FPS tracking
let frameCount = 0, lastFpsTime = performance.now();
function updateFPS() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        const fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
        fpsDiv.textContent = `FPS: ${fps}`;
        fpsDiv.style.color = fps >= 50 ? '#4f4' : fps >= 30 ? '#ff4' : '#f44';
        frameCount = 0;
        lastFpsTime = now;
    }
}

// ---------- Game Loop ----------
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    updateFPS();
    updatePlayer(delta);
    updateChunksAround(camera.position.x, camera.position.z);
    handleMining(delta);

    renderer.render(scene, camera);
}

// ---------- Start ----------
loadTextures();
initScene();
// Load initial chunks around spawn
updateChunksAround(0, 0);
setupEvents();
updateHotbar();
animate();

console.log('🌍 Infinite MiniCraft ready!');

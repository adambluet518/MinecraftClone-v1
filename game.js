import * as THREE from 'three';

// DOM Elements
const canvas = document.getElementById('game-canvas');
const audio = document.getElementById('bg-music');
const blockNameDiv = document.getElementById('block-name');
const instructionsDiv = document.getElementById('instructions');
const musicToggle = document.getElementById('music-toggle');
const hotbarSlots = document.querySelectorAll('.hotbar-slot');

// Game State
let musicPlaying = false;
let selectedBlock = 'grass';
const blockOrder = ['grass', 'dirt', 'cobblestone', 'log', 'leaves', 'planks'];
const blockNames = {
    grass: 'Grass', dirt: 'Dirt', cobblestone: 'Stone',
    log: 'Log', leaves: 'Leaves', planks: 'Planks'
};

// Texture Manager
const textureLoader = new THREE.TextureLoader();
const textures = {};
const destroyTextures = [];

// Load all textures
function loadTextures() {
    const blockTypes = ['cobblestone', 'dirt', 'grass', 'leaves', 'log_side', 'log_top', 'planks'];
    
    blockTypes.forEach(name => {
        textures[name] = textureLoader.load(`${name}.png`);
        textures[name].magFilter = THREE.NearestFilter;
        textures[name].minFilter = THREE.NearestFilter;
        textures[name].colorSpace = THREE.SRGBColorSpace;
    });
    
    // Load destroy stages
    for (let i = 0; i <= 9; i++) {
        const tex = textureLoader.load(`destroy_stage_${i}.png`);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        destroyTextures.push(tex);
    }
}

// Get materials for a block type
function getBlockMaterials(type) {
    if (type === 'grass') {
        return [
            new THREE.MeshLambertMaterial({ map: textures.grass }), // right
            new THREE.MeshLambertMaterial({ map: textures.grass }), // left
            new THREE.MeshLambertMaterial({ map: textures.grass }), // top (will be replaced)
            new THREE.MeshLambertMaterial({ map: textures.dirt }),  // bottom
            new THREE.MeshLambertMaterial({ map: textures.grass }), // front
            new THREE.MeshLambertMaterial({ map: textures.grass })  // back
        ];
    } else if (type === 'log') {
        return [
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_top }),
            new THREE.MeshLambertMaterial({ map: textures.log_top }),
            new THREE.MeshLambertMaterial({ map: textures.log_side }),
            new THREE.MeshLambertMaterial({ map: textures.log_side })
        ];
    } else {
        const tex = textures[type] || textures.cobblestone;
        return [
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex }),
            new THREE.MeshLambertMaterial({ map: tex })
        ];
    }
}

// Player State
const player = {
    height: 1.6,
    speed: 6,
    jumpForce: 9,
    gravity: 22,
    yVelocity: 0,
    onGround: false,
    euler: new THREE.Euler(0, 0, 0, 'YXZ')
};

// Mining State
let miningBlock = null;
let miningProgress = 0;
const MINING_TIME = 0.7;

// World
const world = new Map();
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;

// Three.js Setup
let scene, camera, renderer, clock;
let raycaster = new THREE.Raycaster();
const keys = {};
let pointerLocked = false;
let gameStarted = false;

// Use InstancedMesh for massive performance boost
let instancedMeshes = {};
const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 30, 80);
    
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(8, 14, 8);
    camera.lookAt(0, 8, 0);
    
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = false; // Disable shadows for performance
    
    const ambient = new THREE.AmbientLight(0x8899bb, 0.8);
    scene.add(ambient);
    
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 50, 20);
    scene.add(sun);
    
    clock = new THREE.Clock();
}

function generateTerrain() {
    const startX = -Math.floor(RENDER_DISTANCE * CHUNK_SIZE / 2);
    const startZ = -Math.floor(RENDER_DISTANCE * CHUNK_SIZE / 2);
    const endX = startX + RENDER_DISTANCE * CHUNK_SIZE;
    const endZ = startZ + RENDER_DISTANCE * CHUNK_SIZE;
    
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            const height = Math.floor(Math.sin(x * 0.15) * Math.cos(z * 0.15) * 3 + 8);
            
            for (let y = 0; y <= height; y++) {
                let type;
                if (y === 0) type = 'cobblestone';
                else if (y < height - 3) type = 'cobblestone';
                else if (y < height) type = 'dirt';
                else type = 'grass';
                
                world.set(`${x},${y},${z}`, type);
                
                // Generate trees
                if (y === height && type === 'grass' && Math.random() < 0.12) {
                    const treeHeight = 3 + Math.floor(Math.random() * 2);
                    for (let ty = 1; ty <= treeHeight; ty++) {
                        world.set(`${x},${y + ty},${z}`, 'log');
                    }
                    // Leaves
                    for (let lx = -2; lx <= 2; lx++) {
                        for (let lz = -2; lz <= 2; lz++) {
                            for (let ly = treeHeight - 1; ly <= treeHeight + 1; ly++) {
                                if (Math.abs(lx) === 2 && Math.abs(lz) === 2 && Math.random() > 0.5) continue;
                                if (Math.abs(lx) === 2 && Math.abs(lz) === 2 && ly === treeHeight + 1) continue;
                                const dist = Math.abs(lx) + Math.abs(lz) + Math.abs(ly - treeHeight);
                                if (dist <= 4 && !world.has(`${x + lx},${y + ly},${z + lz}`)) {
                                    world.set(`${x + lx},${y + ly},${z + lz}`, 'leaves');
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

function buildWorld() {
    // Clear old meshes
    Object.values(instancedMeshes).forEach(mesh => {
        scene.remove(mesh);
        mesh.dispose();
    });
    instancedMeshes = {};
    
    // Group blocks by type for instanced rendering
    const blocksByType = {};
    world.forEach((type, posKey) => {
        if (!blocksByType[type]) blocksByType[type] = [];
        const [x, y, z] = posKey.split(',').map(Number);
        blocksByType[type].push({ x, y, z, posKey });
    });
    
    Object.entries(blocksByType).forEach(([type, blocks]) => {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = getBlockMaterials(type);
        const mesh = new THREE.InstancedMesh(geometry, materials, blocks.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        
        blocks.forEach((block, i) => {
            tempMatrix.setPosition(block.x, block.y, block.z);
            mesh.setMatrixAt(i, tempMatrix);
            // Store posKey in a parallel array
            if (!mesh.userData.blockData) mesh.userData.blockData = [];
            mesh.userData.blockData[i] = block.posKey;
        });
        
        mesh.userData.blockType = type;
        mesh.instanceMatrix.needsUpdate = true;
        
        scene.add(mesh);
        instancedMeshes[type] = mesh;
    });
}

// Convert InstancedMesh intersection to block position
function getBlockFromIntersect(intersect) {
    if (!intersect.object.isInstancedMesh) return null;
    
    const instanceId = intersect.instanceId;
    const mesh = intersect.object;
    const posKey = mesh.userData.blockData?.[instanceId];
    
    if (!posKey) return null;
    const [x, y, z] = posKey.split(',').map(Number);
    
    return {
        position: new THREE.Vector3(x, y, z),
        posKey,
        mesh,
        instanceId,
        face: intersect.face
    };
}

function getLookedBlock() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(Object.values(instancedMeshes));
    
    if (intersects.length > 0 && intersects[0].distance < 8) {
        return getBlockFromIntersect(intersects[0]);
    }
    return null;
}

function updatePlayer(deltaTime) {
    if (!pointerLocked) return;
    
    const moveSpeed = player.speed * deltaTime;
    
    // Get camera direction
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);
    direction.y = 0;
    direction.normalize();
    
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();
    
    // Movement
    if (keys['KeyW']) camera.position.addScaledVector(direction, moveSpeed);
    if (keys['KeyS']) camera.position.addScaledVector(direction, -moveSpeed);
    if (keys['KeyA']) camera.position.addScaledVector(right, -moveSpeed);
    if (keys['KeyD']) camera.position.addScaledVector(right, moveSpeed);
    
    // Sprint
    if (keys['ShiftLeft']) {
        if (keys['KeyW']) camera.position.addScaledVector(direction, moveSpeed * 0.5);
    }
    
    // Gravity
    player.yVelocity -= player.gravity * deltaTime;
    camera.position.y += player.yVelocity * deltaTime;
    
    // Ground collision
    const footY = camera.position.y - player.height;
    const checkPos = new THREE.Vector3(
        Math.floor(camera.position.x),
        Math.floor(footY - 0.1),
        Math.floor(camera.position.z)
    );
    
    const blockBelow = world.get(`${checkPos.x},${checkPos.y},${checkPos.z}`);
    player.onGround = false;
    
    if (blockBelow) {
        camera.position.y = checkPos.y + 1 + player.height;
        player.yVelocity = 0;
        player.onGround = true;
    }
    
    // Side collisions (simple)
    const playerMinX = camera.position.x - 0.3;
    const playerMaxX = camera.position.x + 0.3;
    const playerMinZ = camera.position.z - 0.3;
    const playerMaxZ = camera.position.z + 0.3;
    const playerMinY = camera.position.y - player.height;
    const playerMaxY = camera.position.y;
    
    const checkBlocks = [];
    for (let x = Math.floor(playerMinX); x <= Math.floor(playerMaxX); x++) {
        for (let y = Math.floor(playerMinY); y <= Math.floor(playerMaxY); y++) {
            for (let z = Math.floor(playerMinZ); z <= Math.floor(playerMaxZ); z++) {
                if (world.has(`${x},${y},${z}`)) {
                    checkBlocks.push({ x, y, z });
                }
            }
        }
    }
    
    // Resolve collisions
    for (const block of checkBlocks) {
        const bx = block.x;
        const by = block.y;
        const bz = block.z;
        
        const overlapX = Math.min(playerMaxX - bx, bx + 1 - playerMinX);
        const overlapY = Math.min(playerMaxY - by, by + 1 - playerMinY);
        const overlapZ = Math.min(playerMaxZ - bz, bz + 1 - playerMinZ);
        
        if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            const minOverlap = Math.min(overlapX, overlapY, overlapZ);
            
            if (minOverlap === overlapY && overlapY < 0.5) {
                if (player.yVelocity < 0 && playerMinY < by + 1) {
                    camera.position.y = by + 1 + player.height;
                    player.yVelocity = 0;
                    player.onGround = true;
                } else if (player.yVelocity > 0 && playerMaxY > by) {
                    camera.position.y = by;
                    player.yVelocity = 0;
                }
            } else if (minOverlap === overlapX) {
                if (camera.position.x > bx + 0.5) {
                    camera.position.x = bx + 1 + 0.3;
                } else {
                    camera.position.x = bx - 0.3;
                }
            } else if (minOverlap === overlapZ) {
                if (camera.position.z > bz + 0.5) {
                    camera.position.z = bz + 1 + 0.3;
                } else {
                    camera.position.z = bz - 0.3;
                }
            }
        }
    }
    
    // Jump
    if (keys['Space'] && player.onGround) {
        player.yVelocity = player.jumpForce;
        player.onGround = false;
    }
    
    // Fall protection
    if (camera.position.y < -10) {
        camera.position.set(0, 15, 0);
        player.yVelocity = 0;
    }
}

function handleMining(deltaTime) {
    const hit = getLookedBlock();
    
    if (hit && keys['MouseLeft'] && pointerLocked) {
        if (miningBlock && miningBlock.posKey === hit.posKey) {
            miningProgress += deltaTime;
            const stage = Math.min(9, Math.floor((miningProgress / MINING_TIME) * 10));
            
            // Apply destroy texture overlay
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
                world.delete(hit.posKey);
                rebuildWorld(); // Rebuild for simplicity (could optimize)
                miningBlock = null;
                miningProgress = 0;
            }
        } else {
            resetMiningTextures();
            miningBlock = { posKey: hit.posKey, mesh: hit.mesh, instanceId: hit.instanceId };
            miningProgress = 0;
        }
    } else {
        resetMiningTextures();
        miningBlock = null;
        miningProgress = 0;
    }
}

function resetMiningTextures() {
    if (miningBlock && miningBlock.mesh) {
        const mesh = miningBlock.mesh;
        if (mesh && mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach(mat => {
                if (mat.userData.originalMap) {
                    mat.map = mat.userData.originalMap;
                    mat.transparent = false;
                    mat.needsUpdate = true;
                }
            });
        }
    }
}

function placeBlock() {
    const hit = getLookedBlock();
    if (!hit) return;
    
    const normal = hit.face.normal.clone();
    const placePos = hit.position.clone().add(normal);
    
    // Don't place inside player
    const playerPos = camera.position.clone();
    playerPos.y -= player.height / 2;
    if (placePos.distanceTo(playerPos) < 0.6) return;
    
    const posKey = `${placePos.x},${placePos.y},${placePos.z}`;
    if (!world.has(posKey)) {
        world.set(posKey, selectedBlock);
        rebuildWorld();
    }
}

function rebuildWorld() {
    // More efficient rebuild - just recreate instanced meshes
    Object.values(instancedMeshes).forEach(mesh => {
        scene.remove(mesh);
        mesh.dispose();
    });
    instancedMeshes = {};
    
    const blocksByType = {};
    world.forEach((type, posKey) => {
        if (!blocksByType[type]) blocksByType[type] = [];
        const [x, y, z] = posKey.split(',').map(Number);
        blocksByType[type].push({ x, y, z, posKey });
    });
    
    Object.entries(blocksByType).forEach(([type, blocks]) => {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = getBlockMaterials(type);
        const mesh = new THREE.InstancedMesh(geometry, materials, blocks.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.blockData = [];
        
        blocks.forEach((block, i) => {
            tempMatrix.setPosition(block.x, block.y, block.z);
            mesh.setMatrixAt(i, tempMatrix);
            mesh.userData.blockData[i] = block.posKey;
        });
        
        mesh.userData.blockType = type;
        mesh.instanceMatrix.needsUpdate = true;
        
        scene.add(mesh);
        instancedMeshes[type] = mesh;
    });
}

function updateHotbar() {
    hotbarSlots.forEach(slot => {
        slot.classList.toggle('selected', slot.dataset.block === selectedBlock);
    });
    blockNameDiv.textContent = blockNames[selectedBlock] || 'Unknown';
}

function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        
        if (e.code === 'KeyM') toggleMusic();
        
        const numKey = parseInt(e.key);
        if (numKey >= 1 && numKey <= 6) {
            selectedBlock = blockOrder[numKey - 1];
            updateHotbar();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });
    
    document.addEventListener('mousedown', (e) => {
        if (!pointerLocked || !gameStarted) return;
        if (e.button === 0) keys['MouseLeft'] = true;
        if (e.button === 2) placeBlock();
    });
    
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) keys['MouseLeft'] = false;
    });
    
    document.addEventListener('wheel', (e) => {
        if (!pointerLocked) return;
        e.preventDefault();
        const currentIndex = blockOrder.indexOf(selectedBlock);
        if (e.deltaY > 0) {
            selectedBlock = blockOrder[(currentIndex + 1) % 6];
        } else {
            selectedBlock = blockOrder[(currentIndex - 1 + 6) % 6];
        }
        updateHotbar();
    }, { passive: false });
    
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // Mouse look
    document.addEventListener('mousemove', (e) => {
        if (!pointerLocked) return;
        const sensitivity = 0.002;
        player.euler.setFromQuaternion(camera.quaternion);
        player.euler.y -= e.movementX * sensitivity;
        player.euler.x -= e.movementY * sensitivity;
        player.euler.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, player.euler.x));
        camera.quaternion.setFromEuler(player.euler);
    });
    
    canvas.addEventListener('click', () => {
        if (!gameStarted) {
            gameStarted = true;
            instructionsDiv.style.opacity = '0';
            setTimeout(() => { instructionsDiv.style.display = 'none'; }, 500);
        }
        canvas.requestPointerLock();
    });
    
    document.addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === canvas;
        if (!pointerLocked && gameStarted) {
            instructionsDiv.style.opacity = '1';
            instructionsDiv.style.display = 'block';
        } else if (pointerLocked) {
            instructionsDiv.style.opacity = '0';
            setTimeout(() => { instructionsDiv.style.display = 'none'; }, 500);
        }
    });
    
    hotbarSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            selectedBlock = slot.dataset.block;
            updateHotbar();
        });
    });
    
    musicToggle.addEventListener('click', toggleMusic);
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

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = Math.min(clock.getDelta(), 0.1);
    
    updatePlayer(deltaTime);
    handleMining(deltaTime);
    
    renderer.render(scene, camera);
}

// Initialize
loadTextures();
generateTerrain();
initScene();
buildWorld();
setupEvents();
updateHotbar();
animate();

console.log('🌍 MiniCraft ready! Using your textures.');

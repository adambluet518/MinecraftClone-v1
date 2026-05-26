import * as THREE from 'three';

// DOM Elements
const canvas = document.getElementById('game-canvas');
const audio = document.getElementById('bg-music');
const blockNameDiv = document.getElementById('block-name');
const instructionsDiv = document.getElementById('instructions');
const musicToggle = document.getElementById('music-toggle');
const hotbarSlots = document.querySelectorAll('.hotbar-slot');

// FPS Counter
const fpsCounter = document.createElement('div');
fpsCounter.id = 'fps-counter';
fpsCounter.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 50;
    color: #fff;
    font-size: 14px;
    font-weight: bold;
    font-family: monospace;
    background: rgba(0,0,0,0.6);
    padding: 4px 8px;
    border-radius: 6px;
    pointer-events: none;
`;
document.body.appendChild(fpsCounter);

let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

// Game State
let musicPlaying = false;
let selectedBlock = 'grass';
const blockOrder = ['grass', 'dirt', 'cobblestone', 'log', 'leaves', 'planks'];
const blockNames = {
    grass: 'Grass', dirt: 'Dirt', cobblestone: 'Stone',
    log: 'Log', leaves: 'Leaves', planks: 'Planks'
};

// Performance settings (adjustable)
const PERFORMANCE = {
    renderDistance: 2,        // Reduced from 3
    pixelRatio: 0.8,         // Lower resolution
    fogDistance: 25,          // Closer fog
    antialias: false,
    shadows: false,
    chunkSize: 16
};

// Texture Manager with caching
const textureLoader = new THREE.TextureLoader();
const textures = {};
const destroyTextures = [];

// Load textures with reduced quality
function loadTextures() {
    const blockTypes = ['cobblestone', 'dirt', 'grass', 'leaves', 'log_side', 'log_top', 'planks'];
    
    blockTypes.forEach(name => {
        textures[name] = textureLoader.load(`${name}.png`);
        textures[name].magFilter = THREE.NearestFilter;
        textures[name].minFilter = THREE.NearestFilter;
        textures[name].generateMipmaps = false; // Save memory
        textures[name].colorSpace = THREE.SRGBColorSpace;
    });
    
    // Load destroy stages
    for (let i = 0; i <= 9; i++) {
        const tex = textureLoader.load(`destroy_stage_${i}.png`);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        destroyTextures.push(tex);
    }
}

// Reusable materials to avoid creating new ones
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

// Shared geometry (only one BoxGeometry needed)
let sharedGeometry = null;

function getSharedGeometry() {
    if (!sharedGeometry) {
        sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
    }
    return sharedGeometry;
}

// Player State
const player = {
    height: 1.6,
    speed: 5.5,
    jumpForce: 8,
    gravity: 20,
    yVelocity: 0,
    onGround: false,
    euler: new THREE.Euler(0, 0, 0, 'YXZ')
};

// Mining State
let miningBlock = null;
let miningProgress = 0;
const MINING_TIME = 0.6;

// World
const world = new Map();
const RENDER_DISTANCE = PERFORMANCE.renderDistance;

// Three.js Setup
let scene, camera, renderer, clock;
let raycaster = new THREE.Raycaster();
raycaster.far = 6; // Shorter raycast distance
const keys = {};
let pointerLocked = false;
let gameStarted = false;

// Instanced meshes
let instancedMeshes = {};
const tempMatrix = new THREE.Matrix4();
const tempVector = new THREE.Vector3();

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, PERFORMANCE.fogDistance * 0.7, PERFORMANCE.fogDistance);
    
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, PERFORMANCE.fogDistance + 10);
    camera.position.set(8, 12, 8);
    camera.lookAt(0, 8, 0);
    
    renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: PERFORMANCE.antialias,
        powerPreference: 'low-power',
        precision: 'mediump' // Lower precision for speed
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERFORMANCE.pixelRatio));
    
    // Disable shadows completely
    renderer.shadowMap.enabled = false;
    
    // Single ambient light (cheaper)
    const ambient = new THREE.AmbientLight(0xaaccff, 1.0);
    scene.add(ambient);
    
    // One directional light without shadows
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(10, 20, 5);
    scene.add(sun);
    
    clock = new THREE.Clock();
}

function generateTerrain() {
    const startX = -Math.floor(RENDER_DISTANCE * PERFORMANCE.chunkSize / 2);
    const startZ = -Math.floor(RENDER_DISTANCE * PERFORMANCE.chunkSize / 2);
    const endX = startX + RENDER_DISTANCE * PERFORMANCE.chunkSize;
    const endZ = startZ + RENDER_DISTANCE * PERFORMANCE.chunkSize;
    
    // Pre-calculate heightmap for speed
    const heightMap = {};
    
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            const height = Math.floor(Math.sin(x * 0.12) * Math.cos(z * 0.12) * 3 + 8);
            heightMap[`${x},${z}`] = height;
            
            for (let y = 0; y <= height; y++) {
                let type;
                if (y < height - 3) type = 'cobblestone';
                else if (y < height) type = 'dirt';
                else type = 'grass';
                
                world.set(`${x},${y},${z}`, type);
            }
        }
    }
    
    // Generate trees in a second pass (fewer trees for performance)
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            const height = heightMap[`${x},${z}`];
            if (height && Math.random() < 0.08) { // Reduced from 0.12
                const treeHeight = 3;
                for (let ty = 1; ty <= treeHeight; ty++) {
                    world.set(`${x},${height + ty},${z}`, 'log');
                }
                // Smaller leaf canopy
                for (let lx = -1; lx <= 1; lx++) {
                    for (let lz = -1; lz <= 1; lz++) {
                        for (let ly = treeHeight - 1; ly <= treeHeight + 1; ly++) {
                            const posKey = `${x + lx},${height + ly},${z + lz}`;
                            if (!world.has(posKey)) {
                                world.set(posKey, 'leaves');
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
        if (mesh.geometry !== sharedGeometry) mesh.geometry.dispose();
        mesh.dispose();
    });
    instancedMeshes = {};
    
    // Group blocks by type
    const blocksByType = {};
    world.forEach((type, posKey) => {
        if (!blocksByType[type]) blocksByType[type] = [];
        const [x, y, z] = posKey.split(',').map(Number);
        blocksByType[type].push({ x, y, z, posKey });
    });
    
    const geometry = getSharedGeometry();
    
    Object.entries(blocksByType).forEach(([type, blocks]) => {
        const materials = getBlockMaterials(type);
        const mesh = new THREE.InstancedMesh(geometry, materials, blocks.length);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true; // Don't render if not visible
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.blockData = new Array(blocks.length);
        
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
    const intersects = raycaster.intersectObjects(Object.values(instancedMeshes), false);
    
    if (intersects.length > 0 && intersects[0].distance < 6) {
        return getBlockFromIntersect(intersects[0]);
    }
    return null;
}

function updatePlayer(deltaTime) {
    if (!pointerLocked) return;
    
    const moveSpeed = player.speed * deltaTime;
    
    // Use local vectors to avoid garbage collection
    const direction = tempVector.set(0, 0, -1).applyQuaternion(camera.quaternion);
    direction.y = 0;
    direction.normalize();
    
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();
    
    if (keys['KeyW']) camera.position.addScaledVector(direction, moveSpeed);
    if (keys['KeyS']) camera.position.addScaledVector(direction, -moveSpeed);
    if (keys['KeyA']) camera.position.addScaledVector(right, -moveSpeed);
    if (keys['KeyD']) camera.position.addScaledVector(right, moveSpeed);
    
    // Gravity
    player.yVelocity -= player.gravity * deltaTime;
    camera.position.y += player.yVelocity * deltaTime;
    
    // Simple ground check (only check directly below)
    const footX = Math.floor(camera.position.x);
    const footY = Math.floor(camera.position.y - player.height - 0.1);
    const footZ = Math.floor(camera.position.z);
    
    const blockBelow = world.get(`${footX},${footY},${footZ}`);
    player.onGround = false;
    
    if (blockBelow) {
        camera.position.y = footY + 1 + player.height;
        player.yVelocity = 0;
        player.onGround = true;
    }
    
    // Simplified collision - only check blocks near player
    const px = Math.floor(camera.position.x);
    const py = Math.floor(camera.position.y - player.height * 0.5);
    const pz = Math.floor(camera.position.z);
    
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 2; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const bx = px + dx;
                const by = py + dy;
                const bz = pz + dz;
                
                if (world.has(`${bx},${by},${bz}`)) {
                    // Simple AABB collision
                    const pMinX = camera.position.x - 0.25;
                    const pMaxX = camera.position.x + 0.25;
                    const pMinY = camera.position.y - player.height;
                    const pMaxY = camera.position.y;
                    const pMinZ = camera.position.z - 0.25;
                    const pMaxZ = camera.position.z + 0.25;
                    
                    if (pMaxX > bx && pMinX < bx + 1 &&
                        pMaxY > by && pMinY < by + 1 &&
                        pMaxZ > bz && pMinZ < bz + 1) {
                        
                        // Push player out
                        const overlapX = Math.min(pMaxX - bx, bx + 1 - pMinX);
                        const overlapY = Math.min(pMaxY - by, by + 1 - pMinY);
                        const overlapZ = Math.min(pMaxZ - bz, bz + 1 - pMinZ);
                        
                        if (overlapY < overlapX && overlapY < overlapZ) {
                            if (pMinY < by + 0.5) {
                                camera.position.y = by + 1 + player.height;
                                player.yVelocity = 0;
                                player.onGround = true;
                            }
                        } else if (overlapX < overlapZ) {
                            if (camera.position.x > bx + 0.5) {
                                camera.position.x = bx + 1.25;
                            } else {
                                camera.position.x = bx - 0.25;
                            }
                        } else {
                            if (camera.position.z > bz + 0.5) {
                                camera.position.z = bz + 1.25;
                            } else {
                                camera.position.z = bz - 0.25;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Jump
    if (keys['Space'] && player.onGround) {
        player.yVelocity = player.jumpForce;
        player.onGround = false;
    }
    
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
            
            const mesh = hit.mesh;
            if (mesh?.material) {
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
                world.delete(hit.posKey);
                rebuildWorld();
                miningBlock = null;
                miningProgress = 0;
            }
        } else {
            resetMiningTextures();
            miningBlock = { posKey: hit.posKey, mesh: hit.mesh };
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
    
    const placePos = hit.position.clone().add(hit.face.normal);
    
    const playerPos = camera.position.clone();
    playerPos.y -= player.height / 2;
    if (placePos.distanceTo(playerPos) < 0.5) return;
    
    const posKey = `${placePos.x},${placePos.y},${placePos.z}`;
    if (!world.has(posKey)) {
        world.set(posKey, selectedBlock);
        rebuildWorld();
    }
}

function rebuildWorld() {
    // Clear and rebuild
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
    
    const geometry = getSharedGeometry();
    
    Object.entries(blocksByType).forEach(([type, blocks]) => {
        const materials = getBlockMaterials(type);
        const mesh = new THREE.InstancedMesh(geometry, materials, blocks.length);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.blockData = new Array(blocks.length);
        
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
        selectedBlock = blockOrder[e.deltaY > 0 ? 
            (currentIndex + 1) % 6 : 
            (currentIndex - 1 + 6) % 6];
        updateHotbar();
    }, { passive: false });
    
    document.addEventListener('contextmenu', e => e.preventDefault());
    
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
        const display = pointerLocked ? 'none' : 'block';
        const opacity = pointerLocked ? '0' : '1';
        if (gameStarted) {
            instructionsDiv.style.display = display;
            instructionsDiv.style.opacity = opacity;
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

function updateFPS() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        currentFps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
        fpsCounter.textContent = `FPS: ${currentFps}`;
        
        // Color code FPS
        if (currentFps >= 50) {
            fpsCounter.style.color = '#4f4';
        } else if (currentFps >= 30) {
            fpsCounter.style.color = '#ff4';
        } else {
            fpsCounter.style.color = '#f44';
        }
        
        frameCount = 0;
        lastFpsTime = now;
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = Math.min(clock.getDelta(), 0.1);
    
    updateFPS();
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

console.log('🌍 MiniCraft ready! Optimized for performance.');

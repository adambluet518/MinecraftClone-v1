import * as THREE from 'three';

// ---------- DOM ELEMENTS ----------
const canvas = document.getElementById('game-canvas');
const audio = document.getElementById('bg-music');
const blockNameDiv = document.getElementById('block-name');
const instructionsDiv = document.getElementById('instructions');
const musicToggle = document.getElementById('music-toggle');
const hotbarSlots = document.querySelectorAll('.hotbar-slot');

// ---------- GLOBAL STATE ----------
let musicPlaying = false;
let selectedBlockType = 3; // Default Stone
const blockTypes = {
    1: { name: 'Grass', topColor: 0x7c9c4c, sideColor: 0x8b7355, bottomColor: 0x8b7355 },
    2: { name: 'Dirt', topColor: 0x8b5a2b, sideColor: 0x8b5a2b, bottomColor: 0x8b5a2b },
    3: { name: 'Stone', topColor: 0x7f7f7f, sideColor: 0x7f7f7f, bottomColor: 0x7f7f7f },
    4: { name: 'Log', topColor: 0xbc8f4f, sideColor: 0x8b6914, bottomColor: 0xbc8f4f },
    5: { name: 'Leaves', topColor: 0x2d5a27, sideColor: 0x2d5a27, bottomColor: 0x2d5a27 },
    6: { name: 'Planks', topColor: 0xbc8f4f, sideColor: 0xbc8f4f, bottomColor: 0xbc8f4f }
};

// Player state
const player = {
    height: 1.8,
    speed: 5.5,
    jumpForce: 8.5,
    gravity: 20.0,
    yVelocity: 0,
    onGround: false
};

// Mining state
let miningBlock = null;
let miningProgress = 0;
const MINING_TIME = 0.8; // seconds

// World
const world = new Map();
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;

// Three.js
let scene, camera, renderer, clock;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let keys = {};
let pointerLocked = false;
let gameStarted = false;

// Block meshes for picking
const blockMeshes = [];

// ---------- TEXTURE GENERATION ----------
function generateTexture(colors) {
    const size = 16;
    const canvas2 = document.createElement('canvas');
    canvas2.width = size;
    canvas2.height = size;
    const ctx = canvas2.getContext('2d');
    
    ctx.fillStyle = `#${colors.topColor.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, size, size);
    
    // Add noise and edge details
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 25;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
        data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
    
    // Draw edge lines
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size-1, size-1);
    
    return new THREE.CanvasTexture(canvas2);
}

function generateDestroyTexture(stage) {
    const size = 16;
    const canvas2 = document.createElement('canvas');
    canvas2.width = size;
    canvas2.height = size;
    const ctx = canvas2.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    
    const progress = stage / 9;
    const crackCount = Math.floor(progress * 12);
    
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.2;
    
    for (let i = 0; i < crackCount; i++) {
        ctx.beginPath();
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random()-0.5)*10, y + (Math.random()-0.5)*10);
        ctx.stroke();
    }
    
    return new THREE.CanvasTexture(canvas2);
}

// Pre-generate textures
const blockTextures = {};
for (let id = 1; id <= 6; id++) {
    const colors = blockTypes[id];
    blockTextures[id] = {
        top: generateTexture({ topColor: colors.topColor }),
        side: generateTexture({ topColor: colors.sideColor }),
        bottom: generateTexture({ topColor: colors.bottomColor })
    };
}

const destroyTextures = [];
for (let i = 0; i <= 9; i++) {
    destroyTextures.push(generateDestroyTexture(i));
}

// ---------- BLOCK CREATION ----------
function createBlockMesh(x, y, z, typeId) {
    const textures = blockTextures[typeId];
    const materials = [
        new THREE.MeshLambertMaterial({ map: textures.side }), // right
        new THREE.MeshLambertMaterial({ map: textures.side }), // left
        new THREE.MeshLambertMaterial({ map: textures.top }),  // top
        new THREE.MeshLambertMaterial({ map: textures.bottom }), // bottom
        new THREE.MeshLambertMaterial({ map: textures.side }), // front
        new THREE.MeshLambertMaterial({ map: textures.side })  // back
    ];
    
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { blockType: typeId, pos: `${x},${y},${z}` };
    
    return mesh;
}

// ---------- WORLD GENERATION ----------
function generateTerrain() {
    const startX = -Math.floor(RENDER_DISTANCE * CHUNK_SIZE / 2);
    const startZ = -Math.floor(RENDER_DISTANCE * CHUNK_SIZE / 2);
    const endX = startX + RENDER_DISTANCE * CHUNK_SIZE;
    const endZ = startZ + RENDER_DISTANCE * CHUNK_SIZE;
    
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            const height = Math.floor(Math.sin(x * 0.18) * Math.cos(z * 0.18) * 3 + 8);
            
            for (let y = 0; y <= height; y++) {
                let type;
                if (y === 0) type = 6; // Bedrock-ish planks
                else if (y < height - 3) type = 3; // Stone
                else if (y < height) type = 2; // Dirt
                else if (y === height) type = 1; // Grass
                
                if (y === height && Math.random() < 0.15) {
                    // Tree
                    const treeType = Math.random() < 0.5 ? 4 : 5;
                    if (treeType === 4) {
                        for (let ty = 1; ty <= 3; ty++) {
                            world.set(`${x},${y+ty},${z}`, 4);
                        }
                        world.set(`${x},${y+4},${z}`, 5);
                        world.set(`${x+1},${y+4},${z}`, 5);
                        world.set(`${x-1},${y+4},${z}`, 5);
                        world.set(`${x},${y+4},${z+1}`, 5);
                        world.set(`${x},${y+4},${z-1}`, 5);
                    }
                }
                
                world.set(`${x},${y},${z}`, type);
            }
        }
    }
}

// ---------- SCENE SETUP ----------
function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 20, 60);
    
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(8, 12, 8);
    camera.lookAt(0, 8, 0);
    
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x6688cc, 0.7);
    scene.add(ambientLight);
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(50, 80, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 200;
    sunLight.shadow.camera.left = -40;
    sunLight.shadow.camera.right = 40;
    sunLight.shadow.camera.top = 40;
    sunLight.shadow.camera.bottom = -40;
    scene.add(sunLight);
    
    // Ground plane for shadows
    const groundPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshPhongMaterial({ color: 0x3a5a3a, transparent: true, opacity: 0.0 })
    );
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -0.5;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);
    
    clock = new THREE.Clock();
}

// ---------- BUILD WORLD MESHES ----------
function buildWorld() {
    // Clear existing meshes
    while(blockMeshes.length > 0) {
        const mesh = blockMeshes.pop();
        scene.remove(mesh);
    }
    
    world.forEach((type, posKey) => {
        const [x, y, z] = posKey.split(',').map(Number);
        const mesh = createBlockMesh(x, y, z, type);
        scene.add(mesh);
        blockMeshes.push(mesh);
    });
}

// ---------- PLAYER PHYSICS ----------
function updatePlayer(deltaTime) {
    if (!pointerLocked) return;
    
    const moveSpeed = player.speed * deltaTime;
    const direction = new THREE.Vector3();
    
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(direction, camera.up).normalize();
    
    if (keys['KeyW'] || keys['ArrowUp']) camera.position.addScaledVector(direction, moveSpeed);
    if (keys['KeyS'] || keys['ArrowDown']) camera.position.addScaledVector(direction, -moveSpeed);
    if (keys['KeyA'] || keys['ArrowLeft']) camera.position.addScaledVector(right, -moveSpeed);
    if (keys['KeyD'] || keys['ArrowRight']) camera.position.addScaledVector(right, moveSpeed);
    
    // Gravity
    player.yVelocity -= player.gravity * deltaTime;
    camera.position.y += player.yVelocity * deltaTime;
    
    // Simple ground collision
    const footPos = camera.position.clone();
    footPos.y -= player.height;
    
    player.onGround = false;
    const checkPos = camera.position.clone();
    checkPos.y -= player.height + 0.1;
    
    const blockBelow = world.get(`${Math.floor(checkPos.x)},${Math.floor(checkPos.y)},${Math.floor(checkPos.z)}`);
    if (blockBelow) {
        camera.position.y = Math.floor(checkPos.y) + 1 + player.height;
        player.yVelocity = 0;
        player.onGround = true;
    }
    
    // Ceiling check
    const headPos = camera.position.clone();
    headPos.y += 0.1;
    const blockAbove = world.get(`${Math.floor(headPos.x)},${Math.floor(headPos.y)},${Math.floor(headPos.z)}`);
    if (blockAbove && player.yVelocity > 0) {
        player.yVelocity = 0;
        camera.position.y = Math.floor(headPos.y) - 0.1;
    }
    
    // Jump
    if (keys['Space'] && player.onGround) {
        player.yVelocity = player.jumpForce;
        player.onGround = false;
    }
    
    // Clamp to world bounds (prevent falling forever)
    if (camera.position.y < -10) {
        camera.position.set(0, 15, 0);
        player.yVelocity = 0;
    }
}

// ---------- BLOCK INTERACTION ----------
function getLookedBlock() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(blockMeshes);
    if (intersects.length > 0 && intersects[0].distance < 8) {
        return intersects[0];
    }
    return null;
}

function handleMining(deltaTime) {
    const hit = getLookedBlock();
    
    if (hit && keys['MouseLeft'] && pointerLocked) {
        const blockPos = hit.object.position;
        const posKey = `${blockPos.x},${blockPos.y},${blockPos.z}`;
        
        if (miningBlock && miningBlock.posKey === posKey) {
            miningProgress += deltaTime;
            const stage = Math.min(9, Math.floor((miningProgress / MINING_TIME) * 10));
            if (hit.object.material && Array.isArray(hit.object.material)) {
                hit.object.material.forEach(mat => {
                    if (mat.map && !mat.originalMap) mat.originalMap = mat.map;
                    mat.map = destroyTextures[stage];
                    mat.needsUpdate = true;
                });
            }
            
            if (miningProgress >= MINING_TIME) {
                // Destroy block
                world.delete(posKey);
                scene.remove(hit.object);
                const index = blockMeshes.indexOf(hit.object);
                if (index > -1) blockMeshes.splice(index, 1);
                miningBlock = null;
                miningProgress = 0;
            }
        } else {
            // Reset previous mining
            if (miningBlock && miningBlock.mesh) {
                resetBlockTexture(miningBlock.mesh);
            }
            miningBlock = { posKey, mesh: hit.object };
            miningProgress = 0;
        }
    } else {
        if (miningBlock && miningBlock.mesh) {
            resetBlockTexture(miningBlock.mesh);
        }
        miningBlock = null;
        miningProgress = 0;
    }
}

function resetBlockTexture(mesh) {
    if (mesh.material && Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => {
            if (mat.originalMap) {
                mat.map = mat.originalMap;
                mat.needsUpdate = true;
            }
        });
    }
}

function placeBlock() {
    const hit = getLookedBlock();
    if (!hit) return;
    
    const normal = hit.face.normal;
    const placePos = hit.object.position.clone().add(normal);
    
    // Don't place inside player
    const playerPos = camera.position.clone();
    playerPos.y -= player.height / 2;
    if (placePos.distanceTo(playerPos) < 0.8) return;
    
    const posKey = `${placePos.x},${placePos.y},${placePos.z}`;
    if (!world.has(posKey)) {
        world.set(posKey, selectedBlockType);
        const mesh = createBlockMesh(placePos.x, placePos.y, placePos.z, selectedBlockType);
        scene.add(mesh);
        blockMeshes.push(mesh);
    }
}

// ---------- UI UPDATES ----------
function updateHotbar() {
    hotbarSlots.forEach(slot => {
        const blockId = parseInt(slot.dataset.block);
        slot.classList.toggle('selected', blockId === selectedBlockType);
        
        const previewCanvas = slot.querySelector('.hotbar-preview');
        if (previewCanvas && blockTextures[blockId]) {
            const ctx = previewCanvas.getContext('2d');
            const img = blockTextures[blockId].side.image;
            if (img) {
                ctx.clearRect(0, 0, 40, 40);
                ctx.drawImage(img, 0, 0, 40, 40);
            }
        }
    });
    
    blockNameDiv.textContent = blockTypes[selectedBlockType]?.name || 'Unknown';
}

// ---------- EVENT LISTENERS ----------
function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        
        if (e.code === 'KeyM') {
            toggleMusic();
        }
        
        if (e.code >= 'Digit1' && e.code <= 'Digit6') {
            selectedBlockType = parseInt(e.code.replace('Digit', ''));
            updateHotbar();
        }
        
        if (e.code === 'Escape' && pointerLocked) {
            document.exitPointerLock();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });
    
    document.addEventListener('mousedown', (e) => {
        if (!pointerLocked || !gameStarted) return;
        
        if (e.button === 0) {
            keys['MouseLeft'] = true;
        }
        if (e.button === 2) {
            placeBlock();
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            keys['MouseLeft'] = false;
        }
    });
    
    document.addEventListener('wheel', (e) => {
        if (!pointerLocked) return;
        e.preventDefault();
        if (e.deltaY > 0) {
            selectedBlockType = selectedBlockType === 6 ? 1 : selectedBlockType + 1;
        } else {
            selectedBlockType = selectedBlockType === 1 ? 6 : selectedBlockType - 1;
        }
        updateHotbar();
    }, { passive: false });
    
    canvas.addEventListener('click', () => {
        if (!gameStarted) {
            gameStarted = true;
            instructionsDiv.style.opacity = '0';
            setTimeout(() => { instructionsDiv.style.display = 'none'; }, 800);
            if (!musicPlaying) {
                toggleMusic();
            }
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
            setTimeout(() => { instructionsDiv.style.display = 'none'; }, 800);
        }
    });
    
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    hotbarSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            selectedBlockType = parseInt(slot.dataset.block);
            updateHotbar();
        });
    });
    
    musicToggle.addEventListener('click', toggleMusic);
}

function toggleMusic() {
    if (musicPlaying) {
        audio.pause();
        musicToggle.textContent = '🔇';
        musicPlaying = false;
    } else {
        audio.play().catch(e => console.log('Audio play failed:', e));
        musicToggle.textContent = '🔊';
        musicPlaying = true;
    }
}

// ---------- GAME LOOP ----------
function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = Math.min(clock.getDelta(), 0.1);
    
    updatePlayer(deltaTime);
    handleMining(deltaTime);
    
    renderer.render(scene, camera);
}

// ---------- INITIALIZATION ----------
generateTerrain();
initScene();
buildWorld();
setupEvents();
updateHotbar();
animate();

console.log('🌍 MiniCraft ready! Click to start.');

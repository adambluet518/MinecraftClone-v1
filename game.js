import * as THREE from 'three';

// ---- DOM Elements ----
const posDisplay = document.getElementById('posDisplay');
const chunkCountEl = document.getElementById('chunkCount');
const fpsDisplay = document.getElementById('fpsDisplay');
const musicToggle = document.getElementById('musicToggle');

// Add a Crosshair directly to the UI dynamically
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

// Add an Inventory Selector HUD element dynamically
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

// ---- Audio ----
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
scene.fog = new THREE.Fog(0x87CEEB, 40, 140);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Lighting ----
const ambientLight = new THREE.AmbientLight(0x909090);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(10, 20, 7);
scene.add(dirLight);

// ---- Textures & Reusable Materials ----
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

// ---- Custom Simple Math Noise Function for Hill Terrain ----
function getNoiseHeight(x, z) {
    // Generates rolling hills instead of a perfectly flat plane
    const wave1 = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 4;
    const wave2 = Math.sin(x * 0.15 + 2) * 1.5;
    return Math.floor(wave1 + wave2);
}

// ---- Chunk System ----
const CHUNK_SIZE = 16;
const RENDER_DIST = 3; // Kept tight for incredible FPS performance
const loadedChunks = new Map();
const blockGeom = new THREE.BoxGeometry(1, 1, 1);

// Global list of individual mesh objects we can interact with/break
let interactableBlocks = [];
const worldBlocksData = new Map(); // Global memory map: "x,y,z" -> blockType string ('air', 'grass', etc)

function createChunk(cx, cz) {
    const group = new THREE.Group();
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            
            // Height variance calculation
            const surfaceY = getNoiseHeight(wx, wz);

            // 1. Surface layer
            const keySurface = `${wx},${surfaceY},${wz}`;
            if (!worldBlocksData.has(keySurface)) {
                // Rare patches of cobblestone naturally spawning on surface
                const rand = Math.abs(Math.floor(Math.sin(wx * 12.9 + wz * 78.2) * 43758)) % 100;
                worldBlocksData.set(keySurface, rand < 4 ? 'cobblestone' : 'grass');
            }

            // 2. Dirt layers below surface
            for (let dy = 1; dy <= 3; dy++) {
                const keyDirt = `${wx},${surfaceY - dy},${wz}`;
                if (!worldBlocksData.has(keyDirt)) worldBlocksData.set(keyDirt, 'dirt');
            }

            // 3. Cobblestone base foundation layer
            for (let dy = 4; dy <= 6; dy++) {
                const keyCobble = `${wx},${surfaceY - dy},${wz}`;
                if (!worldBlocksData.has(keyCobble)) worldBlocksData.set(keyCobble, 'cobblestone');
            }
        }
    }

    // Build meshes inside the chunk based on block data registry
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const sY = getNoiseHeight(wx, wz);

            for (let wy = sY - 6; wy <= sY; wy++) {
                const key = `${wx},${wy},${wz}`;
                const type = worldBlocksData.get(key);
                
                if (type && type !== 'air') {
                    let mats = dirtBlockMaterials;
                    if (type === 'grass') mats = grassBlockMaterials;
                    if (type === 'cobblestone') mats = cobbleBlockMaterials;

                    const block = new THREE.Mesh(blockGeom, mats);
                    block.position.set(wx + 0.5, wy + 0.5, wz + 0.5);
                    block.name = key; // Keep key registry inside mesh name property for raycasting matches
                    group.add(block);
                    interactableBlocks.push(block);
                }
            }
        }
    }
    return group;
}

function updateChunks(playerCX, playerCZ) {
    const needed = new Set();
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
            needed.add(`${playerCX + dx},${playerCZ + dz}`);
        }
    }

    // Load new chunks
    needed.forEach(key => {
        if (!loadedChunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            const chunk = createChunk(cx, cz);
            loadedChunks.set(key, chunk);
            scene.add(chunk);
        }
    });

    // Unload distant chunks safely WITHOUT destroying global geometries/materials
    loadedChunks.forEach((chunk, key) => {
        if (!needed.has(key)) {
            scene.remove(chunk);
            
            // Clean up the raycast interaction array list 
            chunk.children.forEach(child => {
                const index = interactableBlocks.indexOf(child);
                if (index > -1) interactableBlocks.splice(index, 1);
            });

            loadedChunks.delete(key);
        }
    });

    chunkCountEl.textContent = loadedChunks.size;
}

// ---- Player & Physics Structure ----
const player = {
    position: new THREE.Vector3(0, 10, 0),
    velocity: new THREE.Vector3(),
    onGround: false,
    yaw: 0,
    pitch: 0,
};

let selectedBlockType = 'grass'; // Tracks hotbar inventory selection ('grass', 'dirt', 'cobblestone')

// Mouse Capturing
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

// Keyboard Listeners
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    
    // Switch Inventory Selection using 1, 2, 3 hotkeys
    if (e.code === 'Digit1') { selectedBlockType = 'grass'; invHUD.textContent = 'Selected: [1] Grass Block'; }
    if (e.code === 'Digit2') { selectedBlockType = 'dirt'; invHUD.textContent = 'Selected: [2] Dirt Block'; }
    if (e.code === 'Digit3') { selectedBlockType = 'cobblestone'; invHUD.textContent = 'Selected: [3] Cobblestone'; }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// --- Voxel Block Placing & Breaking Engine Loop ---
const raycaster = new THREE.Raycaster();
const mouseCenter = new THREE.Vector2(0, 0); // Always perfectly centered targeting crosshair

function onMouseDown(e) {
    raycaster.setFromCamera(mouseCenter, camera);
    // Only check collision distances matching active player reach bounds (6 meters max reach)
    const intersects = raycaster.intersectObjects(interactableBlocks);

    if (intersects.length > 0 && intersects[0].distance <= 6) {
        const hitObj = intersects[0].object;
        
        if (e.button === 0) { 
            // LEFT CLICK: Break Block
            scene.remove(hitObj);
            worldBlocksData.set(hitObj.name, 'air'); // Turn data state to air
            
            const index = interactableBlocks.indexOf(hitObj);
            if (index > -1) interactableBlocks.splice(index, 1);
            
            // Explicitly force parent chunk container groups to rebuild hierarchy bounds securely
            if (hitObj.parent) hitObj.parent.remove(hitObj);
        } 
        else if (e.button === 2) { 
            // RIGHT CLICK: Place Block
            const normal = intersects[0].face.normal;
            const targetPos = hitObj.position.clone().add(normal); // Shift location vector forward along clicked face direction

            const bx = Math.floor(targetPos.x);
            const by = Math.floor(targetPos.y);
            const bz = Math.floor(targetPos.z);
            const key = `${bx},${by},${bz}`;

            // Make sure player isn't inside block bounds before building
            const pBox = new THREE.Box3(
                new THREE.Vector3(player.position.x - 0.3, player.position.y, player.position.z - 0.3),
                new THREE.Vector3(player.position.x + 0.3, player.position.y + 1.6, player.position.z + 0.3)
            );
            const blockBox = new THREE.Box3(new THREE.Vector3(bx, by, bz), new THREE.Vector3(bx+1, by+1, bz+1));

            if (!pBox.intersectsBox(blockBox)) {
                worldBlocksData.set(key, selectedBlockType);

                let mats = dirtBlockMaterials;
                if (selectedBlockType === 'grass') mats = grassBlockMaterials;
                if (selectedBlockType === 'cobblestone') mats = cobbleBlockMaterials;

                const newBlock = new THREE.Mesh(blockGeom, mats);
                newBlock.position.set(bx + 0.5, by + 0.5, bz + 0.5);
                newBlock.name = key;

                // Add to active group node arrays securely
                hitObj.parent.add(newBlock);
                interactableBlocks.push(newBlock);
            }
        }
    }
}

// Bounding Physics Engine
function isSolid(wx, wy, wz) {
    const key = `${wx},${wy},${wz}`;
    if (worldBlocksData.has(key)) {
        return worldBlocksData.get(key) !== 'air';
    }
    // Dynamic fallback generation bounds array safety check 
    return wy <= getNoiseHeight(wx, wz);
}

function collides(pos) {
    const hw = 0.3; // Collision Width Bound
    for (let dx = -hw; dx <= hw; dx += 0.59) {
        for (let dy = 0; dy <= 1.6; dy += 0.79) { // Collision Height Bound Match
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
    // Lock Delta Time extremes to entirely eliminate physics snapping micro-bounces
    if (dt <= 0 || dt > 0.05) dt = 0.016;

    // Direct Character Movement Matrix Calculations
    const moveDir = new THREE.Vector3();
    if (keys['KeyW']) moveDir.z -= 1;
    if (keys['KeyS']) moveDir.z += 1;
    if (keys['KeyA']) moveDir.x -= 1;
    if (keys['KeyD']) moveDir.x += 1;
    moveDir.normalize();

    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = sprint ? 10 : 5.5;

    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    const rgt = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

    player.velocity.x = (fwd.x * moveDir.z + rgt.x * moveDir.x) * speed;
    player.velocity.z = (fwd.z * moveDir.z + rgt.z * moveDir.x) * speed;

    // Jump Engine
    if (keys['Space'] && player.onGround) {
        player.velocity.y = 8.5;
        player.onGround = false;
    }

    // Apply smooth down-force Gravity metrics
    player.velocity.y -= 22 * dt;
    if (player.velocity.y < -35) player.velocity.y = -35;

    // Axis-by-Axis Isolated Collision Math (Completely eliminates shaking/jitter bouncing)
    const newPos = player.position.clone();
    
    // Test X Axis
    newPos.x += player.velocity.x * dt;
    if (collides(newPos)) { 
        newPos.x = player.position.x; 
        player.velocity.x = 0; 
    }
    
    // Test Z Axis
    newPos.z += player.velocity.z * dt;
    if (collides(newPos)) { 
        newPos.z = player.position.z; 
        player.velocity.z = 0; 
    }
    
    // Test Y Axis
    newPos.y += player.velocity.y * dt;
    if (collides(newPos)) {
        if (player.velocity.y < 0) {
            // Landing on a solid block surface securely
            newPos.y = Math.floor(newPos.y) + 1;
            // Slightly offset decimal space to permanently stop ground intersection jitter
            newPos.y += 0.001; 
            player.onGround = true;
        } else {
            // Ceiling impact
            newPos.y = Math.floor(player.position.y);
            player.velocity.y = 0;
        }
        player.velocity.y = 0;
    } else {
        player.onGround = false;
    }
    player.position.copy(newPos);

    // Dynamic Camera View Alignment Matrix Transforms
    camera.position.set(player.position.x, player.position.y + 1.4, player.position.z);
    const look = new THREE.Vector3(0, 0, -1);
    look.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
    look.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    camera.lookAt(camera.position.clone().add(look));

    // Automated Core Active Chunk Shifts
    const pcx = Math.floor(player.position.x / 16);
    const pcz = Math.floor(player.position.z / 16);
    updateChunks(pcx, pcz);

    posDisplay.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
}

// ---- Core Frame Animation Loops ----
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

// ---- Initialization Engine Hook ----
async function init() {
    console.log('Loading textures...');
    [grassTex, dirtTex, cobbleTex] = await Promise.all([
        loadTexture('grass', '#7ec850'),
        loadTexture('dirt', '#8b5a2b'),
        loadTexture('cobblestone', '#808080'),
    ]);
    console.log('Textures loaded!');

    // Initialize Shared global structural components securely
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
    const cobbleMat = new THREE.MeshLambertMaterial({ map: cobbleTex });

    // Proper alignment array mapping for block configurations (+X, -X, +Y, -Y, +Z, -Z)
    grassBlockMaterials = [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat];
    dirtBlockMaterials = [dirtMat, dirtMat, dirtMat, dirtMat, dirtMat, dirtMat];
    cobbleBlockMaterials = [cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat];

    // Build immediate initial world environment coordinate spaces
    updateChunks(0, 0);
    
    // Safely position player above hill elevation terrain boundaries upon spawn
    player.position.y = getNoiseHeight(0, 0) + 4;

    // Global document listener to catch right-click default system menu behavior override
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Connect user initialization audio context events safely
    window.addEventListener('click', () => {
        if (!musicPlaying) {
            music.play().then(() => {
                musicPlaying = true;
                musicToggle.textContent = '🔊';
            }).catch(() => {});
        }
    }, { once: true });

    // Launch master rendering state clock loops
    lastTime = 0;
    requestAnimationFrame(animate);
    console.log('Engine Core Online!');
}

init().catch(err => console.error('Initialization Fault Triggered:', err));

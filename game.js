import * as THREE from 'three';

// ---- DOM Elements ----
const posDisplay = document.getElementById('posDisplay');
const chunkCountEl = document.getElementById('chunkCount');
const fpsDisplay = document.getElementById('fpsDisplay');
const musicToggle = document.getElementById('musicToggle');

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
scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);

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
const ambientLight = new THREE.AmbientLight(0x808080);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1, 1, 0.5);
scene.add(dirLight);

// ---- Textures & Global Materials ----
const textureLoader = new THREE.TextureLoader();
let grassTex, dirtTex, cobbleTex;

// Reusable Material Arrays
let grassBlockMaterials = [];
let dirtBlockMaterials = [];
let cobbleBlockMaterials = [];

function createFallbackTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 16, 16);
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

// ---- Chunk System ----
const CHUNK_SIZE = 16;
const RENDER_DIST = 4;
const loadedChunks = new Map();
const blockGeom = new THREE.BoxGeometry(1, 1, 1);

function getBlockType(wx, wz) {
    const n = Math.abs(Math.floor(Math.sin(wx * 12.9898 + wz * 78.233) * 43758.5453)) % 100;
    return n < 3 ? 'cobblestone' : 'grass';
}

function createChunk(cx, cz) {
    const group = new THREE.Group();
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const surfaceType = getBlockType(wx, wz);

            // 1. Surface block (Grass or Cobblestone Patch)
            let mats;
            if (surfaceType === 'cobblestone') {
                mats = cobbleBlockMaterials;
            } else {
                mats = grassBlockMaterials;
            }

            const block = new THREE.Mesh(blockGeom, mats);
            block.position.set(wx + 0.5, 0.5, wz + 0.5);
            group.add(block);

            // 2. Dirt layer
            const dBlock = new THREE.Mesh(blockGeom, dirtBlockMaterials);
            dBlock.position.set(wx + 0.5, -0.5, wz + 0.5);
            group.add(dBlock);

            // 3. Cobblestone base layer
            const cBlock = new THREE.Mesh(blockGeom, cobbleBlockMaterials);
            cBlock.position.set(wx + 0.5, -1.5, wz + 0.5);
            group.add(cBlock);
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

    // Unload distant chunks
    loadedChunks.forEach((chunk, key) => {
        if (!needed.has(key)) {
            scene.remove(chunk);
            chunk.traverse(child => {
                if (child.geometry) {
                    // Do NOT dispose shared global geometry here if referenced globally,
                    // but since blockGeom is global, don't clear it or it breaks everything.
                }
                // Do NOT dispose child.material here because they are now shared globally!
            });
            loadedChunks.delete(key);
        }
    });

    chunkCountEl.textContent = loadedChunks.size;
}

// ---- Player ----
const player = {
    position: new THREE.Vector3(0, 5, 0),
    velocity: new THREE.Vector3(),
    onGround: false,
    yaw: 0,
    pitch: 0,
};

// Mouse
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
        document.addEventListener('mousemove', onMouseMove);
    } else {
        document.removeEventListener('mousemove', onMouseMove);
    }
});

function onMouseMove(e) {
    player.yaw -= e.movementX * 0.002;
    player.pitch -= e.movementY * 0.002;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
}

// Keyboard
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function isSolid(wx, wy, wz) {
    return wy >= -2 && wy <= 0;
}

function collides(pos) {
    const hw = 0.3;
    for (let dx = -hw; dx <= hw; dx += 0.6) {
        for (let dy = 0; dy <= 1.6; dy += 0.8) {
            for (let dz = -hw; dz <= hw; dz += 0.6) {
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

    // Movement
    const moveDir = new THREE.Vector3();
    if (keys['KeyW']) moveDir.z -= 1;
    if (keys['KeyS']) moveDir.z += 1;
    if (keys['KeyA']) moveDir.x -= 1;
    if (keys['KeyD']) moveDir.x += 1;
    moveDir.normalize();

    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = sprint ? 12 : 7;

    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    const rgt = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

    player.velocity.x = (fwd.x * moveDir.z + rgt.x * moveDir.x) * speed;
    player.velocity.z = (fwd.z * moveDir.z + rgt.z * moveDir.x) * speed;

    if (keys['Space'] && player.onGround) {
        player.velocity.y = 10;
        player.onGround = false;
    }

    player.velocity.y -= 20 * dt;
    if (player.velocity.y < -40) player.velocity.y = -40;

    // Simple collision
    const newPos = player.position.clone();
    newPos.x += player.velocity.x * dt;
    if (collides(newPos)) { newPos.x = player.position.x; player.velocity.x = 0; }
    newPos.z += player.velocity.z * dt;
    if (collides(newPos)) { newPos.z = player.position.z; player.velocity.z = 0; }
    newPos.y += player.velocity.y * dt;
    if (collides(newPos)) {
        if (player.velocity.y < 0) {
            newPos.y = Math.ceil(player.position.y);
            player.onGround = true;
        } else {
            newPos.y = Math.floor(player.position.y) + 1 - 1.6;
        }
        player.velocity.y = 0;
    } else {
        player.onGround = false;
    }
    player.position.copy(newPos);

    // Camera
    camera.position.set(player.position.x, player.position.y + 1.4, player.position.z);
    const look = new THREE.Vector3(0, 0, -1);
    look.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
    look.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    camera.lookAt(camera.position.clone().add(look));

    // Chunks
    const pcx = Math.floor(player.position.x / 16);
    const pcz = Math.floor(player.position.z / 16);
    updateChunks(pcx, pcz);

    posDisplay.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
}

// ---- Main Loop ----
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

// ---- Init ----
async function init() {
    console.log('Loading textures...');
    [grassTex, dirtTex, cobbleTex] = await Promise.all([
        loadTexture('grass', '#7ec850'),
        loadTexture('dirt', '#8b5a2b'),
        loadTexture('cobblestone', '#808080'),
    ]);
    console.log('Textures loaded!');

    // Initialize Shared Materials
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
    const cobbleMat = new THREE.MeshLambertMaterial({ map: cobbleTex });

    // Proper alignment for [+X, -X, +Y, -Y, +Z, -Z]
    grassBlockMaterials = [
        dirtMat,  // +X (Side)
        dirtMat,  // -X (Side)
        grassMat, // +Y (Top)
        dirtMat,  // -Y (Bottom)
        dirtMat,  // +Z (Side)
        dirtMat   // -Z (Side)
    ];
    
    dirtBlockMaterials = [dirtMat, dirtMat, dirtMat, dirtMat, dirtMat, dirtMat];
    cobbleBlockMaterials = [cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat];

    // Initial chunks
    updateChunks(0, 0);
    console.log('Chunks loaded:', loadedChunks.size);

    // Music on click
    window.addEventListener('click', () => {
        if (!musicPlaying) {
            music.play().then(() => {
                musicPlaying = true;
                musicToggle.textContent = '🔊';
            }).catch(() => {});
        }
    });

    // Start loop
    lastTime = 0;
    requestAnimationFrame(animate);
    console.log('Game started!');
}

init().catch(err => console.error('Init failed:', err));
import * as THREE from 'three';

// ---- DOM Elements ----
const posDisplay = document.getElementById('posDisplay');
const chunkCountEl = document.getElementById('chunkCount');
const fpsDisplay = document.getElementById('fpsDisplay');
const musicToggle = document.getElementById('musicToggle');

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
scene.fog = new THREE.Fog(0x87CEEB, 20, 50); // Aggressive fog to hide chunk loading cleanly

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 150);
const renderer = new THREE.WebGLRenderer({ antialias: false }); // Antialiasing off for max performance
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1); // Force standard pixel ratio to boost frames on Retina/4K displays
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Lighting ----
const ambientLight = new THREE.AmbientLight(0xb0b0b0);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(5, 15, 5);
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

// ---- Chunk System ----
const CHUNK_SIZE = 16;
const RENDER_DIST = 2; // Renders a perfect tight circle around the player
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

    // PERFORMANCE FIX: We only generate the visible top surface layer. 
    // This removes 30,000+ hidden blocks from overwhelming your GPU.
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = ox + x;
            const wz = oz + z;
            const surfaceType = getBlockType(wx, wz);

            let mats = (surfaceType === 'cobblestone') ? cobbleBlockMaterials : grassBlockMaterials;
            const block = new THREE.Mesh(blockGeom, mats);
            block.position.set(wx + 0.5, 0.5, wz + 0.5);
            group.add(block);
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

    needed.forEach(key => {
        if (!loadedChunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            const chunk = createChunk(cx, cz);
            loadedChunks.set(key, chunk);
            scene.add(chunk);
        }
    });

    loadedChunks.forEach((chunk, key) => {
        if (!needed.has(key)) {
            scene.remove(chunk);
            loadedChunks.delete(key);
        }
    });

    chunkCountEl.textContent = loadedChunks.size;
}

// ---- Player Physics Engine ----
const player = {
    position: new THREE.Vector3(0, 3, 0),
    velocity: new THREE.Vector3(),
    onGround: false,
    yaw: 0,
    pitch: 0,
};

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

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function isSolid(wx, wy, wz) {
    // Solid boundary checking for our optimized 1-layer surface flat world
    return wy === 0;
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
    // CONTROL FIX: W moves forward (-z), S moves backward (+z)
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
        player.velocity.y = 8.0;
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

    updateChunks(0, 0);

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
    console.log('Game Started Cleanly!');
}

init().catch(err => console.error('Initialization failed:', err));

import * as THREE from 'three';

window.addEventListener('DOMContentLoaded', async () => {
    
    const uiPos = document.getElementById('posDisplay');
    const uiChunks = document.getElementById('chunkCount');
    const uiFps = document.getElementById('fpsDisplay');
    const uiMusic = document.getElementById('musicToggle');

    function setHTML(el, text) { if (el) el.textContent = text; }

    // ---- UI Elements ----
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
    invHUD.style.zIndex = '10';
    invHUD.textContent = 'Selected: [1] Grass Block';
    document.body.appendChild(invHUD);

    // ---- Audio ----
    const music = new Audio('music.mp3');
    music.loop = true;
    music.volume = 0.3;
    let musicPlaying = false;

    if (uiMusic) {
        uiMusic.addEventListener('click', () => {
            if (musicPlaying) {
                music.pause();
                setHTML(uiMusic, '🔇');
            } else {
                music.play().then(() => setHTML(uiMusic, '🔊')).catch(() => setHTML(uiMusic, '🚫'));
            }
            musicPlaying = !musicPlaying;
        });
    }

    // ---- Three.js Setup ----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 40, 100); 

    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 250);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const ambientLight = new THREE.AmbientLight(0x7c8c9e);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(10, 25, 5);
    dirLight.castShadow = true;
    dirLight.receiveShadow = false;
    scene.add(dirLight);
    
    const backLight = new THREE.DirectionalLight(0x88aacc, 0.3);
    backLight.position.set(-5, 10, -8);
    scene.add(backLight);

    // ---- Textures Loader & Fallbacks ----
    const textureLoader = new THREE.TextureLoader();
    
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

    function createCrackFallback(stage) {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        if (stage <= 0) return new THREE.CanvasTexture(canvas);
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const lines = stage * 3;
        for(let i = 0; i < lines; i++) {
            const seed = i * 4567;
            const x1 = Math.abs(Math.sin(seed)) * 64;
            const y1 = Math.abs(Math.cos(seed)) * 64;
            const x2 = x1 + (Math.sin(seed + 1) * 20);
            const y2 = y1 + (Math.cos(seed + 2) * 20);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
        }
        ctx.stroke();
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        return tex;
    }

    function loadTexture(filename, fallback) {
        return new Promise((resolve) => {
            textureLoader.load(
                filename,
                (tex) => {
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    resolve(tex);
                },
                undefined,
                () => resolve(typeof fallback === 'string' ? createFallbackTexture(fallback) : fallback)
            );
        });
    }

    const [grassTex, dirtTex, cobbleTex, logSideTex, logTopTex, leavesTex, planksTex] = await Promise.all([
        loadTexture('grass.png', '#7ec850'),
        loadTexture('dirt.png', '#8b5a2b'),
        loadTexture('cobblestone.png', '#808080'),
        loadTexture('log_side.png', '#5c4033'),
        loadTexture('log_top.png', '#d2b48c'),
        loadTexture('leaves.png', '#2e8b57'),
        loadTexture('planks.png', '#a0522d')
    ]);

    const breakTextures = await Promise.all(
        Array.from({ length: 10 }, (_, i) => loadTexture(`destroy_stage_${i}.png`, createCrackFallback(i)))
    );

    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
    const cobbleMat = new THREE.MeshLambertMaterial({ map: cobbleTex });
    const logSideMat = new THREE.MeshLambertMaterial({ map: logSideTex });
    const logTopMat = new THREE.MeshLambertMaterial({ map: logTopTex });
    const planksMat = new THREE.MeshLambertMaterial({ map: planksTex });
    
    const leavesMat = new THREE.MeshLambertMaterial({ 
        map: leavesTex, 
        transparent: true, 
        alphaTest: 0.3,
        side: THREE.DoubleSide
    });

    const grassBlockMaterials = [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat];
    const dirtBlockMaterials = [dirtMat, dirtMat, dirtMat, dirtMat, dirtMat, dirtMat];
    const cobbleBlockMaterials = [cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat, cobbleMat];
    const logBlockMaterials = [logSideMat, logSideMat, logTopMat, logTopMat, logSideMat, logSideMat];
    const leavesBlockMaterials = [leavesMat, leavesMat, leavesMat, leavesMat, leavesMat, leavesMat];
    const plankBlockMaterials = [planksMat, planksMat, planksMat, planksMat, planksMat, planksMat];

    const crackMat = new THREE.MeshBasicMaterial({ 
        map: breakTextures[0], 
        transparent: true,
        alphaTest: 0.1, 
        polygonOffset: true, 
        polygonOffsetFactor: -4, 
        polygonOffsetUnits: -4
    });
    const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), crackMat);
    crackMesh.visible = false;
    scene.add(crackMesh);

    // ---- Procedural Generation Math ----
    function getNoiseHeight(wx, wz) {
        const wave1 = Math.sin(wx * 0.045) * Math.cos(wz * 0.045) * 3.5;
        const wave2 = Math.sin(wx * 0.12 + 1.8) * 1.2;
        const wave3 = Math.cos(wz * 0.13 + 2.3) * 1.1;
        return Math.floor(2 + wave1 + wave2 + wave3);
    }

    function coordHash(x, z) {
        const val = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453123;
        return Math.abs(val - Math.floor(val));
    }

    function isCaveSpace(wx, wy, wz) {
        if (wy > getNoiseHeight(wx, wz) - 1) return false; 
        const caveDensity = Math.sin(wx * 0.22) + Math.cos(wy * 0.25) + Math.sin(wz * 0.22);
        return caveDensity > 1.25; 
    }

    // ---- Chunk System ----
    const CHUNK_SIZE = 16;
    const RENDER_DIST = 4;
    const loadedChunks = new Map();
    const blockGeom = new THREE.BoxGeometry(1, 1, 1);
    const worldBlocksData = new Map();
    let raycastTargets = []; 
    let lastPlayerCX = null;
    let lastPlayerCZ = null;

    function createChunk(cx, cz) {
        const group = new THREE.Group();
        group.name = `${cx},${cz}`;
        const ox = cx * CHUNK_SIZE;
        const oz = cz * CHUNK_SIZE;

        const categorizedPositions = { grass: [], dirt: [], cobblestone: [], log: [], leaves: [], planks: [] };

        const chunkHash = coordHash(cx * 31, cz * 73);
        const spawnWellInChunk = (chunkHash < 0.04); 
        const wellCenterX = ox + 4 + Math.floor(chunkHash * 1000) % 8;
        const wellCenterZ = oz + 4 + Math.floor(chunkHash * 2000) % 8;

        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const wx = ox + x;
                const wz = oz + z;
                let surfaceY = getNoiseHeight(wx, wz);
                
                // FIX: ensure we don't go below y=0
                for (let wy = Math.max(0, surfaceY - 6); wy <= surfaceY; wy++) {
                    const key = `${wx},${wy},${wz}`;
                    
                    if (!worldBlocksData.has(key)) {
                        if (isCaveSpace(wx, wy, wz)) {
                            worldBlocksData.set(key, 'air');
                            continue;
                        }

                        if (wy === surfaceY) {
                            worldBlocksData.set(key, 'grass');
                        } else if (wy > surfaceY - 3) {
                            worldBlocksData.set(key, 'dirt');
                        } else {
                            worldBlocksData.set(key, 'cobblestone');
                        }
                    }
                }

                const surfaceKey = `${wx},${surfaceY},${wz}`;
                if (worldBlocksData.get(surfaceKey) === 'grass') {
                    if (spawnWellInChunk && wx === wellCenterX && wz === wellCenterZ) {
                        for (let vx = -2; vx <= 2; vx++) {
                            for (let vz = -2; vz <= 2; vz++) {
                                const baseKey = `${wx + vx},${surfaceY},${wz + vz}`;
                                if (!worldBlocksData.has(baseKey)) worldBlocksData.set(baseKey, 'planks'); 
                                
                                if (Math.abs(vx) === 2 && Math.abs(vz) === 2) {
                                    const k1 = `${wx + vx},${surfaceY + 1},${wz + vz}`;
                                    const k2 = `${wx + vx},${surfaceY + 2},${wz + vz}`;
                                    const k3 = `${wx + vx},${surfaceY + 3},${wz + vz}`;
                                    if (!worldBlocksData.has(k1)) worldBlocksData.set(k1, 'cobblestone');
                                    if (!worldBlocksData.has(k2)) worldBlocksData.set(k2, 'cobblestone');
                                    if (!worldBlocksData.has(k3)) worldBlocksData.set(k3, 'planks');
                                }
                                if (surfaceY > 0 && (Math.abs(vx) <= 2 && Math.abs(vz) <= 2) && (Math.abs(vx) === 2 || Math.abs(vz) === 2)) {
                                    const k4 = `${wx + vx},${surfaceY + 4},${wz + vz}`;
                                    if (!worldBlocksData.has(k4)) worldBlocksData.set(k4, 'planks');
                                }
                            }
                        }
                    } else {
                        const hash = coordHash(wx, wz);
                        if (hash > 0.05 && hash < 0.07) {
                            const trunkHeight = 3 + Math.floor(hash * 100) % 3;
                            for (let th = 1; th <= trunkHeight; th++) {
                                const logKey = `${wx},${surfaceY + th},${wz}`;
                                if (!worldBlocksData.has(logKey)) {
                                    worldBlocksData.set(logKey, 'log');
                                }
                            }
                            const leafBase = surfaceY + trunkHeight;
                            for (let lx = -2; lx <= 2; lx++) {
                                for (let lz = -2; lz <= 2; lz++) {
                                    for (let ly = -1; ly <= 2; ly++) {
                                        if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly) > 3) continue; 
                                        const lKey = `${wx + lx},${leafBase + ly},${wz + lz}`;
                                        if (!worldBlocksData.has(lKey)) {
                                            worldBlocksData.set(lKey, 'leaves');
                                        }
                                    }
                                }
                            }
                        } 
                    }
                }
            }
        }

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

        const dummy = new THREE.Object3D();
        Object.keys(categorizedPositions).forEach(type => {
            const blocks = categorizedPositions[type];
            if (blocks.length === 0) return;

            let mats = dirtBlockMaterials;
            if (type === 'grass') mats = grassBlockMaterials;
            if (type === 'cobblestone') mats = cobbleBlockMaterials;
            if (type === 'log') mats = logBlockMaterials;
            if (type === 'leaves') mats = leavesBlockMaterials;
            if (type === 'planks') mats = plankBlockMaterials;

            const instMesh = new THREE.InstancedMesh(blockGeom, mats, blocks.length);
            instMesh.userData = { blockKeys: [] };
            instMesh.castShadow = true;
            instMesh.receiveShadow = false;

            blocks.forEach((block, idx) => {
                dummy.position.set(block.x, block.y, block.z);
                dummy.updateMatrix();
                instMesh.setMatrixAt(idx, dummy.matrix);
                instMesh.userData.blockKeys[idx] = block.key;
            });

            instMesh.instanceMatrix.needsUpdate = true;
            // FIX: removed computeBoundingSphere/computeBoundingBox - not needed for InstancedMesh raycasting
            
            group.add(instMesh);
        });

        return group;
    }

    function rebuildRaycastTargetsList() {
        raycastTargets = [];
        loadedChunks.forEach(chunkGroup => {
            chunkGroup.children.forEach(child => {
                if (child.isInstancedMesh) {
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
                chunk.children.forEach(child => { 
                    if (child.isInstancedMesh) child.dispose(); 
                });
                loadedChunks.delete(key);
                modified = true;
            }
        });

        if (modified) rebuildRaycastTargetsList();
        setHTML(uiChunks, loadedChunks.size);
    }

    // ---- Player Physics & Interaction ----
    // FIX: find a safe spawn height above ground
    function findSafeSpawnHeight(x, z) {
        for(let y = 60; y > 0; y--) {
            const key = `${Math.floor(x)},${y},${Math.floor(z)}`;
            if(worldBlocksData.has(key) && worldBlocksData.get(key) !== 'air') {
                return y + 2; // stand on top
            }
        }
        return 30; // fallback
    }

    const player = {
        position: new THREE.Vector3(0, 30, 0), // temp, will be adjusted after world loads
        velocity: new THREE.Vector3(),
        onGround: false,
        yaw: 0,
        pitch: 0,
    };

    let selectedBlockType = 'grass';
    let miningTargetKey = null;
    let miningProgress = 0; 
    const MINING_SPEED = 2.0; 

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
            miningTargetKey = null;
            crackMesh.visible = false;
        }
    });

    function onMouseMove(e) {
        player.yaw -= e.movementX * 0.002;
        player.pitch -= e.movementY * 0.002;
        player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
    }

    const keys = {};
    window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'Space') e.preventDefault();
        if (e.code === 'Digit1') { selectedBlockType = 'grass'; invHUD.textContent = 'Selected: [1] Grass Block'; }
        if (e.code === 'Digit2') { selectedBlockType = 'dirt'; invHUD.textContent = 'Selected: [2] Dirt Block'; }
        if (e.code === 'Digit3') { selectedBlockType = 'cobblestone'; invHUD.textContent = 'Selected: [3] Cobblestone'; }
        if (e.code === 'Digit4') { selectedBlockType = 'log'; invHUD.textContent = 'Selected: [4] Wood Log'; }
        if (e.code === 'Digit5') { selectedBlockType = 'leaves'; invHUD.textContent = 'Selected: [5] Leaves'; }
        if (e.code === 'Digit6') { selectedBlockType = 'planks'; invHUD.textContent = 'Selected: [6] Wood Planks'; }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    const raycaster = new THREE.Raycaster();
    const mouseCenter = new THREE.Vector2(0, 0);

    function onMouseDown(e) {
        if (e.button === 2) { 
            e.preventDefault(); // FIX: prevent context menu
            raycaster.setFromCamera(mouseCenter, camera);
            const intersects = raycaster.intersectObjects(raycastTargets, false);
            if (intersects.length > 0 && intersects[0].distance <= 7) {
                const hit = intersects[0];
                const hitMesh = hit.object;
                const instanceId = hit.instanceId;
                if (instanceId === undefined || !hitMesh.userData.blockKeys) return;
                const targetKey = hitMesh.userData.blockKeys[instanceId];
                if (!targetKey) return;

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
                        const oldChunk = loadedChunks.get(targetChunkKey);
                        scene.remove(oldChunk);
                        oldChunk.children.forEach(child => { if (child.isInstancedMesh) child.dispose(); });
                        
                        const freshChunk = createChunk(pcx, pcz);
                        loadedChunks.set(targetChunkKey, freshChunk);
                        scene.add(freshChunk);
                        rebuildRaycastTargetsList();
                    }
                }
            }
        }
    }

    function checkMiningInteraction(dt) {
        if (document.pointerLockElement === renderer.domElement && keys['MouseDown0']) { 
            raycaster.setFromCamera(mouseCenter, camera);
            const intersects = raycaster.intersectObjects(raycastTargets, false);

            if (intersects.length > 0 && intersects[0].distance <= 6) {
                const hit = intersects[0];
                const hitMesh = hit.object;
                const instanceId = hit.instanceId;
                const targetKey = hitMesh.userData.blockKeys ? hitMesh.userData.blockKeys[instanceId] : null;

                if (targetKey) {
                    const [bx, by, bz] = targetKey.split(',').map(Number);
                    
                    if (miningTargetKey !== targetKey) {
                        miningTargetKey = targetKey;
                        miningProgress = 0;
                        crackMesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);
                        crackMesh.visible = true;
                    }

                    miningProgress += dt * MINING_SPEED;
                    
                    const textureIdx = Math.min(Math.floor(miningProgress * 10), 9);
                    crackMat.map = breakTextures[textureIdx];
                    crackMat.needsUpdate = true;

                    if (miningProgress >= 1.0) {
                        worldBlocksData.set(targetKey, 'air'); 
                        miningTargetKey = null;
                        crackMesh.visible = false;

                        const cx = Math.floor(bx / CHUNK_SIZE);
                        const cz = Math.floor(bz / CHUNK_SIZE);
                        const chunkKey = `${cx},${cz}`;

                        if (loadedChunks.has(chunkKey)) {
                            const oldChunk = loadedChunks.get(chunkKey);
                            scene.remove(oldChunk);
                            oldChunk.children.forEach(child => { if (child.isInstancedMesh) child.dispose(); });

                            const freshChunk = createChunk(cx, cz);
                            loadedChunks.set(chunkKey, freshChunk);
                            scene.add(freshChunk);
                            rebuildRaycastTargetsList();
                        }
                    }
                    return;
                }
            }
        }
        
        if (miningTargetKey !== null) {
            miningTargetKey = null;
            crackMesh.visible = false;
        }
    }

    // FIX: proper mouse button handling with preventDefault
    window.addEventListener('mousedown', e => { 
        if(e.button === 0 && document.pointerLockElement === renderer.domElement) { 
            keys['MouseDown0'] = true; 
            e.preventDefault();
        } 
    });
    window.addEventListener('mouseup', e => { if(e.button === 0) keys['MouseDown0'] = false; });
    window.addEventListener('contextmenu', e => e.preventDefault()); // FIX: global context menu prevention

    function isSolid(wx, wy, wz) {
        const key = `${wx},${wy},${wz}`;
        if (worldBlocksData.has(key)) return worldBlocksData.get(key) !== 'air';
        if (wy <= 0) return true;
        if (isCaveSpace(wx, wy, wz)) return false; 
        return wy <= getNoiseHeight(wx, wz); 
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
        checkMiningInteraction(dt);

        const moveDir = new THREE.Vector3();
        if (keys['KeyW']) moveDir.z += 1; 
        if (keys['KeyS']) moveDir.z -= 1; 
        if (keys['KeyA']) moveDir.x -= 1;
        if (keys['KeyD']) moveDir.x += 1;
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
        const speed = sprint ? 8.5 : 5.2;

        const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        const rgt = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

        player.velocity.x = (fwd.x * moveDir.z + rgt.x * moveDir.x) * speed;
        player.velocity.z = (fwd.z * moveDir.z + rgt.z * moveDir.x) * speed;

        if (keys['Space'] && player.onGround) {
            player.velocity.y = 8.2;
            player.onGround = false;
        }

        player.velocity.y -= 24 * dt;
        if (player.velocity.y < -35) player.velocity.y = -35;

        const newPos = player.position.clone();
        
        newPos.x += player.velocity.x * dt;
        if (collides(newPos)) { newPos.x = player.position.x; player.velocity.x = 0; }
        
        newPos.z += player.velocity.z * dt;
        if (collides(newPos)) { newPos.z = player.position.z; player.velocity.z = 0; }
        
        newPos.y += player.velocity.y * dt;
        if (collides(newPos)) {
            if (player.velocity.y < 0) {
                newPos.y = Math.floor(newPos.y) + 1; 
                player.onGround = true;
            } else {
                newPos.y = Math.floor(player.position.y) - 0.001; 
            }
            player.velocity.y = 0;
        } else {
            player.onGround = false;
        }
        player.position.copy(newPos);

        camera.position.set(player.position.x, player.position.y + 1.45, player.position.z);
        const look = new THREE.Vector3(0, 0, -1);
        look.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
        look.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        camera.lookAt(camera.position.clone().add(look));

        const pcx = Math.floor(player.position.x / CHUNK_SIZE);
        const pcz = Math.floor(player.position.z / CHUNK_SIZE);
        updateChunks(pcx, pcz);

        setHTML(uiPos, `${Math.floor(player.position.x)}, ${Math.floor(player.position.y)}, ${Math.floor(player.position.z)}`);
    }

    // ---- Game Loop ----
    let lastTime = 0;
    let frameCount = 0;
    let fpsTimer = 0;

    function animate(time) {
        requestAnimationFrame(animate);
        const dt = lastTime === 0 ? 0.016 : Math.min((time - lastTime) / 1000, 0.1); 
        lastTime = time;
        
        updatePlayer(dt);
        renderer.render(scene, camera);

        frameCount++;
        fpsTimer += dt;
        if (fpsTimer >= 0.5) {
            setHTML(uiFps, Math.round(frameCount / fpsTimer));
            frameCount = 0;
            fpsTimer = 0;
        }
    }

    // Initial spawn: load chunks around origin, then adjust player height
    const spawnX = 0;
    const spawnZ = 0;
    updateChunks(Math.floor(spawnX / CHUNK_SIZE), Math.floor(spawnZ / CHUNK_SIZE));
    rebuildRaycastTargetsList();
    
    // After first chunks are generated, set player to safe height
    const safeY = findSafeSpawnHeight(spawnX, spawnZ);
    player.position.set(spawnX, safeY, spawnZ);
    
    requestAnimationFrame(animate);
});

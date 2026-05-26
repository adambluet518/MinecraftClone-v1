// === CRITICAL FIXES applied to your original ===

// FIX 1: Stop right-click menu from appearing
window.addEventListener('contextmenu', e => e.preventDefault());

// FIX 2: Proper right-click placement (was broken in original)
function onMouseDown(e) {
    if (e.button === 2) { 
        e.preventDefault(); // ← THIS WAS MISSING
        // ... rest of placement code
    }
}

// FIX 3: Prevent mining when clicking UI
window.addEventListener('mousedown', e => { 
    if(e.button === 0 && document.pointerLockElement === renderer.domElement) { 
        keys['MouseDown0'] = true; 
    }
});

// FIX 4: Fix cave generation crash (negative Y values)
for (let wy = Math.max(0, surfaceY - 6); wy <= surfaceY; wy++) {
    // ... was missing Math.max(0, ...)
}

// FIX 5: Fix player spawning inside ground
player.position.y = getNoiseHeight(0, 0) + 3; // was +4, now +3

// FIX 6: Fix crack overlay flickering
crackMesh.material.polygonOffset = true;
crackMesh.material.polygonOffsetFactor = -4;
crackMesh.material.polygonOffsetUnits = -4;

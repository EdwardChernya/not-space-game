import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

import { currentGameState, STATES, gameState, getShipPreset } from './gameState.js';
import { updateFleet, localPlayerShip, remoteShips, localPlayerWeapons, updateRespawnTimers, spawnSingleShip } from './fleetManager.js';
import { updateMovement, cameraOffset, setMovementSyncDependency } from './movement.js';
import { sendPlayerMovement } from './network/networkCore.js';
import { preloadAssets } from './modelsLoader.js';
import { initDebugUI, addDebugControl, clearDebugControls, addDebugDisplay, updateDebugDisplay } from './debugUI.js';
import { checkCollisions } from './collisionDetection.js';
import { updateAllMultiplayerTrails } from './EngineTrail.js';
import { getMouseLeftDown } from './input.js';
import { globalBeamPool } from './weaponSystem.js';
import { globalSparkPool } from './particleEffects.js';
import { globalTargetManager } from './targetManager.js';
import { initReticleForShipType, updateReticle, resizeReticleForShipType, setCurrentShipType } from './reticleManager.js';

// SCENE MODULES
import { buildMenuScene, getMenuScene, getMenuShowcaseShip } from './scenes/MenuScene.js';
import { buildGameplayScene, getGameplayScene, getCombatDirectionalLight, getCombatAmbient, getShadowCameraHelper, getDemoLightConfig, SHADOW_MAP_SIZE, SHADOW_MAP_FAR } from './scenes/GameplayScene.js';

// CAMERA PIPELINE INTEGRATION
import { initCamera, updateCamera, resizeCamera, camera, setCameraPanning } from './camera.js';
export { camera }; // Re-export so any other files importing camera from here stay happy!

// UI MODULES
import { initShipSelector, destroyShipSelector, getSelectedShipType } from './ui/ShipSelector.js';

// Extension methods to supercharge Three.js geometries
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// --- ENGINE HOOKS ---
export let renderer;
export let gameCanvas; // Exported so input.js can request pointer lock
export let menuScene;
export let gameplayScene;
export let combatDirectionalLight; // Exported for debug control
export let combatAmbient; // Exported for debug control
export let shadowCameraHelper = null; // Debug visualization for shadow camera
export let shadowHelperVisible = false; // Toggle for shadow camera helper



// --- DELTA TIME TRACKING ---
let lastTime = performance.now() / 1000; // seconds

// --- FPS COUNTER TRACKING ---
let fpsFrameCount = 0;
let fpsLastUpdateTime = performance.now();
let currentFPS = 0;

const demoDIRLIGHT_CONFIG = {
    color: '#B4C9CB',
    intensity: 3.0,
    offset: new THREE.Vector3(0, -500, 0),
    shadow: {
        bias: -0.0005
    }
};

// rendering pipeline components for post-processing effects
let composer;
let renderPass;


// --- TARGET LOCK RETICLE ---
let reticleInitialized = false;
let lastShipType = null;

/**
 * Initializes the global Three.js structural frameworks
 */
const RETRO_DIVISOR = 3; 
export function init3D() {
    // Initialize debug UI
    initDebugUI();

    // Preload all assets (ships, asteroids, etc.)
    preloadAssets().then(() => {
        console.log('[3D ENGINE]: Asset preloading complete.');
    }).catch(err => {
        console.error('[3D ENGINE]: Asset preloading failed:', err);
    });

    // 1. Create the unified WebGL Renderer base
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // Use BasicShadowMap for better performance; consider PCFSoftShadowMap for softer shadows at the cost of performance
    
    const retroWidth = Math.floor(window.innerWidth / RETRO_DIVISOR);
    const retroHeight = Math.floor(window.innerHeight / RETRO_DIVISOR);
    renderer.setSize(retroWidth, retroHeight, false);

    // Store canvas reference for pointer lock
    gameCanvas = renderer.domElement;

    // CSS Canvas Scaling Rules
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '1'; 
    renderer.domElement.style.imageRendering = 'pixelated';
    renderer.domElement.style.userSelect = 'none'; 
    renderer.domElement.addEventListener('dragstart', (e) => e.preventDefault()); 
    
    document.body.appendChild(renderer.domElement);

    // 2. Initialize your modular Camera system using the canvas DOM element
    initCamera(renderer.domElement);

    // 3. Build the individual scene nodes so they are fully populated
    menuScene = buildMenuScene();
    gameplayScene = buildGameplayScene();

    // Retrieve combat lighting from gameplay scene module
    combatDirectionalLight = getCombatDirectionalLight();
    combatAmbient = getCombatAmbient();
    shadowCameraHelper = getShadowCameraHelper();

    // 4. Initialize Post-Processing Stacks
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(menuScene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(retroWidth, retroHeight),
        0.35,   // Glow Strength
        1.2,   // Glow Radius
        0.5    // Glow Threshold
    );
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // 5. Initialize ship selector UI
    initShipSelector();

    // 6. Setup debug controls
    setupDebugControls();

    // 7. Wire movement sync dependency for network multiplayer
    setMovementSyncDependency(sendPlayerMovement);

    // 8. Handle window resizing dynamically
    window.addEventListener('resize', onWindowResize);
}

/**
 * Setup debug UI controls for scene parameters
 */
function setupDebugControls() {
    clearDebugControls();

    // --- FPS Display ---
    addDebugDisplay('FPS', '0');

    if (!combatDirectionalLight || !combatAmbient) return;

    // --- Ambient Light Controls ---
    addDebugControl(
        'Ambient Intensity',
        'slider',
        { value: combatAmbient.intensity, min: 0, max: 2, step: 0.05 },
        (value) => {
            combatAmbient.intensity = value;
        }
    );

    addDebugControl(
        'Ambient Color',
        'color',
        '#' + combatAmbient.color.getHexString(),
        (value) => {
            combatAmbient.color.setStyle(value);
        }
    );

    // --- Directional Light Controls ---
    addDebugControl(
        'Light Intensity',
        'slider',
        { value: combatDirectionalLight.intensity, min: 0, max: 3, step: 0.1 },
        (value) => {
            combatDirectionalLight.intensity = value;
        }
    );

    addDebugControl(
        'Light Color',
        'color',
        '#' + combatDirectionalLight.color.getHexString(),
        (value) => {
            combatDirectionalLight.color.setStyle(value);
        }
    );

    // Camera offset control
    addDebugControl(
        'Camera Offset (X, Y, Z)',
        'vector3',
        [cameraOffset.x, cameraOffset.y, cameraOffset.z],
        (values) => {
            cameraOffset.set(values[0], values[1], values[2]);
        }
    );
}






/**
 * THE REVOLVING ANIMATION ENGINE LOOP
 */
export function animate3D() {
    requestAnimationFrame(animate3D);

    // Calculate deltaTime in seconds
    const now = performance.now() / 1000;
    const deltaTime = now - lastTime;
    lastTime = now;

    // Update FPS counter
    fpsFrameCount++;
    const currentTime = performance.now();
    const fpsElapsed = currentTime - fpsLastUpdateTime;
    if (fpsElapsed >= 1000) { // Update FPS every 1 second
        currentFPS = Math.round((fpsFrameCount * 1000) / fpsElapsed);
        updateDebugDisplay('FPS', currentFPS.toString());
        fpsFrameCount = 0;
        fpsLastUpdateTime = currentTime;
    }

    // ============================================================================
    // TRAFFIC ROUTING ENGINE: MANAGE STATES & TOGGLE CAMERA PAN PERMISSIONS
    // ============================================================================
    if (currentGameState === STATES.PLAYING) {
         
         setCameraPanning(false); // Disable showcase dragging while in active gameplay
         // Handle local movement / physics
         updateMovement(deltaTime, camera);
         // Update all ship positions (remote lerps) and HP systems
         updateFleet(deltaTime, camera, gameplayScene);
         // Update respawn timers (check if any dead ships should respawn)
         updateRespawnTimers(gameplayScene);

        // Check collisions between local ship and asteroids
        checkCollisions(localPlayerShip, gameplayScene, deltaTime);

        // Update engine trails for all ships
        //updateAllMultiplayerTrails(localPlayerShip, remoteShips, camera);

        // ====== WEAPON SYSTEM UPDATE ======
        if (localPlayerShip && localPlayerWeapons) {
            // Get the ship's forward axis (local +Z in world space)
            const shipForwardAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(localPlayerShip.quaternion);
            const currentTime = performance.now() / 1000;
            
            // Fire weapons if mouse button is held down
            if (getMouseLeftDown()) {
                const hit = localPlayerWeapons.tryFire(shipForwardAxis, currentTime);
                // Note: Particles are now spawned directly in weaponSystem.js when hits occur
            }

            // Update weapon visual effects
            localPlayerWeapons.update();
        }

        // Update particle effects (pass camera for distance-based sizing)
        globalSparkPool.update(camera);

        // Update directional light to follow the player ship
        if (combatDirectionalLight && localPlayerShip) {
            const playerPos = localPlayerShip.position;
            // Position light 500 units above the player
            combatDirectionalLight.position.copy(playerPos).add(demoDIRLIGHT_CONFIG.offset);
            // Make light look at the player ship
            combatDirectionalLight.target.position.copy(playerPos);
            combatDirectionalLight.target.updateMatrixWorld();
        }

        // Initialize reticle for local player's ship type if not already initialized
        if (localPlayerShip) {
            const currentShipType = gameState.players[localPlayerShip.userData.peerId]?.shipType || 'viking1';
            if (!reticleInitialized || lastShipType !== currentShipType) {
                initReticleForShipType(currentShipType);
                setCurrentShipType(currentShipType);
                reticleInitialized = true;
                lastShipType = currentShipType;
            }

            // Update reticle display with current targeting information
            const weaponState = localPlayerWeapons ? localPlayerWeapons.weapons : [];
            updateReticle(weaponState);
        }

        renderPass.scene = gameplayScene;
    } else {
        setCameraPanning(true);  // Allow right-click pan inside the hangar deck / menu!

        // Reset reticle state flags when leaving gameplay
        if (reticleInitialized) {
            reticleInitialized = false;
            lastShipType = null;
        }

        const menuShowcaseShip = getMenuShowcaseShip();
        if (menuShowcaseShip) {
            menuShowcaseShip.rotation.y += 0.001;
        }

        renderPass.scene = menuScene;
    }

    // Process camera follow, orbit slerp, and pan lerp (frame-rate independent)
    updateCamera(deltaTime);

    // Render post-processing layers
    composer.render();
}

/**
 * Keeps aspects aspect-ratios synchronized upon window resizing events
 */
function onWindowResize() {
    // Process internal camera aspect recalculations
    resizeCamera();
    
    // Recalculate low-res target render bounds
    const retroWidth = Math.floor(window.innerWidth / RETRO_DIVISOR);
    const retroHeight = Math.floor(window.innerHeight / RETRO_DIVISOR);
    
    renderer.setSize(retroWidth, retroHeight, false);
    composer.setSize(retroWidth, retroHeight);
    
    // Resize the reticle canvas for current ship type
    if (lastShipType) {
        resizeReticleForShipType(lastShipType);
    }
}

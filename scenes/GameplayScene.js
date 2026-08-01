import * as THREE from 'three';
import { generateAsteroidField } from '../asteroidGenerator.js';
import { globalBeamPool } from '../weaponSystem.js';
import { globalSparkPool } from '../particleEffects.js';
import { gameState } from '../gameState.js';

/**
 * Gameplay Scene Setup
 * This module contains all the logic for setting up the battle airspace scene.
 */

const demoDIRLIGHT_CONFIG = {
    color: '#B4C9CB',
    intensity: 3.0,
    offset: new THREE.Vector3(0, -500, 0),
    shadow: {
        bias: -0.0005
    }
};

export const SHADOW_MAP_SIZE = 1024*2;
export const SHADOW_MAP_FAR = 2000;

let gameplayScene = null;
let combatDirectionalLight = null;
let combatAmbient = null;
let shadowCameraHelper = null;

export function buildGameplayScene() {
    gameplayScene = new THREE.Scene();

    combatAmbient = new THREE.AmbientLight('#ffffff', 0.1);
    gameplayScene.add(combatAmbient);
    
    // Create a simple directional light with shadow that follows the player ship
    combatDirectionalLight = new THREE.DirectionalLight(demoDIRLIGHT_CONFIG.color, demoDIRLIGHT_CONFIG.intensity);
    combatDirectionalLight.castShadow = true;
    combatDirectionalLight.position.copy(demoDIRLIGHT_CONFIG.offset);
    // Configure shadow camera as orthographic
    combatDirectionalLight.shadow.camera.left = -SHADOW_MAP_FAR/2;
    combatDirectionalLight.shadow.camera.right = SHADOW_MAP_FAR/2;
    combatDirectionalLight.shadow.camera.top = SHADOW_MAP_FAR/2;
    combatDirectionalLight.shadow.camera.bottom = -SHADOW_MAP_FAR/2;
    combatDirectionalLight.shadow.camera.near = 0.1;
    combatDirectionalLight.shadow.camera.far = SHADOW_MAP_FAR;
    combatDirectionalLight.shadow.mapSize.width = SHADOW_MAP_SIZE;
    combatDirectionalLight.shadow.mapSize.height = SHADOW_MAP_SIZE;
    combatDirectionalLight.shadow.bias = demoDIRLIGHT_CONFIG.shadow.bias;
    
    gameplayScene.add(combatDirectionalLight);

    // Create helper to visualize the shadow camera
    shadowCameraHelper = new THREE.CameraHelper(combatDirectionalLight.shadow.camera);
    shadowCameraHelper.visible = false;
    gameplayScene.add(shadowCameraHelper);

    const textureLoader = new THREE.CubeTextureLoader();
    textureLoader.setPath('./assets/skybox/basic space/'); 
    const skyboxTexture = textureLoader.load([
        'skybox_basic_space1.png',  // +x
        'skybox_basic_space2.png',  // -x
        'skybox_basic_space3.png',  // +y
        'skybox_basic_space4.png',  // -y
        'skybox_basic_space5.png',  // +z
        'skybox_basic_space6.png'   // -z
    ]);
    skyboxTexture.magFilter = THREE.NearestFilter;
    skyboxTexture.minFilter = THREE.NearestFilter;
    gameplayScene.background = skyboxTexture;

    // ========================================================================
    // ASTEROID FIELD GENERATION
    // ========================================================================
    // In multiplayer, asteroids are synchronized from the host via network handshake
    // In singleplayer, generate them locally
    if (!gameState.meta.isMultiplayer) {
        generateAsteroidField(gameplayScene);
    }

    // ========================================================================
    // WEAPON SYSTEM INITIALIZATION
    // ========================================================================
    globalBeamPool.setScene(gameplayScene);
    globalSparkPool.setScene(gameplayScene);

    return gameplayScene;
}

export function getGameplayScene() {
    return gameplayScene;
}

export function getCombatDirectionalLight() {
    return combatDirectionalLight;
}

export function getCombatAmbient() {
    return combatAmbient;
}

export function getShadowCameraHelper() {
    return shadowCameraHelper;
}

export function getDemoLightConfig() {
    return demoDIRLIGHT_CONFIG;
}

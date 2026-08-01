import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The centralized cache dictionary holding the baseline loaded models
const assetCache = new Map();
let assetsReadyPromise = null;

// load GLTFs
// 1. Define all available modules in a single clean data structure
const ASSET_REGISTRY = {
    // Array of unique ship master files. Add as many distinct ships here as you want!
    ships: [
        {
            filePath: 'assets/models/ships/viking1.glb',
            parts: [
                { id: 'viking1_hull',           meshName: 'viking1_hull_mesh' },
                { id: 'viking1_gun_L',          meshName: 'viking1_gun_L_mesh' },
                { id: 'viking1_gun_R',          meshName: 'viking1_gun_R_mesh' },
                { id: 'viking1_armor_L',        meshName: 'viking1_plate_L_mesh' },
                { id: 'viking1_armor_R',        meshName: 'viking1_plate_R_mesh' },
                { id: 'viking1_engines',        meshName: 'viking1_engines_mesh' },
                { id: 'viking1_main_exhaust_L_additive',   meshName: 'viking1_exhaust_L_mesh' },
                { id: 'viking1_main_exhaust_R_additive',   meshName: 'viking1_exhaust_R_mesh' },
                { id: 'viking1_aux_exhaust_BL_additive', meshName: 'viking1_aux_exhaust_BL_mesh' },
                { id: 'viking1_aux_exhaust_BR_additive', meshName: 'viking1_aux_exhaust_BR_mesh' },
                { id: 'viking1_aux_exhaust_TL_additive', meshName: 'viking1_aux_exhaust_TL_mesh' },
                { id: 'viking1_aux_exhaust_TR_additive', meshName: 'viking1_aux_exhaust_TR_mesh' },
            ]
        },
        /* Example layout for adding a second ship style later:
        {
            filePath: 'assets/models/ships/raptor_master.glb',
            parts: [
                { id: 'raptor_hull',        meshName: 'Raptor_Hull' },
                { id: 'raptor_plasma_L',    meshName: 'Plasma_Cannon_L' },
                { id: 'raptor_plasma_R',    meshName: 'Plasma_Cannon_R' },
                { id: 'raptor_exhaust',     meshName: 'Raptor_Flame' }
            ]
        }
        */
    ],

    // The single asset pack file containing all asteroid variations sharing one texture
    asteroidPackFile: 'assets/models/asteroids/asteroids.glb',
    asteroids: [
        { id: 'asteroid_1',         meshName: 'asteroid_brown_1' },
        { id: 'asteroid_2',         meshName: 'asteroid_brown_2' },
    ]
};

/**
 * Preloads all game assets, extracts them from their respective GLB containers,
 * applies retro pixel-filtering, and caches them cleanly.
 */
export function preloadAssets() {
    if (assetsReadyPromise) {
        return assetsReadyPromise;
    }

    const gltfLoader = new GLTFLoader();
    const loadPromises = [];


    // switch material to lambert and apply nearest filter to all textures for retro pixelated look
    const applyRetroFilters = (rootScene) => {
        rootScene.traverse((child) => {
            if (child.isMesh) {
                const oldMat = child.material;
                if (!oldMat) return;

                // 1. Extract the essential maps you care about
                const colorTex    = oldMat.map;
                const emissiveTex = oldMat.emissiveMap;
                const alphaTex    = oldMat.alphaMap;
                const normalTex   = oldMat.normalMap;

                // 2. Force pixel-perfect filtering on the textures we are keeping
                const activeTextures = [colorTex, emissiveTex, alphaTex, normalTex];
                activeTextures.forEach(tex => {
                    if (tex) {
                        tex.magFilter = THREE.NearestFilter;
                        tex.minFilter = THREE.NearestFilter;
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                    }
                });

                const meshNameLower = child.name.toLowerCase();

                // 3. Check if this mesh is a VFX additive card (or engine exhaust)
                if (meshNameLower.includes('additive') || meshNameLower.includes('exhaust')) {
                    const exhaustTex = emissiveTex || colorTex;
                    
                    // CRITICAL FIX: Match UV data channel for Lambert emissive mapping
                    if (exhaustTex) exhaustTex.channel = 0;

                    child.material = new THREE.MeshLambertMaterial({
                        color: new THREE.Color(0x000000),
                        emissiveMap: exhaustTex, 
                        emissive: new THREE.Color(0xffffff),   // Force maximum emissive glow intensity
                        transparent: true,
                        opacity: 1.0,
                        blending: THREE.AdditiveBlending,      // Blends colors over space background; hides black pixels
                        depthWrite: false,                     // Stop the transparent card from clipping objects behind it
                        toneMapped: false,                     // Keeps raw pixel colors highly saturated
                        side: THREE.DoubleSide                      
                    });
                } else {
                    // 4. Standard Lambert conversion for regular ship hulls, guns, armor, and asteroids
                    const lambertConfig = {
                        map: colorTex,
                        toneMapped: false,
                        // CRITICAL FIX: Default baseline emission to pure black so unlit areas don't glow white!
                        emissive: new THREE.Color(0x000000)
                    };

                    if (emissiveTex) {
                        // CRITICAL FIX: Direct the texture to channel 0 UV mapping
                        emissiveTex.channel = 0;
                        lambertConfig.emissiveMap = emissiveTex;
                        
                        // Pull the actual colored glow properties exported from Blender
                        lambertConfig.emissive = oldMat.emissive || new THREE.Color(0x000000);
                    }

                    if (alphaTex) {
                        alphaTex.channel = 0;
                        lambertConfig.alphaMap = alphaTex;
                        lambertConfig.transparent = oldMat.transparent || false;
                        lambertConfig.alphaTest = oldMat.alphaTest || 0.5; // Jagged retro pixel cutout threshold
                    }

                    if (normalTex) {
                        normalTex.channel = 0;
                        lambertConfig.normalMap = normalTex;
                        if (oldMat.normalScale) {
                            lambertConfig.normalScale = oldMat.normalScale;
                        }
                    }

                    child.material = new THREE.MeshLambertMaterial(lambertConfig);
                }
            }
        });
    };

    // --- TASK 1: Dynamic Multi-Ship GLB Loading Loop ---
    ASSET_REGISTRY.ships.forEach((shipConfig) => {
        const shipPromise = new Promise((resolve, reject) => {
            gltfLoader.load(shipConfig.filePath, (gltf) => {
                const masterScene = gltf.scene;
                applyRetroFilters(masterScene);

                // Extract each individual component listed for THIS specific ship file
                shipConfig.parts.forEach(partInfo => {
                    const foundMesh = masterScene.getObjectByName(partInfo.meshName);
                    if (foundMesh) {
                        // Detach from master scene layout container so it caches cleanly
                        foundMesh.removeFromParent();
                        assetCache.set(partInfo.id, foundMesh);
                    } else {
                        console.warn(`Asset Loader: Could not find "${partInfo.meshName}" in ${shipConfig.filePath}`);
                    }
                });
                resolve();
            }, undefined, (err) => {
                console.error(`Asset Loader: Failed to load ship master file: ${shipConfig.filePath}`);
                reject(err);
            });
        });
        loadPromises.push(shipPromise);
    });

    // --- TASK 2: Load and Process Asteroids Pack GLB ---
    const asteroidPromise = new Promise((resolve, reject) => {
        gltfLoader.load(ASSET_REGISTRY.asteroidPackFile, (gltf) => {
            const masterScene = gltf.scene;
            applyRetroFilters(masterScene);

            // Extract each asteroid variant
            ASSET_REGISTRY.asteroids.forEach(astInfo => {
                const foundMesh = masterScene.getObjectByName(astInfo.meshName);
                if (foundMesh) {
                    foundMesh.removeFromParent();
                    assetCache.set(astInfo.id, foundMesh);
                } else {
                    console.warn(`Asset Loader: Could not find "${astInfo.meshName}" in asteroid pack GLB.`);
                }
            });
            resolve();
        }, undefined, (err) => {
            console.error(`Asset Loader: Failed to load asteroid pack file.`);
            reject(err);
        });
    });
    loadPromises.push(asteroidPromise);

    assetsReadyPromise = Promise.all(loadPromises);
    return assetsReadyPromise;
}

export function waitForAssetsReady() {
    if (assetsReadyPromise) {
        return assetsReadyPromise;
    }
    return preloadAssets();
}

export function areAsteroidAssetsReady() {
    return getAsteroidModelIds().every((id) => assetCache.has(id));
}

/**
 * Grabs a clean, individual instance copy of an extracted part blueprint from cache.
 * @param {string} id - The registration string identifier
 * @returns {THREE.Object3D|null} 
 */
export function createPart(id) {
    const blueprint = assetCache.get(id);
    if (!blueprint) {
        console.error(`Asset Engine: Model ID "${id}" not found in cache.`);
        return null;
    }
    // Deep clone ensures instances don't share position or runtime transform adjustments
    const clone = blueprint.clone();
    
    // CRITICAL FIX: Deep-clone geometry to prevent shared buffer corruption
    // Three.js's clone() shares the same BufferGeometry object between clone and blueprint.
    // When despawnShip() calls geometry.dispose(), it was disposing the cached blueprint's
    // geometry, breaking all future spawns of that part type. Now each instance gets its own
    // independent geometry buffer that can be safely disposed without affecting others.
    clone.traverse((child) => {
        if (child.isMesh && child.geometry) {
            child.geometry = child.geometry.clone();
        }
    });
    
    return clone;
}

/**
 * Quick access utility helper for generating standard game loops over asteroid options
 */
export function getAsteroidModelIds() {
    return ASSET_REGISTRY.asteroids.map(ast => ast.id);
}
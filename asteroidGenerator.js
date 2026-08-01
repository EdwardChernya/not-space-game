import * as THREE from 'three';
import { addAsteroid, gameState } from './gameState.js';
import { createPart, getAsteroidModelIds, waitForAssetsReady } from './modelsLoader.js';
import { globalAsteroidManager } from './asteroidManager.js';

let asteroidFieldBuildPromise = null;

function hashSeed(seed) {
    const value = String(seed ?? 'default-asteroid-seed');
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function createSeededRandom(seed) {
    let state = hashSeed(seed);
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

export function clearAsteroidsFromScene(scene) {
    const registeredAsteroids = [...globalAsteroidManager.getAsteroids()];

    registeredAsteroids.forEach((asteroidMesh) => {
        if (scene && asteroidMesh.parent) {
            scene.remove(asteroidMesh);
        }
        globalAsteroidManager.unregisterAsteroid(asteroidMesh);
    });

    Object.keys(gameState.entities.asteroids).forEach((asteroidId) => {
        delete gameState.entities.asteroids[asteroidId];
    });
}

export function createAsteroidSnapshot() {
    return Object.fromEntries(
        Object.entries(gameState.entities.asteroids).map(([id, asteroid]) => [id, { ...asteroid }])
    );
}

/**
 * Spawns asteroids from serialized state (used for network synchronization)
 * @param {Object} asteroidState - Dictionary of asteroids from gameState.entities.asteroids
 * @param {THREE.Scene} scene - The Three.js scene to add asteroids to
 */
export async function spawnAsteroidsFromState(asteroidState, scene) {
    await waitForAssetsReady();

    if (!asteroidState || Object.keys(asteroidState).length === 0) {
        console.log('[ASTEROID GENERATOR]: No asteroids to spawn from state.');
        return;
    }

    clearAsteroidsFromScene(scene);

    const allModelIds = getAsteroidModelIds();
    if (allModelIds.length === 0) {
        console.warn('[ASTEROID GENERATOR]: No asteroid models available.');
        return;
    }

    let spawnedCount = 0;

    Object.keys(asteroidState).forEach(asteroidId => {
        const asteroidData = asteroidState[asteroidId];
        
        // Use the stored modelId from the host's generation, ensuring identical visuals
        const modelId = asteroidData.modelId || allModelIds[0]; // Fallback to first model if not present
        const asteroidMesh = createPart(modelId);

        if (!asteroidMesh) {
            console.warn(`[ASTEROID GENERATOR]: Failed to create asteroid from model ${modelId}`);
            return;
        }

        // Configure geometry and materials
        asteroidMesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material = child.material.clone();
                    if (child.material.normalMap) {
                        child.material.normalScale.set(1.2, 1.2);
                    }
                }
                child.geometry.computeBoundingSphere();
                child.geometry.computeBoundsTree();
            }
        });

        // Apply position, scale, and rotation from serialized state
        asteroidMesh.position.set(asteroidData.x, asteroidData.y, asteroidData.z);
        asteroidMesh.scale.set(asteroidData.size, asteroidData.size, asteroidData.size);
        asteroidMesh.rotation.set(asteroidData.rotationX || 0, asteroidData.rotationY || 0, asteroidData.rotationZ || 0);

        // Compute collision radius for userData
        let baseRadius = 1;
        asteroidMesh.traverse((child) => {
            if (child.isMesh && child.geometry.boundingSphere) {
                baseRadius = child.geometry.boundingSphere.radius;
            }
        });

        asteroidMesh.userData = {
            baseRadius: baseRadius,
            collisionRadius: baseRadius * asteroidData.size,
            asteroidId: asteroidData.id || asteroidId
        };

        scene.add(asteroidMesh);
        globalAsteroidManager.registerAsteroid(asteroidMesh);

        addAsteroid(
            asteroidData.id || asteroidId,
            asteroidData.x,
            asteroidData.y,
            asteroidData.z,
            asteroidData.size,
            asteroidData.velocityX || 0,
            asteroidData.velocityY || 0,
            asteroidData.velocityZ || 0,
            asteroidData.rotationX || 0,
            asteroidData.rotationY || 0,
            asteroidData.rotationZ || 0,
            asteroidData.modelId || modelId
        );
        
        spawnedCount++;
    });

    console.log(`[ASTEROID GENERATOR]: Spawned ${spawnedCount} asteroids from network state.`);
}

export const ASTEROID_CONFIG = {
    count: 40,               // Bumped up! Spiral shapes look much better with more definition
    spawnAreaWidth: 1000,      
    spawnAreaHeight: 450,     // Tightened Y tightly to flatten into a gorgeous galaxy disc
    spawnAreaDepth: 1000,      
    minSize: 12,               
    maxSize: 250,               
    maxRetries: 50,
    normalIntensity: 1.2,
    
    // --- ADVANCED ADVANCED GEOMETRY SETTINGS ---
    densityMultiplier: 1.0,   // Tight packing factor
    numArms: 2,               // Number of spiral arms tracking through the field
    armTightness: 0.35,       // Tightness factor (b parameter of a logarithmic spiral)
    armWidthVariance: 350,    // Clumping thickness spread around the center line of the arm
    coreDensityPercent: 0.20   // Percentage of rocks forced into a chaotic central cluster/core
};

export async function generateAsteroidField(scene, config = ASTEROID_CONFIG, seed = null) {
    await waitForAssetsReady();

    const allModelIds = getAsteroidModelIds();

    if (allModelIds.length === 0) {
        console.warn('[ASTEROID GENERATOR]: No asteroid models available.');
        return;
    }

    const placedAsteroids = [];
    let spawnedCount = 0;
    const effectiveSeed = seed ?? gameState.meta.asteroidSeed ?? 'default-asteroid-seed';
    const random = createSeededRandom(effectiveSeed);

    for (let i = 0; i < config.count; i++) {
        const modelId = allModelIds[Math.floor(random() * allModelIds.length)];
        const asteroidMesh = createPart(modelId);

        if (!asteroidMesh) continue;

        let baseRadius = 1;
        asteroidMesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material = child.material.clone();
                    if (child.material.normalMap) child.material.normalScale.set(config.normalIntensity, config.normalIntensity);
                }
                child.geometry.computeBoundingSphere();
                baseRadius = child.geometry.boundingSphere ? child.geometry.boundingSphere.radius : 1;
                child.geometry.computeBoundsTree(); 
            }
        });

        const size = config.minSize + random() * (config.maxSize - config.minSize);
        const finalCollisionRadius = baseRadius * size;

        let x, y, z;
        let validPositionFound = false;

        // Try to generate coordinate zones using spiral algorithms
        for (let attempts = 0; attempts < config.maxRetries; attempts++) {
            
            // Heuristic decision: Spawn inside the chaotic central cluster or out on the arms?
            if (i < config.count * config.coreDensityPercent) {
                // Central Core: Dense, random spherical clump in the absolute middle
                const r = random() * (config.spawnAreaWidth * 0.12);
                const theta = random() * Math.PI * 2;
                const phi = Math.acos((random() * 2) - 1);

                x = r * Math.sin(phi) * Math.cos(theta);
                y = (random() - 0.5) * config.spawnAreaHeight;
                z = r * Math.sin(phi) * Math.sin(theta);
            } else {
                // Spiral Arm Cluster: Distribute points along curved paths
                // 1. Assign to a specific geometric arm
                const armOffset = (random() * config.numArms | 0) * ((Math.PI * 2) / config.numArms);
                
                // 2. Map how far down the arm the rock is sitting (Logarithmic spiral distance calculation)
                const theta = random() * Math.PI * 2.5; 
                const radius = Math.exp(config.armTightness * theta) * 120; 

                // 3. Cluster variance offsets (Makes the edges clump irregularly rather than mathematical rows)
                const clusterSpread = Math.pow(random(), 2) * config.armWidthVariance; 
                const spreadAngle = random() * Math.PI * 2;

                const coreX = Math.cos(theta + armOffset) * radius;
                const coreZ = Math.sin(theta + armOffset) * radius;

                x = coreX + Math.cos(spreadAngle) * clusterSpread;
                y = (random() - 0.5) * config.spawnAreaHeight;
                z = coreZ + Math.sin(spreadAngle) * clusterSpread;
            }

            // Proximity overlap verification checks
            let isOverlapping = false;
            for (const placed of placedAsteroids) {
                const dx = x - placed.x;
                const dy = y - placed.y;
                const dz = z - placed.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                const minSafeDistance = (finalCollisionRadius + placed.collisionRadius) * config.densityMultiplier;

                if (distance < minSafeDistance) {
                    isOverlapping = true;
                    break; 
                }
            }

            if (!isOverlapping) {
                validPositionFound = true;
                break; 
            }
        }

        if (!validPositionFound) continue; 

        // Generate random rotation values for this asteroid
        const rotationX = random() * Math.PI;
        const rotationY = random() * Math.PI;
        const rotationZ = random() * Math.PI;

        // Apply spatial properties to scene
        asteroidMesh.scale.set(size, size, size);
        asteroidMesh.position.set(x, y, z);
        asteroidMesh.rotation.set(rotationX, rotationY, rotationZ);

        const asteroidId = `asteroid_${spawnedCount}`;

        asteroidMesh.userData = {
            baseRadius: baseRadius,
            collisionRadius: finalCollisionRadius,
            asteroidId: asteroidId
        };
        
        scene.add(asteroidMesh);
        placedAsteroids.push({ x, y, z, collisionRadius: finalCollisionRadius });

        addAsteroid(asteroidId, x, y, z, size, 0, 0, 0, rotationX, rotationY, rotationZ, modelId);
        
        // Register asteroid with cache manager for fast collision/targeting lookups
        globalAsteroidManager.registerAsteroid(asteroidMesh);
        
        spawnedCount++;
    }

    console.log(`[GEOMETRIC FIELD GENERATOR]: Structured spiral map compiled. Active elements: ${spawnedCount}`);
}

export function ensureAsteroidField(scene, config = ASTEROID_CONFIG, seed = null) {
    if (!asteroidFieldBuildPromise) {
        asteroidFieldBuildPromise = generateAsteroidField(scene, config, seed).finally(() => {
            asteroidFieldBuildPromise = null;
        });
    }

    return asteroidFieldBuildPromise;
}
import { createPart } from './modelsLoader.js';
import * as THREE from 'three';

/**
 * Assembles a fully modular composite ship from an array of part definitions.
 * @param {Array} partsList - Array of objects containing { id, glowColor, intensity }
 */
export function buildCustomShip(partsList = []) {
    const shipGroup = new THREE.Group();

    // Inner group that holds all mesh parts — rotated to correct Blender export orientation
    const modelGroup = new THREE.Group();
    shipGroup.add(modelGroup);

    // Dynamic material processing logic
    const processPartMaterials = (partGroup, colorValue, intensity) => {
        if (!partGroup) return;
        
        partGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                // Clone the material so altering this ship instance doesn't affect others
                child.material = child.material.clone();
                
                // CRITICAL EXCEPTION: If it's a VFX additive card, do NOT override its special settings
                if (child.name.toLowerCase().includes('additive')) {
                    // Let the loader's Additive Blending and opacity stay intact.
                    // You can optionally match the engine fire color to the player's custom color:
                    child.material.emissive.set(colorValue);
                } else {
                    // Standard structural ship parts get your unique custom team/glow color paint
                    child.material.emissive.set(colorValue);
                    child.material.emissiveIntensity = intensity ?? 1;
                    
                    // Shadows look awesome on solid hulls and armor plates
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            }
        });
        modelGroup.add(partGroup);
    };

    // Iterate through every piece of equipment assigned to this vessel
    partsList.forEach(partConfig => {
        const partMesh = createPart(partConfig.id);
        
        if (partMesh) {
            // Keep your clean name-tag system so you can pull objects back out 
            // by name later during input updates or destruction events!
            partMesh.name = partConfig.id; 
            
            // Process materials safely 
            processPartMaterials(partMesh, partConfig.glowColor, partConfig.intensity);
        } else {
            console.warn(`[SHIP BUILDER]: Asset catalog missing token: ${partConfig.id}`);
        }
    });

    return shipGroup;
}

/**
 * Generates a standard baseline loadout using your new GLB configuration ids
 */
export function buildDefaultShip() {
    // UPDATED: Now includes your separate left gun, right gun, and main engine exhaust!
    const defaultColor = '#000000';
    const defaultLoadout = [
        { id: 'viking1_hull',         glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_armor_L',      glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_armor_R',      glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_gun_L',        glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_gun_R',        glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_engines',                 glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_main_exhaust_L_additive',   glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_main_exhaust_R_additive',   glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_aux_exhaust_BL_additive', glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_aux_exhaust_BR_additive', glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_aux_exhaust_TL_additive', glowColor: defaultColor, intensity: 1 },
        { id: 'viking1_aux_exhaust_TR_additive', glowColor: defaultColor, intensity: 1 }
    ];
    return buildCustomShip(defaultLoadout);
}

/**
 * Updates the physical scaling and glow brightness of a ship's engine plumes.
 * @param {THREE.Group} shipGroup - The main composite ship group.
 * @param {number} throttle - Current throttle value.
 * @param {number} deltaTime - Seconds passed since last frame.
 */
export function updateShipThrustVisuals(shipGroup, throttle, deltaTime) {
    const dt = deltaTime || 0.016;

    // 1. Initialize persistent state trackers
    if (shipGroup.userData.thrustSpike === undefined) {
        shipGroup.userData.thrustSpike = 0;
        shipGroup.userData.wasIdling = true;
    }

    // 2. Trigger Burst: State check from idling to active thrust
    if (throttle > 0.25 && shipGroup.userData.wasIdling) {
        shipGroup.userData.thrustSpike = 1.0; 
        shipGroup.userData.wasIdling = false; 
    }

    if (throttle <= 0.25) {
        shipGroup.userData.wasIdling = true;
    }

    // Decay the spike over time
    shipGroup.userData.thrustSpike = Math.max(0, shipGroup.userData.thrustSpike - dt * 2.0);

    // 3. Apply to meshes
    shipGroup.traverse((child) => {
        if (!child.isMesh) return;

        // --- LAYER A: EXHAUST PLUMES (Existing Flame logic) ---
        if (child.name.toLowerCase().includes('main_exhaust')) {
            const baseScale = 0.15 + (throttle * 1.6);
            const spikeBonus = shipGroup.userData.thrustSpike * 1.0; 
            const flickerZ = 0.85 + Math.random() * 0.5;

            const targetZScale = (baseScale + spikeBonus) * flickerZ;
            const flickerX = 0.7 + Math.random() * 0.3;
            const flickerY = 0.7 + Math.random() * 0.3;

            child.scale.set(
                flickerX * (throttle > 0.1 ? 1.0 : 0.65),
                flickerY * (throttle > 0.1 ? 1.0 : 0.65),
                targetZScale
            );

            if (child.material) {
                if (!child.userData.materialCloned) {
                    child.material = child.material.clone();
                    child.userData.materialCloned = true;
                }
                const baseEmission = 0.3 + throttle * 4.0;
                const spikeEmission = shipGroup.userData.thrustSpike * 0.3;
                const emissionFlicker = 0.8 + Math.random() * 0.4; 

                child.material.emissiveIntensity = (baseEmission + spikeEmission) * emissionFlicker;
                child.material.opacity = throttle > 0.05 ? 1.0 : throttle * 20.0;
                child.material.transparent = true;
            }
        }

        // --- LAYER B: SOLID ENGINE CASING (New Metal Heat Glow logic) ---
        if (child.name.toLowerCase().includes('engines')) {
            if (child.material) {
                // Clone the material so you don't make every ship's engines on the server glow!
                if (!child.userData.materialCloned) {
                    child.material = child.material.clone();
                    child.userData.materialCloned = true;
                }

                // Metal behaves differently than plasma: it shouldn't flicker wildly.
                // We want a steady heat glow based on throttle, plus a smooth thermal spike.
                const baseMetalGlow = throttle * 15.0;
                const spikeMetalGlow = shipGroup.userData.thrustSpike * 3.0;

                child.material.emissiveIntensity = baseMetalGlow + spikeMetalGlow;

                // Make sure the emissive color itself is set to something visible (like orange/red/blue)
                // if it wasn't already baked into the file's material setup
                if (child.material.emissive.getHex() === 0x000000) {
                    child.material.emissive.setHex(0xff3300); // Choice retro orange heat glow
                }
            }
        }
    });
}



/**
 * Updates the physical scaling of the 4 quadrant auxiliary maneuver thrusters (TL, TR, BL, BR)
 * based on active tracking deltas.
 * @param {THREE.Group} shipGroup - The main composite ship group.
 * @param {THREE.Euler} deltaEuler - The local rotational error from current to target (YXZ order).
 */
export function updateShipAuxVisuals(shipGroup, deltaEuler) {
    if (!deltaEuler) return;

    // Extract the local pitch error (X axis) and local roll error (Z axis)
    const pitchError = deltaEuler.x; // Positive = pitching down, Negative = pitching up
    const rollError = deltaEuler.z;  // Positive = rolling right, Negative = rolling left

    const DEADZONE = 0.02; 

    shipGroup.traverse((child) => {
        if (child.isMesh && child.name.toLowerCase().includes('aux_exhaust')) {
            // Convert to lowercase ONCE to avoid case mismatches
            const name = child.name.toLowerCase();
            
            // Separate tracking variables for each axis so they can combine together smoothly
            let pitchThrottle = 0.0;
            let rollThrottle = 0.0;

            // --- 1. EVALUATE PITCH FORCE ---
            if (name.includes('tl') || name.includes('tr')) {
                // Top thrusters fire when pitching nose DOWN
                if (pitchError > DEADZONE) {
                    pitchThrottle = Math.min(1.0, pitchError * 3.0);
                }
            } 
            else if (name.includes('bl') || name.includes('br')) {
                // Bottom thrusters fire when pitching nose UP
                if (pitchError < -DEADZONE) {
                    pitchThrottle = Math.min(1.0, Math.abs(pitchError) * 3.0);
                }
            } 

            // --- 2. EVALUATE ROLL FORCE (FIXED REVERSAL) ---
            if (name.includes('tl') || name.includes('br')) {
                // Reversed: Fires when rolling LEFT (counter-clockwise correction)
                if (rollError < -DEADZONE) {
                    rollThrottle = Math.min(1.0, Math.abs(rollError) * 2.0);
                }
            } 
            else if (name.includes('tr') || name.includes('bl')) {
                // Reversed: Fires when rolling RIGHT (clockwise correction)
                if (rollError > DEADZONE) {
                    rollThrottle = Math.min(1.0, rollError * 2.0);
                }
            }

            // --- 3. COMBINE AXES ---
            // Take whichever thrust requirement is higher, or fallback to an idle baseline
            const maxInput = Math.max(pitchThrottle, rollThrottle);
            const throttle = maxInput > 0 ? maxInput : 0.05;

            // --- 4. LOW-POLY SCALE TRANSFORMS ---
            const baseScale = 0.35 + (throttle * 1.35); 
            const flickerZ = 0.8 + Math.random() * 0.4;
            const targetZScale = baseScale * flickerZ;

            const flickerX = 0.7 + Math.random() * 0.3;
            const flickerY = 0.7 + Math.random() * 0.3;

            child.scale.set(
                flickerX * (throttle > 0.1 ? 1.0 : 0.65),
                flickerY * (throttle > 0.1 ? 1.0 : 0.65),
                targetZScale
            );

            if (child.material) {
                if (!child.userData.materialCloned) {
                    child.material = child.material.clone();
                    child.userData.materialCloned = true;
                }
                child.material.opacity = throttle > 0.1 ? 1.0 : 0.2;
                child.material.transparent = true;
            }
        }
    });
}
import * as THREE from 'three';
import { gameState } from './gameState.js';




export class EngineTrail {
    /**
     * @param {number} maxPoints - Length of history (resolution of the curve)
     * @param {number} width - Diameter of the tube
     * @param {number|string} colorHex - Hex color code
     */
    constructor(maxPoints = 20, width = 0.4, colorHex = 0x00aaff) {
        this.maxPoints = maxPoints;
        this.width = width;
        this.points = []; 
        this.baseColor = new THREE.Color(colorHex);
        
        // Dynamic fading tracking
        this.currentOpacity = 0.85;
        this.maxOpacity = 0.95;
        this.fadeSpeed = 0.85; // Adjust between 0.75 and 0.95 to change how fast the trail vanishes

        this.geometry = new THREE.BufferGeometry();
        
        this.material = new THREE.MeshBasicMaterial({
            vertexColors: true, // Enabled so vertex buffer colors apply spatial fade
            transparent: true,
            opacity: this.currentOpacity,
            blending: THREE.AdditiveBlending,
            //side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
    }

    update(nozzleWorldPos, throttle) {
        // --- 1. HANDLING THE INSTANT FADE REACTION WHEN W IS RELEASED ---
        if (throttle <= 0.2) {
            // Decelerate the opacity down to zero frame-by-frame instead of hiding instantly
            this.currentOpacity *= this.fadeSpeed;
            this.material.opacity = this.currentOpacity;

            // If it's completely invisible, cut the mesh work entirely and wipe history
            if (this.currentOpacity < 0.01) {
                this.mesh.visible = false;
                this.points = [];
                return;
            }
        } else {
            // Re-assert standard full opacity when actively accelerating
            this.currentOpacity = this.maxOpacity;
            this.material.opacity = this.currentOpacity;
        }

        // Add raw frame position to history
        this.points.unshift(nozzleWorldPos.clone());
        if (this.points.length > this.maxPoints) {
            this.points.pop();
        }

        const count = this.points.length;
        if (count < 3) {
            this.mesh.visible = false;
            return;
        }

        this.mesh.visible = true;

        // Smooth out the jagged steps into a mathematical curve
        const curvePoints = [...this.points].reverse();
        const curve = new THREE.CatmullRomCurve3(curvePoints);

        // Rebuild tube geometry along smooth spline
        const radialSegments = 4; // Square tube
        const tubularSegments = count * 2;
        const newTubeGeom = new THREE.TubeGeometry(curve, tubularSegments, this.width / 2, radialSegments, false);

        // --- 2. SPATIAL FADE: APPLIES COLOR DROPOFF TO VERTICES ---
        // TubeGeometry builds vertices sequentially from tail to head
        const vertexCount = newTubeGeom.attributes.position.count;
        const colors = new Float32Array(vertexCount * 3);

        // Each 'ring' around the tube has (radialSegments + 1) vertices due to duplication at the seam
        const ringSize = radialSegments + 1;
        const totalRings = tubularSegments + 1;

        for (let ring = 0; ring < totalRings; ring++) {
            // 0.0 at the tail, 1.0 at the head of the exhaust nozzle
            const spatialRatio = ring / (totalRings - 1); 
            
            // Linear fade multiplier down the tail length
            const intensity = spatialRatio; 

            for (let v = 0; v < ringSize; v++) {
                const vertexIndex = ring * ringSize + v;
                if (vertexIndex >= vertexCount) break;

                const idx = vertexIndex * 3;
                colors[idx + 0] = this.baseColor.r * intensity;
                colors[idx + 1] = this.baseColor.g * intensity;
                colors[idx + 2] = this.baseColor.b * intensity;
            }
        }

        newTubeGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Swap out old geometry references cleanly
        if (this.geometry) this.geometry.dispose();
        this.geometry = newTubeGeom;
        this.mesh.geometry = this.geometry;
    }

    destroy(scene) {
        scene.remove(this.mesh);
        if (this.geometry) this.geometry.dispose();
        this.material.dispose();
    }
}







/**
 * Automatically discovers all main exhaust points on a ship model and maps them to player data structures.
 * @param {THREE.Scene} scene - Your global root world scene.
 * @param {Object} playerData - The specific player object from gameState.players[peerId].
 * @param {THREE.Group} shipGroup - The compiled visual mesh group for this specific player.
 * @param {string} trailColor - The color of the engine trail.
 */
export function initializeShipTrails(scene, playerData, shipGroup, trailColor = '#c300ff') {
    // Prevent double binding if someone joins or respawns repeatedly
    if (playerData.engineTrails) {
        playerData.engineTrails.forEach(t => t.trailInstance.destroy(scene));
    }

    // Initialize an empty reference array attached to the network entity container
    playerData.engineTrails = [];

    // Traverse the ship design and discover exhaust meshes dynamically
    shipGroup.traverse((child) => {
        if (child.isMesh && child.name.toLowerCase().includes('main_exhaust')) {
            
            // Create a dedicated ribbon trail instance for this nozzle mapping
            const newTrail = new EngineTrail(25, 0.3, '#222222');
            scene.add(newTrail.mesh);

            // Save the engine reference along with a direct handle to the target submesh
            playerData.engineTrails.push({
                exhaustMesh: child,
                trailInstance: newTrail
            });
        }
    });
}





const _tempWorldPos = new THREE.Vector3();
// Allocate this once out here to keep memory perfectly clean!
const _tempVelocityVec = new THREE.Vector3(); 

/**
 * Iterates through active players and updates all camera-facing engine energy ribbons.
 * @param {THREE.Object3D} localPlayerShip 
 * @param {Object} remoteShips 
 * @param {THREE.Camera} camera - Pass your active Three.js game camera here
 */
export function updateAllMultiplayerTrails(localPlayerShip, remoteShips, camera) {
    for (const peerId in gameState.players) {
        const player = gameState.players[peerId];
        if (!player || !player.engineTrails) continue;

        if (!camera) {
            console.warn("updateAllMultiplayerTrails: 'camera' parameter was not passed.");
            return; 
        }

        // Get throttle value
        const throttle = player.throttle !== undefined ? player.throttle : 0;
        
        // Re-use our global scratchpad vector instead of creating a new one every frame
        _tempVelocityVec.set(player.velocityX || 0, player.velocityY || 0, player.velocityZ || 0);
        const velocity = _tempVelocityVec.length();

        for (let i = 0; i < player.engineTrails.length; i++) {
            const bind = player.engineTrails[i];
            
            if (bind.exhaustMesh && bind.trailInstance) {
                bind.exhaustMesh.getWorldPosition(_tempWorldPos);
                
                // Pass the world position, throttle state, and the active scene camera
                bind.trailInstance.update(_tempWorldPos, throttle, camera);
            }
        }
    }
}



export function cleanupPlayerTrails(scene, playerData) {
    if (playerData && playerData.engineTrails) {
        playerData.engineTrails.forEach(bind => {
            bind.trailInstance.destroy(scene);
        });
        delete playerData.engineTrails;
    }
}

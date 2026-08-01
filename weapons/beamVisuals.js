import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Pre-allocate temporary scratch vectors to completely avoid garbage collection
const _dir = new THREE.Vector3();
const _p1 = new THREE.Vector3();

export class BeamPool {
    constructor(poolSize = 100) {
        this.poolSize = poolSize;
        this.available = [];
        this.active = [];
        this.scene = null;

        for (let i = 0; i < poolSize; i++) {
            this.available.push(this.createBeamInstance());
        }
    }

    createBeamInstance() {
        const geometry = new LineGeometry();
        // Initialize the buffer once. This creates the memory slot we will reuse.
        geometry.setPositions([0, 0, 0, 0, 0, 1]);

        const material = new LineMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            linewidth: 6,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        const line = new Line2(geometry, material);
        // Frustum culling is false, which is great because we don't need to waste CPU updating bounding boxes
        line.frustumCulled = false;
        line.visible = false; 

        return {
            line: line,
            geometry: geometry,
            material: material,
            createdAt: 0,
            duration: 0.3,
            color: new THREE.Color(0xffff00),
            intensity: 1.0,
            isDead: true,
            worldStartPos: new THREE.Vector3(),
            worldEndPos: new THREE.Vector3(),
            originalStartPos: new THREE.Vector3(),
            originalEndPos: new THREE.Vector3()
        };
    }

    // NEW HELPER: Mutates the geometry buffer directly without creating garbage arrays
    updateBeamGeometry(beam, p1X, p1Y, p1Z, p2X, p2Y, p2Z) {
        const startAttr = beam.geometry.attributes.instanceStart;
        const endAttr = beam.geometry.attributes.instanceEnd;
        
        // Overwrite the existing memory directly
        startAttr.setXYZ(0, p1X, p1Y, p1Z);
        endAttr.setXYZ(0, p2X, p2Y, p2Z);
        
        // Tell the GPU the numbers changed
        startAttr.needsUpdate = true;
        endAttr.needsUpdate = true;
    }

    get(startPos, endPos, color = 0xffff00, intensity = 1.0, isLocalBeam = false) {
        let beam;
        if (this.available.length > 0) {
            beam = this.available.pop();
        } else {
            beam = this.createBeamInstance();
            if (this.scene) this.scene.add(beam.line);
            console.warn("BeamPool exhausted! Dynamic allocation occurred.");
        }

        beam.createdAt = performance.now() / 1000;
        beam.isDead = false;
        beam.duration = 0.3;
        beam.intensity = intensity;
        beam.initialLinewidth = 6;
        beam.isLocalBeam = isLocalBeam;
        
        beam.worldStartPos.copy(startPos);
        beam.worldEndPos.copy(endPos);
        beam.originalStartPos.copy(startPos);
        beam.originalEndPos.copy(endPos);
        
        beam.line.position.set(0, 0, 0);
        beam.line.quaternion.identity();
        beam.line.scale.set(1, 1, 1);

        beam.beamLength = startPos.distanceTo(endPos);
        
        // Use the new zero-allocation helper instead of setPositions
        this.updateBeamGeometry(beam, startPos.x, startPos.y, startPos.z, endPos.x, endPos.y, endPos.z);
        
        if (typeof color === 'number') beam.material.color.setHex(color);
        else if (typeof color === 'string') beam.material.color.setStyle(color);
        else if (color instanceof THREE.Color) beam.material.color.copy(color);
        
        beam.material.opacity = intensity;
        beam.line.visible = true;

        this.active.push(beam);
        return beam;
    }

    setScene(scene) {
        this.scene = scene;
        // Add all available beams to the scene once, hidden
        this.available.forEach(beam => scene.add(beam.line));
    }

    update() {
        const currentTime = performance.now() / 1000;

        for (let i = this.active.length - 1; i >= 0; i--) {
            const beam = this.active[i];
            const age = currentTime - beam.createdAt;
            const progress = Math.min(age / beam.duration, 1.0);

            if (progress >= 1.0) {
                beam.isDead = true;
                beam.line.visible = false;
                this.available.push(beam);
                this.active.splice(i, 1);
            } else {
                let holdThreshold = beam.isLocalBeam ? 0 : 0.1;
                let retractProgress = progress;
                
                if (!beam.isLocalBeam && progress < holdThreshold) {
                    // HOLD PHASE
                    beam.material.opacity = beam.intensity * (1.0 - progress * 0.3);
                    
                    const holdLinewidthProgress = 1 - Math.exp(-progress * 0.5);
                    beam.material.linewidth = beam.initialLinewidth * (1.0 - holdLinewidthProgress) + 2 * holdLinewidthProgress;
                    
                    this.updateBeamGeometry(
                        beam, 
                        beam.originalStartPos.x, beam.originalStartPos.y, beam.originalStartPos.z,
                        beam.originalEndPos.x, beam.originalEndPos.y, beam.originalEndPos.z
                    );
                    continue; 
                } else if (!beam.isLocalBeam) {
                    retractProgress = (progress - holdThreshold) / (1.0 - holdThreshold);
                }
                
                // RETRACTION PHASE (Your exact original math)
                beam.material.opacity = beam.intensity * Math.pow(1.0 - retractProgress, 2.0);
                
                const linewidthProgress = 1 - Math.exp(-retractProgress * 2);
                beam.material.linewidth = beam.initialLinewidth * (1.0 - linewidthProgress) + 2 * linewidthProgress;
                
                const retractDist = beam.beamLength * Math.pow(retractProgress, 1.2);
                
                _dir.subVectors(beam.originalEndPos, beam.originalStartPos).normalize();
                _p1.copy(beam.originalStartPos).addScaledVector(_dir, retractDist);
                
                // Update buffer directly, snapping tail to the new _p1, keeping head at originalEndPos
                this.updateBeamGeometry(
                    beam,
                    _p1.x, _p1.y, _p1.z,
                    beam.originalEndPos.x, beam.originalEndPos.y, beam.originalEndPos.z
                );
            }
        }
    }

    clear(scene) {
        const targetScene = scene || this.scene;
        this.active.forEach(beam => {
            if (targetScene) targetScene.remove(beam.line);
            beam.geometry.dispose();
            beam.material.dispose();
        });
        this.available.forEach(beam => {
            if (targetScene) targetScene.remove(beam.line);
            beam.geometry.dispose();
            beam.material.dispose();
        });
        this.active = [];
        this.available = [];
    }
}

export const globalBeamPool = new BeamPool(300);
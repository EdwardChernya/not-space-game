import * as THREE from 'three';

// ============================================================================
// SPARK PARTICLE POOL — Reuse particles instead of creating/destroying
// ============================================================================
class SparkParticle {
    constructor() {
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.color = new THREE.Color(0xffff00);
        this.lifespan = 0;
        this.maxLifespan = 0.5;
        this.size = 0.2;
        this.createdAt = 0;
        this.isDead = true;
    }
}

export class SparkParticlePool {
    constructor(poolSize = 500) {
        this.poolSize = poolSize;
        this.particles = [];
        this.geometry = null;
        this.material = null;
        this.pointsCloud = null;
        this.scene = null;

        // Create particle instances
        for (let i = 0; i < poolSize; i++) {
            this.particles.push(new SparkParticle());
        }

        this.initializeGeometry();
    }

    initializeGeometry() {
        const positions = new Float32Array(this.poolSize * 3);
        const colors = new Float32Array(this.poolSize * 3);
        const sizes = new Float32Array(this.poolSize);

        for (let i = 0; i < this.poolSize; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;

            colors[i * 3] = 0;
            colors[i * 3 + 1] = 0;
            colors[i * 3 + 2] = 0;

            sizes[i] = 0;  // Start with size 0 so dead particles don't render
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // CRITICAL: Force eager computation of bounding geometry
        // This prevents lazy initialization lag on first particle spawn
        // Three.js normally computes these on first render, causing frame drops
        this.geometry.computeBoundingSphere();
        this.geometry.computeBoundingBox();

        this.material = new THREE.PointsMaterial({
            size: 2.0,
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            sizeAttenuation: true
        });

        this.pointsCloud = new THREE.Points(this.geometry, this.material);
        this.pointsCloud.frustumCulled = false;
        this.pointsCloud.visible = true;
    }

    /**
     * Spawn particles at a location
     * @param {THREE.Vector3} position - World position
     * @param {THREE.Color|number|string} color - Particle color (hex number, hex string, or THREE.Color)
     * @param {number} count - Number of particles to spawn
     * @param {number} spreadVelocity - How fast particles spread
     */
    spawnBurst(position, color = 0xffff00, count = 10, spreadVelocity = 20) {
        let spawned = 0;

        for (let i = 0; i < this.particles.length && spawned < count; i++) {
            const particle = this.particles[i];
            if (particle.isDead) {
                particle.position.copy(position);
                particle.velocity.set(
                    (Math.random() - 0.5) * spreadVelocity,
                    (Math.random() - 0.5) * spreadVelocity,
                    (Math.random() - 0.5) * spreadVelocity
                );

                // Parse color: handle numbers, hex strings, and THREE.Color objects
                if (typeof color === 'number') {
                    particle.color.setHex(color);
                } else if (typeof color === 'string') {
                    particle.color.setStyle(color); // Handles hex strings like '#ffff00'
                } else if (color instanceof THREE.Color) {
                    particle.color.copy(color);
                }

                particle.lifespan = particle.maxLifespan;
                particle.createdAt = performance.now() / 1000;
                particle.isDead = false;
                particle.size = 0.1 + Math.random() * 0.15; // Small particles (1-3 pixels at all distances)
                spawned++;
            }
        }
    }

    setScene(scene) {
        this.scene = scene;
        if (this.pointsCloud && !this.pointsCloud.parent) {
            scene.add(this.pointsCloud);
        }
    }

    update(camera = null) {
        if (!this.geometry) return;

        const positions = this.geometry.attributes.position.array;
        const colors = this.geometry.attributes.color.array;
        const sizes = this.geometry.attributes.size.array;
        const currentTime = performance.now() / 1000;
        let activateCount = 0;

        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];

            if (!particle.isDead) {
                const age = currentTime - particle.createdAt;
                const life = Math.max(0, 1.0 - age / particle.maxLifespan);

                if (life <= 0) {
                    particle.isDead = true;
                    // Kill the particle in the geometry
                    sizes[i] = 0;
                } else {
                    // Update physics
                    particle.velocity.y -= 9.8 * 0.016; // Gravity
                    particle.position.addScaledVector(particle.velocity, 0.016);

                    // Update geometry
                    const idx = i * 3;
                    positions[idx] = particle.position.x;
                    positions[idx + 1] = particle.position.y;
                    positions[idx + 2] = particle.position.z;

                    // Aggressive fade-out: use squared life for faster color decay
                    // This prevents particles from lingering as barely-visible specs
                    const colorFade = life * life;
                    colors[idx] = particle.color.r * colorFade;
                    colors[idx + 1] = particle.color.g * colorFade;
                    colors[idx + 2] = particle.color.b * colorFade;

                    // Size fades with life, but also scales by distance to camera
                    let sizeMultiplier = life;
                    if (camera) {
                        const distToCamera = particle.position.distanceTo(camera.position);
                        // Size scales with distance: closer = smaller, farther = larger
                        // This maintains consistent 1-3 pixel appearance across all distances
                        // Reference distance of 50 units: particles at 50 units maintain base size
                        const referenceDistance = 50;
                        sizeMultiplier *= (Math.max(distToCamera, 5) / referenceDistance); // Clamp min distance to 5
                    } else {
                        console.warn("Camera not provided to SparkParticlePool.update() for distance-based sizing.");
                    }
                    sizes[i] = particle.size * sizeMultiplier;
                    activateCount++;
                }
            } else {
                // Ensure dead particles don't render
                sizes[i] = 0;
            }
        }

        // Update geometry only for active particles
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.attributes.size.needsUpdate = true;

        // Always make cloud visible if pool has the cloud (scene was set)
        // The size = 0 for dead particles will hide them naturally
        this.pointsCloud.visible = this.scene !== null;
    }

    clear(scene) {
        if (this.pointsCloud && scene) {
            scene.remove(this.pointsCloud);
        }
        this.particles.forEach(p => p.isDead = true);
    }
}

// ============================================================================
// GLOBAL SPARK POOL INSTANCE
// ============================================================================
export const globalSparkPool = new SparkParticlePool(500);

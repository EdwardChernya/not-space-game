# Weapon System Implementation

## Overview
A complete hitscan cannon weapon system for the viking1 ship with pooled visual effects and asteroid collision detection.

## Files Created

### 1. **weaponSystem.js**
Core weapon system with three main classes:

#### BeamPool
- Object pooling for beam visuals (100 instances by default)
- Prevents excessive garbage collection
- Each beam is a THREE.Line with additive blending
- Beams fade out over 0.2 seconds

#### CannonWeapon
- Represents a single cannon/gun hardpoint
- Properties:
  - `fireRate`: Shots per second (default: 10)
  - `maxRange`: Raycast distance (default: 500)
  - `color`: THREE.Color (default: yellow #ffff00)
  - `brightness`: Opacity multiplier (default: 1.0)
- Methods:
  - `fire(shipForwardAxis, scene, beamPool, currentTime)`: Fire the cannon

#### WeaponManager
- Manages all weapons on a ship
- Auto-discovers gun meshes (viking1_gun_L, viking1_gun_R)
- Alternates firing between guns (L → R → L → ...)
- Methods:
  - `tryFire(shipForwardAxis, currentTime)`: Fire next gun in rotation
  - `update()`: Update visual effects
  - `configureWeapon(index, config)`: Configure specific weapon
  - `configureAllWeapons(config)`: Configure all weapons at once

### 2. **particleEffects.js**
GPU particle system for impact effects:

#### SparkParticlePool
- Pool of 500 reusable particles
- Uses THREE.Points with vertex colors for efficiency
- Features:
  - Configurable color per burst
  - Gravity physics (9.8 units/s²)
  - Size and opacity fade
  - Spread velocity control
- Methods:
  - `spawnBurst(position, color, count, spreadVelocity)`: Spawn particles
  - `update()`: Update particle physics and visibility

## Integration

### input.js Changes
```javascript
export function getMouseLeftDown() // New function
// Tracks left mouse button state
```

### fleetManager.js Changes
- Imports WeaponManager and globalBeamPool
- Exports `localPlayerWeapons`
- Initializes WeaponManager when local ship spawns:
```javascript
localPlayerWeapons = new WeaponManager(shipMesh, playerData.shipType, globalBeamPool, targetScene);
```

### view3d.js Changes
- Imports weapon and particle systems
- Initializes pools in scene during buildDemoScene():
```javascript
globalBeamPool.setScene(gameplayScene);
globalSparkPool.setScene(gameplayScene);
```
- Updates weapons each frame in animate3D():
```javascript
if (localPlayerShip && localPlayerWeapons) {
    const shipForwardAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(localPlayerShip.quaternion);
    if (getMouseLeftDown()) {
        const hit = localPlayerWeapons.tryFire(shipForwardAxis, currentTime);
        if (hit) {
            globalSparkPool.spawnBurst(hit.point, 0xffff00, 8, 15);
        }
    }
    localPlayerWeapons.update();
}
globalSparkPool.update();
```

## Usage

### Basic Firing
Hold left mouse button during gameplay. Cannons alternate fire automatically.

### Configuring Weapons

#### Change fire rate (e.g., 5 shots/second):
```javascript
localPlayerWeapons.configureAllWeapons({ fireRate: 5 });
```

#### Change color (e.g., red):
```javascript
localPlayerWeapons.configureAllWeapons({ color: 0xff0000 });
```

#### Change brightness:
```javascript
localPlayerWeapons.configureAllWeapons({ brightness: 0.5 });
```

#### Change range:
```javascript
localPlayerWeapons.configureAllWeapons({ maxRange: 1000 });
```

#### Configure individual weapon:
```javascript
localPlayerWeapons.configureWeapon(0, { fireRate: 8, brightness: 1.2 });
```

## How It Works

### Firing Flow
1. Player holds left mouse button
2. Each frame, `tryFire()` checks fire rate cooldown
3. If ready, the next gun fires (alternates L/R)
4. Raycaster shoots from gun position along ship's forward axis
5. Checks intersection with all asteroid meshes in scene
6. If hit, returns hit data with point and normal
7. BeamPool creates visual tracer from gun to impact
8. SparkPool spawns particles at impact point

### Visual Effects
- **Beam**: Yellow additive line that fades over 0.2 seconds
- **Particles**: Yellow sparks burst from impact point with gravity

### Asteroid Detection
- Uses existing collision radius system (`userData.collisionRadius`)
- Raycasts against asteroid meshes
- Finds closest intersection per shot
- No damage applied yet (visual-only)

## Performance Considerations
- **BeamPool**: 100 pooled instances (reused, no allocation)
- **ParticlePool**: 500 pooled particles (single THREE.Points mesh)
- **Memory**: Fixed allocation, no GC spikes
- **Network Ready**: Fire events can be broadcast later with minimal changes

## Future Enhancements

### When Ready for Networking
Add to network message types in network.js:
```javascript
// Send when firing
broadcastToAll({
    type: 'WEAPON_FIRE',
    peerId: peer.id,
    position: gunWorldPos,
    direction: shipForwardAxis,
    hit: hitData || null
});
```

### Add Asteroid Damage
```javascript
if (hit && hit.asteroid && hit.asteroid.userData.health) {
    hit.asteroid.userData.health -= damageAmount;
    if (hit.asteroid.userData.health <= 0) {
        removeAsteroid(hit.asteroid.userData.id);
    }
}
```

### Add Weapon Upgrades
Modify weapon config via ship equipment system:
```javascript
// Viking1 upgraded cannons: faster, brighter, different color
localPlayerWeapons.configureAllWeapons({
    fireRate: 15,
    brightness: 1.5,
    color: 0x00ffff // Cyan upgrade
});
```

### Add Ammo System
Track shots/reload in WeaponManager:
```javascript
export class CannonWeapon {
    constructor(...) {
        this.ammo = 100;
        this.maxAmmo = 100;
    }
    
    fire(...) {
        if (this.ammo <= 0) return null;
        // ... fire logic ...
        this.ammo--;
        return hit;
    }
}
```

## Debug Commands
You can test the weapon system through the console:

```javascript
// Find local weapons
localPlayerWeapons

// Check current configuration
localPlayerWeapons.weapons[0]

// Change fire rate on the fly
localPlayerWeapons.configureAllWeapons({ fireRate: 20, brightness: 1.5 })

// Check active beams
globalBeamPool.active.length

// Check active particles
globalSparkPool.particles.filter(p => !p.isDead).length
```

## Testing Checklist
- [x] Left mouse button fires cannons
- [x] Alternating L/R gun fire pattern
- [x] Beam appears from gun to asteroid
- [x] Beam fades over time
- [x] Particles spawn on hit
- [x] Particles fall with gravity
- [x] Pooling works (no memory leaks)
- [x] Fires along ship forward axis
- [x] Hits only asteroids in range
- [ ] Network synchronization (for later)
- [ ] Asteroid damage system (for later)

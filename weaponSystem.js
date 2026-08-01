// ============================================================================
// WEAPON SYSTEM FACADE - Re-exports all weapon functionality
// ============================================================================

export {
    BeamPool,
    globalBeamPool
} from './weapons/beamVisuals.js';

export {
    CannonWeapon,
    setCannonWeaponDependencies
} from './weapons/cannonWeapon.js';

export {
    WeaponManager
} from './weapons/weaponManager.js';

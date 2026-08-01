// ============================================================================
// SHIP PRESETS - Hardcoded starter configurations with inventory constraints
// ============================================================================

export const SHIP_PRESETS = {
    viking1: {
        displayName: 'Viking I',
        weaponInfo: 'Dual cannons',
        lore: 'Human fighter craft of an old era. Dual cannons, medium range, no shields.',
        // Define inventory slots: categories and their maximum count
        inventorySlots: {
            guns: 2,          // max 2 gun hardpoints
            armor: 2,         // max 2 armor plates
            engines: 1,       // single engine block
            exhausts: 6,      // 2 main + 4 aux exhausts
            structural: 1     // hull
        },
        statistics: {
            engineColor: '#4ba8ff', // Default engine glow color for this ship type
            gunColor: '#4ba8ff', // Default gun color for this ship type
            // Health & Shield Configuration
            maxHP: 100,
            shieldCapacity: 0,
            shieldRegenDelay: 3,      // Seconds before shield starts regenerating after taking damage
            hpRegenRate: 5,            // HP per second
            maxRegenPercentage: 0.5,   // HP can only regen up to % of max HP
            // Weapon Configuration
            gunDamage: 10,              // Damage per shot
            canCrit: true, // Whether the ship can score critical hits
            criticalDamageMultiplier: 3, // Damage multiplier for critical hits
            weaponFireRate: 6, // fire rate
            lockAngleDegrees: 10, // Half-angle of the lock cone for targeting
            precisionLockAngleDegrees: 2.5, // Half-angle of the critical lock cone for bonus damage
            range: 800,
            radarRange: 1200,
        },
        // Default loadout when player doesn't customize
        defaultParts: [
            { id: 'viking1_hull',         glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_armor_L',      glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_armor_R',      glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_gun_L',        glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_gun_R',        glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_engines',      glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_main_exhaust_L_additive',   glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_main_exhaust_R_additive',   glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_aux_exhaust_BL_additive',   glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_aux_exhaust_BR_additive',   glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_aux_exhaust_TL_additive',   glowColor: '#4ba8ff', intensity: 1 },
            { id: 'viking1_aux_exhaust_TR_additive',   glowColor: '#4ba8ff', intensity: 1 }
        ]
        // Available parts that players can choose from for customization
        // Format: { id: 'part_id', category: 'guns'|'armor'|'engines'|'exhausts'|'structural', displayName: '...' }
        // TODO: Populate when ready to add customization UI
    }
    // Future ship types can be added here:
    // raptor: { ... },
    // scout: { ... },
    // etc.
};

/**
 * Retrieves a ship preset by type identifier
 * @param {string} shipType - The type of ship (e.g. 'viking1')
 * @returns {object|null} The preset configuration or null if not found
 */
export function getShipPreset(shipType = 'viking1') {
    return SHIP_PRESETS[shipType] || SHIP_PRESETS['viking1'] || null;
}

/**
 * Gets the default parts array for a given ship type
 * @param {string} shipType - The type of ship
 * @returns {array} Array of part configurations
 */
export function getDefaultPartsForShip(shipType = 'viking1') {
    const preset = getShipPreset(shipType);
    if (!preset || !preset.defaultParts) {
        console.warn(`[STATE ENGINE]: No default parts found for ship type: ${shipType}`);
        return [];
    }
    // Deep clone to avoid reference issues
    return JSON.parse(JSON.stringify(preset.defaultParts));
}

/**
 * Validates that custom parts conform to the ship's inventory constraints
 * @param {string} shipType - The type of ship
 * @param {array} customParts - Array of part configurations to validate
 * @returns {boolean} True if valid, false if exceeds constraints
 */
export function validateCustomParts(shipType = 'viking1', customParts = []) {
    const preset = getShipPreset(shipType);
    if (!preset) {
        console.warn(`[STATE ENGINE]: Cannot validate parts for unknown ship type: ${shipType}`);
        return false;
    }

    if (!Array.isArray(customParts)) {
        console.warn(`[STATE ENGINE]: customParts must be an array`);
        return false;
    }

    // If no inventory slots are defined, accept any parts (backward compat)
    if (!preset.inventorySlots) {
        return true;
    }

    // Count parts by category based on part ID prefixes
    const partCounts = {};
    Object.keys(preset.inventorySlots).forEach(category => {
        partCounts[category] = 0;
    });

    // Infer categories from part IDs (e.g., 'viking1_gun_L' -> 'guns')
    customParts.forEach(part => {
        if (!part.id) return;
        const id = part.id.toLowerCase();

        if (id.includes('gun') && preset.inventorySlots.guns) partCounts.guns++;
        else if (id.includes('armor') && preset.inventorySlots.armor) partCounts.armor++;
        else if (id.includes('engine') && !id.includes('exhaust') && preset.inventorySlots.engines) partCounts.engines++;
        else if (id.includes('exhaust') && preset.inventorySlots.exhausts) partCounts.exhausts++;
        else if (id.includes('hull') && preset.inventorySlots.structural) partCounts.structural++;
    });

    // Validate against limits
    for (const [category, maxCount] of Object.entries(preset.inventorySlots)) {
        if (partCounts[category] > maxCount) {
            console.warn(`[STATE ENGINE]: Too many ${category} parts (${partCounts[category]}/${maxCount}) for ${shipType}`);
            return false;
        }
    }

    return true;
}

/**
 * Gets all available ship types
 * @returns {array} Array of available ship type keys
 */
export function getAvailableShipTypes() {
    return Object.keys(SHIP_PRESETS);
}

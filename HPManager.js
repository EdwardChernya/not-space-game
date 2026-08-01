/**
 * HPManager.js - Comprehensive health management system for ships
 * 
 * Features:
 * - HP and Shield system with separate mechanics
 * - Shield regeneration (always back to full after delay)
 * - HP regeneration (capped at a percentage of max HP)
 * - Callbacks for damage, death, and healing events
 */

export class HPManager {
    /**
     * Creates a new HP manager for a ship
     * @param {number} maxHP - Maximum health points
     * @param {number} shieldCapacity - Maximum shield strength
     * @param {number} shieldRegenDelay - Time in seconds before shield starts regenerating after taking damage
     * @param {number} hpRegenRate - HP regenerated per second
     * @param {number} maxRegenPercentage - Maximum percentage of maxHP that can be regenerated (0-1)
     */
    constructor(maxHP = 100, shieldCapacity = 50, shieldRegenDelay = 3, hpRegenRate = 5, maxRegenPercentage = 0.8) {
        // HP Configuration
        this.maxHP = maxHP;
        this.currentHP = maxHP;
        this.maxRegenPercentage = maxRegenPercentage;
        this.maxRegenablHP = maxHP * maxRegenPercentage;
        this.hpRegenRate = hpRegenRate;

        // Shield Configuration
        this.maxShield = shieldCapacity;
        this.currentShield = shieldCapacity;
        this.shieldRegenDelay = shieldRegenDelay;
        
        // Internal state tracking
        this.lastDamageTime = -Infinity; // Time since last damage taken
        this.isDead = false;
        this.hasExploded = false; // Flag to prevent multiple explosions
        this.killFeedback = {
            active: false,
            startTime: -Infinity,
            pulseCount: 0,
            pulseDelay: 0.16
        };

        // Callbacks for lifecycle events
        this.onDamage = null;   // Callback(amount, remainingHP, remainingShield)
        this.onDeath = null;    // Callback(position)
        this.onHeal = null;     // Callback(amount, currentHP)
    }

    /**
     * Returns current HP as a percentage (0-1)
     */
    getHPPercentage() {
        return this.currentHP / this.maxHP;
    }

    /**
     * Returns current shield as a percentage (0-1)
     */
    getShieldPercentage() {
        if (this.maxShield === 0) return 0; // Avoid division by zero
        return this.currentShield / this.maxShield;
    }

    /**
     * Check if this ship is alive
     */
    isAlive() {
        return !this.isDead;
    }

    /**
     * Trigger a brief red X kill feedback on the ship's reticle
     * @param {number} pulseCount - Number of visible blinks
     * @param {number} pulseDelay - Delay between blinks in seconds
     */
    triggerKillFeedback(pulseCount = 1, pulseDelay = 0.3) {
        const currentTime = performance.now() / 1000;
        this.killFeedback = {
            active: true,
            startTime: currentTime,
            pulseCount: Math.max(1, pulseCount),
            pulseDelay: Math.max(0.05, pulseDelay)
        };
    }

    /**
     * Returns whether the kill feedback X should currently be visible
     * @param {number} currentTime - Current time in seconds
     * @returns {boolean}
     */
    getKillFeedbackVisibility(currentTime = performance.now() / 1000) {
        const feedback = this.killFeedback;
        if (!feedback || !feedback.active) return false;

        const totalDuration = feedback.pulseDelay * (feedback.pulseCount * 2 - 1);
        const elapsed = currentTime - feedback.startTime;

        if (elapsed < 0 || elapsed > totalDuration) {
            feedback.active = false;
            return false;
        }

        const phaseIndex = Math.floor(elapsed / feedback.pulseDelay);
        return phaseIndex % 2 === 0 && phaseIndex < feedback.pulseCount * 2 - 1;
    }

    /**
     * Apply damage to the ship
     * Damage is applied to shield first, then overflow goes to HP
     * @param {number} amount - Damage amount
     * @param {THREE.Vector3} damagePosition - Optional position for hit effects
     * @returns {Object} Damage result with shield damage and HP damage breakdown
     */
    takeDamage(amount, damagePosition = null) {
        if (this.isDead || amount <= 0) return null;

        const currentTime = performance.now() / 1000;
        this.lastDamageTime = currentTime;

        let remainingDamage = amount;
        let shieldDamage = 0;
        let hpDamage = 0;

        // Phase 1: Apply damage to shield first
        if (this.currentShield > 0) {
            shieldDamage = Math.min(remainingDamage, this.currentShield);
            this.currentShield -= shieldDamage;
            remainingDamage -= shieldDamage;
        }

        // Phase 2: Overflow damage goes to HP
        if (remainingDamage > 0) {
            hpDamage = Math.min(remainingDamage, this.currentHP);
            this.currentHP -= hpDamage;
        }

        // Phase 3: Check for death
        const wasDead = this.isDead;
        if (this.currentHP <= 0) {
            this.currentHP = 0;
            this.isDead = true;
        }

        // Phase 4: Fire damage callback
        if (this.onDamage) {
            this.onDamage(amount, this.currentHP, this.currentShield, damagePosition);
        }

        // Phase 5: Fire death callback if we just died
        if (!wasDead && this.isDead && this.onDeath) {
            this.onDeath(damagePosition);
        }

        return {
            totalDamage: amount,
            shieldDamage,
            hpDamage,
            overkill: Math.max(0, -this.currentHP),
            isDead: this.isDead
        };
    }

    /**
     * Heal the ship's HP
     * Cannot heal beyond the max regenerable percentage
     * @param {number} amount - Amount to heal
     * @returns {number} Actual amount healed
     */
    heal(amount) {
        if (this.isDead || amount <= 0) return 0;

        const oldHP = this.currentHP;
        const maxHealable = this.maxRegenablHP;
        this.currentHP = Math.min(this.currentHP + amount, maxHealable);
        
        const actualHealed = this.currentHP - oldHP;

        if (actualHealed > 0 && this.onHeal) {
            this.onHeal(actualHealed, this.currentHP);
        }

        return actualHealed;
    }

    /**
     * Update HP manager state
     * Handles shield regeneration and passive HP regeneration
     * @param {number} deltaTime - Time elapsed since last frame (seconds)
     */
    update(deltaTime) {
        if (this.isDead) return;

        const currentTime = performance.now() / 1000;
        const timeSinceLastDamage = currentTime - this.lastDamageTime;

        // Shield Regeneration: Always regenerates back to full after the delay
        if (timeSinceLastDamage >= this.shieldRegenDelay && this.currentShield < this.maxShield) {
            // Regen to full instantly when enough time has passed
            this.currentShield = this.maxShield;
        }

        // HP Regeneration: Passive healing over time up to the regennable cap
        if (this.currentHP < this.maxRegenablHP) {
            const healAmount = this.hpRegenRate * deltaTime;
            this.heal(healAmount);
        }
    }

    /**
     * Reset HP and shield to full (for respawning)
     */
    respawn() {
        this.currentHP = this.maxHP;
        this.currentShield = this.maxShield;
        this.isDead = false;
        this.hasExploded = false;
        this.lastDamageTime = -Infinity;
        this.killFeedback.active = false;
    }

    /**
     * Get current state as serializable object
     */
    serialize() {
        return {
            currentHP: this.currentHP,
            maxHP: this.maxHP,
            currentShield: this.currentShield,
            maxShield: this.maxShield,
            isDead: this.isDead,
            hpPercent: this.getHPPercentage(),
            shieldPercent: this.getShieldPercentage()
        };
    }
}

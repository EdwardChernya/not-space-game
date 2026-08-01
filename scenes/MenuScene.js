import * as THREE from 'three';
import { buildDefaultShip } from '../shipBuilder.js';

/**
 * Menu Scene Setup
 * This module contains all the logic for setting up the main menu/lobby scene.
 */

let menuScene = null;
let menuShowcaseShip = null;

export function buildMenuScene() {
    menuScene = new THREE.Scene();
    menuScene.background = new THREE.Color('#000000'); 

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.6);
    menuScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight('#00e1ff', 1.0); 
    directionalLight.position.set(10, 15, 10);
    menuScene.add(directionalLight);

    menuShowcaseShip = buildDefaultShip();

    if (menuShowcaseShip) {
        menuShowcaseShip.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        menuScene.add(menuShowcaseShip);
    } else {
        console.error("[3D ENGINE]: Custom asset factory failed to compile meshes.");
        const geometry = new THREE.TorusGeometry(2, 0.5, 16, 100);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff88, wireframe: true });
        
        menuShowcaseShip = new THREE.Group();
        menuShowcaseShip.add(new THREE.Mesh(geometry, material));
        menuScene.add(menuShowcaseShip);
    }

    return menuScene;
}

export function getMenuScene() {
    return menuScene;
}

export function getMenuShowcaseShip() {
    return menuShowcaseShip;
}

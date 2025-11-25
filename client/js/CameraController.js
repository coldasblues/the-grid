import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * CameraController - First-person controls for The Grid
 *
 * Features:
 * - PointerLock mouse look
 * - WASD movement
 * - Follow mode for tracking residents
 * - Cinematic auto-camera
 */
export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Controls
    this.controls = new PointerLockControls(camera, domElement);

    // Movement state
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;

    // Movement config
    this.moveSpeed = 15;
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    // Mode
    this.mode = 'fly';  // 'fly', 'follow', 'cinematic', 'orbit'
    this.followTarget = null;
    this.followOffset = new THREE.Vector3(0, 3, 8);

    // Cinematic state
    this.cinematicEnabled = false;
    this.cinematicTargets = [];
    this.cinematicIndex = 0;
    this.cinematicTransitionTime = 5;

    // Callbacks
    this.onLockCallback = null;
    this.onUnlockCallback = null;

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Pointer lock events
    this.controls.addEventListener('lock', () => {
      console.log('[CameraController] Pointer locked');
      if (this.onLockCallback) this.onLockCallback();
    });

    this.controls.addEventListener('unlock', () => {
      console.log('[CameraController] Pointer unlocked');
      if (this.onUnlockCallback) this.onUnlockCallback();
    });
  }

  onKeyDown(event) {
    // Don't capture input if console is focused
    if (event.target.tagName === 'INPUT') return;

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = true;
        break;
      case 'ShiftLeft':
        this.moveSpeed = 30;  // Sprint
        break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = false;
        break;
      case 'ShiftLeft':
        this.moveSpeed = 15;
        break;
    }
  }

  /**
   * Lock pointer (enter first-person mode)
   */
  lock() {
    this.controls.lock();
  }

  /**
   * Unlock pointer (exit first-person mode)
   */
  unlock() {
    this.controls.unlock();
  }

  isLocked() {
    return this.controls.isLocked;
  }

  /**
   * Set camera mode
   */
  setMode(mode) {
    this.mode = mode;
    console.log(`[CameraController] Mode: ${mode}`);

    if (mode === 'fly') {
      this.followTarget = null;
    }
  }

  /**
   * Follow a specific resident
   */
  followResident(residentGroup, offset = null) {
    this.mode = 'follow';
    this.followTarget = residentGroup;
    if (offset) {
      this.followOffset.copy(offset);
    }
  }

  /**
   * Enable cinematic auto-camera
   */
  cinematicMode(enabled, targets = []) {
    this.cinematicEnabled = enabled;
    this.cinematicTargets = targets;
    this.cinematicIndex = 0;

    if (enabled) {
      this.mode = 'cinematic';
    } else {
      this.mode = 'fly';
    }
  }

  /**
   * Update - call every frame
   */
  update(delta) {
    if (this.mode === 'fly' && this.controls.isLocked) {
      // First-person fly mode
      this.updateFlyMode(delta);
    } else if (this.mode === 'follow' && this.followTarget) {
      // Follow mode
      this.updateFollowMode(delta);
    } else if (this.mode === 'cinematic') {
      // Cinematic mode
      this.updateCinematicMode(delta);
    }
  }

  updateFlyMode(delta) {
    // Apply deceleration
    this.velocity.x -= this.velocity.x * 10.0 * delta;
    this.velocity.z -= this.velocity.z * 10.0 * delta;

    // Calculate direction
    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
    this.direction.normalize();

    // Apply acceleration
    if (this.moveForward || this.moveBackward) {
      this.velocity.z -= this.direction.z * this.moveSpeed * delta;
    }
    if (this.moveLeft || this.moveRight) {
      this.velocity.x -= this.direction.x * this.moveSpeed * delta;
    }

    // Move
    this.controls.moveRight(-this.velocity.x * delta);
    this.controls.moveForward(-this.velocity.z * delta);

    // Clamp height
    if (this.camera.position.y < 1) {
      this.camera.position.y = 1;
    }
    if (this.camera.position.y > 50) {
      this.camera.position.y = 50;
    }
  }

  updateFollowMode(delta) {
    if (!this.followTarget) return;

    const targetPos = this.followTarget.position.clone();

    // Calculate desired camera position
    const desiredPos = targetPos.clone().add(this.followOffset);

    // Smooth follow
    this.camera.position.lerp(desiredPos, delta * 3);

    // Look at target
    this.camera.lookAt(targetPos);
  }

  updateCinematicMode(delta) {
    // Auto-cycle between interesting points
    // (Simplified implementation)
    if (this.cinematicTargets.length === 0) return;

    const target = this.cinematicTargets[this.cinematicIndex];
    if (!target) return;

    // Move toward target
    this.camera.position.lerp(target.position, delta * 0.5);

    if (target.lookAt) {
      const lookTarget = new THREE.Vector3().copy(target.lookAt);
      // Smooth look
      const currentLook = new THREE.Vector3();
      this.camera.getWorldDirection(currentLook);
    }
  }

  /**
   * Get camera position
   */
  getPosition() {
    return this.camera.position.clone();
  }

  /**
   * Set camera position
   */
  setPosition(x, y, z) {
    this.camera.position.set(x, y, z);
  }

  /**
   * Set lock/unlock callbacks
   */
  onLock(callback) {
    this.onLockCallback = callback;
  }

  onUnlock(callback) {
    this.onUnlockCallback = callback;
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
  }
}

export default CameraController;

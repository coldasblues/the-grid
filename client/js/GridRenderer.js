import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * GridRenderer - Main Three.js renderer for The Grid
 *
 * Optimized for low VRAM usage:
 * - Uses InstancedMesh for floor grid and buildings
 * - Wireframe materials (no textures)
 * - Minimal geometry complexity
 * - Shared materials where possible
 */
export class GridRenderer {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;

    this.residents = new Map();  // id -> THREE.Group
    this.buildings = [];
    this.clock = new THREE.Clock();

    // Configuration
    this.config = {
      gridSize: 200,
      gridDivisions: 100,
      buildingCount: 50,
      fogNear: 10,
      fogFar: 150,
      bloomStrength: 1.5,
      bloomRadius: 0.4,
      bloomThreshold: 0.1
    };
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000a0a);
    this.scene.fog = new THREE.Fog(0x001a1a, this.config.fogNear, this.config.fogFar);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 2, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance
    this.container.appendChild(this.renderer.domElement);

    // Post-processing
    this.setupPostProcessing();

    // Create environment
    this.createGrid();
    this.createBuildings();
    this.createAmbientParticles();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    console.log('[GridRenderer] Initialized');
    return this;
  }

  setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.config.bloomStrength,
      this.config.bloomRadius,
      this.config.bloomThreshold
    );
    this.composer.addPass(bloomPass);
  }

  createGrid() {
    // Main grid floor using GridHelper
    const gridHelper = new THREE.GridHelper(
      this.config.gridSize,
      this.config.gridDivisions,
      0x00ffcc,  // Center line color
      0x004444   // Grid color
    );
    gridHelper.position.y = 0;
    this.scene.add(gridHelper);

    // Secondary larger grid for depth
    const gridHelper2 = new THREE.GridHelper(
      this.config.gridSize * 4,
      this.config.gridDivisions,
      0x002222,
      0x001111
    );
    gridHelper2.position.y = -0.01;
    this.scene.add(gridHelper2);

    // Ground plane (invisible, for raycasting)
    const groundGeometry = new THREE.PlaneGeometry(
      this.config.gridSize * 4,
      this.config.gridSize * 4
    );
    const groundMaterial = new THREE.MeshBasicMaterial({
      visible: false
    });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.scene.add(this.ground);
  }

  createBuildings() {
    // Use InstancedMesh for efficient rendering of many buildings
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffcc,
      wireframe: true,
      transparent: true,
      opacity: 0.6
    });

    const instanceCount = this.config.buildingCount;
    const instancedMesh = new THREE.InstancedMesh(
      buildingGeometry,
      buildingMaterial,
      instanceCount
    );

    const dummy = new THREE.Object3D();
    const halfGrid = this.config.gridSize / 2;

    for (let i = 0; i < instanceCount; i++) {
      // Random position
      const x = (Math.random() - 0.5) * this.config.gridSize * 1.5;
      const z = (Math.random() - 0.5) * this.config.gridSize * 1.5;

      // Avoid center area where player spawns
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

      // Random size
      const width = 2 + Math.random() * 6;
      const height = 5 + Math.random() * 30;
      const depth = 2 + Math.random() * 6;

      dummy.position.set(x, height / 2, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);

      this.buildings.push({ x, z, width, height, depth });
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(instancedMesh);
    this.buildingMesh = instancedMesh;
  }

  createAmbientParticles() {
    // Floating particles for atmosphere
    const particleCount = 500;
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * this.config.gridSize;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.config.gridSize;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x00ffcc,
      size: 0.1,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  /**
   * Spawn a resident in the Grid
   */
  spawnResident(soulCard, position) {
    if (this.residents.has(soulCard.id)) {
      console.warn(`[GridRenderer] Resident ${soulCard.id} already exists`);
      return this.residents.get(soulCard.id);
    }

    const residentGroup = this.createResidentMesh(soulCard);
    residentGroup.position.set(
      position?.x || 0,
      position?.y || 0,
      position?.z || 0
    );

    this.scene.add(residentGroup);
    this.residents.set(soulCard.id, {
      group: residentGroup,
      soul: soulCard,
      animationPhase: Math.random() * Math.PI * 2
    });

    console.log(`[GridRenderer] Spawned resident: ${soulCard.name}`);
    return residentGroup;
  }

  createResidentMesh(soulCard) {
    const group = new THREE.Group();
    const form = soulCard.form || {};
    const color = new THREE.Color(form.color || '#00ffcc');

    // Material
    const material = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
      transparent: true,
      opacity: 0.9
    });

    // Head - geometric primitive
    const headType = form.head?.type || 'icosahedron';
    const headScale = form.head?.scale || 0.35;
    const headGeometry = this.getGeometry(headType, headScale);
    const head = new THREE.Mesh(headGeometry, material);
    head.position.y = (form.height || 1.8) - headScale;
    group.add(head);

    // Torso
    const torsoType = form.torso?.type || 'octahedron';
    const torsoScale = form.torso?.scale || [0.4, 0.6, 0.3];
    const torsoGeometry = this.getGeometry(torsoType, 1);
    const torso = new THREE.Mesh(torsoGeometry, material.clone());
    torso.scale.set(
      Array.isArray(torsoScale) ? torsoScale[0] : torsoScale,
      Array.isArray(torsoScale) ? torsoScale[1] : torsoScale,
      Array.isArray(torsoScale) ? torsoScale[2] : torsoScale * 0.5
    );
    torso.position.y = (form.height || 1.8) * 0.5;
    group.add(torso);

    // Simple limbs (cylinders)
    const limbMaterial = material.clone();
    limbMaterial.opacity = 0.7;

    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.03, 0.02, 0.5, form.limbs?.segments || 6);
    const leftArm = new THREE.Mesh(armGeometry, limbMaterial);
    leftArm.position.set(-0.4, (form.height || 1.8) * 0.5, 0);
    leftArm.rotation.z = Math.PI / 6;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, limbMaterial);
    rightArm.position.set(0.4, (form.height || 1.8) * 0.5, 0);
    rightArm.rotation.z = -Math.PI / 6;
    group.add(rightArm);

    // Legs
    const legGeometry = new THREE.CylinderGeometry(0.04, 0.03, 0.6, form.limbs?.segments || 6);
    const leftLeg = new THREE.Mesh(legGeometry, limbMaterial);
    leftLeg.position.set(-0.15, 0.3, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, limbMaterial);
    rightLeg.position.set(0.15, 0.3, 0);
    group.add(rightLeg);

    // Glyph on chest
    if (form.glyph) {
      const glyphGeometry = this.getGlyphGeometry(form.glyph.shape || 'hexagon');
      const glyphMaterial = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: false,
        transparent: true,
        opacity: 0.8
      });
      const glyph = new THREE.Mesh(glyphGeometry, glyphMaterial);
      glyph.scale.set(0.1, 0.1, 0.1);
      glyph.position.set(0, (form.height || 1.8) * 0.5, 0.2);
      group.add(glyph);
    }

    // Store reference for animations
    group.userData = {
      head,
      torso,
      soulCard
    };

    return group;
  }

  getGeometry(type, scale = 1) {
    switch (type) {
      case 'icosahedron':
        return new THREE.IcosahedronGeometry(scale, 0);
      case 'dodecahedron':
        return new THREE.DodecahedronGeometry(scale, 0);
      case 'octahedron':
        return new THREE.OctahedronGeometry(scale, 0);
      case 'tetrahedron':
        return new THREE.TetrahedronGeometry(scale, 0);
      case 'box':
        return new THREE.BoxGeometry(scale, scale, scale);
      case 'cylinder':
        return new THREE.CylinderGeometry(scale * 0.5, scale * 0.5, scale, 8);
      case 'double-pyramid':
        return new THREE.OctahedronGeometry(scale, 0);
      case 'sphere':
        return new THREE.SphereGeometry(scale, 8, 6);
      default:
        return new THREE.IcosahedronGeometry(scale, 0);
    }
  }

  getGlyphGeometry(shape) {
    switch (shape) {
      case 'triangle':
        return new THREE.CircleGeometry(1, 3);
      case 'square':
        return new THREE.CircleGeometry(1, 4);
      case 'hexagon':
        return new THREE.CircleGeometry(1, 6);
      case 'circle':
        return new THREE.CircleGeometry(1, 16);
      case 'star':
        return new THREE.CircleGeometry(1, 5); // Simplified
      default:
        return new THREE.CircleGeometry(1, 6);
    }
  }

  /**
   * Move a resident to a new position
   */
  moveResident(id, toPosition, duration = 1000) {
    const resident = this.residents.get(id);
    if (!resident) return;

    const group = resident.group;
    const startPos = group.position.clone();
    const endPos = new THREE.Vector3(toPosition.x, toPosition.y || 0, toPosition.z);
    const startTime = this.clock.getElapsedTime();

    // Animation function
    const animate = () => {
      const elapsed = (this.clock.getElapsedTime() - startTime) * 1000;
      const progress = Math.min(elapsed / duration, 1);

      // Ease in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      group.position.lerpVectors(startPos, endPos, eased);

      // Face movement direction
      if (progress < 1) {
        const direction = endPos.clone().sub(startPos).normalize();
        if (direction.length() > 0.01) {
          group.rotation.y = Math.atan2(direction.x, direction.z);
        }
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  /**
   * Remove a resident from the Grid
   */
  removeResident(id) {
    const resident = this.residents.get(id);
    if (!resident) return;

    this.scene.remove(resident.group);
    resident.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });

    this.residents.delete(id);
    console.log(`[GridRenderer] Removed resident: ${id}`);
  }

  /**
   * Update resident position directly
   */
  updateResidentPosition(id, position) {
    const resident = this.residents.get(id);
    if (!resident) return;

    resident.group.position.set(position.x, position.y || 0, position.z);
  }

  /**
   * Highlight a resident (for selection)
   */
  highlightResident(id, highlight = true) {
    const resident = this.residents.get(id);
    if (!resident) return;

    resident.group.traverse(obj => {
      if (obj.material) {
        obj.material.opacity = highlight ? 1 : 0.9;
      }
    });
  }

  /**
   * Animation loop
   */
  render() {
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Animate residents (pulse effect)
    this.residents.forEach((resident, id) => {
      const phase = resident.animationPhase;
      const pulse = 1 + Math.sin(elapsed * 2 + phase) * 0.05;

      if (resident.group.userData.head) {
        resident.group.userData.head.scale.setScalar(pulse);
      }

      // Subtle hover
      resident.group.position.y = Math.sin(elapsed * 1.5 + phase) * 0.05;
    });

    // Animate particles
    if (this.particles) {
      const positions = this.particles.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += delta * 0.5;
        if (positions[i + 1] > 30) {
          positions[i + 1] = 0;
        }
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // Render with post-processing
    this.composer.render();
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  getCamera() {
    return this.camera;
  }

  getScene() {
    return this.scene;
  }

  getDomElement() {
    return this.renderer.domElement;
  }

  dispose() {
    // Clean up resources
    this.residents.forEach((resident, id) => {
      this.removeResident(id);
    });

    this.renderer.dispose();
    this.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}

export default GridRenderer;

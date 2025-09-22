import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BrushSystem } from '../../sim/BrushSystem';
import { createBrushDecalMaterialTSL } from '../materials/BrushDecalMaterialTSL';

export interface BrushInteractionHandlerOptions {
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  controls: OrbitControls;
  terrainSize: number;
  gridSize: number;
}

export class BrushInteractionHandler {
  private camera: THREE.Camera;
  private canvas: HTMLCanvasElement;
  private controls: OrbitControls;
  private terrainSize: number;
  private gridSize: number;

  // Brush state
  private brushSystem?: BrushSystem;
  private brushHovering = false;
  private brushReady = false;
  private brushActive = false;
  private temporaryModeInvert = false;
  private brushMode: 'pickup' | 'deposit' = 'pickup';
  private brushMaterial: 'soil' | 'rock' | 'lava' = 'soil';
  private brushRadius = 10;
  private brushStrength = 1000;
  private brushHandMass = 0;
  private brushHandCapacity = 10000;

  // Visual elements
  private brushCursorSphere?: THREE.Mesh;
  private brushCursorRing?: THREE.Line;
  private brushCursorMaterial?: THREE.MeshPhysicalMaterial;
  private brushModeIndicator?: THREE.Group;
  private brushDecalMesh?: THREE.Mesh;
  private brushDecalMaterial?: any;
  private lastBrushWorldPos?: THREE.Vector3;

  // Event handlers
  private animationFrameId: number | null = null;
  private eventHandlers: any = {};

  // Callbacks
  private getHeightAtWorldPos?: (x: number, z: number) => number;
  private getTerrainMesh?: () => THREE.Mesh | undefined;

  constructor(options: BrushInteractionHandlerOptions) {
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.controls = options.controls;
    this.terrainSize = options.terrainSize;
    this.gridSize = options.gridSize;
  }

  public initialize(scene: THREE.Scene): void {
    this.createBrushCursor(scene);
    this.setupEventHandlers();
  }

  public setBrushSystem(brushSystem: BrushSystem): void {
    this.brushSystem = brushSystem;
  }

  public setHeightCallback(callback: (x: number, z: number) => number): void {
    this.getHeightAtWorldPos = callback;
  }

  public setTerrainMeshCallback(callback: () => THREE.Mesh | undefined): void {
    this.getTerrainMesh = callback;
  }

  public syncBrushFromUI(): void {
    const uiStore = (window as any).__uiStore;
    if (uiStore) {
      const brushState = uiStore.getState().brush;
      this.brushMode = brushState.mode;
      this.brushMaterial = brushState.material;
      this.brushRadius = brushState.radius;
      this.brushStrength = brushState.strength;
      this.brushHandMass = brushState.handMass;
      this.brushHandCapacity = brushState.handCapacity;

      // Update brush decal material if it exists
      if (this.brushDecalMaterial?.brushUniforms) {
        this.brushDecalMaterial.brushUniforms.radius.value = this.brushRadius;
        this.brushDecalMaterial.brushUniforms.mode.value = this.brushMode === 'pickup' ? 0 : 1;
        const matValue = this.brushMaterial === 'soil' ? 0 : this.brushMaterial === 'rock' ? 1 : 2;
        this.brushDecalMaterial.brushUniforms.material.value = matValue;
      }
    }
  }

  private createBrushCursor(scene: THREE.Scene): void {
    // Create brush decal overlay plane
    const decalGeometry = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, 1, 1);
    decalGeometry.rotateX(-Math.PI / 2);

    this.brushDecalMaterial = createBrushDecalMaterialTSL({
      brushPosition: new THREE.Vector2(0, 0),
      brushRadius: 5,
      brushMode: 'pickup',
      brushMaterial: 'soil',
      brushState: 0
    });

    this.brushDecalMesh = new THREE.Mesh(decalGeometry, this.brushDecalMaterial);
    this.brushDecalMesh.position.y = 0.5;
    this.brushDecalMesh.renderOrder = 1000;
    this.brushDecalMesh.visible = false;
    scene.add(this.brushDecalMesh);

    // Create sphere for brush volume indicator
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);

    this.brushCursorMaterial = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: 0.3,
      roughness: 0.3,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    this.brushCursorSphere = new THREE.Mesh(sphereGeometry, this.brushCursorMaterial);
    this.brushCursorSphere.visible = false;
    this.brushCursorSphere.renderOrder = 100;
    scene.add(this.brushCursorSphere);

    // Create ring
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      points.push(new THREE.Vector3(x, 0, z));
    }

    const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.8,
      transparent: true,
      linewidth: 3,
      depthTest: false,
      depthWrite: false,
    });

    this.brushCursorRing = new THREE.Line(ringGeometry, ringMaterial);
    this.brushCursorRing.visible = false;
    this.brushCursorRing.renderOrder = 999;
    scene.add(this.brushCursorRing);

    this.createModeIndicator(scene);
  }

  private createModeIndicator(scene: THREE.Scene): void {
    this.brushModeIndicator = new THREE.Group();

    // Create upward arrows for pickup mode
    const arrowGeometry = new THREE.ConeGeometry(0.5, 2, 8);
    const upArrowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00AAFF,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(arrowGeometry, upArrowMaterial.clone());
      const angle = (i / 3) * Math.PI * 2;
      const baseX = Math.cos(angle) * 2.5;
      const baseZ = Math.sin(angle) * 2.5;
      arrow.userData = { baseX, baseZ };
      arrow.position.set(baseX, 1, baseZ);
      arrow.name = 'pickup-arrow';
      this.brushModeIndicator.add(arrow);
    }

    // Create downward arrows for deposit mode
    const downArrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFAA00,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(arrowGeometry, downArrowMaterial.clone());
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const baseX = Math.cos(angle) * 2.5;
      const baseZ = Math.sin(angle) * 2.5;
      arrow.userData = { baseX, baseZ };
      arrow.position.set(baseX, 0.5, baseZ);
      arrow.rotation.x = Math.PI;
      arrow.name = 'deposit-arrow';
      arrow.visible = false;
      this.brushModeIndicator.add(arrow);
    }

    // Create material particles
    const particleGeometry = new THREE.SphereGeometry(0.2, 8, 8);

    const materials = [
      new THREE.MeshBasicMaterial({ color: 0x8B6914, transparent: true, opacity: 0.7 }), // soil
      new THREE.MeshBasicMaterial({ color: 0x5A5A5A, transparent: true, opacity: 0.7 }), // rock
      new THREE.MeshBasicMaterial({ color: 0xFF4500, transparent: true, opacity: 0.8 })  // lava
    ];

    const materialNames = ['soil', 'rock', 'lava'];

    materials.forEach((material, matIndex) => {
      for (let i = 0; i < 5; i++) {
        const particle = new THREE.Mesh(particleGeometry, material);
        const angle = (i / 5) * Math.PI * 2;
        const radius = 2 + Math.random() * 2;
        particle.position.x = Math.cos(angle) * radius;
        particle.position.z = Math.sin(angle) * radius;
        particle.position.y = 3 + Math.random() * 2;
        particle.name = `${materialNames[matIndex]}-particle`;
        particle.visible = false;
        this.brushModeIndicator?.add(particle);
      }
    });

    this.brushModeIndicator.visible = false;
    scene.add(this.brushModeIndicator);
  }

  private setupEventHandlers(): void {
    let lastWorldPos: THREE.Vector3 | undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = false;
      }

      if (event.key === 'Alt' || event.altKey) {
        this.brushReady = true;
        this.brushHovering = false;
        this.temporaryModeInvert = event.metaKey;
        if (lastWorldPos) {
          this.updateBrushCursor(lastWorldPos);
        }
      }

      if (event.key === 'Meta' || event.metaKey) {
        this.temporaryModeInvert = true;
        if (lastWorldPos && this.brushReady) {
          this.updateBrushCursor(lastWorldPos);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = true;
      }

      if (event.key === 'Alt' || !event.altKey) {
        this.brushReady = false;
        this.brushActive = false;
        this.brushHovering = !!lastWorldPos;
        this.temporaryModeInvert = false;
        if (lastWorldPos) {
          this.updateBrushCursor(lastWorldPos);
        } else {
          this.updateBrushCursor();
        }
      }

      if (event.key === 'Meta' || !event.metaKey) {
        this.temporaryModeInvert = false;
        if (lastWorldPos && (this.brushReady || this.brushHovering)) {
          this.updateBrushCursor(lastWorldPos);
        }
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      const terrainMesh = this.getTerrainMesh?.();
      if (terrainMesh) {
        const intersects = raycaster.intersectObject(terrainMesh);
        if (intersects.length > 0) {
          const baseHit = intersects[0].point;
          lastWorldPos = this.performRayMarching(baseHit, raycaster);

          if (event.altKey) {
            this.brushReady = true;
            this.brushHovering = false;
            this.temporaryModeInvert = event.metaKey;
          } else {
            this.brushReady = false;
            if (!this.brushActive) {
              this.brushHovering = true;
            }
            this.temporaryModeInvert = false;
          }

          this.updateBrushCursor(lastWorldPos);
        } else {
          lastWorldPos = undefined;
          this.brushHovering = false;
          this.brushReady = false;
          if (!event.buttons) {
            this.brushActive = false;
          }
          this.updateBrushCursor();
        }
      }
    };

    const performBrushOperation = () => {
      if (this.brushActive && this.brushSystem && lastWorldPos) {
        // Apply temporary mode invert if Meta key is pressed
        const actualMode = this.temporaryModeInvert ?
          (this.brushMode === 'pickup' ? 'deposit' : 'pickup') :
          this.brushMode;

        // Get height at brush position for debugging
        const heightMeters = this.getHeightAtWorldPos?.(lastWorldPos.x, lastWorldPos.z) ?? 0;
        const heightNormalized = heightMeters / 64.0; // Convert to normalized
        const waterLevelNormalized = 0.15;
        const isUnderwater = heightNormalized < waterLevelNormalized;

        console.log(`Brush op at (${lastWorldPos.x.toFixed(1)}, ${lastWorldPos.z.toFixed(1)}):`, {
          mode: actualMode,
          material: this.brushMaterial,
          heightNormalized: heightNormalized.toFixed(3),
          heightMeters: heightMeters.toFixed(1) + 'm',
          isUnderwater,
          waterLevel: '9.6m (0.15 normalized)'
        });

        this.brushSystem.addBrushOp(
          actualMode,
          this.brushMaterial,
          lastWorldPos.x,
          lastWorldPos.z,
          this.brushRadius,
          this.brushStrength,
          0.016
        );

        this.updateBrushCursor(lastWorldPos);
        this.animationFrameId = requestAnimationFrame(performBrushOperation);
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.altKey && event.button === 0) {
        this.brushActive = true;
        this.temporaryModeInvert = event.metaKey;
        if (lastWorldPos) {
          this.updateBrushCursor(lastWorldPos);
        }
        performBrushOperation();
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        this.brushActive = false;
        this.temporaryModeInvert = false;

        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }

        if (event.altKey && lastWorldPos) {
          this.brushReady = true;
          this.temporaryModeInvert = event.metaKey;
          this.updateBrushCursor(lastWorldPos);
        } else {
          this.brushReady = false;
          this.updateBrushCursor();
        }
      }
    };

    const handleMouseLeave = () => {
      if (this.brushActive) {
        this.brushActive = false;
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
      }
      this.brushHovering = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    this.canvas.addEventListener('mouseleave', handleMouseLeave);

    this.eventHandlers = {
      handleKeyDown,
      handleKeyUp,
      handleMouseMove,
      handleMouseDown,
      handleMouseUp,
      handleMouseLeave
    };
  }

  private performRayMarching(baseHit: THREE.Vector3, raycaster: THREE.Raycaster): THREE.Vector3 {
    // Use the ray direction from the raycaster for accuracy
    const rayOrigin = raycaster.ray.origin.clone();
    const rayDir = raycaster.ray.direction.clone();

    // Start ray marching from camera position to find FIRST intersection
    const maxDistance = 300;
    let stepSize = 2.0; // Start with larger steps for efficiency
    let lastAboveGround = true;
    let foundHit = false;
    let closestPoint = baseHit.clone(); // Fallback to base hit

    for (let distance = 0; distance < maxDistance && !foundHit; distance += stepSize) {
      const samplePoint = new THREE.Vector3();
      samplePoint.copy(rayOrigin).addScaledVector(rayDir, distance);

      // Skip if outside reasonable bounds
      if (Math.abs(samplePoint.x) > 50 || Math.abs(samplePoint.z) > 50) {
        continue;
      }

      const actualHeight = this.getHeightAtWorldPos?.(samplePoint.x, samplePoint.z);
      if (actualHeight === undefined || actualHeight === null) continue;

      const isAboveGround = samplePoint.y > actualHeight;

      // Check if we crossed the terrain surface (going from above to below)
      if (lastAboveGround && !isAboveGround) {
        // We've crossed the surface - refine with binary search
        let low = Math.max(0, distance - stepSize);
        let high = distance;

        // Binary search for exact intersection
        for (let j = 0; j < 10; j++) {
          const mid = (low + high) / 2;
          const testPoint = new THREE.Vector3();
          testPoint.copy(rayOrigin).addScaledVector(rayDir, mid);

          const testHeight = this.getHeightAtWorldPos?.(testPoint.x, testPoint.z) ?? 0;

          if (Math.abs(testPoint.y - testHeight) < 0.05) {
            // Found accurate intersection
            return new THREE.Vector3(testPoint.x, testHeight, testPoint.z);
          }

          if (testPoint.y > testHeight) {
            low = mid;
          } else {
            high = mid;
          }
        }

        // Use the refined position even if not exact
        const finalPoint = new THREE.Vector3();
        finalPoint.copy(rayOrigin).addScaledVector(rayDir, (low + high) / 2);
        const finalHeight = this.getHeightAtWorldPos?.(finalPoint.x, finalPoint.z) ?? 0;
        return new THREE.Vector3(finalPoint.x, finalHeight, finalPoint.z);
      }

      lastAboveGround = isAboveGround;

      // Adaptive step size - smaller steps when close to terrain
      const distToSurface = Math.abs(samplePoint.y - actualHeight);
      if (distToSurface < 5) {
        stepSize = Math.min(stepSize, 0.5);
      } else if (distToSurface < 10) {
        stepSize = Math.min(stepSize, 1.0);
      }

      // Track closest point as fallback
      if (distToSurface < Math.abs(closestPoint.y - actualHeight)) {
        closestPoint.set(samplePoint.x, actualHeight, samplePoint.z);
      }
    }

    // If no crossing found, return the closest point we found
    return closestPoint;
  }

  private updateBrushCursor(worldPos?: THREE.Vector3): void {
    if (!this.brushModeIndicator) return;

    // Update brush decal overlay
    if (this.brushDecalMesh && this.brushDecalMaterial?.brushUniforms) {
      if (worldPos && (this.brushHovering || this.brushReady || this.brushActive)) {
        // Update decal uniforms
        this.brushDecalMaterial.brushUniforms.position.value.set(worldPos.x, worldPos.z);
        this.brushDecalMaterial.brushUniforms.radius.value = this.brushRadius;

        // Determine actual mode with temporary invert
        const actualMode = this.temporaryModeInvert ?
          (this.brushMode === 'pickup' ? 'deposit' : 'pickup') :
          this.brushMode;
        this.brushDecalMaterial.brushUniforms.mode.value = actualMode === 'pickup' ? 0 : 1;

        // Update material type
        const matValue = this.brushMaterial === 'soil' ? 0 : this.brushMaterial === 'rock' ? 1 : 2;
        this.brushDecalMaterial.brushUniforms.material.value = matValue;

        // Update state (0=hidden, 1=hovering, 2=ready, 3=active)
        let state = 0;
        if (this.brushActive) state = 3;
        else if (this.brushReady) state = 2;
        else if (this.brushHovering) state = 1;
        this.brushDecalMaterial.brushUniforms.state.value = state;

        // Update time for animation
        this.brushDecalMaterial.brushUniforms.time.value = performance.now() * 0.001;

        this.brushDecalMesh.visible = true;
      } else {
        this.brushDecalMesh.visible = false;
      }
    }

    // Hide everything when not in brush mode
    if (!worldPos || (!this.brushHovering && !this.brushReady && !this.brushActive)) {
      this.brushModeIndicator.visible = false;
      return;
    }

    // Show mode indicator when brush is ready or active
    if (this.brushReady || this.brushActive) {
      this.brushModeIndicator.visible = true;
      this.brushModeIndicator.position.set(worldPos.x, worldPos.y, worldPos.z);

      // Determine actual mode (considering temporary invert)
      const actualMode = this.temporaryModeInvert ?
        (this.brushMode === 'pickup' ? 'deposit' : 'pickup') :
        this.brushMode;

      // Update arrow visibility and animation
      const pickupArrows = this.brushModeIndicator.children.filter(c => c.name === 'pickup-arrow');
      const depositArrows = this.brushModeIndicator.children.filter(c => c.name === 'deposit-arrow');

      // Scale arrows radius to match brush radius
      const arrowRadius = this.brushRadius * 0.7; // Position arrows at 70% of brush radius

      pickupArrows.forEach((arrow: any, index: number) => {
        arrow.visible = actualMode === 'pickup';

        // Position arrow around the brush radius
        const angle = (index / 3) * Math.PI * 2;
        arrow.position.x = Math.cos(angle) * arrowRadius;
        arrow.position.z = Math.sin(angle) * arrowRadius;

        if (arrow.visible && this.brushActive) {
          // Animate pickup arrows moving up
          const time = Date.now() * 0.001;
          arrow.position.y = 0.2 + Math.sin(time * 3 + index) * 0.5 + 1.0;
          if (arrow.material) {
            arrow.material.opacity = 0.7 + Math.sin(time * 5) * 0.3;
          }
        } else if (arrow.visible) {
          // Reset position when ready but not active
          arrow.position.y = 0.5;
          if (arrow.material) {
            arrow.material.opacity = 0.8;
          }
        }
      });

      depositArrows.forEach((arrow: any, index: number) => {
        arrow.visible = actualMode === 'deposit';

        // Position arrow around the brush radius
        const angle = (index / 3) * Math.PI * 2 + Math.PI / 6;
        arrow.position.x = Math.cos(angle) * arrowRadius;
        arrow.position.z = Math.sin(angle) * arrowRadius;

        if (arrow.visible && this.brushActive) {
          // Animate deposit arrows moving down
          const time = Date.now() * 0.001;
          arrow.position.y = 1.5 - Math.sin(time * 3 + index) * 0.5;
          if (arrow.material) {
            arrow.material.opacity = 0.7 + Math.sin(time * 5) * 0.3;
          }
        } else if (arrow.visible) {
          // Reset position when ready but not active
          arrow.position.y = 1.0;
          if (arrow.material) {
            arrow.material.opacity = 0.8;
          }
        }
      });

      // Show and animate material particles when active
      if (this.brushActive) {
        const particles = this.brushModeIndicator.children.filter(c =>
          c.name?.includes(`${this.brushMaterial}-particle`)
        );

        particles.forEach((particle, i) => {
          particle.visible = true;
          const time = Date.now() * 0.001;
          const angle = (i / particles.length) * Math.PI * 2 + time * 0.5;
          const radius = 2 + Math.sin(time * 2 + i) * 1;

          if (actualMode === 'pickup') {
            // Particles spiral upward for pickup
            particle.position.x = Math.cos(angle) * radius;
            particle.position.z = Math.sin(angle) * radius;
            particle.position.y = 1 + (time * 2 % 4);
            particle.scale.setScalar(1 - (particle.position.y - 1) / 4);
          } else {
            // Particles fall downward for deposit
            particle.position.x = Math.cos(angle) * radius;
            particle.position.z = Math.sin(angle) * radius;
            particle.position.y = 5 - (time * 2 % 4);
            particle.scale.setScalar((particle.position.y - 1) / 4);
          }
        });

        // Hide particles for other materials
        const otherParticles = this.brushModeIndicator.children.filter(c =>
          c.name?.includes('-particle') && !c.name?.includes(this.brushMaterial)
        );
        otherParticles.forEach(p => p.visible = false);
      } else {
        // Hide all particles when not active
        const allParticles = this.brushModeIndicator.children.filter(c =>
          c.name?.includes('-particle')
        );
        allParticles.forEach(p => p.visible = false);
      }
    } else {
      this.brushModeIndicator.visible = false;
    }
  }

  private getHighestPointInRadius(worldX: number, worldZ: number, radius: number): number {
    let maxHeight = this.getHeightAtWorldPos?.(worldX, worldZ) ?? 0;

    for (let r = 0; r <= radius; r += radius / 4) {
      const angleSamples = Math.max(8, Math.floor(r * 8 / radius));
      for (let i = 0; i < angleSamples; i++) {
        const angle = (i / angleSamples) * Math.PI * 2;
        const sampleX = worldX + Math.cos(angle) * r;
        const sampleZ = worldZ + Math.sin(angle) * r;
        const height = this.getHeightAtWorldPos?.(sampleX, sampleZ) ?? 0;
        if (height > maxHeight) {
          maxHeight = height;
        }
      }
    }

    return maxHeight;
  }

  public updateBrushHandMass(mass: number): void {
    this.brushHandMass = mass;
  }

  public setBrushMode(mode: 'pickup' | 'deposit'): void {
    this.brushMode = mode;
  }

  public setBrushMaterial(material: 'soil' | 'rock' | 'lava'): void {
    this.brushMaterial = material;
  }

  public setBrushRadius(radius: number): void {
    this.brushRadius = radius;
  }

  public setBrushStrength(strength: number): void {
    this.brushStrength = strength;
  }

  public setBrushHandCapacity(capacity: number): void {
    this.brushHandCapacity = capacity;
  }

  public dispose(): void {
    if (this.eventHandlers) {
      const { handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp, handleMouseLeave } = this.eventHandlers;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      if (handleMouseLeave) {
        this.canvas.removeEventListener('mouseleave', handleMouseLeave);
      }
    }

    if (this.brushCursorSphere) {
      this.brushCursorSphere.geometry.dispose();
      (this.brushCursorSphere.material as THREE.Material).dispose();
    }
    if (this.brushCursorRing) {
      this.brushCursorRing.geometry.dispose();
      (this.brushCursorRing.material as THREE.Material).dispose();
    }
    if (this.brushModeIndicator) {
      this.brushModeIndicator.children.forEach(child => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      this.brushModeIndicator.clear();
    }
  }
}
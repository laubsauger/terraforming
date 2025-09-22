import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { createTerrainMaterialTSL } from './materials/TerrainMaterialTSL';
import { createWaterMaterialTSL } from './materials/WaterMaterialTSL';
import { createLavaMaterialTSL } from './materials/LavaMaterialTSL';
import { BrushSystem } from '../sim/BrushSystem';
import type { Fields } from '../sim/fields';

export interface TerrainRendererOptions {
  canvas: HTMLCanvasElement;
  gridSize?: number;
  terrainSize?: number;
}

export class TerrainRenderer extends BaseRenderer {
  private controls: OrbitControls;

  private terrainMesh?: THREE.Mesh;
  private waterMesh?: THREE.Mesh;
  private lavaMesh?: THREE.Mesh;
  private oceanMesh?: THREE.Mesh;

  // Debug settings
  private showContours = true; // Enable by default

  private gridSize: number;
  private terrainSize: number;

  // Brush system
  private brushSystem?: BrushSystem;
  private brushHovering = false;    // Mouse over terrain (stage 1)
  private brushReady = false;       // Alt held - ready to act (stage 2)
  private brushActive = false;      // Alt + Click held - actively brushing (stage 3)
  private temporaryModeInvert = false; // CMD held to invert mode
  private brushMode: 'pickup' | 'deposit' = 'pickup';
  private brushMaterial: 'soil' | 'rock' | 'lava' = 'soil';
  private brushRadius = 10;
  private brushStrength = 1000;

  // Visual feedback
  private brushCursorSphere?: THREE.Mesh;
  private brushCursorRing?: THREE.Line;
  private brushCursorMaterial?: THREE.MeshPhysicalMaterial;
  private brushModeIndicator?: THREE.Group; // Arrows or particles to show mode
  private brushHandMass = 0;
  private brushHandCapacity = 10000;

  // Day/night cycle
  private sunLight!: THREE.DirectionalLight;
  private moonLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private sunSphere!: THREE.Mesh;
  private moonSphere!: THREE.Mesh;
  private timeOfDay = 0.12; // Start at dawn (maps to ~5:30am after adjustment)
  private dayNightCycleActive = false;
  private cycleSpeed = 0.0001; // Speed of day/night cycle

  // Centralized water configuration
  private readonly WATER_LEVEL = 2.3; // Absolute water height in world units
  private readonly HEIGHT_SCALE = 15;  // Terrain height scale
  private readonly WATER_LEVEL_NORMALIZED = 2.3 / 15; // Normalized for shaders

  // Textures for simulation data
  private heightTexture: THREE.DataTexture;
  private flowTexture: THREE.DataTexture;
  private accumulationTexture: THREE.DataTexture;
  private waterDepthTexture: THREE.DataTexture;
  private lavaDepthTexture: THREE.DataTexture;
  private temperatureTexture: THREE.DataTexture;

  constructor(options: TerrainRendererOptions) {
    const { canvas, gridSize = 256, terrainSize = 100 } = options;

    // Initialize base renderer
    super({ canvas, antialias: true, alpha: false });

    this.gridSize = gridSize;
    this.terrainSize = terrainSize;

    // Setup scene with black fog for maximum contrast
    const fogColor = 0x000000; // Pure black fog
    this.scene.background = new THREE.Color(0x000000); // Pure black background
    this.scene.fog = new THREE.Fog(fogColor, 150, 400); // Extended render distance

    // Setup camera - position on the other side of island for better view
    this.camera.position.set(45, 35, 45);
    this.camera.lookAt(0, 0, 0);

    // Setup orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground

    // Setup shift key handling to disable camera controls during brush adjustment
    this.setupShiftKeyHandling();

    // Setup lighting
    this.setupLighting();

    // Initialize textures
    this.heightTexture = this.createDataTexture();
    this.flowTexture = this.createDataTexture();
    this.accumulationTexture = this.createDataTexture();
    this.waterDepthTexture = this.createDataTexture();
    this.lavaDepthTexture = this.createDataTexture();
    this.temperatureTexture = this.createDataTexture();

    // Terrain will be created after renderer is ready
  }

  protected override async onRendererReady(): Promise<void> {
    console.log('TerrainRenderer: WebGPU renderer ready');

    // Get WebGPU device from the renderer
    const device = (this.renderer as any).backend?.device;
    if (!device) {
      console.error('TerrainRenderer: WebGPU device not available');
      return;
    }

    // Log device limits for debugging
    console.log('Device maxStorageTexturesPerShaderStage:', device.limits?.maxStorageTexturesPerShaderStage);

    // Initialize brush system with WebGPU device
    this.brushSystem = new BrushSystem(device, {
      gridSize: [this.gridSize, this.gridSize],
      cellSize: this.terrainSize / this.gridSize,
      angleOfRepose: 33, // degrees
      handCapacityKg: this.brushHandCapacity,
    });

    // Create terrain first
    this.createTerrain();

    // Generate test terrain data
    this.generateTestTerrain();

    // NOW initialize brush system with actual terrain data
    this.initializeBrushSystemWithTerrain();

    // Create brush cursor
    this.createBrushCursor();

    // Debug logging
    console.log('TerrainRenderer: Scene children count:', this.scene.children.length);
    console.log('TerrainRenderer: Terrain mesh added:', !!this.terrainMesh);
    console.log('TerrainRenderer: Ocean mesh added:', !!this.oceanMesh);
    console.log('TerrainRenderer: Brush system initialized:', !!this.brushSystem);
  }

  /**
   * Get the terrain mesh for raycasting
   */
  public getTerrainMesh(): THREE.Mesh | undefined {
    return this.terrainMesh;
  }

  /**
   * Get the height texture for terrain-following cursor
   */
  public getHeightTexture(): THREE.DataTexture {
    return this.heightTexture;
  }

  /**
   * Setup shift key handling to disable camera controls during brush adjustment
   */
  private setupShiftKeyHandling(): void {
    let animationFrameId: number | null = null;
    let lastWorldPos: THREE.Vector3 | undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = false;
      }
      // Alt key handling disabled - now handled in App.tsx
      // Removed to prevent conflicts with playground brush handling
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = true;
      }
      // Alt key handling disabled - now handled in App.tsx
      // Removed to prevent conflicts with playground brush handling
    };

    // Mouse move for hover feedback and drag tracking
    const handleMouseMove = (event: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      if (this.terrainMesh) {
        const intersects = raycaster.intersectObject(this.terrainMesh);
        if (intersects.length > 0) {
          lastWorldPos = intersects[0].point;

          // Check if Alt is pressed for ready state
          if (event.altKey) {
            this.brushReady = true;
            this.brushHovering = false;
            // Track CMD for mode inversion
            this.temporaryModeInvert = event.metaKey;
          } else {
            // Only reset active state if not currently dragging
            this.brushReady = false;
            if (!this.brushActive) {
              this.brushHovering = true;
            }
            this.temporaryModeInvert = false;
          }

          // Always update cursor position during drag or hover
          this.updateBrushCursor(lastWorldPos);
        } else {
          // Mouse not over terrain
          lastWorldPos = undefined;
          this.brushHovering = false;
          this.brushReady = false;
          // Don't reset active if still dragging
          if (!event.buttons) {
            this.brushActive = false;
          }
          this.updateBrushCursor();
        }
      }
    };

    // Hold-to-continue brush operation
    const performBrushOperation = () => {
      if (this.brushActive && this.brushSystem && lastWorldPos) {
        // Add brush operation
        this.brushSystem.addBrushOp(
          this.brushMode,
          this.brushMaterial,
          lastWorldPos.x,
          lastWorldPos.z,
          this.brushRadius,
          this.brushStrength,
          0.016 // dt (~60fps)
        );

        // Update visual feedback
        this.updateBrushCursor(lastWorldPos);

        // Continue operation on next frame
        animationFrameId = requestAnimationFrame(performBrushOperation);
      }
    };

    // Mouse down - check if we should show visual feedback
    const handleMouseDown = (event: MouseEvent) => {
      // Check if Alt is held (from external state)
      if (event.altKey && event.button === 0) {
        this.brushActive = true;
        // Check if CMD is held to temporarily invert mode
        this.temporaryModeInvert = event.metaKey;
        // Update cursor to show active state
        if (lastWorldPos) {
          this.updateBrushCursor(lastWorldPos);
        }
      }
    };

    // Mouse up - clear active state
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) { // Left click only
        this.brushActive = false;
        this.temporaryModeInvert = false;

        // Stop continuous operation
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        // Update cursor to show ready state if Alt still held
        if (event.altKey && lastWorldPos) {
          this.brushReady = true;
          this.temporaryModeInvert = event.metaKey; // Check CMD again
          this.updateBrushCursor(lastWorldPos);
        } else {
          this.brushReady = false;
          this.updateBrushCursor();
        }
      }
    };

    // Mouse leave - stop any active operation but maintain ready state
    const handleMouseLeave = () => {
      if (this.brushActive) {
        this.brushActive = false;
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
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

    // Store references for cleanup
    (this as any)._keyHandlers = {
      handleKeyDown,
      handleKeyUp,
      handleMouseMove,
      handleMouseDown,
      handleMouseUp,
      handleMouseLeave
    };
  }

  /**
   * Create visual brush cursor
   */
  private createBrushCursor(): void {
    // Create sphere for brush volume indicator
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);

    // Material will be updated based on brush material type
    this.brushCursorMaterial = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: 0.3,
      roughness: 0.3,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    this.brushCursorSphere = new THREE.Mesh(sphereGeometry, this.brushCursorMaterial);
    this.brushCursorSphere.visible = false;
    this.brushCursorSphere.renderOrder = 100; // Render on top
    this.scene.add(this.brushCursorSphere);

    // Create ring as a line that can conform to terrain
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
      opacity: 0.5,
      transparent: true,
      linewidth: 1.5, // Thinner line
      depthTest: false,
      depthWrite: false,
    });

    this.brushCursorRing = new THREE.Line(ringGeometry, ringMaterial);
    this.brushCursorRing.visible = false;
    this.brushCursorRing.renderOrder = 999; // Render on top
    this.scene.add(this.brushCursorRing);

    // Create mode indicator (arrows/particles)
    this.createModeIndicator();
  }

  /**
   * Sync brush parameters from UI
   */
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
    }
  }

  /**
   * Update brush cursor appearance based on current state
   */
  private updateBrushCursor(worldPos?: THREE.Vector3): void {
    if (!this.brushCursorSphere || !this.brushCursorRing || !this.brushCursorMaterial) return;

    // Sync brush parameters from UI before updating visuals
    this.syncBrushFromUI();

    // Determine visibility and current stage
    const shouldShow = (this.brushHovering || this.brushReady || this.brushActive) && worldPos !== undefined;

    // Update visibility
    this.brushCursorSphere.visible = shouldShow;
    this.brushCursorRing.visible = shouldShow;

    if (!shouldShow) return;

    // Get actual terrain height at this position for proper surface following
    const centerHeight = this.getHeightAtWorldPos(worldPos!.x, worldPos!.z) || worldPos!.y;
    const safeY = Math.max(centerHeight, 0.15); // Ensure minimum height above ocean floor

    // Position sphere at world position with terrain-following height
    this.brushCursorSphere.position.set(worldPos!.x, safeY, worldPos!.z);

    // Update ring to conform to terrain
    this.brushCursorRing.position.set(worldPos!.x, 0, worldPos!.z);

    // Update ring vertices to follow terrain
    const ringGeometry = this.brushCursorRing.geometry;
    const positions = ringGeometry.attributes.position;
    const segments = 64;

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const localX = Math.cos(angle) * this.brushRadius * 0.8; // Slightly smaller radius
      const localZ = Math.sin(angle) * this.brushRadius * 0.8;

      // Get world position for this point
      const worldX = worldPos!.x + localX;
      const worldZ = worldPos!.z + localZ;

      // Get terrain height at this point
      const pointHeight = this.getHeightAtWorldPos(worldX, worldZ);

      if (pointHeight !== null) {
        // Set position with terrain-following height
        positions.setXYZ(
          i,
          localX,
          pointHeight + 0.2, // Small offset above terrain
          localZ
        );
      } else {
        // Fallback to flat circle at center height
        positions.setXYZ(i, localX, centerHeight + 0.2, localZ);
      }
    }

    positions.needsUpdate = true;

    // Define material properties for each stage
    const materialProps = {
      soil: { baseColor: 0x8B6914, emissive: 0x4B3910, roughness: 0.8, metalness: 0 },
      rock: { baseColor: 0x5A5A5A, emissive: 0x2A2A2A, roughness: 0.9, metalness: 0.2 },
      lava: { baseColor: 0xFF4500, emissive: 0xFF2000, roughness: 0.1, metalness: 0.3 }
    };

    const baseMat = materialProps[this.brushMaterial];

    // STAGE 1: Hovering (subtle presence)
    if (this.brushHovering && !this.brushReady && !this.brushActive) {
      this.brushCursorMaterial.color.setHex(baseMat.baseColor);
      this.brushCursorMaterial.emissive.setHex(0x000000); // No emissive
      this.brushCursorMaterial.opacity = 0.2; // Very subtle
      this.brushCursorMaterial.emissiveIntensity = 0;

      // Ring: white, very subtle
      const ringMat = this.brushCursorRing.material as THREE.LineBasicMaterial;
      ringMat.color.setHex(0xFFFFFF);
      ringMat.opacity = 0.3;

      // Small base size
      this.brushCursorSphere.scale.setScalar(0.8);
    }

    // STAGE 2: Alt held - Ready to act (locked and loaded)
    else if (this.brushReady && !this.brushActive) {
      this.brushCursorMaterial.color.setHex(baseMat.baseColor);
      this.brushCursorMaterial.emissive.setHex(baseMat.emissive);
      this.brushCursorMaterial.opacity = 0.6; // More visible
      this.brushCursorMaterial.emissiveIntensity = 0.5; // Glowing

      // Add slow breathing animation
      const breathe = Math.sin(Date.now() * 0.003) * 0.1 + 1;
      this.brushCursorSphere.scale.setScalar(1.2 * breathe);

      // Ring: Mode-specific color, pulsing
      const ringMat = this.brushCursorRing.material as THREE.LineBasicMaterial;
      // Use inverted mode if CMD is held
      const effectiveMode = this.temporaryModeInvert
        ? (this.brushMode === 'pickup' ? 'deposit' : 'pickup')
        : this.brushMode;

      if (effectiveMode === 'pickup') {
        ringMat.color.setHex(0x00AAFF); // Blue for pickup
      } else {
        ringMat.color.setHex(0xFFAA00); // Orange for deposit
      }
      ringMat.opacity = 0.6 + Math.sin(Date.now() * 0.004) * 0.2; // Pulsing opacity

      // Show mode indicators
      if (this.brushModeIndicator) {
        this.brushModeIndicator.visible = true;
      }
      this.updateModeIndicator(worldPos!, true, false);
    }

    // STAGE 3: Alt + Click - Active brushing
    else if (this.brushActive) {
      // Volume-based sizing for hand capacity - THIS is the key visual feedback
      const volumeRatio = Math.min(1.0, this.brushHandMass / this.brushHandCapacity);

      // Check if nearly full (>95% capacity)
      const isNearlyFull = volumeRatio > 0.95;

      if (isNearlyFull && this.brushMode === 'pickup') {
        // Flash red when full
        this.brushCursorMaterial.color.setHex(0xFF0000);
        this.brushCursorMaterial.emissive.setHex(0xFF0000);
        this.brushCursorMaterial.emissiveIntensity = 2.0 * (0.5 + 0.5 * Math.sin(Date.now() * 0.02)); // Fast flashing
      } else {
        this.brushCursorMaterial.color.setHex(baseMat.baseColor);
        this.brushCursorMaterial.emissive.setHex(baseMat.emissive);
        this.brushCursorMaterial.emissiveIntensity = 1.5; // Bright glow
      }

      this.brushCursorMaterial.opacity = 0.9; // Highly visible

      // Fast pulsing animation
      const pulse = Math.sin(Date.now() * 0.008) * 0.1 + 1; // Reduced pulse amplitude

      // Much larger scale range for dramatic effect
      const minScale = this.brushMode === 'pickup' ? 1.0 : 0.5;
      const maxScale = this.brushMode === 'pickup' ? 8.0 : 0.2; // Huge when full picking up, tiny when empty depositing
      const baseScale = minScale + (maxScale - minScale) * volumeRatio;

      this.brushCursorSphere.scale.setScalar(baseScale * pulse);

      // Ring: Bright active colors
      const ringMat = this.brushCursorRing.material as THREE.LineBasicMaterial;
      // Use inverted mode if CMD is held
      const effectiveMode = this.temporaryModeInvert
        ? (this.brushMode === 'pickup' ? 'deposit' : 'pickup')
        : this.brushMode;

      if (effectiveMode === 'pickup') {
        ringMat.color.setHex(0x00FF00); // Bright green for active pickup
      } else {
        ringMat.color.setHex(0xFF0000); // Bright red for active deposit
      }
      ringMat.opacity = 0.9;

      // Intensify material emissive for active state
      this.brushCursorMaterial.emissiveIntensity *= 1.5;

      // Show active mode indicators
      this.updateModeIndicator(worldPos!, true, true);
    }

    // Update material properties
    this.brushCursorMaterial.roughness = baseMat.roughness;
    this.brushCursorMaterial.metalness = baseMat.metalness;

    // Hide mode indicators if only hovering
    if (this.brushHovering && !this.brushReady && !this.brushActive) {
      this.updateModeIndicator(worldPos!, false, false);
    }
  }

  /**
   * Create mode indicator arrows/particles
   */
  private createModeIndicator(): void {
    this.brushModeIndicator = new THREE.Group();

    // Create upward arrows for pickup mode
    const arrowGeometry = new THREE.ConeGeometry(0.5, 2, 8);
    const upArrowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00AAFF,
      transparent: true,
      opacity: 0.8,
    });

    // Create 3 upward arrows in circle formation
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(arrowGeometry, upArrowMaterial.clone());
      const angle = (i / 3) * Math.PI * 2;
      const baseX = Math.cos(angle) * 2.5;
      const baseZ = Math.sin(angle) * 2.5;
      // Store base positions in userData for terrain following
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
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 6; // Offset from upward arrows
      const baseX = Math.cos(angle) * 2.5;
      const baseZ = Math.sin(angle) * 2.5;
      // Store base positions in userData for terrain following
      arrow.userData = { baseX, baseZ };
      arrow.position.set(baseX, 0.5, baseZ);
      arrow.rotation.x = Math.PI; // Point downward
      arrow.name = 'deposit-arrow';
      arrow.visible = false; // Start hidden
      this.brushModeIndicator.add(arrow);
    }

    // Create material particles for deposit mode
    const particleGeometry = new THREE.SphereGeometry(0.2, 8, 8);

    // Soil particles
    const soilParticleMaterial = new THREE.MeshBasicMaterial({
      color: 0x8B6914,
      transparent: true,
      opacity: 0.7,
    });

    // Rock particles
    const rockParticleMaterial = new THREE.MeshBasicMaterial({
      color: 0x5A5A5A,
      transparent: true,
      opacity: 0.7,
    });

    // Lava particles - MeshBasicMaterial doesn't support emissive, so just use bright color
    const lavaParticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xFF4500,
      transparent: true,
      opacity: 0.8,
    });

    // Create particles for each material type
    const materials = [soilParticleMaterial, rockParticleMaterial, lavaParticleMaterial];
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
    this.scene.add(this.brushModeIndicator);
  }

  /**
   * Update mode indicator visibility and animation
   */
  private updateModeIndicator(worldPos: THREE.Vector3, isReady: boolean, isActive: boolean): void {
    if (!this.brushModeIndicator) return;

    this.brushModeIndicator.visible = isReady || isActive;

    if (!this.brushModeIndicator.visible) return;

    // Position group at cursor location
    this.brushModeIndicator.position.set(worldPos.x, 0, worldPos.z);

    // Hide all indicators first
    this.brushModeIndicator.children.forEach(child => {
      child.visible = false;
    });

    // Use inverted mode if CMD is held
    const effectiveMode = this.temporaryModeInvert
      ? (this.brushMode === 'pickup' ? 'deposit' : 'pickup')
      : this.brushMode;

    // Show appropriate indicators based on effective mode
    if (effectiveMode === 'pickup') {
      // Show upward arrows
      this.brushModeIndicator.children.forEach(child => {
        if (child.name === 'pickup-arrow') {
          child.visible = true;

          // Get base position from userData
          const baseX = child.userData.baseX || 0;
          const baseZ = child.userData.baseZ || 0;

          // Get terrain height at arrow's world position
          const worldArrowX = worldPos.x + baseX;
          const worldArrowZ = worldPos.z + baseZ;
          const arrowTerrainHeight = this.getHeightAtWorldPos(worldArrowX, worldArrowZ) || worldPos.y;

          // Animate upward movement relative to terrain
          const time = Date.now() * 0.003;
          const animOffset = 3 + Math.sin(time + baseX) * 1.0; // Much higher for visibility
          child.position.x = baseX;
          child.position.z = baseZ;
          child.position.y = Math.max(arrowTerrainHeight, 0.15) + animOffset;

          // Intensify during active state
          const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          material.opacity = isActive ? 1.0 : 0.6;
        }
      });
    } else {
      // Show downward arrows and material particles
      this.brushModeIndicator.children.forEach(child => {
        if (child.name === 'deposit-arrow') {
          child.visible = true;

          // Get base position from userData
          const baseX = child.userData.baseX || 0;
          const baseZ = child.userData.baseZ || 0;

          // Get terrain height at arrow's world position
          const worldArrowX = worldPos.x + baseX;
          const worldArrowZ = worldPos.z + baseZ;
          const arrowTerrainHeight = this.getHeightAtWorldPos(worldArrowX, worldArrowZ) || worldPos.y;

          // Animate downward movement relative to terrain
          const time = Date.now() * 0.004;
          const animOffset = 2 + Math.sin(time + baseX) * -0.5;
          child.position.x = baseX;
          child.position.z = baseZ;
          child.position.y = Math.max(arrowTerrainHeight, 0.15) + animOffset;

          const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          material.opacity = isActive ? 1.0 : 0.6;
        }

        // Show particles matching current material
        if (child.name === `${this.brushMaterial}-particle`) {
          child.visible = true;
          // Animate falling particles
          const time = Date.now() * 0.002;
          const baseY = 3 + Math.random() * 2;
          child.position.y = baseY + Math.sin(time + child.position.x * 0.5) * -1;

          const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          material.opacity = isActive ? 0.9 : 0.5;

          // Special glow for lava - use brighter color since MeshBasicMaterial has no emissive
          if (this.brushMaterial === 'lava') {
            // Brighten the color instead of using emissiveIntensity
            const brightness = isActive ? 1.2 : 1.0;
            material.color.setRGB(1.0 * brightness, 0.27 * brightness, 0);
          }
        }
      });
    }

    // Rotate the entire indicator group slowly
    this.brushModeIndicator.rotation.y += 0.01;
  }

  /**
   * Get height at world coordinates by sampling height texture
   */
  public getHeightAtWorldPos(worldX: number, worldZ: number): number {
    // Convert world coordinates to texture coordinates
    const halfSize = this.terrainSize / 2;
    const u = (worldX + halfSize) / this.terrainSize;
    const v = (worldZ + halfSize) / this.terrainSize;

    // Clamp to texture bounds
    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));

    // Sample from height texture
    const textureSize = this.gridSize;
    const x = Math.floor(clampedU * (textureSize - 1));
    const y = Math.floor(clampedV * (textureSize - 1));

    const data = this.heightTexture.image.data as Float32Array;
    const index = (y * textureSize + x) * 4; // RGBA format
    const heightValue = data[index]; // Height is stored in R channel

    // Apply height scale (matching the material)
    return heightValue * 15; // Same scale as material
  }

  private setupLighting(): void {
    // Enable shadow mapping on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Better quality soft shadows

    // Ambient light - will be adjusted based on time of day (reduced for less overexposure)
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.2);
    this.scene.add(this.ambientLight);

    // Sun light - warm yellow/white (reduced intensity to prevent overexposure)
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.0);
    this.sunLight.castShadow = true;

    // Configure sun shadow camera for consistent lighting
    this.sunLight.shadow.mapSize.width = 2048; // Reduced for better performance
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -70;
    this.sunLight.shadow.camera.right = 70;
    this.sunLight.shadow.camera.top = 70;
    this.sunLight.shadow.camera.bottom = -70;
    this.sunLight.shadow.bias = 0.0001; // Small positive bias
    this.sunLight.shadow.normalBias = 0; // No normal bias for now
    this.sunLight.shadow.needsUpdate = true;
    this.sunLight.shadow.autoUpdate = true; // Let Three.js handle updates normally
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target); // Add target to scene for proper world-space lighting

    // Moon light - deeper blue tint, dimmer
    this.moonLight = new THREE.DirectionalLight(0x6080ff, 0.25);
    this.moonLight.castShadow = true;

    // Configure moon shadow camera (softer shadows)
    this.moonLight.shadow.mapSize.width = 2048;
    this.moonLight.shadow.mapSize.height = 2048;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 200;
    this.moonLight.shadow.camera.left = -60;
    this.moonLight.shadow.camera.right = 60;
    this.moonLight.shadow.camera.top = 60;
    this.moonLight.shadow.camera.bottom = -60;
    this.moonLight.shadow.bias = -0.001;
    this.moonLight.shadow.normalBias = 0.02; // Helps with self-shadowing
    this.moonLight.shadow.needsUpdate = true;
    this.moonLight.shadow.autoUpdate = true; // Let Three.js handle updates
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target); // Add target to scene for proper world-space lighting

    // Create visible sun sphere - emissive for glow effect
    const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      fog: false // Don't be affected by fog
    });
    this.sunSphere = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sunSphere.renderOrder = 999; // Render on top
    this.scene.add(this.sunSphere);

    // Create visible moon sphere - slightly emissive
    const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
    const moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false // Don't be affected by fog
    });
    this.moonSphere = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonSphere.renderOrder = 999; // Render on top
    this.scene.add(this.moonSphere);

    // Initialize lighting positions
    this.updateDayNightCycle();
  }

  /**
   * Update the day/night cycle
   */
  private updateDayNightCycle(): void {

    // Remap time to favor daytime (0-1 input, but stretched/compressed output)
    // Input time: 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm, 1.0 = midnight
    // We want to spend most time in daylight (6am-6pm = 0.25-0.75)
    let adjustedTime = this.timeOfDay;

    // Mapping:
    // 0.0-0.1  -> 0.0-0.2   (night, compressed: midnight to 5am)
    // 0.1-0.15 -> 0.2-0.25  (dawn, quick transition: 5am to 6am)
    // 0.15-0.85 -> 0.25-0.75 (day, stretched: 6am to 6pm)
    // 0.85-0.9  -> 0.75-0.8  (dusk, quick transition: 6pm to 7pm)
    // 0.9-1.0  -> 0.8-1.0   (night, compressed: 7pm to midnight)

    if (adjustedTime < 0.1) {
      // Night (midnight to early morning) - compress to 0.0-0.2
      adjustedTime = adjustedTime * 2.0;
    } else if (adjustedTime < 0.15) {
      // Dawn (quick transition) - map to 0.2-0.25
      adjustedTime = 0.2 + (adjustedTime - 0.1) * (0.05 / 0.05);
    } else if (adjustedTime < 0.85) {
      // Day (main period) - map to 0.25-0.75
      adjustedTime = 0.25 + (adjustedTime - 0.15) * (0.5 / 0.7);
    } else if (adjustedTime < 0.9) {
      // Dusk (quick transition) - map to 0.75-0.8
      adjustedTime = 0.75 + (adjustedTime - 0.85) * (0.05 / 0.05);
    } else {
      // Night (evening) - map to 0.8-1.0
      adjustedTime = 0.8 + (adjustedTime - 0.9) * (0.2 / 0.1);
    }

    // Convert time to radians for circular motion
    const angle = adjustedTime * Math.PI * 2;

    // Sun arc configuration - more realistic path
    const sunTilt = Math.PI / 4; // 45 degrees tilt for more pronounced seasonal arc
    const arcRotation = 0; // No rotation for now, will be controllable

    // Calculate sun position with better arc
    // Note: angle = 0 is midnight, PI/2 is 6am, PI is noon, 3PI/2 is 6pm
    const orbitRadius = 150; // Much further away to avoid camera occlusion
    const verticalScale = 0.7; // Higher zenith for more overhead sun at noon

    // Fix sun positioning: use -cos for Y so sun is UP at noon (angle=PI)
    const baseX = Math.sin(angle) * orbitRadius;
    const baseY = -Math.cos(angle) * orbitRadius * verticalScale; // Negative cos: up at PI (noon)
    const baseZ = Math.sin(angle) * Math.sin(sunTilt) * orbitRadius;

    // Apply rotation around Y axis (keep simple for now)
    const sunX = baseX;
    const sunY = baseY;
    const sunZ = baseZ;

    // Set sun position and make sphere follow
    this.sunLight.position.set(sunX, Math.max(0, sunY), sunZ);
    this.sunLight.visible = sunY > -5;

    // Position sun sphere exactly at light source
    this.sunSphere.position.set(sunX, sunY, sunZ); // Use actual position, even if below horizon
    this.sunSphere.visible = sunY > -10; // Show slightly below horizon for sunset effect

    // Make sun look at center for consistent lighting
    if (this.sunLight.visible) {
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.updateMatrixWorld();
      // Force shadow update when sun moves
      this.sunLight.shadow.needsUpdate = true;
      this.sunLight.shadow.camera.updateMatrixWorld();
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }

    // Update sun sphere appearance based on elevation
    if (this.sunSphere.visible) {
      const sunMat = this.sunSphere.material as THREE.MeshBasicMaterial;
      if (sunY < 10 && sunY > -10) {
        // Sunset/sunrise colors
        const factor = (sunY + 10) / 20;
        sunMat.color.setRGB(1.0, 0.6 + factor * 0.4, factor * 0.6);
      } else {
        sunMat.color.setHex(0xffd700);
      }
    }

    // Moon is opposite to sun
    const moonX = -sunX;
    const moonY = -sunY;
    const moonZ = -sunZ;

    // Set moon position and make sphere follow
    this.moonLight.position.set(moonX, Math.max(0, moonY), moonZ);
    this.moonLight.visible = moonY > -5;

    // Position moon sphere exactly at light source
    this.moonSphere.position.set(moonX, moonY, moonZ); // Use actual position, even if below horizon
    this.moonSphere.visible = moonY > -10; // Show slightly below horizon for moonrise effect

    // Make moon look at center for consistent lighting
    if (this.moonLight.visible) {
      this.moonLight.target.position.set(0, 0, 0);
      this.moonLight.target.updateMatrixWorld();
      this.moonLight.updateMatrixWorld();
      // Force shadow update when moon moves
      this.moonLight.shadow.needsUpdate = true;
      this.moonLight.shadow.camera.updateMatrixWorld();
      this.moonLight.shadow.camera.updateProjectionMatrix();
    }

    // Update moon sphere appearance based on elevation
    if (this.moonSphere.visible) {
      const moonMat = this.moonSphere.material as THREE.MeshBasicMaterial;
      const brightness = Math.max(0.7, (moonY + 10) / 20);
      moonMat.color.setRGB(brightness, brightness, brightness * 1.05);
    }

    // Adjust light intensities based on sun elevation
    const sunElevation = Math.max(0, sunY / (orbitRadius * verticalScale)); // 0 to 1
    const moonElevation = Math.max(0, moonY / (orbitRadius * verticalScale)); // 0 to 1

    // Ensure only one light casts shadows at a time to prevent conflicts
    const isDaytime = sunElevation > moonElevation;

    if (isDaytime) {
      // Day time - sun is primary light (increased intensity for better shadows)
      this.sunLight.intensity = sunElevation * 1.5;
      this.sunLight.castShadow = true;
      this.moonLight.intensity = moonElevation * 0.05; // Very dim moon during day
      this.moonLight.castShadow = false;
    } else {
      // Night time - moon is primary light
      this.sunLight.intensity = sunElevation * 0.05; // Very dim sun during night
      this.sunLight.castShadow = false;
      this.moonLight.intensity = moonElevation * 0.3;
      this.moonLight.castShadow = true;
    }

    // Ambient light varies throughout the day
    // Brighter during day, darker at night
    const dayFactor = Math.max(0, Math.cos(angle)); // 1 at noon, -1 at midnight
    const ambientIntensity = 0.15 + dayFactor * 0.2; // 0.15 to 0.35 (reduced to prevent overexposure)
    this.ambientLight.intensity = ambientIntensity;

    // Adjust ambient color - warmer during sunrise/sunset
    const twilightFactor = Math.abs(Math.sin(angle * 2)) * (1 - Math.abs(dayFactor));
    const ambientR = 1.0;
    const ambientG = 1.0 - twilightFactor * 0.2; // Slightly less green during twilight
    const ambientB = 1.0 - twilightFactor * 0.4; // Much less blue during twilight
    this.ambientLight.color.setRGB(ambientR, ambientG, ambientB);

    // Adjust sun color during sunrise/sunset
    if (sunElevation < 0.3 && sunElevation > 0) {
      const sunsetFactor = 1 - (sunElevation / 0.3);
      this.sunLight.color.setRGB(
        1.0,
        1.0 - sunsetFactor * 0.2,
        0.9 - sunsetFactor * 0.3
      );
    } else {
      this.sunLight.color.setHex(0xfffaed); // Normal sun color
    }

    // Update fog color - keeping it black/dark gray for contrast
    const fogDayColor = new THREE.Color(0x0a0a0a); // Day fog - very dark gray
    const fogNightColor = new THREE.Color(0x000000); // Night fog - pure black
    const fogSunsetColor = new THREE.Color(0x050505); // Sunset fog - almost black

    // Calculate fog color based on sun position
    if (sunElevation > 0.5) {
      // Day time
      this.scene.fog!.color.copy(fogDayColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogDayColor);
      }
    } else if (sunElevation > 0 && sunElevation <= 0.3) {
      // Sunrise/sunset
      const sunsetFactor = sunElevation / 0.3;
      this.scene.fog!.color.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      }
    } else if (moonElevation > 0) {
      // Night time with moon
      this.scene.fog!.color.copy(fogNightColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogNightColor);
      }
    } else {
      // Twilight/dawn
      const twilightFactor = Math.max(Math.abs(sunElevation), Math.abs(moonElevation)) * 5;
      this.scene.fog!.color.lerpColors(fogNightColor, fogSunsetColor, twilightFactor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogNightColor, fogSunsetColor, twilightFactor);
      }
    }
  }

  /**
   * Set the time of day (0-1)
   */
  public setTimeOfDay(time: number): void {
    this.timeOfDay = time % 1; // Ensure it wraps around
    this.updateDayNightCycle();
  }

  /**
   * Start or stop the day/night cycle animation
   */
  public setDayNightCycleActive(active: boolean): void {
    this.dayNightCycleActive = active;
  }

  /**
   * Set the speed of the day/night cycle
   */
  public setCycleSpeed(speed: number): void {
    this.cycleSpeed = speed;
  }

  /**
   * Set brush parameters from UI
   */
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

  public updateBrushHandMass(mass: number): void {
    this.brushHandMass = mass;
  }

  public setBrushHandCapacity(capacity: number): void {
    this.brushHandCapacity = capacity;
  }

  /**
   * Initialize brush system fields with current terrain height data
   */
  private initializeBrushSystemWithTerrain(): void {
    if (!this.brushSystem) return;

    const device = (this.renderer as any).backend?.device;
    if (!device) return;

    // Get current height texture data
    const heightData = this.heightTexture.image.data as Float32Array;
    const size = this.gridSize;

    // Create separate rock and soil data from height texture
    const rockData = new Float32Array(size * size);
    const soilData = new Float32Array(size * size);

    for (let i = 0; i < size * size; i++) {
      const height = heightData[i * 4]; // R channel

      // Split height into rock base and soil layer
      // Above water = soil, below water = rock
      const waterLevel = 0.153; // Matches terrain water level

      if (height > waterLevel) {
        // Above water: mostly soil with rock base
        rockData[i] = Math.max(0, waterLevel - 0.01); // Rock base slightly below water
        soilData[i] = Math.max(0, height - waterLevel + 0.01); // Soil layer above water
      } else {
        // Below water: rock only
        rockData[i] = height;
        soilData[i] = 0;
      }
    }

    // Copy data to brush system GPU textures
    const fields = this.brushSystem.getFields();

    // Write rock data
    device.queue.writeTexture(
      { texture: fields.rock },
      rockData,
      { bytesPerRow: size * 4, rowsPerImage: size },
      { width: size, height: size }
    );

    // Write soil data
    device.queue.writeTexture(
      { texture: fields.soil },
      soilData,
      { bytesPerRow: size * 4, rowsPerImage: size },
      { width: size, height: size }
    );
  }

  /**
   * Update terrain rendering to use brush system field data directly
   */
  private updateTerrainFromBrushSystem(): void {
    if (!this.brushSystem || !this.terrainMesh) return;

    // Get brush system fields for direct binding
    const fields = this.brushSystem.getFields();

    // Update terrain material to use brush system textures directly
    const material = this.terrainMesh.material as any;
    if (material.heightMapNode) {
      // Create combined height texture from rock + soil in TSL
      // This will be done in the shader via texture sampling
      material.needsUpdate = true;
    }
  }

  /**
   * Create a data texture for simulation
   */
  private createDataTexture(): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4); // RGBA

    // Initialize with default values
    for (let i = 0; i < size * size * 4; i += 4) {
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 1; // A
    }

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat, // Always use RGBA for consistency
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter; // No mipmaps for data textures
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; // Disable mipmaps for data textures

    return texture;
  }

  private createTerrain(): void {
    // Create terrain geometry - higher subdivision for better detail
    const subdivisions = 127; // 128x128 grid for detailed terrain
    const geometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      subdivisions,
      subdivisions
    );
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Create terrain material using TSL with GPU-based displacement
    const material = createTerrainMaterialTSL({
      heightMap: this.heightTexture,
      heightScale: this.HEIGHT_SCALE,
      terrainSize: this.terrainSize,
      flowMap: this.flowTexture,
      accumulationMap: this.accumulationTexture,
      showContours: this.showContours, // Enable contours by default
      contourInterval: 0.05,
      waterLevel: this.WATER_LEVEL_NORMALIZED,
    });

    // Create mesh - height displacement happens in vertex shader via TSL
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.matrixAutoUpdate = true; // Ensure matrix updates
    this.scene.add(this.terrainMesh);

    // No need to update vertices - GPU handles displacement via heightTexture

    // Create ocean water plane at sea level (always visible)
    // Match terrain size exactly for proper alignment
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize, // Match terrain size exactly
      this.terrainSize,
      128, // Higher resolution for better shore blending
      128
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      opacity: 0.9,
      heightTexture: this.heightTexture, // Pass height texture for depth calculation
      waterLevel: this.WATER_LEVEL_NORMALIZED
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = this.WATER_LEVEL;
    this.oceanMesh.position.x = 0; // Ensure centered
    this.oceanMesh.position.z = 0; // Ensure centered
    this.oceanMesh.renderOrder = 1; // Render after terrain for proper blending
    this.scene.add(this.oceanMesh);

    // Create dynamic water surface (initially invisible) - for rivers/lakes
    const waterGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for water
      32
    );
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = createWaterMaterialTSL({
      color: new THREE.Color(0x0099cc),
      opacity: 0.4,
      depthTexture: this.waterDepthTexture
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.3; // Lower water level to show shallow areas
    this.waterMesh.visible = false; // Start hidden until we have water depth data
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);

    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for lava
      32
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterialTSL({
      lavaDepthMap: this.lavaDepthTexture,
      temperatureMap: this.temperatureTexture,
      flowMap: this.flowTexture,
    });

    this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    this.lavaMesh.position.y = 0.02; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
    this.lavaMesh.castShadow = true;
    this.lavaMesh.receiveShadow = true;
    this.scene.add(this.lavaMesh);
  }

  private generateTestTerrain(): void {
    // Generate smooth island terrain with better features and no rough edges
    const size = this.gridSize;
    const data = this.heightTexture.image.data as Float32Array;

    // Better hash function for noise
    const hash2 = (x: number, y: number): number => {
      let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return h - Math.floor(h);
    };

    // Smooth interpolation
    const smoothstep = (edge0: number, edge1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    // Extra smooth interpolation for critical areas
    const smootherstep = (edge0: number, edge1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * t * (t * (t * 6 - 15) + 10);
    };

    // Improved Perlin-like noise
    const noise2D = (x: number, y: number, scale: number, octaves: number = 1): number => {
      let value = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;

      for (let i = 0; i < octaves; i++) {
        const sx = x * frequency;
        const sy = y * frequency;

        // Grid cell coordinates
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        // Interpolation weights
        const wx = sx - x0;
        const wy = sy - y0;

        // Random values at grid points
        const n00 = hash2(x0, y0);
        const n10 = hash2(x1, y0);
        const n01 = hash2(x0, y1);
        const n11 = hash2(x1, y1);

        // Bilinear interpolation
        const sx1 = smoothstep(0, 1, wx);
        const sy1 = smoothstep(0, 1, wy);

        const nx0 = n00 * (1 - sx1) + n10 * sx1;
        const nx1 = n01 * (1 - sx1) + n11 * sx1;
        const nxy = nx0 * (1 - sy1) + nx1 * sy1;

        value += nxy * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
      }

      return value / maxValue;
    };

    // Ridge noise for mountain chains
    const ridgeNoise = (x: number, y: number, scale: number, octaves: number = 1): number => {
      let value = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;

      for (let i = 0; i < octaves; i++) {
        const n = noise2D(x, y, frequency, 1);
        // Create ridges by inverting and taking absolute value
        const ridge = 1 - Math.abs(n * 2 - 1);
        value += ridge * ridge * amplitude;

        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.3;
      }

      return value / maxValue;
    };

    // Voronoi-like cellular noise for interesting features
    const cellularNoise = (x: number, y: number, scale: number): number => {
      const cellX = Math.floor(x * scale);
      const cellY = Math.floor(y * scale);

      let minDist = 1;
      let secondDist = 1;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cellX + dx;
          const cy = cellY + dy;

          // Random point in cell
          const hash = Math.sin(cx * 127.3 + cy * 311.7) * 43758.5453;
          const px = cx + (hash - Math.floor(hash));
          const hash2 = Math.sin(hash * 127.3) * 43758.5453;
          const py = cy + (hash2 - Math.floor(hash2));

          const dist = Math.sqrt(Math.pow(x * scale - px, 2) + Math.pow(y * scale - py, 2));

          if (dist < minDist) {
            secondDist = minDist;
            minDist = dist;
          } else if (dist < secondDist) {
            secondDist = dist;
          }
        }
      }

      // Return difference for more interesting patterns
      return secondDist - minDist;
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Normalized coordinates (-1 to 1)
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;

        // Distance from center with asymmetry
        const distX = nx * 1.1;
        const distY = ny * 0.9;
        const dist = Math.sqrt(distX * distX + distY * distY);

        // Start with zero height
        let height = 0;

        // Create main island shape with very smooth variation
        const shapeNoise = noise2D(nx * 0.5, ny * 0.5, 1.5, 2);
        const islandShape = Math.max(0, 1 - dist * (0.9 + shapeNoise * 0.2));
        const islandNoise = noise2D(nx, ny, 2, 2);
        const islandMask = Math.pow(islandShape, 0.8) * (0.7 + islandNoise * 0.3);

        if (islandMask > 0.01) {
          // Base elevation with much more dramatic height variation
          if (islandMask < 0.08) {
            // Deep to medium underwater - very gradual
            const progress = islandMask / 0.08;
            const smoothProgress = smootherstep(0, 1, progress);
            height = 0.05 + smoothProgress * 0.08;
          } else if (islandMask < 0.18) {
            // Shallow water to beach - critical smooth transition
            const progress = (islandMask - 0.08) / 0.10;
            const smoothProgress = smootherstep(0, 1, progress);
            height = 0.13 + smoothProgress * 0.022;
          } else if (islandMask < 0.3) {
            // Beach to foothills - gentle rise
            const progress = (islandMask - 0.18) / 0.12;
            const smoothProgress = smootherstep(0, 1, progress);
            height = 0.152 + smoothProgress * 0.05;
          } else if (islandMask < 0.6) {
            // Foothills to mid elevation - more dramatic
            const progress = (islandMask - 0.3) / 0.3;
            const smoothProgress = smootherstep(0, 1, progress);
            height = 0.202 + smoothProgress * 0.15;
          } else {
            // High terrain - mountains and peaks
            const progress = Math.min(1, (islandMask - 0.6) / 0.4);
            const smoothProgress = smootherstep(0, 1, progress);
            height = 0.352 + smoothProgress * 0.25;
          }

          // Add terrain features based on zones
          const cellNoise = cellularNoise(nx + 0.5, ny + 0.5, 5);

          // Completely reworked mountain system with no harsh cutoffs
          const mountainZone = Math.max(0, islandMask - 0.35);
          if (mountainZone > 0) {
            // Create smooth mountain distribution across the island
            const mountainNoise = noise2D(nx * 0.8, ny * 0.8, 2, 3);
            const ridgeStrength = mountainNoise * 0.5 + 0.5; // 0 to 1

            // Multiple mountain ridges with smooth falloff
            const ridge1 = ridgeNoise(nx * 1.0 + 0.1, ny * 1.0 + 0.2, 3, 2);
            const ridge2 = ridgeNoise(nx * 0.8 - 0.1, ny * 0.8 - 0.1, 4, 2);
            const ridge3 = ridgeNoise(nx * 1.2 + 0.2, ny * 1.2 + 0.3, 2, 3);

            // Combine ridges with varying strengths
            const combinedRidges = (ridge1 * 0.4 + ridge2 * 0.3 + ridge3 * 0.3) * ridgeStrength;

            // Create multiple peaks with smooth transitions
            const peak1 = Math.exp(-((nx - 0.1) * (nx - 0.1) + (ny - 0.15) * (ny - 0.15)) * 8);
            const peak2 = Math.exp(-((nx + 0.15) * (nx + 0.15) + (ny + 0.05) * (ny + 0.05)) * 10);
            const peak3 = Math.exp(-((nx - 0.2) * (nx - 0.2) + (ny - 0.3) * (ny - 0.3)) * 6);
            const peak4 = Math.exp(-((nx + 0.05) * (nx + 0.05) + (ny - 0.25) * (ny - 0.25)) * 9);

            // Smooth peak distribution
            const peakFactor = noise2D(nx * 2, ny * 2, 3, 2) * 0.3 + 0.7;
            const allPeaks = (peak1 + peak2 * 0.8 + peak3 * 0.6 + peak4 * 0.7) * peakFactor;

            // Combine mountains with very smooth transitions
            const mountainHeight = (combinedRidges * 0.25 + allPeaks * 0.35) * mountainZone;

            // Apply ultra-smooth transition based on distance from center
            const centerDist = Math.sqrt(nx * nx + ny * ny);
            const falloffFactor = smootherstep(0.8, 0.4, centerDist);

            height += mountainHeight * falloffFactor;

            // Add subtle rocky texture only on steep areas
            const steepness = mountainHeight * falloffFactor;
            if (cellNoise > 0.3 && steepness > 0.1) {
              height += cellNoise * steepness * 0.02;
            }
          }

          // Create flat meadow areas and plateaus
          const meadowZone1 = islandMask > 0.25 && islandMask < 0.4 &&
                             Math.abs(nx + 0.2) < 0.3 && Math.abs(ny + 0.1) < 0.2;
          const meadowZone2 = islandMask > 0.3 && islandMask < 0.45 &&
                             Math.abs(nx - 0.25) < 0.2 && Math.abs(ny + 0.3) < 0.15;

          if (meadowZone1 || meadowZone2) {
            // Flatten these areas for meadows with slight undulation
            const meadowBase = meadowZone1 ? 0.21 : 0.24;
            const gentleNoise = noise2D(nx * 8, ny * 8, 15, 1);
            height = meadowBase + gentleNoise * 0.008;
          }

          // Create organic lagoon with varied depth
          const lagoonX = 0.15;
          const lagoonY = -0.05;
          const lagoonDist = Math.sqrt(Math.pow(nx - lagoonX, 2) + Math.pow(ny - lagoonY, 2));
          const lagoonAngle = Math.atan2(ny - lagoonY, nx - lagoonX);
          const lagoonRadius = 0.12 + Math.sin(lagoonAngle * 2.5) * 0.04 + Math.cos(lagoonAngle * 4) * 0.02;

          if (lagoonDist < lagoonRadius && islandMask > 0.15) {
            const lagoonDepth = smoothstep(lagoonRadius, 0, lagoonDist);
            const depthVariation = noise2D(nx * 10, ny * 10, 20, 1);
            height -= lagoonDepth * (0.06 + depthVariation * 0.02);

            // Ensure lagoon stays slightly below water but not too deep
            height = Math.max(height, 0.10);
            height = Math.min(height, 0.135);  // Keep it as a shallow lagoon
          }

          // Gentler elevated areas instead of harsh cliffs
          if (nx < -0.2 && islandMask > 0.3) {
            const elevationStrength = smootherstep(-0.2, -0.5, nx);
            const elevationNoise = noise2D(ny * 3, nx * 3, 6, 2);

            // Gentle elevation increase
            if (elevationStrength > 0.05) {
              const additionalHeight = elevationStrength * (0.08 + elevationNoise * 0.03);
              height += additionalHeight * smootherstep(0.05, 0.3, elevationStrength);
            }
          }

          // Add erosion-like details
          const erosionNoise = noise2D(nx * 12, ny * 12, 25, 3);
          const erosionStrength = Math.max(0, islandMask - 0.2) * (1 - mountainZone);
          height += erosionNoise * 0.015 * erosionStrength;

          // Create river valleys
          const valley1 = Math.exp(-Math.pow((nx - ny * 0.3 + 0.1), 2) * 30) * islandMask;
          const valley2 = Math.exp(-Math.pow((nx * 0.5 + ny - 0.2), 2) * 25) * islandMask;

          if ((valley1 > 0.1 || valley2 > 0.1) && height > 0.16) {
            const valleyDepth = Math.max(valley1, valley2);
            height -= valleyDepth * 0.03;
            height = Math.max(height, 0.145);  // Don't go below beach level
          }
        }

        // Small island in front of camera view (southeast from new camera position)
        const frontIslandX = -0.3;
        const frontIslandY = -0.4;
        const frontIslandDist = Math.sqrt(Math.pow(nx - frontIslandX, 2) + Math.pow(ny - frontIslandY, 2));
        if (frontIslandDist < 0.12) {
          const islandFactor = Math.pow(1 - frontIslandDist / 0.12, 1.5);
          const islandNoise = noise2D((nx - frontIslandX) * 8, (ny - frontIslandY) * 8, 6, 2);
          const islandHeight = 0.148 + islandFactor * (0.08 + islandNoise * 0.04);
          // Smooth transition to avoid harsh edges
          const smoothFactor = smootherstep(0.1, 0.12, frontIslandDist);
          const finalHeight = islandHeight * (1 - smoothFactor);
          height = Math.max(height, finalHeight);
        }

        // Sandy atoll chain to the southwest
        const atoll1X = -0.45;
        const atoll1Y = -0.2;
        const atoll2X = -0.38;
        const atoll2Y = -0.32;

        const atoll1Dist = Math.sqrt(Math.pow(nx - atoll1X, 2) + Math.pow(ny - atoll1Y, 2));
        const atoll2Dist = Math.sqrt(Math.pow(nx - atoll2X, 2) + Math.pow(ny - atoll2Y, 2));

        if (atoll1Dist < 0.06) {
          const atollFactor = smoothstep(0.06, 0, atoll1Dist);
          const sandNoise = noise2D(nx * 15, ny * 15, 30, 1);
          height = Math.max(height, 0.141 + atollFactor * 0.02 + sandNoise * 0.003);
        }

        if (atoll2Dist < 0.05) {
          const atollFactor = smoothstep(0.05, 0, atoll2Dist);
          height = Math.max(height, 0.142 + atollFactor * 0.018);
        }

        // Ocean floor with underwater features
        if (height < 0.1) {
          const oceanNoise = noise2D(nx * 3, ny * 3, 6, 3);
          const underwaterRidge = ridgeNoise(nx * 2, ny * 2, 5, 2);

          // Create underwater channels and ridges
          const baseDepth = 0.02 + oceanNoise * 0.04;
          const ridgeHeight = underwaterRidge * 0.03 * (1 - islandMask);

          height = Math.max(height, baseDepth + ridgeHeight);

          // Deep ocean trenches
          const trenchX = Math.sin(ny * 3) * 0.1;
          const trenchDist = Math.abs(nx - 0.7 - trenchX);
          if (trenchDist < 0.05 && dist > 0.6) {
            height *= 0.3;
          }
        }

        // Final clamping
        height = Math.max(0, Math.min(1, height));

        // Set all channels to the same height value
        data[idx] = height;
        data[idx + 1] = height;
        data[idx + 2] = height;
        data[idx + 3] = 1;
      }
    }

    // Apply smoothing pass to eliminate rough edges
    const smoothedData = new Float32Array(size * size * 4);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = (y * size + x) * 4;

        // Sample surrounding heights
        const center = data[idx];
        const neighbors = [
          data[((y-1) * size + x) * 4],     // top
          data[((y+1) * size + x) * 4],     // bottom
          data[(y * size + (x-1)) * 4],     // left
          data[(y * size + (x+1)) * 4],     // right
          data[((y-1) * size + (x-1)) * 4], // top-left
          data[((y-1) * size + (x+1)) * 4], // top-right
          data[((y+1) * size + (x-1)) * 4], // bottom-left
          data[((y+1) * size + (x+1)) * 4]  // bottom-right
        ];

        // Weighted average for smoothing - heavier weight on center
        let smoothedHeight = center * 0.5;
        for (let i = 0; i < 8; i++) {
          smoothedHeight += neighbors[i] * 0.0625; // 0.5/8
        }

        // Apply targeted smoothing to eliminate harsh edges
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;
        const dist = Math.sqrt(nx * nx + ny * ny);

        // Check for large height differences with neighbors that indicate harsh edges
        let maxDiff = 0;
        for (const neighbor of neighbors) {
          maxDiff = Math.max(maxDiff, Math.abs(center - neighbor));
        }

        // Only smooth areas with significant height differences (harsh edges)
        if (maxDiff > 0.02 && center > 0.1 && center < 0.5 && dist < 1.0) {
          // Smooth more aggressively where harsh edges are detected
          const smoothingFactor = Math.min(maxDiff * 10, 0.8); // 0 to 0.8
          smoothedHeight = center * (1 - smoothingFactor) + smoothedHeight * smoothingFactor;
        }

        smoothedData[idx] = smoothedHeight;
        smoothedData[idx + 1] = smoothedHeight;
        smoothedData[idx + 2] = smoothedHeight;
        smoothedData[idx + 3] = 1;
      }
    }

    // Copy smoothed data back, preserving edges
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = (y * size + x) * 4;
        data[idx] = smoothedData[idx];
        data[idx + 1] = smoothedData[idx + 1];
        data[idx + 2] = smoothedData[idx + 2];
        data[idx + 3] = smoothedData[idx + 3];
      }
    }

    this.heightTexture.needsUpdate = true;
  }

  /**
   * Update terrain from GPU brush system textures
   */
  public updateFieldTextures(fields: any): void {
    if (!fields || !fields.fields) return;

    // The brush system modifies GPU textures containing soil/rock/lava
    // We need to read these back and combine them into the height texture
    // For now, mark that the height texture needs updating
    // TODO: Implement GPU readback to get actual height changes

    // Signal that terrain needs updating
    this.heightTexture.needsUpdate = true;
  }

  public updateHeightmap(data: Float32Array): void {
    const size = this.gridSize;
    const textureData = this.heightTexture.image.data as Float32Array;

    // Clear existing data first to avoid artifacts
    textureData.fill(0);

    // Copy the new heightmap data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const texIdx = idx * 4; // RGBA format
        const height = data[idx] || 0;

        // Set all channels to the same height value
        textureData[texIdx] = height;     // R
        textureData[texIdx + 1] = height; // G
        textureData[texIdx + 2] = height; // B
        textureData[texIdx + 3] = 1.0;    // A
      }
    }

    this.heightTexture.needsUpdate = true;

    // Also update brush system if initialized
    if (this.brushSystem) {
      this.initializeBrushSystemWithTerrain();
    }
  }

  public updateFlowmap(data: Float32Array): void {
    const textureData = this.flowTexture.image.data as Float32Array;
    textureData.set(data);
    this.flowTexture.needsUpdate = true;
  }

  public updateAccumulationMap(data: Float32Array): void {
    const textureData = this.accumulationTexture.image.data as Float32Array;
    textureData.set(data);
    this.accumulationTexture.needsUpdate = true;
  }

  public updateWaterDepth(data: Float32Array): void {
    const textureData = this.waterDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.waterDepthTexture.needsUpdate = true;

    // Show/hide water mesh based on whether there's water
    if (this.waterMesh) {
      const hasWater = data.some((v) => v > 0.01);
      this.waterMesh.visible = hasWater;
    }
  }

  public updateLavaDepth(data: Float32Array): void {
    const textureData = this.lavaDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.lavaDepthTexture.needsUpdate = true;

    // Show/hide lava mesh based on whether there's lava
    if (this.lavaMesh) {
      const hasLava = data.some((v) => v > 0.01);
      this.lavaMesh.visible = hasLava;
    }
  }

  public updateTemperature(data: Float32Array): void {
    const textureData = this.temperatureTexture.image.data as Float32Array;
    textureData.set(data);
    this.temperatureTexture.needsUpdate = true;
  }

  /**
   * Set which debug visualization to show
   */
  public setDebugMode(mode: number): void {
    // Debug mode implementation would go here
    // This would switch between different visualization modes
    console.log('Setting debug mode:', mode);
  }

  /**
   * Toggle topographic contour lines
   */
  public setShowContours(show: boolean): void {
    if (this.showContours === show) return;
    this.showContours = show;

    // Recreate terrain material with contour settings
    if (this.terrainMesh) {
      const oldMaterial = this.terrainMesh.material as THREE.Material;

      // Create new material with contour settings
      const newMaterial = createTerrainMaterialTSL({
        heightMap: this.heightTexture,
        heightScale: this.HEIGHT_SCALE,
        terrainSize: this.terrainSize,
        flowMap: this.flowTexture,
        accumulationMap: this.accumulationTexture,
        showContours: show,
        contourInterval: 0.05, // Every 5% height = 0.75m with scale 15
        waterLevel: this.WATER_LEVEL_NORMALIZED,
      });

      this.terrainMesh.material = newMaterial;
      oldMaterial.dispose();
    }
  }

  public override render(): void {
    // Update controls first (camera movement)
    this.controls.update();

    // Update day/night cycle if active (independent of camera)
    if (this.dayNightCycleActive) {
      this.timeOfDay += this.cycleSpeed;
      if (this.timeOfDay > 1) {
        this.timeOfDay -= 1;
      }
      this.updateDayNightCycle();
    }

    // Execute brush system if available
    if (this.brushSystem && this.renderer) {
      // Get WebGPU device and create command encoder
      const device = (this.renderer as any).backend?.device;
      if (device) {
        const commandEncoder = device.createCommandEncoder();

        // Execute brush operations
        this.brushSystem.execute(commandEncoder);

        // Submit commands
        device.queue.submit([commandEncoder.finish()]);

        // Update terrain textures from brush system fields
        this.updateTerrainFromBrushSystem();
      }
    }

    // Render the scene
    super.render();
  }

  public override dispose(): void {
    // Clean up event listeners
    if ((this as any)._keyHandlers) {
      const { handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp, handleMouseLeave } = (this as any)._keyHandlers;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      if (handleMouseLeave) {
        this.canvas.removeEventListener('mouseleave', handleMouseLeave);
      }
    }

    // Clean up brush system
    if (this.brushSystem) {
      this.brushSystem.destroy();
    }

    // Dispose of controls
    this.controls.dispose();

    // Dispose of textures
    this.heightTexture.dispose();
    this.flowTexture.dispose();
    this.accumulationTexture.dispose();
    this.waterDepthTexture.dispose();
    this.lavaDepthTexture.dispose();
    this.temperatureTexture.dispose();

    // Dispose of brush cursor
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

    // Dispose of meshes
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }
    // Ocean mesh cleanup removed
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}
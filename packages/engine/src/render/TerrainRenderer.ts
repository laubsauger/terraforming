import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { BrushSystem } from '../sim/BrushSystem';
import { FluidSystem } from '../sim/FluidSystem';
import { TerrainConfig, DebugOverlay } from '@terraforming/types';

// Import subsystems
import { BrushInteractionHandler } from './systems/BrushInteractionHandler';
import { DayNightCycleManager } from './systems/DayNightCycleManager';
import { TerrainGenerator } from './systems/TerrainGenerator';
import { TextureManager } from './systems/TextureManager';
import { MeshFactory } from './systems/MeshFactory';
import { HeightSampler } from './systems/HeightSampler';
import { SourceEmitterManager } from './systems/SourceEmitterManager';
import { DebugOverlaySystem } from './systems/DebugOverlaySystem';

export interface TerrainRendererOptions {
  canvas: HTMLCanvasElement;
  gridSize?: number;
  terrainSize?: number;
}

/**
 * High-level terrain renderer that orchestrates all terrain subsystems
 */
export class TerrainRenderer extends BaseRenderer {
  // Core properties
  private controls: OrbitControls;
  private gridSize: number;
  private terrainSize: number;

  // Configuration from centralized config
  private readonly WATER_LEVEL = TerrainConfig.WATER_LEVEL_ABSOLUTE;
  private readonly HEIGHT_SCALE = TerrainConfig.HEIGHT_SCALE;
  private readonly WATER_LEVEL_NORMALIZED = TerrainConfig.SEA_LEVEL_NORMALIZED;

  // Subsystems
  private brushInteractionHandler: BrushInteractionHandler;
  private dayNightManager: DayNightCycleManager;
  private terrainGenerator: TerrainGenerator;
  private textureManager: TextureManager;
  private meshFactory: MeshFactory;
  private heightSampler: HeightSampler;
  private sourceEmitterManager: SourceEmitterManager;
  private brushSystem?: BrushSystem;
  private fluidSystem?: FluidSystem;
  private debugOverlaySystem?: DebugOverlaySystem;

  // State
  private showContours = false; // Start with contours off
  private heightTextureInitialized = false;

  constructor(options: TerrainRendererOptions) {
    const { canvas, gridSize = 256, terrainSize = 100 } = options;

    // Initialize base renderer
    super({ canvas, antialias: true, alpha: false });

    this.gridSize = gridSize;
    this.terrainSize = TerrainConfig.TERRAIN_SIZE; // Use config value

    // Setup scene
    const fogColor = 0x000000;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.Fog(fogColor, 150, 400);

    // Setup camera
    this.camera.position.set(45, 35, 45);
    this.camera.lookAt(0, 0, 0);

    // Setup orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2.1;

    // Initialize texture manager
    this.textureManager = new TextureManager({ gridSize });

    // Initialize height sampler
    this.heightSampler = new HeightSampler({
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      heightScale: this.HEIGHT_SCALE,
      heightTexture: this.textureManager.heightTexture
    });

    // Initialize mesh factory
    this.meshFactory = new MeshFactory({
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      heightScale: this.HEIGHT_SCALE,
      waterLevel: this.WATER_LEVEL,
      textureManager: this.textureManager
    });

    // Initialize terrain generator
    this.terrainGenerator = new TerrainGenerator({ gridSize });

    // Initialize day/night cycle manager
    this.dayNightManager = new DayNightCycleManager({
      scene: this.scene,
      renderer: this.renderer as THREE.WebGPURenderer
    });

    // Initialize source emitter manager
    this.sourceEmitterManager = new SourceEmitterManager({
      scene: this.scene
    });

    // Initialize brush interaction handler
    this.brushInteractionHandler = new BrushInteractionHandler({
      camera: this.camera,
      canvas: canvas,
      controls: this.controls,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize
    });

    // Setup callbacks
    this.brushInteractionHandler.setHeightCallback((x, z) => this.heightSampler.getHeightAtWorldPos(x, z));
    this.brushInteractionHandler.setTerrainMeshCallback(() => this.meshFactory.terrainMesh);
    this.brushInteractionHandler.setDebugReadCallback((x, z) => this.debugReadTextureAt(x, z));
  }

  protected override async onRendererReady(): Promise<void> {
    console.log('TerrainRenderer: WebGPU renderer ready');

    // Get WebGPU device from the renderer
    const device = (this.renderer as any).backend?.device;
    if (!device) {
      console.error('TerrainRenderer: WebGPU device not available');
      return;
    }

    // console.log('Device maxStorageTexturesPerShaderStage:', device.limits?.maxStorageTexturesPerShaderStage);

    // Initialize brush system with WebGPU device
    this.brushSystem = new BrushSystem(device, {
      gridSize: [this.gridSize, this.gridSize],
      cellSize: this.terrainSize / this.gridSize,
      angleOfRepose: 33,
      handCapacityKg: 10000,
    });

    // Initialize fluid system with WebGPU device
    const fields = this.brushSystem.getFields();
    if (fields) {
      this.fluidSystem = new FluidSystem({
        device: device,
        fields: fields,
        resolution: this.gridSize,
        simResolution: Math.floor(this.gridSize * 0.25), // Run at quarter resolution
        gravity: 9.81,
        evaporationRate: 0.0001,
        rainIntensity: 0.0,
      });
      console.log('TerrainRenderer: Fluid system initialized');

    // Initialize debug overlay system
    if (this.fluidSystem) {
      this.debugOverlaySystem = new DebugOverlaySystem({
        scene: this.scene,
        terrainSize: this.terrainSize,
        fluidSystem: this.fluidSystem,
        heightTexture: this.textureManager.heightTexture,
        heightScale: TerrainConfig.HEIGHT_SCALE
      });
      console.log('TerrainRenderer: Debug overlay system initialized');
    }
    } else {
      console.warn('TerrainRenderer: Could not initialize fluid system - fields not available');
    }

    // Connect subsystems
    this.brushInteractionHandler.setBrushSystem(this.brushSystem);
    this.heightSampler.setBrushSystem(this.brushSystem);
    this.brushInteractionHandler.initialize(this.scene);

    // Create terrain and meshes
    this.meshFactory.createTerrain(this.scene, this.showContours);
    this.meshFactory.createOcean(this.scene);
    this.meshFactory.createWater(this.scene);
    this.meshFactory.createLava(this.scene);

    // Setup environment map for reflections after meshes are created
    this.setupEnvironmentMap();

    // Log verification that environment is set
    // setTimeout(() => {
    //   console.log('ENVIRONMENT MAP VERIFICATION:', {
    //     hasEnvironment: !!this.scene.environment,
    //     environmentType: this.scene.environment?.constructor.name,
    //     isTexture: this.scene.environment?.isTexture,
    //     hasImage: !!(this.scene.environment as any)?.image,
    //     mapping: (this.scene.environment as any)?.mapping,
    //     oceanMeshExists: !!this.meshFactory.oceanMesh,
    //     oceanMaterial: this.meshFactory.oceanMesh?.material?.constructor.name,
    //     waterMeshExists: !!this.meshFactory.waterMesh,
    //     waterMaterial: this.meshFactory.waterMesh?.material?.constructor.name
    //   });
    // }, 100);

    // Update terrain material with fluid textures now that meshFactory exists
    this.updateTerrainMaterialWithFluid();

    // Load default heightmap (async)
    this.loadDefaultTerrain();

    console.log('TerrainRenderer: Scene children count:', this.scene.children.length);
    console.log('TerrainRenderer: Terrain mesh added:', !!this.meshFactory.terrainMesh);
    console.log('TerrainRenderer: Ocean mesh added:', !!this.meshFactory.oceanMesh);
    console.log('TerrainRenderer: Brush system initialized:', !!this.brushSystem);
  }

  /**
   * Setup environment map for reflections
   */
  private setupEnvironmentMap(): void {
    try {
      // Create a simple gradient environment texture for sky reflections
      const size = 256;
      const data = new Uint8Array(size * size * 4);

      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const index = (i * size + j) * 4;

          // Create a sky gradient from horizon to zenith
          const t = i / size; // 0 at bottom, 1 at top

          // Sky colors: horizon (light blue-gray) to zenith (deeper blue)
          const horizonR = 180;
          const horizonG = 200;
          const horizonB = 220;

          const zenithR = 100;
          const zenithG = 140;
          const zenithB = 200;

          // Add some variation for clouds
          const cloudNoise = Math.sin(j * 0.05) * Math.cos(i * 0.03) * 20;

          // Interpolate between horizon and zenith
          const r = horizonR + (zenithR - horizonR) * t + cloudNoise;
          const g = horizonG + (zenithG - horizonG) * t + cloudNoise;
          const b = horizonB + (zenithB - horizonB) * t + cloudNoise * 0.5;

          // Add sun spot
          const sunX = size * 0.7;
          const sunY = size * 0.8;
          const sunDist = Math.sqrt((j - sunX) ** 2 + (i - sunY) ** 2);
          const sunIntensity = Math.max(0, 1 - sunDist / 50);
          const sunGlow = Math.max(0, 1 - sunDist / 100) * 0.3;

          data[index] = Math.min(255, r + sunIntensity * 75 + sunGlow * 50);
          data[index + 1] = Math.min(255, g + sunIntensity * 50 + sunGlow * 40);
          data[index + 2] = Math.min(255, b + sunIntensity * 30 + sunGlow * 30);
          data[index + 3] = 255;
        }
      }

      // Create a canvas-based texture for better WebGPU compatibility
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(size, size);
      imageData.data.set(data);
      ctx.putImageData(imageData, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;

      // Apply directly to scene
      this.scene.environment = texture;
      this.scene.backgroundIntensity = 0.3; // Dim background
      this.scene.environmentIntensity = 1.0; // Full intensity for reflections

      // console.log('TerrainRenderer: Environment map set up successfully');
      // console.log('Environment texture details:', {
      //   isCanvasTexture: texture.isTexture,
      //   hasImage: !!texture.image,
      //   imageWidth: texture.image?.width,
      //   imageHeight: texture.image?.height,
      //   mapping: texture.mapping === THREE.EquirectangularReflectionMapping ? 'EquirectangularReflection' : 'Other',
      //   colorSpace: texture.colorSpace === THREE.SRGBColorSpace ? 'SRGB' : 'Linear',
      //   sceneHasEnvironment: !!this.scene.environment,
      //   environmentIntensity: this.scene.environmentIntensity
      // });
    } catch (error) {
      console.warn('TerrainRenderer: Failed to setup environment map, water will reflect default environment', error);
    }
  }

  /**
   * Load the default heightmap asynchronously
   */
  private async loadDefaultTerrain(): Promise<void> {
    try {
      // Load the default heightmap
      await this.terrainGenerator.loadDefaultHeightmap(this.textureManager.heightTexture);

      // Initialize brush system with terrain data after loading
      await this.initializeBrushSystemWithTerrain();

      console.log('TerrainRenderer: Default heightmap loaded successfully');
    } catch (error) {
      console.error('TerrainRenderer: Error loading default heightmap:', error);
      // Fallback already handled in loadDefaultHeightmap
    }
  }

  /**
   * Initialize brush system fields with current terrain height data
   */
  private async initializeBrushSystemWithTerrain(): Promise<void> {
    if (!this.brushSystem) return;

    const device = (this.renderer as any).backend?.device;
    if (!device) return;

    // Get current height texture data
    const heightData = this.textureManager.heightTexture.image.data as Float32Array;
    const size = this.gridSize;

    // Create separate rock and soil data from height texture
    const rockData = new Float32Array(size * size);
    const soilData = new Float32Array(size * size);

    for (let i = 0; i < size * size; i++) {
      const heightNormalized = heightData[i * 4]; // R channel (0-1)

      // Convert normalized height to meters
      const heightMeters = heightNormalized * TerrainConfig.HEIGHT_SCALE;
      const waterLevelMeters = TerrainConfig.WATER_LEVEL_ABSOLUTE;

      // Split height into rock base and soil layer IN METERS
      // Rock represents bedrock that forms the foundation
      // Soil is the loose material on top
      if (heightMeters > waterLevelMeters) {
        // Above water: most is rock with thin soil layer
        const soilDepth = Math.min(2.0, (heightMeters - waterLevelMeters) * 0.2); // Thin soil layer
        rockData[i] = heightMeters - soilDepth;
        soilData[i] = soilDepth;
      } else {
        // Below water: all rock, no soil (underwater erosion)
        rockData[i] = heightMeters;
        soilData[i] = 0;
      }
    }

    // Copy data to brush system GPU textures
    const fields = this.brushSystem.getFields();

    // Write to optimized RGBA fields texture (R=soil, G=rock, B=lava, A=unused)
    const rgbaData = new Float32Array(size * size * 4);
    let minHeight = Infinity, maxHeight = -Infinity;
    for (let i = 0; i < size * size; i++) {
      rgbaData[i * 4 + 0] = soilData[i];  // R = soil
      rgbaData[i * 4 + 1] = rockData[i];  // G = rock
      rgbaData[i * 4 + 2] = 0;            // B = lava (none initially)
      rgbaData[i * 4 + 3] = 0;            // A = unused

      const totalHeight = soilData[i] + rockData[i];
      minHeight = Math.min(minHeight, totalHeight);
      maxHeight = Math.max(maxHeight, totalHeight);
    }
    console.log(`TerrainRenderer: Initializing height data - min: ${minHeight.toFixed(2)}m, max: ${maxHeight.toFixed(2)}m`);

    // Write RGBA fields data
    device.queue.writeTexture(
      { texture: fields.fields },
      rgbaData,
      { bytesPerRow: size * 4 * 4, rowsPerImage: size },
      { width: size, height: size }
    );

    // CRITICAL: Also write the combined height directly to the height texture
    // This ensures it's available immediately without waiting for compute shader
    const combinedHeightData = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      combinedHeightData[i] = soilData[i] + rockData[i]; // Combine soil + rock
    }
    device.queue.writeTexture(
      { texture: fields.height },
      combinedHeightData,
      { bytesPerRow: size * 4, rowsPerImage: size },
      { width: size, height: size }
    );
    console.log('TerrainRenderer: Wrote height data directly to height texture');

    // Also write to legacy individual textures for compatibility
    if (fields.rock) {
      device.queue.writeTexture(
        { texture: fields.rock },
        rockData,
        { bytesPerRow: size * 4, rowsPerImage: size },
        { width: size, height: size }
      );
    }

    if (fields.soil) {
      device.queue.writeTexture(
        { texture: fields.soil },
        soilData,
        { bytesPerRow: size * 4, rowsPerImage: size },
        { width: size, height: size }
      );
    }

    // Height texture is now populated directly via writeTexture above
    // No need to wait for compute shader on initialization
    this.heightTextureInitialized = true;
    console.log('TerrainRenderer: Height texture initialized directly');

    // Run one fluid system update to calculate initial flow field
    if (this.fluidSystem) {
      const encoder = device.createCommandEncoder();
      this.fluidSystem.update(encoder, 0.016, 0);
      device.queue.submit([encoder.finish()]);
      console.log('TerrainRenderer: Initial flow field calculated');
    }
  }

  // Public API methods

  /**
   * Get the terrain mesh for raycasting
   */
  public getTerrainMesh(): THREE.Mesh | undefined {
    return this.meshFactory.terrainMesh;
  }

  /**
   * Get the height texture for terrain-following cursor
   */
  public getHeightTexture(): THREE.DataTexture {
    return this.textureManager.heightTexture;
  }

  /**
   * Get height at world position
   */
  public getHeightAtWorldPos(worldX: number, worldZ: number): number {
    return this.heightSampler.getHeightAtWorldPos(worldX, worldZ);
  }

  /**
   * Update terrain from GPU brush system textures
   */
  public updateFieldTextures(fields: any): void {
    if (!fields || !fields.fields) return;
    this.textureManager.heightTexture.needsUpdate = true;
  }

  /**
   * Update heightmap data
   */
  public async updateHeightmap(data: Float32Array): Promise<void> {
    this.textureManager.updateHeightmap(data);
    if (this.brushSystem) {
      await this.initializeBrushSystemWithTerrain();
    }
  }

  /**
   * Get current heightmap data
   */
  public getCurrentHeightmap(): Float32Array | null {
    return this.textureManager.getCurrentHeightmap();
  }

  /**
   * Update flow map
   */
  public updateFlowmap(data: Float32Array): void {
    this.textureManager.updateFlowmap(data);
  }

  /**
   * Update accumulation map
   */
  public updateAccumulationMap(data: Float32Array): void {
    this.textureManager.updateAccumulationMap(data);
  }

  /**
   * Update water depth
   */
  public updateWaterDepth(data: Float32Array): void {
    this.textureManager.updateWaterDepth(data);
    this.meshFactory.updateWaterVisibility();
  }

  /**
   * Update lava depth
   */
  public updateLavaDepth(data: Float32Array): void {
    this.textureManager.updateLavaDepth(data);
    this.meshFactory.updateLavaVisibility();
  }

  /**
   * Update temperature
   */
  public updateTemperature(data: Float32Array): void {
    this.textureManager.updateTemperature(data);
  }

  /**
   * Set debug mode
   */
  public setDebugMode(mode: number): void {
    console.log('Setting debug mode:', mode);
  }

  /**
   * Toggle topographic contour lines
   */
  public setShowContours(show: boolean): void {
    if (this.showContours === show) return;
    this.showContours = show;
    this.meshFactory.updateTerrainContours(show);
  }

  /**
   * Set the time of day (0-1)
   */
  public setTimeOfDay(time: number): void {
    this.dayNightManager.setTimeOfDay(time);
  }

  /**
   * Start or stop the day/night cycle animation
   */
  public setDayNightCycleActive(active: boolean): void {
    this.dayNightManager.setDayNightCycleActive(active);
  }

  /**
   * Set the speed of the day/night cycle
   */
  public setCycleSpeed(speed: number): void {
    this.dayNightManager.setCycleSpeed(speed);
  }

  /**
   * Set brush parameters
   */
  public setBrushMode(mode: 'pickup' | 'deposit'): void {
    this.brushInteractionHandler.setBrushMode(mode);
  }

  public setBrushMaterial(material: 'soil' | 'rock' | 'lava'): void {
    this.brushInteractionHandler.setBrushMaterial(material);
  }

  public setBrushRadius(radius: number): void {
    this.brushInteractionHandler.setBrushRadius(radius);
  }

  public setBrushStrength(strength: number): void {
    this.brushInteractionHandler.setBrushStrength(strength);
  }

  public updateBrushHandMass(mass: number): void {
    this.brushInteractionHandler.updateBrushHandMass(mass);
  }

  public setBrushHandCapacity(capacity: number): void {
    this.brushInteractionHandler.setBrushHandCapacity(capacity);
  }

  /**
   * Sync brush parameters from UI
   */
  public syncBrushFromUI(): void {
    this.brushInteractionHandler.syncBrushFromUI();
  }

  /**
   * Add a water source at the specified position
   * @param worldY - Optional Y position, if not provided will be calculated from terrain height
   */
  public addWaterSource(worldX: number, worldZ: number, flowRate: number = 10, worldY?: number): string {
    // Use provided Y or calculate from terrain height
    const height = worldY !== undefined ? worldY : this.heightSampler.getHeightAtWorldPos(worldX, worldZ) + 0.5;
    const position = new THREE.Vector3(worldX, height, worldZ);
    const sourceId = this.sourceEmitterManager.addSource(position, 'water', flowRate);

    // Add to fluid system for actual simulation
    if (this.fluidSystem) {
      // Convert world coordinates to grid pixel coordinates
      // Note: Z is flipped because texture V-coordinate goes top-to-bottom (0 at top, 1 at bottom)
      // while world Z goes bottom-to-top (negative to positive)
      const gridX = ((worldX + this.terrainSize / 2) / this.terrainSize) * this.gridSize;
      const gridZ = (((-worldZ) + this.terrainSize / 2) / this.terrainSize) * this.gridSize; // Flip Z
      this.fluidSystem.addWaterSource(sourceId, gridX, gridZ, flowRate);
      console.log(`Added water source:`, {
        worldPos: [worldX.toFixed(1), worldZ.toFixed(1)],
        gridPos: [gridX.toFixed(0), gridZ.toFixed(0)],
        normalized: [(gridX / this.gridSize).toFixed(3), (gridZ / this.gridSize).toFixed(3)],
        terrainSize: this.terrainSize,
        gridSize: this.gridSize
      });
    }

    return sourceId;
  }

  /**
   * Add a lava source at the specified position
   * @param worldY - Optional Y position, if not provided will be calculated from terrain height
   */
  public addLavaSource(worldX: number, worldZ: number, flowRate: number = 10, worldY?: number): string {
    // Use provided Y or calculate from terrain height
    const height = worldY !== undefined ? worldY : this.heightSampler.getHeightAtWorldPos(worldX, worldZ) + 0.5;
    const position = new THREE.Vector3(worldX, height, worldZ);
    const sourceId = this.sourceEmitterManager.addSource(position, 'lava', flowRate);

    // Add to fluid system for actual simulation
    if (this.fluidSystem) {
      // Convert world coordinates to grid pixel coordinates
      // Note: Z is flipped because texture V-coordinate goes top-to-bottom
      const gridX = ((worldX + this.terrainSize / 2) / this.terrainSize) * this.gridSize;
      const gridZ = (((-worldZ) + this.terrainSize / 2) / this.terrainSize) * this.gridSize; // Flip Z
      this.fluidSystem.addLavaSource(sourceId, gridX, gridZ, flowRate);
      console.log(`Added lava source to fluid system at grid coords (${gridX.toFixed(0)}, ${gridZ.toFixed(0)})`);
    }

    return sourceId;
  }

  /**
   * Remove a source by ID
   */
  public removeSource(id: string): boolean {
    const removed = this.sourceEmitterManager.removeSource(id);
    if (removed && this.fluidSystem) {
      this.fluidSystem.removeSource(id);
    }
    return removed;
  }

  /**
   * Toggle source indicators visibility
   */
  public setSourceIndicatorsVisible(visible: boolean): void {
    this.sourceEmitterManager.setVisualIndicatorsVisible(visible);
  }

  private lastSimulationTime = 0;
  private simulationInterval = 1000 / 30; // Run simulation at 30 FPS for smooth flow
  private lastMaterialUpdateTime = 0;
  private materialUpdateInterval = 2000; // Update materials every 2 seconds
  private lastWaterMeshUpdateTime = 0;
  private waterMeshUpdateInterval = 1000 / 30; // Update water mesh at 30fps to match

  /**
   * Update fluid simulation - throttled for performance
   */
  public updateSimulation(deltaTime: number, time: number): void {
    if (!this.fluidSystem) return;

    const currentTimeMs = time * 1000;

    // Run simulation at lower frequency (10 FPS)
    const timeSinceLastSimulation = currentTimeMs - this.lastSimulationTime;
    if (timeSinceLastSimulation >= this.simulationInterval) {
      // Get WebGPU device from the renderer
      const device = (this.renderer as any).backend?.device;
      if (device) {
        // Create command encoder for this frame
        const commandEncoder = device.createCommandEncoder();

        // Update fluid system with accumulated delta time
        const simDeltaTime = timeSinceLastSimulation / 1000;
        this.fluidSystem.update(commandEncoder, simDeltaTime, time);

        // Submit commands
        device.queue.submit([commandEncoder.finish()]);
      }
      this.lastSimulationTime = currentTimeMs;
    }

    // Update water mesh less frequently (10fps) but independently of simulation
    const timeSinceWaterUpdate = currentTimeMs - this.lastWaterMeshUpdateTime;
    if (timeSinceWaterUpdate >= this.waterMeshUpdateInterval) {
      this.updateWaterMeshWithFluid();
      this.lastWaterMeshUpdateTime = currentTimeMs;
    }

    // Update terrain material very rarely (every 2 seconds)
    const timeSinceMaterialUpdate = currentTimeMs - this.lastMaterialUpdateTime;
    if (timeSinceMaterialUpdate >= this.materialUpdateInterval) {
      this.updateTerrainMaterialWithFluid();
      this.lastMaterialUpdateTime = currentTimeMs;
    }

    // Debug: Check water depth values every 5 seconds
    if (Math.floor(time) % 5 === 0 && Math.floor(time * 10) % 10 === 0) {
      // Use setTimeout to avoid blocking the render loop
      setTimeout(async () => {
        if (this.fluidSystem) {
          await this.fluidSystem.debugWaterDepth();
        }
      }, 0);
    }
  }

  /**
   * Update water mesh with current water depth texture
   */
  private updateWaterMeshWithFluid(): void {
    if (!this.fluidSystem || !this.meshFactory.waterMesh) return;

    const waterDepthGPUTexture = this.fluidSystem.getWaterDepthTexture();
    if (!waterDepthGPUTexture) return;

    // Copy GPU texture data to CPU for Three.js
    const device = (this.renderer as any).backend?.device;
    if (!device) return;

    const size = this.gridSize;
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256; // Align to 256 bytes
    const buffer = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture: waterDepthGPUTexture },
      { buffer, bytesPerRow },
      { width: size, height: size }
    );
    device.queue.submit([commandEncoder.finish()]);

    // Read the buffer and update texture
    buffer.mapAsync(GPUMapMode.READ).then(() => {
      const copyArrayBuffer = buffer.getMappedRange();
      const data = new Float32Array(copyArrayBuffer.slice(0));
      buffer.unmap();
      buffer.destroy();

      // Update the texture manager's water depth texture
      const textureData = this.textureManager.waterDepthTexture.image.data as Float32Array;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const srcIdx = y * (bytesPerRow / 4) + x;
          const dstIdx = (y * size + x) * 4;  // RGBA format
          textureData[dstIdx] = data[srcIdx];  // R channel
        }
      }
      this.textureManager.waterDepthTexture.needsUpdate = true;

      // Use MeshFactory's method to update water mesh
      this.meshFactory.updateWaterWithFluidTexture(this.textureManager.waterDepthTexture);
    });
  }

  /**
   * Update terrain material with fluid simulation textures
   */
  private updateTerrainMaterialWithFluid(): void {
    if (!this.fluidSystem) return;

    // Get water depth texture from fluid system
    const waterDepthGPUTexture = this.fluidSystem.getWaterDepthTexture();
    if (!waterDepthGPUTexture) return;

    // Create a placeholder DataTexture for WebGPU compatibility
    // The actual GPU texture will be bound via WebGPU, but we need a valid Three.js texture object
    const size = this.gridSize;
    const data = new Float32Array(size * size);
    const waterDepthTexture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RedFormat,
      THREE.FloatType
    );

    // Mark as GPU texture and attach the actual GPU texture
    (waterDepthTexture as any).isStorageTexture = true;
    (waterDepthTexture as any).gpuTexture = waterDepthGPUTexture;
    waterDepthTexture.minFilter = THREE.LinearFilter;
    waterDepthTexture.magFilter = THREE.LinearFilter;
    waterDepthTexture.wrapS = THREE.ClampToEdgeWrapping;
    waterDepthTexture.wrapT = THREE.ClampToEdgeWrapping;
    waterDepthTexture.needsUpdate = false; // Don't update CPU data

    // Update terrain material if meshFactory exists
    if (this.meshFactory) {
      this.meshFactory.updateTerrainWithFluidTextures(waterDepthTexture);
    }
  }

  /**
   * Get all active sources for simulation
   */
  public getActiveSources() {
    return this.sourceEmitterManager.getSourceDataForSimulation();
  }

  /**
   * Main render loop
   */
  public override render(): void {
    // Update controls first
    this.controls.update();

    // Update day/night cycle
    this.dayNightManager.update();

    // Update source emitter animations
    this.sourceEmitterManager.update(0.016); // ~60fps

    // Execute brush system if available
    // Always run at least once to ensure height texture is populated
    if (this.brushSystem && this.renderer) {
      const device = (this.renderer as any).backend?.device;
      if (device) {
        // Force execute on first frame even if physics not running
        if (!this.heightTextureInitialized || true) { // Always execute for now
          const commandEncoder = device.createCommandEncoder();
          this.brushSystem.execute(commandEncoder);
          device.queue.submit([commandEncoder.finish()]);
        }
      }
    }

    // Update debug overlays (if active)
    if (this.debugOverlaySystem) {
      this.debugOverlaySystem.update();
    }

    // Render the scene
    super.render();
  }

  /**
   * Debug: Read GPU texture values at a specific world coordinate
   */
  public async debugReadTextureAt(x: number, z: number): Promise<void> {
    const device = (this.renderer as any).backend?.device;
    if (!device || !this.fluidSystem || !this.brushSystem) {
      console.error('Debug: Device or systems not available');
      return;
    }

    const fields = this.brushSystem.getFields();
    const gridSize = this.gridSize;

    // Convert world coordinates to grid coordinates
    const gridX = Math.floor((x / this.terrainSize + 0.5) * gridSize);
    const gridZ = Math.floor((z / this.terrainSize + 0.5) * gridSize);

    console.log(`\n=== DEBUG TEXTURE VALUES AT WORLD (${x.toFixed(2)}, ${z.toFixed(2)}) ===`);
    console.log(`Grid coordinates: (${gridX}, ${gridZ}) of ${gridSize}x${gridSize}`);

    // Read height texture
    const readHeight = async () => {
      const buffer = device.createBuffer({
        size: 256, // Enough for one pixel
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: fields.height, origin: { x: gridX, y: gridZ, z: 0 } },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
      );
      device.queue.submit([encoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(buffer.getMappedRange());
      const value = data[0];
      buffer.unmap();
      buffer.destroy();
      return value;
    };

    // Read flow texture
    const readFlow = async () => {
      const buffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

      const flowTex = this.fluidSystem!.getFlowTexture();
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: flowTex, origin: { x: gridX, y: gridZ, z: 0 } },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
      );
      device.queue.submit([encoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(buffer.getMappedRange());
      const flow = { x: data[0], y: data[1] };
      buffer.unmap();
      buffer.destroy();
      return flow;
    };

    try {
      const [height, flow] = await Promise.all([readHeight(), readFlow()]);

      console.log(`Height: ${height.toFixed(3)}m`);
      console.log(`Flow velocity: (${flow.x.toFixed(3)}, ${flow.y.toFixed(3)})`);
      console.log(`Flow magnitude: ${Math.sqrt(flow.x * flow.x + flow.y * flow.y).toFixed(3)}`);
      console.log('=== END DEBUG ===\n');
    } catch (error) {
      console.error('Debug read failed:', error);
    }
  }

  /**
   * Set active debug overlays
   */
  public setDebugOverlays(overlays: DebugOverlay[]): void {
    if (this.debugOverlaySystem) {
      this.debugOverlaySystem.setOverlays(overlays);
    }

    // Handle contours separately (they're part of terrain material)
    this.showContours = overlays.includes('contours');
    this.meshFactory.updateTerrainContours(this.showContours);
  }

  /**
   * Cleanup resources
   */
  public override dispose(): void {
    // Dispose subsystems
    this.brushInteractionHandler.dispose();
    this.dayNightManager.dispose();
    this.sourceEmitterManager.dispose();
    this.textureManager.dispose();
    this.meshFactory.dispose();

    if (this.debugOverlaySystem) {
      this.debugOverlaySystem.dispose();
    }

    // Clean up brush system
    if (this.brushSystem) {
      this.brushSystem.destroy();
    }

    // Clean up fluid system
    if (this.fluidSystem) {
      this.fluidSystem.destroy();
    }

    // Dispose of controls
    this.controls.dispose();

    super.dispose();
  }
}
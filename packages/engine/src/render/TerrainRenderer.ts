import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { BrushSystem } from '../sim/BrushSystem';
import { TerrainConfig } from '@terraforming/types';

// Import subsystems
import { BrushInteractionHandler } from './systems/BrushInteractionHandler';
import { DayNightCycleManager } from './systems/DayNightCycleManager';
import { TerrainGenerator } from './systems/TerrainGenerator';
import { TextureManager } from './systems/TextureManager';
import { MeshFactory } from './systems/MeshFactory';
import { HeightSampler } from './systems/HeightSampler';
import { SourceEmitterManager } from './systems/SourceEmitterManager';

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

  // State
  private showContours = true;

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
  }

  protected override async onRendererReady(): Promise<void> {
    console.log('TerrainRenderer: WebGPU renderer ready');

    // Get WebGPU device from the renderer
    const device = (this.renderer as any).backend?.device;
    if (!device) {
      console.error('TerrainRenderer: WebGPU device not available');
      return;
    }

    console.log('Device maxStorageTexturesPerShaderStage:', device.limits?.maxStorageTexturesPerShaderStage);

    // Initialize brush system with WebGPU device
    this.brushSystem = new BrushSystem(device, {
      gridSize: [this.gridSize, this.gridSize],
      cellSize: this.terrainSize / this.gridSize,
      angleOfRepose: 33,
      handCapacityKg: 10000,
    });

    // Connect subsystems
    this.brushInteractionHandler.setBrushSystem(this.brushSystem);
    this.heightSampler.setBrushSystem(this.brushSystem);
    this.brushInteractionHandler.initialize(this.scene);

    // Create terrain and meshes
    this.meshFactory.createTerrain(this.scene, this.showContours);
    this.meshFactory.createOcean(this.scene);
    this.meshFactory.createWater(this.scene);
    this.meshFactory.createLava(this.scene);

    // Generate test terrain
    this.terrainGenerator.generateTestTerrain(this.textureManager.heightTexture);

    // Initialize brush system with terrain data
    this.initializeBrushSystemWithTerrain();

    console.log('TerrainRenderer: Scene children count:', this.scene.children.length);
    console.log('TerrainRenderer: Terrain mesh added:', !!this.meshFactory.terrainMesh);
    console.log('TerrainRenderer: Ocean mesh added:', !!this.meshFactory.oceanMesh);
    console.log('TerrainRenderer: Brush system initialized:', !!this.brushSystem);
  }

  /**
   * Initialize brush system fields with current terrain height data
   */
  private initializeBrushSystemWithTerrain(): void {
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
      if (heightMeters > waterLevelMeters) {
        // Above water: rock goes up to water level, rest is soil
        rockData[i] = Math.max(0, waterLevelMeters - 0.5); // Rock up to just below water
        soilData[i] = Math.max(0, heightMeters - waterLevelMeters); // Soil is everything above water
      } else {
        // Below water: all rock, no soil
        rockData[i] = heightMeters;
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
  public updateHeightmap(data: Float32Array): void {
    this.textureManager.updateHeightmap(data);
    if (this.brushSystem) {
      this.initializeBrushSystemWithTerrain();
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
   */
  public addWaterSource(worldX: number, worldZ: number, flowRate: number = 10): string {
    const height = this.heightSampler.getHeightAtWorldPos(worldX, worldZ);
    const position = new THREE.Vector3(worldX, height, worldZ);
    return this.sourceEmitterManager.addSource(position, 'water', flowRate);
  }

  /**
   * Add a lava source at the specified position
   */
  public addLavaSource(worldX: number, worldZ: number, flowRate: number = 10): string {
    const height = this.heightSampler.getHeightAtWorldPos(worldX, worldZ);
    const position = new THREE.Vector3(worldX, height, worldZ);
    return this.sourceEmitterManager.addSource(position, 'lava', flowRate);
  }

  /**
   * Remove a source by ID
   */
  public removeSource(id: string): boolean {
    return this.sourceEmitterManager.removeSource(id);
  }

  /**
   * Toggle source indicators visibility
   */
  public setSourceIndicatorsVisible(visible: boolean): void {
    this.sourceEmitterManager.setVisualIndicatorsVisible(visible);
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
    if (this.brushSystem && this.renderer) {
      const device = (this.renderer as any).backend?.device;
      if (device) {
        const commandEncoder = device.createCommandEncoder();
        this.brushSystem.execute(commandEncoder);
        device.queue.submit([commandEncoder.finish()]);
      }
    }

    // Render the scene
    super.render();
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

    // Clean up brush system
    if (this.brushSystem) {
      this.brushSystem.destroy();
    }

    // Dispose of controls
    this.controls.dispose();

    super.dispose();
  }
}
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { createTerrainMaterialTSL } from './materials/TerrainMaterialTSL';
import { createWaterMaterialTSL } from './materials/WaterMaterialTSL';
import { createLavaMaterialTSL } from './materials/LavaMaterialTSL';

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

  private gridSize: number;
  private terrainSize: number;

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

    // Setup scene
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 100, 500);

    // Setup camera - position opposite to main light for better illumination
    this.camera.position.set(-45, 35, -45);
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

  protected override onRendererReady(): void {
    console.log('TerrainRenderer: WebGPU renderer ready');

    // Create terrain after renderer is ready
    this.createTerrain();

    // Generate default island terrain
    this.generateTestTerrain();

    // Debug logging
    console.log('TerrainRenderer: Scene children count:', this.scene.children.length);
    console.log('TerrainRenderer: Terrain mesh added:', !!this.terrainMesh);
    console.log('TerrainRenderer: Ocean mesh added:', !!this.oceanMesh);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = false;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = true;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Store references for cleanup
    (this as any)._keyHandlers = { handleKeyDown, handleKeyUp };
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

    // Ambient light - slightly increased for better overall illumination
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(ambientLight);

    // Main directional light (sun) - with shadows enabled
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(30, 50, 30);
    directionalLight.castShadow = true;

    // Configure shadow camera for better quality
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 10;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.bias = -0.0005;

    this.scene.add(directionalLight);

    // Strong fill light from camera side (no shadows) - illuminates terrain features
    const fillLight = new THREE.DirectionalLight(0xa0b0ff, 0.5);
    fillLight.position.set(-35, 40, -35); // Same side as camera
    this.scene.add(fillLight);

    // Additional side light for better form definition
    const sideLight = new THREE.DirectionalLight(0xffe0a0, 0.3);
    sideLight.position.set(0, 30, -50); // From the side
    this.scene.add(sideLight);
  }

  private createDataTexture(): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4);

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
    // Create terrain geometry - use lower subdivision for smoother terrain
    const subdivisions = 63; // 64x64 grid for smooth terrain
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
      heightScale: 15,
      terrainSize: this.terrainSize,
      flowMap: this.flowTexture,
      accumulationMap: this.accumulationTexture,
    });

    // Create mesh - height displacement happens in vertex shader via TSL
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // No need to update vertices - GPU handles displacement via heightTexture

    // Create ocean water plane at sea level (always visible)
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize * 2, // Extend beyond terrain
      this.terrainSize * 2,
      1, // Simple plane for ocean
      1
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      color: new THREE.Color(0x006994),
      opacity: 0.85
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = 0.5; // Sea level
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
    // Generate an island terrain with beaches, mountains, and water
    const size = this.gridSize;
    const data = this.heightTexture.image.data as Float32Array;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Normalized coordinates (-0.5 to 0.5)
        const nx = x / size - 0.5;
        const ny = y / size - 0.5;

        // Distance from center
        const dist = Math.sqrt(nx * nx + ny * ny);

        // Start with base island shape (circular falloff)
        let height = Math.max(0, 1 - dist * 2.5) * 0.35; // Main island

        // Add smooth mountain features to main island
        if (height > 0.02) {
          // Smooth mountain ridge using smoother functions
          const ridge1 = Math.exp(-Math.pow(nx - ny, 2) * 8) * 0.15;
          const ridge2 = Math.exp(-Math.pow(nx + ny, 2) * 8) * 0.1;

          // Central peak with smooth falloff
          const centralPeak = Math.exp(-(dist * dist) * 6) * 0.25;

          height += ridge1 + ridge2 + centralPeak;

          // Add very gentle rolling hills
          height += Math.sin(nx * Math.PI * 2) * Math.cos(ny * Math.PI * 2) * 0.01;
        }

        // Add smaller islands and sandbanks
        // Small island to the northeast
        const island1Dist = Math.sqrt((nx - 0.25) * (nx - 0.25) + (ny - 0.2) * (ny - 0.2));
        const island1Height = Math.max(0, 1 - island1Dist * 8) * 0.08;
        height = Math.max(height, island1Height);

        // Small island to the southwest
        const island2Dist = Math.sqrt((nx + 0.3) * (nx + 0.3) + (ny + 0.15) * (ny + 0.15));
        const island2Height = Math.max(0, 1 - island2Dist * 12) * 0.06;
        height = Math.max(height, island2Height);

        // Sandbank to the east
        const sandbank1Dist = Math.sqrt((nx - 0.35) * (nx - 0.35) + (ny - 0.05) * (ny - 0.05));
        const sandbank1Height = Math.max(0, 1 - sandbank1Dist * 6) * 0.04;
        height = Math.max(height, sandbank1Height);

        // Sandbank to the west (elongated)
        const sandbank2DistX = Math.abs(nx + 0.28) * 3;
        const sandbank2DistY = Math.abs(ny + 0.08) * 8;
        const sandbank2Dist = Math.sqrt(sandbank2DistX * sandbank2DistX + sandbank2DistY * sandbank2DistY);
        const sandbank2Height = Math.max(0, 1 - sandbank2Dist * 1.5) * 0.035;
        height = Math.max(height, sandbank2Height);

        // Create much more gradual beach transitions
        if (height > 0.02 && dist > 0.25) {
          const beachStart = 0.25;
          const beachEnd = 0.5;
          if (dist > beachStart && dist < beachEnd) {
            const t = Math.max(0, Math.min(1, (dist - beachStart) / (beachEnd - beachStart)));
            const beachFactor = t * t * (3 - 2 * t); // smoothstep
            height = height * (1 - beachFactor) + 0.01 * beachFactor;
          }
        }

        // Ocean floor with some variation
        if (dist > 0.5) {
          // Varying ocean floor depth
          const oceanDepth = 0.005 + Math.sin(nx * 8) * Math.cos(ny * 6) * 0.002;
          height = Math.max(height, oceanDepth);
        }

        // Clamp to valid range
        height = Math.max(0, Math.min(1, height));

        data[idx] = height;
        data[idx + 1] = height;
        data[idx + 2] = height;
        data[idx + 3] = 1;
      }
    }

    this.heightTexture.needsUpdate = true;
    // GPU will automatically use updated texture for displacement
  }

  public updateHeightmap(data: Float32Array): void {
    const textureData = this.heightTexture.image.data as Float32Array;
    textureData.set(data);
    this.heightTexture.needsUpdate = true;
    // GPU will automatically use updated texture for displacement
  }

  public updateFlowmap(data: Float32Array): void {
    const textureData = this.flowTexture.image.data as Float32Array;
    textureData.set(data);
    this.flowTexture.needsUpdate = true;
  }

  public updateWaterDepth(data: Float32Array): void {
    const textureData = this.waterDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.waterDepthTexture.needsUpdate = true;

    // Show/hide water mesh based on presence of water
    const hasWater = data.some(v => v > 0.01);
    if (this.waterMesh) {
      this.waterMesh.visible = hasWater;
    }
  }

  public updateLavaDepth(data: Float32Array): void {
    const textureData = this.lavaDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.lavaDepthTexture.needsUpdate = true;

    // Show/hide lava mesh based on presence of lava
    const hasLava = data.some(v => v > 0.01);
    if (this.lavaMesh) {
      this.lavaMesh.visible = hasLava;
    }
  }

  public updateTemperature(data: Float32Array): void {
    const textureData = this.temperatureTexture.image.data as Float32Array;
    textureData.set(data);
    this.temperatureTexture.needsUpdate = true;
  }

  public setDebugMode(mode: number): void {
    // Update debug mode on materials
    if (this.terrainMesh) {
      const material = this.terrainMesh.material as any;
      if (material.uniforms?.debugMode) {
        material.uniforms.debugMode.value = mode;
      }
    }
  }

  public override render(): void {
    this.controls.update();
    super.render();

    // Debug every 60 frames
    if (Math.floor(Date.now() / 1000) % 2 === 0 && Math.random() < 0.01) {
      console.log('TerrainRenderer: Rendering with', this.scene.children.length, 'scene children');
    }
  }

  public override dispose(): void {
    this.controls.dispose();

    // Clean up shift key handlers
    const keyHandlers = (this as any)._keyHandlers;
    if (keyHandlers) {
      window.removeEventListener('keydown', keyHandlers.handleKeyDown);
      window.removeEventListener('keyup', keyHandlers.handleKeyUp);
    }

    // Dispose textures
    this.heightTexture.dispose();
    this.flowTexture.dispose();
    this.accumulationTexture.dispose();
    this.waterDepthTexture.dispose();
    this.lavaDepthTexture.dispose();
    this.temperatureTexture.dispose();

    // Dispose geometries and materials
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }
    if (this.oceanMesh) {
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as THREE.Material).dispose();
    }
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}
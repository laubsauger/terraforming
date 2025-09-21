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

    // Setup camera
    this.camera.position.set(50, 30, 50);
    this.camera.lookAt(0, 0, 0);

    // Setup orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground

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

  private setupLighting(): void {
    // Ambient light - slightly warmer
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.5);
    this.scene.add(ambientLight);

    // Directional light (sun) - stronger for better shading
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(30, 50, 30);
    directionalLight.castShadow = false; // Disable shadows for better performance
    this.scene.add(directionalLight);

    // Add a second fill light from opposite direction
    const fillLight = new THREE.DirectionalLight(0x8090ff, 0.3);
    fillLight.position.set(-30, 20, -30);
    this.scene.add(fillLight);
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
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = false; // Don't cast shadows for performance
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
      opacity: 0.7
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.6; // Slightly above ocean
    this.waterMesh.visible = false; // Start hidden until we have water depth data
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
    this.lavaMesh.position.y = 0.05; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
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
        let height = Math.max(0, 1 - dist * 2.2) * 0.3; // Gentler base shape

        // Add smooth mountain features
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

        // Smooth beach transitions with smoother interpolation
        if (dist > 0.3 && dist < 0.45) {
          const t = Math.max(0, Math.min(1, (dist - 0.3) / 0.15));
          const beachFactor = t * t * (3 - 2 * t); // smoothstep
          height = height * (1 - beachFactor) + 0.02 * beachFactor;
        }

        // Ensure water level around the island
        if (dist > 0.45) {
          height = 0.02; // Very slight underwater depth
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
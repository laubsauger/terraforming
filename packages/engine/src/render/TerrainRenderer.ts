import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { createTerrainMaterialTSL } from './materials/TerrainMaterialTSL';
import { createWaterMaterial } from './materials/WaterMaterial';
import { createLavaMaterial } from './materials/LavaMaterial';

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
    this.flowTexture = this.createDataTexture(2);
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
  }

  private setupLighting(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = false; // Disable shadows for better performance
    this.scene.add(directionalLight);
  }

  private createDataTexture(components: number = 1): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4);

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      components === 1 ? THREE.RedFormat : THREE.RGFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }

  private createTerrain(): void {
    // Create terrain geometry - reduce subdivision for better performance
    const subdivisions = Math.min(127, this.gridSize / 2 - 1); // Cap at 128x128 for performance
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

    // Create water surface (initially invisible)
    const waterGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for water
      32
    );
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = createWaterMaterial({
      waterDepthMap: this.waterDepthTexture,
      flowMap: this.flowTexture,
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.1; // Slightly above terrain
    this.waterMesh.visible = false; // Start hidden
    this.scene.add(this.waterMesh);

    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for lava
      32
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterial({
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
        let height = Math.max(0, 1 - dist * 2.5) * 0.5; // Reduce overall height

        // Add gentler mountain features
        if (height > 0.05) {
          // Gentler mountain ridge
          const ridge1 = Math.exp(-Math.pow(nx - ny, 2) * 20) * 0.3;

          // Secondary ridge
          const ridge2 = Math.exp(-Math.pow(nx + ny, 2) * 20) * 0.2;

          // Central peak (gentler)
          const centralPeak = Math.exp(-(nx * nx + ny * ny) * 10) * 0.4;

          height += ridge1 + ridge2 + centralPeak;

          // Very subtle variation
          height += Math.sin(nx * Math.PI * 4) * Math.cos(ny * Math.PI * 4) * 0.02;
        }

        // Smooth beach transitions
        if (dist > 0.35 && dist < 0.45) {
          const beachFactor = (dist - 0.35) / 0.1;
          height *= (1 - beachFactor * 0.8);
        }

        // Ensure water level around the island (flatten edges)
        if (dist > 0.45) {
          height = 0.05; // Slight underwater depth
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
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}
import * as THREE from 'three/webgpu';
import { createTerrainMaterialTSL } from '../materials/TerrainMaterialTSL';
import { createWaterMaterialTSL } from '../materials/WaterMaterialTSL';
import { createLavaMaterialTSL } from '../materials/LavaMaterialTSL';
import type { TextureManager } from './TextureManager';

export interface MeshFactoryOptions {
  terrainSize: number;
  gridSize: number;
  heightScale: number;
  waterLevel: number;
  textureManager: TextureManager;
}

export class MeshFactory {
  private terrainSize: number;
  private gridSize: number;
  private heightScale: number;
  private waterLevel: number;
  private waterLevelNormalized: number;
  private textureManager: TextureManager;

  // Meshes
  public terrainMesh?: THREE.Mesh;
  public waterMesh?: THREE.Mesh;
  public lavaMesh?: THREE.Mesh;
  public oceanMesh?: THREE.Mesh;

  constructor(options: MeshFactoryOptions) {
    this.terrainSize = options.terrainSize;
    this.gridSize = options.gridSize;
    this.heightScale = options.heightScale;
    this.waterLevel = options.waterLevel;
    this.waterLevelNormalized = options.waterLevel / options.heightScale;
    this.textureManager = options.textureManager;
  }

  public createTerrain(scene: THREE.Scene, showContours: boolean = true): THREE.Mesh {
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
      heightMap: this.textureManager.heightTexture,
      heightScale: this.heightScale,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      flowMap: this.textureManager.flowTexture,
      accumulationMap: this.textureManager.accumulationTexture,
      showContours: showContours,
      contourInterval: 0.05,
      waterLevel: this.waterLevelNormalized,
    });

    // Create mesh - height displacement happens in vertex shader via TSL
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.matrixAutoUpdate = true;
    scene.add(this.terrainMesh);

    return this.terrainMesh;
  }

  public createOcean(scene: THREE.Scene): THREE.Mesh {
    // Create ocean water plane at sea level (always visible)
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      128, // Higher resolution for better shore blending
      128
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      opacity: 0.9,
      heightTexture: this.textureManager.heightTexture,
      waterLevel: this.waterLevelNormalized
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = this.waterLevel;
    this.oceanMesh.position.x = 0;
    this.oceanMesh.position.z = 0;
    this.oceanMesh.renderOrder = 1;
    scene.add(this.oceanMesh);

    return this.oceanMesh;
  }

  public createWater(scene: THREE.Scene): THREE.Mesh {
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
      depthTexture: this.textureManager.waterDepthTexture
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.3; // Lower water level to show shallow areas
    this.waterMesh.visible = false; // Start hidden until we have water depth data
    this.waterMesh.receiveShadow = true;
    scene.add(this.waterMesh);

    return this.waterMesh;
  }

  public createLava(scene: THREE.Scene): THREE.Mesh {
    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for lava
      32
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterialTSL({
      lavaDepthMap: this.textureManager.lavaDepthTexture,
      temperatureMap: this.textureManager.temperatureTexture,
      flowMap: this.textureManager.flowTexture,
    });

    this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    this.lavaMesh.position.y = 0.02; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
    this.lavaMesh.castShadow = true;
    this.lavaMesh.receiveShadow = true;
    scene.add(this.lavaMesh);

    return this.lavaMesh;
  }

  public updateTerrainContours(showContours: boolean): void {
    if (!this.terrainMesh) return;

    const oldMaterial = this.terrainMesh.material as THREE.Material;

    // Create new material with contour settings
    const newMaterial = createTerrainMaterialTSL({
      heightMap: this.textureManager.heightTexture,
      heightScale: this.heightScale,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      flowMap: this.textureManager.flowTexture,
      accumulationMap: this.textureManager.accumulationTexture,
      showContours: showContours,
      contourInterval: 0.05,
      waterLevel: this.waterLevelNormalized,
    });

    this.terrainMesh.material = newMaterial;
    oldMaterial.dispose();
  }

  public updateWaterVisibility(): void {
    if (this.waterMesh) {
      this.waterMesh.visible = this.textureManager.hasWater();
    }
  }

  public updateLavaVisibility(): void {
    if (this.lavaMesh) {
      this.lavaMesh.visible = this.textureManager.hasLava();
    }
  }

  public dispose(): void {
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
  }
}